const CACHE_NAME = "hsmetrics-sales-app-v79";
const ASSETS = [
  "./",
  "./index.html",
  "./auth.css",
  "./auth.js",
  "./billing.html",
  "./billing.css",
  "./billing.js",
  "./supabase-provider.js",
  "./styles.css",
  "./app.js",
  "./attendant.css",
  "./attendant.js",
  "./push-client.js",
  "./config.js",
  "./manifest.webmanifest",
  "./painel/",
  "./painel/index.html",
  "./equipe/",
  "./equipe/index.html",
  "./assets/apple-touch-icon.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/hs-metrics-written-logo.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "HS Metrics", body: event.data ? event.data.text() : "" };
  }
  const url = payload.url || self.registration.scope;
  event.waitUntil(
    self.registration.showNotification(payload.title || "HS Metrics", {
      body: payload.body || "",
      icon: new URL("./assets/icon-192.png", self.registration.scope).href,
      badge: new URL("./assets/icon-192.png", self.registration.scope).href,
      tag: payload.tag || "hs-metrics",
      data: { url }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || self.registration.scope, self.registration.scope).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.split("#")[0] === targetUrl.split("#")[0]);
      if (existing) {
        existing.navigate(targetUrl);
        return existing.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});

