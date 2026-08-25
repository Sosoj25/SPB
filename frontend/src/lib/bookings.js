import { supabase } from "./supabase";

// facilities/venues/sports มี RLS ของตัวเอง (สนามที่ปิดอยู่จะ join กลับมาเป็น null)
// ทุกที่ที่อ่านค่าเหล่านี้จึงต้องมี fallback เสมอ
const BOOKING_SELECT = `
  id,
  booking_code,
  booking_date,
  start_time,
  end_time,
  status,
  payment_status,
  facilities (
    name,
    sports ( name ),
    venues ( name )
  )
`;

const STATUS_LABELS = {
  pending: { label: "รอยืนยัน", tone: "booked" },
  confirmed: { label: "จองแล้ว", tone: "booked" },
  completed: { label: "สำเร็จ", tone: "success" },
  cancelled: { label: "ยกเลิก", tone: "cancelled" },
  rejected: { label: "ถูกปฏิเสธ", tone: "cancelled" },
};

export function describeStatus(booking) {
  // "ยังไม่จ่ายเงิน" คือสิ่งที่ผู้ใช้ต้องลงมือทำต่อ สำคัญกว่าการบอกว่ารอแอดมินยืนยัน
  if (booking.status === "pending" && booking.payment_status === "unpaid") {
    return { label: "รอชำระเงิน", tone: "pending" };
  }

  return STATUS_LABELS[booking.status] ?? { label: booking.status, tone: "booked" };
}

export function describePayment(booking) {
  if (booking.payment_status === "paid" || booking.payment_status === "approved") {
    return "ชำระเงินแล้ว";
  }
  if (booking.payment_status === "pending") return "รอตรวจสอบการชำระเงิน";
  if (booking.payment_status === "rejected") return "การชำระเงินถูกปฏิเสธ";
  return "ยังไม่ชำระเงิน";
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

// เท่ากับ least(p_to, p_from + 62) ใน facility_day_availability (0009)
// ถ้าแก้ที่ใดที่หนึ่งต้องแก้อีกที่ให้ตรงกัน ไม่งั้นปฏิทินจะโชว์วันที่
// ที่ backend ไม่ยอมตอบความว่างให้
export const BOOKING_WINDOW_DAYS = 62;

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

// ขอเกินมา 1 แถวเพื่อรู้ว่ายังมีต่อไหม จะได้ไม่ต้องยิง count แยกอีกรอบ
// (เดิมดึงประวัติทั้งหมดทุกครั้งที่เปิดหน้า Profile ซึ่งโตตามอายุบัญชี
//  ไม่มีเพดาน — คนจองสัปดาห์ละครั้งครบปีก็ 50+ แถวรวดเดียว)
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
// ส่งไปแค่ id ของช่วงเวลาที่แอดมินเปิดไว้ ไม่ส่งสนาม/วัน/เวลา/ยอดเงิน —
// RPC อ่านทั้งหมดจากแถวใน facility_time_slots เอง ค่าที่ผู้ใช้กำหนดเองได้
// จึงเหลือแค่ note อย่างเดียว ปิดทางจองสนามแพงในราคาถูกหรือยืดเวลาเอง
export async function createBooking({ slotId, note }) {
  const { data, error } = await supabase.rpc("create_booking", {
    p_slot_id: slotId,
    p_note: note ?? null,
  });

  if (error) throw error;

  // PostgREST คืนฟังก์ชันที่ returns public.bookings เป็น object เดี่ยว
  // แต่ถ้าวันหนึ่ง signature เปลี่ยนเป็น setof ขึ้นมา หน้าที่เรียกจะพังทันที
  // เพราะอ่าน .id ไม่เจอ — คลี่ให้เหลือแถวเดียวไว้ตรงนี้ที่เดียว
  return Array.isArray(data) ? data[0] : data;
}

// เท่ากับ p_minutes ที่ create_booking / cron ส่งให้ expire_unpaid_bookings (0012)
// ถ้าแก้ที่ใดที่หนึ่งต้องแก้อีกที่ให้ตรงกัน ไม่งั้นหน้าจอจะสัญญาเวลาที่ไม่จริง
export const BOOKING_HOLD_MINUTES = 30;

// ใช้ตัดสินว่าจะโชว์ปุ่ม "ยกเลิกการจอง" ไหม — เป็นแค่เรื่องหน้าจอ
// ตัวตัดสินจริงคือ cancel_booking() ที่เทียบกับเวลาไทยฝั่ง server
export function hasStarted(booking) {
  return new Date(`${booking.booking_date}T${toHhMm(booking.start_time)}`) <= new Date();
}

export const canCancel = (booking) =>
  ["pending", "confirmed"].includes(booking.status) && !hasStarted(booking);

// ยกเลิกการจอง — ต้องผ่าน RPC เพราะ trigger ห้ามเจ้าของแถวแก้ status เอง
export async function cancelBooking(bookingId) {
  const { data, error } = await supabase.rpc("cancel_booking", {
    p_booking_id: bookingId,
  });

  if (error) throw error;

  return Array.isArray(data) ? data[0] : data;
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
