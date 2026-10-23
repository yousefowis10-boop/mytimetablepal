import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bus, CalendarClock, ClipboardX, FileText, Home, MapPin, Wallet } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../lib/hooks";
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtTime, todayISO } from "../lib/format";
import { attendanceLabel, busStatusLabel, feeCategoryLabel, paymentMethodLabel } from "../lib/labels";
import { LiveMap } from "../components/maps";
import { Badge, Button, Card, DataTable, EmptyState, ErrorBox, Loading, PageHeader } from "../components/ui";
import { ReportAbsence } from "./daily";

export function Children() {
  const { t } = useTranslation();
  const { base, hasModule } = useAuth();
  const { data, loading, error, reload } = useFetch(base ? `${base}/my/children/` : null);
  const [absenceFor, setAbsenceFor] = useState(null);
  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title={t("My children")} subtitle={fmtDate(data?.date, { weekday: "long", day: "numeric", month: "long" })} />
      <ErrorBox error={error} onRetry={reload} />
      {!data?.children?.length && <EmptyState icon={Home} title={t("No children linked to your account yet")} text={t("Ask the school to link your account to your children.")} />}
      {(data?.children || []).map((c) => {
        const att = c.attendance.last_30_days;
        const todayStatus = c.attendance.today[0]?.status;
        const trip = c.bus?.find((x) => x.status === "active") || c.bus?.[0];
        return (
          <Card key={c.child.id} title={<span>{c.child.full_name} <span className="text-sm font-normal text-slate-500">· {c.child.group_name}</span></span>}
                actions={<>
                  {hasModule("attendance") && <Button size="sm" variant="secondary" icon={ClipboardX} onClick={() => setAbsenceFor(c.child)}>{t("Report absence")}</Button>}
                  <Link to={`/children/${c.child.id}/timetable`}><Button size="sm" variant="secondary" icon={CalendarClock}>{t("Timetable")}</Button></Link>
                  {hasModule("grades") && <Link to={`/students/${c.child.id}/report-card`}><Button size="sm" variant="secondary" icon={FileText}>{t("Report card")}</Button></Link>}
                </>}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-600">{t("Today")}</h3>
                {todayStatus && <Badge tone={todayStatus === "present" ? "green" : todayStatus === "absent" ? "red" : "yellow"} className="mb-2">{attendanceLabel(t, todayStatus)}</Badge>}
                {c.today.length ? <ul className="space-y-1 text-sm">{c.today.map((l) => (
                  <li key={l.period} className="flex justify-between gap-2"><span>{fmtTime(l.start)} · {l.subject}</span><span className="text-slate-500">{l.cover ? <Badge tone="purple">{t("Cover")}: {l.teacher}</Badge> : l.teacher}</span></li>))}</ul>
                  : <p className="text-sm text-slate-500">{t("No lessons today.")}</p>}
              </div>
              <div className="space-y-3">
                {att && <div className="text-sm"><span className="text-slate-500">{t("Last 30 days")}: </span>{t("{{absent}} day(s) absent, {{late}} late", { absent: att.absent, late: att.late })}</div>}
                {c.homework.length > 0 && <div className="text-sm"><span className="text-slate-500">{t("Homework this week")}: </span>
                  <Link to="/homework" className="text-brand">{t("{{n}} item(s)", { n: c.homework.length })}</Link></div>}
                {c.fees && <div className="flex items-center gap-2 text-sm"><Wallet className="h-4 w-4 text-slate-400" />
                  <span>{t("Balance")}: <b>{fmtMoney(c.fees.balance, data.currency)}</b></span>{Number(c.fees.overdue) > 0 && <Badge tone="red">{t("Overdue")}: {fmtMoney(c.fees.overdue, data.currency)}</Badge>}</div>}
                {trip && <Link to="/bus" className="flex items-center gap-2 rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
                  <Bus className="h-4 w-4" /> {trip.bus} · {busStatusLabel(t, trip.status)} · {t("planned at your stop {{time}}", { time: fmtTime(trip.planned_eta) })}</Link>}
                {c.child.allergies === undefined && null}
              </div>
            </div>
          </Card>
        );
      })}
      {absenceFor && <ReportAbsence student={absenceFor} onClose={() => { setAbsenceFor(null); reload(); }} />}
    </div>
  );
}

export function MyFees() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data: kids, loading } = useFetch(base ? `${base}/my/children/` : null);
  if (loading) return <Loading />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t("Fees")} subtitle={t("Pay at the school office in cash or by bank transfer. Receipts appear here.")} />
      {(kids?.children || []).map((c) => <Statement key={c.child.id} studentId={c.child.id} name={c.child.full_name} />)}
    </div>
  );
}

export function Statement({ studentId, name }) {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, error } = useFetch(base ? `${base}/students/${studentId}/fees/` : null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const cur = data.currency;
  const today = todayISO();
  return (
    <Card title={name || data.student}>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-500">{t("Total")}</div><div className="font-semibold">{fmtMoney(data.billed, cur)}</div></div>
        <div className="rounded-lg bg-emerald-50 p-2"><div className="text-slate-500">{t("Paid")}</div><div className="font-semibold text-emerald-700">{fmtMoney(data.paid, cur)}</div></div>
        <div className="rounded-lg bg-amber-50 p-2"><div className="text-slate-500">{t("Remaining")}</div><div className="font-semibold text-amber-700">{fmtMoney(data.balance, cur)}</div></div>
      </div>
      {data.next_due && <p className="mb-3 text-sm">{t("Next payment")}: <b>{fmtMoney(data.next_due.amount, cur)}</b> {t("by")} {fmtDate(data.next_due.date)}</p>}
      <h4 className="mb-1 text-sm font-semibold text-slate-600">{t("Installments")}</h4>
      <ul className="mb-3 divide-y divide-slate-100 text-sm">
        {data.fees.flatMap((f) => f.installments.map((i) => ({ ...i, fee: f }))).sort((a, b) => a.due_date.localeCompare(b.due_date)).map((i) => {
          const done = Number(i.outstanding) <= 0;
          return (
            <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>{feeCategoryLabel(t, i.fee.category)} · {i.fee.description}</span>
              <span className="flex items-center gap-2"><span className="text-slate-500">{fmtDate(i.due_date)}</span><span>{fmtMoney(i.amount, cur)}</span>
                {done ? <Badge tone="green">{t("Paid")}</Badge> : i.due_date < today ? <Badge tone="red">{t("Overdue")}</Badge> : <Badge>{t("Due")}</Badge>}</span>
            </li>
          );
        })}
      </ul>
      {data.payments.length > 0 && <>
        <h4 className="mb-1 text-sm font-semibold text-slate-600">{t("Payments")}</h4>
        <ul className="divide-y divide-slate-100 text-sm">{data.payments.map((p) => (
          <li key={p.id} className="flex justify-between py-1.5"><span>{fmtDate(p.date)} · {paymentMethodLabel(t, p.method)} · {p.receipt_number}</span><span className="font-medium">{fmtMoney(p.amount, cur)}</span></li>))}</ul>
      </>}
    </Card>
  );
}

export function ParentBus() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, error, reload } = useFetch(base ? `${base}/my/bus/` : null, { poll: 10000 });
  if (loading && !data) return <Loading />;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={t("School bus")} subtitle={t("For privacy you only see your child's stop, and the bus only while it is on its route.")} />
      <ErrorBox error={error} onRetry={reload} />
      {!data?.length && <EmptyState icon={Bus} title={t("Your children are not on a bus route")} />}
      {(data || []).map((kid) => kid.trips.map((trip) => (
        <Card key={`${kid.student}-${trip.direction}`} title={`${kid.name} · ${trip.direction === "morning" ? t("Morning") : t("Afternoon")} · ${trip.bus}`}
              actions={<Badge tone={trip.status === "active" ? "green" : "gray"}>{busStatusLabel(t, trip.status)}</Badge>}>
          <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-500">{t("Planned time at your stop")}</div><div className="text-lg font-semibold">{fmtTime(trip.planned_eta)}</div></div>
            <div className="rounded-lg bg-blue-50 p-2"><div className="text-slate-500">{t("Arriving in")}</div>
              <div className="text-lg font-semibold text-blue-800">{trip.live?.eta_minutes != null ? t("{{n}} min", { n: fmtNumber(trip.live.eta_minutes) }) : "—"}</div>
              {trip.live?.delay_minutes > 0 && <div className="text-xs text-amber-700">{t("Running {{n}} min late", { n: fmtNumber(trip.live.delay_minutes) })}</div>}</div>
          </div>
          {trip.child_status && <p className="mb-2 text-sm"><Badge tone="green">{busStatusLabel(t, trip.child_status)}</Badge></p>}
          {trip.live ? (
            <>
              <LiveMap bus={trip.live} stop={trip.stop} school={trip.school} />
              <p className="mt-1 text-xs text-slate-400">{t("Last update")}: {fmtDateTime(trip.live.last_seen)}</p>
            </>
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><MapPin className="h-4 w-4" />{t("The map appears when the driver starts the route.")}</div>
          )}
        </Card>
      )))}
    </div>
  );
}

