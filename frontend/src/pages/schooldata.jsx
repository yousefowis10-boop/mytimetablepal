import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BookOpen, Check, Clock, Copy, KeyRound, MapPin, Plus, Trash2 } from "lucide-react";
import api from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useAction, useFetch } from "../lib/hooks";
import { fmtDate, fmtTime } from "../lib/format";
import { periodTypeLabel, roleLabel, roleOptions, roomTypeLabel, roomTypeOptions } from "../lib/labels";
import ResourcePage from "../components/ResourcePage";
import { MapPicker } from "../components/maps";
import { Badge, Button, Card, Checkbox, DataTable, EmptyState, ErrorBox, Input, Loading, Modal, PageHeader, Select } from "../components/ui";

function useOptions(path, label = "name") {
  const { base } = useAuth();
  const { data } = useFetch(base ? `${base}/${path}/` : null);
  return useMemo(() => (data || []).map((x) => ({ value: x.id, label: typeof label === "function" ? label(x) : x[label] })), [data, label]);
}

export function Teachers() {
  const { t } = useTranslation();
  const subjects = useOptions("subjects");
  return (
    <ResourcePage title={t("Teachers")} path="teachers" emptyText={t("Add teachers or import them from Excel.")}
      defaults={{ subjects: [], experience: 0 }}
      columns={[
        { key: "name", label: t("Name") },
        { key: "subject_names", label: t("Subjects"), render: (r) => r.subject_names.join(", ") },
        { key: "max_lessons_per_day", label: t("Max lessons / day"), render: (r) => r.max_lessons_per_day ?? "-" },
        { key: "user", label: t("App account"), render: (r) => r.user ? <Badge tone="green">{t("Joined")}</Badge> : <Badge>{t("Not invited")}</Badge> },
      ]}
      fields={[
        { name: "name", label: t("Name"), required: true },
        { name: "experience", label: t("Years of experience"), type: "number" },
        { name: "phone", label: t("Phone"), type: "tel" },
        { name: "email", label: t("Email"), type: "email" },
        { name: "max_lessons_per_day", label: t("Max lessons per day"), type: "number", hint: t("Leave empty for no limit") },
        { name: "max_lessons_per_week", label: t("Max lessons per week"), type: "number" },
        { name: "subjects", label: t("Subjects this teacher can teach"), type: "multiselect", options: subjects },
      ]}
      rowActions={(r) => <Link to={`/teachers/${r.id}/availability`} onClick={(e) => e.stopPropagation()}><Button size="sm" variant="ghost" icon={Clock}>{t("Availability")}</Button></Link>}
    />
  );
}

export function Subjects() {
  const { t } = useTranslation();
  return (
    <ResourcePage title={t("Subjects")} path="subjects"
      columns={[
        { key: "name", label: t("Name") }, { key: "code", label: t("Code") },
        { key: "requires_room_type", label: t("Room needed"), render: (r) => roomTypeLabel(t, r.requires_room_type) },
        { key: "is_heavy", label: t("Heavy subject"), render: (r) => (r.is_heavy ? <Check className="h-4 w-4 text-emerald-600" /> : "") },
      ]}
      fields={[
        { name: "name", label: t("Name"), required: true },
        { name: "code", label: t("Code"), required: true, hint: t("Short and unique, e.g. MATH") },
        { name: "requires_room_type", label: t("Room needed"), type: "select", options: roomTypeOptions(t, true), placeholder: undefined },
        { name: "is_heavy", label: t("Heavy subject - prefer morning lessons"), type: "checkbox" },
        { name: "description", label: t("Description"), type: "textarea" },
      ]}
      defaults={{ requires_room_type: "", is_heavy: false }}
      fromForm={(f) => ({ ...f, requires_room_type: f.requires_room_type || "" })}
    />
  );
}

export function Classrooms() {
  const { t } = useTranslation();
  return (
    <ResourcePage title={t("Rooms")} path="classrooms" defaults={{ room_type: "regular", capacity: 30 }}
      columns={[{ key: "name", label: t("Name") }, { key: "capacity", label: t("Seats") },
        { key: "room_type", label: t("Type"), render: (r) => roomTypeLabel(t, r.room_type) }]}
      fields={[{ name: "name", label: t("Name"), required: true }, { name: "capacity", label: t("Seats"), type: "number", required: true },
        { name: "room_type", label: t("Type"), type: "select", options: roomTypeOptions(t), placeholder: undefined }]}
    />
  );
}

export function Groups() {
  const { t } = useTranslation();
  const rooms = useOptions("classrooms");
  const [reqGroup, setReqGroup] = useState(null);
  return (
    <>
      <ResourcePage title={t("Class groups")} path="groups" defaults={{ size: 25 }}
        columns={[{ key: "name", label: t("Name") }, { key: "grade_level", label: t("Grade") }, { key: "size", label: t("Students") },
          { key: "classroom", label: t("Home room"), render: (r) => r.classroom?.name || "-" }]}
        fields={[{ name: "name", label: t("Name"), required: true, hint: t("e.g. Grade 5-A") },
          { name: "grade_level", label: t("Grade"), type: "number" }, { name: "size", label: t("Number of students"), type: "number" },
          { name: "classroom_id", label: t("Home room"), type: "select", options: rooms, numeric: true },
          { name: "description", label: t("Description"), type: "textarea" }]}
        toForm={(r) => ({ ...r, classroom_id: r.classroom?.id ?? null })}
        rowActions={(r) => <Button size="sm" variant="ghost" icon={BookOpen} onClick={() => setReqGroup(r)}>{t("Weekly lessons")}</Button>}
      />
      <RequirementsModal group={reqGroup} onClose={() => setReqGroup(null)} />
    </>
  );
}

function RequirementsModal({ group, onClose }) {
  const { t } = useTranslation();
  const subjects = useOptions("subjects");
  const { data, reload } = useFetch(group ? `/groups/${group.id}/requirements/` : null);
  const [row, setRow] = useState({ subject: "", lectures_per_week: 3, double_periods_per_week: 0 });
  const [run, busy] = useAction();
  const add = async () => {
    await run(() => api.post(`/groups/${group.id}/requirements/`, { ...row, subject: Number(row.subject) }), t("Saved"));
    setRow({ subject: "", lectures_per_week: 3, double_periods_per_week: 0 });
    reload();
  };
  const update = async (r, patch) => { await run(() => api.patch(`/groups/${group.id}/requirements/${r.id}/`, patch)); reload(); };
  const remove = async (r) => { await run(() => api.delete(`/groups/${group.id}/requirements/${r.id}/`)); reload(); };
  const total = (data || []).reduce((s, r) => s + r.lectures_per_week, 0);
  return (
    <Modal open={!!group} onClose={onClose} title={`${t("Weekly lessons")} - ${group?.name || ""}`} wide>
      <p className="mb-3 text-sm text-slate-500">{t("Total: {{n}} lessons per week", { n: total })}</p>
      <div className="space-y-2">
        {(data || []).map((r) => (
          <div key={r.id} className="grid grid-cols-[1fr_6rem_6rem_auto] items-end gap-2">
            <div className="pb-2 text-sm font-medium">{r.subject_name}</div>
            <Input label={t("Lessons")} type="number" min={0} defaultValue={r.lectures_per_week} onBlur={(e) => update(r, { lectures_per_week: Number(e.target.value) })} />
            <Input label={t("Doubles")} type="number" min={0} defaultValue={r.double_periods_per_week} onBlur={(e) => update(r, { double_periods_per_week: Number(e.target.value) })} />
            <Button variant="ghost" icon={Trash2} onClick={() => remove(r)} aria-label={t("Delete")} />
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-[1fr_6rem_6rem_auto] items-end gap-2 border-t border-slate-100 pt-4">
        <Select label={t("Subject")} value={row.subject} placeholder={t("Choose")} options={subjects.filter((s) => !(data || []).some((r) => r.subject === s.value))}
                onChange={(e) => setRow({ ...row, subject: e.target.value })} />
        <Input label={t("Lessons")} type="number" min={1} value={row.lectures_per_week} onChange={(e) => setRow({ ...row, lectures_per_week: Number(e.target.value) })} />
        <Input label={t("Doubles")} type="number" min={0} value={row.double_periods_per_week} onChange={(e) => setRow({ ...row, double_periods_per_week: Number(e.target.value) })} />
        <Button icon={Plus} onClick={add} loading={busy} disabled={!row.subject}>{t("Add")}</Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">{t("A double period is two lessons back to back, e.g. for labs.")}</p>
    </Modal>
  );
}

export function Students() {
  const { t } = useTranslation();
  const { isManager } = useAuth();
  const groups = useOptions("groups");
  const [mapFor, setMapFor] = useState(null);
  const toForm = (r) => ({ ...r, guardians_input: r.guardians.map((g) => ({ id: g.id, name: g.name, phone: g.phone, email: g.email,
    relation: g.relation, is_primary: g.is_primary, can_pickup: g.can_pickup })) });
  return (
    <>
      <ResourcePage title={t("Students")} path="students" canEdit={isManager}
        filters={[{ name: "group", options: groups, placeholder: t("All class groups") }]}
        defaults={{ is_active: true, guardians_input: [] }}
        columns={[
          { key: "full_name", label: t("Name") }, { key: "group_name", label: t("Class") },
          { key: "guardians", label: t("Parents"), render: (r) => r.guardians.map((g) => `${g.name}${g.phone ? ` (${g.phone})` : ""}`).join(", ") },
          { key: "bus", label: t("Bus"), render: (r) => (r.uses_bus_morning || r.uses_bus_afternoon) ? <Badge tone="blue">{t("Bus")}</Badge> : "" },
          { key: "allergies", label: t("Allergies"), render: (r) => r.allergies ? <Badge tone="red">{r.allergies}</Badge> : "" },
        ]}
        fields={[
          { name: "first_name", label: t("First name"), required: true }, { name: "last_name", label: t("Last name") },
          { name: "student_number", label: t("Student number") }, { name: "group", label: t("Class group"), type: "select", options: groups, numeric: true },
          { name: "date_of_birth", label: t("Date of birth"), type: "date" },
          { name: "gender", label: t("Gender"), type: "select", options: [{ value: "M", label: t("Boy") }, { value: "F", label: t("Girl") }] },
          { name: "emergency_contact_name", label: t("Emergency contact") }, { name: "emergency_contact_phone", label: t("Emergency phone"), type: "tel" },
          { name: "allergies", label: t("Allergies (staff only)") }, { name: "medical_notes", label: t("Medical notes (staff only)"), type: "textarea" },
          { name: "home_address", label: t("Home address"), wide: true },
          { name: "uses_bus_morning", label: t("Takes the bus in the morning"), type: "checkbox" },
          { name: "uses_bus_afternoon", label: t("Takes the bus home"), type: "checkbox" },
          { name: "guardians_input", label: t("Parents"), type: "guardians" },
          { name: "pickup_permissions", label: t("Who may pick up"), type: "pickup" },
          { name: "is_active", label: t("Active (enrolled)"), type: "checkbox" },
        ]}
        toForm={toForm}
        rowActions={(r) => isManager && <Button size="sm" variant="ghost" icon={MapPin} onClick={() => setMapFor(r)} aria-label={t("Home location")} />}
      />
      <HomeLocationModal student={mapFor} onClose={() => setMapFor(null)} />
    </>
  );
}

function HomeLocationModal({ student, onClose }) {
  const { t } = useTranslation();
  const { base } = useAuth();
  const [point, setPoint] = useState(null);
  const [address, setAddress] = useState("");
  const [run, busy] = useAction();
  useEffect(() => {
    if (student) {
      setPoint(student.home_lat != null ? [student.home_lat, student.home_lng] : null);
      setAddress(student.home_address || "");
    }
  }, [student]);
  const save = async () => {
    await run(() => api.patch(`${base}/students/${student.id}/`, { home_lat: point?.[0] ?? null, home_lng: point?.[1] ?? null, home_address: address }), t("Saved"));
    onClose();
  };
  return (
    <Modal open={!!student} onClose={onClose} title={`${t("Home location")} - ${student?.full_name || ""}`} wide
           footer={<><Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button><Button onClick={save} loading={busy}>{t("Save")}</Button></>}>
      <p className="mb-2 text-sm text-slate-500">{t("Private: only school staff and this child's parents can see it. Used to plan bus routes.")}</p>
      <Input label={t("Home address")} value={address} onChange={(e) => setAddress(e.target.value)} className="mb-2" />
      <MapPicker value={point} onChange={(p, label) => { setPoint(p); if (label && !address) setAddress(label.split(",").slice(0, 3).join(",")); }} />
    </Modal>
  );
}

export function Guardians() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const [run] = useAction();
  const [code, setCode] = useState(null);
  const invite = async (g) => {
    const res = await run(() => api.post(`${base}/invitations/`, { role: "parent", guardian_id: g.id, name: g.name, email: g.email }), t("Invitation created"));
    setCode(res.data);
  };
  return (
    <>
      <ResourcePage title={t("Parents")} path="guardians"
        columns={[{ key: "name", label: t("Name") }, { key: "phone", label: t("Phone") }, { key: "relation", label: t("Relation") },
          { key: "children", label: t("Children"), render: (r) => r.children.map((c) => c.name).join(", ") },
          { key: "joined", label: t("App"), render: (r) => r.joined ? <Badge tone="green">{t("Joined")}</Badge> : <Badge>{t("Not yet")}</Badge> }]}
        fields={[{ name: "name", label: t("Name"), required: true }, { name: "phone", label: t("Phone"), type: "tel" },
          { name: "email", label: t("Email"), type: "email" }, { name: "relation", label: t("Relation"), hint: t("Father, mother, ...") }]}
        rowActions={(r) => !r.joined && <Button size="sm" variant="ghost" icon={KeyRound} onClick={() => invite(r)}>{t("Invite")}</Button>}
      />
      <InviteCodeModal invite={code} onClose={() => setCode(null)} />
    </>
  );
}

function InviteCodeModal({ invite, onClose }) {
  const { t } = useTranslation();
  if (!invite) return null;
  const link = `${window.location.origin}/join?code=${invite.code}`;
  const text = t("Join {{school}} on MyTimetablePal: {{link}} (code {{code}})", { school: "", link, code: invite.code });
  return (
    <Modal open onClose={onClose} title={t("Invitation code")}>
      <div className="space-y-3 text-center">
        <div className="rounded-xl bg-slate-100 py-4 font-mono text-3xl tracking-widest">{invite.code}</div>
        <p className="text-sm text-slate-600">{t("Share this code or link. It works once and expires in 30 days.")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" icon={Copy} onClick={() => navigator.clipboard?.writeText(link)}>{t("Copy link")}</Button>
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><Button variant="success">{t("Share on WhatsApp")}</Button></a>
        </div>
      </div>
    </Modal>
  );
}

export function Invitations() {
  const { t } = useTranslation();
  const { base, hasRole } = useAuth();
  const teachers = useOptions("teachers");
  const [form, setForm] = useState({ role: "teacher", teacher: "", name: "", email: "" });
  const { data, reload, loading } = useFetch(base ? `${base}/invitations/` : null);
  const { data: buses } = useFetch(base ? `${base}/transport/buses/` : null);
  const [run, busy] = useAction();
  const [code, setCode] = useState(null);
  const create = async () => {
    const body = { role: form.role, name: form.name, email: form.email };
    if (form.role === "teacher" && form.teacher) body.teacher = Number(form.teacher);
    if (form.role === "driver" && form.bus) body.bus_id = Number(form.bus);
    const res = await run(() => api.post(`${base}/invitations/`, body), t("Invitation created"));
    setCode(res.data);
    reload();
  };
  const revoke = async (i) => { await run(() => api.delete(`${base}/invitations/${i.id}/`)); reload(); };
  const roles = roleOptions(t).filter((r) => r.value !== "admin" || hasRole("admin"));
  return (
    <div className="space-y-4">
      <PageHeader title={t("Invitations")} subtitle={t("Give teachers, staff, drivers and parents a code to create their login. Parents can also be invited from the Parents page.")} />
      <Card title={t("New invitation")}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Select label={t("Role")} value={form.role} options={roles} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          {form.role === "teacher" && <Select label={t("Teacher record")} value={form.teacher} placeholder={t("Choose")} options={teachers} onChange={(e) => setForm({ ...form, teacher: e.target.value })} />}
          {form.role === "driver" && <Select label={t("Bus")} value={form.bus || ""} placeholder={t("Choose")} options={(buses || []).map((b) => ({ value: b.id, label: b.name }))} onChange={(e) => setForm({ ...form, bus: e.target.value })} />}
          <Input label={t("Name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label={t("Email (optional)")} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="mt-3 flex justify-end"><Button icon={KeyRound} onClick={create} loading={busy}>{t("Create code")}</Button></div>
      </Card>
      {loading ? <Loading /> : (
        <DataTable rows={data || []} empty={<EmptyState title={t("No invitations yet")} />} columns={[
          { key: "code", label: t("Code"), render: (i) => <span className="font-mono">{i.code}</span> },
          { key: "role", label: t("Role"), render: (i) => roleLabel(t, i.role) },
          { key: "name", label: t("For"), render: (i) => i.teacher_name || i.name || i.email },
          { key: "accepted", label: t("Status"), render: (i) => i.accepted ? <Badge tone="green">{t("Used")}</Badge> : <Badge tone="yellow">{t("Waiting")}</Badge> },
          { key: "expires_at", label: t("Expires"), render: (i) => fmtDate(i.expires_at) },
          { key: "x", label: "", render: (i) => !i.accepted && <div className="flex gap-1"><Button size="sm" variant="ghost" icon={Copy} onClick={() => setCode(i)} /><Button size="sm" variant="ghost" icon={Trash2} onClick={() => revoke(i)} /></div> },
        ]} />
      )}
      <InviteCodeModal invite={code} onClose={() => setCode(null)} />
    </div>
  );
}

export function Schedules() {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data, loading, error, reload } = useFetch(base ? `${base}/schedules/` : null);
  const [run, busy] = useAction();
  const [name, setName] = useState("");
  const create = async () => { await run(() => api.post(`${base}/schedules/`, { name, is_active: true }), t("Created")); setName(""); reload(); };
  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title={t("Bell schedule")} subtitle={t("Lesson periods and breaks of the school day. The timetable uses lesson and lab periods only.")} />
      <ErrorBox error={error} onRetry={reload} />
      {(data || []).map((s) => <PeriodsCard key={s.id} schedule={s} onChange={reload} />)}
      <Card title={t("New schedule")}>
        <div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Main schedule")} className="flex-1" />
          <Button icon={Plus} onClick={create} loading={busy} disabled={!name}>{t("Add")}</Button></div>
      </Card>
    </div>
  );
}

function PeriodsCard({ schedule, onChange }) {
  const { t } = useTranslation();
  const { base } = useAuth();
  const [run, busy] = useAction();
  const periods = [...schedule.periods].sort((a, b) => a.order - b.order);
  const last = periods[periods.length - 1];
  const [row, setRow] = useState({ name: "", start_time: last?.end_time?.slice(0, 5) || "07:45", end_time: "", type: "lecture" });
  const add = async () => {
    await run(() => api.post(`${base}/schedules/${schedule.id}/periods/`, { ...row, order: (last?.order || 0) + 1 }), t("Saved"));
    setRow({ name: "", start_time: row.end_time, end_time: "", type: "lecture" });
    onChange();
  };
  const remove = async (p) => { await run(() => api.delete(`${base}/schedules/${schedule.id}/periods/${p.id}/`)); onChange(); };
  return (
    <Card title={schedule.name}>
      <DataTable rows={periods} empty={<p className="text-sm text-slate-500">{t("No periods yet.")}</p>} columns={[
        { key: "name", label: t("Name") }, { key: "time", label: t("Time"), render: (p) => `${fmtTime(p.start_time)} - ${fmtTime(p.end_time)}` },
        { key: "type", label: t("Type"), render: (p) => <Badge tone={p.type === "break" ? "yellow" : "blue"}>{periodTypeLabel(t, p.type)}</Badge> },
        { key: "available_teachers", label: t("Teachers available"), render: (p) => p.type === "break" ? "" : <Link className="text-brand" to={`/periods/${p.id}/availability`}>{p.available_teachers.length || t("not set")}</Link> },
        { key: "x", label: "", render: (p) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(p)} /> },
      ]} />
      <div className="mt-3 grid grid-cols-2 items-end gap-2 border-t border-slate-100 pt-3 sm:grid-cols-5">
        <Input label={t("Name")} value={row.name} onChange={(e) => setRow({ ...row, name: e.target.value })} />
        <Input label={t("Start")} type="time" value={row.start_time} onChange={(e) => setRow({ ...row, start_time: e.target.value })} />
        <Input label={t("End")} type="time" value={row.end_time} onChange={(e) => setRow({ ...row, end_time: e.target.value })} />
        <Select label={t("Type")} value={row.type} onChange={(e) => setRow({ ...row, type: e.target.value })}
                options={["lecture", "lab", "break", "other"].map((v) => ({ value: v, label: periodTypeLabel(t, v) }))} />
        <Button icon={Plus} onClick={add} loading={busy} disabled={!row.name || !row.end_time}>{t("Add")}</Button>
      </div>
    </Card>
  );
}

/** Which teachers can teach in one period (every school day). */
export function PeriodAvailability({ periodId }) {
  const { t } = useTranslation();
  const { data, loading, reload } = useFetch(`/periods/${periodId}/teacher_availability/`);
  const [selected, setSelected] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setSelected(new Set(data.filter((x) => x.available).map((x) => x.id))); }, [data]);
  if (loading || !selected) return <Loading />;
  const save = async () => { await run(() => api.post(`/periods/${periodId}/teacher_availability/`, { teachers: [...selected] }), t("Saved")); reload(); };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("Teachers available in this period")} subtitle={t("Unticked teachers will never get a lesson in this period. If nobody is ticked for a teacher anywhere, they count as always available.")}
                  actions={<><Button variant="secondary" onClick={() => setSelected(new Set(data.map((x) => x.id)))}>{t("Select all")}</Button><Button onClick={save} loading={busy}>{t("Save")}</Button></>} />
      <Card><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((x) => <Checkbox key={x.id} label={x.name} checked={selected.has(x.id)}
                                   onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(x.id); else n.delete(x.id); setSelected(n); }} />)}
      </div></Card>
    </div>
  );
}

/** Availability of one teacher across the periods of every schedule. */
export function TeacherAvailability({ teacherId }) {
  const { t } = useTranslation();
  const { base } = useAuth();
  const { data: schedules, loading } = useFetch(base ? `${base}/schedules/` : null);
  const { data: teacher } = useFetch(base ? `${base}/teachers/${teacherId}/` : null);
  const [state, setState] = useState({});
  const [run, busy] = useAction();
  const periods = (schedules || []).flatMap((s) => s.periods.filter((p) => p.type !== "break").map((p) => ({ ...p, schedule: s.name })));
  useEffect(() => {
    const init = {};
    periods.forEach((p) => { init[p.id] = p.available_teachers.some((x) => x.id === Number(teacherId)); });
    setState(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, teacherId]);
  const save = async () => {
    await run(async () => {
      for (const p of periods) {
        const current = new Set(p.available_teachers.map((x) => x.id));
        const want = state[p.id];
        if (want === current.has(Number(teacherId))) continue;
        if (want) current.add(Number(teacherId)); else current.delete(Number(teacherId));
        await api.post(`/periods/${p.id}/teacher_availability/`, { teachers: [...current] });
      }
    }, t("Saved"));
  };
  if (loading) return <Loading />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`${t("Availability")} - ${teacher?.name || ""}`} subtitle={t("Tick the periods this teacher can teach (every school day).")}
                  actions={<Button onClick={save} loading={busy}>{t("Save")}</Button>} />
      <Card><div className="grid gap-2 sm:grid-cols-2">
        {periods.map((p) => <Checkbox key={p.id} label={`${p.name} (${fmtTime(p.start_time)})`} checked={!!state[p.id]}
                                      onChange={(e) => setState({ ...state, [p.id]: e.target.checked })} />)}
      </div></Card>
    </div>
  );
}
