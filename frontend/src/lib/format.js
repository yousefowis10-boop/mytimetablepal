import i18n from "../i18n";

// Jordan formats: Arabic uses Arabic-Indic digits, English uses Latin digits. JOD has 3 decimals (fils).
const locale = () => (i18n.language === "ar" ? "ar-JO" : "en-JO");

export function fmtDate(value, opts = { day: "numeric", month: "short", year: "numeric" }) {
  if (!value) return "";
  const d = typeof value === "string" && value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(locale(), opts).format(d);
}

export function fmtDateTime(value) {
  return fmtDate(value, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtTime(value) {
  if (!value) return "";
  const [h, m] = String(value).split(":");
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  return new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(d);
}

export function fmtNumber(value, digits = 0) {
  if (value === null || value === undefined || value === "") return "";
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(Number(value));
}

export function fmtMoney(value, currency = "JOD") {
  if (value === null || value === undefined || value === "") return "";
  const decimals = currency === "JOD" || currency === "KWD" || currency === "BHD" ? 3 : 2;
  return new Intl.NumberFormat(locale(), { style: "currency", currency, minimumFractionDigits: decimals,
                                           maximumFractionDigits: decimals }).format(Number(value));
}

// Day codes used by the API: 7 = Sunday, 1 = Monday ... 6 = Saturday.
export function dayName(code, style = "long") {
  const base = new Date(2026, 9, 25); // a Sunday
  const offset = code % 7;          // Sunday -> 0
  const d = new Date(base);
  d.setDate(base.getDate() + offset);
  return new Intl.DateTimeFormat(locale(), { weekday: style }).format(d);
}

export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
