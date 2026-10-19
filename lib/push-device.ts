import { removePushSubscription, savePushSubscription } from "@/lib/kova-api";

/**
 * This browser's side of phone notifications: the service worker
 * (public/sw.js), the browser's permission, and its push subscription,
 * which /api/push/subscription saves for the signed-in account.
 */

// Empty when push isn't set up for this deployment; the switch then hides.
const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

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

const registration = () => navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });

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
 * On opening KOVA: saves this device again if it's on, so it follows
 * whoever is signed in and comes back after the server dropped it.
 */
export async function resyncPush() {
  if (!supported() || Notification.permission !== "granted") return;
  const subscription = await currentSubscription();
  if (subscription) await savePushSubscription(subscription.toJSON());
}
