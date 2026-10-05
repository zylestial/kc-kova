"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Menu, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import KovaBrand from "../kova-brand";
import NotificationBell from "../notification-bell";
import { useAccount } from "./providers";

// Help, the account and Sign out live in the sidebar; the bar keeps the
// refresh state and notifications, plus the menu and Back buttons on narrow
// screens.
export default function Topbar({
  refreshing,
  refreshFailed,
  updatedAt,
  onRefresh,
  onMenu,
}: {
  refreshing: boolean;
  refreshFailed: boolean;
  updatedAt: Date | null;
  onRefresh: () => void;
  onMenu: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { leave } = useAccount();
  // Screens visited in this app session, so Back can tell whether the
  // previous history entry is one of ours. Going back pops; anything else
  // pushes.
  const visited = useRef<string[]>([]);
  useEffect(() => {
    const stack = visited.current;
    if (stack.at(-1) === pathname) return;
    if (stack.at(-2) === pathname) stack.pop();
    else stack.push(pathname);
  }, [pathname]);
  const inner = pathname !== "/home";

  // The previous screen, or the Dashboard when the page was opened directly.
  function back() {
    leave(() => (visited.current.length > 1 ? router.back() : router.push("/home")));
  }

  return (
    <header className={"topbar" + (inner ? " inner" : "")}>
      <Button variant="ghost" size="icon" className="topbar-menu" aria-label="Open menu" onClick={onMenu}>
        <Menu size={20} />
      </Button>
      {inner && (
        <Button variant="ghost" className="topbar-back" onClick={back}>
          <ArrowLeft size={18} /> Back
        </Button>
      )}
      <KovaBrand />
      <span className="topbar-title">
        {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
      </span>
      {refreshFailed && (
        <span className="last-updated" role="status">
          Couldn&rsquo;t refresh. Showing older data.
        </span>
      )}
      <div className="topbar-actions">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh"
          title={
            refreshing
              ? "Refreshing…"
              : updatedAt
                ? `Updated ${updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                : "Refresh"
          }
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw size={15} className={refreshing ? "animate-spin" : undefined} />
        </Button>
        <NotificationBell />
      </div>
    </header>
  );
}
