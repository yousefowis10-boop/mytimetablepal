import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./index.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </StrictMode>,
);

// Installable app + offline shell + push notifications (service worker built by vite-plugin-pwa).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
