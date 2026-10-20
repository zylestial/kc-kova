"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarCheck,
  CalendarDays,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  CircleSlash,
  ClipboardCheck,
  ClipboardList,
  CornerUpLeft,
  FilePen,
  FilePlus2,
  Flag,
  Send,
  Settings as SettingsIcon,
  UserCheck,
  TriangleAlert,
  Truck,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKovaData } from "@/lib/use-kova-data";
import { homeCounts } from "@/lib/home-counts";
import { canRequestTransport } from "@/lib/request-access";
import { homeStats, type StatIcon } from "@/lib/home-stats";
import { useAccount } from "../providers";

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

/** Each tile's icon: what it counts, matching the bell's icon for that event where there is one. */
const STAT_ICON: Record<StatIcon, React.ReactNode> = {
  requests: <ClipboardList size={18} />,
  waiting: <CalendarClock size={18} />,
  sentBack: <CornerUpLeft size={18} />,
  scheduled: <CalendarCheck size={18} />,
  draft: <FilePen size={18} />,
  returned: <Undo2 size={18} />,
  trips: <Truck size={18} />,
  upcoming: <CalendarDays size={18} />,
  complete: <ClipboardCheck size={18} />,
  approve: <Send size={18} />,
  cancellation: <CircleSlash size={18} />,
  close: <Flag size={18} />,
  problem: <TriangleAlert size={18} />,
};

export default function HomeScreen() {
  const router = useRouter();
  const { account, viewAs, setViewAs, viewRole, leave } = useAccount();
  // HomeCard clicks are plain navigation, same as the old setScreen calls --
  // only leaving a screen with a draft on it (new-request, scheduling)
  // and the viewing-as banner's "Return to Admin" are leave()-guarded.
  const go = (path: string) => router.push(path);
  // Re-renders when the app reloads its data, so the card counts stay current.
  const { requests, schedules, cancellations, completions, problems, attendance } = useKovaData();
  const counts = homeCounts(account, { requests, schedules, cancellations, completions, problems, attendance });
  const canRequest = canRequestTransport(account);
  const requestCards = (
    <>
      <HomeCard icon={<FilePlus2 size={24} />} label="New request" onClick={() => go("/requests/new")} />
      <HomeCard
        icon={<ClipboardList size={24} />}
        label="My requests"
        count={counts["my-requests"]}
        onClick={() => go("/requests")}
      />
    </>
  );
  const stats = homeStats(
    viewRole,
    account.id,
    { requests, schedules, cancellations, completions, problems, attendance },
    new Date(),
    viewAs === "Driver" ? null : account.id,
  );
  return (
    <>
      {account.role === "Admin" && viewAs && (
        <div className="notice viewing-as" role="status">
          <span>
            Viewing as {viewAs} — actions here are attributed to you, {account.name}.
          </span>
          <Button variant="outline" onClick={() => leave(() => setViewAs(null))}>
            Return to Admin
          </Button>
        </div>
      )}
      <section className="welcome-banner">
        <div className="eyebrow">{viewRole.toUpperCase()} DASHBOARD</div>
        <h1>Welcome back, {account.name}</h1>
        <p>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          {" · "}Here&rsquo;s what needs you today.
        </p>
      </section>
      <div className="stat-grid">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className={"stat-tile tone-" + (stat.value ? stat.tone : "neutral")}>
            <span className="stat-icon" aria-hidden="true">
              {STAT_ICON[stat.icon]}
            </span>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </Link>
        ))}
      </div>
      <h2 className="section-title">Quick actions</h2>
      <div className="home-options">
        {viewRole === "Driver" ? (
          <>
            <HomeCard
              icon={<CalendarDays size={24} />}
              label="My Schedule"
              count={counts["my-schedule"]}
              onClick={() => go("/my-schedule")}
            />
            <HomeCard
              icon={<CheckCircle2 size={24} />}
              label="Finished Trips"
              onClick={() => go("/finished/driver")}
            />
            {canRequest && requestCards}
          </>
        ) : viewRole === "Requester" ? (
          requestCards
        ) : viewRole === "Finance" ? (
          <>
            <HomeCard icon={<CalendarDays size={24} />} label="Schedules" onClick={() => go("/schedules")} />
            <HomeCard icon={<CheckCircle2 size={24} />} label="Finished Trips" onClick={() => go("/finished")} />
            <HomeCard icon={<UserCheck size={24} />} label="Attendance" onClick={() => go("/attendance")} />
            {canRequest && requestCards}
          </>
        ) : viewRole === "Scheduler" ? (
          <>
            <HomeCard
              icon={<CalendarClock size={24} />}
              label="Scheduling"
              count={counts["scheduling"]}
              onClick={() => go("/scheduling")}
            />
            <HomeCard
              icon={<CalendarDays size={24} />}
              label="Schedules"
              count={counts["schedules"]}
              onClick={() => go("/schedules")}
            />
            <HomeCard
              icon={<CheckCircle2 size={24} />}
              label="Finished Trips"
              onClick={() => go("/finished")}
            />
            {canRequest && requestCards}
          </>
        ) : (
          <>
            <HomeCard
              icon={<FilePlus2 size={24} />}
              label="New request"
              onClick={() => go("/requests/new")}
            />
            <HomeCard
              icon={<ClipboardList size={24} />}
              label="My requests"
              count={counts["my-requests"]}
              onClick={() => go("/requests")}
            />
            <HomeCard
              icon={<CalendarDays size={24} />}
              label="Schedules"
              count={counts["schedules"]}
              onClick={() => go("/schedules")}
            />
            <HomeCard
              icon={<CheckCircle2 size={24} />}
              label="Finished Trips"
              count={counts["finished"]}
              onClick={() => go("/finished")}
            />
            <HomeCard
              icon={<UserCheck size={24} />}
              label="Attendance"
              onClick={() => go("/attendance")}
            />
            <HomeCard
              icon={<SettingsIcon size={24} />}
              label="Settings"
              onClick={() => go("/settings")}
            />
          </>
        )}
      </div>
      {viewRole === "Admin" && (
        <div className="viewas-row">
          <span className="viewas-label">View as</span>
          <Button variant="outline" size="sm" onClick={() => setViewAs("Scheduler")}>
            <CalendarPlus size={15} /> Scheduler
          </Button>
          <Button variant="outline" size="sm" onClick={() => setViewAs("Driver")}>
            <CalendarDays size={15} /> Driver
          </Button>
        </div>
      )}
    </>
  );
}
