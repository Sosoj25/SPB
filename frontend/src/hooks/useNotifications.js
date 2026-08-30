import { useAsyncData } from "./useAsyncData";
import { fetchNotifications, fetchUnreadNotificationCount } from "../lib/notifications";

export function useNotifications(userId, reloadKey = 0, limit = 20) {
  const { data, loading, error } = useAsyncData(
    () => fetchNotifications(userId, limit),
    userId ? `notifications:${userId}:${limit}:${reloadKey}` : null,
  );

  return { notifications: data ?? [], loading, error };
}

export function useUnreadNotificationCount(userId, reloadKey = 0) {
  const { data } = useAsyncData(
    () => fetchUnreadNotificationCount(userId),
    userId ? `notifications-unread-count:${userId}:${reloadKey}` : null,
  );

  return data ?? 0;
}
