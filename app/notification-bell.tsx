import {
  Ban,
  Bell,
  CalendarCheck,
  CalendarSync,
  CalendarX,
  CircleSlash,
  CircleX,
  CornerUpLeft,
  MapPinX,
  MessageSquareReply,
  Route,
  Send,
  Split,
  TriangleAlert,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { markAllNotificationsRead, markNotificationRead, type Notification, type NotificationType } from "@/lib/kova-api";
import { notificationTarget } from "@/lib/notification-target";
import { useAccount } from "./(app)/providers";
import { useKovaData } from "@/lib/use-kova-data";

/** Each type's icon, and its color: good news, news, needs a look, or something wrong. */
const notificationIcons: Record<NotificationType, { icon: LucideIcon; tone: "success" | "info" | "warning" | "error" }> = {
  REQUEST_SCHEDULED: { icon: CalendarCheck, tone: "success" },
  REQUEST_RETURNED: { icon: CalendarX, tone: "warning" },
  REQUEST_SENT_BACK: { icon: CornerUpLeft, tone: "warning" },
  REQUEST_SPLIT: { icon: Split, tone: "info" },
  REQUEST_MOVED: { icon: CalendarSync, tone: "info" },
  REQUEST_CANCELLED: { icon: CircleX, tone: "error" },
  CANCELLATION_DECLINED: { icon: Ban, tone: "warning" },
  CANCELLATION_REQUESTED: { icon: CircleSlash, tone: "warning" },
  PROBLEM_REPORTED: { icon: TriangleAlert, tone: "error" },
  SCHEDULE_SUBMITTED: { icon: Send, tone: "info" },
  SCHEDULE_RETURNED: { icon: Undo2, tone: "warning" },
  TRIP_PUBLISHED: { icon: Truck, tone: "success" },
  TRIP_CHANGED: { icon: Route, tone: "warning" },
  STOP_REPORTED: { icon: MapPinX, tone: "error" },
  STOP_MISSED: { icon: MapPinX, tone: "warning" },
  STOP_ANSWERED: { icon: MessageSquareReply, tone: "info" },
};

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NotificationItem({ notification, onOpen }: { notification: Notification; onOpen: () => void }) {
  const router = useRouter();
  const { schedules } = useKovaData();
  const { account } = useAccount();
  const unread = !notification.readAt;
  const { icon: Icon, tone } = notificationIcons[notification.type] ?? { icon: Bell, tone: "info" };
  return (
    <button
      type="button"
      className={`notif-item${unread ? " unread" : ""}`}
      onClick={() => {
        if (unread) void markNotificationRead(notification.id).catch(() => {});
        const target = notificationTarget(notification, (id) => schedules.find((item) => item.id === id), account.role);
        if (!target) return;
        // Close the panel so it doesn't cover what it opened.
        onOpen();
        router.push(target);
      }}
    >
      <span className={`notif-icon tone-${tone}`} aria-hidden="true">
        <Icon size={15} />
      </span>
      <span className="notif-text">
        <span>{notification.message}</span>
        <small>{timeAgo(notification.createdAt)}</small>
      </span>
    </button>
  );
}

export default function NotificationBell() {
  const { notifications } = useKovaData();
  const [open, setOpen] = useState(false);
  const unreadCount = notifications.filter((item) => !item.readAt).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" title="Notifications" className="notif-trigger">
          <Bell size={15} />
          {unreadCount > 0 && <span className="notif-count">{unreadCount > 9 ? "9+" : unreadCount}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="notif-panel">
        <div className="notif-header">
          <span>Notifications</span>
          {unreadCount > 0 && (
            <button type="button" onClick={() => void markAllNotificationsRead().catch(() => {})}>
              Mark all read
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div className="notif-empty">Nothing here yet</div>
        ) : (
          notifications.map((notification) => <NotificationItem key={notification.id} notification={notification} onOpen={() => setOpen(false)} />)
        )}
      </PopoverContent>
    </Popover>
  );
}
