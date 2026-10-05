"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  FilePlus2,
  Info,
  Settings as SettingsIcon,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKovaData } from "@/lib/use-kova-data";
import { homeCounts } from "@/lib/home-counts";
import { homeStats, type StatTone } from "@/lib/home-stats";
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

const TONE_ICON: Record<StatTone, React.ReactNode> = {
  info: <Info size={18} />,
  success: <CircleCheck size={18} />,
  warning: <TriangleAlert size={18} />,
  error: <CircleAlert size={18} />,
};

export default function HomeScreen() {
  const router = useRouter();
  const { account, viewAs, setViewAs, viewRole, leave } = useAccount();
  // HomeCard clicks are plain navigation, same as the old setScreen calls --
  // only leaving a screen with a draft on it (new-request, create-schedule)
  // and the viewing-as banner's "Return to Admin" are leave()-guarded.
  const go = (path: string) => router.push(path);
  // Re-renders when the app reloads its data, so the card counts stay current.
  const { requests, schedules, cancellations, completions, problems } = useKovaData();
  const counts = homeCounts(account, { requests, schedules, cancellations, completions, problems });
  const stats = homeStats(
    viewRole,
    account.id,
    { requests, schedules, cancellations, completions, problems },
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
              {TONE_ICON[stat.tone]}
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
          </>
        ) : viewRole === "Requester" ? (
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
          </>
        ) : viewRole === "Scheduler" ? (
          <>
            <HomeCard
              icon={<CalendarPlus size={24} />}
              label="Create schedule"
              count={counts["create-schedule"]}
              onClick={() => go("/schedules/new")}
            />
            <HomeCard
              icon={<CalendarDays size={24} />}
              label="Schedules"
              count={counts["schedules"]}
              onClick={() => go("/schedules")}
            />
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
