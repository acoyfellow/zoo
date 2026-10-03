const CACHE_NAME = "zoo-shell-v2";

const SHELL = ["/", "/favicon.svg", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isShellRequest(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin) return false;

  if (url.pathname.startsWith("/api/")) return false;

  return request.headers.get("Upgrade") !== "websocket";
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);

    if (response.ok) cache.put(request, response.clone());

    return response;
  } catch {
    const cached = await cache.match(request);

    return cached ?? cache.match("/");
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (!isShellRequest(event.request, url)) return;

  event.respondWith(networkFirst(event.request));
});
