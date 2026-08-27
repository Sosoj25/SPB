import { supabase } from "./supabase";

// ---------- บัญชีรับเงิน (โอนผ่านบัญชี + แนบสลิป) ----------
//
// แทนค่าคงที่ BANK_ACCOUNT ที่เคยฮาร์ดโค้ดไว้ (lib/bankAccount.js, ตัดออกไป
// พร้อม migration 0027) — ตอนนี้แอดมินแก้ผ่านหน้า /admin/payments/settings
// และหน้าชำระเงินอ่านบัญชีหลัก (is_primary) มาแสดงแทน

const ACCOUNT_SELECT = "id, bank_name, account_number, account_name, is_primary";

function toAccount(row) {
  return {
    id: row.id,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountName: row.account_name,
    isPrimary: row.is_primary,
  };
}

export async function fetchPaymentAccounts() {
  const { data, error } = await supabase
    .from("payment_accounts")
    .select(ACCOUNT_SELECT)
    .order("is_primary", { ascending: false })
    .order("created_at");

  if (error) throw error;
  return (data ?? []).map(toAccount);
}

// ใช้ที่หน้าชำระเงินจริง (BookingPayment.jsx) — ไม่มีบัญชีหลักตั้งไว้เลยก็
// เป็นไปได้ (ตารางถูกลบทุกแถว) จึงคืน null แทนการโยน error
export async function fetchPrimaryPaymentAccount() {
  const { data, error } = await supabase
    .from("payment_accounts")
    .select(ACCOUNT_SELECT)
    .eq("is_primary", true)
    .maybeSingle();

  if (error) throw error;
  return data ? toAccount(data) : null;
}

export async function createPaymentAccount({ bankName, accountNumber, accountName }) {
  const { data, error } = await supabase
    .from("payment_accounts")
    .insert({ bank_name: bankName, account_number: accountNumber, account_name: accountName })
    .select(ACCOUNT_SELECT)
    .single();

  if (error) throw error;
  return toAccount(data);
}

export async function updatePaymentAccount(id, { bankName, accountNumber, accountName }) {
  const { data, error } = await supabase
    .from("payment_accounts")
    .update({ bank_name: bankName, account_number: accountNumber, account_name: accountName })
    .eq("id", id)
    .select(ACCOUNT_SELECT)
    .single();

  if (error) throw error;
  return toAccount(data);
}

export async function deletePaymentAccount(id) {
  const { error } = await supabase.from("payment_accounts").delete().eq("id", id);
  if (error) throw error;
}

// ปลดบัญชีหลักเดิมก่อนตั้งบัญชีใหม่เสมอ — ดัชนี unique ฝั่งฐานข้อมูล
// (payment_accounts_one_primary, 0027) ไม่ยอมให้มีสองแถว is_primary=true
// พร้อมกัน ถ้าไม่ปลดก่อนจะชนกันเอง
export async function setPrimaryPaymentAccount(id) {
  const { error: unsetError } = await supabase
    .from("payment_accounts")
    .update({ is_primary: false })
    .eq("is_primary", true)
    .neq("id", id);
  if (unsetError) throw unsetError;

  const { data, error } = await supabase
    .from("payment_accounts")
    .update({ is_primary: true })
    .eq("id", id)
    .select(ACCOUNT_SELECT)
    .single();

  if (error) throw error;
  return toAccount(data);
}

// ---------- เปิด/ปิดช่องทางชำระเงิน ----------

export async function fetchPaymentChannelSettings() {
  const { data, error } = await supabase
    .from("payment_channel_settings")
    .select("method, enabled");

  if (error) throw error;

  // คืนเป็น map { qr: true, bank_transfer: false } ให้หน้าชำระเงินเช็คง่าย
  // ๆ ด้วย key เดียวกับ PAYMENT_METHODS ใน lib/payments.js
  const byMethod = {};
  for (const row of data ?? []) byMethod[row.method] = row.enabled;
  return byMethod;
}

export async function updatePaymentChannelSetting(method, enabled) {
  const { error } = await supabase
    .from("payment_channel_settings")
    .update({ enabled })
    .eq("method", method);

  if (error) throw error;
}
