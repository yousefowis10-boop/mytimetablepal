import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api, { clearTokens, hasToken, setTokens } from "../lib/api";
import { setLanguage, storedLanguage } from "../i18n";

const AuthContext = createContext(null);
const SCHOOL_KEY = "school_id";

function readSchool() {
  try {
    return Number(localStorage.getItem(SCHOOL_KEY)) || null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(hasToken());
  const [schoolId, setSchoolId] = useState(readSchool());

  const loadMe = useCallback(async () => {
    if (!hasToken()) {
      setMe(null);
      setLoading(false);
      return null;
    }
    try {
      const { data } = await api.get("/me/");
      setMe(data);
      if (data.language && !storedLanguage()) setLanguage(data.language);
      return data;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
    const onLogout = () => {
      setMe(null);
    };
    window.addEventListener("auth:logout", onLogout);
    return () => window.removeEventListener("auth:logout", onLogout);
  }, [loadMe]);

  const schools = useMemo(() => me?.schools || [], [me]);
  const school = schools.find((s) => s.school_id === schoolId) || schools[0] || null;

  useEffect(() => {
    if (school && school.school_id !== schoolId) {
      setSchoolId(school.school_id);
    }
    const hex = /^#[0-9a-f]{6}$/i.test(school?.brand_color || "") ? school.brand_color : "#2563eb";
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
    document.documentElement.style.setProperty("--brand-rgb", rgb);
  }, [school, schoolId]);

  const switchSchool = useCallback((id) => {
    setSchoolId(id);
    try {
      localStorage.setItem(SCHOOL_KEY, String(id));
    } catch {
      /* ignore */
    }
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post("/token/", { username: email.trim().toLowerCase(), password });
    setTokens(data);
    setLoading(true);
    return loadMe();
  }, [loadMe]);

  const loginWithTokens = useCallback(async (tokens, newSchoolId) => {
    setTokens(tokens);
    if (newSchoolId) switchSchool(newSchoolId);
    setLoading(true);
    return loadMe();
  }, [loadMe, switchSchool]);

  const logout = useCallback(() => {
    clearTokens();
    setMe(null);
  }, []);

  const value = useMemo(() => {
    const roles = new Set(school?.roles || []);
    const modules = new Set(school?.modules || []);
    return {
      me, loading, school, schools, schoolId: school?.school_id || null, roles,
      login, loginWithTokens, logout, loadMe, switchSchool,
      hasRole: (...r) => r.some((x) => roles.has(x)),
      hasModule: (m) => !m || modules.has(m),
      isStaff: ["admin", "staff", "teacher"].some((x) => roles.has(x)),
      isManager: ["admin", "staff"].some((x) => roles.has(x)),
      isOwner: !!me?.is_platform_owner,
      base: school ? `/schools/${school.school_id}` : null,
    };
  }, [me, loading, school, schools, login, loginWithTokens, logout, loadMe, switchSchool]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
