import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ClipboardCheck, DoorOpen, FileDown, Plus, Undo2, UserCheck } from "lucide-react";
import api, { download } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useAction, useFetch } from "../lib/hooks";
import { addDays, fmtDate, fmtNumber, fmtTime, todayISO } from "../lib/format";
import { attendanceLabel, pickupModeLabel } from "../lib/labels";
import { Badge, Button, Card, DataTable, EmptyState, ErrorBox, Input, Loading, Modal, PageHeader, Select, Stat, Tabs, Textarea, cx } from "../components/ui";

export function Today() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const [day, setDay] = useState(todayISO());
  const { data, loading, error, reload } = useFetch(base ? `${base}/teacher/today/` : null, { params: { date: day } });
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("My lessons")} subtitle={data?.teacher} actions={<Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />} />
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : data?.lessons?.length ? (
        <ul className="space-y-2">{data.lessons.map((l) => (
          <li key={`${l.entry}-${l.period_id}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <div><div className="font-semibold">{fmtTime(l.start)} · {l.subject} {l.is_cover && <Badge tone="purple">{t("Cover")}</Badge>}</div>
              <div className="text-sm text-slate-500">{l.group} · {l.room}</div></div>
            <Link to={`/attendance/take?group=${l.group_id}&period=${l.period_id}&date=${day}`}>
              <Button size="sm" variant={l.attendance_taken ? "secondary" : "primary"} icon={l.attendance_taken ? CheckCircle2 : ClipboardCheck}>
                {l.attendance_taken ? t("Taken") : t("Attendance")}</Button></Link>
          </li>))}</ul>
      ) : <EmptyState title={data?.teacher === null ? t("Your account is not linked to a teacher record yet.") : t("No lessons on this day.")} />}
    </div>
  );
}

const STATUS_STYLE = {
  present: "bg-emerald-600 text-white", absent: "bg-red-600 text-white", late: "bg-amber-500 text-white", excused: "bg-slate-500 text-white",
};

export function TakeAttendance() {
  const { t } = useTranslation();
  const { base, school } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const perDay = school?.attendance_mode === "day";
  const query = { group: params.get("group"), date: params.get("date") || todayISO(), ...(perDay ? {} : { period: params.get("period") }) };
  const { data, loading, error } = useFetch(base && query.group ? `${base}/attendance/sheet/` : null, { params: query });
  const [marks, setMarks] = useState({});
  const [run, busy] = useAction();
  useEffect(() => {
    if (data) setMarks(Object.fromEntries(data.students.map((s) => [s.id, s.status || "present"])));
  }, [data]);
  const cycle = (id) => setMarks((m) => ({ ...m, [id]: { present: "absent", absent: "late", late: "excused", excused: "present" }[m[id]] }));
  const save = async () => {
    const res = await run(() => api.post(`${base}/attendance/sheet/`, { ...query, records: Object.entries(marks).map(([student, status]) => ({ student: Number(student), status })) }), t("Attendance saved"));
    if (res.data.parents_notified) window.alert(t("{{n}} parent(s) were notified.", { n: res.data.parents_notified }));
    navigate(-1);
  };
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return <EmptyState title={t("Choose a lesson from 'My lessons' first.")} />;
  const counts = Object.values(marks).reduce((c, s) => ({ ...c, [s]: (c[s] || 0) + 1 }), {});
  return (
    <div className="mx-auto max-w-xl pb-20">
      <PageHeader title={data.group} subtitle={`${fmtDate(data.date, { weekday: "long", day: "numeric", month: "long" })}${data.period ? ` · ${data.period}` : ""}`} />
      <p className="mb-3 text-sm text-slate-500">{t("Everyone starts as present. Tap a name to switch: absent → late → excused → present.")}</p>
      <ul className="space-y-2">{data.students.map((s) => (
        <li key={s.id}><button type="button" onClick={() => cycle(s.id)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-start active:scale-[0.99]">
          <span className="font-medium">{s.name} {s.reported_absent && <Badge tone="yellow">{t("Parent reported")}</Badge>}</span>
          <span className={cx("rounded-full px-3 py-1 text-sm font-semibold", STATUS_STYLE[marks[s.id]])}>{attendanceLabel(t, marks[s.id])}</span>
        </button></li>))}</ul>
      <div className="fixed inset-x-0 bottom-16 z-20 border-t border-slate-200 bg-white p-3 lg:bottom-0">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-2">
          <span className="text-sm text-slate-600">{["present", "absent", "late"].map((k) => `${attendanceLabel(t, k)}: ${counts[k] || 0}`).join(" · ")}</span>
          <Button size="lg" icon={UserCheck} onClick={save} loading={busy}>{t("Save")}</Button>
        </div>
      </div>
    </div>
  );
}

export function Attendance() {
  const { t } = useTranslation();
  const { base, isManager } = useAuth();
  const [tab, setTab] = useState("daily");
  const [day, setDay] = useState(todayISO());
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const daily = useFetch(base && tab === "daily" ? `${base}/attendance/report/` : null, { params: { kind: "daily", date: day } });
  const monthly = useFetch(base && tab === "monthly" ? `${base}/attendance/report/` : null, { params: { kind: "monthly", month } });
  const reports = useFetch(base && tab === "reports" ? `${base}/absence-reports/` : null);
  return (
    <div className="space-y-4">
      <PageHeader title={t("Attendance")} actions={<>
        <Link to="/today"><Button variant="secondary" icon={ClipboardCheck}>{t("Take attendance")}</Button></Link>
        <Button variant="secondary" icon={FileDown} onClick={() => download(`${base}/export/attendance/?from=${addDays(todayISO(), -30)}&to=${todayISO()}`, "attendance.xlsx")}>{t("Excel")}</Button>
      </>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "daily", label: t("Today") }, { value: "monthly", label: t("Monthly") }, { value: "reports", label: t("Reported by parents") }]} />
      {tab === "daily" && (
        <div className="space-y-3">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="max-w-xs" />
          {daily.loading ? <Loading /> : (
            <DataTable rowKey="group" rows={daily.data?.groups || []} empty={<EmptyState title={t("No classes")} />} columns={[
              { key: "group", label: t("Class") },
              { key: "taken", label: t("Taken"), render: (g) => g.taken ? <Badge tone="green">{t("Yes")}</Badge> : <Badge tone="yellow">{t("Not yet")}</Badge> },
              { key: "absent", label: t("Absent"), render: (g) => g.absent.map((a) => a.student).filter((v, i, arr) => arr.indexOf(v) === i).join(", ") },
              { key: "late", label: t("Late"), render: (g) => g.late.map((a) => a.student).join(", ") },
            ]} />
          )}
        </div>
      )}
      {tab === "monthly" && (
        <div className="space-y-3">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="max-w-xs" />
          {monthly.data && <p className="text-sm text-slate-600">{t("Flagged: absent more than {{n}}% of school days.", { n: monthly.data.threshold })} <Badge tone="red">{fmtNumber(monthly.data.flagged)}</Badge></p>}
          {monthly.loading ? <Loading /> : (
            <DataTable rowKey="student_id" rows={monthly.data?.students || []} columns={[
              { key: "student", label: t("Student"), render: (r) => <span className="font-medium">{r.student} {r.flagged && <Badge tone="red">{t("Flagged")}</Badge>}</span> },
              { key: "group", label: t("Class") }, { key: "days", label: t("Days recorded") }, { key: "absent", label: t("Absent") },
              { key: "late", label: t("Late") }, { key: "absence_rate", label: t("Absence %"), render: (r) => `${fmtNumber(r.absence_rate, 1)}%` },
            ]} />
          )}
        </div>
      )}
      {tab === "reports" && (reports.loading ? <Loading /> : (
        <DataTable rows={reports.data || []} empty={<EmptyState title={t("No absence reports")} />} columns={[
          { key: "student_name", label: t("Student") }, { key: "dates", label: t("Dates"), render: (r) => `${fmtDate(r.date_from)} - ${fmtDate(r.date_to)}` },
          { key: "reason", label: t("Reason") },
        ]} />
      ))}
      {!isManager && null}
    </div>
  );
}

export function ReportAbsence({ student, onClose }) {
  const { t } = useTranslation();
  const { base } = useAuth();
  const [form, setForm] = useState({ date_from: todayISO(), date_to: todayISO(), reason: "" });
  const [run, busy] = useAction();
  const send = async () => { await run(() => api.post(`${base}/absence-reports/`, { ...form, student: student.id }), t("The school has been told")); onClose(); };
  return (
    <Modal open onClose={onClose} title={`${t("Report an absence")} - ${student.full_name}`}
           footer={<Button onClick={send} loading={busy} disabled={!form.reason}>{t("Send")}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t("From")} type="date" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} />
        <Input label={t("To")} type="date" value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} />
        <Textarea className="sm:col-span-2" label={t("Reason")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      </div>
    </Modal>
  );
}

export function Substitutes() {
  const { t } = useTranslation();
  const { base, isManager } = useAuth();
  const { data: teachers } = useFetch(base ? `${base}/teachers/` : null);
  const { data, loading, error, reload } = useFetch(base ? `${base}/teacher-absences/` : null);
  const { data: load } = useFetch(base ? `${base}/covers/` : null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ teacher: "", date: todayISO(), reason: "" });
  const [run, busy] = useAction();
  const navigate = useNavigate();
  const create = async () => {
    const res = await run(() => api.post(`${base}/teacher-absences/`, { ...form, teacher: Number(form.teacher), period_ids: [] }), t("Saved"));
    setOpen(false);
    navigate(`/substitutes/${res.data.id}`);
  };
  return (
    <div className="space-y-4">
      <PageHeader title={t("Teacher absences & covers")} actions={<Button icon={Plus} onClick={() => setOpen(true)}>{t("Report an absence")}</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        {loading ? <Loading /> : (
          <DataTable rows={data || []} onRowClick={(r) => navigate(`/substitutes/${r.id}`)} empty={<EmptyState title={t("No absences recorded")} />} columns={[
            { key: "date", label: t("Date"), render: (r) => fmtDate(r.date, { weekday: "short", day: "numeric", month: "short" }) },
            { key: "teacher_name", label: t("Teacher") }, { key: "reason", label: t("Reason") },
          ]} />
        )}
        <Card title={t("Covers this week")}>
          {load?.load?.length ? <ul className="space-y-1 text-sm">{load.load.map((l) => <li key={l.teacher} className="flex justify-between"><span>{l.teacher}</span><Badge>{l.covers}</Badge></li>)}</ul>
            : <p className="text-sm text-slate-500">{t("No covers yet this week.")}</p>}
        </Card>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={t("Report an absence")}
             footer={<Button onClick={create} loading={busy} disabled={!form.teacher}>{t("Save and find covers")}</Button>}>
        <div className="grid gap-3">
          <Select label={t("Teacher")} value={form.teacher} placeholder={t("Choose")} options={(teachers || []).map((x) => ({ value: x.id, label: x.name }))}
                  onChange={(e) => setForm({ ...form, teacher: e.target.value })} disabled={!isManager && false} />
          <Input label={t("Date")} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label={t("Reason")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}

export function AbsenceDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { base, isManager } = useAuth();
  const { data, loading, error, reload } = useFetch(base ? `${base}/teacher-absences/${id}/` : null);
  const [run, busy] = useAction();
  const approve = async (entry, teacher) => { await run(() => api.post(`${base}/teacher-absences/${id}/approve/`, { entry, teacher }), t("Cover arranged - the teacher has been notified")); reload(); };
  const undo = async (entry) => { await run(() => api.post(`${base}/teacher-absences/${id}/unassign/`, { entry })); reload(); };
  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title={`${data?.teacher_name} - ${fmtDate(data?.date, { weekday: "long", day: "numeric", month: "long" })}`} subtitle={data?.reason} />
      <ErrorBox error={error} onRetry={reload} />
      {data?.lessons?.length ? data.lessons.map((l) => (
        <Card key={l.entry} title={`${l.period} · ${l.subject} · ${l.group}`} actions={l.cover && <Badge tone="green">{t("Covered by {{name}}", { name: l.cover.teacher })}</Badge>}>
          {l.cover ? (isManager && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => undo(l.entry)}>{t("Undo")}</Button>) : l.suggestions.length ? (
            <ul className="space-y-2">{l.suggestions.map((s, i) => (
              <li key={s.teacher_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-2">
                <div><div className="font-medium">{i === 0 && <Badge tone="green">{t("Best match")}</Badge>} {s.name}</div>
                  <div className="text-xs text-slate-500">{s.qualified ? t("Teaches this subject") : t("Not a subject specialist")} · {t("{{n}} cover(s) this week", { n: s.covers_this_week })} · {t("{{n}} lesson(s) today", { n: s.lessons_today })}</div></div>
                {isManager && <Button size="sm" onClick={() => approve(l.entry, s.teacher_id)} loading={busy}>{t("Approve")}</Button>}
              </li>))}</ul>
          ) : <p className="text-sm text-red-700">{t("No teacher is free in this period. Consider combining classes or a duty teacher.")}</p>}
        </Card>
      )) : <EmptyState title={t("This teacher has no lessons on that day.")} />}
    </div>
  );
}

export function Dismissal() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data: groups } = useFetch(base ? `${base}/groups/` : null);
  const [group, setGroup] = useState("");
  const { data, loading, error, reload } = useFetch(base ? `${base}/dismissal/` : null, { params: group ? { group } : {}, poll: 15000 });
  const [run] = useAction();
  const hand = async (s, undo) => { await run(() => api.post(`${base}/dismissal/`, { student: s.student, undo })); reload(); };
  return (
    <div className="space-y-4">
      <PageHeader title={t("Dismissal")} subtitle={data ? t("{{done}} of {{total}} handed over", { done: data.handed_over, total: data.total }) : ""}
                  actions={<Select value={group} onChange={(e) => setGroup(e.target.value)} placeholder={t("All classes")} options={(groups || []).map((g) => ({ value: g.id, label: g.name }))} />} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{(data?.students || []).map((s) => (
          <li key={s.student} className={cx("rounded-xl border p-3", s.handed_over_at ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white")}>
            <div className="flex items-start justify-between gap-2">
              <div><div className="font-semibold">{s.name}</div><div className="text-xs text-slate-500">{s.group}</div></div>
              <Badge tone={s.mode === "bus" ? "blue" : s.mode === "other" ? "yellow" : "gray"}>{pickupModeLabel(t, s.mode)}</Badge>
            </div>
            {s.person_name && <div className="mt-1 text-sm">{t("Pickup by")}: <b>{s.person_name}</b></div>}
            {s.note && <div className="text-xs text-slate-500">{s.note}</div>}
            <div className="mt-2 flex items-center justify-between">
              {s.handed_over_at ? <span className="text-xs text-emerald-700">{t("Handed over to {{who}}", { who: s.handed_over_to })}</span> : <span className="text-xs text-slate-400">{s.parent_confirmed ? t("Parent confirmed") : ""}</span>}
              {s.handed_over_at ? <Button size="sm" variant="ghost" icon={Undo2} onClick={() => hand(s, true)}>{t("Undo")}</Button>
                : <Button size="sm" icon={DoorOpen} onClick={() => hand(s, false)}>{t("Handed over")}</Button>}
            </div>
          </li>))}</ul>
      )}
    </div>
  );
}

export function Pickup() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, error, reload } = useFetch(base ? `${base}/my/pickup/` : null);
  const [run, busy] = useAction();
  const save = async (k, mode, person) => { await run(() => api.post(`${base}/my/pickup/`, { student: k.student, date: todayISO(), mode, person_name: person || "" }), t("The school has been told")); reload(); };
  if (loading) return <Loading />;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={t("Pickup today")} subtitle={fmtDate(todayISO(), { weekday: "long", day: "numeric", month: "long" })} />
      <ErrorBox error={error} onRetry={reload} />
      {(data || []).map((k) => {
        const current = k.notice?.mode || k.default_mode;
        return (
          <Card key={k.student} title={k.name}>
            <div className="grid grid-cols-2 gap-2">
              {["parent", "bus", "other", "walk"].map((m) => (
                <button key={m} type="button" disabled={busy || !!k.notice?.handed_over_at} onClick={() => (m === "other" ? null : save(k, m))}
                        className={cx("rounded-xl border p-3 text-sm font-medium", current === m ? "border-brand bg-brand/10 text-brand" : "border-slate-200")}>
                  {pickupModeLabel(t, m)}</button>))}
            </div>
            <div className="mt-3">
              <div className="mb-1 text-sm text-slate-600">{t("Someone else picks up:")}</div>
              <div className="flex flex-wrap gap-2">{(k.pickup_permissions || []).map((p) => (
                <Button key={p.name} size="sm" variant={k.notice?.person_name === p.name ? "primary" : "secondary"} onClick={() => save(k, "other", p.name)}>{p.name}</Button>))}</div>
              {!k.pickup_permissions?.length && <p className="text-xs text-slate-500">{t("Ask the school to add the people allowed to pick up your child.")}</p>}
            </div>
            {k.notice?.handed_over_at && <p className="mt-3 text-sm text-emerald-700">{t("Handed over to {{who}}", { who: k.notice.handed_over_to })}</p>}
          </Card>
        );
      })}
    </div>
  );
}

