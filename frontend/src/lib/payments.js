import { supabase } from "./supabase";

// enum payment_method ใน DB มีแค่ 3 ค่า (bank_transfer / qr / other)
// แต่ดีไซน์แสดงช่องทางที่ผู้ใช้คุ้นเคย 4 แบบ — เก็บทั้งสองไว้คู่กัน
// ค่า key ใช้ในหน้าจอ ส่วน dbValue คือค่าที่ส่งเข้า pay_booking
export const PAYMENT_METHODS = [
  {
    key: "promptpay",
    dbValue: "qr",
    title: "พร้อมเพย์ (QR Code)",
    desc: "สแกนจ่ายผ่านแอปธนาคาร",
  },
  {
    key: "banking",
    dbValue: "bank_transfer",
    title: "โอนผ่านบัญชีธนาคาร",
    desc: "Online Banking หรือโอนแล้วแนบสลิป",
  },
  {
    key: "card",
    dbValue: "other",
    title: "บัตรเครดิต / เดบิต",
    desc: "Visa · Mastercard · JCB",
  },
  {
    key: "truemoney",
    dbValue: "other",
    title: "TrueMoney Wallet",
    desc: "จ่ายผ่านกระเป๋าเงินอิเล็กทรอนิกส์",
  },
];

const METHOD_LABELS = {
  qr: "พร้อมเพย์ (QR Code)",
  bank_transfer: "โอนผ่านบัญชีธนาคาร",
  other: "ช่องทางอื่น",
};

export const describeMethod = (method) => METHOD_LABELS[method] ?? "—";

// ชำระเงิน (ยังเป็นการจำลอง): unpaid -> paid แล้วยืนยันการจองให้ในคราวเดียว
//
// ต้องผ่าน RPC เพราะ trigger protect_booking_privileged_columns (0003)
// ห้ามเจ้าของแถวแก้ status / payment_status ของตัวเอง — ไม่งั้นกดยืนยัน
// ให้ตัวเองฟรีได้ทั้งที่ยังไม่จ่าย
//
// วันเปลี่ยนไปใช้ payment gateway จริง จุดที่ต้องแก้คือ pay_booking ใน DB
// ที่เดียว: ให้ webhook ของ gateway เป็นคนเรียก แทนที่จะเชื่อหน้าเว็บ
export async function payBooking(bookingId, methodKey) {
  const method = PAYMENT_METHODS.find((item) => item.key === methodKey);

  const { data, error } = await supabase.rpc("pay_booking", {
    p_booking_id: bookingId,
    p_method: method?.dbValue ?? "other",
  });

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
