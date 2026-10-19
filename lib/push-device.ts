import { pausePushSubscription, removePushSubscription, savePushSubscription } from "@/lib/kova-api";

/**
 * This browser's side of phone notifications: the service worker
 * (public/sw.js), the browser's permission, and its push subscription,
 * which /api/push/subscription saves for the signed-in account.
 */

// Empty when push isn't set up for this deployment; the switch then hides.
const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
export const pushConfigured = !!publicKey;

/**
 * - unsupported: this browser can't, or push isn't set up here
 * - needs-home-screen: an iPhone or iPad, which only allows it once KOVA is on the Home Screen
 * - blocked: the browser was told never to show KOVA's notifications
 */
export type PushState = "unsupported" | "needs-home-screen" | "blocked" | "off" | "on";

const isAppleMobile = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches;

const supported = () =>
  !!publicKey && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const READY_TIMEOUT_MS = 10_000;

// register() can resolve while the worker is still installing, and subscribing
// then fails ("no active Service Worker"), so wait until it's active, but not
// forever: a worker stuck behind an old one would leave the dialog loading.
async function registration() {
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), READY_TIMEOUT_MS)),
  ]);
  if (!ready) throw Error("Notifications didn't start in this browser. Close every KOVA tab, open KOVA again and retry.");
  return ready;
}

async function currentSubscription() {
  return (await registration()).pushManager.getSubscription();
}

function keyBytes(base64Url: string) {
  const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function pushState(): Promise<PushState> {
  if (!publicKey) return "unsupported";
  if (isAppleMobile() && !isStandalone()) return "needs-home-screen";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

/** Asks the browser, then saves this device. Resolves to the state it ended in. */
export async function turnPushOn(): Promise<PushState> {
  if (!supported()) return pushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const pushManager = (await registration()).pushManager;
  const subscription =
    (await pushManager.getSubscription()) ??
    (await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await savePushSubscription(subscription.toJSON());
  return "on";
}

/** Stops this device getting them, here and on the server. */
export async function turnPushOff() {
  if (!supported()) return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  await removePushSubscription(subscription.endpoint);
  await subscription.unsubscribe();
}

/**
 * On signing out: the server stops sending here, but the browser keeps its
 * subscription, so resyncPush() resumes it for whoever signs in next, and
 * catches the same account up on what came meanwhile (0071).
 */
export async function pausePush() {
  if (!supported()) return;
  const subscription = await currentSubscription();
  if (subscription) await pausePushSubscription(subscription.endpoint);
}

/**
 * On opening KOVA: saves this device again if it's on, so it follows
 * whoever is signed in and comes back after the server dropped it.
 */
export async function resyncPush() {
  if (!supported() || Notification.permission !== "granted") return;
  const subscription = await currentSubscription();
  if (subscription) await savePushSubscription(subscription.toJSON());
}
