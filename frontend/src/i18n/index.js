import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./ar.json";

// English text is the key; ar.json holds the Arabic translation of every key (checked by a test).
const STORAGE_KEY = "lang";

export function storedLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function applyDirection(lng) {
  const dir = lng === "ar" ? "rtl" : "ltr";
  document.documentElement.setAttribute("dir", dir);
  document.documentElement.setAttribute("lang", lng);
}

export function setLanguage(lng) {
  i18n.changeLanguage(lng);
  applyDirection(lng);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* private mode */
  }
}

// Saved choice first; otherwise Arabic unless the browser is set to English.
const initial = storedLanguage() || ((navigator.language || "").startsWith("en") ? "en" : "ar");

i18n.use(initReactI18next).init({
  resources: { en: { translation: {} }, ar: { translation: ar } },
  lng: initial,
  fallbackLng: "en",
  keySeparator: false,
  nsSeparator: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});
applyDirection(initial);

export default i18n;
