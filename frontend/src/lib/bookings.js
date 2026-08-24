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
const toHhMm = (time) => (time ?? "").slice(0, 5);

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
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
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

export async function fetchUserBookings(userId) {
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("user_id", userId)
    .order("booking_date", { ascending: false })
    .order("start_time", { ascending: false });

  if (error) throw error;

  return data ?? [];
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
