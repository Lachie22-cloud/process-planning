import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/ui/cn";
import { AlertTriangle, Info, AlertCircle, Check } from "lucide-react";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from "@/hooks/use-notifications";
import type { Notification } from "@/types/notification";

interface NotificationPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TYPE_ICONS: Record<string, typeof Info> = {
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
};

function NotificationItem({
  notification,
  onMarkRead,
  onOpenBatch,
  onOpenResourceView,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onOpenBatch: (notification: Notification) => void;
  onOpenResourceView: (notification: Notification) => void;
}) {
  const Icon = TYPE_ICONS[notification.type ?? "info"] ?? Info;
  const iconColour =
    notification.type === "error"
      ? "text-red-500"
      : notification.type === "warning"
        ? "text-amber-500"
        : "text-blue-500";

  return (
    <div
      className={cn(
        "flex gap-3 rounded-md border p-3 transition-colors",
        !notification.read && "bg-muted/50",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconColour)} />
      <div className="min-w-0 flex-1">
        {notification.title && (
          <p className="text-sm font-medium">{notification.title}</p>
        )}
        {notification.message && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {notification.message}
          </p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground">
          {format(new Date(notification.createdAt), "d MMM yyyy, HH:mm")}
        </p>
      </div>
      {!notification.read && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => onMarkRead(notification.id)}
          aria-label="Mark notification as read"
        >
          <Check className="h-3 w-3" />
        </Button>
      )}
      {notification.batchId && (
        <div className="flex shrink-0 flex-col gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => onOpenBatch(notification)}
          >
            Open batch
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => onOpenResourceView(notification)}
          >
            Open resource view
          </Button>
        </div>
      )}
    </div>
  );
}

export function NotificationPanel({
  open,
  onOpenChange,
}: NotificationPanelProps) {
  const navigate = useNavigate();
  const { data: notifications = [], isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );
  const visibleNotifications = useMemo(() => {
    if (filter === "all") return notifications;
    return notifications.filter((n) => !n.read);
  }, [filter, notifications]);

  const openBatch = (notification: Notification) => {
    if (!notification.batchId) return;
    markRead.mutate(notification.id);
    navigate(`/schedule?batchId=${notification.batchId}`);
    onOpenChange(false);
  };

  const openResourceView = (notification: Notification) => {
    if (!notification.batchId) return;
    markRead.mutate(notification.id);
    navigate(`/resources?batchId=${notification.batchId}`);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>{unreadCount} unread</SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex items-center justify-between gap-3">
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as "unread" | "all")}
          >
            <TabsList className="h-8">
              <TabsTrigger value="unread" className="text-xs">
                Unread
              </TabsTrigger>
              <TabsTrigger value="all" className="text-xs">
                All
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            Mark all as read
          </Button>
        </div>

        <ScrollArea className="mt-4 h-[calc(100vh-120px)]">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : visibleNotifications.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {filter === "unread"
                ? "No unread notifications."
                : "No notifications yet."}
            </p>
          ) : (
            <div className="space-y-2">
              {visibleNotifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkRead={(id) => markRead.mutate(id)}
                  onOpenBatch={openBatch}
                  onOpenResourceView={openResourceView}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
