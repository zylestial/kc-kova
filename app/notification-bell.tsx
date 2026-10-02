import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getNotifications, getUnreadNotificationCount, markAllNotificationsRead, markNotificationRead, type Notification } from "@/lib/kova-api";

/** Where clicking a notification should land, per its type. */
function notificationTarget(notification: Notification): string | undefined {
  const { type, relatedRequestId, relatedScheduleId } = notification;
  switch (type) {
    case "REQUEST_SCHEDULED":
    case "REQUEST_RETURNED":
    case "REQUEST_SENT_BACK":
    case "REQUEST_SPLIT":
    case "REQUEST_CANCELLED":
    case "CANCELLATION_DECLINED":
      return relatedRequestId ? `/requests?open=${encodeURIComponent(relatedRequestId)}` : "/requests";
    case "CANCELLATION_REQUESTED":
    case "SCHEDULE_SUBMITTED":
      return relatedScheduleId ? `/schedules?open=${encodeURIComponent(relatedScheduleId)}` : "/schedules";
    case "PROBLEM_REPORTED":
      return relatedScheduleId ? `/finished?open=${encodeURIComponent(relatedScheduleId)}` : "/finished";
    case "SCHEDULE_RETURNED":
      return relatedScheduleId ? `/schedules/new?scheduleId=${encodeURIComponent(relatedScheduleId)}` : "/schedules";
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
  const unread = !notification.readAt;
  return (
    <button
      type="button"
      className={`notif-item${unread ? " unread" : ""}`}
      onClick={() => {
        if (unread) void markNotificationRead(notification.id).catch(() => {});
        const target = notificationTarget(notification);
        if (target) router.push(target);
      }}
    >
      <span>{notification.message}</span>
      <small>{timeAgo(notification.createdAt)}</small>
    </button>
  );
}

export default function NotificationBell() {
  const notifications = getNotifications();
  const unreadCount = getUnreadNotificationCount();

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
