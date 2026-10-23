import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bus, CheckCircle2, Navigation, Play, Printer, Route, Square, UserX, Wand2 } from "lucide-react";
import api, { errorText } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useAction, useFetch } from "../lib/hooks";
import { fmtDateTime, fmtMoney, fmtNumber, fmtTime } from "../lib/format";
import { busStatusLabel } from "../lib/labels";
import ResourcePage from "../components/ResourcePage";
import { COLORS, LiveMap, RoutesMap } from "../components/maps";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Input, Loading, PageHeader, Select, Stat, Tabs, cx } from "../components/ui";

export function Transport() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("routes");
  return (
    <div className="space-y-4">
      <PageHeader title={t("Buses & routes")} subtitle={t("Children's home locations are set on the Students page (map pin). Only staff and the child's own parents can see them.")} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "routes", label: t("Routes") }, { value: "live", label: t("Live") },
        { value: "buses", label: t("Buses") }, { value: "settings", label: t("Settings") }]} />
      {tab === "routes" && <RoutePlans />}
      {tab === "live" && <LiveOverview />}
      {tab === "buses" && <Buses />}
      {tab === "settings" && <TransportSettings />}
    </div>
  );
}

function RoutePlans() {
  const { t } = useTranslation();
  const { base, school } = useAuth();
  const { data: plans, loading, error, reload, setData } = useFetch(`${base}/transport/plans/`);
  const [run, busy] = useAction();
  const [active, setActive] = useState(0);
  const [highlight, setHighlight] = useState(null);
  const optimize = async (direction) => {
    const res = await run(() => api.post(`${base}/transport/plans/`, { direction }), t("Routes optimized"));
    const others = (plans || []).filter((p) => p.direction !== direction);
    const next = [...others, ...res.data].sort((a, b) => a.direction.localeCompare(b.direction) * -1);
    setData(next);
    setActive(next.findIndex((p) => p.direction === direction));
  };
  if (loading) return <Loading />;
  const plan = (plans || [])[active];
  const s = plan?.summary;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button icon={Wand2} onClick={() => optimize("morning")} loading={busy}>{t("Optimize morning routes")}</Button>
        <Button icon={Wand2} variant="secondary" onClick={() => optimize("afternoon")} loading={busy}>{t("Optimize afternoon routes")}</Button>
        {busy && <span className="self-center text-sm text-slate-500">{t("Working out the best routes - this can take up to a minute...")}</span>}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {!plans?.length ? <EmptyState icon={Route} title={t("No routes yet")} text={t("Add buses, mark which children take the bus and where they live, then optimize.")} /> : (
        <>
          <Tabs value={active} onChange={setActive} tabs={plans.map((p, i) => ({ value: i, label: p.direction === "morning" ? t("Morning") : `${t("Afternoon")} ${fmtTime(p.wave_time)}` }))} />
          {s.reasons?.length > 0 && <ErrorBox error={s.reasons.join(" ")} />}
          {s.provider_note && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{s.provider_note}</p>}
          {s.missing_home_location?.length > 0 && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{t("No home location for")}: {s.missing_home_location.join(", ")}</p>}
          {s.totals && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label={t("Children")} value={fmtNumber(s.students)} hint={t("{{n}} stops", { n: s.stops })} />
              <Stat label={t("Buses used")} value={`${s.buses_used} / ${s.buses_available}`} hint={s.fewer_buses_note ? t("Fewer would do") : null} tone={s.fewer_buses_note ? "yellow" : "blue"} />
              <Stat label={t("Total distance")} value={`${fmtNumber(s.totals.km, 1)} km`} />
              <Stat label={t("Fuel per trip")} value={fmtMoney(s.totals.fuel_cost, school.currency)} hint={`${fmtNumber(s.totals.fuel_litres, 1)} L`} />
              <Stat label={t("Child-minutes on buses")} value={fmtNumber(s.totals.child_minutes)} />
            </div>
          )}
          {s.fewer_buses_note && <p className="text-sm text-amber-700">{s.fewer_buses_note}</p>}
          {s.comparison && (
            <Card title={t("Compared with your current routes")}>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div><div className="text-slate-500">{t("Distance")}</div><div><s className="text-slate-400">{fmtNumber(s.comparison.before.km, 1)} km</s> → <b>{fmtNumber(s.comparison.after.km, 1)} km</b></div>
                  <Badge tone="green">-{fmtNumber(s.comparison.km_saved, 1)} km</Badge></div>
                <div><div className="text-slate-500">{t("Child-minutes on buses")}</div><div><s className="text-slate-400">{fmtNumber(s.comparison.before.child_minutes)}</s> → <b>{fmtNumber(s.comparison.after.child_minutes)}</b></div>
                  <Badge tone="green">-{fmtNumber(s.comparison.child_minutes_saved)}</Badge></div>
                <div><div className="text-slate-500">{t("Longest ride before")}</div><div><b>{fmtNumber(s.comparison.before.longest_ride_min)}</b> {t("min")}</div></div>
              </div>
            </Card>
          )}
          <RoutesMap routes={plan.routes} school={school.latitude != null ? [school.latitude, school.longitude] : null} highlight={highlight} />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {plan.routes.map((r, i) => (
              <Card key={r.id} title={<span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{r.bus}</span>}
                    actions={<><Button size="sm" variant="ghost" onClick={() => setHighlight(highlight === r.id ? null : r.id)}>{t("Show")}</Button>
                      <Link to={`/transport/sheet/${plan.id}/${r.id}`} target="_blank"><Button size="sm" variant="ghost" icon={Printer}>{t("Driver sheet")}</Button></Link></>}>
                <div className="text-sm text-slate-600">{fmtTime(r.depart)} → {fmtTime(r.arrive)} · {fmtNumber(r.km, 1)} km · {t("{{n}}/{{cap}} seats", { n: r.students, cap: r.capacity })}</div>
                <div className="text-xs text-slate-500">{t("Fuel")}: {fmtNumber(r.fuel_litres, 1)} L · {fmtMoney(r.fuel_cost, school.currency)}</div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function DriverSheet() {
  const { planId, routeId } = useParams();
  const { t } = useTranslation();
  const { base, school } = useAuth();
  const { data, loading } = useFetch(base ? `${base}/transport/plans/` : null);
  if (loading) return <Loading />;
  const plan = (data || []).find((p) => String(p.id) === planId);
  const r = plan?.routes.find((x) => String(x.id) === routeId);
  if (!r) return <EmptyState title={t("Route not found")} />;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-3 flex justify-end"><Button icon={Printer} onClick={() => window.print()}>{t("Print")}</Button></div>
      <div className="print-page rounded-xl border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-bold">{school.name} - {r.bus}</h1>
        <p className="mb-4 text-sm text-slate-600">{plan.direction === "morning" ? t("Morning") : t("Afternoon")} · {fmtTime(r.depart)} → {fmtTime(r.arrive)} · {fmtNumber(r.km, 1)} km · {t("{{n}} children", { n: r.students })}</p>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-300"><th className="py-1 text-start">#</th><th className="text-start">{t("Time")}</th><th className="text-start">{t("Stop")}</th><th className="text-start">{t("Children")}</th><th className="text-start">✓</th></tr></thead>
          <tbody>{r.stops.map((st) => (
            <tr key={st.order} className="border-b border-slate-100 align-top"><td className="py-1.5">{st.order}</td><td>{fmtTime(st.eta)}</td>
              <td>{st.is_school ? <b>{st.label}</b> : st.label}</td><td>{st.students.join(", ")}</td><td className="w-10">{!st.is_school && "☐"}</td></tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}

function LiveOverview() {
  const { t } = useTranslation();
  const { base, school } = useAuth();
  const { data, loading } = useFetch(`${base}/transport/live/`, { poll: 10000 });
  if (loading) return <Loading />;
  const live = (data || []).filter((r) => r.lat != null);
  return (
    <div className="space-y-3">
      <LiveMap school={{ lat: school.latitude, lng: school.longitude }} height={420}
               extra={live.map((r, i) => ({ key: r.run_id, lat: r.lat, lng: r.lng, label: `🚌 ${r.bus}`, color: COLORS[i % COLORS.length] }))} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(data || []).map((r) => (
        <div key={r.run_id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <div className="flex justify-between"><b>{r.bus}</b><Badge tone={r.status === "active" ? "green" : "gray"}>{busStatusLabel(t, r.status)}</Badge></div>
          <div className="text-slate-500">{r.direction === "morning" ? t("Morning") : t("Afternoon")} · {t("stop {{n}} of {{m}}", { n: r.next_stop_order, m: r.stops })}</div>
          {r.delay_minutes > 0 && <div className="text-amber-700">{t("Running {{n}} min late", { n: r.delay_minutes })}</div>}
          {r.last_seen && <div className="text-xs text-slate-400">{fmtDateTime(r.last_seen)}</div>}
        </div>))}
        {!data?.length && <p className="text-sm text-slate-500">{t("No buses running right now.")}</p>}</div>
    </div>
  );
}

function Buses() {
  const { t } = useTranslation();
  return (
    <ResourcePage title="" path="transport/buses" defaults={{ capacity: 30, fuel_l_per_100km: 18, fuel_price_per_l: "0.900", is_active: true }}
      columns={[{ key: "name", label: t("Bus") }, { key: "plate", label: t("Plate") }, { key: "capacity", label: t("Seats") },
        { key: "driver_name", label: t("Driver"), render: (b) => <span>{b.driver_name} {b.driver ? <Badge tone="green">{t("Uses the app")}</Badge> : <Link to="/people" className="text-xs text-brand">{t("Invite driver")}</Link>}</span> },
        { key: "is_active", label: t("Active"), render: (b) => (b.is_active ? "✓" : "") }]}
      fields={[{ name: "name", label: t("Name"), required: true }, { name: "plate", label: t("Plate number") }, { name: "capacity", label: t("Seats"), type: "number" },
        { name: "driver_name", label: t("Driver name") }, { name: "driver_phone", label: t("Driver phone"), type: "tel" },
        { name: "fuel_l_per_100km", label: t("Fuel use (L / 100 km)"), type: "number", step: "0.1" },
        { name: "fuel_price_per_l", label: t("Fuel price per litre"), type: "number", step: "0.001" }, { name: "is_active", label: t("Active"), type: "checkbox" }]}
    />
  );
}

function TransportSettings() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, setData } = useFetch(`${base}/transport/settings/`);
  const [run, busy] = useAction();
  if (loading || !data) return <Loading />;
  const set = (k) => (e) => setData({ ...data, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.type === "number" ? Number(e.target.value) : e.target.value });
  const save = async () => { const r = await run(() => api.put(`${base}/transport/settings/`, data), t("Saved")); setData(r.data); };
  return (
    <Card actions={<Button onClick={save} loading={busy}>{t("Save")}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input label={t("School starts at")} type="time" value={data.school_start_time?.slice(0, 5)} onChange={set("school_start_time")} />
        <Input label={t("Arrive this many minutes early")} type="number" value={data.arrival_buffer_minutes} onChange={set("arrival_buffer_minutes")} />
        <Input label={t("Maximum ride per child (minutes)")} type="number" value={data.max_ride_minutes} onChange={set("max_ride_minutes")} />
        <Input label={t("Minutes per stop")} type="number" step="0.25" value={data.stop_minutes} onChange={set("stop_minutes")} />
        <Input label={t("Afternoon wave window (minutes)")} type="number" value={data.afternoon_wave_minutes} onChange={set("afternoon_wave_minutes")} hint={t("Children leaving within this many minutes share one departure.")} />
        <Input label={t("Optimizer time (seconds)")} type="number" value={data.solver_seconds} onChange={set("solver_seconds")} />
        <Input label={t("Weight: kilometres")} type="number" value={data.weight_distance} onChange={set("weight_distance")} hint={t("Higher = save fuel")} />
        <Input label={t("Weight: time children spend on the bus")} type="number" value={data.weight_ride_time} onChange={set("weight_ride_time")} hint={t("Higher = shorter rides")} />
        <Select label={t("Road distances from")} value={data.provider} onChange={set("provider")} options={[
          { value: "osrm", label: "OpenStreetMap (OSRM)" }, { value: "ors", label: "OpenRouteService" }, { value: "google", label: "Google Routes" },
          { value: "haversine", label: t("Straight-line estimate") }]} />
        <Input label={t("Notify parents when the bus is this many minutes away")} type="number" value={data.eta_notify_minutes} onChange={set("eta_notify_minutes")} />
        <Input label={t("Tell parents the bus is late after (minutes)")} type="number" value={data.late_notify_minutes} onChange={set("late_notify_minutes")} />
        <Input label={t("Keep GPS history for (days)")} type="number" value={data.location_retention_days} onChange={set("location_retention_days")} />
        <Checkbox label={t("Brothers and sisters share one stop")} checked={data.siblings_share_stop} onChange={set("siblings_share_stop")} />
        <Checkbox label={t("Children may walk to a nearby shared stop")} checked={data.walk_to_stop} onChange={set("walk_to_stop")} />
        <Input label={t("Walking distance to a stop (metres)")} type="number" value={data.walk_radius_m} onChange={set("walk_radius_m")} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- driver app
export function DriverApp() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, error, reload, setData } = useFetch(base ? `${base}/driver/today/` : null);
  const [runId, setRunId] = useState(null);
  const run = (data?.runs || []).find((r) => r.run_id === runId) || (data?.runs || []).find((r) => r.status === "active") || (data?.runs || [])[0];
  const [act, busy] = useAction();
  const [gps, setGps] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  const watch = useRef(null);
  const wake = useRef(null);

  const replace = useCallback((payload) => setData((d) => ({ runs: d.runs.map((r) => (r.run_id === payload.run_id ? payload : r)) })), [setData]);
  const post = useCallback((action, body) => api.post(`${base}/driver/runs/${run.run_id}/${action}/`, body || {}), [base, run]);

  const stopTracking = useCallback(() => {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    wake.current?.release?.().catch(() => {});
    wake.current = null;
  }, []);

  const startTracking = useCallback(async () => {
    if (!("geolocation" in navigator)) { setGpsError(t("This phone cannot share its location.")); return; }
    try { wake.current = await navigator.wakeLock?.request("screen"); } catch { /* not supported */ }
    let last = 0;
    watch.current = navigator.geolocation.watchPosition(async (pos) => {
      setGps(pos.coords);
      setGpsError(null);
      if (Date.now() - last < 10000) return;
      last = Date.now();
      try { await post("location", { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); } catch (e) { setGpsError(errorText(e)); }
    }, (e) => setGpsError(e.code === 1 ? t("Location permission is blocked. Allow it in the browser settings.") : t("Waiting for GPS...")),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }, [post, t]);

  useEffect(() => {
    if (run?.status === "active" && watch.current == null) startTracking();
    if (run?.status !== "active") stopTracking();
    const onVisible = async () => { if (document.visibilityState === "visible" && run?.status === "active") { try { wake.current = await navigator.wakeLock?.request("screen"); } catch { /* ignore */ } } };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [run?.status, startTracking, stopTracking]);
  useEffect(() => stopTracking, [stopTracking]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!run) return <EmptyState icon={Bus} title={t("No route for you today")} text={t("Ask the school to assign you to a bus.")} />;
  const stops = run.stops;
  const next = stops.find((s) => s.order >= run.next_stop_order && !s.is_school) || stops.find((s) => s.order >= run.next_stop_order);
  const doAct = async (action, body) => { const r = await act(() => post(action, body)); replace(r.data); };
  const mark = (stop, student, kind) => doAct("event", { stop: stop.id, student: student.id, kind });
  const kindFor = run.direction === "morning" ? "picked_up" : "dropped_off";

  return (
    <div className="mx-auto max-w-lg space-y-3 pb-6">
      {data.runs.length > 1 && <Select value={run.run_id} onChange={(e) => setRunId(Number(e.target.value))}
                                       options={data.runs.map((r) => ({ value: r.run_id, label: `${r.direction === "morning" ? t("Morning") : t("Afternoon")} ${fmtTime(r.depart)} · ${r.bus}` }))} />}
      <Card title={`${run.bus} · ${run.direction === "morning" ? t("Morning") : t("Afternoon")}`} actions={<Badge tone={run.status === "active" ? "green" : "gray"}>{busStatusLabel(t, run.status)}</Badge>}>
        <div className="text-sm text-slate-600">{fmtTime(run.depart)} → {fmtTime(run.arrive)} · {fmtNumber(run.total_km, 1)} km {run.delay_minutes > 0 && <Badge tone="yellow">{t("{{n}} min late", { n: run.delay_minutes })}</Badge>}</div>
        {run.status === "planned" && <Button size="lg" className="mt-3 w-full" icon={Play} loading={busy} onClick={() => doAct("start")}>{t("Start route")}</Button>}
        {run.status === "active" && (
          <div className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            {t("Keep this page open while driving - phones stop sharing location when the app is closed or the screen locks.")}
            <div className="mt-1">{gps ? t("GPS on (accuracy {{m}} m)", { m: Math.round(gps.accuracy) }) : gpsError || t("Waiting for GPS...")}</div>
          </div>
        )}
      </Card>
      {run.status === "active" && next && (
        <Card title={t("Next stop")}>
          <div className="text-lg font-semibold">{next.order}. {next.label}</div>
          <div className="text-sm text-slate-500">{t("Planned")} {fmtTime(next.eta)}</div>
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${next.lat},${next.lng}&travelmode=driving`} target="_blank" rel="noreferrer">
            <Button className="mt-2 w-full" variant="secondary" icon={Navigation}>{t("Navigate")}</Button></a>
          <ul className="mt-3 space-y-2">{next.students.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <span className="font-medium">{s.name}</span>
              {s.status ? <Badge tone={s.status === "absent" ? "red" : "green"}>{busStatusLabel(t, s.status)}</Badge> : (
                <span className="flex gap-1">
                  <Button size="sm" icon={CheckCircle2} onClick={() => mark(next, s, kindFor)}>{kindFor === "picked_up" ? t("Picked up") : t("Dropped off")}</Button>
                  <Button size="sm" variant="secondary" icon={UserX} onClick={() => mark(next, s, "absent")}>{t("Absent")}</Button>
                </span>)}
            </li>))}</ul>
          <Button className="mt-3 w-full" variant="secondary" onClick={() => doAct("arrived", { stop: next.id })}>{t("Done - go to next stop")}</Button>
        </Card>
      )}
      <Card title={t("All stops")} padded={false}>
        <ol className="divide-y divide-slate-100">{stops.map((s) => (
          <li key={s.id} className={cx("flex items-start justify-between gap-2 px-4 py-2 text-sm", s.order < run.next_stop_order && "opacity-50")}>
            <div><div className="font-medium">{s.order}. {s.label}</div><div className="text-xs text-slate-500">{s.students.map((k) => k.name).join(", ")}</div></div>
            <span className="shrink-0 text-slate-500">{fmtTime(s.eta)}</span>
          </li>))}</ol>
      </Card>
      {run.status === "active" && <Button variant="danger" className="w-full" icon={Square} onClick={() => doAct("finish")}>{t("Finish route")}</Button>}
    </div>
  );
}
