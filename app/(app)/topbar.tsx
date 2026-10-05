"use client";
import { Menu, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import KovaBrand from "../kova-brand";
import NotificationBell from "../notification-bell";

// Help, the account and Sign out live in the sidebar; the bar keeps the
// refresh state and notifications, plus the menu button on narrow screens.
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
  return (
    <header className="topbar">
      <Button variant="ghost" size="icon" className="topbar-menu" aria-label="Open menu" onClick={onMenu}>
        <Menu size={20} />
      </Button>
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
