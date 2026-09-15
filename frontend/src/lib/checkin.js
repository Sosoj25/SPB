// เช็คอิน/เช็คเอาต์หน้าเคาน์เตอร์ — รายการจองของ "วันนี้" เท่านั้น
//
// ทุกการเปลี่ยนสถานะผ่าน RPC ฝั่ง server ไม่ใช่ update ตรง เพราะต้องกันเช็คอิน
// ซ้ำ/ข้ามขั้นตอน และเป็นจุดเดียวกับที่ตัดสินว่าใครมีสิทธิ์ทำ
import { supabase } from "./supabase";
import { toHhMm, todayISO } from "./bookings";

function firstRow(data) {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function mapEntry(row) {
  return {
    id: row.id,
    bookingCode: row.booking_code,
    startTime: row.start_time,
    endTime: row.end_time,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    sportName: row.sport_name,
    facilityName: row.facility_name,
    venueName: row.venue_name,
    paymentStatus: row.payment_status,
    status: row.status,
    checkedInAt: row.checked_in_at,
    checkedOutAt: row.checked_out_at,
    // ตัวเงินมีไว้ให้ใบเสร็จที่แอดมินพิมพ์ที่เคาน์เตอร์ (ดู lib/receiptPrint.js)
    // — หน้าเช็คอินเองไม่ได้ใช้ ยอดต้องเป็นชุดเดียวกับที่ลูกค้าเห็นในแอป
    // จึงอ่านมาจาก bookings ตรง ๆ ไม่คำนวณซ้ำฝั่งนี้ (0087)
    bookingDate: row.booking_date,
    totalAmount: row.total_amount,
    originalAmount: row.original_amount,
    discountAmount: row.discount_amount,
    depositAmount: row.deposit_amount,
    pricePerHour: row.price_per_hour,
    paymentMethod: row.payment_method,
    paidAt: row.paid_at,
  };
}

// admin_today_checkins (0038, สถานะเพิ่ม awaiting_review ใน 0074 และ no_show
// ใน 0076, ตัวเงินสำหรับพิมพ์ใบเสร็จใน 0087) คืนเฉพาะการจองวันนี้ที่ status เป็น
// confirmed/awaiting_review/no_show/completed อยู่แล้ว — pending (ยังไม่จ่าย
// เงิน) กับ cancelled/rejected ไม่ต้องกรองซ้ำฝั่งนี้
export async function fetchAdminCheckins() {
  const { data, error } = await supabase.rpc("admin_today_checkins");
  if (error) throw error;

  return (data ?? []).map(mapEntry);
}

// ใช้ booking_code ตรง ๆ — ทั้งจากเครื่องสแกน QR (keyboard-wedge พิมพ์ค่านี้
// ตามด้วย Enter) และจากช่องค้นหาด้วยมือ
export async function checkinBooking(bookingCode) {
  const { data, error } = await supabase.rpc("admin_checkin_booking", {
    p_booking_code: bookingCode,
  });

  if (error) throw error;
  return firstRow(data);
}

export async function checkoutBooking(bookingId) {
  const { data, error } = await supabase.rpc("admin_checkout_booking", {
    p_booking_id: bookingId,
  });

  if (error) throw error;
  return firstRow(data);
}

export async function resetCheckin(bookingId) {
  const { data, error } = await supabase.rpc("admin_reset_checkin", {
    p_booking_id: bookingId,
  });

  if (error) throw error;
  return firstRow(data);
}

// เกินเวลานัดกี่นาทีถึงนับว่า "เลยเวลา" — ใช้ตัดสินแค่สีบนหน้าจอ ไม่ใช่
// สิทธิ์อะไร จึงเทียบกับเวลาเครื่องผู้ใช้ตรง ๆ เหมือน hasStarted ใน
// lib/bookings.js ไม่ต้องพึ่ง server
export const LATE_THRESHOLD_MINUTES = 20;

export function isLate(entry, now = new Date()) {
  if (entry.checkedInAt) return false;

  // ปักเวลาเป็น +07:00 ตรง ๆ — ถ้าปล่อยให้ Date parse โดยไม่ระบุ offset จะถูก
  // อ่านเป็นเวลาท้องถิ่นของเครื่องแอดมิน ถ้าเครื่องตั้งโซนเวลาไม่ตรงไทย
  // ป้าย "เลยเวลา" จะเพี้ยนทันทีทั้งที่ backend คิดเป็น Asia/Bangkok เสมอ
  const due = new Date(`${todayISO()}T${toHhMm(entry.startTime)}:00+07:00`);
  due.setMinutes(due.getMinutes() + LATE_THRESHOLD_MINUTES);
  return due <= now;
}

const STATUS_META = {
  checked_out: { label: "เช็คเอาต์แล้ว", tone: "muted" },
  checked_in: { label: "เช็คอินแล้ว", tone: "success" },
  late: { label: "เลยเวลา", tone: "danger" },
  waiting: { label: "รอเช็คอิน", tone: "warning" },
};

export function describeCheckin(entry, now = new Date()) {
  if (entry.checkedOutAt) return STATUS_META.checked_out;
  if (entry.checkedInAt) return STATUS_META.checked_in;
  if (isLate(entry, now)) return STATUS_META.late;
  return STATUS_META.waiting;
}

const timeFormatter = new Intl.DateTimeFormat("th-TH", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

export const formatCheckinTime = (value) => (value ? timeFormatter.format(new Date(value)) : "—");
