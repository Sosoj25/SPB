// การจองของลูกค้า — สร้าง/อ่าน/ยกเลิก และตัวช่วยแปลงค่าเป็นข้อความที่คนอ่าน
//
// ตัวช่วย format วัน-เวลา-เงิน ในไฟล์นี้ (toHhMm, formatBaht, todayISO ฯลฯ)
// ถูกใช้ทั่วทั้งแอปรวมถึงฝั่งแอดมิน ไม่ใช่แค่หน้าจองของลูกค้า
import { supabase } from "./supabase";

// facilities/venues/sports มี RLS ของตัวเอง (สนามที่ปิดอยู่จะ join กลับมาเป็น null)
// ทุกที่ที่อ่านค่าเหล่านี้จึงต้องมี fallback เสมอ
const BOOKING_SELECT = `
  id,
  booking_code,
  booking_date,
  start_time,
  end_time,
  total_amount,
  status,
  payment_status,
  facilities (
    name,
    sports ( name ),
    venues ( name )
  )
`;

const STATUS_LABELS = {
  pending: { label: "รอยืนยัน", tone: "waiting" },
  confirmed: { label: "ยืนยันแล้ว", tone: "confirmed" },
  upcoming: { label: "เร็วๆนี้", tone: "upcoming" },
  awaiting_review: { label: "รอรีวิว", tone: "review" },
  completed: { label: "สำเร็จ", tone: "success" },
  no_show: { label: "ไม่ได้ไป", tone: "no_show" },
  cancelled: { label: "ยกเลิก", tone: "cancelled" },
  rejected: { label: "ถูกปฏิเสธ", tone: "rejected" },
};

// สถานะจริงของการจองมีแค่คอลัมน์ status แต่ "รอชำระเงิน"/"เร็วๆนี้" เป็น
// derived state จาก status+payment_status(+เวลา) คู่กัน — คีย์นี้ใช้ร่วมกันทั้ง
// แท็บกรองและตัวป้ายสถานะ เพื่อไม่ให้สองที่ตัดสินไม่ตรงกัน
export function bookingStatusKey(booking) {
  if (booking.status === "pending" && booking.payment_status === "unpaid") {
    return "unpaid";
  }
  // จ่ายเงินสำเร็จแล้วแต่ยังไม่ถึงเวลาเล่น — โชว์เป็น "เร็วๆนี้" แทน "ยืนยันแล้ว"
  // เฉยๆ ให้รู้ว่าต้องรออะไรต่อ (เลยเวลาไปแล้วจะกลายเป็น awaiting_review จาก
  // complete_past_bookings() cron แทน ไม่ใช่ derived key นี้อีกต่อไป)
  if (
    booking.status === "confirmed" &&
    ["paid", "approved"].includes(booking.payment_status) &&
    !hasStarted(booking)
  ) {
    return "upcoming";
  }
  return booking.status;
}

// รายการแท็บกรองสถานะ เรียงจาก "ต้องทำต่อ" ไปจนถึง "จบแล้ว" — ใช้ทั้งสร้างปุ่ม
// กรองและ map คีย์ไปเป็นข้อความ/สีของป้ายสถานะ
export const STATUS_FILTERS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "unpaid", label: "รอชำระเงิน" },
  { key: "pending", label: "รอยืนยัน" },
  { key: "upcoming", label: "เร็วๆนี้" },
  { key: "confirmed", label: "ยืนยันแล้ว" },
  { key: "awaiting_review", label: "รอรีวิว" },
  { key: "completed", label: "สำเร็จ" },
  { key: "no_show", label: "ไม่ได้ไป" },
  { key: "cancelled", label: "ยกเลิก" },
  { key: "rejected", label: "ถูกปฏิเสธ" },
];

export function describeStatus(booking) {
  const key = bookingStatusKey(booking);

  // "ยังไม่จ่ายเงิน" คือสิ่งที่ผู้ใช้ต้องลงมือทำต่อ สำคัญกว่าการบอกว่ารอแอดมินยืนยัน
  if (key === "unpaid") {
    return { label: "รอชำระเงิน", tone: "pending" };
  }

  return STATUS_LABELS[key] ?? { label: booking.status, tone: "waiting" };
}

export function describePayment(booking) {
  if (booking.payment_status === "paid" || booking.payment_status === "approved") {
    return "ชำระเงินแล้ว";
  }
  if (booking.payment_status === "pending") return "รอตรวจสอบการชำระเงิน";
  if (booking.payment_status === "rejected") return "การชำระเงินถูกปฏิเสธ";
  return "ยังไม่ชำระเงิน";
}

// tone ให้ badge สถานะชำระเงินแยกสีตามความหมาย (เขียว=จ่ายแล้ว, เหลือง=รอตรวจ,
// แดง=ถูกปฏิเสธ/ยังไม่จ่าย) — คู่กับ describePayment() ที่คืนข้อความล้วน
// แยกกันสองฟังก์ชันเพราะหลายหน้าเรียก describePayment() เป็นสตริงตรง ๆ
export function describePaymentTone(booking) {
  if (booking.payment_status === "paid" || booking.payment_status === "approved") {
    return "paid";
  }
  if (booking.payment_status === "pending") return "pending";
  if (booking.payment_status === "rejected") return "rejected";
  return "unpaid";
}

// time ใน Postgres กลับมาเป็น "18:00:00" — ตัดวินาทีทิ้งให้อ่านง่าย
export const toHhMm = (time) => (time ?? "").slice(0, 5);

export const formatTimeRange = (start, end) => `${toHhMm(start)} – ${toHhMm(end)}`;

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

// booking_date เป็น date ล้วน ต่อ T00:00:00 เพื่อให้ถูกอ่านเป็นเวลาท้องถิ่น
// ไม่ใช่ UTC (ไม่งั้นวันจะเพี้ยนไป 1 วันในโซนเวลาไทย)
const toLocalDate = (date) => new Date(`${date}T00:00:00`);

export const formatBookingDate = (date) => dateFormatter.format(toLocalDate(date));

export function todayISO() {
  return toISODate(new Date());
}

const pad = (n) => String(n).padStart(2, "0");

export const toISODate = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function addDaysISO(date, days) {
  const shifted = toLocalDate(date);
  shifted.setDate(shifted.getDate() + days);
  return toISODate(shifted);
}

// เพดานบนสุดที่ facility_day_availability (0009) ยอมตอบความว่างให้ในครั้งเดียว
// — เป็นขีดจำกัดของ "คิวรีเดียวขอได้กี่วัน" คนละเรื่องกับ "จองล่วงหน้าได้กี่วัน"
// ซึ่งเป็นค่าที่แอดมินตั้งได้ + สิทธิ์ที่ลูกค้าแลกเพิ่มได้ (ดู DEFAULT_ADVANCE_DAYS)
export const BOOKING_WINDOW_DAYS = 62;

// จองล่วงหน้าได้ถึงวันไหน — ค่าจริงมาจากฝั่งเซิร์ฟเวอร์เสมอ (my_booking_window,
// 0055) เพราะ create_booking ใช้สูตรเดียวกันตัดสินตอนกดจอง ถ้าหน้าเว็บเดาเอง
// ปฏิทินจะเปิดให้เลือกวันที่ที่กดจองแล้วโดนปฏิเสธ
//
// fallback เป็นค่า default ของ reward_settings เผื่อ RPC ล้ม — เลือกค่าที่
// "แคบกว่าความจริง" ไว้ก่อน ผู้ใช้ที่มีสิทธิ์พิเศษจะเห็นน้อยกว่าที่ควรชั่วคราว
// ซึ่งดีกว่าเปิดกว้างเกินจริงแล้วเจอ error ตอนกดจอง
export const DEFAULT_ADVANCE_DAYS = 30;

export async function fetchMyBookingWindow() {
  const { data, error } = await supabase.rpc("my_booking_window");
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    baseDays: row?.base_days ?? DEFAULT_ADVANCE_DAYS,
    bonusDays: row?.bonus_days ?? 0,
    totalDays: row?.total_days ?? DEFAULT_ADVANCE_DAYS,
    lastDate: row?.last_date ?? addDaysISO(todayISO(), DEFAULT_ADVANCE_DAYS),
    bonusUntil: row?.bonus_until ?? null,
  };
}

export function daysUntil(date) {
  const diff = toLocalDate(date) - toLocalDate(todayISO());
  return Math.round(diff / 86400000);
}

export function describeCountdown(date) {
  const days = daysUntil(date);

  if (days <= 0) return "วันนี้";
  if (days === 1) return "พรุ่งนี้";
  return `อีก ${days} วัน`;
}

export function describeFacility(booking) {
  const facility = booking.facilities;
  if (!facility) return "สนามกีฬา";

  const venue = facility.venues?.name;
  return venue ? `${venue} · ${facility.name}` : facility.name;
}

export const describeSport = (booking) => booking.facilities?.sports?.name ?? "—";

export const BOOKING_PAGE_SIZE = 20;

// ประวัติการจองทีละหน้า — ขอเกินมา 1 แถวเพื่อรู้ว่ายังมีต่อไหม จะได้ไม่ต้องยิง
// count แยกอีกรอบ (ห้ามดึงทั้งหมดรวดเดียว จำนวนแถวโตตามอายุบัญชีไม่มีเพดาน)
export async function fetchUserBookings(userId, limit = BOOKING_PAGE_SIZE) {
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("user_id", userId)
    .order("booking_date", { ascending: false })
    .order("start_time", { ascending: false })
    .limit(limit + 1);

  if (error) throw error;

  const rows = data ?? [];

  return { bookings: rows.slice(0, limit), hasMore: rows.length > limit };
}

const bahtFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// numeric ของ Postgres มาถึง JS เป็นสตริง ("1350.00") ไม่ใช่ number
export const formatBaht = (amount) => bahtFormatter.format(Number(amount ?? 0));

export function hoursBetween(start, end) {
  const [sh, sm] = toHhMm(start).split(":").map(Number);
  const [eh, em] = toHhMm(end).split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}

export const bookingHours = (booking) =>
  hoursBetween(booking.start_time, booking.end_time);

// รายละเอียดเต็มของการจอง 1 รายการ (หน้าชำระเงินและใบเสร็จใช้ร่วมกัน)
// อ่านผ่าน RLS ปกติ — bookings_select_own กันไม่ให้เปิดของคนอื่นอยู่แล้ว
export async function fetchBookingDetail(bookingId) {
  const { data, error } = await supabase
    .from("bookings")
    .select(
      `
      id,
      booking_code,
      booking_date,
      start_time,
      end_time,
      total_amount,
      deposit_amount,
      discount_amount,
      original_amount,
      redemption_id,
      status,
      payment_status,
      note,
      created_at,
      facilities (
        id,
        name,
        capacity,
        price_per_hour,
        sports ( id, name ),
        venues ( name, address, phone )
      )
    `
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw error;

  return data;
}

// สร้างการจองสถานะ pending / unpaid
//
// ส่งไปแค่ id ของช่วงเวลาที่แอดมินเปิดไว้ (เลือกได้หลายช่วง แต่ต้องต่อกัน —
// RPC เป็นคนตรวจ ไม่ใช่ฝั่งนี้) ไม่ส่งสนาม/วัน/เวลา/ยอดเงิน — RPC อ่านทั้งหมด
// จากแถวใน facility_time_slots เอง ค่าที่ผู้ใช้กำหนดเองได้จึงเหลือแค่ note
// อย่างเดียว ปิดทางจองสนามแพงในราคาถูกหรือยืดเวลาเอง
export async function createBooking({ slotIds, note }) {
  const { data, error } = await supabase.rpc("create_booking", {
    p_slot_ids: slotIds,
    p_note: note ?? null,
  });

  if (error) throw error;

  // PostgREST คืนฟังก์ชันที่ returns public.bookings เป็น object เดี่ยว
  // แต่ถ้าวันหนึ่ง signature เปลี่ยนเป็น setof ขึ้นมา หน้าที่เรียกจะพังทันที
  // เพราะอ่าน .id ไม่เจอ — คลี่ให้เหลือแถวเดียวไว้ตรงนี้ที่เดียว
  return Array.isArray(data) ? data[0] : data;
}

// เท่ากับ p_minutes ที่ create_booking / cron ส่งให้ expire_unpaid_bookings
// (0068) ถ้าแก้ที่ใดที่หนึ่งต้องแก้อีกที่ให้ตรงกัน ไม่งั้นหน้าจอจะสัญญาเวลาที่ไม่จริง
export const BOOKING_HOLD_MINUTES = 10;

// ใช้ตัดสินว่าจะโชว์ปุ่ม "ยกเลิกการจอง" ไหม — เป็นแค่เรื่องหน้าจอ
// ตัวตัดสินจริงคือ cancel_booking() ที่เทียบกับเวลาไทยฝั่ง server
export function hasStarted(booking) {
  return new Date(`${booking.booking_date}T${toHhMm(booking.start_time)}`) <= new Date();
}

export const canCancel = (booking) =>
  ["pending", "confirmed"].includes(booking.status) && !hasStarted(booking);

// ยกเลิกการจอง — ต้องผ่าน RPC เพราะ trigger ห้ามเจ้าของแถวแก้ status เอง
// reason ไม่บังคับ (ลูกค้ายกเลิกเองมักไม่ใส่) แต่แอดมินยกเลิกแทนควรระบุไว้ —
// ดู cancel_booking() 0069 ที่บันทึกลง cancelled_by/cancelled_at/cancel_reason
export async function cancelBooking(bookingId, reason) {
  const { data, error } = await supabase.rpc("cancel_booking", {
    p_booking_id: bookingId,
    p_reason: reason ?? null,
  });

  if (error) throw error;

  return Array.isArray(data) ? data[0] : data;
}

// จำนวนการจองที่ "รอชำระเงิน" ของผู้ใช้คนนี้ — ใช้ทำป้ายเตือนบนเมนู
// "ประวัติการจอง" คำนวณสดจากตาราง bookings ทุกครั้งที่เรียก ไม่มีแถวแยกเก็บ
export async function fetchUnpaidBookingCount(userId) {
  const { count, error } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending")
    .eq("payment_status", "unpaid");

  if (error) throw error;
  return count ?? 0;
}

// รายการย่อของการจองที่รอชำระเงิน — ใช้โชว์เป็นการ์ดเตือนในกระดิ่งแจ้งเตือน
// (AppHeader) เรียงเก่าสุดก่อนเพราะใกล้หมดเวลากันสิทธิ์ที่สุด
export async function fetchUnpaidBookings(userId, limit = 3) {
  const { data, error } = await supabase
    .from("bookings")
    .select(
      `
      id,
      booking_date,
      start_time,
      end_time,
      created_at,
      facilities ( name, venues ( name ) )
    `
    )
    .eq("user_id", userId)
    .eq("status", "pending")
    .eq("payment_status", "unpaid")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// ฟังการเปลี่ยนแปลงการจองแบบเรียลไทม์ของผู้ใช้คนเดียว (0077 เพิ่ม bookings
// เข้า publication แล้ว) — ใช้ให้การ์ด "รายการถัดไป" ในหน้า Home อัปเดต
// สถานะชำระเงินเองทันทีที่แอดมินอนุมัติ/ปฏิเสธ โดยไม่ต้องรอผู้ใช้กดรีเฟรช
// RLS ของตารางเอง (bookings_select_own) จำกัดอยู่แล้วว่าเห็นได้แค่แถวของ
// ตัวเอง แต่ใส่ filter user_id ซ้ำเพื่อไม่ให้ฝั่ง Realtime server ต้องส่ง
// event ของคนอื่นมาเช็ค RLS ทุกแถวโดยไม่จำเป็น (รูปแบบเดียวกับ
// subscribeToNotifications ใน lib/notifications.js)
let bookingChannelSeq = 0;

export function subscribeToBookingChanges(userId, onChange) {
  const channel = supabase
    .channel(`bookings:${userId}:${++bookingChannelSeq}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "bookings", filter: `user_id=eq.${userId}` },
      onChange,
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

export async function fetchNextBooking(userId) {
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("user_id", userId)
    .in("status", ["pending", "confirmed"])
    .gte("booking_date", todayISO())
    .order("booking_date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data;
}
