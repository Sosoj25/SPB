import { supabase } from "./supabase";

// นโยบายคืนเงิน (single-row settings, 0033) — แทนตัวเลข 24 ชม./12 ชม./50% ที่
// เคยฮาร์ดโค้ดไว้ใน AdminRefunds.jsx เฉย ๆ ตอนนี้ทั้งหน้าชำระเงินของลูกค้า
// (BookingPayment.jsx) และหน้าแก้ไขของแอดมิน (AdminRefunds.jsx) อ่าน/แก้แถว
// เดียวกันนี้จริง

const POLICY_SELECT =
  "full_refund_hours, partial_refund_hours, partial_refund_percent, updated_at";

function toPolicy(row) {
  return {
    fullRefundHours: row.full_refund_hours,
    partialRefundHours: row.partial_refund_hours,
    partialRefundPercent: row.partial_refund_percent,
    updatedAt: row.updated_at,
  };
}

export async function fetchRefundPolicy() {
  const { data, error } = await supabase
    .from("refund_policy_settings")
    .select(POLICY_SELECT)
    .eq("id", 1)
    .single();

  if (error) throw error;
  return toPolicy(data);
}

export async function updateRefundPolicy({
  fullRefundHours,
  partialRefundHours,
  partialRefundPercent,
}) {
  const { data, error } = await supabase
    .from("refund_policy_settings")
    .update({
      full_refund_hours: fullRefundHours,
      partial_refund_hours: partialRefundHours,
      partial_refund_percent: partialRefundPercent,
    })
    .eq("id", 1)
    .select(POLICY_SELECT)
    .single();

  if (error) throw error;
  return toPolicy(data);
}
