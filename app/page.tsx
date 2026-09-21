"use client";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Settings as SettingsIcon,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Scheduler from "./scheduler";
import {
  restoreSession,
  signIn,
  signOut as endSession,
  type Account,
  type Booking,
} from "@/lib/kova-api";
import Settings from "./settings";
import DriverTrips from "./driver-trips";
import AdminFinishedTrips from "./admin-finished-trips";
import KovaBrand from "./kova-brand";
type Screen =
  | "schedule"
  | "driver-home"
  | "admin-home"
  | "settings"
  | "my-schedule"
  | "finished"
  | "driver-record"
  | "admin-record";
const home = (role: Account["role"]): Screen =>
  role === "Booker"
    ? "schedule"
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
    const titles: Record<Screen, string> = {
      schedule: "Schedule",
      "driver-home": "Driver Home",
      "admin-home": "Admin Home",
      settings: "Settings",
      "my-schedule": "My Schedule",
      finished: "Finished Trips",
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
          <div className="eyebrow">OPERATIONS & VEHICLE ALLOCATION</div>
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
  if (account.role === "Booker")
    return (
      <Scheduler
        role="Booker"
        onHome={() => setScreen("schedule")}
        onSignOut={signOut}
      />
    );
  if (screen === "schedule" && account.role === "Admin")
    return (
      <Scheduler
        role="Admin"
        onHome={() => setScreen("admin-home")}
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
        ) : screen === "finished" || screen === "my-schedule" ? (
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
            <div className="breadcrumb">
              Operations <span>/</span> {account.role} Home
            </div>
            <div className="page-heading">
              <div>
                <div className="eyebrow">{account.role.toUpperCase()}</div>
                <h1>
                  {account.role === "Driver"
                    ? `Welcome, ${account.name}`
                    : "Admin Home"}
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
