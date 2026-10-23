from django.utils.translation import gettext as _
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.access import SchoolAccess, log
from api.i18n import tr
from api.models import AuditLog
from ops.common import MANAGERS, SchoolModelViewSet, my_children, parse_date
from ops.models import Student

from .models import Bus, LeaveTimeOverride, ManualRoute, RoutePlan, RouteRun, RouteStop, TransportSettings
from .services import (
    PlanError, current_plans, driver_today, finish_run, parent_bus_info, plan_routes, record_event,
    record_location, run_payload, settings_for, start_run,
)

STAFF = ("admin", "staff", "teacher")
MODULE = "transport"


class TransportSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransportSettings
        exclude = ["id", "school"]

    def validate_max_ride_minutes(self, v):
        if not 5 <= v <= 180:
            raise serializers.ValidationError(_("Use 5 to 180 minutes."))
        return v


class TransportSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=MANAGERS, module=MODULE)
        return Response(TransportSettingsSerializer(settings_for(access.school)).data)

    def put(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=MANAGERS, module=MODULE)
        s = TransportSettingsSerializer(settings_for(access.school), data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)


class BusSerializer(serializers.ModelSerializer):
    driver_email = serializers.EmailField(source="driver.email", read_only=True, default=None)

    class Meta:
        model = Bus
        fields = ["id", "name", "plate", "capacity", "driver", "driver_email", "driver_name", "driver_phone",
                  "fuel_l_per_100km", "fuel_price_per_l", "is_active"]
        read_only_fields = ["driver"]


class BusViewSet(SchoolModelViewSet):
    model = Bus
    serializer_class = BusSerializer
    read_roles = MANAGERS
    module = MODULE
    audit_model = True


class LeaveOverrideSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)

    class Meta:
        model = LeaveTimeOverride
        fields = ["id", "student", "student_name", "date", "leave_time"]

    def validate_student(self, v):
        if v.school_id != self.context["school"].id:
            raise serializers.ValidationError(_("Unknown student."))
        return v


class LeaveOverrideViewSet(SchoolModelViewSet):
    model = LeaveTimeOverride
    serializer_class = LeaveOverrideSerializer
    read_roles = MANAGERS
    module = MODULE


class ManualRouteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ManualRoute
        fields = ["id", "bus", "direction", "student_order"]

    def validate(self, data):
        school = self.context["school"]
        if data["bus"].school_id != school.id:
            raise serializers.ValidationError(_("Unknown bus."))
        ids = data.get("student_order") or []
        if Student.objects.filter(school=school, id__in=ids).count() != len(set(ids)):
            raise serializers.ValidationError(_("Unknown student in the order."))
        return data


class ManualRouteViewSet(SchoolModelViewSet):
    model = ManualRoute
    serializer_class = ManualRouteSerializer
    read_roles = MANAGERS
    module = MODULE


def plan_payload(plan, with_students=True):
    routes = []
    for r in plan.routes.select_related("bus").prefetch_related("stops__students"):
        routes.append({
            "id": r.id, "bus": r.bus.name, "bus_id": r.bus_id, "capacity": r.bus.capacity,
            "depart": r.depart_time.strftime("%H:%M"), "arrive": r.arrive_time.strftime("%H:%M"),
            "km": r.total_km, "minutes": r.total_minutes, "fuel_litres": r.fuel_litres, "fuel_cost": str(r.fuel_cost),
            "child_minutes": r.student_minutes, "geometry": r.geometry,
            "students": sum(st.students.count() for st in r.stops.all()),
            "stops": [{"order": st.order, "lat": st.lat, "lng": st.lng, "label": st.label,
                       "eta": st.eta.strftime("%H:%M"), "is_school": st.is_school,
                       "students": [s.full_name for s in st.students.all()] if with_students else [],
                       "count": st.students.count()} for st in r.stops.all()],
        })
    summary = dict(plan.summary or {})
    for key in ("reasons", "provider_note", "fewer_buses_note"):
        if summary.get(key):
            summary[key] = tr(summary[key])
    return {"id": plan.id, "direction": plan.direction, "date": plan.date,
            "wave_time": plan.wave_time.strftime("%H:%M") if plan.wave_time else None,
            "status": plan.status, "summary": summary, "created_at": plan.created_at, "routes": routes}


class PlansView(APIView):
    """GET current plans; POST {"direction": "morning"|"afternoon", "date": optional} to optimize."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=MANAGERS, module=MODULE)
        day = parse_date(request.query_params.get("date"), None)
        plans = RoutePlan.objects.filter(school=access.school, is_current=True, date=day).order_by("direction", "wave_time")
        return Response([plan_payload(p) for p in plans])

    def post(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=MANAGERS, write_roles=MANAGERS, module=MODULE)
        direction = request.data.get("direction")
        if direction not in ("morning", "afternoon"):
            raise ValidationError({"direction": _("Choose morning or afternoon.")})
        day = parse_date(request.data.get("date"), None)
        try:
            plans = plan_routes(access.school, direction, request.user, day)
        except PlanError as exc:
            raise ValidationError({"error": tr(exc.args[0])})
        return Response([plan_payload(p) for p in plans], status=status.HTTP_201_CREATED)


class LiveOverviewView(APIView):
    """GET /schools/{id}/transport/live/ - all running buses for admin/staff."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=MANAGERS, module=MODULE)
        runs = RouteRun.objects.filter(school=access.school, date=timezone.localdate()) \
            .select_related("route__bus", "route__plan")
        return Response([{"run_id": r.id, "bus": r.route.bus.name, "direction": r.route.plan.direction,
                          "status": r.status, "lat": r.last_lat, "lng": r.last_lng, "last_seen": r.last_seen,
                          "delay_minutes": round(r.delay_minutes), "next_stop_order": r.next_stop_order,
                          "stops": r.route.stops.count()} for r in runs])


def _log_view_once(school, user, model, object_id, summary):
    today = timezone.localdate()
    if not AuditLog.objects.filter(school=school, user=user, action="view", model=model, object_id=object_id,
                                   created_at__date=today).exists():
        log(school, user, "view", None, model=model, object_id=object_id, summary=summary)


class DriverTodayView(APIView):
    """GET /schools/{id}/driver/today/ - the driver's own routes for today, nothing else."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=("driver",), module=MODULE)
        data = driver_today(access.school, request.user, timezone.localdate())
        for r in data["runs"]:
            _log_view_once(access.school, request.user, "transport.RouteRun", str(r["run_id"]), "Driver opened route")
        return Response(data)


class DriverRunActionView(APIView):
    """POST /schools/{id}/driver/runs/{run}/{action}/ with action in start|location|event|arrived|finish."""
    permission_classes = [IsAuthenticated]

    def post(self, request, school_id, run_id, action):
        access = SchoolAccess(request, school_id, read_roles=("driver",), write_roles=("driver",), module=MODULE)
        run = get_object_or_404(RouteRun.objects.select_related("route__bus", "route__plan"), id=run_id,
                                school=access.school, date=timezone.localdate())
        if run.route.bus.driver_id != request.user.id:
            raise NotFound()
        d = request.data
        if action == "start":
            start_run(run, request.user)
        elif action == "location":
            try:
                lat, lng = float(d["lat"]), float(d["lng"])
            except (KeyError, TypeError, ValueError):
                raise ValidationError(_("lat and lng are required."))
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                raise ValidationError(_("Invalid coordinates."))
            if run.status != "active":
                raise ValidationError(_("Start the route first."))
            etas = record_location(run, lat, lng, d.get("accuracy"))
            return Response({"ok": True, "etas": etas, "delay_minutes": round(run.delay_minutes)})
        elif action == "event":
            kind = d.get("kind")
            if kind not in ("picked_up", "dropped_off", "absent"):
                raise ValidationError({"kind": _("picked_up, dropped_off or absent")})
            stop = get_object_or_404(RouteStop, id=d.get("stop"), route=run.route)
            student = stop.students.filter(id=d.get("student")).first()
            if not student:
                raise ValidationError({"student": _("This child is not at this stop.")})
            record_event(run, kind, student, stop)
        elif action == "arrived":
            stop = get_object_or_404(RouteStop, id=d.get("stop"), route=run.route)
            record_event(run, "stop_arrived", None, stop)
        elif action == "finish":
            finish_run(run)
        else:
            raise ValidationError(_("Unknown action."))
        run.refresh_from_db()
        return Response(run_payload(run))


class MyBusView(APIView):
    """GET /schools/{id}/my/bus/?student= - a parent's view: own child's stop + bus position while running."""
    permission_classes = [IsAuthenticated]

    def get(self, request, school_id):
        access = SchoolAccess(request, school_id, read_roles=("parent",), module=MODULE)
        kids = my_children(request.user, access.school)
        if request.query_params.get("student"):
            kids = kids.filter(id=request.query_params["student"])
        day = timezone.localdate()
        out = []
        for child in kids:
            info = parent_bus_info(access.school, child, day)
            if info:
                out.append({"student": child.id, "name": child.first_name, "trips": info})
                if any(t["live"] for t in info):
                    _log_view_once(access.school, request.user, "transport.live", str(child.id),
                                   "Parent viewed live bus location")
        return Response(out)
