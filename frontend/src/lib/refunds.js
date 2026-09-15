// ระบบคืนเงิน (0034) — ลูกค้ายกเลิกการจองที่จ่ายเงินแล้วขอคืนเงินได้
// แอดมินอนุมัติ/ปฏิเสธ แล้วแนบสลิปโอนคืนเพื่อปิดงาน
//
// ไฟล์นี้แบ่งเป็นสองส่วน: ฝั่งลูกค้า (ขอคืน/ดูสถานะของตัวเอง) กับฝั่งแอดมิน
// (คิวตรวจสอบ/อนุมัติ/ปิดงาน) แยกด้วยหัวข้อคั่นข้างล่าง
import { supabase } from "./supabase";
import { assertImageFile, imageExt } from "./uploads";

export const REFUND_STATUS_LABELS = {
  pending: { label: "รอตรวจสอบ", tone: "warning" },
  approved: { label: "อนุมัติแล้ว", tone: "success" },
  rejected: { label: "ปฏิเสธ", tone: "danger" },
  refunded: { label: "คืนเงินสำเร็จ", tone: "success" },
};

export const describeRefundStatus = (status) =>
  REFUND_STATUS_LABELS[status] ?? { label: status ?? "—", tone: "muted" };

const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const formatDateTime = (value) =>
  value ? dateTimeFormatter.format(new Date(value)) : "—";

// ใช้ตัวเลขเดียวกับที่ request_refund() คำนวณไว้ตอนขอ (ไม่คำนวณซ้ำฝั่ง client
// เพราะนโยบายอาจถูกแก้หลังจากขอไปแล้ว ค่าที่เก็บไว้ในแถวคือค่าจริงตอนนั้น)
export function describeLeadTime(rawHours, policy) {
  if (rawHours == null) return { label: "—", tone: "muted" };

  const hours = Number(rawHours);

  if (!policy) return { label: `${Math.round(hours)} ชม.`, tone: "muted" };

  if (hours >= policy.fullRefundHours) {
    return { label: `เกิน ${policy.fullRefundHours} ชม. (คืนเต็มจำนวน)`, tone: "success" };
  }
  if (hours >= policy.partialRefundHours) {
    return {
      label: `${Math.max(0, Math.round(hours))} ชม. (คืน ${policy.partialRefundPercent}%)`,
      tone: "warning",
    };
  }
  return { label: `${Math.max(0, Math.round(hours))} ชม. (ไม่คืนเงิน)`, tone: "danger" };
}

// ---------- ฝั่งลูกค้า ----------

// bankDetails: { bankName, accountName, accountNumber } — บังคับกรอกครบทั้ง
// สามช่อง (validate ซ้ำฝั่งเซิร์ฟเวอร์ใน request_refund ด้วย, 0035) เพราะ
// แอดมินต้องรู้ว่าจะโอนเงินคืนเข้าบัญชีไหน และต้องเทียบชื่อกับสลิปการชำระเงิน
// เดิมก่อนอนุมัติ กันเคสสวมรอยขอคืนเงินเข้าบัญชีคนอื่น
//
// paymentProofSlipPath: บังคับเฉพาะจ่ายผ่านพร้อมเพย์ QR (validate ซ้ำฝั่ง
// เซิร์ฟเวอร์ด้วย, 0038) เพราะ QR ไม่มีสลิปการชำระเงินเดิมให้แอดมินเทียบชื่อ
// บัญชีเลย ต้องให้ลูกค้าแนบสลิป/ประวัติการโอนจากแอปธนาคารของตัวเองแทน
export async function requestRefund(bookingId, reason, bankDetails, paymentProofSlipPath) {
  const { data, error } = await supabase.rpc("request_refund", {
    p_booking_id: bookingId,
    p_reason: reason || null,
    p_bank_name: bankDetails?.bankName || null,
    p_account_name: bankDetails?.accountName || null,
    p_account_number: bankDetails?.accountNumber || null,
    p_payment_proof_slip_path: paymentProofSlipPath || null,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// หลังโดนปฏิเสธแล้วขอใหม่ได้ (0036) หนึ่งการจองจึงมีได้มากกว่าหนึ่งแถว —
// เอาแถวล่าสุดเสมอ (.limit(1) ก่อน .maybeSingle() กันพังตอนมีมากกว่า 1 แถว)
export async function fetchMyRefundRequest(bookingId) {
  const { data, error } = await supabase
    .from("refund_requests")
    .select(
      "id, status, refund_amount, reason, rejection_reason, requested_at, refunded_at, slip_path, bank_name, account_name, account_number",
    )
    .eq("booking_id", bookingId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// bucket ส่วนตัว — ต้องขอ signed URL เอาตอนจะดูจริงเท่านั้น เหมือน payment-slips
export async function fetchRefundSlipSignedUrl(path) {
  const { data, error } = await supabase.storage
    .from("refund-slips")
    .createSignedUrl(path, 300);

  if (error) throw error;
  return data.signedUrl;
}

// สลิป/ประวัติการโอนที่ลูกค้าแนบเอง (บังคับเฉพาะจ่ายผ่าน QR, 0038) — คนละ
// บัคเก็ตกับ refund-slips เพราะคนละคนอัปโหลด (ลูกค้า vs แอดมิน)
export async function uploadRefundPaymentProof(file, bookingId) {
  assertImageFile(file);

  const path = `${bookingId}/${Date.now()}.${imageExt(file)}`;

  const { error } = await supabase.storage.from("refund-payment-proofs").upload(path, file);
  if (error) throw error;

  return path;
}

export async function fetchRefundPaymentProofSignedUrl(path) {
  const { data, error } = await supabase.storage
    .from("refund-payment-proofs")
    .createSignedUrl(path, 300);

  if (error) throw error;
  return data.signedUrl;
}

// ---------- ฝั่งแอดมิน ----------

const ADMIN_REFUND_SELECT = `
  id,
  booking_id,
  reason,
  refund_amount,
  lead_time_hours,
  status,
  rejection_reason,
  slip_path,
  payment_proof_slip_path,
  bank_name,
  account_name,
  account_number,
  requested_at,
  reviewed_at,
  refunded_at,
  profiles!refund_requests_user_id_fkey ( username, full_name ),
  bookings (
    booking_code,
    booking_date,
    start_time,
    end_time,
    total_amount,
    facilities (
      name,
      sports ( name ),
      venues ( name )
    )
  )
`;

export const ADMIN_REFUND_PAGE_SIZE = 20;

// ขอเกินมา 1 แถวเพื่อรู้ว่ามีหน้าถัดไปไหม เหมือน fetchAdminPayments
export async function fetchAdminRefunds({ status, page = 1, limit = ADMIN_REFUND_PAGE_SIZE } = {}) {
  let query = supabase
    .from("refund_requests")
    .select(ADMIN_REFUND_SELECT)
    .order("requested_at", { ascending: false });

  if (status) query = query.eq("status", status);

  const from = (page - 1) * limit;
  const { data, error } = await query.range(from, from + limit);

  if (error) throw error;

  const rows = data ?? [];
  return { refunds: rows.slice(0, limit), hasMore: rows.length > limit };
}

export async function fetchAdminRefundStats() {
  const { data, error } = await supabase.rpc("admin_refund_stats");

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    pendingCount: row?.pending_count ?? 0,
    approvedMonth: Number(row?.approved_month ?? 0),
    rejectedMonth: row?.rejected_month ?? 0,
    refundedMonth: Number(row?.refunded_month ?? 0),
  };
}

// overrideAmount: ใช้เฉพาะกรณีพิเศษ (เช่น สนามไม่พร้อมใช้งานจากฝ่ายสนาม) —
// ปกติไม่ต้องส่ง ปล่อยให้แอดมินอนุมัติตามยอดที่คำนวณตามนโยบายไว้แล้ว
export async function approveRefundRequest(id, overrideAmount) {
  const { data, error } = await supabase.rpc("admin_approve_refund_request", {
    p_id: id,
    p_override_amount: overrideAmount ?? null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function rejectRefundRequest(id, reason) {
  const { data, error } = await supabase.rpc("admin_reject_refund_request", {
    p_id: id,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// path ไม่มีโฟลเดอร์เจ้าของแบบ payment-slips เพราะผู้ที่อัปโหลดคือแอดมิน ไม่ใช่
// ลูกค้า — RLS ฝั่ง select ของบัคเก็ตนี้ (0034) join กลับไปที่ bookings.user_id
// แทนการเช็กโฟลเดอร์ตรง ๆ
export async function uploadRefundSlip(file, bookingId) {
  assertImageFile(file);

  const path = `${bookingId}/${Date.now()}.${imageExt(file)}`;

  const { error } = await supabase.storage.from("refund-slips").upload(path, file);
  if (error) throw error;

  return path;
}

export async function completeRefundRequest(id, slipPath) {
  const { data, error } = await supabase.rpc("admin_complete_refund_request", {
    p_id: id,
    p_slip_path: slipPath,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
