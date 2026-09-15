// นโยบายคืนเงิน — เกณฑ์ชั่วโมง/เปอร์เซ็นต์ที่ใช้ตัดสินว่ายกเลิกแล้วได้เงินคืนเท่าไร
//
// เก็บเป็น settings แถวเดียว (id = 1, ตาราง refund_policy_settings ใน 0033)
// หน้าชำระเงินของลูกค้าและหน้าแก้นโยบายของแอดมินอ่านแถวเดียวกันนี้ ห้ามฮาร์ดโค้ด
// ตัวเลขเกณฑ์ไว้ที่หน้าใดหน้าหนึ่ง ไม่งั้นที่โชว์กับที่คิดจริงจะไม่ตรงกัน
import { supabase } from "./supabase";

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
