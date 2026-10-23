import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import api from "../lib/api";
import { useAction, useFetch } from "../lib/hooks";
import { useAuth } from "../auth/AuthContext";
import { Button, Checkbox, DataTable, EmptyState, ErrorBox, Input, Loading, Modal, PageHeader, Select, Textarea } from "./ui";

/**
 * Generic list + create/edit/delete screen.
 *   path      API path under the school, e.g. "teachers"
 *   columns   [{key, label, render?}]
 *   fields    [{name, label, type: text|number|date|time|textarea|select|multiselect|checkbox|email|tel, options?, required?, hint?}]
 *   toForm / fromForm  optional converters between API objects and form values
 */
export default function ResourcePage({
  title, subtitle, path, columns, fields, canEdit = true, defaults = {}, toForm, fromForm, filters, searchable = true,
  rowActions, headerActions, emptyText, params: extraParams, onRowClick,
}) {
  const { t } = useTranslation();
  const { base } = useAuth();
  const [q, setQ] = useState("");
  const [filterValues, setFilterValues] = useState({});
  const params = { ...(extraParams || {}), ...Object.fromEntries(Object.entries(filterValues).filter(([, v]) => v !== "")) };
  const { data, loading, error, reload } = useFetch(base ? `${base}/${path}/` : null, { params });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [run, busy] = useAction();

  const rows = useMemo(() => {
    const list = Array.isArray(data) ? data : data?.results || [];
    if (!q) return list;
    const needle = q.toLowerCase();
    return list.filter((r) => JSON.stringify(r).toLowerCase().includes(needle));
  }, [data, q]);

  const open = (row) => {
    setErrors({});
    setEditing(row || {});
    setForm(row ? (toForm ? toForm(row) : { ...row }) : { ...defaults });
  };

  const save = async () => {
    const payload = fromForm ? fromForm(form) : form;
    try {
      await run(() => (editing?.id ? api.patch(`${base}/${path}/${editing.id}/`, payload) : api.post(`${base}/${path}/`, payload)),
        editing?.id ? t("Saved") : t("Created"));
      setEditing(null);
      reload();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === "object" && !Array.isArray(d)) setErrors(d);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(t("Delete this item? This cannot be undone."))) return;
    await run(() => api.delete(`${base}/${path}/${row.id}/`), t("Deleted"));
    reload();
  };

  const cols = canEdit || rowActions ? [...columns, {
    key: "_actions", label: "", className: "w-1 whitespace-nowrap", render: (r) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {rowActions?.(r, reload)}
        {canEdit && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(r)} aria-label={t("Edit")} />}
        {canEdit && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(r)} aria-label={t("Delete")} />}
      </div>
    ),
  }] : columns;

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={<>
        {headerActions}
        {canEdit && <Button icon={Plus} onClick={() => open(null)}>{t("Add")}</Button>}
      </>} />
      {(searchable || filters) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {searchable && (
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search")}
                     className="w-full rounded-lg border border-slate-300 py-2 pe-3 ps-9 text-sm focus:border-brand focus:outline-none" />
            </div>
          )}
          {filters?.map((f) => (
            <Select key={f.name} value={filterValues[f.name] || ""} placeholder={f.placeholder || t("All")} options={f.options}
                    onChange={(e) => setFilterValues((v) => ({ ...v, [f.name]: e.target.value }))} className="min-w-[10rem]" />
          ))}
        </div>
      )}
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <DataTable columns={cols} rows={rows} onRowClick={onRowClick || (canEdit ? open : undefined)}
                   empty={<EmptyState title={t("Nothing here yet")} text={emptyText}
                                      action={canEdit && <Button icon={Plus} onClick={() => open(null)}>{t("Add the first one")}</Button>} />} />
      )}
      {rows.length > 0 && <p className="mt-2 text-xs text-slate-400">{t("{{count}} item(s)", { count: rows.length })}</p>}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t("Edit") : t("Add")} wide={fields.length > 6}
             footer={<>
               <Button variant="secondary" onClick={() => setEditing(null)}>{t("Cancel")}</Button>
               <Button onClick={save} loading={busy}>{t("Save")}</Button>
             </>}>
        <ErrorBox error={errors.non_field_errors?.join(" ") || errors.detail || errors.error || (Array.isArray(errors) ? errors.join(" ") : null)} />
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {fields.map((f) => (
            <FormField key={f.name} field={f} value={form[f.name]} error={errors[f.name]}
                       onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))} />
          ))}
          <button type="submit" className="hidden" />
        </form>
      </Modal>
    </div>
  );
}

export function FormField({ field: f, value, onChange, error }) {
  const err = Array.isArray(error) ? error.join(" ") : error;
  const wide = ["textarea", "multiselect"].includes(f.type) || f.wide;
  const common = { label: f.label, hint: f.hint, error: err, required: f.required, className: wide ? "sm:col-span-2" : "" };
  if (f.type === "textarea") return <Textarea {...common} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  if (f.type === "select") {
    return <Select {...common} value={value ?? ""} placeholder={f.placeholder ?? "—"} options={f.options || []}
                   onChange={(e) => onChange(e.target.value === "" ? null : (f.numeric ? Number(e.target.value) : e.target.value))} />;
  }
  if (f.type === "guardians") return <GuardiansEditor label={f.label} value={value || []} onChange={onChange} error={err} />;
  if (f.type === "pickup") return <PickupEditor label={f.label} value={value || []} onChange={onChange} />;
  if (f.type === "checkbox") {
    return <div className={common.className}><Checkbox label={f.label} checked={!!value} onChange={(e) => onChange(e.target.checked)} /></div>;
  }
  if (f.type === "multiselect") {
    const set = new Set(value || []);
    return (
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">{f.label}</legend>
        <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {(f.options || []).map((o) => (
            <Checkbox key={o.value} label={o.label} checked={set.has(o.value)}
                      onChange={(e) => { const n = new Set(set); if (e.target.checked) n.add(o.value); else n.delete(o.value); onChange([...n]); }} />
          ))}
        </div>
        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      </fieldset>
    );
  }
  return <Input {...common} type={f.type || "text"} step={f.step} min={f.min} value={value ?? ""}
                onChange={(e) => onChange(f.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} />;
}

function GuardiansEditor({ label, value, onChange, error }) {
  const { t } = useTranslation();
  const set = (i, k, v) => onChange(value.map((g, j) => (j === i ? { ...g, [k]: v } : g)));
  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="text-sm font-medium text-slate-700">{label}</legend>
      {value.map((g, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Input placeholder={t("Name")} value={g.name || ""} onChange={(e) => set(i, "name", e.target.value)} />
          <Input placeholder={t("Phone")} type="tel" value={g.phone || ""} onChange={(e) => set(i, "phone", e.target.value)} />
          <Input placeholder={t("Relation")} value={g.relation || ""} onChange={(e) => set(i, "relation", e.target.value)} />
          <Button variant="ghost" icon={Trash2} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t("Remove")} />
          <Input className="col-span-2 sm:col-span-2" placeholder={t("Email")} type="email" value={g.email || ""} onChange={(e) => set(i, "email", e.target.value)} />
          <div className="col-span-2 flex flex-wrap items-center gap-3">
            <Checkbox label={t("Main contact")} checked={!!g.is_primary} onChange={(e) => set(i, "is_primary", e.target.checked)} />
            <Checkbox label={t("May pick up")} checked={g.can_pickup !== false} onChange={(e) => set(i, "can_pickup", e.target.checked)} />
          </div>
        </div>
      ))}
      <Button variant="secondary" size="sm" icon={Plus} onClick={() => onChange([...value, { name: "", is_primary: value.length === 0, can_pickup: true }])}>{t("Add parent")}</Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </fieldset>
  );
}

function PickupEditor({ label, value, onChange }) {
  const { t } = useTranslation();
  const set = (i, k, v) => onChange(value.map((g, j) => (j === i ? { ...g, [k]: v } : g)));
  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="text-sm font-medium text-slate-700">{label}</legend>
      {value.map((p, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
          <Input placeholder={t("Name")} value={p.name || ""} onChange={(e) => set(i, "name", e.target.value)} />
          <Input placeholder={t("Relation")} value={p.relation || ""} onChange={(e) => set(i, "relation", e.target.value)} />
          <Input placeholder={t("Phone")} type="tel" value={p.phone || ""} onChange={(e) => set(i, "phone", e.target.value)} />
          <Button variant="ghost" icon={Trash2} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t("Remove")} />
        </div>
      ))}
      <Button variant="secondary" size="sm" icon={Plus} onClick={() => onChange([...value, { name: "" }])}>{t("Add person")}</Button>
    </fieldset>
  );
}
