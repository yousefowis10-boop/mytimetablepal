import axios from "axios";
import i18n from "../i18n";
import { API_BASE_URL, TOKEN_KEY } from "../config/api";

export const REFRESH_KEY = "refresh_token";

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function setTokens({ access, refresh }) {
  write(TOKEN_KEY, access);
  if (refresh !== undefined) write(REFRESH_KEY, refresh);
}

export function clearTokens() {
  write(TOKEN_KEY, null);
  write(REFRESH_KEY, null);
}

export function hasToken() {
  return !!read(TOKEN_KEY);
}

const api = axios.create({ baseURL: API_BASE_URL, timeout: 120000 });

api.interceptors.request.use((config) => {
  const token = read(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers["Accept-Language"] = i18n.language || "ar";
  return config;
});

let refreshing = null;
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    if (status === 401 && !original._retry && read(REFRESH_KEY) && !original.url?.includes("/token/")) {
      original._retry = true;
      try {
        refreshing = refreshing || axios.post(`${API_BASE_URL}/token/refresh/`, { refresh: read(REFRESH_KEY) });
        const { data } = await refreshing;
        setTokens({ access: data.access });
        return api(original);
      } catch {
        clearTokens();
        window.dispatchEvent(new Event("auth:logout"));
      } finally {
        refreshing = null;
      }
    } else if (status === 401 && !original.url?.includes("/token/")) {
      clearTokens();
      window.dispatchEvent(new Event("auth:logout"));
    }
    return Promise.reject(error);
  }
);

/** Turn any API error into one readable sentence (already in the server's words when it sent some). */
export function errorText(err) {
  const t = i18n.t.bind(i18n);
  if (!err?.response) return t("Cannot reach the server. Check your internet connection and try again.");
  const data = err.response.data;
  if (err.response.status === 404) return t("Not found, or you do not have access.");
  if (err.response.status >= 500) return t("Something went wrong on the server. Please try again.");
  if (typeof data === "string") return data.slice(0, 300);
  const parts = [];
  const walk = (value, label) => {
    if (value == null) return;
    if (typeof value === "string") parts.push(label && !["detail", "error", "non_field_errors"].includes(label) ? `${t(label)}: ${value}` : value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v, label));
    else if (typeof value === "object") Object.entries(value).forEach(([k, v]) => walk(v, k));
  };
  walk(data);
  return parts.join(" ") || t("The request failed.");
}

/** Fetch a file (Excel export, template) with the auth header and save it. */
export async function download(url, filename) {
  const res = await api.get(url, { responseType: "blob" });
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export default api;
