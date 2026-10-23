import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileSpreadsheet, ImagePlus, Upload } from "lucide-react";
import api, { download, errorText } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useAction, useFetch } from "../lib/hooks";
import { addDays, dayName, fmtDateTime, todayISO } from "../lib/format";
import { moduleLabel, schoolStatusLabel } from "../lib/labels";
import { MapPicker } from "../components/maps";
import { Badge, Button, Card, Checkbox, DataTable, EmptyState, ErrorBox, Input, Loading, PageHeader, Select, Textarea } from "../components/ui";

export function Reports() {
  const { t } = useTranslation();
  const { base, isManager, hasModule } = useAuth();
  const [from, setFrom] = useState(addDays(todayISO(), -30));
  const [to, setTo] = useState(todayISO());
  const { data: terms } = useFetch(base && hasModule("grades") ? `${base}/terms/` : null);
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(null);
  const get = async (key, url, name) => {
    setBusy(key);
    try { await download(url, name); } catch (e) { window.alert(errorText(e)); } finally { setBusy(null); }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t("Reports & exports")} subtitle={t("Excel files you can open, filter and print. Report cards, receipts and timetables also have a Print button that saves as PDF.")} />
      {hasModule("attendance") && (
        <Card title={t("Attendance")}><div className="flex flex-wrap items-end gap-2">
          <Input label={t("From")} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label={t("To")} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button icon={Download} loading={busy === "a"} onClick={() => get("a", `${base}/export/attendance/?from=${from}&to=${to}`, "attendance.xlsx")}>{t("Download")}</Button>
        </div></Card>
      )}
      {hasModule("grades") && (
        <Card title={t("Grades")}><div className="flex flex-wrap items-end gap-2">
          <Select label={t("Term")} value={term} placeholder={t("Latest term")} options={(terms || []).map((x) => ({ value: x.id, label: x.name }))} onChange={(e) => setTerm(e.target.value)} />
          <Button icon={Download} loading={busy === "g"} onClick={() => get("g", `${base}/export/grades/${term ? `?term=${term}` : ""}`, "grades.xlsx")}>{t("Download")}</Button>
        </div></Card>
      )}
      {isManager && hasModule("fees") && (
        <Card title={t("Fees - balances per student")}><Button icon={Download} loading={busy === "f"} onClick={() => get("f", `${base}/export/fees/`, "fees.xlsx")}>{t("Download")}</Button></Card>
      )}
      <Card title={t("Timetables")}><div className="flex flex-wrap gap-2">
        {[["grade", t("Per class group")], ["teacher", t("Per teacher")], ["room", t("Per room")]].map(([k, label]) => (
          <Button key={k} variant="secondary" icon={FileSpreadsheet} loading={busy === k} onClick={() => get(k, `${base}/export/timetable/?type=${k}`, `timetable-${k}.xlsx`)}>{label}</Button>))}
      </div></Card>
    </div>
  );
}

const KINDS = ["subjects", "classrooms", "groups", "teachers", "students"];

export function ImportPage() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const [kind, setKind] = useState("students");
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const labels = { subjects: t("Subjects"), classrooms: t("Rooms"), groups: t("Class groups"), teachers: t("Teachers"), students: t("Students and parents") };
  const send = async (commit) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("commit", commit ? "1" : "0");
      const { data } = await api.post(`${base}/import/${kind}/`, fd);
      setResult(data);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t("Import from Excel")} subtitle={t("Import in this order: subjects, rooms, class groups, teachers, then students. Nothing is saved until you confirm the preview.")} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Select label={t("What to import")} value={kind} options={KINDS.map((k) => ({ value: k, label: labels[k] }))} onChange={(e) => { setKind(e.target.value); setResult(null); }} />
          <div className="flex flex-col gap-1"><span className="text-sm font-medium text-slate-700">{t("File (.xlsx or .csv)")}</span>
            <input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files[0]); setResult(null); }} className="text-sm" /></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" icon={Download} onClick={() => download(`${base}/import/${kind}/`, `${kind}-template.xlsx`)}>{t("Download the template")}</Button>
          <Button icon={Upload} onClick={() => send(false)} loading={busy} disabled={!file}>{t("Check file")}</Button>
        </div>
      </Card>
      <ErrorBox error={error} />
      {result && (
        <Card title={result.committed ? t("Imported") : t("Preview")}>
          {result.committed ? (
            <p className="text-emerald-700">{t("{{c}} created, {{u}} updated.", { c: result.created, u: result.updated })}</p>
          ) : (
            <>
              <p className="mb-2 text-sm">{t("{{rows}} rows: {{c}} new, {{u}} will be updated.", { rows: result.rows, c: result.would_create, u: result.would_update })}</p>
              {result.errors.length > 0 ? (
                <div className="mb-3"><Badge tone="red">{t("{{n}} problem(s) - fix the file and check again", { n: result.errors.length })}</Badge>
                  <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto ps-5 text-sm text-red-700">{result.errors.map((e, i) => <li key={i}>{t("Line {{n}}", { n: e.line })}: {e.error}</li>)}</ul></div>
              ) : <Button icon={Upload} onClick={() => send(true)} loading={busy}>{t("Import now")}</Button>}
              {result.preview.length > 0 && <pre className="mt-3 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-xs" dir="ltr">{JSON.stringify(result.preview, null, 1)}</pre>}
            </>
          )}
        </Card>
      )}
    </div>
  );
}

export function AuditLog() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const [model, setModel] = useState("");
  const { data, loading, error } = useFetch(base ? `${base}/audit/` : null, { params: model ? { model } : {} });
  return (
    <div className="space-y-4">
      <PageHeader title={t("Audit log")} subtitle={t("Who changed timetables, grades, fees and settings - and who looked at live bus locations.")}
                  actions={<Select value={model} onChange={(e) => setModel(e.target.value)} placeholder={t("Everything")}
                                   options={[{ value: "Timetable", label: t("Timetables") }, { value: "Grade", label: t("Grades") }, { value: "Payment", label: t("Payments") },
                                     { value: "Fee", label: t("Fees") }, { value: "transport", label: t("Bus tracking") }, { value: "School", label: t("Settings") }]} />} />
      <ErrorBox error={error} />
      {loading ? <Loading /> : (
        <DataTable rows={data || []} empty={<EmptyState title={t("Nothing recorded yet")} />} columns={[
          { key: "at", label: t("When"), render: (a) => fmtDateTime(a.at) }, { key: "user", label: t("Who") },
          { key: "action", label: t("Action"), render: (a) => <Badge tone={{ delete: "red", create: "green", view: "gray" }[a.action] || "blue"}>{a.action}</Badge> },
          { key: "summary", label: t("What"), render: (a) => <span dir="auto">{a.summary}</span> },
        ]} />
      )}
    </div>
  );
}

export function SchoolSettings() {
  const { t } = useTranslation();
  const { base, loadMe } = useAuth();
  const { data, loading, error, setData } = useFetch(base ? `${base}/` : null);
  const [run, busy] = useAction();
  const [scale, setScale] = useState("");
  useEffect(() => { if (data) setScale((data.grading_scale || []).map((b) => `${b.min}=${b.label}`).join("\n")); }, [data]);
  if (loading || !data) return error ? <ErrorBox error={error} /> : <Loading />;
  const set = (k) => (e) => setData({ ...data, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value });
  const days = data.week_days.split(",").map(Number);
  const toggleDay = (d) => setData({ ...data, week_days: (days.includes(d) ? days.filter((x) => x !== d) : [...days, d]).sort((a, b) => ((a % 7) - (b % 7))).join(",") });
  const onLogo = (file) => {
    if (!file) return;
    if (file.size > 300 * 1024) { window.alert(t("Please use an image under 300 KB.")); return; }
    const r = new FileReader();
    r.onload = () => setData({ ...data, logo: r.result });
    r.readAsDataURL(file);
  };
  const save = async () => {
    const grading_scale = scale.split("\n").map((l) => l.split("=")).filter((p) => p.length === 2 && p[0].trim())
      .map(([min, label]) => ({ min: Number(min), label: label.trim() }));
    const { roles: _r, modules: _m, plan_name: _p, status: _s, trial_ends_at: _te, trial_expired: _tx, max_students: _ms, ...body } = data;
    const res = await run(() => api.patch(`${base}/`, { ...body, grading_scale }), t("Saved"));
    setData(res.data);
    loadMe();
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t("School settings")} actions={<Button onClick={save} loading={busy}>{t("Save")}</Button>} />
      <Card title={t("Plan")}>
        <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="blue">{data.plan_name || t("No plan")}</Badge>
          <Badge tone={data.status === "active" ? "green" : data.status === "trial" ? "yellow" : "red"}>{schoolStatusLabel(t, data.status)}</Badge>
          <span className="text-slate-500">{t("Up to {{n}} students", { n: data.max_students })}</span></div>
        <p className="mt-2 text-xs text-slate-500">{data.modules.map((m) => moduleLabel(t, m)).join(" · ")}</p>
      </Card>
      <Card title={t("Profile & branding")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t("School name")} value={data.name} onChange={set("name")} />
          <Input label={t("Principal")} value={data.principal_name} onChange={set("principal_name")} />
          <Input label={t("City")} value={data.city} onChange={set("city")} />
          <Input label={t("Phone")} value={data.phone} onChange={set("phone")} />
          <Input label={t("Email")} type="email" value={data.email} onChange={set("email")} />
          <Input label={t("Year founded")} type="number" value={data.established_year} onChange={set("established_year")} />
          <Textarea className="sm:col-span-2" label={t("Address")} value={data.address} onChange={set("address")} />
          <div className="flex items-center gap-3">
            {data.logo ? <img src={data.logo} alt="" className="h-16 w-16 rounded-lg border object-contain" /> : <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed"><ImagePlus className="h-6 w-6 text-slate-400" /></div>}
            <label className="cursor-pointer text-sm text-brand">{t("Upload logo")}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onLogo(e.target.files[0])} /></label>
            {data.logo && <button type="button" className="text-sm text-red-600" onClick={() => setData({ ...data, logo: "" })}>{t("Remove")}</button>}
          </div>
          <label className="flex items-center gap-3 text-sm">{t("Brand colour")}<input type="color" value={data.brand_color} onChange={set("brand_color")} className="h-10 w-16 rounded" /></label>
        </div>
      </Card>
      <Card title={t("School week & rules")}>
        <div className="mb-3"><div className="mb-1 text-sm font-medium">{t("School days")}</div>
          <div className="flex flex-wrap gap-3">{[7, 1, 2, 3, 4, 5, 6].map((d) => <Checkbox key={d} label={dayName(d)} checked={days.includes(d)} onChange={() => toggleDay(d)} />)}</div></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t("Take attendance")} value={data.attendance_mode} onChange={set("attendance_mode")} options={[{ value: "period", label: t("Every lesson") }, { value: "day", label: t("Once a day") }]} />
          <Input label={t("Flag students absent more than (%)")} type="number" value={data.absence_alert_threshold} onChange={set("absence_alert_threshold")} />
          <Select label={t("App language for new users")} value={data.default_language} onChange={set("default_language")} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
          <Input label={t("Currency")} value={data.currency} onChange={set("currency")} hint="JOD" />
          <Input label={t("Pass mark (%)")} type="number" value={data.pass_mark} onChange={set("pass_mark")} />
          <Textarea label={t("Grading scale (one per line: minimum = label)")} rows={6} value={scale} onChange={(e) => setScale(e.target.value)} hint="90=A" dir="ltr" />
          <Input label={t("Fee reminder - days before due date")} type="number" value={data.fee_reminder_days_before} onChange={set("fee_reminder_days_before")} />
          <Input label={t("Overdue reminder - days after due date")} type="number" value={data.fee_reminder_days_after} onChange={set("fee_reminder_days_after")} />
        </div>
      </Card>
      <Card title={t("School location (for bus routes)")}>
        <MapPicker value={data.latitude != null ? [data.latitude, data.longitude] : null} onChange={(p) => setData({ ...data, latitude: p[0], longitude: p[1] })} />
      </Card>
    </div>
  );
}
