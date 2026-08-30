import { supabase } from "./supabase";

// เขียนแถวเข้าตารางนี้จริงแล้วที่ 5 จุด (ดู 0037_wire_notifications.sql) — ตอน
// แอดมินอนุมัติ/ปฏิเสธการชำระเงิน และอนุมัติ/ปฏิเสธ/ปิดงานคำขอคืนเงิน
// reference_type เป็น "booking" เสมอ ชี้กลับไปที่ booking_id เพราะหน้าเว็บมี
// แค่ /booking/receipt?booking= ที่พาไปดูรายละเอียดได้จริง

export async function fetchNotifications(userId, limit = 20) {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, title, message, reference_type, reference_id, is_read, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function fetchUnreadNotificationCount(userId) {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId) {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) throw error;
}

export function notificationLink(notification) {
  if (notification.reference_type === "booking" && notification.reference_id) {
    return `/booking/receipt?booking=${notification.reference_id}`;
  }
  return null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const formatNotificationTime = (value) =>
  value ? dateTimeFormatter.format(new Date(value)) : "—";
