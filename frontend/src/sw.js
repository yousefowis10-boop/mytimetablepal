/* Service worker: offline app shell + web push notifications. */
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

self.skipWaiting();
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

precacheAndRoute(self.__WB_MANIFEST || []);
// Single-page app: every navigation serves index.html (API calls go to another origin and are never cached).
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data?.text() };
  }
  event.waitUntil(self.registration.showNotification(data.title || "MyTimetablePal", {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
    tag: data.kind,
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if ("focus" in w) {
        w.navigate(url);
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
