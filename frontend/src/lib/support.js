// ระบบ "ติดต่อเรา" (0096) — ลูกค้าส่งคำถาม/ปัญหาจากหน้า /contact แล้วแอดมิน
// ตอบกลับที่ /admin/support ในเธรดเดียวกัน ทั้งสองฝั่งเขียนผ่าน RPC security
// definer เท่านั้น (ตาราง support_tickets เปิดแค่ select ให้เจ้าของกับแอดมิน)
import { supabase } from "./supabase";
import { escapeSearchTerm } from "./searchTerm";

// หัวข้อติดต่อ — ต้องตรงกับ support_tickets_category_check ใน 0096 เป๊ะ ๆ
// ไม่งั้นจะโดนฐานข้อมูลตีกลับเป็น error ภาษาอังกฤษที่ผู้ใช้อ่านไม่รู้เรื่อง
export const SUPPORT_CATEGORIES = [
  "ปัญหาการจอง",
  "ปัญหาการชำระเงิน",
  "ปัญหาการคืนเงิน",
  "สอบถามทั่วไป",
  "ข้อเสนอแนะ",
  "อื่นๆ",
];

export const SUPPORT_STATUS_LABELS = {
  new: { label: "ใหม่", tone: "primary" },
  pending: { label: "รอดำเนินการ", tone: "warning" },
  closed: { label: "ปิดแล้ว", tone: "success" },
};

export const describeSupportStatus = (status) =>
  SUPPORT_STATUS_LABELS[status] ?? { label: status ?? "—", tone: "muted" };

// ฟิลเตอร์บนหน้าแอดมิน — key ตรงกับ status ในฐานข้อมูล ส่วน "" คือทั้งหมด
// countKey ชี้ไปที่ field ของ admin_support_ticket_stats() เพื่อเอาเลขในวงเล็บ
export const SUPPORT_FILTERS = [
  { key: "", label: "ทั้งหมด", countKey: "total" },
  { key: "new", label: "ใหม่", countKey: "new" },
  { key: "pending", label: "รอดำเนินการ", countKey: "pending" },
  { key: "closed", label: "ปิดแล้ว", countKey: "closed" },
];

const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const formatSupportTime = (value) =>
  value ? dateTimeFormatter.format(new Date(value)) : "—";

// เวลาแบบ "12 นาทีที่แล้ว" ตามดีไซน์ — เรื่องที่เพิ่งเข้ามาต้องอ่านออกทันที
// ว่าสด ๆ ร้อน ๆ แค่ไหน ส่วนของเก่าเกินสัปดาห์ระยะห่างไม่มีความหมายแล้ว
// เลยกลับไปโชว์เป็นวันที่จริง
export function formatRelativeTime(value) {
  if (!value) return "—";

  const then = new Date(value);
  const diffMs = Date.now() - then.getTime();
  const minutes = Math.round(diffMs / 60000);

  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ชม.ที่แล้ว`;

  const days = Math.round(hours / 24);
  if (days === 1) return "เมื่อวาน";
  if (days < 7) return `${days} วันก่อน`;

  return formatSupportTime(value);
}

// ---------- ฝั่งลูกค้า ----------

// bookingId เป็นตัวเลือก — ลูกค้าที่มาถามเรื่องการจองใดการจองหนึ่งผูกเรื่อง
// ไว้กับใบจองได้เลย แอดมินจะได้ไม่ต้องไล่ถามรหัสการจองกลับไปอีกรอบ
export async function submitSupportTicket({
  category,
  fullName,
  phone,
  email,
  message,
  bookingId,
}) {
  const { data, error } = await supabase.rpc("submit_support_ticket", {
    p_category: category,
    p_full_name: fullName,
    p_phone: phone || null,
    p_email: email,
    p_message: message,
    p_booking_id: bookingId || null,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

const TICKET_SELECT = `
  id,
  category,
  full_name,
  phone,
  email,
  message,
  status,
  booking_id,
  first_replied_at,
  last_reply_at,
  closed_at,
  created_at,
  support_ticket_replies ( id, body, is_staff, created_at ),
  bookings ( booking_code, booking_date, start_time, end_time )
`;

export async function fetchMySupportTickets(userId, limit = 10) {
  const { data, error } = await supabase
    .from("support_tickets")
    .select(TICKET_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(normalizeTicket);
}

export async function replySupportTicket(ticketId, body) {
  const { data, error } = await supabase.rpc("reply_support_ticket", {
    p_ticket_id: ticketId,
    p_body: body,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// ---------- ฝั่งแอดมิน ----------

const ADMIN_TICKET_SELECT = `
  id,
  user_id,
  category,
  full_name,
  phone,
  email,
  message,
  status,
  booking_id,
  first_replied_at,
  last_reply_at,
  closed_at,
  created_at,
  profiles!support_tickets_user_id_fkey ( username, full_name, avatar_url ),
  support_ticket_replies ( id, body, is_staff, created_at ),
  bookings ( booking_code, booking_date, start_time, end_time )
`;

export const ADMIN_SUPPORT_PAGE_SIZE = 10;

// เรียงตามเวลาที่มีความเคลื่อนไหวล่าสุด (ตอบกลับครั้งสุดท้าย ถ้ายังไม่มีใคร
// ตอบก็ใช้เวลาที่ส่งเข้ามา) ไม่ใช่เวลาที่สร้างอย่างเดียว — เรื่องที่ลูกค้า
// เพิ่งตอบกลับมาเมื่อกี้ต้องเด้งขึ้นหัวคิว ไม่ใช่จมอยู่ล่างสุดเพราะเปิดไว้
// ตั้งแต่อาทิตย์ที่แล้ว
//
// ขอเกินมา 1 แถวเพื่อรู้ว่ามีหน้าถัดไปไหม เหมือน fetchAdminRefunds
export async function fetchAdminSupportTickets({
  status,
  query,
  page = 1,
  limit = ADMIN_SUPPORT_PAGE_SIZE,
} = {}) {
  let request = supabase
    .from("support_tickets")
    .select(ADMIN_TICKET_SELECT)
    .order("last_reply_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (status) request = request.eq("status", status);

  // ค้นหาจากชื่อ/อีเมล/เนื้อความ — แอดมินมักจำได้แค่ "คนที่ถามเรื่องแต้มหาย"
  // หรือมีแต่อีเมลที่ลูกค้าโทรมาบอก ไม่ได้มีรหัสเรื่องในมือ
  const term = query ? escapeSearchTerm(query) : "";

  if (term) {
    request = request.or(
      `full_name.ilike.%${term}%,email.ilike.%${term}%,message.ilike.%${term}%`,
    );
  }

  const from = (page - 1) * limit;
  const { data, error } = await request.range(from, from + limit);

  if (error) throw error;

  const rows = (data ?? []).map(normalizeTicket);
  return { tickets: rows.slice(0, limit), hasMore: rows.length > limit };
}

export async function fetchAdminSupportStats() {
  const { data, error } = await supabase.rpc("admin_support_ticket_stats");

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    total: row?.total_count ?? 0,
    new: row?.new_count ?? 0,
    pending: row?.pending_count ?? 0,
    closed: row?.closed_count ?? 0,
    repliedToday: row?.replied_today ?? 0,
    avgResponseHours: row?.avg_response_hours == null ? null : Number(row.avg_response_hours),
  };
}

export async function adminReplySupportTicket(ticketId, body) {
  const { data, error } = await supabase.rpc("admin_reply_support_ticket", {
    p_ticket_id: ticketId,
    p_body: body,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function adminSetSupportTicketStatus(ticketId, status) {
  const { data, error } = await supabase.rpc("admin_set_support_ticket_status", {
    p_ticket_id: ticketId,
    p_status: status,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// แถวตอบกลับที่ embed มาจาก PostgREST ไม่รับประกันลำดับ — เรียงเองที่นี่ที่
// เดียว ทั้งสองหน้าจะได้เห็นเธรดเรียงจากเก่าไปใหม่เหมือนกัน
function normalizeTicket(row) {
  const replies = [...(row.support_ticket_replies ?? [])].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at),
  );

  return {
    ...row,
    replies,
    replyCount: replies.length,
    profile: row.profiles ?? null,
    booking: row.bookings ?? null,
  };
}

// จำนวนเรื่องที่ยังไม่ปิด — ใช้เป็นป้ายตัวเลขข้างเมนู "ข้อความติดต่อ" และใน
// กระดิ่งของแอดมิน (ดู fetchAdminQueueCounts ใน lib/admin.js) เรื่องที่ปิดแล้ว
// ไม่ใช่คิวค้างจึงไม่นับ
export async function fetchAdminSupportPendingCount() {
  const { count, error } = await supabase
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .in("status", ["new", "pending"]);

  if (error) throw error;
  return count ?? 0;
}

// ---------- ข้อมูลติดต่อที่แสดงบนหน้าติดต่อเรา (0098) ----------

const CONTACT_SETTINGS_SELECT =
  "phone, phone_hint, email, email_hint, line_id, line_hint, line_url, office_address, map_url";

function toContactSettings(row) {
  return {
    phone: row.phone ?? "",
    phoneHint: row.phone_hint ?? "",
    email: row.email ?? "",
    emailHint: row.email_hint ?? "",
    lineId: row.line_id ?? "",
    lineHint: row.line_hint ?? "",
    lineUrl: row.line_url ?? "",
    officeAddress: row.office_address ?? "",
    mapUrl: row.map_url ?? "",
  };
}

export async function fetchSupportContactSettings() {
  const { data, error } = await supabase
    .from("support_contact_settings")
    .select(CONTACT_SETTINGS_SELECT)
    .eq("id", 1)
    .single();

  if (error) throw error;
  return toContactSettings(data);
}

// เขียนตรงผ่าน RLS (admin_manage, 0098) ไม่ผ่าน RPC — ตารางนี้เป็นข้อความล้วน
// ไม่มีกติกาทางธุรกิจให้บังคับฝั่งเซิร์ฟเวอร์เหมือนยอดคืนเงินหรือสถานะเรื่อง
// pattern เดียวกับ updateFacilitiesPageSettings ใน lib/amenities.js
export async function updateSupportContactSettings(settings) {
  const { data, error } = await supabase
    .from("support_contact_settings")
    .update({
      phone: settings.phone.trim(),
      phone_hint: settings.phoneHint.trim(),
      email: settings.email.trim(),
      email_hint: settings.emailHint.trim(),
      line_id: settings.lineId.trim(),
      line_hint: settings.lineHint.trim(),
      line_url: settings.lineUrl.trim(),
      office_address: settings.officeAddress.trim(),
      map_url: settings.mapUrl.trim(),
    })
    .eq("id", 1)
    .select(CONTACT_SETTINGS_SELECT)
    .single();

  if (error) throw error;
  return toContactSettings(data);
}

// ประกอบช่องทางติดต่อสำหรับหน้าลูกค้า — ช่องที่แอดมินเว้นว่างจะหายไปทั้งอัน
// ไม่ใช่โชว์หัวข้อค้างไว้โดยไม่มีค่า (สนามที่ยังไม่มี LINE Official ก็ลบทิ้งได้)
//
// href ของโทรศัพท์ตัดอักขระที่ไม่ใช่ตัวเลขออก เพราะแอดมินพิมพ์ขีดคั่นมาได้
// ส่วน LINE ถ้าไม่ได้ใส่ลิงก์ไว้ก็ประกอบจากไอดีให้เอง
export function buildContactChannels(settings) {
  const phoneDigits = settings.phone.replace(/[^0-9+]/g, "");

  return [
    {
      icon: "📞",
      label: "โทรศัพท์",
      value: settings.phone,
      hint: settings.phoneHint,
      href: `tel:${phoneDigits}`,
    },
    {
      icon: "✉️",
      label: "อีเมล",
      value: settings.email,
      hint: settings.emailHint,
      href: `mailto:${settings.email}`,
    },
    {
      icon: "💬",
      label: "LINE Official",
      value: settings.lineId,
      hint: settings.lineHint,
      href:
        settings.lineUrl ||
        `https://line.me/R/ti/p/${encodeURIComponent(settings.lineId)}`,
    },
  ].filter((channel) => channel.value);
}

export function buildMapUrl(settings) {
  if (settings.mapUrl) return settings.mapUrl;
  if (!settings.officeAddress) return "";

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    settings.officeAddress,
  )}`;
}

// ---------- Realtime ----------

// ฟังความเคลื่อนไหวของเธรดติดต่อทั้งสองตาราง (0097) — ใช้ร่วมกันทั้งฝั่งลูกค้า
// และฝั่งแอดมิน ไม่ต้องใส่ filter ให้ถูกเอง เพราะ postgres_changes กรองด้วย RLS
// ของตารางอยู่แล้ว (ลูกค้าเห็นเฉพาะเรื่องตัวเอง แอดมินเห็นทุกเรื่อง)
//
// ชื่อ channel ต้องไม่ซ้ำข้ามการเรียกแต่ละครั้ง — supabase.channel(topic) คืน
// instance เดิมถ้าชื่อซ้ำ แล้ว .on() ทับของเดิมจะ throw ทันที (เหตุผลเดียวกับ
// subscribeToNotifications ใน lib/notifications.js) หน้าแอดมินเรียกฟังก์ชันนี้
// จากหลาย hook พร้อมกันได้ (รายการ + สถิติ + ตัวเลขคิวในแถบซ้าย)
let supportChannelSeq = 0;

export function subscribeToSupportThreads(onChange) {
  const channel = supabase
    .channel(`support:${++supportChannelSeq}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "support_ticket_replies" },
      onChange,
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, onChange)
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// ---------- แจ้งเตือนฝั่งลูกค้า ----------

// ประเภทแจ้งเตือนที่ระบบติดต่อเราเขียนเข้าตาราง notifications (0096) — กระดิ่ง
// ของ AppHeader ซ่อนสองประเภทนี้ เพราะเลขเดียวกันขึ้นอยู่ที่เมนู "ติดต่อเรา" แล้ว
export const SUPPORT_NOTIFICATION_TYPES = ["support_reply", "support_closed"];

// แถวแจ้งเตือนที่ RPC ฝั่งแอดมินเขียนให้ตอนตอบกลับ/ปิดเรื่อง (0096) — ดึงมาทั้งแถว
// ไม่ใช่แค่ยอดรวม เพราะต้องรู้ด้วยว่าของใหม่มาจากเรื่องไหนบ้าง (reference_id)
// เอาไปไฮไลต์เธรดนั้นในหน้าติดต่อเราตอนที่มีหลายเรื่องค้างพร้อมกัน
//
// 50 แถวพอสำหรับงานนี้ — ป้ายตัวเลขที่เกินร้อยไม่ได้บอกอะไรเพิ่มอยู่แล้ว และ
// ทุกแถวจะถูกติ๊กอ่านทันทีที่ลูกค้ากางเธรดนั้น (markSupportTicketNotificationsRead)
export async function fetchUnreadSupportReplies(userId) {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, reference_id, created_at")
    .eq("user_id", userId)
    .eq("reference_type", "support_ticket")
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  const rows = data ?? [];
  const byTicket = new Map();

  for (const row of rows) {
    if (!row.reference_id) continue;
    byTicket.set(row.reference_id, (byTicket.get(row.reference_id) ?? 0) + 1);
  }

  return { count: rows.length, byTicket, latestTicketId: rows[0]?.reference_id ?? null };
}

// ติ๊กว่าอ่านแล้วตอนลูกค้ากางเธรดนั้นจริง ๆ — จุดแดงกับกระดิ่งจะได้หายพร้อมกัน
// และไม่ค้างอยู่ทั้งที่เพิ่งอ่านคำตอบไปเมื่อกี้
//
// ไม่ throw เมื่อพลาด: นี่เป็นงานเก็บกวาดหลังบ้าน ไม่ใช่สิ่งที่ผู้ใช้กำลังรอผล
export async function markSupportTicketNotificationsRead(userId, ticketId) {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("reference_type", "support_ticket")
    .eq("reference_id", ticketId)
    .eq("is_read", false);

  if (error) console.error("markSupportTicketNotificationsRead failed:", error);
}
