"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  Settings as SettingsIcon,
  ArrowLeft,
  CircleHelp,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  hydrateKovaData,
  getCancellations,
  getCompletions,
  getProblems,
  getRequests,
  getSchedules,
  restoreSession,
  signIn,
  signOut as endSession,
  type Account,
} from "@/lib/kova-api";
import { homeCounts } from "@/lib/home-counts";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { HelpDialog } from "./how-it-works";
import Settings from "./settings";
import DriverFinishedTrips from "./driver-finished-trips";
import DriverSchedules from "./driver-schedules";
import AdminFinishedTrips from "./admin-finished-trips";
import MyRequests from "./my-requests";
import RequestFlow from "./request-flow";
import SchedulePlanner from "./schedule-planner";
import Schedules from "./schedules";
import KovaBrand from "./kova-brand";
type Screen =
  | "driver-home"
  | "admin-home"
  | "requester-home"
  | "scheduler-home"
  | "settings"
  | "my-schedule"
  | "finished"
  | "new-request"
  | "my-requests"
  | "create-schedule"
  | "schedules";
// Opening a screen or returning to the tab reloads the data, but not more
// often than this, so switching screens quickly doesn't hammer the server.
const REFRESH_MIN_GAP_MS = 15_000;
function HomeCard({
  icon,
  label,
  count,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: string;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" onClick={onClick}>
      {icon}
      <span className="home-label">
        {label}
        {count && <small className="home-count">{count}</small>}
      </span>
    </Button>
  );
}
const home = (role: Account["role"]): Screen =>
  role === "Requester"
    ? "requester-home"
    : role === "Scheduler"
      ? "scheduler-home"
      : role === "Driver"
        ? "driver-home"
        : "admin-home";
export default function Home() {
  const [account, setAccount] = useState<Account | null>(null);
  const [screen, setScreen] = useState<Screen>("admin-home");
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [requestNotice, setRequestNotice] = useState("");
  // The draft being continued in Create schedule; undefined for a new one.
  const [editScheduleId, setEditScheduleId] = useState<string | undefined>();
  const [scheduleNotice, setScheduleNotice] = useState("");
  useAutoClear(requestNotice, setRequestNotice);
  useAutoClear(scheduleNotice, setScheduleNotice);
  const [scheduleDate, setScheduleDate] = useState<string | undefined>();
  const [helpOpen, setHelpOpen] = useState(false);
  // What to do once the person confirms they want to leave unsaved work.
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const leave = (action: () => void) => (hasUnsavedChanges() ? setPendingLeave(() => action) : action());
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
        if (saved) setScreen(home(saved.role));
      })
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setLoading(false));
  }, []);
  // Re-render the Home counts whenever the app's data is reloaded.
  const [, setDataVersion] = useState(0);
  useEffect(() => {
    const onUpdate = () => setDataVersion((version) => version + 1);
    window.addEventListener("kova-data-update", onUpdate);
    return () => window.removeEventListener("kova-data-update", onUpdate);
  }, []);
  useEffect(() => {
    if (account) void refreshData();
  }, [account, screen, refreshData]);
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
  useEffect(() => {
    const titles: Record<Screen, string> = {
      "driver-home": "Driver Home",
      "admin-home": "Admin Home",
      "requester-home": "Requester Home",
      "scheduler-home": "Scheduler Home",
      settings: "Settings",
      "my-schedule": "My Schedule",
      finished: "Finished Trips",
      "new-request": "New Request",
      "my-requests": "My Requests",
      "create-schedule": "Create Schedule",
      schedules: "Schedules",
    };
    document.title = `KOVA — ${account ? titles[screen] : "Sign In"}`;
  }, [account, screen]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSigningIn(true);
    setError("");
    try {
      const authenticated = await signIn(username.trim(), password);
      dataIsFresh();
      setAccount(authenticated);
      setScreen(home(authenticated.role));
      setPassword("");
      setShowPassword(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSigningIn(false);
    }
  }
  async function signOut() {
    setLoading(true);
    try {
      await endSession();
      setAccount(null);
      setScreen("admin-home");
      setPassword("");
      setError("");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
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
  if (!account)
    return (
      <div className="sign-shell">
        <form className="sign-card" onSubmit={submit}>
          <KovaBrand signIn />
          <h1>
            Sign In<span className="title-dot">.</span>
          </h1>
          <div className="sign-fields">
            <label className="field">
              <span>Username</span>
              <Input
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <Input
                required
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              className="show-password"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? "Hide password" : "Show password"}
            </Button>
          </div>
          <Button className="primary sign-submit" type="submit" disabled={signingIn}>
            {signingIn ? "Signing in…" : "Sign In"}
          </Button>
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          <p className="helper">Forgot your password, or need an account? Ask an Admin.</p>
        </form>
      </div>
    );
  const counts = homeCounts(account, {
    requests: getRequests(),
    schedules: getSchedules(),
    cancellations: getCancellations(),
    completions: getCompletions(),
    problems: getProblems(),
  });
  return (
    <div className="app-shell">
      <header className="topbar">
        <KovaBrand />
        <div className="workspace-label">OPERATIONS</div>
        <div className="account">{account.name.slice(0, 2).toUpperCase()}</div>
        <span className="account-name">
          {account.name} · {account.role}
        </span>
        <div className="refresh-control">
          <span className="last-updated" role="status">
            {refreshFailed
              ? "Couldn't refresh. Showing older data."
              : updatedAt
                ? `Updated ${updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                : ""}
          </span>
          <Button variant="ghost" aria-label="Refresh" disabled={refreshing} onClick={() => void refreshData(true)}>
            <RefreshCw size={15} className={refreshing ? "animate-spin" : undefined} />
            <span className="btn-label">{refreshing ? "Refreshing…" : "Refresh"}</span>
          </Button>
        </div>
        <Button variant="ghost" aria-label="Help" onClick={() => setHelpOpen(true)}>
          <CircleHelp size={15} /> <span className="btn-label">Help</span>
        </Button>
        <Button variant="ghost" onClick={() => leave(signOut)}>
          Sign Out
        </Button>
      </header>
      <HelpDialog role={account.role} open={helpOpen} onOpenChange={setHelpOpen} />
      <AlertDialog open={pendingLeave !== null} onOpenChange={(open) => !open && setPendingLeave(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this page?</AlertDialogTitle>
            <AlertDialogDescription>
              You have changes that haven&apos;t been saved. If you leave now, they&apos;ll be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay here</AlertDialogCancel>
            <AlertDialogAction
              className="danger"
              onClick={() => {
                pendingLeave?.();
                setPendingLeave(null);
              }}
            >
              Leave page
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <main className="role-main">
        {screen === "settings" && account.role === "Admin" ? (
          <Settings onBack={() => setScreen("admin-home")} />
        ) : screen === "new-request" && (account.role === "Requester" || account.role === "Admin") ? (
          <>
            <Button
              variant="ghost"
              className="back"
              onClick={() => leave(() => setScreen(home(account.role)))}
            >
              <ArrowLeft size={17} /> {account.role} Home
            </Button>
            <RequestFlow
              onSubmitted={() => {
                setRequestNotice("Request submitted. A Scheduler will plan the trip.");
                setScreen("my-requests");
              }}
            />
          </>
        ) : screen === "my-requests" && (account.role === "Requester" || account.role === "Admin") ? (
          <>
            <Button
              variant="ghost"
              className="back"
              onClick={() => {
                setRequestNotice("");
                setScreen(home(account.role));
              }}
            >
              <ArrowLeft size={17} /> {account.role} Home
            </Button>
            <MyRequests notice={requestNotice} />
          </>
        ) : screen === "create-schedule" && account.role === "Scheduler" ? (
          <>
            <Button
              variant="ghost"
              className="back"
              onClick={() =>
                leave(() => {
                  setScheduleDate(undefined);
                  setScreen(editScheduleId ? "schedules" : home(account.role));
                })
              }
            >
              <ArrowLeft size={17} /> {editScheduleId ? "Schedules" : "Scheduler Home"}
            </Button>
            <SchedulePlanner
              key={editScheduleId ?? "new"}
              scheduleId={editScheduleId}
              onDone={(notice, date) => {
                setScheduleNotice(notice);
                setScheduleDate(date);
                setEditScheduleId(undefined);
                setScreen("schedules");
              }}
            />
          </>
        ) : screen === "schedules" && (account.role === "Scheduler" || account.role === "Admin") ? (
          <>
            <Button
              variant="ghost"
              className="back"
              onClick={() => {
                setScheduleNotice("");
                setScreen(home(account.role));
              }}
            >
              <ArrowLeft size={17} /> {account.role} Home
            </Button>
            <Schedules
              key={scheduleDate ?? "today"}
              canEdit={account.role === "Scheduler"}
              canReview={account.role === "Admin"}
              notice={scheduleNotice}
              initialDate={scheduleDate}
              onCreate={
                account.role === "Scheduler"
                  ? () => {
                      setScheduleNotice("");
                      setEditScheduleId(undefined);
                      setScreen("create-schedule");
                    }
                  : undefined
              }
              onEdit={(id) => {
                setScheduleNotice("");
                setEditScheduleId(id);
                setScreen("create-schedule");
              }}
            />
          </>
        ) : screen === "finished" || screen === "my-schedule" ? (
          <>
            <Button
              variant="ghost"
              className="back"
              onClick={() => setScreen(home(account.role))}
            >
              <ArrowLeft size={17} /> {account.role} Home
            </Button>
            {account.role === "Driver" && screen === "my-schedule" ? (
              <DriverSchedules driverId={account.id} />
            ) : account.role === "Driver" ? (
              <DriverFinishedTrips />
            ) : (
              <AdminFinishedTrips />
            )}
          </>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">{account.role.toUpperCase()}</div>
                <h1>
                  {account.role === "Admin"
                    ? "Admin Home"
                    : `Welcome, ${account.name}`}
                  <span className="title-dot">.</span>
                </h1>
              </div>
            </div>
            <div className="home-options">
              {account.role === "Driver" ? (
                <>
                  <HomeCard
                    icon={<CalendarDays size={24} />}
                    label="My Schedule"
                    count={counts["my-schedule"]}
                    onClick={() => setScreen("my-schedule")}
                  />
                  <HomeCard
                    icon={<CheckCircle2 size={24} />}
                    label="Finished Trips"
                    onClick={() => setScreen("finished")}
                  />
                </>
              ) : account.role === "Requester" ? (
                <>
                  <HomeCard
                    icon={<FilePlus2 size={24} />}
                    label="New request"
                    onClick={() => setScreen("new-request")}
                  />
                  <HomeCard
                    icon={<ClipboardList size={24} />}
                    label="My requests"
                    count={counts["my-requests"]}
                    onClick={() => setScreen("my-requests")}
                  />
                </>
              ) : account.role === "Scheduler" ? (
                <>
                  <HomeCard
                    icon={<CalendarPlus size={24} />}
                    label="Create schedule"
                    count={counts["create-schedule"]}
                    onClick={() => {
                      setEditScheduleId(undefined);
                      setScreen("create-schedule");
                    }}
                  />
                  <HomeCard
                    icon={<CalendarDays size={24} />}
                    label="Schedules"
                    count={counts["schedules"]}
                    onClick={() => {
                      setScheduleDate(undefined);
                      setScreen("schedules");
                    }}
                  />
                </>
              ) : (
                <>
                  <HomeCard
                    icon={<FilePlus2 size={24} />}
                    label="New request"
                    onClick={() => setScreen("new-request")}
                  />
                  <HomeCard
                    icon={<ClipboardList size={24} />}
                    label="My requests"
                    count={counts["my-requests"]}
                    onClick={() => setScreen("my-requests")}
                  />
                  <HomeCard
                    icon={<CalendarDays size={24} />}
                    label="Schedules"
                    count={counts["schedules"]}
                    onClick={() => {
                      setScheduleDate(undefined);
                      setScheduleNotice("");
                      setScreen("schedules");
                    }}
                  />
                  <HomeCard
                    icon={<CheckCircle2 size={24} />}
                    label="Finished Trips"
                    count={counts["finished"]}
                    onClick={() => setScreen("finished")}
                  />
                  <HomeCard
                    icon={<SettingsIcon size={24} />}
                    label="Settings"
                    onClick={() => setScreen("settings")}
                  />
                </>
              )}
            </div>
          </>
        )}
        <footer>
          <span>KOVA</span>
          <span>Kayelen&apos;s Operations and Vehicle Allocation</span>
        </footer>
      </main>
    </div>
  );
}
