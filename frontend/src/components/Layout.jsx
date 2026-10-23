import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, ChevronDown, Languages, LogOut, Menu, X } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { setLanguage } from "../i18n";
import { useFetch } from "../lib/hooks";
import { ALWAYS, OWNER, mobileTabs, visibleNav } from "../nav";
import { roleLabel } from "../lib/labels";
import { Badge, cx } from "./ui";

function NavItem({ item, onClick }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.end} onClick={onClick}
             className={({ isActive }) => cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
               isActive ? "bg-brand/10 font-semibold text-brand" : "text-slate-600 hover:bg-slate-100")}>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{t(item.label)}</span>
    </NavLink>
  );
}

function SideNav({ onNavigate }) {
  const { t } = useTranslation();
  const auth = useAuth();
  return (
    <nav className="flex flex-col gap-4 p-3" aria-label={t("Main menu")}>
      {visibleNav(auth).map((section) => (
        <div key={section.section}>
          <div className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{t(section.section)}</div>
          <div className="flex flex-col gap-0.5">
            {section.items.map((i) => <NavItem key={i.to + i.label} item={i} onClick={onNavigate} />)}
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-0.5 border-t border-slate-100 pt-3">
        {auth.isOwner && <NavItem item={OWNER} onClick={onNavigate} />}
        {ALWAYS.map((i) => <NavItem key={i.to} item={i} onClick={onNavigate} />)}
      </div>
    </nav>
  );
}

function SchoolSwitcher() {
  const { t } = useTranslation();
  const { school, schools, switchSchool } = useAuth();
  const navigate = useNavigate();
  if (!school) return null;
  const logo = school.logo ? <img src={school.logo} alt="" className="h-8 w-8 rounded-lg object-contain" /> : (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand font-bold text-white">{school.name[0]}</div>
  );
  if (schools.length < 2) {
    return <div className="flex min-w-0 items-center gap-2">{logo}<span className="truncate font-semibold text-slate-800">{school.name}</span></div>;
  }
  return (
    <label className="flex min-w-0 items-center gap-2">
      {logo}
      <span className="sr-only">{t("Switch school")}</span>
      <select value={school.school_id} onChange={(e) => { switchSchool(Number(e.target.value)); navigate("/"); }}
              className="max-w-[12rem] truncate rounded-lg border-none bg-transparent font-semibold text-slate-800 focus:ring-2 focus:ring-brand/30 sm:max-w-xs">
        {schools.map((s) => <option key={s.school_id} value={s.school_id}>{s.name}</option>)}
      </select>
    </label>
  );
}

export function LanguageToggle({ className }) {
  const { i18n, t } = useTranslation();
  const next = i18n.language === "ar" ? "en" : "ar";
  return (
    <button type="button" onClick={() => setLanguage(next)} className={cx("inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100", className)}
            aria-label={t("Change language")}>
      <Languages className="h-4 w-4" /> {next === "ar" ? "العربية" : "English"}
    </button>
  );
}

function TrialBanner() {
  const { t } = useTranslation();
  const { school, hasRole } = useAuth();
  if (!school || !hasRole("admin")) return null;
  if (school.status === "suspended") {
    return <div className="bg-red-600 px-4 py-2 text-center text-sm text-white">{t("This school's account is suspended. Please contact support.")}</div>;
  }
  if (school.trial_expired) {
    return <div className="bg-amber-500 px-4 py-2 text-center text-sm text-white">{t("Your free trial has ended. The app is read-only until a plan is chosen.")}</div>;
  }
  if (school.status === "trial" && school.trial_ends_at) {
    const days = Math.max(0, Math.ceil((new Date(school.trial_ends_at) - new Date()) / 86400000));
    return <div className="bg-brand/10 px-4 py-1.5 text-center text-xs text-brand">{t("Free trial: {{days}} days left", { days })}</div>;
  }
  return null;
}

export default function Layout() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const { data: notes } = useFetch(auth.me ? "/notifications/" : null, { params: { unread: 1 }, poll: 60000 });
  const tabs = mobileTabs(auth);

  return (
    <div className="flex min-h-screen flex-col">
      <TrialBanner />
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-4">
        <button type="button" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setDrawer(true)}
                aria-label={t("Open menu")}>
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1"><SchoolSwitcher /></div>
        <LanguageToggle className="hidden sm:inline-flex" />
        <NavLink to="/notifications" className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={t("Notifications")}>
          <Bell className="h-5 w-5" />
          {notes?.unread > 0 && (
            <span className="absolute -end-0.5 -top-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{notes.unread > 99 ? "99+" : notes.unread}</span>
          )}
        </NavLink>
        <div className="relative">
          <button type="button" onClick={() => setMenu((m) => !m)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
            <span className="hidden max-w-[10rem] truncate sm:inline">{auth.me?.first_name || auth.me?.email}</span>
            <ChevronDown className="h-4 w-4" />
          </button>
          {menu && (
            <div className="absolute end-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg" onMouseLeave={() => setMenu(false)}>
              <div className="px-2 pb-2 text-xs text-slate-500">{auth.me?.email}</div>
              <div className="mb-2 flex flex-wrap gap-1 px-2">
                {[...auth.roles].map((r) => <Badge key={r} tone="blue">{roleLabel(t, r)}</Badge>)}
              </div>
              <LanguageToggle className="w-full sm:hidden" />
              <NavLink to="/profile" onClick={() => setMenu(false)} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-slate-100">{t("My profile")}</NavLink>
              <button type="button" onClick={auth.logout} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-red-600 hover:bg-red-50">
                <LogOut className="h-4 w-4" /> {t("Log out")}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="no-print sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-e border-slate-200 bg-white lg:block">
          <SideNav />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setDrawer(false)}>
            <div className="absolute inset-0 bg-slate-900/40" />
            <aside className="absolute inset-y-0 start-0 w-72 max-w-[85vw] overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-100 p-3">
                <span className="font-semibold">{t("Menu")}</span>
                <button type="button" onClick={() => setDrawer(false)} className="rounded-lg p-1 hover:bg-slate-100" aria-label={t("Close")}><X className="h-5 w-5" /></button>
              </div>
              <SideNav onNavigate={() => setDrawer(false)} />
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 px-4 pb-24 pt-4 sm:px-6 lg:pb-8">
          <Outlet />
        </main>
      </div>

      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid border-t border-slate-200 bg-white lg:hidden"
           style={{ gridTemplateColumns: `repeat(${Math.max(tabs.length, 1)}, minmax(0, 1fr))`, paddingBottom: "env(safe-area-inset-bottom)" }}
           aria-label={t("Quick menu")}>
        {tabs.map((i) => {
          const Icon = i.icon;
          return (
            <NavLink key={i.to} to={i.to} end={i.end}
                     className={({ isActive }) => cx("flex flex-col items-center gap-0.5 py-2 text-[11px]", isActive ? "text-brand" : "text-slate-500")}>
              <Icon className="h-5 w-5" />
              <span className="truncate">{t(i.label)}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
