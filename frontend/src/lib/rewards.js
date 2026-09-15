// ระบบแลกรางวัลด้วยแต้มสะสม (0047) — แคตตาล็อกของรางวัล การแลก การจัดส่ง
// และคิวจัดของฝั่งแอดมิน (ตาราง rewards / reward_redemptions /
// point_transactions)
//
// ทุกอย่างที่ขยับแต้มต้องผ่าน RPC เท่านั้น (redeem_reward / admin_*) เพราะ
// profiles.points ถูกล็อกไม่ให้แก้ผ่าน REST ตั้งแต่ 0002 — ฝั่งนี้จึงไม่มี
// .update({ points }) อยู่ที่ไหนเลย และห้ามเพิ่มเข้ามาด้วย
import { supabase } from "./supabase";
import { assertImageFile, imageExt, removeStorageFolder } from "./uploads";
import { escapeSearchTerm } from "./searchTerm";

export const REWARD_CATEGORIES = [
  { key: "discount", label: "ส่วนลดค่าสนาม" },
  { key: "merchandise", label: "ของรางวัล" },
  { key: "privilege", label: "สิทธิพิเศษ" },
];

export const categoryLabel = (key) =>
  REWARD_CATEGORIES.find((c) => c.key === key)?.label ?? "ของรางวัล";

const CATALOG_SELECT = `
  id,
  name,
  description,
  terms,
  points_required,
  category,
  image_url,
  is_active,
  stock,
  track_stock,
  monthly_quota,
  valid_days,
  requires_shipping,
  options,
  sort_order,
  redeemed_month,
  limit_type,
  remaining,
  benefit_type,
  benefit_value,
  per_user_limit
`;

function toReward(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    terms: row.terms ?? "",
    pointsRequired: row.points_required,
    category: row.category,
    categoryLabel: categoryLabel(row.category),
    imageUrl: row.image_url,
    isActive: row.is_active,
    stock: row.stock,
    trackStock: row.track_stock,
    monthlyQuota: row.monthly_quota,
    validDays: row.valid_days,
    requiresShipping: row.requires_shipping,
    options: row.options ?? [],
    sortOrder: row.sort_order,
    redeemedMonth: row.redeemed_month ?? 0,
    limitType: row.limit_type,
    // null = ไม่จำกัด (คนละความหมายกับ 0 = หมดแล้ว) จึงต้องไม่ ?? 0 ตรงนี้
    remaining: row.remaining,
    benefitType: row.benefit_type ?? "none",
    benefitValue: Number(row.benefit_value ?? 0),
    perUserLimit: row.per_user_limit,
  };
}

// คูปองใบนี้ให้อะไร — ใช้ทั้งบนการ์ดของรางวัล หน้ารายละเอียด และกล่องคูปอง
// ในหน้าชำระเงิน จึงเขียนไว้ที่เดียว
export const BENEFIT_TYPES = [
  { key: "none", label: "ไม่ลดราคา (แอดมินตัดให้ที่สนาม)" },
  { key: "discount_baht", label: "ลดเป็นจำนวนเงิน (บาท)" },
  { key: "free_hours", label: "ฟรีค่าสนามตามจำนวนชั่วโมง" },
  { key: "advance_booking", label: "ขยายวันจองล่วงหน้า (วัน)" },
];

export function describeBenefit(reward) {
  if (!reward) return "";

  if (reward.benefitType === "discount_baht") {
    return `ลด ${formatPoints(reward.benefitValue)} บาท`;
  }

  if (reward.benefitType === "free_hours") {
    return `ฟรีค่าสนาม ${reward.benefitValue} ชม.`;
  }

  // สิทธิ์แบบนี้มีผลกับบัญชีทันทีที่แลก ไม่ต้องเอาไปยื่นตอนจ่ายเงิน (0055)
  if (reward.benefitType === "advance_booking") {
    return `จองล่วงหน้าเพิ่มอีก ${reward.benefitValue} วัน`;
  }

  return "รับสิทธิ์ที่สนาม";
}

// ข้อความ "คงเหลือ" ที่หน้ารายละเอียดกับหน้าแอดมินใช้ร่วมกัน — ปั้นจาก
// limit_type ที่ view คำนวณมาให้แล้ว ไม่เดาเองจาก stock/monthly_quota ดิบ ๆ
export function describeLimit(reward) {
  if (reward.limitType === "quota") {
    return {
      label: `จำกัด ${reward.monthlyQuota} สิทธิ์ต่อเดือน`,
      short: `เหลือ ${reward.remaining} / ${reward.monthlyQuota}`,
      soldOut: reward.remaining <= 0,
    };
  }

  if (reward.limitType === "stock") {
    return {
      label: `เหลือ ${reward.remaining} ชิ้น`,
      short: `เหลือ ${reward.remaining} ชิ้น`,
      soldOut: reward.remaining <= 0,
    };
  }

  return { label: "ไม่จำกัดจำนวน", short: "ไม่จำกัด", soldOut: false };
}

// ---------- หน้าแลกรางวัล (ลูกค้า) ----------

// reward_catalog เป็น view แบบ security_invoker — rewards_public_read (0000)
// กรองให้เหลือเฉพาะรางวัลที่เปิดใช้งานอยู่แล้ว ฝั่งนี้จึงไม่ต้อง .eq("is_active")
// ซ้ำ (และถ้าเป็นแอดมินเปิดหน้านี้ จะเห็นของที่ปิดไว้ด้วย ซึ่งตั้งใจ)
export async function fetchRewardCatalog(category) {
  let query = supabase.from("reward_catalog").select(CATALOG_SELECT).order("sort_order").order("id");

  if (category) query = query.eq("category", category);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map(toReward);
}

export async function fetchRewardById(id) {
  const { data, error } = await supabase
    .from("reward_catalog")
    .select(CATALOG_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("ไม่พบของรางวัลนี้ หรือของรางวัลถูกปิดไปแล้ว");

  return toReward(data);
}

// เป้าหมายถัดไปของแถบความคืบหน้าบนการ์ดแต้ม — รางวัลที่ยังแลกไม่ได้และ
// ใช้แต้มน้อยที่สุด ถ้าแลกได้หมดแล้วก็ไม่ต้องมีเป้าหมาย
export function nextGoal(rewards, points) {
  return rewards
    .filter((r) => r.pointsRequired > points)
    .sort((a, b) => a.pointsRequired - b.pointsRequired)[0];
}

// แลกรางวัล — ตัดแต้ม ออกคูปอง ตัดสต๊อก ในทรานแซกชันเดียวฝั่งเซิร์ฟเวอร์
//
// ส่ง null (ไม่ใช่ "") ให้ทุกช่องที่ไม่ได้ใช้ เพราะ RPC เช็คด้วย btrim/nullif
// อยู่แล้ว แต่การส่ง null ตรง ๆ ทำให้อ่าน log ฝั่ง Supabase ง่ายกว่า
export async function redeemReward(rewardId, { option, deliveryMethod, recipientName, phone, address } = {}) {
  const { data, error } = await supabase.rpc("redeem_reward", {
    p_reward_id: rewardId,
    p_option: option || null,
    p_delivery_method: deliveryMethod || null,
    p_recipient_name: recipientName || null,
    p_phone: phone || null,
    p_address: address || null,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// ---------- ประวัติการแลกรางวัล (ลูกค้า) ----------

export const HISTORY_FILTERS = [
  { key: "", label: "ทั้งหมด" },
  { key: "unused", label: "ยังไม่ได้ใช้" },
  { key: "used", label: "ใช้แล้ว" },
  { key: "expired", label: "หมดอายุ" },
];

// ---------- สถานะการจัดส่ง ----------
//
// ลำดับต้องตรงกับ reward_fulfillment_step() ฝั่ง SQL (0055) เป๊ะ ๆ — ฝั่งนั้น
// ใช้ตัดสินว่ากดยืนยันรับของได้หรือยัง ส่วนฝั่งนี้ใช้วาดแถบความคืบหน้า ถ้าสอง
// ที่ไม่ตรงกันผู้ใช้จะเห็นแถบเดินไปถึงขั้นที่เซิร์ฟเวอร์ยังไม่ยอมรับ
//
// 'shipping' เป็นค่าเก่าก่อน 0055 ที่ย้ายข้อมูลไป 'in_transit' หมดแล้ว —
// เก็บป้ายไว้เผื่อแถวที่หลุดรอดมา ไม่ใส่ในแถบความคืบหน้า
const FULFILLMENT_LABELS = {
  pending: "รอดำเนินการ",
  preparing: "กำลังเตรียมสินค้า",
  shipped: "จัดส่งแล้ว",
  shipping: "อยู่ระหว่างขนส่ง",
  in_transit: "อยู่ระหว่างขนส่ง",
  delivered: "จัดส่งสำเร็จ",
  received: "ได้รับสินค้าแล้ว",
  pickup: "นัดรับที่สนาม",
};

export const fulfillmentLabel = (status) => FULFILLMENT_LABELS[status] ?? "—";

const FULFILLMENT_STEP = {
  pending: 0,
  preparing: 1,
  shipped: 2,
  shipping: 3,
  in_transit: 3,
  pickup: 4,
  delivered: 4,
  received: 5,
};

export const fulfillmentStep = (status) => FULFILLMENT_STEP[status] ?? 0;

// แถบความคืบหน้าที่ลูกค้าเห็น — ของที่นัดรับเองไม่ผ่านขนส่ง จึงมีเส้นทางของ
// ตัวเอง ไม่ใช่แถบเดียวกันแล้วข้ามขั้นกลางไปเฉย ๆ
export const SHIPPING_TIMELINE = [
  { key: "pending", label: "รอดำเนินการ" },
  { key: "preparing", label: "กำลังเตรียมสินค้า" },
  { key: "shipped", label: "จัดส่งแล้ว" },
  { key: "in_transit", label: "อยู่ระหว่างขนส่ง" },
  { key: "delivered", label: "จัดส่งสำเร็จ" },
  { key: "received", label: "ยืนยันได้รับแล้ว" },
];

export const PICKUP_TIMELINE = [
  { key: "pending", label: "รอดำเนินการ" },
  { key: "preparing", label: "กำลังเตรียมสินค้า" },
  { key: "pickup", label: "พร้อมให้รับที่สนาม" },
  { key: "received", label: "ยืนยันได้รับแล้ว" },
];

// สถานะที่แอดมินตั้งได้ — ไม่มี 'received' เพราะ 0055 ปฏิเสธไว้ที่ฝั่ง RPC
// (ต้องเป็นลูกค้ากดยืนยันเองเท่านั้น สถานะนั้นถึงจะมีความหมาย)
export const ADMIN_FULFILLMENT_STATUSES = [
  { key: "pending", label: "รอดำเนินการ" },
  { key: "preparing", label: "กำลังเตรียมสินค้า" },
  { key: "shipped", label: "จัดส่งแล้ว" },
  { key: "in_transit", label: "อยู่ระหว่างขนส่ง" },
  { key: "delivered", label: "จัดส่งสำเร็จ" },
  { key: "pickup", label: "นัดรับที่สนาม" },
];

export const FULFILLMENT_FILTERS = [
  { key: "", label: "ทั้งหมด" },
  { key: "pending", label: "รอดำเนินการ" },
  { key: "preparing", label: "กำลังเตรียม" },
  { key: "shipped", label: "จัดส่งแล้ว" },
  { key: "in_transit", label: "อยู่ระหว่างขนส่ง" },
  { key: "delivered", label: "จัดส่งสำเร็จ" },
  { key: "received", label: "ลูกค้ารับแล้ว" },
  { key: "pickup", label: "รับที่สนาม" },
];

// นัดรับที่สนามไม่ผ่านขนส่ง จึงเป็นเส้นทางคนละเส้นกับพัสดุ — ของที่ลูกค้า
// ยืนยันรับแล้วโดยไม่เคยมีเลขพัสดุหรือวันที่ส่งออก ก็คือของที่มารับเองเช่นกัน
//
// ใช้ร่วมกันระหว่างแถวในประวัติ (ตั้งชื่อปุ่ม) แผงสถานะ (เลือกไทม์ไลน์) และ
// บัตร QR — ทั้งสามที่ต้องตอบเหมือนกันเสมอ ไม่งั้นปุ่มจะเขียนว่า "จัดส่ง"
// แต่ข้างในโชว์ไทม์ไลน์รับที่สนาม
export const isPickupRedemption = (item) =>
  item.fulfillmentStatus === "pickup" ||
  (item.fulfillmentStatus === "received" && !item.shippedAt && !item.trackingNumber);

// ใบที่เลือกให้จัดส่งตามที่อยู่ — รหัส/QR ของใบนี้ใช้รับของที่เคาน์เตอร์ไม่ได้
// ไม่งั้นลูกค้าได้ของสองต่อ (รับหน้าเคาน์เตอร์แล้วพัสดุยังถูกส่งตามที่อยู่อีกใบ
// เพราะคิวจัดส่งของแอดมินไม่ได้ดู status ของคูปอง)
//
// เกณฑ์ตรงกับด่านใน admin_mark_redemption_used() (0084): ดูที่ "มีที่อยู่จัดส่ง
// บันทึกไว้" ไม่ใช่ requiresShipping ของตัวรางวัล เพราะลูกค้าที่โทรมาขอเปลี่ยน
// ใจมารับเอง แอดมินจะตั้ง fulfillment_status เป็น pickup ให้ แล้วใบนั้นต้อง
// กลับมาตัดที่เคาน์เตอร์ได้ตามปกติ
export const isShippedRedemption = (item) =>
  Boolean(item.address) && item.fulfillmentStatus !== "pickup";

// ขั้นตั้งแต่ "จัดส่งแล้ว" เป็นต้นไปต้องมีทั้งบริษัทขนส่งและเลขพัสดุ —
// admin_update_redemption_fulfillment() (0085) ปฏิเสธไว้ที่ฝั่งเซิร์ฟเวอร์
// ฝั่งหน้าเว็บใช้ตัวนี้ปิดปุ่มไว้ก่อน จะได้ไม่ต้องกดแล้วเจอ error
//
// รับค่าที่แอดมินกำลังพิมพ์อยู่มาด้วย (ยังไม่ได้บันทึกลงแถว) เพราะปุ่มต้อง
// ปลดล็อกทันทีที่กรอกครบ ไม่ใช่หลังรีเฟรชหน้า
export const needsTrackingInfo = (request, { carrier, tracking } = {}) =>
  Boolean(request.address) &&
  !(
    (carrier ?? request.carrier ?? "").trim() && (tracking ?? request.trackingNumber ?? "").trim()
  );

// ลูกค้ากดยืนยันได้เมื่อของถึงปลายทางแล้วเท่านั้น — step 4 คือ 'delivered'
// (ขนส่งส่งถึงแล้ว) กับ 'pickup' (พร้อมให้รับที่สนาม) เงื่อนไขเดียวกับที่
// confirm_redemption_received() เช็คไว้ (0086)
//
// เดิมปุ่มโผล่ตั้งแต่ขั้น "จัดส่งแล้ว" ซึ่งของยังอยู่กับขนส่ง ลูกค้ากดยืนยัน
// ตั้งแต่ยังไม่ได้ของ แล้วรายการก็ปิดไปทั้งที่ของยังไม่ถึงมือ
export const canConfirmReceipt = (item) =>
  Boolean(item.fulfillmentStatus) &&
  item.status !== "cancelled" &&
  item.fulfillmentStatus !== "received" &&
  fulfillmentStep(item.fulfillmentStatus) >= 4;

// สถานะที่ผู้ใช้เห็นไม่ได้เก็บเป็นคอลัมน์เดียว — "หมดอายุ" คือคูปองที่ยังไม่ถูก
// ใช้และเลยวันหมดอายุแล้ว ถ้าเก็บเป็นสถานะจริงจะต้องมี cron มาไล่เปลี่ยนทุกวัน
// และวินาทีที่คูปองหมดอายุจะขึ้นกับว่า cron รันเมื่อไหร่ ไม่ใช่เวลาจริง
export function redemptionState(row) {
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "completed") return "used";
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return "expired";
  return "unused";
}

const STATE_BADGES = {
  unused: { label: "ยังไม่ได้ใช้", tone: "success" },
  used: { label: "ใช้แล้ว", tone: "neutral" },
  expired: { label: "หมดอายุ", tone: "warning" },
  cancelled: { label: "ยกเลิกแล้ว", tone: "danger" },
};

export const describeRedemptionState = (state) =>
  STATE_BADGES[state] ?? { label: "—", tone: "muted" };

const REDEMPTION_SELECT = `
  id,
  reward_id,
  redemption_code,
  points_used,
  status,
  fulfillment_status,
  option_label,
  recipient_name,
  shipping_phone,
  shipping_address,
  tracking_number,
  shipping_carrier,
  shipping_note,
  receipt_proof_path,
  shipped_at,
  delivered_at,
  received_at,
  cancel_reason,
  used_at,
  used_note,
  expires_at,
  created_at,
  rewards ( name, category, image_url )
`;

function toRedemption(row) {
  return {
    id: row.id,
    rewardId: row.reward_id,
    rewardName: row.rewards?.name ?? "ของรางวัล",
    rewardCategory: row.rewards?.category,
    rewardImage: row.rewards?.image_url,
    code: row.redemption_code,
    pointsUsed: row.points_used,
    status: row.status,
    fulfillmentStatus: row.fulfillment_status,
    optionLabel: row.option_label,
    recipientName: row.recipient_name,
    phone: row.shipping_phone,
    address: row.shipping_address,
    trackingNumber: row.tracking_number,
    carrier: row.shipping_carrier,
    shippingNote: row.shipping_note,
    receiptProofPath: row.receipt_proof_path,
    shippedAt: row.shipped_at,
    deliveredAt: row.delivered_at,
    receivedAt: row.received_at,
    cancelReason: row.cancel_reason,
    usedAt: row.used_at,
    usedNote: row.used_note,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

// กรองสถานะฝั่งหน้าเว็บ ไม่ใช่ในคิวรี เพราะ "หมดอายุ" ไม่ใช่ค่าที่เก็บใน
// ฐานข้อมูล (ดู redemptionState) — จำนวนคูปองของคนคนหนึ่งไม่ได้เยอะจนต้อง
// ทำเป็น server-side filter
export const HISTORY_PAGE_SIZE = 20;

// ขอเกินมา 1 แถวเพื่อรู้ว่ามีหน้าถัดไปไหมโดยไม่ต้องยิง count แยก — คนที่ใช้
// ระบบมาหลายปีจะมีคูปองสะสมเป็นร้อยใบ ดึงมาทั้งหมดทุกครั้งที่เปิดหน้าไม่ไหว
export async function fetchMyRedemptions(userId, page = 1, limit = HISTORY_PAGE_SIZE) {
  const from = (page - 1) * limit;

  const { data, error } = await supabase
    .from("reward_redemptions")
    .select(REDEMPTION_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, from + limit);

  if (error) throw error;

  const rows = (data ?? []).map(toRedemption);
  return { redemptions: rows.slice(0, limit), hasMore: rows.length > limit };
}

// ไทม์ไลน์การจัดส่งของคูปองใบเดียว — RLS ของ reward_shipment_events (0055)
// ปล่อยเฉพาะเจ้าของกับแอดมิน ฝั่งนี้จึงถามตรง ๆ ได้โดยไม่ต้องกรอง user เอง
export async function fetchShipmentEvents(redemptionId) {
  const { data, error } = await supabase
    .from("reward_shipment_events")
    .select("id, status, note, tracking_number, carrier, created_at")
    .eq("redemption_id", redemptionId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    label: fulfillmentLabel(row.status),
    note: row.note ?? "",
    trackingNumber: row.tracking_number ?? "",
    carrier: row.carrier ?? "",
    createdAt: row.created_at,
  }));
}

// ลูกค้ายืนยันว่าได้รับของรางวัลแล้ว — ปิดคูปองเป็น "ใช้แล้ว" ในตัว จึงต้อง
// ผ่าน RPC ไม่ใช่ update ตรง (reward_redemptions ไม่มี policy update ให้ลูกค้า)
// รูปของที่ได้รับ — บัคเก็ตส่วนตัว (ในรูปมีหน้าบ้าน/กล่องพัสดุที่มีชื่อกับ
// ที่อยู่ผู้รับติดมาด้วย) โฟลเดอร์แรกของ path ต้องเป็น id ของใบที่อ้างถึง ทั้ง
// policy ของบัคเก็ตและ confirm_redemption_received() (0085) ตรวจตรงนี้ตรงกัน
export async function uploadRedemptionReceipt(file, redemptionId) {
  assertImageFile(file);

  const path = `${redemptionId}/${Date.now()}.${imageExt(file)}`;

  const { error } = await supabase.storage.from("reward-receipts").upload(path, file);
  if (error) throw error;

  return path;
}

export async function fetchRedemptionReceiptSignedUrl(path) {
  const { data, error } = await supabase.storage
    .from("reward-receipts")
    .createSignedUrl(path, 300);

  if (error) throw error;
  return data.signedUrl;
}

// จำนวนของรางวัลที่ถึงปลายทางแล้วแต่ลูกค้ายังไม่ได้กดยืนยัน — ใช้เป็นป้าย
// เตือนค้างบนเมนู "แลกรางวัล" เพราะรายการพวกนี้ค้างอยู่ในคิวของแอดมินจนกว่า
// ลูกค้าจะกดยืนยัน และแจ้งเตือนใบเดียวตอนเปลี่ยนสถานะเลื่อนหายไปในไม่กี่วัน
//
// เงื่อนไขตรงกับ canConfirmReceipt(): สถานะ delivered/pickup คือ step 4 ซึ่ง
// confirm_redemption_received() (0086) ยอมให้กดยืนยันได้
export async function fetchPendingReceiptCount(userId) {
  const { count, error } = await supabase
    .from("reward_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("status", "cancelled")
    .in("fulfillment_status", ["delivered", "pickup"]);

  if (error) throw error;
  return count ?? 0;
}

export async function confirmRedemptionReceived(id, { note, proofPath } = {}) {
  const { data, error } = await supabase.rpc("confirm_redemption_received", {
    p_id: id,
    p_note: note || null,
    p_proof_path: proofPath || null,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// ---------- ใช้คูปองกับการจอง ----------

// คูปองที่ยังใช้ได้จริงของผู้ใช้คนนี้ — view usable_coupons (0049) กรอง
// "ถูกใช้ไปแล้ว / หมดอายุ / ถูกยกเลิก / ถูกจองไว้กับการจองใบอื่น" ออกให้แล้ว
// ฝั่งนี้จึงเอามาแสดงได้ตรง ๆ ไม่ต้องกรองซ้ำ
export async function fetchUsableCoupons() {
  const { data, error } = await supabase
    .from("usable_coupons")
    .select("id, redemption_code, expires_at, reward_name, benefit_type, benefit_value")
    .order("expires_at", { ascending: true, nullsFirst: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.redemption_code,
    expiresAt: row.expires_at,
    rewardName: row.reward_name,
    benefitType: row.benefit_type,
    benefitValue: Number(row.benefit_value ?? 0),
  }));
}

// ส่วนลดจริงคำนวณฝั่งเซิร์ฟเวอร์ทั้งหมด (ราคาต่อชั่วโมงของการจองใบนั้น) —
// ฝั่งนี้แค่ส่งรหัสไป แล้วรับ booking แถวใหม่ที่ยอดถูกหักแล้วกลับมา
export async function applyBookingCoupon(bookingId, code) {
  const { data, error } = await supabase.rpc("apply_booking_coupon", {
    p_booking_id: bookingId,
    p_code: code,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function removeBookingCoupon(bookingId) {
  const { data, error } = await supabase.rpc("remove_booking_coupon", {
    p_booking_id: bookingId,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// ตัดคูปองหน้างาน (แอดมิน) — สำหรับคูปองที่ลดราคาเองไม่ได้ เช่นสิทธิพิเศษ
// หรือของที่ลูกค้ามารับที่สนาม
export async function markCouponUsed(code, note) {
  const { data, error } = await supabase.rpc("admin_mark_redemption_used", {
    p_code: code,
    p_note: note || null,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// ---------- ตั้งค่าระบบแต้ม ----------

export async function fetchRewardSettings() {
  const { data, error } = await supabase
    .from("reward_settings")
    .select(
      "baht_per_point, earning_enabled, review_points, review_points_enabled, advance_booking_days, updated_at",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error) throw error;

  return {
    bahtPerPoint: data?.baht_per_point ?? 10,
    earningEnabled: data?.earning_enabled ?? true,
    // แต้มโบนัสต่อหนึ่งรีวิว จ่ายตอน submit_review() (0106) — คนละก้อนกับแต้ม
    // ตามยอดที่จ่ายจริง และปิด/เปิดแยกกันได้
    reviewPoints: data?.review_points ?? 20,
    reviewPointsEnabled: data?.review_points_enabled ?? true,
    // ฐานของ "จองล่วงหน้าได้กี่วัน" ที่ทุกคนได้เท่ากัน — สิทธิ์ที่แลกจากหน้า
    // รางวัลจะบวกเพิ่มจากค่านี้ (0055)
    advanceBookingDays: data?.advance_booking_days ?? 30,
    updatedAt: data?.updated_at,
  };
}

export async function updateRewardSettings(
  { bahtPerPoint, earningEnabled, reviewPoints, reviewPointsEnabled, advanceBookingDays },
  adminId,
) {
  const rate = Number(bahtPerPoint);

  if (!(rate >= 1 && rate <= 100000)) {
    throw new Error("อัตราแต้มต้องอยู่ระหว่าง 1 ถึง 100,000 บาทต่อ 1 แต้ม");
  }

  // 0 ได้ (เปิดระบบไว้แต่ยังไม่แจกแต้มรีวิว) ต่างจากอัตราข้างบนที่เป็นตัวหาร
  // จึงต่ำสุด 1 — เพดานเท่ากันกับ constraint ใน 0106
  const bonus = Number(reviewPoints);

  if (!Number.isFinite(bonus) || bonus < 0 || bonus > 100000) {
    throw new Error("แต้มจากการรีวิวต้องอยู่ระหว่าง 0 ถึง 100,000 แต้ม");
  }

  const days = Number(advanceBookingDays);

  if (!(days >= 1 && days <= 365)) {
    throw new Error("ระยะเวลาจองล่วงหน้าต้องอยู่ระหว่าง 1 ถึง 365 วัน");
  }

  const { error } = await supabase
    .from("reward_settings")
    .update({
      baht_per_point: Math.floor(rate),
      earning_enabled: earningEnabled,
      review_points: Math.floor(bonus),
      review_points_enabled: reviewPointsEnabled,
      advance_booking_days: Math.floor(days),
      updated_by: adminId ?? null,
    })
    .eq("id", 1);

  if (error) throw error;
}

// ---------- หน้าจัดการรางวัล (แอดมิน) ----------

export async function fetchAdminRewardStats() {
  const { data, error } = await supabase.rpc("admin_reward_stats");
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    totalRewards: row?.total_rewards ?? 0,
    redeemedMonth: row?.redeemed_month ?? 0,
    pointsMonth: row?.points_month ?? 0,
    lowStockCount: row?.low_stock_count ?? 0,
  };
}

// payload ใช้ชื่อฟิลด์แบบ camelCase เหมือนที่หน้าเว็บถือไว้ แล้วแปลงเป็นชื่อ
// คอลัมน์ตรงนี้ที่เดียว (pattern เดียวกับ fromNewsPayload ใน lib/news.js)
function fromRewardPayload(payload) {
  const row = {};

  if ("name" in payload) row.name = payload.name?.trim();
  if ("description" in payload) row.description = payload.description?.trim() || null;
  if ("terms" in payload) row.terms = payload.terms?.trim() || null;
  if ("pointsRequired" in payload) row.points_required = Number(payload.pointsRequired);
  if ("category" in payload) row.category = payload.category;
  if ("validDays" in payload) row.valid_days = Number(payload.validDays);
  if ("isActive" in payload) row.is_active = payload.isActive;
  if ("imageUrl" in payload) row.image_url = payload.imageUrl || null;
  if ("requiresShipping" in payload) row.requires_shipping = payload.requiresShipping;
  if ("options" in payload) row.options = payload.options ?? [];
  if ("sortOrder" in payload) row.sort_order = Number(payload.sortOrder);

  // ว่าง = ไม่จำกัดต่อคน (null) ไม่ใช่ 0 ซึ่ง constraint ฝั่ง DB ปฏิเสธอยู่แล้ว
  if ("perUserLimit" in payload) {
    row.per_user_limit = Number(payload.perUserLimit) > 0 ? Number(payload.perUserLimit) : null;
  }

  // benefit_value มีความหมายเฉพาะตอนที่คูปองลดราคาได้จริง — ถ้าเลือก "none"
  // ต้องล้างเป็น 0 ไม่งั้นเลขเก่าค้างอยู่แล้วสร้างความสับสนตอนกลับมาแก้ทีหลัง
  if ("benefitType" in payload) {
    row.benefit_type = payload.benefitType;
    row.benefit_value =
      payload.benefitType === "none" ? 0 : Number(payload.benefitValue) || 0;
  }

  // เพดานสองแบบที่ใช้ร่วมกันไม่ได้ — ตั้งอันไหนต้องล้างอีกอันเสมอ ไม่งั้น
  // reward_catalog จะเลือก quota มาก่อนแล้วสต๊อกที่แอดมินเพิ่งกรอกจะเงียบหาย
  if ("limitType" in payload) {
    if (payload.limitType === "quota") {
      row.monthly_quota = Number(payload.monthlyQuota) || null;
      row.track_stock = false;
    } else if (payload.limitType === "stock") {
      row.monthly_quota = null;
      row.track_stock = true;
      if ("stock" in payload) row.stock = Number(payload.stock) || 0;
    } else {
      row.monthly_quota = null;
      row.track_stock = false;
    }
  }

  return row;
}

export function validateReward(payload) {
  if (!payload.name?.trim()) throw new Error("กรุณากรอกชื่อของรางวัล");
  if (!(Number(payload.pointsRequired) > 0)) throw new Error("แต้มที่ใช้แลกต้องมากกว่า 0");

  const days = Number(payload.validDays);
  if (!(days >= 1 && days <= 3650)) {
    throw new Error("ระยะเวลาใช้งานคูปองต้องอยู่ระหว่าง 1 ถึง 3650 วัน");
  }

  if (payload.limitType === "quota" && !(Number(payload.monthlyQuota) > 0)) {
    throw new Error("โควตาต่อเดือนต้องมากกว่า 0");
  }

  // เช็ค "" แยกจาก 0 — Number("") เป็น 0 ซึ่งผ่านเงื่อนไข >= 0 ไปได้ ทำให้
  // รางวัลถูกสร้างมาแบบหมดสต๊อกตั้งแต่วินาทีแรกทั้งที่แอดมินแค่ลืมกรอก
  if (payload.limitType === "stock") {
    if (`${payload.stock ?? ""}`.trim() === "") {
      throw new Error("กรุณากรอกจำนวนสต๊อก");
    }
    if (Number(payload.stock) < 0) {
      throw new Error("จำนวนสต๊อกต้องไม่ติดลบ");
    }
  }

  if (payload.benefitType !== "none" && !(Number(payload.benefitValue) > 0)) {
    const messages = {
      free_hours: "จำนวนชั่วโมงที่ให้ฟรีต้องมากกว่า 0",
      advance_booking: "จำนวนวันที่ขยายการจองล่วงหน้าต้องมากกว่า 0",
    };

    throw new Error(messages[payload.benefitType] ?? "จำนวนเงินที่ลดต้องมากกว่า 0");
  }
}

export async function createReward(payload) {
  validateReward(payload);

  const { data, error } = await supabase
    .from("rewards")
    .insert(fromRewardPayload(payload))
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

export async function updateReward(id, payload) {
  validateReward(payload);

  const { error } = await supabase.from("rewards").update(fromRewardPayload(payload)).eq("id", id);
  if (error) throw error;
}

// เปิด/ปิดการแสดงผลแทนการลบ — reward_redemptions อ้าง reward_id แบบ
// on delete restrict อยู่แล้ว รางวัลที่มีคนแลกไปแล้วจึงลบไม่ได้ตั้งแต่ต้น
// และไม่ควรลบด้วย ประวัติของลูกค้าจะกลายเป็นคูปองไร้ชื่อ
export async function setRewardActive(id, isActive) {
  const { error } = await supabase.from("rewards").update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
}

export async function deleteReward(id) {
  const { error } = await supabase.from("rewards").delete().eq("id", id);

  if (error) {
    // 23503 = foreign key violation จาก reward_redemptions ที่อ้างอยู่
    if (error.code === "23503") {
      throw new Error("ของรางวัลนี้มีคนแลกไปแล้ว ลบไม่ได้ — ใช้ปิดใช้งานแทน");
    }
    throw error;
  }

  await removeStorageFolder("rewards", id);
}

// path ไม่ผูกกับ user เหมือน bucket news (0018/0047) — รูปของรางวัลเป็นของ
// ทีมแอดมินร่วมกัน ไม่มีเจ้าของรายคน
export async function uploadRewardImage(file, rewardId) {
  assertImageFile(file);

  const path = `${rewardId}/${Date.now()}.${imageExt(file)}`;

  const { error } = await supabase.storage.from("rewards").upload(path, file, { upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from("rewards").getPublicUrl(path);
  return data.publicUrl;
}

// ---------- หน้าคำขอแลกรางวัล (แอดมิน) ----------

export async function fetchAdminFulfillmentStats() {
  const { data, error } = await supabase.rpc("admin_reward_fulfillment_stats");
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    pendingCount: row?.pending_count ?? 0,
    preparingCount: row?.preparing_count ?? 0,
    shippedCount: row?.shipped_count ?? 0,
    transitCount: row?.transit_count ?? 0,
    deliveredCount: row?.delivered_count ?? 0,
    receivedCount: row?.received_count ?? 0,
    pickupCount: row?.pickup_count ?? 0,
    shippedMonth: row?.shipped_month ?? 0,
  };
}

export const ADMIN_REQUEST_PAGE_SIZE = 20;

const ADMIN_REQUEST_SELECT = `
  id,
  user_id,
  reward_id,
  redemption_code,
  points_used,
  status,
  fulfillment_status,
  option_label,
  recipient_name,
  shipping_phone,
  shipping_address,
  tracking_number,
  shipping_carrier,
  shipping_note,
  receipt_proof_path,
  shipped_at,
  delivered_at,
  received_at,
  cancel_reason,
  created_at,
  reward_name,
  reward_category,
  reward_image,
  username,
  full_name,
  avatar_url,
  phone
`;

function toRequest(row) {
  return {
    id: row.id,
    userId: row.user_id,
    rewardId: row.reward_id,
    code: row.redemption_code,
    pointsUsed: row.points_used,
    status: row.status,
    fulfillmentStatus: row.fulfillment_status,
    optionLabel: row.option_label,
    // ชื่อ/เบอร์ที่กรอกตอนแลกมาก่อนของในโปรไฟล์เสมอ — ลูกค้าอาจให้ส่งไปที่
    // ชื่อคนอื่น (ที่ทำงาน ญาติ) ซึ่งเป็นข้อมูลที่ถูกต้องกว่าสำหรับกล่องพัสดุ
    recipientName: row.recipient_name || row.full_name || row.username || "ผู้ใช้",
    customerName: row.full_name || row.username || "ผู้ใช้",
    phone: row.shipping_phone || row.phone || "",
    address: row.shipping_address ?? "",
    trackingNumber: row.tracking_number ?? "",
    carrier: row.shipping_carrier ?? "",
    shippingNote: row.shipping_note ?? "",
    receiptProofPath: row.receipt_proof_path ?? "",
    shippedAt: row.shipped_at,
    deliveredAt: row.delivered_at,
    receivedAt: row.received_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    rewardName: row.reward_name,
    rewardCategory: row.reward_category,
    rewardImage: row.reward_image,
    avatarUrl: row.avatar_url,
  };
}

// ขอเกินมา 1 แถวเพื่อรู้ว่ามีหน้าถัดไปไหมโดยไม่ต้องยิง count แยก
// (pattern เดียวกับ fetchAdminRefunds ใน lib/refunds.js)
export async function fetchAdminRewardRequests({
  status,
  page = 1,
  limit = ADMIN_REQUEST_PAGE_SIZE,
} = {}) {
  let query = supabase
    .from("admin_reward_requests")
    .select(ADMIN_REQUEST_SELECT)
    .order("created_at", { ascending: false });

  if (status) query = query.eq("fulfillment_status", status);

  const from = (page - 1) * limit;
  const { data, error } = await query.range(from, from + limit);

  if (error) throw error;

  const rows = data ?? [];
  return { requests: rows.slice(0, limit).map(toRequest), hasMore: rows.length > limit };
}

// ดึงคิวจัดส่ง "ทุกแถว" สำหรับปุ่มส่งออก CSV — ปุ่มชื่อ "ส่งออกรายการจัดส่ง"
// จึงต้องได้ทั้งรายการจริง ไม่ใช่เฉพาะ 20 แถวที่บังเอิญอยู่บนหน้าจอตอนนั้น
//
// จำกัดเพดานไว้กันเผลอลากทั้งตารางลงเบราว์เซอร์ ถ้าถึงเพดานจริงค่อยทำเป็น
// endpoint ฝั่งเซิร์ฟเวอร์
export async function fetchAllRewardRequests({ status, max = 2000 } = {}) {
  let query = supabase
    .from("admin_reward_requests")
    .select(ADMIN_REQUEST_SELECT)
    .order("created_at", { ascending: false })
    .limit(max);

  if (status) query = query.eq("fulfillment_status", status);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map(toRequest);
}

export async function updateFulfillment(id, status, { tracking, carrier, note } = {}) {
  const { data, error } = await supabase.rpc("admin_update_redemption_fulfillment", {
    p_id: id,
    p_status: status,
    p_tracking: tracking || null,
    p_carrier: carrier || null,
    p_note: note || null,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// ---------- ประวัติการแลกรางวัลทั้งหมด (แอดมิน) ----------
//
// ต่างจากคิวจัดส่งตรงที่รวมคูปองส่วนลดที่ไม่ต้องส่งของด้วย — หน้านี้ตอบคำถาม
// "ใครแลกอะไรไปบ้าง" ไม่ใช่ "เหลืออะไรต้องส่ง"

export const ADMIN_HISTORY_PAGE_SIZE = 25;

export const USAGE_STATE_FILTERS = [
  { key: "", label: "ทั้งหมด" },
  { key: "unused", label: "ยังไม่ได้ใช้" },
  { key: "used", label: "ใช้แล้ว" },
  { key: "expired", label: "หมดอายุ" },
  { key: "cancelled", label: "ยกเลิก" },
];

const HISTORY_SELECT = `
  id,
  user_id,
  reward_id,
  redemption_code,
  points_used,
  status,
  usage_state,
  fulfillment_status,
  option_label,
  recipient_name,
  shipping_phone,
  shipping_address,
  tracking_number,
  shipping_carrier,
  shipped_at,
  delivered_at,
  received_at,
  used_at,
  used_note,
  cancel_reason,
  expires_at,
  created_at,
  reward_name,
  reward_category,
  reward_image,
  benefit_type,
  requires_shipping,
  username,
  full_name,
  avatar_url,
  phone
`;

export async function fetchAdminRedemptionStats() {
  const { data, error } = await supabase.rpc("admin_redemption_stats");
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    totalCount: row?.total_count ?? 0,
    usedCount: row?.used_count ?? 0,
    unusedCount: row?.unused_count ?? 0,
    expiredCount: row?.expired_count ?? 0,
    cancelledCount: row?.cancelled_count ?? 0,
    shippingCount: row?.shipping_count ?? 0,
    awaitingReceipt: row?.awaiting_receipt ?? 0,
    pointsSpent: row?.points_spent ?? 0,
    memberCount: row?.member_count ?? 0,
  };
}

function toHistoryRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    customerName: row.full_name || row.username || "ผู้ใช้",
    username: row.username,
    avatarUrl: row.avatar_url,
    phone: row.shipping_phone || row.phone || "",
    code: row.redemption_code,
    pointsUsed: row.points_used,
    status: row.status,
    usageState: row.usage_state,
    fulfillmentStatus: row.fulfillment_status,
    optionLabel: row.option_label,
    recipientName: row.recipient_name,
    address: row.shipping_address ?? "",
    trackingNumber: row.tracking_number ?? "",
    carrier: row.shipping_carrier ?? "",
    shippedAt: row.shipped_at,
    deliveredAt: row.delivered_at,
    receivedAt: row.received_at,
    usedAt: row.used_at,
    usedNote: row.used_note,
    cancelReason: row.cancel_reason,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    rewardName: row.reward_name,
    rewardCategory: row.reward_category,
    rewardImage: row.reward_image,
    benefitType: row.benefit_type,
    requiresShipping: row.requires_shipping,
  };
}

// ค้นได้ทั้งชื่อลูกค้า ชื่อผู้ใช้ รหัสคูปอง และชื่อของรางวัล — แอดมินที่รับสาย
// ลูกค้ามักมีแค่อย่างใดอย่างหนึ่งในมือ ไม่ได้มีครบทุกอย่าง
export async function fetchAdminRedemptionHistory({
  state,
  category,
  query,
  page = 1,
  limit = ADMIN_HISTORY_PAGE_SIZE,
} = {}) {
  let q = supabase
    .from("admin_redemption_history")
    .select(HISTORY_SELECT, { count: "exact" })
    .order("created_at", { ascending: false });

  if (state) q = q.eq("usage_state", state);
  if (category) q = q.eq("reward_category", category);

  const term = query ? escapeSearchTerm(query) : "";
  if (term) {
    q = q.or(
      `full_name.ilike.%${term}%,username.ilike.%${term}%,redemption_code.ilike.%${term}%,reward_name.ilike.%${term}%`,
    );
  }

  const from = (page - 1) * limit;
  const { data, error, count } = await q.range(from, from + limit - 1);

  if (error) throw error;

  const total = count ?? 0;

  return {
    rows: (data ?? []).map(toHistoryRow),
    total,
    hasMore: from + limit < total,
  };
}

// รหัสเดียวกับที่ลูกค้ายื่น QR หรือบอกปากเปล่าที่เคาน์เตอร์ — ใช้ในหน้าสแกน
// รับของรางวัล (AdminRewardScan) เพื่อโชว์รายละเอียดให้แอดมินยืนยันก่อนตัด
// สิทธิ์จริง แทนที่จะพิมพ์รหัสตัดใช้ทันทีแบบ CouponRedeemBox
export async function fetchRedemptionByCode(code) {
  const trimmed = code?.trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from("admin_redemption_history")
    .select(HISTORY_SELECT)
    .eq("redemption_code", trimmed)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return toHistoryRow(data);
}

export async function cancelRedemption(id, reason) {
  const { data, error } = await supabase.rpc("admin_cancel_redemption", {
    p_id: id,
    p_reason: reason || null,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// ---------- ตัวจัดรูปแบบร่วม ----------

const pointsFormatter = new Intl.NumberFormat("th-TH");

export const formatPoints = (value) => pointsFormatter.format(Number(value ?? 0));

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export const formatRewardDate = (value) =>
  value ? dateFormatter.format(new Date(value)) : "—";

// CSV ของคิวจัดส่ง (ปุ่ม "ส่งออกรายการจัดส่ง" ในแบบ) — ทำฝั่ง client จาก
// แถวที่โหลดมาแล้ว ไม่ต้องมี endpoint ใหม่
//
// นำหน้าค่าที่ขึ้นต้นด้วย = + - @ ด้วย ' — ไม่งั้นที่อยู่ที่ลูกค้าพิมพ์เอง
// อาจถูก Excel ตีความเป็นสูตร (CSV injection)
const csvCell = (value) => {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function buildFulfillmentCsv(requests) {
  const header = [
    "รหัสคูปอง",
    "ลูกค้า",
    "ของรางวัล",
    "ตัวเลือก",
    "สถานะ",
    "ผู้รับ",
    "เบอร์โทร",
    "ที่อยู่",
    "ขนส่ง",
    "เลขพัสดุ",
    "วันที่แลก",
  ];

  const rows = requests.map((r) => [
    r.code,
    r.customerName,
    r.rewardName,
    r.optionLabel ?? "",
    fulfillmentLabel(r.fulfillmentStatus),
    r.recipientName,
    r.phone,
    r.address,
    r.carrier,
    r.trackingNumber,
    formatRewardDate(r.createdAt),
  ]);

  const body = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");

  // นำหน้าด้วย BOM (U+FEFF) ให้ Excel รู้ว่าไฟล์เป็น UTF-8 ไม่งั้นภาษาไทย
  // กลายเป็นตัวขยะทั้งไฟล์ — ประกอบจากรหัสอักขระแทนการวางตัวอักษรจริงลงใน
  // ซอร์ส เพราะ BOM มองไม่เห็นด้วยตา และหายไปเงียบ ๆ ได้ทุกครั้งที่ไฟล์นี้
  // ถูก copy-paste หรือผ่านเครื่องมือที่ normalize ข้อความ
  return `${String.fromCharCode(0xfeff)}${body}`;
}
