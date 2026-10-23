import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileDown, Plus, Printer, Receipt, Trash2, UserCheck, Wallet } from "lucide-react";
import api, { download } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useAction, useFetch } from "../lib/hooks";
import { fmtDate, fmtMoney, todayISO } from "../lib/format";
import { STAGES, feeCategoryLabel, paymentMethodLabel, stageLabel } from "../lib/labels";
import ResourcePage from "../components/ResourcePage";
import { Badge, Button, Card, Checkbox, DataTable, EmptyState, ErrorBox, Input, Loading, Modal, PageHeader, Select, Stat, Tabs, Textarea } from "../components/ui";
import { Statement } from "./parent";

const CATS = ["tuition", "trip", "books", "uniform", "bus", "other"];

export function Fees() {
  const { t } = useTranslation();
  const { base, school } = useAuth();
  const [tab, setTab] = useState("balances");
  const [by, setBy] = useState("family");
  const [overdue, setOverdue] = useState(false);
  const [statementFor, setStatementFor] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const balances = useFetch(base && tab === "balances" ? `${base}/fees/balances/` : null, { params: { by, ...(overdue ? { overdue: 1 } : {}) } });
  const cur = school?.currency || "JOD";
  return (
    <div className="space-y-4">
      <PageHeader title={t("Fees")} subtitle={t("Cash, bank transfer and cheque payments recorded by the office. Reminders go to parents automatically before and after due dates.")}
                  actions={<><Button icon={Wallet} onClick={() => setPayFor({})}>{t("Record a payment")}</Button>
                    <Button variant="secondary" icon={FileDown} onClick={() => download(`${base}/export/fees/`, "fees.xlsx")}>{t("Excel")}</Button></>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "balances", label: t("Balances") }, { value: "payments", label: t("Payments") },
        { value: "plans", label: t("Fee plans") }, { value: "extras", label: t("Extra charges") }]} />
      {tab === "balances" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={by} onChange={(e) => setBy(e.target.value)} options={[{ value: "family", label: t("By family") }, { value: "student", label: t("By student") }]} />
            <Checkbox label={t("Only overdue")} checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
          </div>
          {balances.data && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={t("Billed")} value={fmtMoney(balances.data.totals.billed, cur)} />
              <Stat tone="green" label={t("Paid")} value={fmtMoney(balances.data.totals.paid, cur)} />
              <Stat tone="yellow" label={t("Outstanding")} value={fmtMoney(balances.data.totals.balance, cur)} />
              <Stat tone="red" label={t("Overdue")} value={fmtMoney(balances.data.totals.overdue, cur)} />
            </div>
          )}
          {balances.loading ? <Loading /> : (
            <DataTable rowKey={by === "family" ? "family" : "student_id"} rows={balances.data?.rows || []} empty={<EmptyState title={t("No fees yet")} />}
              onRowClick={by === "student" ? (r) => setStatementFor(r) : undefined} columns={[
                by === "family" ? { key: "family", label: t("Family"), render: (r) => <div><div className="font-medium">{r.family}</div><div className="text-xs text-slate-500">{r.children.join(", ")} {r.phone && `· ${r.phone}`}</div></div> }
                  : { key: "student", label: t("Student"), render: (r) => <span className="font-medium">{r.student} <span className="text-xs text-slate-500">{r.group}</span></span> },
                { key: "billed", label: t("Billed"), render: (r) => fmtMoney(r.billed, cur) },
                { key: "paid", label: t("Paid"), render: (r) => fmtMoney(r.paid, cur) },
                { key: "balance", label: t("Balance"), render: (r) => <b>{fmtMoney(r.balance, cur)}</b> },
                { key: "overdue", label: t("Overdue"), render: (r) => Number(r.overdue) > 0 ? <Badge tone="red">{fmtMoney(r.overdue, cur)}</Badge> : "" },
              ]} />
          )}
        </div>
      )}
      {tab === "payments" && <Payments onPay={() => setPayFor({})} />}
      {tab === "plans" && <FeePlans />}
      {tab === "extras" && <Extras />}
      {statementFor && <Modal open onClose={() => setStatementFor(null)} title={statementFor.student} wide><Statement studentId={statementFor.student_id} /></Modal>}
      {payFor && <PaymentModal onClose={() => { setPayFor(null); balances.reload(); }} />}
    </div>
  );
}

function PaymentModal({ onClose }) {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data: students } = useFetch(`${base}/students/`);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ student: "", amount: "", method: "cash", date: todayISO(), reference: "", note: "" });
  const [run, busy] = useAction();
  const [done, setDone] = useState(null);
  const matches = (students || []).filter((s) => !q || s.full_name.toLowerCase().includes(q.toLowerCase()) || s.student_number.includes(q)).slice(0, 30);
  const save = async () => { const r = await run(() => api.post(`${base}/payments/`, { ...form, student: Number(form.student) }), t("Payment recorded")); setDone(r.data); };
  if (done) {
    return (
      <Modal open onClose={onClose} title={t("Payment recorded")} footer={<><Button variant="secondary" onClick={onClose}>{t("Close")}</Button>
        <Link to={`/fees/receipt/${done.id}`} target="_blank"><Button icon={Printer}>{t("Print receipt")}</Button></Link></>}>
        <p>{t("Receipt {{n}} for {{who}}.", { n: done.receipt_number, who: done.student_name })}</p>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={t("Record a payment")} footer={<Button icon={Receipt} onClick={save} loading={busy} disabled={!form.student || !form.amount}>{t("Save")}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input className="sm:col-span-2" label={t("Find student")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Name or student number")} />
        <Select className="sm:col-span-2" label={t("Student")} value={form.student} placeholder={t("Choose")} options={matches.map((s) => ({ value: s.id, label: `${s.full_name} · ${s.group_name || ""}` }))}
                onChange={(e) => setForm({ ...form, student: e.target.value })} />
        <Input label={t("Amount")} type="number" step="0.001" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <Select label={t("Method")} value={form.method} options={["cash", "transfer", "cheque", "other"].map((m) => ({ value: m, label: paymentMethodLabel(t, m) }))} onChange={(e) => setForm({ ...form, method: e.target.value })} />
        <Input label={t("Date")} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <Input label={t("Reference (transfer / cheque no.)")} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        <Textarea className="sm:col-span-2" label={t("Note")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </div>
    </Modal>
  );
}

function Payments() {
  const { t } = useTranslation();
  const { base, school } = useAuth();
  const { data, loading, reload } = useFetch(`${base}/payments/`);
  const [run] = useAction();
  const remove = async (p) => { if (window.confirm(t("Delete this payment? Balances will be recalculated."))) { await run(() => api.delete(`${base}/payments/${p.id}/`), t("Deleted")); reload(); } };
  if (loading) return <Loading />;
  return (
    <DataTable rows={data || []} empty={<EmptyState title={t("No payments yet")} />} columns={[
      { key: "date", label: t("Date"), render: (p) => fmtDate(p.date) }, { key: "receipt_number", label: t("Receipt") },
      { key: "student_name", label: t("Student") }, { key: "amount", label: t("Amount"), render: (p) => <b>{fmtMoney(p.amount, school.currency)}</b> },
      { key: "method", label: t("Method"), render: (p) => paymentMethodLabel(t, p.method) }, { key: "received_by_name", label: t("Received by") },
      { key: "x", label: "", render: (p) => <div className="flex gap-1"><Link to={`/fees/receipt/${p.id}`} target="_blank"><Button size="sm" variant="ghost" icon={Printer} /></Link>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(p)} /></div> },
    ]} />
  );
}

function FeePlans() {
  const { t } = useTranslation();
  const { base, school } = useAuth();
  const { data, loading, reload } = useFetch(`${base}/fee-plans/`);
  const { data: groups } = useFetch(`${base}/groups/`);
  const [edit, setEdit] = useState(null);
  const [apply, setApply] = useState(null);
  const [target, setTarget] = useState({ grade_level: "", group_ids: [] });
  const [run, busy] = useAction();
  const blank = { name: "", items: [{ category: "tuition", description: "", amount: "", installments: [{ due_date: todayISO(), amount: "" }] }] };
  const save = async () => {
    const body = { ...edit, items: edit.items.map((i) => ({ ...i, installments: i.installments.filter((x) => x.amount !== "") })) };
    await run(() => (edit.id ? api.patch(`${base}/fee-plans/${edit.id}/`, body) : api.post(`${base}/fee-plans/`, body)), t("Saved"));
    setEdit(null); reload();
  };
  const doApply = async () => {
    const body = target.grade_level ? { grade_level: Number(target.grade_level) } : { group_ids: target.group_ids };
    const r = await run(() => api.post(`${base}/fee-plans/${apply.id}/apply/`, body));
    window.alert(t("{{n}} student(s) billed, {{m}} already had this plan.", { n: r.data.billed_students, m: r.data.already_billed }));
    setApply(null);
  };
  const setItem = (i, k, v) => setEdit({ ...edit, items: edit.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const setInst = (i, k, field, v) => setItem(i, "installments", edit.items[i].installments.map((x, j) => (j === k ? { ...x, [field]: v } : x)));
  const grades = [...new Set((groups || []).map((g) => g.grade_level).filter(Boolean))].sort((a, b) => a - b);
  if (loading) return <Loading />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button icon={Plus} onClick={() => setEdit(blank)}>{t("New fee plan")}</Button></div>
      <DataTable rows={data || []} empty={<EmptyState title={t("No fee plans")} text={t("A fee plan is e.g. 'Grades 1-6': tuition in 4 installments plus books.")} />} columns={[
        { key: "name", label: t("Plan"), render: (p) => <span className="font-medium">{p.name}</span> },
        { key: "items", label: t("Items"), render: (p) => p.items.map((i) => `${feeCategoryLabel(t, i.category)} ${fmtMoney(i.amount, school.currency)}`).join(" · ") },
        { key: "total", label: t("Total"), render: (p) => <b>{fmtMoney(p.total, school.currency)}</b> },
        { key: "x", label: "", render: (p) => <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => setApply(p)}>{t("Bill students")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setEdit({ ...p, items: p.items.map((i) => ({ ...i, installments: i.installments || [{ due_date: i.due_date, amount: i.amount }] })) })}>{t("Edit")}</Button></div> },
      ]} />
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? t("Edit fee plan") : t("New fee plan")} wide footer={<Button onClick={save} loading={busy}>{t("Save")}</Button>}>
          <Input label={t("Name")} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="mb-3" />
          {edit.items.map((it, i) => (
            <div key={i} className="mb-3 rounded-lg border border-slate-200 p-3">
              <div className="grid gap-2 sm:grid-cols-[10rem_1fr_9rem_auto] sm:items-end">
                <Select label={t("Category")} value={it.category} options={CATS.map((c) => ({ value: c, label: feeCategoryLabel(t, c) }))} onChange={(e) => setItem(i, "category", e.target.value)} />
                <Input label={t("Description")} value={it.description} onChange={(e) => setItem(i, "description", e.target.value)} />
                <Input label={t("Amount")} type="number" step="0.001" value={it.amount} onChange={(e) => setItem(i, "amount", e.target.value)} />
                <Button variant="ghost" icon={Trash2} onClick={() => setEdit({ ...edit, items: edit.items.filter((_, j) => j !== i) })} />
              </div>
              <div className="mt-2 space-y-1">
                <div className="text-xs font-medium text-slate-500">{t("Installments (must add up to the amount)")}</div>
                {it.installments.map((x, k) => (
                  <div key={k} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <Input type="date" value={x.due_date} onChange={(e) => setInst(i, k, "due_date", e.target.value)} />
                    <Input type="number" step="0.001" value={x.amount} onChange={(e) => setInst(i, k, "amount", e.target.value)} />
                    <Button variant="ghost" icon={Trash2} onClick={() => setItem(i, "installments", it.installments.filter((_, j) => j !== k))} />
                  </div>))}
                <Button size="sm" variant="secondary" icon={Plus} onClick={() => setItem(i, "installments", [...it.installments, { due_date: todayISO(), amount: "" }])}>{t("Installment")}</Button>
              </div>
            </div>
          ))}
          <Button variant="secondary" icon={Plus} onClick={() => setEdit({ ...edit, items: [...edit.items, { ...blank.items[0], category: "books" }] })}>{t("Add item")}</Button>
        </Modal>
      )}
      {apply && (
        <Modal open onClose={() => setApply(null)} title={`${t("Bill students")} - ${apply.name}`} footer={<Button onClick={doApply} loading={busy}>{t("Bill")}</Button>}>
          <div className="space-y-3">
            <Select label={t("A whole grade")} value={target.grade_level} placeholder={t("Choose")} options={grades.map((g) => ({ value: g, label: t("Grade {{n}}", { n: g }) }))}
                    onChange={(e) => setTarget({ grade_level: e.target.value, group_ids: [] })} />
            <div className="text-center text-sm text-slate-500">{t("or")}</div>
            <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">{(groups || []).map((g) => (
              <Checkbox key={g.id} label={g.name} checked={target.group_ids.includes(g.id)} onChange={(e) => setTarget({ grade_level: "", group_ids: e.target.checked ? [...target.group_ids, g.id] : target.group_ids.filter((x) => x !== g.id) })} />))}</div>
            <p className="text-xs text-slate-500">{t("Students who already have this plan are skipped.")}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Extras() {
  const { t } = useTranslation();
  const { base, school } = useAuth();
  const { data: students } = useFetch(`${base}/students/`);
  return (
    <ResourcePage title="" path="student-fees" searchable
      defaults={{ category: "trip", discount: "0" }}
      columns={[{ key: "student_name", label: t("Student") }, { key: "category", label: t("Category"), render: (f) => feeCategoryLabel(t, f.category) },
        { key: "description", label: t("Description") }, { key: "amount", label: t("Amount"), render: (f) => fmtMoney(f.amount, school.currency) },
        { key: "due", label: t("Due"), render: (f) => f.installments.map((i) => fmtDate(i.due_date)).join(", ") }]}
      fields={[{ name: "student", label: t("Student"), type: "select", numeric: true, required: true, options: (students || []).map((s) => ({ value: s.id, label: `${s.full_name} · ${s.group_name || ""}` })) },
        { name: "category", label: t("Category"), type: "select", options: CATS.map((c) => ({ value: c, label: feeCategoryLabel(t, c) })), placeholder: undefined },
        { name: "description", label: t("Description"), required: true }, { name: "amount", label: t("Amount"), type: "number", step: "0.001" },
        { name: "discount", label: t("Discount"), type: "number", step: "0.001" }, { name: "due_date", label: t("Due date"), type: "date" }]}
      fromForm={(f) => ({ ...f, installments: f.due_date ? [{ due_date: f.due_date, amount: (Number(f.amount) - Number(f.discount || 0)).toFixed(3) }] : undefined })}
      toForm={(f) => ({ ...f, due_date: f.installments?.[0]?.due_date })}
    />
  );
}

export function ReceiptPrint() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, error } = useFetch(base ? `${base}/payments/${id}/receipt/` : null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const s = data.school;
  const p = data.payment;
  return (
    <div className="mx-auto max-w-xl">
      <div className="no-print mb-3 flex justify-end"><Button icon={Printer} onClick={() => window.print()}>{t("Print / save as PDF")}</Button></div>
      <div className="print-page rounded-xl border border-slate-200 bg-white p-6">
        <header className="mb-4 flex items-center justify-between border-b-4 pb-3" style={{ borderColor: s.brand_color }}>
          <div className="flex items-center gap-3">{s.logo && <img src={s.logo} alt="" className="h-14 w-14 object-contain" />}
            <div><div className="text-lg font-bold">{s.name}</div><div className="text-xs text-slate-500">{s.address} · {s.phone}</div></div></div>
          <div className="text-end"><div className="font-semibold">{t("Receipt")}</div><div className="font-mono text-sm">{p.receipt_number}</div></div>
        </header>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-slate-500">{t("Date")}</dt><dd>{fmtDate(p.date)}</dd>
          <dt className="text-slate-500">{t("Received from")}</dt><dd>{t("Parent of {{name}}", { name: data.student.name })} ({data.student.group})</dd>
          <dt className="text-slate-500">{t("Amount")}</dt><dd className="text-xl font-bold">{fmtMoney(p.amount, s.currency)}</dd>
          <dt className="text-slate-500">{t("Method")}</dt><dd>{paymentMethodLabel(t, p.method)} {p.reference && `(${p.reference})`}</dd>
          <dt className="text-slate-500">{t("Remaining balance")}</dt><dd>{fmtMoney(data.balance_after, s.currency)}</dd>
          <dt className="text-slate-500">{t("Received by")}</dt><dd>{p.received_by_name}</dd>
        </dl>
        <div className="mt-10 border-t border-slate-300 pt-2 text-sm text-slate-500">{t("Signature and stamp")}</div>
      </div>
    </div>
  );
}

export function Admissions() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, error, reload } = useFetch(base ? `${base}/applicants/` : null);
  const { data: groups } = useFetch(base ? `${base}/groups/` : null);
  const [edit, setEdit] = useState(null);
  const [enroll, setEnroll] = useState(null);
  const [groupId, setGroupId] = useState("");
  const [run, busy] = useAction();
  const today = todayISO();
  const save = async () => {
    const body = { ...edit, test_score: edit.test_score === "" ? null : edit.test_score, next_follow_up: edit.next_follow_up || null, date_of_birth: edit.date_of_birth || null };
    await run(() => (edit.id ? api.patch(`${base}/applicants/${edit.id}/`, body) : api.post(`${base}/applicants/`, body)), t("Saved"));
    setEdit(null); reload();
  };
  const move = async (a, stage) => { await run(() => api.patch(`${base}/applicants/${a.id}/`, { stage })); reload(); };
  const doEnroll = async () => { await run(() => api.post(`${base}/applicants/${enroll.id}/enroll/`, { group: groupId ? Number(groupId) : null }), t("Enrolled - student and parent records created")); setEnroll(null); reload(); };
  if (loading) return <Loading />;
  const docs = ["birth_certificate", "previous_report", "photos", "vaccinations"];
  const docLabel = { birth_certificate: t("Birth certificate"), previous_report: t("Previous report card"), photos: t("Photos"), vaccinations: t("Vaccination record") };
  return (
    <div className="space-y-4">
      <PageHeader title={t("Admissions")} subtitle={t("Follow every prospective family from first call to enrolment. Overdue follow-ups are highlighted and you get a reminder.")}
                  actions={<Button icon={Plus} onClick={() => setEdit({ stage: "inquiry", documents: {}, next_follow_up: today })}>{t("New inquiry")}</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      <div className="flex gap-3 overflow-x-auto pb-2">
        {STAGES.map((st) => {
          const items = (data || []).filter((a) => a.stage === st);
          return (
            <div key={st} className="w-64 shrink-0 rounded-xl bg-slate-100 p-2">
              <div className="mb-2 flex justify-between px-1 text-sm font-semibold text-slate-700"><span>{stageLabel(t, st)}</span><Badge>{items.length}</Badge></div>
              <div className="space-y-2">{items.map((a) => (
                <button key={a.id} type="button" onClick={() => setEdit({ ...a, test_score: a.test_score ?? "" })} className="w-full rounded-lg bg-white p-2 text-start text-sm shadow-sm">
                  <div className="font-medium">{a.child_name}</div>
                  <div className="text-xs text-slate-500">{a.guardian_name} · {a.guardian_phone}</div>
                  {a.grade_applying && <div className="text-xs text-slate-500">{t("Grade {{n}}", { n: a.grade_applying })}</div>}
                  {a.next_follow_up && !["enrolled", "rejected"].includes(st) && (
                    <Badge tone={a.next_follow_up < today ? "red" : a.next_follow_up === today ? "yellow" : "gray"} className="mt-1">{t("Follow up")}: {fmtDate(a.next_follow_up)}</Badge>)}
                </button>))}</div>
            </div>
          );
        })}
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? edit.child_name : t("New inquiry")} wide
               footer={<>{edit.id && edit.stage === "accepted" && !edit.student && <Button variant="success" icon={UserCheck} onClick={() => { setEnroll(edit); setEdit(null); }}>{t("Enrol")}</Button>}
                 <Button onClick={save} loading={busy}>{t("Save")}</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t("Child's name")} value={edit.child_name || ""} onChange={(e) => setEdit({ ...edit, child_name: e.target.value })} />
            <Input label={t("Date of birth")} type="date" value={edit.date_of_birth || ""} onChange={(e) => setEdit({ ...edit, date_of_birth: e.target.value })} />
            <Input label={t("Grade applying for")} type="number" value={edit.grade_applying || ""} onChange={(e) => setEdit({ ...edit, grade_applying: e.target.value ? Number(e.target.value) : null })} />
            <Select label={t("Stage")} value={edit.stage} options={STAGES.map((s) => ({ value: s, label: stageLabel(t, s) }))} onChange={(e) => setEdit({ ...edit, stage: e.target.value })} />
            <Input label={t("Parent's name")} value={edit.guardian_name || ""} onChange={(e) => setEdit({ ...edit, guardian_name: e.target.value })} />
            <Input label={t("Parent's phone")} type="tel" value={edit.guardian_phone || ""} onChange={(e) => setEdit({ ...edit, guardian_phone: e.target.value })} />
            <Input label={t("Parent's email")} type="email" value={edit.guardian_email || ""} onChange={(e) => setEdit({ ...edit, guardian_email: e.target.value })} />
            <Input label={t("Next follow-up")} type="date" value={edit.next_follow_up || ""} onChange={(e) => setEdit({ ...edit, next_follow_up: e.target.value })} />
            <Input label={t("Placement test date")} type="date" value={edit.test_date || ""} onChange={(e) => setEdit({ ...edit, test_date: e.target.value || null })} />
            <Input label={t("Test score")} type="number" value={edit.test_score} onChange={(e) => setEdit({ ...edit, test_score: e.target.value })} />
            <Input label={t("How they heard about us")} value={edit.source || ""} onChange={(e) => setEdit({ ...edit, source: e.target.value })} />
            <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-medium">{t("Documents received")}</legend>
              <div className="flex flex-wrap gap-3">{docs.map((d) => <Checkbox key={d} label={docLabel[d]} checked={!!edit.documents?.[d]} onChange={(e) => setEdit({ ...edit, documents: { ...edit.documents, [d]: e.target.checked } })} />)}</div></fieldset>
            <Textarea className="sm:col-span-2" label={t("Notes")} value={edit.notes || ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
          </div>
          {edit.id && <div className="mt-3 flex flex-wrap gap-1">{STAGES.filter((s) => s !== edit.stage).map((s) => <Button key={s} size="sm" variant="ghost" onClick={() => { move(edit, s); setEdit(null); }}>{t("Move to")} {stageLabel(t, s)}</Button>)}</div>}
        </Modal>
      )}
      {enroll && (
        <Modal open onClose={() => setEnroll(null)} title={`${t("Enrol")} ${enroll.child_name}`} footer={<Button onClick={doEnroll} loading={busy}>{t("Enrol")}</Button>}>
          <Select label={t("Class group")} value={groupId} placeholder={t("Decide later")} options={(groups || []).map((g) => ({ value: g.id, label: g.name }))} onChange={(e) => setGroupId(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}

