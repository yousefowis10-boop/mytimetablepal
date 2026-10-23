import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarRange, FileDown, NotebookPen, Printer, Save, Sparkles } from "lucide-react";
import api, { download } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useAction, useFetch } from "../lib/hooks";
import { fmtDate, fmtNumber, todayISO } from "../lib/format";
import ResourcePage from "../components/ResourcePage";
import { Badge, Button, Card, DataTable, EmptyState, ErrorBox, Input, Loading, Modal, PageHeader, Select, cx } from "../components/ui";

function useList(path) {
  const { base } = useAuth();
  const { data } = useFetch(base ? `${base}/${path}/` : null);
  return data || [];
}

export function Homework() {
  const { hasRole, isStaff } = useAuth();
  if (!isStaff && hasRole("parent")) return <ParentHomework />;
  return <StaffHomework />;
}

function StaffHomework() {
  const { t } = useTranslation();
  const groups = useList("groups");
  const subjects = useList("subjects");
  return (
    <ResourcePage title={t("Homework")} path="homework" subtitle={t("Parents get a notification and see it in their weekly view.")}
      filters={[{ name: "group", options: groups.map((g) => ({ value: g.id, label: g.name })), placeholder: t("All classes") }]}
      defaults={{ assigned_date: todayISO(), due_date: todayISO() }}
      columns={[
        { key: "title", label: t("Homework"), render: (h) => <span className="font-medium">{h.title}</span> },
        { key: "group_name", label: t("Class") }, { key: "subject_name", label: t("Subject") },
        { key: "due_date", label: t("Due"), render: (h) => fmtDate(h.due_date, { weekday: "short", day: "numeric", month: "short" }) },
      ]}
      fields={[
        { name: "group", label: t("Class group"), type: "select", numeric: true, required: true, options: groups.map((g) => ({ value: g.id, label: g.name })) },
        { name: "subject", label: t("Subject"), type: "select", numeric: true, required: true, options: subjects.map((s) => ({ value: s.id, label: s.name })) },
        { name: "title", label: t("Title"), required: true, wide: true }, { name: "description", label: t("Details"), type: "textarea" },
        { name: "assigned_date", label: t("Set on"), type: "date" }, { name: "due_date", label: t("Due on"), type: "date" },
        { name: "link", label: t("Link (optional)"), type: "url", wide: true },
      ]}
    />
  );
}

function ParentHomework() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, error } = useFetch(base ? `${base}/my/children/` : null);
  if (loading) return <Loading />;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={t("Homework this week")} />
      <ErrorBox error={error} />
      {(data?.children || []).map((c) => (
        <Card key={c.child.id} title={`${c.child.full_name} · ${c.child.group_name || ""}`}>
          {c.homework.length ? <ul className="divide-y divide-slate-100">{c.homework.map((h) => (
            <li key={h.id} className="py-2"><div className="flex justify-between gap-2"><span className="font-medium">{h.subject_name}: {h.title}</span>
              <Badge tone={h.due_date <= todayISO() ? "red" : "blue"}>{fmtDate(h.due_date, { weekday: "short", day: "numeric", month: "short" })}</Badge></div>
              {h.description && <p className="text-sm text-slate-600">{h.description}</p>}
              {h.link && <a className="text-sm text-brand" href={h.link} target="_blank" rel="noreferrer">{t("Open link")}</a>}</li>))}</ul>
            : <p className="text-sm text-slate-500">{t("No homework this week.")}</p>}
        </Card>
      ))}
    </div>
  );
}

export function Grades() {
  const { t } = useTranslation();
  const { isManager, base } = useAuth();
  const groups = useList("groups");
  const subjects = useList("subjects");
  const terms = useList("terms");
  const [sheet, setSheet] = useState(null);
  const [termsOpen, setTermsOpen] = useState(false);
  return (
    <>
      <ResourcePage title={t("Grades")} path="assessments" subtitle={t("Create a quiz, test or exam, then enter the marks.")}
        headerActions={<>
          {isManager && <Button variant="secondary" icon={CalendarRange} onClick={() => setTermsOpen(true)}>{t("Terms")}</Button>}
          <Button variant="secondary" icon={FileDown} onClick={() => download(`${base}/export/grades/`, "grades.xlsx")}>{t("Excel")}</Button>
        </>}
        filters={[{ name: "group", options: groups.map((g) => ({ value: g.id, label: g.name })), placeholder: t("All classes") },
          { name: "term", options: terms.map((g) => ({ value: g.id, label: g.name })), placeholder: t("All terms") }]}
        defaults={{ max_score: 100, weight: 1, date: todayISO(), term: terms[terms.length - 1]?.id }}
        columns={[
          { key: "name", label: t("Assessment"), render: (a) => <span className="font-medium">{a.name}</span> },
          { key: "group_name", label: t("Class") }, { key: "subject_name", label: t("Subject") },
          { key: "date", label: t("Date"), render: (a) => fmtDate(a.date) }, { key: "graded", label: t("Marks entered") },
        ]}
        fields={[
          { name: "term", label: t("Term"), type: "select", numeric: true, required: true, options: terms.map((x) => ({ value: x.id, label: x.name })) },
          { name: "group", label: t("Class group"), type: "select", numeric: true, required: true, options: groups.map((x) => ({ value: x.id, label: x.name })) },
          { name: "subject", label: t("Subject"), type: "select", numeric: true, required: true, options: subjects.map((x) => ({ value: x.id, label: x.name })) },
          { name: "name", label: t("Name"), required: true, hint: t("e.g. Quiz 3, Midterm") }, { name: "date", label: t("Date"), type: "date" },
          { name: "max_score", label: t("Out of"), type: "number" }, { name: "weight", label: t("Weight"), type: "number", step: "0.5", hint: t("Midterm = 2 counts double") },
        ]}
        onRowClick={(a) => setSheet(a)}
        rowActions={(a) => <Button size="sm" variant="ghost" icon={NotebookPen} onClick={() => setSheet(a)}>{t("Enter marks")}</Button>}
      />
      {sheet && <GradeSheet assessment={sheet} onClose={() => setSheet(null)} />}
      {termsOpen && <Modal open onClose={() => setTermsOpen(false)} title={t("Terms")} wide><TermsInline /></Modal>}
    </>
  );
}

function TermsInline() {
  const { t } = useTranslation();
  return <ResourcePage title="" path="terms" searchable={false} columns={[{ key: "name", label: t("Name") }, { key: "start_date", label: t("From"), render: (r) => fmtDate(r.start_date) }, { key: "end_date", label: t("To"), render: (r) => fmtDate(r.end_date) }]}
                       fields={[{ name: "name", label: t("Name"), required: true }, { name: "start_date", label: t("From"), type: "date" }, { name: "end_date", label: t("To"), type: "date" }]} />;
}

function GradeSheet({ assessment, onClose }) {
  const { t } = useTranslation();
  const { base } = useAuth();
  const url = `${base}/assessments/${assessment.id}/grades/`;
  const { data, loading } = useFetch(url);
  const [scores, setScores] = useState({});
  const [run, busy] = useAction();
  useEffect(() => { if (data) setScores(Object.fromEntries(data.students.map((s) => [s.id, s.score ?? ""]))); }, [data]);
  const save = async () => {
    await run(() => api.post(url, { grades: Object.entries(scores).map(([student, score]) => ({ student: Number(student), score: score === "" ? null : score })) }), t("Marks saved"));
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`${assessment.name} · ${assessment.group_name} · ${assessment.subject_name}`} wide
           footer={<Button icon={Save} onClick={save} loading={busy}>{t("Save marks")}</Button>}>
      {loading ? <Loading /> : (
        <div className="space-y-1">
          <p className="mb-2 text-sm text-slate-500">{t("Out of {{max}}. Leave empty if not taken.", { max: fmtNumber(assessment.max_score) })}</p>
          {data?.students.map((s) => (
            <div key={s.id} className="grid grid-cols-[1fr_7rem] items-center gap-2">
              <span className="text-sm">{s.name}</span>
              <input type="number" inputMode="decimal" min={0} max={assessment.max_score} step="0.5" value={scores[s.id] ?? ""}
                     onChange={(e) => setScores({ ...scores, [s.id]: e.target.value })}
                     className="rounded-lg border border-slate-300 px-2 py-1.5 text-end text-sm" aria-label={s.name} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function ReportCard() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { base } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data, loading, error } = useFetch(base ? `${base}/students/${id}/report-card/` : null, { params: params.get("term") ? { term: params.get("term") } : {} });
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const s = data.school;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-3 flex flex-wrap justify-between gap-2">
        <Select value={data.term.id} onChange={(e) => setParams({ term: e.target.value })} options={data.terms.map((x) => ({ value: x.id, label: x.name }))} />
        <Button icon={Printer} onClick={() => window.print()}>{t("Print / save as PDF")}</Button>
      </div>
      <div className="print-page rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="flex items-center justify-between gap-4 border-b-4 pb-4" style={{ borderColor: s.brand_color }}>
          <div className="flex items-center gap-3">
            {s.logo && <img src={s.logo} alt="" className="h-16 w-16 object-contain" />}
            <div><div className="text-xl font-bold">{s.name}</div><div className="text-sm text-slate-500">{s.address} · {s.phone}</div></div>
          </div>
          <div className="text-end"><div className="text-lg font-semibold">{t("Report card")}</div><div className="text-sm text-slate-500">{data.term.name}</div></div>
        </header>
        <div className="my-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><div className="text-slate-500">{t("Student")}</div><div className="font-semibold">{data.student.name}</div></div>
          <div><div className="text-slate-500">{t("Class")}</div><div className="font-semibold">{data.student.group}</div></div>
          <div><div className="text-slate-500">{t("Student number")}</div><div className="font-semibold">{data.student.number}</div></div>
          <div><div className="text-slate-500">{t("Days absent")}</div><div className="font-semibold">{fmtNumber(data.attendance?.absent || 0)}</div></div>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-300 text-start"><th className="py-2 text-start">{t("Subject")}</th><th className="text-start">{t("Assessments")}</th><th className="text-end">%</th><th className="text-end">{t("Grade")}</th></tr></thead>
          <tbody>{data.subjects.map((r) => (
            <tr key={r.subject} className="border-b border-slate-100">
              <td className="py-2 font-medium">{r.subject}</td>
              <td className="text-xs text-slate-500">{r.items.map((i) => `${i.name}: ${fmtNumber(i.score, 1)}/${fmtNumber(i.max)}`).join(" · ")}</td>
              <td className={cx("text-end font-semibold", !r.passed && "text-red-600")}>{fmtNumber(r.percentage, 1)}</td>
              <td className="text-end font-semibold">{r.letter}</td>
            </tr>))}</tbody>
          <tfoot><tr><td className="pt-3 font-bold" colSpan={2}>{t("Overall")}</td><td className="pt-3 text-end font-bold">{fmtNumber(data.overall, 1)}</td><td className="pt-3 text-end font-bold">{data.overall_letter}</td></tr></tfoot>
        </table>
        <div className="mt-10 grid grid-cols-2 gap-8 text-sm text-slate-500">
          <div className="border-t border-slate-300 pt-2">{t("Class teacher")}</div>
          <div className="border-t border-slate-300 pt-2">{t("Principal")}: {s.principal}</div>
        </div>
      </div>
    </div>
  );
}

export function AtRisk() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, error, reload } = useFetch(base ? `${base}/at-risk/` : null);
  if (loading) return <Loading />;
  const tone = { attendance: "yellow", grades: "red", trend: "purple" };
  return (
    <div className="space-y-4">
      <PageHeader title={t("At-risk students")} subtitle={t("Low attendance in the last 30 days, an average below the pass mark, or grades falling - noticed early, before report-card day.")} />
      <ErrorBox error={error} onRetry={reload} />
      <DataTable rowKey="student_id" rows={data?.students || []} empty={<EmptyState icon={AlertTriangle} title={t("No warning signs right now.")} />} columns={[
        { key: "student", label: t("Student"), render: (r) => <Link to={`/students/${r.student_id}/report-card`} className="font-medium text-brand">{r.student}</Link> },
        { key: "group", label: t("Class") },
        { key: "reasons", label: t("Why"), render: (r) => <div className="flex flex-wrap gap-1">{r.reasons.map((x) => <Badge key={x.kind} tone={tone[x.kind]}>{x.text}</Badge>)}</div> },
      ]} />
    </div>
  );
}

export function Exams() {
  const { t } = useTranslation();
  const { base, isManager } = useAuth();
  const groups = useList("groups");
  const subjects = useList("subjects");
  const { data: periods, reload } = useFetch(base ? `${base}/exam-periods/` : null);
  const [active, setActive] = useState(null);
  const period = (periods || []).find((p) => p.id === active) || (periods || [])[0];
  const { data: exams, reload: reloadExams } = useFetch(base && period ? `${base}/exams/` : null, { params: { exam_period: period?.id } });
  const [run, busy] = useAction();
  const [newPeriod, setNewPeriod] = useState(false);
  const [pform, setPform] = useState({ name: "", start_date: todayISO(), end_date: todayISO(), max_exams_per_day: 1, s1: "09:00", e1: "11:00", s2: "", e2: "" });
  const [eform, setEform] = useState({ subject: "", groups: [], duration_minutes: 120 });
  const createPeriod = async () => {
    const sessions = [{ start: pform.s1, end: pform.e1 }, ...(pform.s2 ? [{ start: pform.s2, end: pform.e2 }] : [])];
    const res = await run(() => api.post(`${base}/exam-periods/`, { name: pform.name, start_date: pform.start_date, end_date: pform.end_date, max_exams_per_day: pform.max_exams_per_day, sessions }), t("Created"));
    setNewPeriod(false); await reload(); setActive(res.data.id);
  };
  const addExam = async () => { await run(() => api.post(`${base}/exams/`, { ...eform, exam_period: period.id, subject: Number(eform.subject) }), t("Added")); setEform({ subject: "", groups: [], duration_minutes: 120 }); reloadExams(); };
  const schedule = async () => { await run(() => api.post(`${base}/exam-periods/${period.id}/schedule/`)); reload(); reloadExams(); };
  const result = period?.last_result;
  const byName = (list, idv) => list.find((x) => x.id === idv)?.name || "";
  return (
    <div className="space-y-4">
      <PageHeader title={t("Exams")} actions={isManager && <Button onClick={() => setNewPeriod(true)}>{t("New exam period")}</Button>} />
      {(periods || []).length === 0 ? <EmptyState title={t("No exam periods yet")} text={t("Create an exam period with its dates and daily sessions, add the exams, then let the scheduler place them.")} /> : (
        <>
          <Select value={period?.id} onChange={(e) => setActive(Number(e.target.value))} options={(periods || []).map((p) => ({ value: p.id, label: `${p.name} (${fmtDate(p.start_date)} - ${fmtDate(p.end_date)})` }))} className="max-w-md" />
          {isManager && (
            <Card title={t("Add an exam")}>
              <div className="grid gap-3 sm:grid-cols-[1fr_2fr_8rem_auto] sm:items-end">
                <Select label={t("Subject")} value={eform.subject} placeholder={t("Choose")} options={subjects.map((s) => ({ value: s.id, label: s.name }))} onChange={(e) => setEform({ ...eform, subject: e.target.value })} />
                <Select label={t("Class groups (hold Ctrl to pick several)")} multiple value={eform.groups.map(String)} options={groups.map((g) => ({ value: g.id, label: g.name }))}
                        onChange={(e) => setEform({ ...eform, groups: [...e.target.selectedOptions].map((o) => Number(o.value)) })} className="[&_select]:h-24" />
                <Input label={t("Minutes")} type="number" value={eform.duration_minutes} onChange={(e) => setEform({ ...eform, duration_minutes: Number(e.target.value) })} />
                <Button onClick={addExam} loading={busy} disabled={!eform.subject || !eform.groups.length}>{t("Add")}</Button>
              </div>
            </Card>
          )}
          <Card title={t("Exam timetable")} actions={isManager && <Button icon={Sparkles} onClick={schedule} loading={busy} disabled={!exams?.length}>{t("Schedule exams")}</Button>}>
            {result?.status && (result.status === "infeasible" ? <ErrorBox error={result.reasons.join(" ")} /> :
              <p className="mb-3 text-sm text-emerald-700">{t("No group has two exams at once; rooms fit every group; invigilators are spread evenly.")}</p>)}
            <DataTable rows={exams || []} empty={<p className="text-sm text-slate-500">{t("No exams added yet.")}</p>} columns={[
              { key: "subject_name", label: t("Exam"), render: (e) => <span className="font-medium">{e.subject_name}</span> },
              { key: "date", label: t("When"), render: (e) => e.date ? `${fmtDate(e.date, { weekday: "short", day: "numeric", month: "short" })} · ${period.sessions[e.session_index]?.start}` : <Badge tone="yellow">{t("Not scheduled")}</Badge> },
              { key: "groups", label: t("Groups, rooms & invigilators"), render: (e) => e.sittings.length ? e.sittings.map((s) => `${s.group_name} → ${s.room_name} (${s.invigilator_name})`).join(" · ") : e.groups.map((g) => byName(groups, g)).join(", ") },
            ]} />
          </Card>
        </>
      )}
      <Modal open={newPeriod} onClose={() => setNewPeriod(false)} title={t("New exam period")} footer={<Button onClick={createPeriod} loading={busy} disabled={!pform.name}>{t("Create")}</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input className="sm:col-span-2" label={t("Name")} value={pform.name} onChange={(e) => setPform({ ...pform, name: e.target.value })} placeholder={t("e.g. Midterms")} />
          <Input label={t("From")} type="date" value={pform.start_date} onChange={(e) => setPform({ ...pform, start_date: e.target.value })} />
          <Input label={t("To")} type="date" value={pform.end_date} onChange={(e) => setPform({ ...pform, end_date: e.target.value })} />
          <Input label={t("Session 1 starts")} type="time" value={pform.s1} onChange={(e) => setPform({ ...pform, s1: e.target.value })} />
          <Input label={t("Session 1 ends")} type="time" value={pform.e1} onChange={(e) => setPform({ ...pform, e1: e.target.value })} />
          <Input label={t("Session 2 starts (optional)")} type="time" value={pform.s2} onChange={(e) => setPform({ ...pform, s2: e.target.value })} />
          <Input label={t("Session 2 ends")} type="time" value={pform.e2} onChange={(e) => setPform({ ...pform, e2: e.target.value })} />
          <Input label={t("Max exams per day per group")} type="number" min={1} value={pform.max_exams_per_day} onChange={(e) => setPform({ ...pform, max_exams_per_day: Number(e.target.value) })} />
        </div>
      </Modal>
    </div>
  );
}

