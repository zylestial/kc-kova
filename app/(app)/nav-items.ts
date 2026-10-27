import {
  Car,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  LayoutDashboard,
  Settings as SettingsIcon,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { Account } from "@/lib/kova-api";

export type NavItem = { href: string; label: string; icon: LucideIcon };
/** Links under one heading; a menu with a single group shows no headings. */
export type NavGroup = { heading?: string; items: NavItem[] };
export type Nav = { groups: NavGroup[]; footer: NavItem[] };

const home: NavItem = { href: "/home", label: "Dashboard", icon: LayoutDashboard };
const myRequests: NavItem = { href: "/requests", label: "My requests", icon: ClipboardList };
const myTrips: NavItem = { href: "/my-trips", label: "My Trips", icon: Car };
const schedules: NavItem = { href: "/schedules", label: "Schedules", icon: CalendarDays };
const attendance: NavItem = { href: "/attendance", label: "Attendance", icon: UserCheck };
const settings: NavItem = { href: "/settings", label: "Settings", icon: SettingsIcon };
const finished = (href: string): NavItem => ({ href, label: "Finished Trips", icon: CheckCircle2 });

// The screens each role can open, in the same order as their home cards.
// New request is on Home and My requests, not here. canRequest adds My
// requests for a Driver, Scheduler or Finance an Admin allowed
// (canRequestTransport); canDrive adds My Trips, where whoever drives a
// Company trip records it (canDriveCompany, 0079).
export function navItems(viewRole: Account["role"], canRequest = false, canDrive = false): Nav {
  const requestsAllowed = viewRole === "Requester" || viewRole === "Admin" || canRequest;
  const driving = canDrive ? [myTrips] : [];
  // A Driver finds My Trips with their other driving; everyone else with their requests.
  const mine = [...(requestsAllowed ? [myRequests] : []), ...(viewRole === "Driver" ? [] : driving)];
  const nav = (work: NavGroup, footer: NavItem[] = []): Nav => {
    const groups = [work, ...(mine.length ? [{ heading: "My work", items: mine }] : [])].filter((group) => group.items.length);
    // Headings only help once there are two groups.
    if (groups.length < 2) return { groups: [{ items: [home, ...groups.flatMap((group) => group.items)] }], footer };
    return { groups: [{ items: [home] }, ...groups], footer };
  };
  if (viewRole === "Driver")
    return nav({ heading: "Driving", items: [{ href: "/my-schedule", label: "My Schedule", icon: CalendarDays }, ...driving, finished("/finished/driver")] });
  if (viewRole === "Requester") return nav({ items: [] });
  // Finance only views these (0076), and requests when an Admin allows it.
  if (viewRole === "Finance") return nav({ heading: "Records", items: [schedules, finished("/finished"), attendance] });
  if (viewRole === "Scheduler")
    return nav({
      heading: "Scheduling",
      items: [{ href: "/scheduling", label: "Scheduling", icon: CalendarClock }, schedules, finished("/finished")],
    });
  return nav({ heading: "Records", items: [schedules, finished("/finished"), attendance] }, [settings]);
}

/** Every link in the menu, in order. */
export function navLinks(nav: Nav): NavItem[] {
  return [...nav.groups.flatMap((group) => group.items), ...nav.footer];
}

// The item whose path is the longest match, so /requests/new highlights
// "My requests".
export function activeHref(items: NavItem[], pathname: string): string | undefined {
  return items
    .filter((item) => pathname === item.href || pathname.startsWith(item.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
