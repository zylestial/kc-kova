import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  LayoutDashboard,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import type { Account } from "@/lib/kova-api";

export type NavItem = { href: string; label: string; icon: LucideIcon };

// The screens each role can open, in the same order as their home cards.
export function navItems(viewRole: Account["role"]): NavItem[] {
  const home: NavItem = { href: "/home", label: "Dashboard", icon: LayoutDashboard };
  if (viewRole === "Driver")
    return [
      home,
      { href: "/my-schedule", label: "My Schedule", icon: CalendarDays },
      { href: "/finished/driver", label: "Finished Trips", icon: CheckCircle2 },
    ];
  if (viewRole === "Requester")
    return [
      home,
      { href: "/requests/new", label: "New request", icon: FilePlus2 },
      { href: "/requests", label: "My requests", icon: ClipboardList },
    ];
  if (viewRole === "Scheduler")
    return [
      home,
      { href: "/schedules/new", label: "Create schedule", icon: CalendarPlus },
      { href: "/schedules", label: "Schedules", icon: CalendarDays },
    ];
  return [
    home,
    { href: "/requests/new", label: "New request", icon: FilePlus2 },
    { href: "/requests", label: "My requests", icon: ClipboardList },
    { href: "/schedules", label: "Schedules", icon: CalendarDays },
    { href: "/finished", label: "Finished Trips", icon: CheckCircle2 },
    { href: "/settings", label: "Settings", icon: SettingsIcon },
  ];
}

// The item whose path is the longest match, so /requests/new highlights
// "New request" rather than "My requests".
export function activeHref(items: NavItem[], pathname: string): string | undefined {
  return items
    .filter((item) => pathname === item.href || pathname.startsWith(item.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
