import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlarmClock, AlertTriangle, BellRing, CheckCircle2, ChevronRight, Circle, ClipboardCheck, Megaphone, Users,
  UserX, Wallet,
} from "lucide-react";
import api from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useAction, useFetch } from "../lib/hooks";
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from "../lib/format";
import { moduleLabel, schoolStatusLabel } from "../lib/labels";
import { Badge, Button, Card, DataTable, EmptyState, ErrorBox, Input, Loading, Modal, PageHeader, Select, Stat } from "../components/ui";
import { setLanguage } from "../i18n";

export function Dashboard() {
  const { t } = useTranslation();
  const auth = useAuth();
  const { data, loading, error, reload } = useFetch(auth.base ? `${auth.base}/dashboard/` : null);
  if (!auth.school) return auth.isOwner ? <Navigate to="/owner" replace /> : <NoSchool />;
  if (auth.roles.size === 1 && auth.hasRole("driver")) return <Navigate to="/driver" replace />;
  if (!auth.isStaff && auth.hasRole("parent")) return <Navigate to="/children" replace />;
  if (loading && !data) return <Loading />;
  return (
    <div className="space-y-6">
      <PageHeader title={t("Good day, {{name}}", { name: auth.me?.first_name || "" })} subtitle={fmtDate(data?.date, { weekday: "long", day: "numeric", month: "long" })} />
      <ErrorBox error={error} onRetry={reload} />
      {data?.admin && <AdminDashboard d={data.admin} />}
      {data?.teacher && <TeacherDashboard d={data.teacher} />}
    </div>
  );
}

function NoSchool() {
  const { t } = useTranslation();
  return (
    <EmptyState title={t("You are not part of a school yet")} text={t("Register your school, or ask your school for an invitation code.")}
                action={<div className="flex gap-2"><Link to="/join"><Button variant="secondary">{t("I have an invitation code")}</Button></Link>
                  <Link to="/new-school"><Button>{t("Register a school")}</Button></Link></div>} />
  );
}

function AdminDashboard({ d }) {
  const { t } = useTranslation();
  const { school } = useAuth();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Users} label={t("Students")} value={fmtNumber(d.students)} hint={t("of {{max}} in your plan", { max: fmtNumber(d.max_students) })} />
        <Stat icon={UserX} tone="yellow" label={t("Students absent today")} value={fmtNumber(d.students_absent_today)}
              hint={d.absence_reports_today ? t("{{n}} reported by parents", { n: d.absence_reports_today }) : null} />
        <Stat icon={AlarmClock} tone={d.uncovered_lessons ? "red" : "green"} label={t("Lessons without a cover")} value={fmtNumber(d.uncovered_lessons)}
              hint={t("{{n}} teacher(s) absent", { n: d.teachers_absent_today.length })} />
        {d.overdue_fees ? <Stat icon={Wallet} tone="red" label={t("Families with overdue fees")} value={fmtNumber(d.overdue_fees.count)}
                                hint={fmtMoney(d.overdue_fees.amount, school.currency)} /> :
          <Stat icon={Megaphone} label={t("Open parent messages")} value={fmtNumber(d.open_messages)} />}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("Teachers absent today")} actions={<Link to="/substitutes" className="text-sm text-brand">{t("Arrange covers")}</Link>}>
          {d.teachers_absent_today.length ? (
            <ul className="space-y-1 text-sm">{d.teachers_absent_today.map((a) => (
              <li key={a.id}><Link to={`/substitutes/${a.id}`} className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-50">{a.teacher}<ChevronRight className="h-4 w-4 rtl:rotate-180" /></Link></li>))}</ul>
          ) : <p className="text-sm text-slate-500">{t("Everyone is in today.")}</p>}
        </Card>
        <Card title={t("Students at risk")} actions={<Link to="/at-risk" className="text-sm text-brand">{t("See all")}</Link>}>
          {d.at_risk.length ? (
            <ul className="space-y-2 text-sm">{d.at_risk.slice(0, 6).map((r) => (
              <li key={r.student_id} className="flex items-start justify-between gap-2">
                <span><span className="font-medium">{r.student}</span> <span className="text-slate-400">{r.group}</span></span>
                <span className="text-end text-xs text-red-700">{r.reasons.map((x) => x.text).join(" · ")}</span>
              </li>))}</ul>
          ) : <p className="text-sm text-slate-500">{t("No warning signs right now.")}</p>}
        </Card>
        <Card title={t("Coming up")}>
          {d.upcoming_events.length ? (
            <ul className="space-y-1 text-sm">{d.upcoming_events.map((e) => (
              <li key={e.id} className="flex justify-between"><span>{e.title}</span><span className="text-slate-500">{fmtDate(e.start_date)}</span></li>))}</ul>
          ) : <p className="text-sm text-slate-500">{t("Nothing on the calendar.")}</p>}
        </Card>
        <Card title={t("Recent announcements")} actions={<Link to="/announcements" className="text-sm text-brand">{t("New announcement")}</Link>}>
          {d.recent_announcements.length ? (
            <ul className="space-y-1 text-sm">{d.recent_announcements.map((a) => (
              <li key={a.id} className="flex justify-between gap-2"><span className="truncate">{a.title}</span>
                <span className="shrink-0 text-slate-500">{a.sent_at ? fmtDateTime(a.sent_at) : <Badge tone="yellow">{t("Scheduled")}</Badge>}</span></li>))}</ul>
          ) : <p className="text-sm text-slate-500">{t("No announcements yet.")}</p>}
        </Card>
      </div>
    </div>
  );
}

function TeacherDashboard({ d }) {
  const { t } = useTranslation();
  if (!d.linked) {
    return <ErrorBox error={t("Your account is not linked to a teacher record yet. Ask the school admin to send you a teacher invitation.")} />;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t("My lessons today")} actions={<Badge tone={d.attendance_to_take ? "yellow" : "green"}>{t("{{n}} attendance to take", { n: d.attendance_to_take })}</Badge>}>
        {d.lessons_today.length ? (
          <ul className="divide-y divide-slate-100">
            {d.lessons_today.map((l) => (
              <li key={`${l.entry}-${l.period_id}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div><div className="font-medium">{l.start} · {l.subject} {l.is_cover && <Badge tone="purple">{t("Cover")}</Badge>}</div>
                  <div className="text-slate-500">{l.group} · {l.room}</div></div>
                <Link to={`/attendance/take?group=${l.group_id}&period=${l.period_id}`}>
                  <Button size="sm" variant={l.attendance_taken ? "secondary" : "primary"} icon={l.attendance_taken ? CheckCircle2 : ClipboardCheck}>
                    {l.attendance_taken ? t("Taken") : t("Take attendance")}
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">{t("No lessons today.")}</p>}
      </Card>
      <Card title={t("Homework this week")} actions={<Link to="/homework" className="text-sm text-brand">{t("Set homework")}</Link>}>
        {d.homework_this_week.length ? (
          <ul className="space-y-1 text-sm">{d.homework_this_week.map((h) => (
            <li key={h.id} className="flex justify-between gap-2"><span>{h.group_name} · {h.title}</span><span className="text-slate-500">{fmtDate(h.due_date)}</span></li>))}</ul>
        ) : <p className="text-sm text-slate-500">{t("No homework set this week.")}</p>}
        <p className="mt-3 text-xs text-slate-500">{t("Covers this week: {{n}}", { n: d.covers_this_week })}</p>
      </Card>
    </div>
  );
}

const STEP_LABELS = (t) => ({
  profile: [t("School profile"), t("Address, phone, logo and colours")],
  schedule: [t("Bell schedule"), t("Lesson periods and breaks")],
  subjects: [t("Subjects"), t("What is taught, and which need a lab")],
  classrooms: [t("Rooms"), t("Classrooms, labs, sports areas")],
  teachers: [t("Teachers"), t("Who teaches what - or import from Excel")],
  groups: [t("Class groups"), t("Grades and sections")],
  requirements: [t("Weekly lessons"), t("How many lessons of each subject per group")],
  students: [t("Students"), t("Add or import students and parents")],
  parents: [t("Invite parents"), t("Send join codes so parents can log in")],
  timetable: [t("Generate the timetable"), t("Let the optimizer build it")],
});

export function Setup() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, error, reload } = useFetch(base ? `${base}/setup/` : null);
  if (loading) return <Loading />;
  const labels = STEP_LABELS(t);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("Set up your school")} subtitle={t("{{done}} of {{total}} steps done", { done: data?.done || 0, total: data?.total || 10 })} />
      <ErrorBox error={error} onRetry={reload} />
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-brand transition-all" style={{ width: `${((data?.done || 0) / (data?.total || 10)) * 100}%` }} />
      </div>
      <ol className="space-y-2">
        {data?.steps.map((s, i) => (
          <li key={s.key}>
            <Link to={`/${s.page === "school" ? "settings" : s.page === "invitations" ? "people" : s.page}`}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:border-brand">
              {s.done ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <Circle className="h-6 w-6 text-slate-300" />}
              <div className="flex-1">
                <div className="font-medium">{i + 1}. {labels[s.key]?.[0]}</div>
                <div className="text-sm text-slate-500">{labels[s.key]?.[1]}</div>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-400 rtl:rotate-180" />
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-slate-500">{t("Tip: you can import teachers, rooms, class groups and students from Excel in one go.")} <Link to="/import" className="text-brand">{t("Import from Excel")}</Link></p>
    </div>
  );
}

export function Notifications() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useFetch("/notifications/");
  const [run] = useAction();
  const markAll = async () => { await run(() => api.post("/notifications/", { all: true })); reload(); };
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("Notifications")} actions={data?.unread > 0 && <Button variant="secondary" onClick={markAll}>{t("Mark all as read")}</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : data?.items.length ? (
        <ul className="space-y-2">
          {data.items.map((n) => (
            <li key={n.id} className={`rounded-xl border p-3 ${n.read_at ? "border-slate-200 bg-white" : "border-brand/30 bg-brand/5"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">{n.title}</div>
                <span className="shrink-0 text-xs text-slate-500">{fmtDateTime(n.created_at)}</span>
              </div>
              {n.body && <p className="mt-1 text-sm text-slate-600">{n.body}</p>}
              <div className="mt-1 flex justify-between text-xs text-slate-400"><span>{n.school}</span>{n.link && <Link to={n.link} className="text-brand">{t("Open")}</Link>}</div>
            </li>
          ))}
        </ul>
      ) : <EmptyState icon={BellRing} title={t("No notifications")} />}
    </div>
  );
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("unsupported");
  const { data } = await api.get("/push/");
  if (!data.vapid_public_key) throw new Error("not-configured");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("denied");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(data.vapid_public_key) });
  await api.post("/push/subscribe/", sub.toJSON());
}

export function Profile() {
  const { t, i18n } = useTranslation();
  const { me, loadMe, schools } = useAuth();
  const [form, setForm] = useState({ first_name: me?.first_name || "", last_name: me?.last_name || "", phone: me?.phone || "" });
  const [run, busy] = useAction();
  const [pushState, setPushState] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const save = async () => { await run(() => api.patch("/me/", { ...form, language: i18n.language }), t("Saved")); loadMe(); };
  const turnOnPush = async () => {
    try {
      await enablePush();
      setPushState("granted");
      toastOk(t("Notifications are on for this device."));
    } catch (e) {
      setPushState(e.message === "denied" ? "denied" : pushState);
      window.alert(e.message === "denied" ? t("Notifications are blocked in your browser settings.") :
        e.message === "unsupported" ? t("This browser does not support notifications. On iPhone, add the app to your home screen first.") :
          t("Notifications are not available yet."));
    }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={t("My profile")} subtitle={me?.email} />
      <Card title={t("Details")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t("First name")} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <Input label={t("Last name")} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <Input label={t("Phone")} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Select label={t("Language")} value={i18n.language} onChange={(e) => setLanguage(e.target.value)}
                  options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={save} loading={busy}>{t("Save")}</Button></div>
      </Card>
      <Card title={t("Notifications on this phone")}>
        <p className="mb-3 text-sm text-slate-600">{t("Get absence alerts, bus arrival messages and announcements even when the app is closed.")}</p>
        {pushState === "granted" ? <Badge tone="green">{t("On")}</Badge> :
          <Button onClick={turnOnPush}>{t("Turn on notifications")}</Button>}
      </Card>
      <Card title={t("My schools")}>
        <ul className="space-y-1 text-sm">{schools.map((s) => (
          <li key={s.school_id} className="flex justify-between"><span>{s.name}</span><span className="text-slate-500">{s.roles.length} {t("role(s)")}</span></li>))}</ul>
        <div className="mt-3 flex gap-2"><Link to="/join"><Button variant="secondary" size="sm">{t("Join another school")}</Button></Link>
          <Link to="/new-school"><Button variant="secondary" size="sm">{t("Register a school")}</Button></Link></div>
      </Card>
    </div>
  );
}

function toastOk(msg) {
  import("react-hot-toast").then((m) => m.default.success(msg));
}

export function NewSchool() {
  const { t } = useTranslation();
  const { loadMe, switchSchool } = useAuth();
  const [name, setName] = useState("");
  const [run, busy] = useAction();
  const create = async () => {
    const res = await run(() => api.post("/schools/", { name }), t("Created"));
    await loadMe();
    switchSchool(res.data.id);
    window.location.assign("/setup");
  };
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={t("Register a school")} subtitle={t("You will be its admin. A 30-day free trial starts now.")} />
      <Card><Input label={t("School name")} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="mt-3 flex justify-end"><Button onClick={create} loading={busy} disabled={!name.trim()}>{t("Create")}</Button></div></Card>
    </div>
  );
}

export function OwnerPanel() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useFetch("/platform/schools/");
  const { data: plans } = useFetch("/plans/");
  const [run] = useAction();
  const [target, setTarget] = useState(null);
  const act = async (id, action, body) => { await run(() => api.post(`/platform/schools/${id}/${action}/`, body || {}), t("Saved")); reload(); };
  if (loading) return <Loading />;
  const totals = data?.totals;
  return (
    <div className="space-y-4">
      <PageHeader title={t("Owner panel")} subtitle={t("All schools on the platform. Totals only - no children's data.")} />
      <ErrorBox error={error} onRetry={reload} />
      {totals && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label={t("Schools")} value={fmtNumber(totals.schools)} />
          <Stat label={t("Students")} value={fmtNumber(totals.students)} />
          <Stat tone="yellow" label={t("On trial")} value={fmtNumber(totals.by_status.trial)} />
          <Stat tone="green" label={t("Active")} value={fmtNumber(totals.by_status.active)} />
          <Stat tone="red" label={t("Suspended")} value={fmtNumber(totals.by_status.suspended)} hint={`${t("Monthly revenue")}: ${fmtMoney(totals.monthly_revenue_jod)}`} />
        </div>
      )}
      <DataTable rows={data?.schools || []} columns={[
        { key: "name", label: t("School"), render: (s) => <div><div className="font-medium">{s.name}</div><div className="text-xs text-slate-500">{s.city} · {s.admins.join(", ")}</div></div> },
        { key: "status", label: t("Status"), render: (s) => <Badge tone={{ trial: "yellow", active: "green", suspended: "red" }[s.status]}>{schoolStatusLabel(t, s.status)}</Badge> },
        { key: "plan", label: t("Plan"), render: (s) => s.plan_name },
        { key: "students", label: t("Students"), render: (s) => `${fmtNumber(s.students)} / ${fmtNumber(s.max_students)}` },
        { key: "teachers", label: t("Teachers"), render: (s) => fmtNumber(s.teachers) },
        { key: "trial_ends_at", label: t("Trial ends"), render: (s) => s.status === "trial" ? fmtDate(s.trial_ends_at) : "" },
        { key: "actions", label: "", render: (s) => <Button size="sm" variant="secondary" onClick={() => setTarget(s)}>{t("Manage")}</Button> },
      ]} />
      <Modal open={!!target} onClose={() => setTarget(null)} title={target?.name}>
        {target && (
          <div className="space-y-3">
            <Select label={t("Plan")} value={target.plan || ""} onChange={(e) => { act(target.id, "set-plan", { plan: e.target.value }); setTarget(null); }}
                    options={(plans?.plans || []).map((p) => ({ value: p.code, label: `${p.name} - ${fmtNumber(p.max_students)} ${t("students")}` }))} />
            <p className="text-xs text-slate-500">{(plans?.plans || []).find((p) => p.code === target.plan)?.modules.map((m) => moduleLabel(t, m)).join(" · ")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => { act(target.id, "extend-trial", { days: 14 }); setTarget(null); }}>{t("Extend trial by 14 days")}</Button>
              {target.status === "suspended" ? (
                <Button variant="success" onClick={() => { act(target.id, "activate"); setTarget(null); }}>{t("Re-activate")}</Button>
              ) : (
                <Button variant="danger" icon={AlertTriangle} onClick={() => {
                  const reason = window.prompt(t("Reason for suspending (shown to the school's admins)"));
                  if (reason !== null) { act(target.id, "suspend", { reason }); setTarget(null); }
                }}>{t("Suspend school")}</Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
