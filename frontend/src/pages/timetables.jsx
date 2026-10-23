import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Eye, FileDown, Lock, Plus, Printer, Settings2, ShieldCheck, Sparkles, Unlock, Wand2 } from "lucide-react";
import api, { download } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useAction, useFetch } from "../lib/hooks";
import { dayName, fmtDate, fmtNumber, fmtTime } from "../lib/format";
import { jobStatusLabel, violationLabel, weightLabel } from "../lib/labels";
import ResourcePage from "../components/ResourcePage";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Input, Loading, Modal, PageHeader, Select, Tabs, cx } from "../components/ui";

export function Timetables() {
  const { t } = useTranslation();
  const { isManager, base } = useAuth();
  const { data: schedules } = useFetch(base ? `${base}/schedules/` : null);
  const [gen, setGen] = useState(null);
  return (
    <>
      <ResourcePage title={t("Timetables")} path="timetables" canEdit={isManager} searchable={false}
        headerActions={isManager && <Link to="/timetables/settings"><Button variant="secondary" icon={Settings2}>{t("Optimizer settings")}</Button></Link>}
        defaults={{ effective_date_start: "2026-09-01", effective_date_end: "2027-06-30", is_active: true }}
        columns={[
          { key: "name", label: t("Name"), render: (r) => <span className="font-medium">{r.name} {r.is_active && <Badge tone="green">{t("In use")}</Badge>}</span> },
          { key: "dates", label: t("Dates"), render: (r) => `${fmtDate(r.effective_date_start)} - ${fmtDate(r.effective_date_end)}` },
        ]}
        fields={[
          { name: "name", label: t("Name"), required: true },
          { name: "schedule", label: t("Bell schedule"), type: "select", numeric: true, options: (schedules || []).map((s) => ({ value: s.id, label: s.name })) },
          { name: "effective_date_start", label: t("From"), type: "date" }, { name: "effective_date_end", label: t("To"), type: "date" },
          { name: "is_active", label: t("In use (attendance, covers and dashboards use it)"), type: "checkbox" },
        ]}
        onRowClick={(r) => window.location.assign(`/timetables/${r.id}`)}
        rowActions={(r) => (
          <>
            <Link to={`/timetables/${r.id}`}><Button size="sm" variant="ghost" icon={Eye}>{t("Open")}</Button></Link>
            {isManager && <Button size="sm" variant="ghost" icon={Wand2} onClick={() => setGen(r)}>{t("Generate")}</Button>}
          </>
        )}
      />
      {gen && <GenerateModal timetable={gen} onClose={() => setGen(null)} />}
    </>
  );
}

export function GenerateModal({ timetable, onClose, onDone }) {
  const { t } = useTranslation();
  const { base } = useAuth();
  const url = `${base}/timetables/${timetable.id}`;
  const { data: groups } = useFetch(`${base}/groups/`);
  const { data: teachers } = useFetch(`${base}/teachers/`);
  const [limit, setLimit] = useState(60);
  const [onlyGroups, setOnlyGroups] = useState([]);
  const [onlyTeachers, setOnlyTeachers] = useState([]);
  const [job, setJob] = useState(null);
  const [pre, setPre] = useState(null);
  const [run, busy] = useAction();

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return undefined;
    const id = setInterval(async () => {
      const { data } = await api.get(`${url}/jobs/${job.id}/`);
      setJob(data);
      if (!["queued", "running"].includes(data.status)) onDone?.();
    }, 2000);
    return () => clearInterval(id);
  }, [job, url, onDone]);

  const start = async () => {
    try {
      const res = await run(() => api.post(`${url}/generate/`, { time_limit: limit, group_ids: onlyGroups, teacher_ids: onlyTeachers }));
      setJob(res.data);
    } catch (err) {
      if (err.response?.status === 409) setJob(err.response.data);
    }
  };
  const check = async () => { const res = await run(() => api.get(`${url}/precheck/`)); setPre(res.data); };
  const running = job && ["queued", "running"].includes(job.status);
  const result = job?.result;

  return (
    <Modal open onClose={onClose} title={`${t("Generate timetable")} - ${timetable.name}`} wide
           footer={!job || !running ? <>
             <Button variant="secondary" onClick={onClose}>{t("Close")}</Button>
             {!job || job.status !== "succeeded" ? <Button icon={Sparkles} onClick={start} loading={busy}>{t("Start")}</Button> :
               <Link to={`/timetables/${timetable.id}`}><Button icon={Eye}>{t("View timetable")}</Button></Link>}
           </> : null}>
      {!job && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t("The optimizer never breaks the rules: no teacher, class or room is double-booked, teachers only teach their subjects in their available periods, labs go to lab rooms and locked lessons stay where they are. Within those rules it finds the best timetable it can in the time allowed.")}</p>
          <Input label={t("Time limit (seconds)")} type="number" min={5} max={600} value={limit} onChange={(e) => setLimit(Number(e.target.value))}
                 hint={t("Longer usually means a better timetable. Same data and settings always give the same result.")} />
          <details className="rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-medium">{t("Regenerate only some groups or teachers (keep the rest)")}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><div className="mb-1 text-sm text-slate-600">{t("Class groups")}</div>
                <div className="max-h-48 space-y-1 overflow-y-auto">{(groups || []).map((g) => (
                  <Checkbox key={g.id} label={g.name} checked={onlyGroups.includes(g.id)}
                            onChange={(e) => setOnlyGroups(e.target.checked ? [...onlyGroups, g.id] : onlyGroups.filter((x) => x !== g.id))} />))}</div></div>
              <div><div className="mb-1 text-sm text-slate-600">{t("Teachers")}</div>
                <div className="max-h-48 space-y-1 overflow-y-auto">{(teachers || []).map((g) => (
                  <Checkbox key={g.id} label={g.name} checked={onlyTeachers.includes(g.id)}
                            onChange={(e) => setOnlyTeachers(e.target.checked ? [...onlyTeachers, g.id] : onlyTeachers.filter((x) => x !== g.id))} />))}</div></div>
            </div>
          </details>
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon={ShieldCheck} onClick={check} loading={busy}>{t("Check my data first")}</Button>
            {pre && (pre.ok ? <Badge tone="green">{t("No obvious problems found")}</Badge> : <Badge tone="red">{t("{{n}} problem(s) found", { n: pre.reasons.length })}</Badge>)}
          </div>
          {pre && !pre.ok && <ul className="list-disc space-y-1 ps-5 text-sm text-red-700">{pre.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
      )}
      {job && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm"><span>{jobStatusLabel(t, job.status)}</span><span className="text-slate-500">{job.message}</span></div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-200"><div className={cx("h-full transition-all", job.status === "failed" || job.status === "infeasible" ? "bg-red-500" : "bg-brand")} style={{ width: `${job.progress}%` }} /></div>
          {result?.score != null && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-emerald-50 p-4 text-center"><div className="text-3xl font-bold text-emerald-700">{fmtNumber(result.score, 1)}</div><div className="text-sm text-emerald-800">{t("Quality score (100 = perfect)")}</div></div>
              <div className="rounded-xl bg-slate-50 p-4 text-center"><div className="text-3xl font-bold">{fmtNumber(result.lessons)}</div><div className="text-sm text-slate-600">{t("Lessons placed")}</div></div>
              <div className="rounded-xl bg-slate-50 p-4 text-center"><div className="text-3xl font-bold">{fmtNumber(result.stats?.seconds, 0)}s</div><div className="text-sm text-slate-600">{t("Solve time")}</div></div>
            </div>
          )}
          {result?.violations && (
            <Card title={t("Soft rules not fully met")}>
              <ul className="space-y-1 text-sm">{Object.entries(result.violations).map(([k, v]) => (
                <li key={k} className="flex justify-between"><span>{violationLabel(t, k)}</span><span className="font-medium">{fmtNumber(v)}</span></li>))}</ul>
            </Card>
          )}
          {result?.reasons?.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3"><div className="mb-1 font-medium text-red-800">{t("Why no timetable could be made")}</div>
              <ul className="list-disc space-y-1 ps-5 text-sm text-red-800">{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul></div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function SolverSettings() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, setData } = useFetch(base ? `${base}/solver-settings/` : null);
  const [run, busy] = useAction();
  if (loading || !data) return <Loading />;
  const save = async () => { const r = await run(() => api.put(`${base}/solver-settings/`, { weights: data.weights, time_limit_seconds: data.time_limit_seconds }), t("Saved")); setData(r.data); };
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("Optimizer settings")} subtitle={t("How much each wish matters. 0 = ignore, higher = more important. The hard rules always apply.")}
                  actions={<Button onClick={save} loading={busy}>{t("Save")}</Button>} />
      <Card>
        <div className="space-y-4">
          {Object.entries(data.weights).map(([k, v]) => (
            <label key={k} className="block">
              <div className="flex justify-between text-sm"><span>{weightLabel(t, k)}</span><span className="font-semibold">{v}</span></div>
              <input type="range" min={0} max={30} value={v} className="w-full accent-[rgb(var(--brand-rgb))]"
                     onChange={(e) => setData({ ...data, weights: { ...data.weights, [k]: Number(e.target.value) } })} />
            </label>
          ))}
          <Input label={t("Default time limit (seconds)")} type="number" value={data.time_limit_seconds}
                 onChange={(e) => setData({ ...data, time_limit_seconds: Number(e.target.value) })} />
          <Button variant="ghost" onClick={() => setData({ ...data, weights: { ...data.defaults } })}>{t("Reset to defaults")}</Button>
        </div>
      </Card>
    </div>
  );
}

/** Read-only grid from the API's "pages" format (my timetable, child timetable). */
export function TimetableGrid({ page, days }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50"><tr><th className="p-2 text-start">{t("Period")}</th>
          {days.map((d) => <th key={d} className="p-2 text-start">{dayName(d)}</th>)}</tr></thead>
        <tbody>
          {page.periods.map((row) => (
            <tr key={row.period} className={cx("border-t border-slate-100", row.type === "break" && "bg-amber-50/60")}>
              <th className="whitespace-nowrap p-2 text-start align-top font-medium">{row.period}<div className="text-xs font-normal text-slate-400">{fmtTime(row.start)}</div></th>
              {row.days.map((c) => (
                <td key={c.day} className="min-w-[7rem] p-2 align-top">
                  {c.subject && <div className="rounded-lg bg-brand/5 p-1.5"><div className="font-medium">{c.subject}</div>
                    <div className="text-xs text-slate-500">{c.covering_teacher ? <span className="text-violet-700">{t("Cover")}: {c.covering_teacher}</span> : (c.teacher || c.student_group)}</div>
                    <div className="text-xs text-slate-400">{c.classroom || c.student_group}</div></div>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MyTimetable({ studentId }) {
  const { t } = useTranslation();
  const { base } = useAuth();
  const url = studentId ? `${base}/my/children/${studentId}/timetable/` : `${base}/my/timetable/`;
  const { data, loading, error, reload } = useFetch(base ? url : null);
  if (loading) return <Loading />;
  return (
    <div className="space-y-3">
      <PageHeader title={data?.pages?.[0]?.title?.split(": ")[1] || t("My timetable")} actions={<Button variant="secondary" icon={Printer} onClick={() => window.print()}>{t("Print")}</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      {data?.pages?.length ? <TimetableGrid page={data.pages[0]} days={data.days} /> : <EmptyState title={t("No timetable yet")} />}
    </div>
  );
}

export function TimetableEditor() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { base, isManager, school } = useAuth();
  const url = `${base}/timetables/${id}`;
  const { data: tt } = useFetch(base ? `${url}/` : null);
  const { data: entries, loading, reload } = useFetch(base ? `${url}/entries/` : null);
  const { data: schedules } = useFetch(base ? `${base}/schedules/` : null);
  const { data: groups } = useFetch(base ? `${base}/groups/` : null);
  const { data: teachers } = useFetch(base ? `${base}/teachers/` : null);
  const { data: rooms } = useFetch(base ? `${base}/classrooms/` : null);
  const { data: subjects } = useFetch(base ? `${base}/subjects/` : null);
  const [view, setView] = useState("grade");
  const [owner, setOwner] = useState("");
  const [cell, setCell] = useState(null);
  const [gen, setGen] = useState(false);
  const [run, busy] = useAction();

  const periods = useMemo(() => (schedules || []).find((s) => s.id === tt?.schedule)?.periods.slice().sort((a, b) => a.order - b.order) || [], [schedules, tt]);
  const days = school?.week_days || [7, 1, 2, 3, 4];
  const lists = { grade: groups || [], teacher: teachers || [], room: rooms || [] };
  const key = { grade: "student_group", teacher: "teacher", room: "classroom" }[view];
  const owners = lists[view];
  const current = owner || owners[0]?.id;
  const name = (list, idv) => (list || []).find((x) => x.id === idv)?.name || "";
  const mine = (entries || []).filter((e) => e[key] === Number(current));

  const toggleLock = async (e) => { await run(() => api.patch(`${url}/entries/${e.id}/`, { locked: !e.locked })); reload(); };
  const saveCell = async (form) => {
    const others = (entries || []).filter((e) => !(form.id && e.id === form.id));
    const clash = others.find((e) => e.day_of_week === form.day_of_week && e.period === form.period &&
      (e.teacher === form.teacher || e.classroom === form.classroom || e.student_group === form.student_group));
    if (clash && !window.confirm(t("This clashes with another lesson at the same time (teacher, room or class). Save anyway?"))) return;
    const list = form._delete ? others : [...others, form];
    await run(() => api.post(`${url}/bulk_update_entries/`, { entries: list.map(({ id: _id, day_name: _d, _delete, ...rest }) => rest) }), t("Saved"));
    setCell(null);
    reload();
  };

  if (loading || !tt) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title={tt.name} subtitle={t("{{n}} lessons", { n: (entries || []).length })} actions={<>
        {isManager && <Button icon={Wand2} onClick={() => setGen(true)}>{t("Generate")}</Button>}
        <Button variant="secondary" icon={FileDown} onClick={() => download(`${base}/export/timetable/?timetable=${id}&type=${view}`, `timetable-${view}.xlsx`)}>{t("Excel")}</Button>
        <Button variant="secondary" icon={Printer} onClick={() => window.print()}>{t("Print")}</Button>
      </>} />
      <div className="no-print flex flex-wrap items-end gap-2">
        <Tabs value={view} onChange={(v) => { setView(v); setOwner(""); }} tabs={[{ value: "grade", label: t("Class groups") }, { value: "teacher", label: t("Teachers") }, { value: "room", label: t("Rooms") }]} />
        <Select value={current || ""} onChange={(e) => setOwner(Number(e.target.value))} options={owners.map((o) => ({ value: o.id, label: o.name }))} className="min-w-[12rem]" />
      </div>
      {!periods.length ? <EmptyState title={t("This timetable's bell schedule has no periods yet.")} /> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white print-page">
          <h2 className="hidden p-2 text-lg font-bold print:block">{tt.name} - {name(owners, Number(current))}</h2>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="p-2 text-start">{t("Period")}</th>{days.map((d) => <th key={d} className="p-2 text-start">{dayName(d)}</th>)}</tr></thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className={cx("border-t border-slate-100", p.type === "break" && "bg-amber-50/60")}>
                  <th className="whitespace-nowrap p-2 text-start align-top font-medium">{p.name}<div className="text-xs font-normal text-slate-400">{fmtTime(p.start_time)}</div></th>
                  {days.map((d) => {
                    const e = mine.find((x) => x.day_of_week === d && x.period === p.id);
                    if (p.type === "break") return <td key={d} />;
                    return (
                      <td key={d} className="min-w-[7.5rem] p-1 align-top">
                        {e ? (
                          <button type="button" disabled={!isManager} onClick={() => setCell({ ...e })}
                                  className={cx("w-full rounded-lg p-1.5 text-start", e.locked ? "bg-amber-100" : "bg-brand/5 hover:bg-brand/10")}>
                            <div className="flex items-start justify-between gap-1 font-medium">{name(subjects, e.subject)}
                              {isManager && <span role="button" tabIndex={0} onClick={(ev) => { ev.stopPropagation(); toggleLock(e); }} className="no-print text-slate-500" title={e.locked ? t("Unlock") : t("Lock in place")}>
                                {e.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 opacity-40" />}</span>}</div>
                            <div className="text-xs text-slate-600">{view === "teacher" ? name(groups, e.student_group) : name(teachers, e.teacher)}</div>
                            <div className="text-xs text-slate-400">{view === "room" ? name(groups, e.student_group) : name(rooms, e.classroom)}</div>
                            {e.covering_teacher && <div className="text-xs text-violet-700">{t("Cover")}: {name(teachers, e.covering_teacher)}</div>}
                          </button>
                        ) : isManager && (
                          <button type="button" onClick={() => setCell({ day_of_week: d, period: p.id, [key]: Number(current), locked: false })}
                                  className="no-print flex h-12 w-full items-center justify-center rounded-lg border border-dashed border-slate-200 text-slate-300 hover:border-brand hover:text-brand"
                                  aria-label={t("Add lesson")}><Plus className="h-4 w-4" /></button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="no-print text-xs text-slate-500"><Lock className="inline h-3 w-3" /> {t("Locked lessons are kept when you generate again.")}</p>
      {cell && (
        <Modal open onClose={() => setCell(null)} title={`${dayName(cell.day_of_week)} - ${(periods.find((p) => p.id === cell.period) || {}).name || ""}`}
               footer={<>{cell.id && <Button variant="danger" onClick={() => saveCell({ ...cell, _delete: true })}>{t("Remove lesson")}</Button>}
                 <Button variant="secondary" onClick={() => setCell(null)}>{t("Cancel")}</Button>
                 <Button onClick={() => saveCell(cell)} loading={busy} disabled={!cell.subject || !cell.teacher || !cell.classroom || !cell.student_group}>{t("Save")}</Button></>}>
          <div className="grid gap-3">
            {[["student_group", t("Class group"), groups], ["subject", t("Subject"), subjects], ["teacher", t("Teacher"), teachers],
              ["classroom", t("Room"), rooms], ["covering_teacher", t("Cover teacher (this week)"), teachers]].map(([k, label, list]) => (
              <Select key={k} label={label} value={cell[k] ?? ""} placeholder="—" options={(list || []).map((x) => ({ value: x.id, label: x.name }))}
                      onChange={(e) => setCell({ ...cell, [k]: e.target.value ? Number(e.target.value) : null })} />
            ))}
            <Checkbox label={t("Lock in place (the optimizer keeps it)")} checked={!!cell.locked} onChange={(e) => setCell({ ...cell, locked: e.target.checked })} />
          </div>
        </Modal>
      )}
      {gen && <GenerateModal timetable={tt} onClose={() => setGen(false)} onDone={reload} />}
    </div>
  );
}
