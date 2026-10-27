// KOVA's service worker: shows phone notifications sent by /api/push/send,
// even when no KOVA tab is open, and opens the right page when one is tapped.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "KOVA", {
      body: payload.body || "You have a new notification.",
      icon: "/icon-192.png",
      badge: "/notification-badge.png",
      tag: payload.tag,
      data: { url: payload.url || "/home" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/home", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an open KOVA window rather than opening another. navigate()
      // refuses a tab this worker doesn't control (one opened before it
      // started), so open a new one then.
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        try {
          const focused = await open.focus();
          if (focused.url !== url) await focused.navigate(url);
          return;
        } catch (error) {
          console.warn("KOVA: couldn't reuse the open tab", error);
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
