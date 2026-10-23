"""Transport glue between the database, the routing provider and the optimizer, plus live tracking."""
from collections import defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from api.access import log
from api.i18n import payload
from api.scheduling.messages import Msg
from api.notify import notify

from .models import (
    Bus, LeaveTimeOverride, LocationPing, ManualRoute, Route, RoutePlan, RouteRun, RouteStop, RunEvent,
    TransportSettings,
)
from .optimizer import BusIn, StopIn, VRPInput, evaluate_order, solve
from .routing import cached_matrix, get_provider, haversine_m


class PlanError(Exception):
    pass


def settings_for(school):
    obj, _ = TransportSettings.objects.get_or_create(school=school)
    return obj


def at(day, t):
    return timezone.make_aware(datetime.combine(day, t))


def add_seconds(t, seconds):
    base = datetime.combine(datetime(2000, 1, 3).date(), t) + timedelta(seconds=round(seconds))
    return base.time()


# ---------------------------------------------------------------- stops
def build_stops(students, cfg):
    """Group children into stops: siblings share one stop; optionally nearby homes share a walk-to stop."""
    from ops.models import StudentGuardian
    with_home = [s for s in students if s.home_lat is not None and s.home_lng is not None]
    family = {}
    if cfg.siblings_share_stop:
        for link in StudentGuardian.objects.filter(student__in=with_home, is_primary=True):
            family[link.student_id] = link.guardian_id
    groups = []
    for s in with_home:
        placed = False
        for g in groups:
            first = g[0]
            same_family = cfg.siblings_share_stop and family.get(s.id) and family.get(s.id) == family.get(first.id)
            same_home = haversine_m((s.home_lat, s.home_lng), (first.home_lat, first.home_lng)) < 30
            near = cfg.walk_to_stop and haversine_m((s.home_lat, s.home_lng), (first.home_lat, first.home_lng)) <= cfg.walk_radius_m
            if same_family or same_home or near:
                g.append(s)
                placed = True
                break
        if not placed:
            groups.append([s])
    stops = []
    for i, g in enumerate(groups):
        if len(g) > 1 and cfg.walk_to_stop:
            clat = sum(x.home_lat for x in g) / len(g)
            clng = sum(x.home_lng for x in g) / len(g)
            anchor = min(g, key=lambda x: haversine_m((x.home_lat, x.home_lng), (clat, clng)))
        else:
            anchor = g[0]
        label = anchor.home_address or f"Stop {i + 1}"
        stops.append((StopIn(str(i), anchor.home_lat, anchor.home_lng, len(g), label), g))
    missing = [s for s in students if s.home_lat is None or s.home_lng is None]
    return stops, missing


# ---------------------------------------------------------------- leaving times / waves
def default_leave_time(school, student, day):
    from ops.common import active_timetable
    tt = active_timetable(school)
    if tt and student.group_id:
        last = tt.entries.filter(student_group_id=student.group_id, day_of_week=day.isoweekday()) \
            .select_related("period").order_by("-period__order").first()
        if last:
            return last.period.end_time
    if tt:
        last = tt.schedule.periods.order_by("-order").first()
        if last:
            return last.end_time
    return time(14, 0)


def leave_times(school, students, day):
    overrides = {o.student_id: o for o in LeaveTimeOverride.objects.filter(student__in=students, date=day)}
    out = {}
    for s in students:
        o = overrides.get(s.id)
        if o is not None:
            if o.leave_time is None:
                continue          # not on the bus that day
            out[s.id] = o.leave_time
        else:
            out[s.id] = default_leave_time(school, s, day)
    return out


def waves(times_by_student, window_minutes):
    """Children leaving within `window` minutes of the first child in a wave share that wave."""
    ordered = sorted(times_by_student.items(), key=lambda kv: kv[1])
    result, current, start = [], [], None
    for sid, t in ordered:
        minutes = t.hour * 60 + t.minute
        if start is None or minutes - start > window_minutes:
            if current:
                result.append(current)
            current, start = [], minutes
        current.append((sid, t))
    if current:
        result.append(current)
    return [(max(t for _, t in w), [sid for sid, _ in w]) for w in result]


# ---------------------------------------------------------------- planning
def plan_routes(school, direction, user=None, day=None):
    """Optimize and save routes. Morning: one plan. Afternoon: one plan per leaving-time wave."""
    from ops.models import Student
    cfg = settings_for(school)
    if school.latitude is None or school.longitude is None:
        raise PlanError(Msg("Set the school's location on the map first (Settings)."))
    buses = list(Bus.objects.filter(school=school, is_active=True))
    if not buses:
        raise PlanError(Msg("Add at least one bus first."))
    flag = "uses_bus_morning" if direction == "morning" else "uses_bus_afternoon"
    students = list(Student.objects.filter(school=school, is_active=True, **{flag: True}))
    plan_day = day or timezone.localdate()
    with transaction.atomic():
        RoutePlan.objects.filter(school=school, direction=direction, date=day, is_current=True).update(is_current=False)
    if direction == "morning":
        deadline = (datetime.combine(plan_day, cfg.school_start_time) - timedelta(minutes=cfg.arrival_buffer_minutes)).time()
        return [_plan_one(school, cfg, buses, students, "morning", deadline, user, day)]
    lt = leave_times(school, students, plan_day)
    by_id = {s.id: s for s in students}
    plans = []
    for wave_end, ids in waves(lt, cfg.afternoon_wave_minutes):
        depart = add_seconds(wave_end, 5 * 60)   # five minutes to walk to the bus
        plans.append(_plan_one(school, cfg, buses, [by_id[i] for i in ids], "afternoon", depart, user, day))
    if not plans:
        plans.append(_plan_one(school, cfg, buses, [], "afternoon", time(14, 0), user, day))
    return plans


def _plan_one(school, cfg, buses, students, direction, anchor, user, day):
    stops, missing = build_stops(students, cfg)
    school_pt = (school.latitude, school.longitude)
    points = [school_pt] + [(s.lat, s.lng) for s, _ in stops]
    dur, dist, provider_used, note = cached_matrix(cfg.provider, points) if stops else ([[0]], [[0]], cfg.provider, "")
    vrp = VRPInput(direction=direction, stops=[s for s, _ in stops],
                   buses=[BusIn(b.id, b.name, b.capacity, b.fuel_l_per_100km) for b in buses],
                   durations=dur, distances=dist, service_seconds=cfg.stop_minutes * 60,
                   max_ride_seconds=cfg.max_ride_minutes * 60, weight_distance=cfg.weight_distance,
                   weight_ride=cfg.weight_ride_time, time_limit=cfg.solver_seconds)
    result = solve(vrp)
    bus_by_id = {b.id: b for b in buses}
    summary = {
        "status": result.status, "reasons": payload(result.reasons), "students": len(students),
        "stops": len(stops), "buses_available": len(buses), "buses_used": result.used_buses,
        "provider": provider_used, "provider_note": payload(note), "anchor": anchor.strftime("%H:%M"),
        "missing_home_location": [s.full_name for s in missing],
        "fewer_buses_note": payload(result.stats.get("fewer_buses_note", "")),
    }
    with transaction.atomic():
        plan = RoutePlan.objects.create(school=school, direction=direction, date=day, created_by=user,
                                        wave_time=anchor if direction == "afternoon" else None,
                                        status=result.status, summary=summary, is_current=True)
        totals = {"km": 0.0, "child_minutes": 0.0, "fuel_litres": 0.0, "fuel_cost": Decimal("0")}
        provider = get_provider(provider_used)
        for r in result.routes:
            bus = bus_by_id[r.bus_id]
            km = r.distance_m / 1000
            litres = km * bus.fuel_l_per_100km / 100
            cost = (Decimal(str(round(litres, 3))) * bus.fuel_price_per_l).quantize(Decimal("0.001"))
            if direction == "morning":
                etas = [add_seconds(anchor, off) for off in r.offsets]
                arrive = add_seconds(anchor, r.school_offset)
                depart = etas[0]
                seq_points = [points[i] for i in r.stop_indexes] + [school_pt]
            else:
                etas = [add_seconds(anchor, off) for off in r.offsets]
                depart, arrive = anchor, add_seconds(anchor, r.duration_s)
                seq_points = [school_pt] + [points[i] for i in r.stop_indexes]
            route = Route.objects.create(plan=plan, bus=bus, depart_time=depart, arrive_time=arrive,
                                         total_km=round(km, 2), total_minutes=round(r.duration_s / 60, 1),
                                         fuel_litres=round(litres, 2), fuel_cost=cost,
                                         student_minutes=round(r.student_seconds / 60, 1),
                                         geometry=provider.geometry(seq_points))
            order = 1
            if direction == "afternoon":
                RouteStop.objects.create(route=route, order=order, lat=school_pt[0], lng=school_pt[1],
                                         label=school.name, eta=anchor, is_school=True)
                order += 1
            for stop_idx, eta in zip(r.stop_indexes, etas):
                stop_in, kids = stops[stop_idx - 1]
                rs = RouteStop.objects.create(route=route, order=order, lat=stop_in.lat, lng=stop_in.lng,
                                              label=stop_in.label, eta=eta)
                rs.students.set(kids)
                order += 1
            if direction == "morning":
                RouteStop.objects.create(route=route, order=order, lat=school_pt[0], lng=school_pt[1],
                                         label=school.name, eta=arrive, is_school=True)
            totals["km"] += km
            totals["child_minutes"] += r.student_seconds / 60
            totals["fuel_litres"] += litres
            totals["fuel_cost"] += cost
        summary["totals"] = {"km": round(totals["km"], 1), "child_minutes": round(totals["child_minutes"]),
                             "fuel_litres": round(totals["fuel_litres"], 1), "fuel_cost": str(totals["fuel_cost"])}
        summary["comparison"] = compare_manual(school, direction, vrp, stops, summary["totals"])
        plan.summary = summary
        plan.save(update_fields=["summary"])
    if user is not None:
        log(school, user, "generate", plan, summary=f"Bus routes {direction}: {result.status}")
    return plan


def compare_manual(school, direction, vrp, stops, optimized):
    manual = list(ManualRoute.objects.filter(school=school, direction=direction))
    if not manual or not stops:
        return None
    stop_of = {}
    for idx, (_, kids) in enumerate(stops, start=1):
        for k in kids:
            stop_of[k.id] = idx
    orders = {}
    for m in manual:
        seq = []
        for sid in m.student_order:
            idx = stop_of.get(sid)
            if idx and idx not in seq:
                seq.append(idx)
        orders[m.bus_id] = seq
    before = evaluate_order(vrp, orders)
    return {"before": before, "after": {"km": optimized["km"], "child_minutes": optimized["child_minutes"]},
            "km_saved": round(before["km"] - optimized["km"], 1),
            "child_minutes_saved": round(before["child_minutes"] - optimized["child_minutes"])}


def current_plans(school, direction, day):
    plans = RoutePlan.objects.filter(school=school, direction=direction, is_current=True, date=day)
    if not plans.exists():
        plans = RoutePlan.objects.filter(school=school, direction=direction, is_current=True, date__isnull=True)
    return plans


# ---------------------------------------------------------------- driver
def run_payload(run, include_students=True):
    route = run.route
    stops = []
    picked = {e.student_id: e.kind for e in run.events.exclude(student__isnull=True).order_by("at")}
    for st in route.stops.prefetch_related("students"):
        stops.append({
            "id": st.id, "order": st.order, "lat": st.lat, "lng": st.lng, "label": st.label,
            "eta": st.eta.strftime("%H:%M"), "is_school": st.is_school,
            "students": [{"id": s.id, "name": s.full_name, "status": picked.get(s.id)} for s in st.students.all()]
            if include_students else [],
        })
    return {"run_id": run.id, "status": run.status, "direction": route.plan.direction, "bus": route.bus.name,
            "date": run.date, "depart": route.depart_time.strftime("%H:%M"), "arrive": route.arrive_time.strftime("%H:%M"),
            "next_stop_order": run.next_stop_order, "delay_minutes": round(run.delay_minutes),
            "geometry": route.geometry, "stops": stops, "total_km": route.total_km}


def driver_today(school, user, day):
    """The driver's own routes for today only (morning + afternoon waves)."""
    runs = []
    buses = Bus.objects.filter(school=school, driver=user, is_active=True)
    for direction in ("morning", "afternoon"):
        for plan in current_plans(school, direction, day):
            for route in plan.routes.filter(bus__in=buses).select_related("bus", "plan"):
                run, _ = RouteRun.objects.get_or_create(route=route, date=day,
                                                        defaults={"school": school, "driver": user})
                runs.append(run_payload(run))
    runs.sort(key=lambda r: r["depart"])
    return {"runs": runs}


def _guardians_of(students):
    from ops.common import guardian_users
    return guardian_users(students)


def start_run(run, user):
    run.status, run.started_at, run.driver = "active", timezone.now(), user
    run.save(update_fields=["status", "started_at", "driver"])
    kids = [s for st in run.route.stops.prefetch_related("students") for s in st.students.all()]
    title = Msg("The bus left school") if run.route.plan.direction == "afternoon" else Msg("The bus is on its way")
    notify(run.school, _guardians_of(kids), "bus", title, Msg("%(bus)s started its route.", bus=run.route.bus.name),
           link="/bus", channels=("push",))


def record_location(run, lat, lng, accuracy=None):
    now = timezone.now()
    LocationPing.objects.create(run=run, lat=lat, lng=lng, accuracy=accuracy)
    run.last_lat, run.last_lng, run.last_seen = lat, lng, now
    stops = list(run.route.stops.prefetch_related("students").order_by("order"))
    remaining = [s for s in stops if s.order >= run.next_stop_order and not s.is_school] or \
        [s for s in stops if s.order >= run.next_stop_order]
    if not remaining:
        run.save(update_fields=["last_lat", "last_lng", "last_seen"])
        return {}
    nxt = remaining[0]
    to_next = haversine_m((lat, lng), (nxt.lat, nxt.lng)) * 1.35 / (30 / 3.6)
    planned_next = at(run.date, nxt.eta)
    eta_next = now + timedelta(seconds=to_next)
    run.delay_minutes = max(0.0, (eta_next - planned_next).total_seconds() / 60)
    etas = {}
    for s in remaining:
        gap = (at(run.date, s.eta) - planned_next).total_seconds()
        etas[s.id] = eta_next + timedelta(seconds=gap)
    cfg = settings_for(run.school)
    notified = dict(run.notified or {})
    for s in remaining:
        if s.is_school:
            continue
        minutes = (etas[s.id] - now).total_seconds() / 60
        key = f"near:{s.id}"
        if minutes <= cfg.eta_notify_minutes and key not in notified:
            notify(run.school, _guardians_of(list(s.students.all())), "bus", Msg("The bus is almost at your stop"),
                   Msg("%(bus)s will reach your stop in about %(n)s minute(s).", bus=run.route.bus.name,
                       n=max(1, round(minutes))), link="/bus", channels=("push",))
            notified[key] = now.isoformat()
    if run.delay_minutes >= cfg.late_notify_minutes and "late" not in notified:
        kids = [k for s in remaining if not s.is_school for k in s.students.all()]
        notify(run.school, _guardians_of(kids), "bus", Msg("The bus is running late"),
               Msg("%(bus)s is running about %(n)s minutes late.", bus=run.route.bus.name, n=round(run.delay_minutes)),
               link="/bus", channels=("push",))
        notified["late"] = now.isoformat()
    run.notified = notified
    run.save(update_fields=["last_lat", "last_lng", "last_seen", "delay_minutes", "notified"])
    return {s.id: timezone.localtime(e).strftime("%H:%M") for s, e in ((s, etas[s.id]) for s in remaining)}


def record_event(run, kind, student=None, stop=None):
    RunEvent.objects.create(run=run, kind=kind, student=student, stop=stop)
    if stop is not None and kind == "stop_arrived":
        run.next_stop_order = stop.order + 1
        run.save(update_fields=["next_stop_order"])
    if student is not None and kind in ("picked_up", "dropped_off"):
        now = timezone.localtime().time()
        if kind == "picked_up":
            title = Msg("%(name)s was picked up by the bus", name=student.first_name)
            body = Msg("%(name)s was picked up at %(time)s (%(bus)s).", name=student.full_name, time=now, bus=run.route.bus.name)
        else:
            title = Msg("%(name)s was dropped off", name=student.first_name)
            body = Msg("%(name)s was dropped off at %(time)s (%(bus)s).", name=student.full_name, time=now, bus=run.route.bus.name)
        notify(run.school, _guardians_of([student]), "bus", title, body, link="/bus", channels=("push",))


def finish_run(run):
    run.status, run.ended_at = "completed", timezone.now()
    run.save(update_fields=["status", "ended_at"])


# ---------------------------------------------------------------- parents
def parent_bus_info(school, child, day):
    """Only this child's own stop and the bus position while the route runs - never other children."""
    out = []
    for direction in ("morning", "afternoon"):
        for plan in current_plans(school, direction, day):
            stop = RouteStop.objects.filter(route__plan=plan, students=child).select_related("route__bus").first()
            if not stop:
                continue
            route = stop.route
            run = RouteRun.objects.filter(route=route, date=day).first()
            info = {"direction": direction, "bus": route.bus.name, "stop": {"lat": stop.lat, "lng": stop.lng,
                                                                            "label": stop.label},
                    "planned_eta": stop.eta.strftime("%H:%M"), "status": run.status if run else "planned",
                    "child_status": None, "live": None,
                    "school": {"lat": school.latitude, "lng": school.longitude}}
            if run:
                ev = run.events.filter(student=child).order_by("-at").first()
                info["child_status"] = ev.kind if ev else None
                if run.status == "active" and run.last_lat is not None:
                    eta = None
                    if stop.order >= run.next_stop_order:
                        nxt = run.route.stops.filter(order__gte=run.next_stop_order).order_by("order").first()
                        to_next = haversine_m((run.last_lat, run.last_lng), (nxt.lat, nxt.lng)) * 1.35 / (30 / 3.6)
                        gap = (at(day, stop.eta) - at(day, nxt.eta)).total_seconds()
                        eta = max(0, round((to_next + gap) / 60))
                    info["live"] = {"lat": run.last_lat, "lng": run.last_lng, "last_seen": run.last_seen,
                                    "eta_minutes": eta, "delay_minutes": round(run.delay_minutes)}
            out.append(info)
    return out or None


def purge_old_locations():
    """Delete raw GPS older than each school's retention period (default 7 days)."""
    retention = dict(TransportSettings.objects.values_list("school_id", "location_retention_days"))
    school_ids = set(LocationPing.objects.filter(at__lt=timezone.now() - timedelta(days=1))
                     .values_list("run__school_id", flat=True).distinct())
    for sid in school_ids:
        days = retention.get(sid, 7)
        LocationPing.objects.filter(run__school_id=sid, at__lt=timezone.now() - timedelta(days=days)).delete()
        RouteRun.objects.filter(school_id=sid, date__lt=timezone.localdate() - timedelta(days=days)) \
            .update(last_lat=None, last_lng=None)
