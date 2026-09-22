"use client";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Settings as SettingsIcon,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Scheduler from "./scheduler";
import {
  getPendingBookings,
  restoreSession,
  signIn,
  signOut as endSession,
  type Account,
  type Booking,
} from "@/lib/kova-api";
import Settings from "./settings";
import DriverTrips from "./driver-trips";
import AdminFinishedTrips from "./admin-finished-trips";
import AdminBookingApprovals from "./admin-booking-approvals";
import MyBookings from "./my-bookings";
import KovaBrand from "./kova-brand";
type Screen =
  | "schedule"
  | "driver-home"
  | "admin-home"
  | "booker-home"
  | "settings"
  | "my-schedule"
  | "finished"
  | "approvals"
  | "my-bookings"
  | "driver-record"
  | "admin-record";
const home = (role: Account["role"]): Screen =>
  role === "Booker"
    ? "booker-home"
    : role === "Driver"
      ? "driver-home"
      : "admin-home";
export default function Home() {
  const [account, setAccount] = useState<Account | null>(null);
  const [screen, setScreen] = useState<Screen>("schedule");
  const [driverBooking, setDriverBooking] = useState<Booking | null>(null);
  const [adminRecordId, setAdminRecordId] = useState<string | null>(null);
  const [driverReturnScreen, setDriverReturnScreen] = useState<
    "my-schedule" | "finished"
  >("my-schedule");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    restoreSession()
      .then((saved) => {
        setAccount(saved);
        if (saved) setScreen(home(saved.role));
      })
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    function refresh() {
      setPendingCount(getPendingBookings().length);
    }
    refresh();
    window.addEventListener("kova-data-update", refresh);
    return () => window.removeEventListener("kova-data-update", refresh);
  }, []);
  useEffect(() => {
    const titles: Record<Screen, string> = {
      schedule: "Schedule",
      "driver-home": "Driver Home",
      "admin-home": "Admin Home",
      "booker-home": "Booker Home",
      settings: "Settings",
      "my-schedule": "My Schedule",
      finished: "Finished Trips",
      approvals: "Booking Approvals",
      "my-bookings": "My Bookings",
      "driver-record": "Daily Vehicle Record",
      "admin-record": "Daily Vehicle Record",
    };
    document.title = `KOVA — ${account ? titles[screen] : "Sign In"}`;
  }, [account, screen]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const authenticated = await signIn(username.trim(), password);
      setAccount(authenticated);
      setScreen(home(authenticated.role));
      setPassword("");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function signOut() {
    setLoading(true);
    try {
      await endSession();
      setAccount(null);
      setDriverBooking(null);
      setAdminRecordId(null);
      setScreen("schedule");
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
          <p>Loading…</p>
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
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
          </div>
          <Button className="primary sign-submit" type="submit">
            Sign In
          </Button>
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
    );
  if (screen === "schedule" && (account.role === "Admin" || account.role === "Booker"))
    return (
      <Scheduler
        role={account.role}
        onHome={() => setScreen(home(account.role))}
        onSignOut={signOut}
      />
    );
  if (account.role === "Driver" && screen === "driver-record" && driverBooking)
    return (
      <Scheduler
        role="Driver"
        driverBooking={driverBooking}
        driverBackLabel={
          driverReturnScreen === "finished" ? "Finished Trips" : "My Schedule"
        }
        onHome={() => {
          setDriverBooking(null);
          setScreen(driverReturnScreen);
        }}
        onSignOut={signOut}
      />
    );
  if (account.role === "Admin" && screen === "admin-record" && adminRecordId)
    return (
      <Scheduler
        role="Admin"
        reviewRecordId={adminRecordId}
        onHome={() => {
          setAdminRecordId(null);
          setScreen("finished");
        }}
        onSignOut={signOut}
      />
    );
  return (
    <div className="app-shell">
      <header className="topbar">
        <KovaBrand />
        <div className="workspace-label">OPERATIONS</div>
        <div className="account">{account.name.slice(0, 2).toUpperCase()}</div>
        <Button variant="ghost" onClick={signOut}>
          Sign Out
        </Button>
      </header>
      <main className="role-main">
        {screen === "settings" && account.role === "Admin" ? (
          <Settings onBack={() => setScreen("admin-home")} />
        ) : screen === "finished" || screen === "my-schedule" || screen === "approvals" || screen === "my-bookings" ? (
          <>
            <Button
              variant="ghost"
              className="back"
              onClick={() => setScreen(home(account.role))}
            >
              <ArrowLeft size={17} /> {account.role} Home
            </Button>
            {account.role === "Driver" ? (
              <DriverTrips
                driverId={account.id}
                finished={screen === "finished"}
                onOpenRecord={(booking) => {
                  setDriverReturnScreen(
                    screen === "finished" ? "finished" : "my-schedule",
                  );
                  setDriverBooking(booking);
                  setScreen("driver-record");
                }}
              />
            ) : account.role === "Booker" ? (
              <MyBookings />
            ) : screen === "approvals" ? (
              <AdminBookingApprovals />
            ) : (
              <AdminFinishedTrips
                onOpen={(id) => {
                  setAdminRecordId(id);
                  setScreen("admin-record");
                }}
              />
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
                  <Button
                    variant="outline"
                    onClick={() => setScreen("my-schedule")}
                  >
                    <CalendarDays size={24} /> My Schedule
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setScreen("finished")}
                  >
                    <CheckCircle2 size={24} /> Finished Trips
                  </Button>
                </>
              ) : account.role === "Booker" ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setScreen("schedule")}
                  >
                    <CalendarDays size={24} /> Book a Vehicle
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setScreen("my-bookings")}
                  >
                    <ClipboardCheck size={24} /> My Bookings
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setScreen("schedule")}
                  >
                    <CalendarDays size={24} /> Schedule
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setScreen("approvals")}
                  >
                    <ClipboardCheck size={24} /> Booking Approvals
                    {pendingCount > 0 && <span className="count">{pendingCount}</span>}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setScreen("finished")}
                  >
                    <CheckCircle2 size={24} /> Finished Trips
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setScreen("settings")}
                  >
                    <SettingsIcon size={24} /> Settings
                  </Button>
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
