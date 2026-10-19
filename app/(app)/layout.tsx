"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { hydrateKovaData, restoreSession, signOut as endSession, type Account } from "@/lib/kova-api";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { watchTables } from "@/lib/stacked-tables";
import { watchNotifications } from "@/lib/notifications-poll";
import { resyncPush, turnPushOff } from "@/lib/push-device";
import { HelpDialog } from "../how-it-works";
import { PushDialog } from "../push-dialog";
import KovaBrand from "../kova-brand";
import { AccountProvider } from "./providers";
import Topbar from "./topbar";
import Sidebar from "./sidebar";
import LeaveGuardDialog from "./leave-guard-dialog";

// Opening a screen or returning to the tab reloads the data, but not more
// often than this, so switching screens quickly doesn't hammer the server.
const REFRESH_MIN_GAP_MS = 15_000;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Label table cells so the tables can stack as cards on a phone.
  useEffect(() => watchTables(), []);
  // The browser asks before a refresh, close or Back that would leave the app.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const lastRefresh = useRef(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  // Sign-in and session restore have just loaded everything.
  const dataIsFresh = () => {
    lastRefresh.current = Date.now();
    setUpdatedAt(new Date());
    setRefreshFailed(false);
  };
  const refreshData = useCallback(async (force = false) => {
    if (!force && Date.now() - lastRefresh.current < REFRESH_MIN_GAP_MS) return;
    lastRefresh.current = Date.now();
    setRefreshing(true);
    // A failed refresh keeps what is on screen and says so; the next
    // screen change, return to the tab or Refresh press tries again.
    await hydrateKovaData()
      .then(() => {
        setUpdatedAt(new Date());
        setRefreshFailed(false);
      })
      .catch(() => setRefreshFailed(true));
    setRefreshing(false);
  }, []);

  useEffect(() => {
    restoreSession()
      .then((saved) => {
        if (saved) dataIsFresh();
        setAccount(saved);
      })
      .catch(() => setAccount(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!loading && !account) router.replace("/sign-in");
  }, [loading, account, router]);
  useEffect(() => {
    if (account) void refreshData();
  }, [account, pathname, refreshData]);
  // Notifications: polled while signed in, stopped on sign-out.
  useEffect(() => {
    if (!account) return;
    return watchNotifications();
  }, [account]);
  // A device with phone notifications on stays saved for whoever is signed in.
  useEffect(() => {
    if (account) void resyncPush().catch(() => undefined);
  }, [account]);
  useEffect(() => {
    if (!account) return;
    const onReturn = () => {
      if (document.visibilityState === "visible") void refreshData();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [account, refreshData]);

  async function signOut() {
    setLoading(true);
    // Whoever signs in next on this device doesn't get this account's notifications.
    await turnPushOff().catch(() => undefined);
    await endSession().catch(() => undefined);
    setAccount(null);
    setLoading(false);
    router.replace("/sign-in");
  }

  if (loading)
    return (
      <div className="sign-shell">
        <div className="sign-card">
          <KovaBrand signIn />
          <p role="status">Loading KOVA…</p>
        </div>
      </div>
    );
  if (!account) return null; // redirecting to /sign-in

  return (
    <AccountProvider account={account}>
      <div className="app-shell">
        <Sidebar
          open={menuOpen}
          onClose={closeMenu}
          onHelp={() => {
            setMenuOpen(false);
            setHelpOpen(true);
          }}
          onPush={() => {
            setMenuOpen(false);
            setPushOpen(true);
          }}
          onSignOut={signOut}
        />
        <Topbar
          refreshing={refreshing}
          refreshFailed={refreshFailed}
          updatedAt={updatedAt}
          onRefresh={() => void refreshData(true)}
          onMenu={() => setMenuOpen(true)}
        />
        <HelpDialog role={account.role} open={helpOpen} onOpenChange={setHelpOpen} />
        <PushDialog open={pushOpen} onOpenChange={setPushOpen} />
        <LeaveGuardDialog />
        <main className="role-main">{children}</main>
        <footer className="app-footer">
          <div>
            <span>KOVA</span>
            <span>Kayelen&apos;s Operations and Vehicle Allocation</span>
          </div>
        </footer>
      </div>
    </AccountProvider>
  );
}
