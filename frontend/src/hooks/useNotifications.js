// แจ้งเตือนของผู้ใช้ที่ล็อกอินอยู่ — รายการและจำนวนที่ยังไม่อ่าน
//
// ทั้งคู่ดึงใหม่เองเมื่อมีแถวเปลี่ยนทาง Realtime ไม่ต้องรอผู้ใช้กดรีเฟรช
import { useEffect, useState } from "react";
import { useAsyncData } from "./useAsyncData";
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  subscribeToNotifications,
} from "../lib/notifications";

// นับรอบทุกครั้งที่มีแถวแจ้งเตือนของ user นี้เปลี่ยน (insert ใหม่ / mark read)
// เข้ามาทาง Realtime — ผสมกับ reloadKey ที่ผู้เรียกส่งมาเป็น key ให้
// useAsyncData ยิง fetch ใหม่เอง ไม่ต้องรอผู้ใช้กดรีเฟรชหรือ bump reloadKey มือ
function useNotificationsTick(userId) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribeToNotifications(userId, () => setTick((value) => value + 1));
  }, [userId]);

  return tick;
}

export function useNotifications(
  userId,
  reloadKey = 0,
  limit = 20,
  excludeTypes = null,
  unreadOnly = false,
) {
  const tick = useNotificationsTick(userId);
  const { data, loading, error } = useAsyncData(
    () => fetchNotifications(userId, limit, excludeTypes, unreadOnly),
    userId
      ? `notifications:${userId}:${limit}:${excludeTypes}:${unreadOnly}:${reloadKey}:${tick}`
      : null,
  );

  return { notifications: data ?? [], loading, error };
}

export function useUnreadNotificationCount(userId, reloadKey = 0, excludeTypes = null) {
  const tick = useNotificationsTick(userId);
  const { data } = useAsyncData(
    () => fetchUnreadNotificationCount(userId, excludeTypes),
    userId ? `notifications-unread-count:${userId}:${excludeTypes}:${reloadKey}:${tick}` : null,
  );

  return data ?? 0;
}
