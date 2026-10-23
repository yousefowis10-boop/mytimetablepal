import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarX, Eye, HelpCircle, MailOpen, Megaphone, MessageSquare, Plus, Send } from "lucide-react";
import api from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useAction, useFetch } from "../lib/hooks";
import { addDays, fmtDate, fmtDateTime, todayISO } from "../lib/format";
import { audienceLabel, eventKindLabel } from "../lib/labels";
import ResourcePage from "../components/ResourcePage";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Input, Loading, Modal, PageHeader, Select, Textarea, cx } from "../components/ui";

export function Announcements() {
  const { t } = useTranslation();
  const { base, isManager } = useAuth();
  const { data: groups } = useFetch(base ? `${base}/groups/` : null);
  const { data: guardians } = useFetch(base && isManager ? `${base}/guardians/` : null);
  const [receipts, setReceipts] = useState(null);
  const showReceipts = async (a) => { const r = await api.get(`${base}/announcements/${a.id}/receipts/`); setReceipts({ a, rows: r.data }); };
  const audiences = isManager ? ["school", "staff", "parents", "grade", "group", "guardian"] : ["group"];
  const grades = [...new Set((groups || []).map((g) => g.grade_level).filter(Boolean))].sort((a, b) => a - b);
  return (
    <>
      <ResourcePage title={t("Announcements")} path="announcements" subtitle={t("Sent to the app (and phone notifications / email when enabled).")}
        defaults={{ audience: isManager ? "school" : "group", urgent: false }}
        columns={[
          { key: "title", label: t("Title"), render: (a) => <span className="font-medium">{a.urgent && <Badge tone="red">{t("Urgent")}</Badge>} {a.title}</span> },
          { key: "audience", label: t("To"), render: (a) => audienceLabel(t, a.audience) },
          { key: "sent_at", label: t("Sent"), render: (a) => a.sent_at ? fmtDateTime(a.sent_at) : <Badge tone="yellow">{t("Scheduled for {{when}}", { when: fmtDateTime(a.publish_at) })}</Badge> },
          { key: "stats", label: t("Read"), render: (a) => a.sent_at ? `${a.stats.read} / ${a.stats.recipients}` : "" },
        ]}
        fields={[
          { name: "title", label: t("Title"), required: true, wide: true },
          { name: "body", label: t("Message"), type: "textarea", required: true },
          { name: "audience", label: t("Send to"), type: "select", options: audiences.map((v) => ({ value: v, label: audienceLabel(t, v) })), placeholder: undefined },
          { name: "grade_level", label: t("Grade (if a grade)"), type: "select", numeric: true, options: grades.map((g) => ({ value: g, label: String(g) })) },
          { name: "group", label: t("Class group (if a group)"), type: "select", numeric: true, options: (groups || []).map((g) => ({ value: g.id, label: g.name })) },
          ...(isManager ? [{ name: "guardian", label: t("Parent (if one parent)"), type: "select", numeric: true, options: (guardians || []).map((g) => ({ value: g.id, label: g.name })) }] : []),
          { name: "publish_at", label: t("Send later (optional)"), type: "datetime-local" },
          { name: "urgent", label: t("Urgent"), type: "checkbox" },
        ]}
        fromForm={(f) => { const out = { ...f }; if (!out.publish_at) delete out.publish_at; else out.publish_at = new Date(out.publish_at).toISOString(); return out; }}
        rowActions={(a) => a.sent_at && <Button size="sm" variant="ghost" icon={Eye} onClick={() => showReceipts(a)}>{t("Who read it")}</Button>}
      />
      <Modal open={!!receipts} onClose={() => setReceipts(null)} title={receipts?.a.title}>
        <ul className="divide-y divide-slate-100 text-sm">{receipts?.rows.map((r, i) => (
          <li key={i} className="flex justify-between py-1.5"><span>{r.name}</span>{r.read_at ? <Badge tone="green">{fmtDateTime(r.read_at)}</Badge> : <Badge>{t("Not yet")}</Badge>}</li>))}</ul>
      </Modal>
    </>
  );
}

export function Inbox() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, error, reload } = useFetch(base ? `${base}/inbox/` : null);
  const [open, setOpen] = useState(null);
  const read = async (m) => { setOpen(m); if (!m.read_at) { await api.post(`${base}/inbox/${m.id}/read/`); reload(); } };
  if (loading) return <Loading />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("Inbox")} />
      <ErrorBox error={error} onRetry={reload} />
      {data?.length ? (
        <ul className="space-y-2">{data.map((m) => (
          <li key={m.id}><button type="button" onClick={() => read(m)} className={cx("w-full rounded-xl border p-3 text-start", m.read_at ? "border-slate-200 bg-white" : "border-brand/30 bg-brand/5")}>
            <div className="flex items-center justify-between gap-2"><span className={cx("font-medium", !m.read_at && "text-brand")}>{m.urgent && <Badge tone="red">{t("Urgent")}</Badge>} {m.title}</span>
              <span className="shrink-0 text-xs text-slate-500">{fmtDateTime(m.published)}</span></div>
            <p className="mt-1 line-clamp-2 text-sm text-slate-600">{m.body}</p>
          </button></li>))}</ul>
      ) : <EmptyState icon={MailOpen} title={t("No messages yet")} />}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title}>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{open?.body}</p>
        <p className="mt-3 text-xs text-slate-400">{open?.author} · {fmtDateTime(open?.published)}</p>
      </Modal>
    </div>
  );
}

export function Messages() {
  const { t } = useTranslation();
  const { base, isManager, hasRole } = useAuth();
  const { data, loading, error, reload } = useFetch(base ? `${base}/threads/` : null);
  const { data: kids } = useFetch(base && hasRole("parent") ? `${base}/my/children/` : null);
  const { data: faqs } = useFetch(base && !isManager ? `${base}/faqs/` : null);
  const [active, setActive] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [draft, setDraft] = useState({ subject: "", body: "", student: "" });
  const [reply, setReply] = useState("");
  const [run, busy] = useAction();
  const thread = (data || []).find((x) => x.id === active);
  const send = async () => { await run(() => api.post(`${base}/threads/${active}/reply/`, { body: reply })); setReply(""); reload(); };
  const create = async () => {
    const res = await run(() => api.post(`${base}/threads/`, { ...draft, student: draft.student || null }), t("Sent"));
    setNewOpen(false); setDraft({ subject: "", body: "", student: "" }); await reload(); setActive(res.data.id);
  };
  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title={t("Messages")} subtitle={isManager ? t("Questions from parents.") : t("Write to the school office.")}
                  actions={!isManager && <Button icon={Plus} onClick={() => setNewOpen(true)}>{t("New message")}</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-2">
          {(data || []).length === 0 && <EmptyState icon={MessageSquare} title={t("No conversations")} />}
          {(data || []).map((th) => (
            <button key={th.id} type="button" onClick={() => setActive(th.id)}
                    className={cx("w-full rounded-xl border p-3 text-start", active === th.id ? "border-brand bg-brand/5" : "border-slate-200 bg-white")}>
              <div className="flex justify-between gap-2"><span className="truncate font-medium">{th.subject}</span>{th.status === "open" ? <Badge tone="yellow">{t("Open")}</Badge> : <Badge>{t("Closed")}</Badge>}</div>
              <div className="text-xs text-slate-500">{isManager ? th.parent_name : ""} {th.student_name ? `· ${th.student_name}` : ""} · {fmtDate(th.updated_at)}</div>
            </button>
          ))}
        </div>
        {thread ? (
          <Card title={thread.subject} actions={isManager && thread.status === "open" && <Button size="sm" variant="secondary" onClick={async () => { await run(() => api.post(`${base}/threads/${thread.id}/close/`)); reload(); }}>{t("Close")}</Button>}>
            <div className="space-y-2">{thread.messages.map((m) => (
              <div key={m.id} className={cx("max-w-[85%] rounded-xl p-2 text-sm", m.from_school ? "ms-auto bg-brand/10" : "bg-slate-100")}>
                <div className="whitespace-pre-wrap">{m.body}</div><div className="mt-1 text-[11px] text-slate-500">{m.author_name} · {fmtDateTime(m.created_at)}</div></div>))}</div>
            <div className="mt-3 flex gap-2"><Textarea className="flex-1" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t("Write a reply")} />
              <Button icon={Send} onClick={send} loading={busy} disabled={!reply.trim()}>{t("Send")}</Button></div>
          </Card>
        ) : <div className="hidden lg:block"><EmptyState title={t("Choose a conversation")} /></div>}
      </div>
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title={t("New message")}
             footer={<Button icon={Send} onClick={create} loading={busy} disabled={!draft.subject || !draft.body}>{t("Send")}</Button>}>
        {faqs?.length > 0 && (
          <details className="mb-3 rounded-lg bg-amber-50 p-2 text-sm"><summary className="cursor-pointer font-medium text-amber-900">{t("Maybe your question is already answered")}</summary>
            <ul className="mt-2 space-y-2">{faqs.map((f) => <li key={f.id}><div className="font-medium">{f.question}</div><div className="text-slate-600">{f.answer}</div></li>)}</ul></details>
        )}
        <div className="grid gap-3">
          <Select label={t("About")} value={draft.student} placeholder={t("General")} options={(kids?.children || []).map((c) => ({ value: c.child.id, label: c.child.full_name }))}
                  onChange={(e) => setDraft({ ...draft, student: e.target.value })} />
          <Input label={t("Subject")} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          <Textarea label={t("Message")} rows={5} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}

export function CalendarPage() {
  const { t } = useTranslation();
  const { base, isManager } = useAuth();
  const [noSchool, setNoSchool] = useState(false);
  const [form, setForm] = useState({ date: addDays(todayISO(), 1), reason: "" });
  const [run, busy] = useAction();
  const kinds = ["event", "holiday", "exam", "no_school", "term"].map((v) => ({ value: v, label: eventKindLabel(t, v) }));
  const tone = { holiday: "green", exam: "purple", no_school: "red", term: "blue", event: "gray" };
  const send = async () => { await run(() => api.post(`${base}/calendar/no-school/`, form), t("Everyone has been told")); setNoSchool(false); window.location.reload(); };
  return (
    <>
      <ResourcePage title={t("School calendar")} path="calendar" canEdit={isManager} searchable={false}
        params={{ from: addDays(todayISO(), -30) }}
        headerActions={isManager && <Button variant="danger" icon={CalendarX} onClick={() => setNoSchool(true)}>{t("No school tomorrow")}</Button>}
        defaults={{ kind: "event", start_date: todayISO(), end_date: todayISO() }}
        columns={[
          { key: "start_date", label: t("Date"), render: (e) => e.start_date === e.end_date ? fmtDate(e.start_date, { weekday: "short", day: "numeric", month: "short" }) : `${fmtDate(e.start_date)} - ${fmtDate(e.end_date)}` },
          { key: "title", label: t("What"), render: (e) => <span className="font-medium">{e.title}</span> },
          { key: "kind", label: t("Type"), render: (e) => <Badge tone={tone[e.kind]}>{eventKindLabel(t, e.kind)}</Badge> },
          { key: "grade_level", label: t("For"), render: (e) => e.grade_level ? t("Grade {{n}}", { n: e.grade_level }) : t("Everyone") },
        ]}
        fields={[{ name: "title", label: t("Title"), required: true, wide: true }, { name: "kind", label: t("Type"), type: "select", options: kinds, placeholder: undefined },
          { name: "grade_level", label: t("Only for grade (optional)"), type: "number" }, { name: "start_date", label: t("From"), type: "date" },
          { name: "end_date", label: t("To"), type: "date" }, { name: "description", label: t("Details"), type: "textarea" }]}
      />
      <Modal open={noSchool} onClose={() => setNoSchool(false)} title={t("No school")}
             footer={<Button variant="danger" icon={Megaphone} onClick={send} loading={busy}>{t("Tell everyone")}</Button>}>
        <p className="mb-3 text-sm text-slate-600">{t("Adds the day to the calendar and sends an urgent message to every parent and staff member.")}</p>
        <div className="grid gap-3"><Input label={t("Date")} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label={t("Reason")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={t("e.g. snow storm")} /></div>
      </Modal>
    </>
  );
}

export function FAQPage() {
  const { t } = useTranslation();
  const { base, isManager } = useAuth();
  const { data, loading } = useFetch(base && !isManager ? `${base}/faqs/` : null);
  if (isManager) {
    return <ResourcePage title={t("Frequently asked questions")} path="faqs" subtitle={t("Parents see these before writing a message.")}
                         columns={[{ key: "question", label: t("Question") }, { key: "answer", label: t("Answer") }]}
                         fields={[{ name: "question", label: t("Question"), required: true, wide: true }, { name: "answer", label: t("Answer"), type: "textarea", required: true },
                           { name: "order", label: t("Order"), type: "number" }]} />;
  }
  if (loading) return <Loading />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("Frequently asked questions")} />
      {data?.length ? <div className="space-y-2">{data.map((f) => (
        <details key={f.id} className="rounded-xl border border-slate-200 bg-white p-3"><summary className="cursor-pointer font-medium">{f.question}</summary>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{f.answer}</p></details>))}</div> : <EmptyState icon={HelpCircle} title={t("No questions yet")} />}
    </div>
  );
}

