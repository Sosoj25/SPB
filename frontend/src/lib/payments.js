// การชำระเงินของการจอง — ทั้งฝั่งลูกค้าจ่ายและฝั่งแอดมินตรวจสอบ
//
// มีทางจ่ายอยู่ 3 ทาง แยกเป็นหัวข้อข้างล่าง: พร้อมเพย์ QR (ยืนยันอัตโนมัติ),
// โอนเข้าบัญชี+แนบสลิป (แอดมินตรวจ) และยอดสุทธิ 0 บาท
import { supabase } from "./supabase";
import { assertImageFile, imageExt } from "./uploads";

// ตัวเลือกที่ลูกค้าเลือกเองได้มีสองแบบเท่านั้น — ทุกตัวเลือกในนี้ต้องมีของ
// รองรับจริง ห้ามเพิ่มช่องทางที่กดแล้วไม่มีอะไรเกิดขึ้น
export const PAYMENT_METHODS = [
  {
    key: "qr",
    title: "พร้อมเพย์ (QR Code)",
    desc: "สแกนจ่ายผ่านแอปธนาคาร ยืนยันอัตโนมัติทันทีที่จ่ายสำเร็จ",
  },
  {
    key: "bank_transfer",
    title: "โอนผ่านบัญชีธนาคาร",
    desc: "โอนแล้วแนบสลิป เจ้าหน้าที่ตรวจสอบและยืนยันให้ภายใน 24 ชั่วโมง",
  },
];

const METHOD_LABELS = {
  qr: "พร้อมเพย์ (QR Code)",
  bank_transfer: "โอนผ่านบัญชีธนาคาร",
  // เงินสด/บัตร รับที่เคาน์เตอร์เท่านั้น (หน้า Walk-in, enum เพิ่มใน 0063) —
  // ลูกค้าเลือกเองไม่ได้จึงไม่อยู่ใน PAYMENT_METHODS แต่ต้องมีชื่อไทยไว้
  // เพราะใบเสร็จที่พิมพ์ตอนเช็คอินโชว์ช่องทางที่จ่ายจริง
  cash: "เงินสด (เคาน์เตอร์)",
  card: "บัตรเครดิต/เดบิต (เคาน์เตอร์)",
  other: "ช่องทางอื่น",
};

export const describeMethod = (method) => METHOD_LABELS[method] ?? "—";

export const describeGateway = (gateway) =>
  gateway === "plernpay" ? "ยืนยันอัตโนมัติ" : "ตรวจสอบโดยแอดมิน";

// ---------- ทางจ่าย: พร้อมเพย์ QR ผ่าน PlernPay ----------
//
// สร้าง QR จริงผ่าน Edge Function create-plernpay-charge (ต้องใช้
// X-Client-Secret ของ PlernPay ซึ่งอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น) แล้วให้หน้าเว็บ
// poll checkPlernpayPayment เป็นระยะจนกว่าจะจ่ายสำเร็จจริง — ดูรายละเอียดใน
// ตัว Edge Function ทั้งสอง (PlernPay ไม่มี webhook ยิงหาเราเอง มีแต่ endpoint
// ให้ถามสถานะ)
async function invokeEdgeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    // supabase-js ไม่ดึง error.message จาก body ของ Edge Function ให้อัตโนมัติ
    // ต้องอ่านเองจาก context ถึงจะได้ข้อความไทยที่ฟังก์ชันตั้งใจส่งกลับมา
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }

  return data;
}

export const createPlernpayCharge = (bookingId) =>
  invokeEdgeFunction("create-plernpay-charge", { bookingId });

// เรียกทุกครั้งที่ poll — ฝั่งเซิร์ฟเวอร์เป็นคนไปถาม PlernPay จริงและอัปเดต
// สถานะให้ (ดูคอมเมนต์ใน check-plernpay-payment) ที่นี่แค่ส่งต่อผลลัพธ์
export const checkPlernpayPayment = (paymentId) =>
  invokeEdgeFunction("check-plernpay-payment", { paymentId });

// ---------- ทางจ่าย: ยอดสุทธิ 0 บาท ----------
//
// เกิดได้จากโปรโมชั่นของสนามที่ลดจนหมด หรือคูปองที่มูลค่าคลุมค่าสนามพอดี
// (ดู 0054) — ไม่ใช่การ "ข้ามขั้นตอนชำระเงิน" แต่ยังออกแถว payments ยังยืนยัน
// การจอง และยังตัดคูปองให้ครบเหมือนอีกสองทาง
export async function confirmZeroAmountBooking(bookingId) {
  const { data, error } = await supabase.rpc("confirm_zero_amount_booking", {
    p_booking_id: bookingId,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// ---------- ทางจ่าย: โอนผ่านบัญชีธนาคาร + แนบสลิป ----------

// path แบบเดียวกับ avatars: <user_id>/<booking_id>/<timestamp>.<ext> — โฟลเดอร์
// แรกต้องเป็นเจ้าของเสมอ เพราะ RLS ของ bucket payment-slips (0023) เช็คจากตรงนั้น
export async function uploadPaymentSlip(file, userId, bookingId) {
  assertImageFile(file);

  const path = `${userId}/${bookingId}/${Date.now()}.${imageExt(file)}`;

  const { error } = await supabase.storage.from("payment-slips").upload(path, file);
  if (error) throw error;

  return path;
}

// bucket เป็น private ตั้งใจ (สลิปมีเลขบัญชี/ชื่อบัญชีติดมา) — ต้องขอ signed
// URL ทุกครั้งที่จะดูจริง ๆ แทนการเก็บ public URL ไว้ตรง ๆ
export async function fetchSlipSignedUrl(path) {
  const { data, error } = await supabase.storage
    .from("payment-slips")
    .createSignedUrl(path, 300);

  if (error) throw error;

  return data.signedUrl;
}

export async function submitBankTransferPayment(bookingId, slipPath) {
  const { data, error } = await supabase.rpc("submit_bank_transfer_payment", {
    p_booking_id: bookingId,
    p_slip_path: slipPath,
  });

  if (error) throw error;

  return data;
}

// ให้แอดมินเทียบชื่อบัญชีที่ลูกค้ากรอกตอนขอคืนเงิน (AdminRefunds.jsx) กับสลิป
// การชำระเงินเดิม — เอาแถวที่จ่ายสำเร็จ (status='approved') ล่าสุดของการจองนี้
//
// ห้ามกรองด้วย "ต้องมี slip_url" เพราะการจ่ายผ่าน QR (gateway='plernpay')
// ไม่เคยมีสลิป จะกลายเป็น "ไม่พบสลิป" ทั้งที่จ่ายเงินจริงแล้ว — จึงคืน
// gateway/ช่องทางมาด้วย ให้แอดมินรู้ว่าเป็นการจ่ายแบบไหน
export async function fetchLatestPaymentInfo(bookingId) {
  const { data, error } = await supabase
    .from("payments")
    .select("payment_method, gateway, slip_url, amount, verified_at")
    .eq("booking_id", bookingId)
    .eq("status", "approved")
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function fetchBookingPayment(bookingId) {
  const { data, error } = await supabase
    .from("payments")
    .select("id, amount, payment_method, status, created_at, verified_at")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data;
}

// ---------- ฝั่งแอดมิน: ตรวจสอบและอนุมัติการชำระเงิน ----------
//
// payments_select_own (RLS) มี "or is_admin()" อยู่แล้ว แอดมินจึงอ่านทุกแถว
// ได้ตรง ๆ ไม่ต้องผ่าน RPC — ส่วนการ "เปลี่ยนสถานะ" ต้องผ่าน RPC เพราะ
// payments กับ bookings ต้องขยับพร้อมกัน (ดู admin_approve_payment ใน 0021)

const ADMIN_PAYMENT_SELECT = `
  id,
  amount,
  payment_method,
  gateway,
  gateway_charge_id,
  status,
  slip_url,
  rejection_reason,
  created_at,
  verified_at,
  profiles!payments_user_id_fkey ( username, full_name ),
  bookings (
    booking_code,
    booking_date,
    start_time,
    end_time,
    facilities (
      name,
      venues ( name )
    )
  )
`;

export const ADMIN_PAYMENT_PAGE_SIZE = 20;

// "รอตรวจสอบ" ในหน้าจอ = ยังไม่มีแอดมินคนไหนกดอนุมัติหรือปฏิเสธ — ส่วนใหญ่จะ
// เป็นแถวโอนเงิน+สลิป (gateway='manual') ที่ต้องรอแอดมินจริง ๆ ส่วนแถว
// พร้อมเพย์ (gateway='plernpay') ปกติจะขยับเป็น approved/rejected เองตอนที่
// หน้าเว็บ poll check-plernpay-payment ก่อนที่แอดมินจะทันเห็นด้วยซ้ำ ค้าง
// pending นานแปลว่าลูกค้าเปิดหน้าค้างไว้แล้วไม่จ่าย/ปิดแท็บไปกลางคัน
// แอดมินก็ยังกดอนุมัติเองมือได้เผื่อกรณีนี้
export const PAYMENT_REVIEW_STATUSES = ["pending", "paid"];

export const PAYMENT_STATUS_LABELS = {
  pending: { label: "รอตรวจสอบ", tone: "warning" },
  paid: { label: "รอตรวจสอบ", tone: "warning" },
  approved: { label: "ชำระแล้ว", tone: "success" },
  rejected: { label: "ปฏิเสธ", tone: "danger" },
  unpaid: { label: "ยังไม่ชำระ", tone: "muted" },
};

export const describePaymentStatus = (status) =>
  PAYMENT_STATUS_LABELS[status] ?? { label: status ?? "—", tone: "muted" };

const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const formatDateTime = (value) => (value ? dateTimeFormatter.format(new Date(value)) : "—");

// ขอเกินมา 1 แถวเพื่อรู้ว่ามีหน้าถัดไปไหม เหมือน fetchAdminBookings
export async function fetchAdminPayments({
  status,
  page = 1,
  limit = ADMIN_PAYMENT_PAGE_SIZE,
} = {}) {
  let query = supabase
    .from("payments")
    .select(ADMIN_PAYMENT_SELECT)
    .order("created_at", { ascending: false });

  if (status === "review") query = query.in("status", PAYMENT_REVIEW_STATUSES);
  else if (status) query = query.eq("status", status);

  const from = (page - 1) * limit;
  const { data, error } = await query.range(from, from + limit);

  if (error) throw error;

  const rows = data ?? [];
  return { payments: rows.slice(0, limit), hasMore: rows.length > limit };
}

export async function fetchAdminPaymentStats() {
  const { data, error } = await supabase.rpc("admin_payment_stats");

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    pendingCount: row?.pending_count ?? 0,
    pendingAmount: Number(row?.pending_amount ?? 0),
    approvedToday: row?.approved_today ?? 0,
    revenueMonth: Number(row?.revenue_month ?? 0),
    rejectedMonth: row?.rejected_month ?? 0,
  };
}

export async function approvePayment(paymentId) {
  const { data, error } = await supabase.rpc("admin_approve_payment", {
    p_payment_id: paymentId,
  });

  if (error) throw error;

  return Array.isArray(data) ? data[0] : data;
}

export async function rejectPayment(paymentId, reason) {
  const { data, error } = await supabase.rpc("admin_reject_payment", {
    p_payment_id: paymentId,
    p_reason: reason ?? null,
  });

  if (error) throw error;

  return Array.isArray(data) ? data[0] : data;
}
