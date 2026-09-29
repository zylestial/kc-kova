"use client";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  Settings as SettingsIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getCancellations,
  getCompletions,
  getProblems,
  getRequests,
  getSchedules,
} from "@/lib/kova-api";
import { homeCounts } from "@/lib/home-counts";
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
        {/* Always rendered, even blank, so every card's title sits at the
            same height whether or not it has a count line below it. */}
        <small className="home-count">{count ?? ""}</small>
      </span>
    </Button>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { account, viewAs, setViewAs, viewRole, leave } = useAccount();
  // HomeCard clicks are plain navigation, same as the old setScreen calls --
  // only leaving a screen with a draft on it (new-request, create-schedule)
  // and the viewing-as banner's "Return to Admin" are leave()-guarded.
  const go = (path: string) => router.push(path);
  const counts = homeCounts(account, {
    requests: getRequests(),
    schedules: getSchedules(),
    cancellations: getCancellations(),
    completions: getCompletions(),
    problems: getProblems(),
  });
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
      <div className="page-heading">
        <div>
          <div className="eyebrow">{viewRole.toUpperCase()}</div>
          <h1>
            Welcome, {account.name}
            <span className="title-dot">.</span>
          </h1>
        </div>
      </div>
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
