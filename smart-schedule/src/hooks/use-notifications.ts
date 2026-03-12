import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapNotification } from "@/lib/utils/mappers";
import type { DatabaseRow } from "@/types/database";
import type { Notification } from "@/types/notification";

export function useNotifications() {
  const { site, user } = useCurrentSite();

  return useQuery<Notification[]>({
    queryKey: ["notifications", site?.id, user?.id],
    queryFn: async () => {
      if (!site || !user) return [];

      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("site_id", site.id)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data as DatabaseRow["notifications"][]).map(mapNotification);
    },
    enabled: !!site && !!user,
  });
}

export function useUnreadCount() {
  const { data: notifications = [] } = useNotifications();
  return notifications.filter((n) => !n.read).length;
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true } as never)
        .eq("id", notificationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  const { site, user } = useCurrentSite();

  return useMutation({
    mutationFn: async () => {
      if (!site || !user) return;

      const { error } = await supabase
        .from("notifications")
        .update({ read: true } as never)
        .eq("site_id", site.id)
        .eq("user_id", user.id)
        .eq("read", false);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
