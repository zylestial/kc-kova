"use client";
import { CircleHelp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import KovaBrand from "../kova-brand";
import NotificationBell from "../notification-bell";
import { useAccount } from "./providers";

export default function Topbar({
  refreshing,
  refreshFailed,
  updatedAt,
  onRefresh,
  onHelp,
  onSignOut,
}: {
  refreshing: boolean;
  refreshFailed: boolean;
  updatedAt: Date | null;
  onRefresh: () => void;
  onHelp: () => void;
  onSignOut: () => void;
}) {
  const { leave } = useAccount();
  return (
    <header className="topbar">
      <KovaBrand />
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
        <Button variant="ghost" size="icon" aria-label="Help" title="Help" onClick={onHelp}>
          <CircleHelp size={15} />
        </Button>
      </div>
      <Button variant="ghost" onClick={() => leave(onSignOut)}>
        Sign Out
      </Button>
    </header>
  );
}
