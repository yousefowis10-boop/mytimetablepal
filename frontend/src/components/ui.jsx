import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Inbox, Loader2, RefreshCw, X } from "lucide-react";

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

const BUTTON = {
  primary: "bg-brand text-white hover:brightness-110 shadow-sm",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-slate-600 hover:bg-slate-100",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
};

export function Button({ variant = "primary", size = "md", loading, icon: Icon, className, children, ...rest }) {
  const sizes = { sm: "px-2.5 py-1.5 text-sm", md: "px-4 py-2 text-sm", lg: "px-5 py-3 text-base" };
  return (
    <button
      type="button"
      {...rest}
      disabled={loading || rest.disabled}
      className={cx("inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
        BUTTON[variant], sizes[size], className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className, padded = true }) {
  return (
    <section className={cx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="font-semibold text-slate-800">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

function FieldShell({ label, hint, error, children, id, className }) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      {label && <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>}
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

const INPUT = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-100";

export function Input({ label, hint, error, className, ...rest }) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} id={id} className={className}>
      <input id={id} className={INPUT} {...rest} />
    </FieldShell>
  );
}

export function Textarea({ label, hint, error, className, ...rest }) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} id={id} className={className}>
      <textarea id={id} rows={rest.rows || 3} className={INPUT} {...rest} />
    </FieldShell>
  );
}

export function Select({ label, hint, error, options = [], placeholder, className, ...rest }) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} id={id} className={className}>
      <select id={id} className={INPUT} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </FieldShell>
  );
}

export function Checkbox({ label, className, ...rest }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx("inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700", className)}>
      <input id={id} type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand accent-[var(--brand)]" {...rest} />
      {label}
    </label>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
           className={cx("max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
           onMouseDown={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label={t("Close")}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Loading({ label }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-slate-500" role="status">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="text-sm">{label || t("Loading...")}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{typeof error === "string" ? error : t("Something went wrong.")}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-medium underline">
          <RefreshCw className="h-3.5 w-3.5" /> {t("Try again")}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center">
      <Icon className="h-8 w-8 text-slate-400" />
      <p className="font-medium text-slate-700">{title}</p>
      {text && <p className="max-w-md text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const TONES = {
  gray: "bg-slate-100 text-slate-700",
  blue: "bg-blue-100 text-blue-800",
  green: "bg-emerald-100 text-emerald-800",
  yellow: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  purple: "bg-violet-100 text-violet-800",
};

export function Badge({ tone = "gray", children, className }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>{children}</span>;
}

export function Stat({ label, value, hint, tone = "blue", icon: Icon, onClick }) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper onClick={onClick} type={onClick ? "button" : undefined}
             className={cx("flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-start shadow-sm", onClick && "hover:border-brand")}>
      {Icon && <div className={cx("rounded-lg p-2", TONES[tone])}><Icon className="h-5 w-5" /></div>}
      <div className="min-w-0">
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        <div className="truncate text-sm text-slate-600">{label}</div>
        {hint && <div className="text-xs text-slate-400">{hint}</div>}
      </div>
    </Wrapper>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} type="button" role="tab" aria-selected={value === tab.value}
                onClick={() => onChange(tab.value)}
                className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
                  value === tab.value ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800")}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Table on wide screens, stacked cards on phones. columns: [{key, label, render?, className?}] */
export function DataTable({ columns, rows, onRowClick, empty, rowKey = "id" }) {
  if (!rows?.length) return empty || null;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cx("px-3 py-2 text-start font-semibold text-slate-600", c.className)}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r[rowKey]} onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={onRowClick ? "cursor-pointer hover:bg-slate-50" : ""}>
                {columns.map((c) => (
                  <td key={c.key} className={cx("px-3 py-2 align-top text-slate-700", c.className)}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r[rowKey]} onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cx("rounded-xl border border-slate-200 bg-white p-3 shadow-sm", onRowClick && "active:bg-slate-50")}>
            {columns.map((c, i) => {
              const v = c.render ? c.render(r) : r[c.key];
              if (v === null || v === undefined || v === "") return null;
              return i === 0 ? (
                <div key={c.key} className="mb-1 font-semibold text-slate-900">{v}</div>
              ) : (
                <div key={c.key} className="flex justify-between gap-3 text-sm">
                  <span className="text-slate-500">{c.label}</span>
                  <span className="text-end text-slate-800">{v}</span>
                </div>
              );
            })}
          </li>
        ))}
      </ul>
    </>
  );
}
