import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarClock, KeyRound, School } from "lucide-react";
import api, { errorText } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { LanguageToggle } from "../components/Layout";
import { Button, ErrorBox, Input } from "../components/ui";
import { roleLabel } from "../lib/labels";

function Shell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-blue-50 via-white to-emerald-50 px-4 py-10">
      <div className="absolute end-4 top-4"><LanguageToggle /></div>
      <div className="mb-6 flex items-center gap-2 text-xl font-bold text-slate-800">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white"><CalendarClock className="h-6 w-6" /></span>
        MyTimetablePal
      </div>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {footer && <div className="mt-4 text-center text-sm text-slate-600">{footer}</div>}
    </div>
  );
}

export function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form.email, form.password);
      navigate("/");
    } catch (err) {
      setError(err.response?.status === 401 ? t("Wrong email or password.") : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={t("Log in")} subtitle={t("School timetables, attendance, fees, buses and parents - in one place.")}
           footer={<div className="space-y-2">
             <div><Link to="/signup" className="font-medium text-brand">{t("Register your school")}</Link> · <Link to="/join" className="font-medium text-brand">{t("I have an invitation code")}</Link></div>
           </div>}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBox error={error} />
        <Input label={t("Email")} type="email" autoComplete="username" required value={form.email}
               onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label={t("Password")} type="password" autoComplete="current-password" required value={form.password}
               onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <Button type="submit" className="w-full" size="lg" loading={busy}>{t("Log in")}</Button>
      </form>
    </Shell>
  );
}

export function SignupSchool() {
  const { t, i18n } = useTranslation();
  const { loginWithTokens } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ school_name: "", city: "Amman", phone: "", first_name: "", last_name: "", email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const { data } = await api.post("/signup/school/", { ...form, language: i18n.language });
      await loginWithTokens(data, data.school_id);
      navigate("/setup");
    } catch (err) {
      const d = err.response?.data;
      setErrors(d && typeof d === "object" ? d : { detail: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  const err = (k) => errors[k]?.join?.(" ") || errors[k];

  return (
    <Shell title={t("Register your school")} subtitle={t("Free for 30 days. No card needed. Each school's data is kept completely separate.")}
           footer={<Link to="/login" className="text-brand">{t("I already have an account")}</Link>}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <ErrorBox error={errors.detail} />
        <Input className="sm:col-span-2" label={t("School name")} required value={form.school_name} onChange={set("school_name")} error={err("school_name")} />
        <Input label={t("City")} value={form.city} onChange={set("city")} />
        <Input label={t("Phone")} type="tel" value={form.phone} onChange={set("phone")} />
        <Input label={t("Your first name")} required value={form.first_name} onChange={set("first_name")} error={err("first_name")} />
        <Input label={t("Your last name")} value={form.last_name} onChange={set("last_name")} />
        <Input className="sm:col-span-2" label={t("Email")} type="email" required value={form.email} onChange={set("email")} error={err("email")} />
        <Input className="sm:col-span-2" label={t("Password")} type="password" required value={form.password} onChange={set("password")}
               error={err("password")} hint={t("At least 8 characters, not only numbers.")} />
        <Button type="submit" className="sm:col-span-2" size="lg" icon={School} loading={busy}>{t("Create my school")}</Button>
      </form>
    </Shell>
  );
}

export function Join() {
  const { t, i18n } = useTranslation();
  const { me, loginWithTokens } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("code") || "");
  const [invite, setInvite] = useState(null);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (code.trim().length < 6) {
      setInvite(null);
      return;
    }
    api.get(`/invitations/${code.trim().toUpperCase()}/`).then((r) => {
      setInvite(r.data);
      setError(null);
      if (r.data.email) setForm((f) => ({ ...f, email: f.email || r.data.email }));
    }).catch((err) => { setInvite(null); setError(errorText(err)); });
  }, [code]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/invitations/accept/", { code: code.trim().toUpperCase(), ...(me ? {} : form), language: i18n.language });
      await loginWithTokens(data, data.school_id);
      navigate("/");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={t("Join your school")} subtitle={t("Enter the code the school gave you.")}
           footer={<Link to="/login" className="text-brand">{t("Back to log in")}</Link>}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBox error={error} />
        <Input label={t("Invitation code")} value={code} onChange={(e) => setCode(e.target.value)} required
               className="[&_input]:text-center [&_input]:font-mono [&_input]:text-lg [&_input]:uppercase [&_input]:tracking-widest" />
        {invite && (
          <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            {invite.logo ? <img src={invite.logo} alt="" className="h-10 w-10 rounded object-contain" /> : <School className="h-6 w-6" />}
            <div><div className="font-semibold">{invite.school}</div><div>{t("You will join as:")} {roleLabel(t, invite.role)}{invite.name ? ` - ${invite.name}` : ""}</div></div>
          </div>
        )}
        {me ? (
          <p className="text-sm text-slate-600">{t("The school will be added to your account ({{email}}).", { email: me.email })}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t("First name")} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            <Input label={t("Last name")} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            <Input className="sm:col-span-2" label={t("Email")} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input className="sm:col-span-2" label={t("Password")} type="password" required value={form.password}
                   hint={t("If you already have an account, use the same email and password.")}
                   onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
        )}
        <Button type="submit" className="w-full" size="lg" icon={KeyRound} loading={busy} disabled={!invite}>{t("Join")}</Button>
      </form>
    </Shell>
  );
}
