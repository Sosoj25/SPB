// แจ้งเตือนในแอป — อ่าน/mark read/ฟังเรียลไทม์ และ map ว่าแต่ละใบกดแล้วไปไหน
//
// ฝั่งหน้าเว็บไม่เคยเขียนแถวแจ้งเตือนเอง ทุกใบเกิดจาก trigger/cron ฝั่งฐานข้อมูล
import { supabase } from "./supabase";

// เขียนแถวเข้าตารางนี้จริงแล้วที่ 5 จุด (ดู 0037_wire_notifications.sql) — ตอน
// แอดมินอนุมัติ/ปฏิเสธการชำระเงิน และอนุมัติ/ปฏิเสธ/ปิดงานคำขอคืนเงิน
// reference_type เป็น "booking" เสมอ ชี้กลับไปที่ booking_id เพราะหน้าเว็บมี
// แค่ /booking/receipt?booking= ที่พาไปดูรายละเอียดได้จริง
//
// อีกจุดที่ชี้กลับไปที่ booking เหมือนกันคือ type "review_pending" (0093) —
// cron complete_past_bookings() เขียนให้เองตอนการจองเลยเวลาเล่นแล้วเข้าสถานะ
// awaiting_review กดแล้วไปโผล่ที่ใบเสร็จซึ่งเด้งฟอร์มรีวิวให้ทันที และ
// submit_review() จะ mark read แถวนี้ให้เองเมื่อรีวิวสำเร็จ

// สองประเภทนี้ต่างจากที่เหลือตรงที่ "ยังมีงานค้างอยู่ที่ตัวลูกค้า" การกดเข้าไป
// ดูจึงไม่นับว่าอ่านแล้ว — ต้องค้างเป็นยังไม่อ่านจนกว่าจะเขียนรีวิว/กดยืนยันรับ
// ของจริง แล้ว trigger ฝั่งฐานข้อมูล (0107) จะปิดให้เองเมื่องานนั้นเสร็จ ไม่ว่า
// จะเสร็จจากทางไหน หน้าเว็บจึงไม่ต้อง mark read สองชนิดนี้เองเลยสักที่
export const ACTION_REQUIRED_NOTIFICATION_TYPES = ["review_pending", "reward_receipt_pending"];

export const isActionRequiredNotification = (notification) =>
  ACTION_REQUIRED_NOTIFICATION_TYPES.includes(notification?.type);

// excludeTypes รับได้ทั้งชื่อ type เดี่ยว ๆ และหลายชื่อเป็น array — กระดิ่งของ
// AppHeader ต้องซ่อนหลายประเภทพร้อมกัน (แชทชุมชน + เรื่องติดต่อเรา) เพราะทั้งคู่
// มีป้ายเลขยังไม่อ่านของตัวเองอยู่ที่เมนูนั้น ๆ อยู่แล้ว ถ้าโผล่ในกระดิ่งด้วย
// ผู้ใช้จะเห็นของชิ้นเดียวกันนับซ้ำสองที่
function applyTypeExclusion(query, excludeTypes) {
  const types = (Array.isArray(excludeTypes) ? excludeTypes : [excludeTypes]).filter(Boolean);

  if (types.length === 0) return query;
  if (types.length === 1) return query.neq("type", types[0]);

  return query.not("type", "in", `(${types.join(",")})`);
}

// unreadOnly — กระดิ่งเป็น "กล่องของที่ยังไม่ได้ดู" ไม่ใช่ไทม์ไลน์ อ่านแล้วต้อง
// หายออกไปเลย ไม่ใช่ค้างอยู่เป็นแถบสีจาง ๆ ปนกับของใหม่ (ที่เดิมยิ่งแย่เพราะ
// กระดิ่งโชว์ได้แค่ 8 ใบ ของที่อ่านแล้วจึงเบียดของที่ยังไม่ได้ดูตกขอบไป)
// ประวัติทั้งหมดยังอยู่ครบที่ /profile?tab=notifications ซึ่งอ่านเป็นไทม์ไลน์
// จึงดึงทุกใบตามเดิม
export async function fetchNotifications(userId, limit = 20, excludeTypes = null, unreadOnly = false) {
  const query = applyTypeExclusion(
    supabase
      .from("notifications")
      .select("id, type, title, message, reference_type, reference_id, is_read, created_at")
      .eq("user_id", userId),
    excludeTypes,
  );

  const scoped = unreadOnly ? query.eq("is_read", false) : query;
  const { data, error } = await scoped.order("created_at", { ascending: false }).limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function fetchUnreadNotificationCount(userId, excludeTypes = null) {
  const query = applyTypeExclusion(
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false),
    excludeTypes,
  );

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  if (error) throw error;
}

// excludeTypes ที่นี่ต้องใส่อย่างน้อย ACTION_REQUIRED_NOTIFICATION_TYPES เสมอ
// ไม่งั้นการ "เคลียร์ทั้งหมด" จะลบใบที่ยังต้องทำงานทิ้งไปด้วย ซึ่งเป็นสิ่งเดียว
// ที่เตือนให้กลับมารีวิว/กดยืนยันรับของ
export async function markAllNotificationsRead(userId, excludeTypes = null) {
  const query = applyTypeExclusion(
    supabase.from("notifications").update({ is_read: true }).eq("user_id", userId),
    excludeTypes,
  );

  const { error } = await query.eq("is_read", false);

  if (error) throw error;
}

// reference_type ที่ระบบเขียนเข้ามาตอนนี้: "booking" (0037) และอีก 3 ตัวจาก
// ชุมชน (0044) — คอมเมนต์ใหม่ / ผู้ติดตามใหม่ / ข้อความใหม่
const NOTIFICATION_ROUTES = {
  booking: (id) => `/booking/receipt?booking=${id}`,
  community_post: (id) => `/community/post/${id}`,
  community_profile: (id) => `/community/profile/${id}`,
  conversation: (id) => `/messages?c=${id}`,
  // แลกรางวัล/จัดส่ง/ยกเลิก (0047) — ประวัติไม่มี route รายใบ พาไปหน้ารวมแล้ว
  // ไฮไลต์คูปองใบนั้นด้วย ?code= แทน
  redemption: () => "/rewards/history",
  // รายงานเนื้อหาใหม่ (0052) — ส่งถึงแอดมินทุกคน คิวตรวจสอบอยู่หน้าเดียว
  // ไม่มีหน้ารายใบ จึงพาไปที่คิวรวมเหมือน redemption
  community_report: () => "/admin/community",
  // ทีมงานตอบกลับ/ปิดเรื่องที่ลูกค้าติดต่อเข้ามา (0096) — เธรดอยู่ในหน้า
  // ติดต่อเรา ใช้ ?ticket= ให้หน้านั้นเลื่อนไปที่เรื่องนั้นให้เอง
  support_ticket: (id) => `/contact?ticket=${id}`,
  // เตือนแอดมินว่ามีสลิปโอนเงินค้างรอตรวจนานเกินกำหนด (0101) — เป็นการสรุป
  // รวมวันละครั้ง ไม่ได้ชี้ใบใดใบหนึ่ง reference_id จึงเป็น null และ builder
  // ตัวนี้ไม่รับพารามิเตอร์เหมือน redemption/community_report
  admin_payments: () => "/admin/payments",
};

// ฟังแจ้งเตือนใหม่/เปลี่ยนสถานะอ่านแบบเรียลไทม์ของผู้ใช้คนเดียว — ต้องเพิ่ม
// public.notifications เข้า publication ก่อน (0065) RLS ของตารางเอง
// (notifications_select_own) จำกัดอยู่แล้วว่าเห็นได้แค่แถวของตัวเอง แต่ใส่
// filter user_id ซ้ำเพื่อไม่ให้ฝั่ง Realtime server ต้องส่ง event ของคนอื่นมา
// เช็ค RLS ทุกแถวโดยไม่จำเป็น
//
// ชื่อ channel ต้องไม่ซ้ำกันข้ามการเรียกแต่ละครั้ง — supabase.channel(topic)
// คืน instance เดิมถ้าชื่อ topic ซ้ำ (ดู RealtimeClient.channel) และ NotificationBell
// เรียก subscribeToNotifications ผ่านสอง hook พร้อมกัน (useNotifications +
// useUnreadNotificationCount) ถ้าใช้ชื่อเดียวกันตัวที่สองจะได้ channel ที่
// subscribe() ไปแล้วของตัวแรกมา แล้ว .on() ซ้ำจะ throw ทันที
//
// คืน unsubscribe ให้ผู้เรียกไปใช้ใน cleanup ของ useEffect เหมือน
// subscribeToMessages ใน lib/messages.js
let notificationChannelSeq = 0;

export function subscribeToNotifications(userId, onChange) {
  const channel = supabase
    .channel(`notifications:${userId}:${++notificationChannelSeq}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      onChange,
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

export function notificationLink(notification) {
  const build = NOTIFICATION_ROUTES[notification.reference_type];
  if (!build) return null;

  // builder ที่ไม่รับพารามิเตอร์ (redemption, community_report, admin_payments)
  // พาไปหน้ารวมอยู่แล้ว จึงต้องสร้างลิงก์ได้แม้ reference_id เป็น null —
  // แจ้งเตือนแบบสรุปรวมไม่ได้ชี้ของชิ้นไหนเป็นพิเศษ
  if (build.length === 0) return build();

  return notification.reference_id ? build(notification.reference_id) : null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const formatNotificationTime = (value) =>
  value ? dateTimeFormatter.format(new Date(value)) : "—";
