import {
  Ban,
  Bell,
  CalendarCheck,
  CalendarSync,
  CalendarX,
  CircleSlash,
  CircleX,
  CornerUpLeft,
  Send,
  Split,
  TriangleAlert,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { markAllNotificationsRead, markNotificationRead, type Notification, type NotificationType, type Schedule } from "@/lib/kova-api";
import { schedulingHref } from "@/lib/scheduling";
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
};

/** Where clicking a notification should land, per its type. */
function notificationTarget(notification: Notification, schedules: Schedule[]): string | undefined {
  const { type, relatedRequestId, relatedScheduleId } = notification;
  switch (type) {
    case "REQUEST_SCHEDULED":
    case "REQUEST_RETURNED":
    case "REQUEST_SENT_BACK":
    case "REQUEST_SPLIT":
    case "REQUEST_MOVED":
    case "REQUEST_CANCELLED":
    case "CANCELLATION_DECLINED":
      return relatedRequestId ? `/requests?open=${encodeURIComponent(relatedRequestId)}` : "/requests";
    case "CANCELLATION_REQUESTED":
    case "SCHEDULE_SUBMITTED":
      return relatedScheduleId ? `/schedules?open=${encodeURIComponent(relatedScheduleId)}` : "/schedules";
    case "PROBLEM_REPORTED":
      return relatedScheduleId ? `/finished?open=${encodeURIComponent(relatedScheduleId)}` : "/finished";
    case "SCHEDULE_RETURNED": {
      // Fixed on Scheduling, opened on the schedule's day and kind.
      if (!relatedScheduleId) return "/schedules";
      const schedule = schedules.find((item) => item.id === relatedScheduleId);
      return schedulingHref(schedule?.date, schedule?.kind);
    }
    case "TRIP_PUBLISHED":
      return relatedScheduleId ? `/my-schedule?open=${encodeURIComponent(relatedScheduleId)}` : "/my-schedule";
    default:
      return undefined;
  }
}

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

function NotificationItem({ notification }: { notification: Notification }) {
  const router = useRouter();
  const { schedules } = useKovaData();
  const unread = !notification.readAt;
  const { icon: Icon, tone } = notificationIcons[notification.type] ?? { icon: Bell, tone: "info" };
  return (
    <button
      type="button"
      className={`notif-item${unread ? " unread" : ""}`}
      onClick={() => {
        if (unread) void markNotificationRead(notification.id).catch(() => {});
        const target = notificationTarget(notification, schedules);
        if (target) router.push(target);
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
  const unreadCount = notifications.filter((item) => !item.readAt).length;

  return (
    <Popover>
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
          notifications.map((notification) => <NotificationItem key={notification.id} notification={notification} />)
        )}
      </PopoverContent>
    </Popover>
  );
}
