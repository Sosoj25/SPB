// ระบบราคาของสนาม (0024) — ราคาพื้นฐาน + ราคาตามช่วงเวลา + ส่วนลดอัตโนมัติ
//
// รวมงานจัดการสถานที่/สนามของแอดมินไว้ด้วย เพราะทั้งหมดอยู่ในหน้าเดียวกัน
// (AdminFacilityPricing) ราคาจริงที่ลูกค้าจ่ายคำนวณที่ฝั่ง DB เสมอ
// (compute_facility_price) ที่นี่ไม่มีสูตรคิดเงินของตัวเอง
import { supabase } from "./supabase";
import { removeStorageFolder } from "./uploads";

const RULE_SELECT =
  "id, facility_id, label, start_time, end_time, weekday_price, weekend_price, holiday_price, is_peak, sort_order";

const DISCOUNT_SELECT =
  "id, facility_id, label, discount_type, value_percent, value_flat, threshold_days, threshold_hours, is_enabled, sort_order";

function toRule(row) {
  return {
    id: row.id,
    facilityId: row.facility_id,
    label: row.label,
    startTime: (row.start_time ?? "").slice(0, 5),
    endTime: (row.end_time ?? "").slice(0, 5),
    weekdayPrice: Number(row.weekday_price),
    weekendPrice: Number(row.weekend_price),
    holidayPrice: Number(row.holiday_price),
    isPeak: row.is_peak,
    sortOrder: row.sort_order,
  };
}

function toDiscount(row) {
  return {
    id: row.id,
    facilityId: row.facility_id,
    label: row.label,
    discountType: row.discount_type,
    valuePercent: row.value_percent == null ? null : Number(row.value_percent),
    valueFlat: row.value_flat == null ? null : Number(row.value_flat),
    thresholdDays: row.threshold_days,
    thresholdHours: row.threshold_hours == null ? null : Number(row.threshold_hours),
    isEnabled: row.is_enabled,
    sortOrder: row.sort_order,
  };
}

// สามก้อนนี้เป็นคนละตาราง ไม่ผูกกันด้วย foreign key เดียว (facility เอง +
// rules + discounts) ยิงพร้อมกันเร็วกว่ารอทีละก้อน
export async function fetchFacilityPricingConfig(facilityId) {
  const [facilityRes, rulesRes, discountsRes] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name, price_per_hour, min_booking_hours, deposit_percent, venue_id, venues ( id, name, address )")
      .eq("id", facilityId)
      .single(),
    supabase
      .from("facility_pricing_rules")
      .select(RULE_SELECT)
      .eq("facility_id", facilityId)
      .order("sort_order"),
    supabase
      .from("facility_discounts")
      .select(DISCOUNT_SELECT)
      .eq("facility_id", facilityId)
      .order("sort_order"),
  ]);

  if (facilityRes.error) throw facilityRes.error;
  if (rulesRes.error) throw rulesRes.error;
  if (discountsRes.error) throw discountsRes.error;

  return {
    basePrice: {
      facilityId: facilityRes.data.id,
      name: facilityRes.data.name,
      venueId: facilityRes.data.venues?.id ?? facilityRes.data.venue_id,
      venueName: facilityRes.data.venues?.name ?? "",
      venueAddress: facilityRes.data.venues?.address ?? "",
      pricePerHour: Number(facilityRes.data.price_per_hour),
      minBookingHours: facilityRes.data.min_booking_hours,
      depositPercent: Number(facilityRes.data.deposit_percent),
    },
    rules: (rulesRes.data ?? []).map(toRule),
    discounts: (discountsRes.data ?? []).map(toDiscount),
  };
}

export async function updateFacilityBasePrice(
  facilityId,
  { name, pricePerHour, minBookingHours, depositPercent },
) {
  const { error } = await supabase
    .from("facilities")
    .update({
      name,
      price_per_hour: pricePerHour,
      min_booking_hours: minBookingHours,
      deposit_percent: depositPercent,
    })
    .eq("id", facilityId);

  if (error) throw error;
}

// ---------- สถานที่และสนาม ----------

// venues เป็นคนละตารางกับ facilities — หนึ่งสถานที่มีได้หลายสนาม เปลี่ยน
// ชื่อ/ที่อยู่ตรงนี้จึงมีผลกับทุกสนามที่อยู่ในสถานที่เดียวกันด้วย
export async function updateVenueDetails(venueId, { name, address }) {
  const { error } = await supabase.from("venues").update({ name, address }).eq("id", venueId);
  if (error) throw error;
}

// รายชื่อสถานที่ที่เปิดใช้งาน ให้ฟอร์ม "เพิ่มสนามใหม่" เลือกว่าจะผูกสนามใหม่
// เข้ากับสถานที่ไหน (หนึ่งสถานที่มีได้หลายสนาม)
export async function fetchVenues() {
  const { data, error } = await supabase
    .from("venues")
    .select("id, name, address, opening_time, closing_time")
    .eq("status", "active")
    .order("name");

  if (error) throw error;

  return (data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    address: v.address,
    openingTime: (v.opening_time ?? "").slice(0, 5),
    closingTime: (v.closing_time ?? "").slice(0, 5),
  }));
}

// สร้างสถานที่ใหม่ — ใช้ตอนเพิ่มสนามในทำเลที่ยังไม่มีในระบบ
// venues_admin_manage (0000) ให้สิทธิ์ admin insert อยู่แล้ว
export async function createVenue({ name, address, phone, openingTime, closingTime }) {
  const { data, error } = await supabase
    .from("venues")
    .insert({
      name,
      address,
      phone: phone || null,
      opening_time: openingTime,
      closing_time: closingTime,
    })
    .select("id, name, address, opening_time, closing_time")
    .single();

  if (error) throw error;

  return {
    id: data.id,
    name: data.name,
    address: data.address,
    openingTime: (data.opening_time ?? "").slice(0, 5),
    closingTime: (data.closing_time ?? "").slice(0, 5),
  };
}

// สร้างสนามใหม่ในสถานที่ที่เลือก — facilities_admin_manage (0000) ให้สิทธิ์
// admin insert อยู่แล้ว สนามใหม่ยังจองไม่ได้จนกว่าจะมีช่วงเวลาใน
// facility_time_slots (เรียก ensureFutureSlots จากฝั่งเรียกหลัง insert สำเร็จ)
export async function createFacility({
  venueId,
  sportId,
  name,
  description,
  capacity,
  pricePerHour,
  minBookingHours,
  depositPercent,
}) {
  const { data, error } = await supabase
    .from("facilities")
    .insert({
      venue_id: venueId,
      sport_id: sportId,
      name,
      description: description || null,
      capacity: capacity ?? null,
      price_per_hour: pricePerHour,
      min_booking_hours: minBookingHours ?? 1,
      deposit_percent: depositPercent ?? 0,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error(`มีสนามชื่อ "${name}" อยู่แล้วในสถานที่นี้ กรุณาใช้ชื่ออื่น`);
    throw error;
  }
  return data.id;
}

// ลบสนามทิ้ง — รูปภาพ ราคาตามช่วงเวลา ส่วนลด ประวัติราคา และตารางเวลาของสนาม
// นี้ (facility_images, facility_pricing_rules, facility_discounts,
// facility_price_history, facility_time_slots) เป็น on delete cascade ทั้งหมด
// (0000, 0010, 0024) จึงหายตามไปด้วยอัตโนมัติ แต่ bookings.facility_id เป็น
// on delete restrict — ลบไม่ได้ถ้าสนามนี้เคยมีการจองอยู่แม้แต่รายการเดียว
// (กันประวัติการจอง/ใบเสร็จเก่าอ้างอิงสนามที่หายไปแล้ว) ควรเปลี่ยนสถานะเป็น
// "ปิดปรับปรุง" แทนถ้าเจอเคสนี้
export async function deleteFacility(facilityId) {
  const { error } = await supabase.from("facilities").delete().eq("id", facilityId);

  if (error) {
    if (error.code === "23503") {
      throw new Error(
        "ลบไม่ได้ เพราะสนามนี้มีประวัติการจองอยู่ — ให้เปลี่ยนสถานะเป็นปิดปรับปรุงแทนการลบ",
      );
    }
    throw error;
  }

  await removeStorageFolder("facility-images", facilityId);
}

// คัดลอกเฉพาะราคาพื้นฐาน (ไม่รวมช่วงเวลา/ส่วนลด) ไปยังทุกสนามอื่นในกีฬา
// เดียวกัน — ทำครั้งเดียวตอนกดปุ่ม ไม่ใช่การผูก sync ต่อเนื่อง
export async function applyBasePriceToSport(sportId, excludeFacilityId, basePricePayload) {
  const { data: facilities, error: fetchError } = await supabase
    .from("facilities")
    .select("id")
    .eq("sport_id", sportId)
    .neq("id", excludeFacilityId);

  if (fetchError) throw fetchError;
  if (!facilities || facilities.length === 0) return 0;

  const { error } = await supabase
    .from("facilities")
    .update({
      price_per_hour: basePricePayload.pricePerHour,
      min_booking_hours: basePricePayload.minBookingHours,
      deposit_percent: basePricePayload.depositPercent,
    })
    .in(
      "id",
      facilities.map((f) => f.id),
    );

  if (error) throw error;
  return facilities.length;
}

// ---------- ราคาตามช่วงเวลา ----------

export async function createPricingRule(facilityId, payload) {
  const { data, error } = await supabase
    .from("facility_pricing_rules")
    .insert({
      facility_id: facilityId,
      label: payload.label,
      start_time: payload.startTime,
      end_time: payload.endTime,
      weekday_price: payload.weekdayPrice,
      weekend_price: payload.weekendPrice,
      holiday_price: payload.holidayPrice,
      is_peak: payload.isPeak ?? false,
      sort_order: payload.sortOrder ?? 0,
    })
    .select(RULE_SELECT)
    .single();

  if (error) throw error;
  return toRule(data);
}

export async function updatePricingRule(ruleId, payload) {
  const row = {};
  if ("label" in payload) row.label = payload.label;
  if ("startTime" in payload) row.start_time = payload.startTime;
  if ("endTime" in payload) row.end_time = payload.endTime;
  if ("weekdayPrice" in payload) row.weekday_price = payload.weekdayPrice;
  if ("weekendPrice" in payload) row.weekend_price = payload.weekendPrice;
  if ("holidayPrice" in payload) row.holiday_price = payload.holidayPrice;
  if ("isPeak" in payload) row.is_peak = payload.isPeak;

  const { data, error } = await supabase
    .from("facility_pricing_rules")
    .update(row)
    .eq("id", ruleId)
    .select(RULE_SELECT)
    .single();

  if (error) throw error;
  return toRule(data);
}

export async function deletePricingRule(ruleId) {
  const { error } = await supabase.from("facility_pricing_rules").delete().eq("id", ruleId);
  if (error) throw error;
}

// ลาก-วางเปลี่ยนลำดับ เหมือน reorderRows ใน lib/amenities.js — อัปเดต
// เฉพาะแถวที่ index เปลี่ยนจริง
async function reorderRows(table, orderedRows) {
  const updates = orderedRows
    .map((row, index) => ({ id: row.id, sortOrder: index, changed: row.sortOrder !== index }))
    .filter((u) => u.changed);

  if (updates.length === 0) return;

  const results = await Promise.all(
    updates.map((u) => supabase.from(table).update({ sort_order: u.sortOrder }).eq("id", u.id)),
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

export function reorderPricingRules(orderedRules) {
  return reorderRows("facility_pricing_rules", orderedRules);
}

// ---------- ส่วนลดอัตโนมัติ ----------

export async function createDiscount(facilityId, payload) {
  const { data, error } = await supabase
    .from("facility_discounts")
    .insert({
      facility_id: facilityId,
      label: payload.label,
      discount_type: payload.discountType,
      value_percent: payload.valuePercent ?? null,
      value_flat: payload.valueFlat ?? null,
      threshold_days: payload.thresholdDays ?? null,
      threshold_hours: payload.thresholdHours ?? null,
      is_enabled: payload.isEnabled ?? true,
      sort_order: payload.sortOrder ?? 0,
    })
    .select(DISCOUNT_SELECT)
    .single();

  if (error) throw error;
  return toDiscount(data);
}

export async function updateDiscount(discountId, payload) {
  const row = {};
  if ("label" in payload) row.label = payload.label;
  if ("valuePercent" in payload) row.value_percent = payload.valuePercent;
  if ("valueFlat" in payload) row.value_flat = payload.valueFlat;
  if ("thresholdDays" in payload) row.threshold_days = payload.thresholdDays;
  if ("thresholdHours" in payload) row.threshold_hours = payload.thresholdHours;
  if ("isEnabled" in payload) row.is_enabled = payload.isEnabled;

  const { data, error } = await supabase
    .from("facility_discounts")
    .update(row)
    .eq("id", discountId)
    .select(DISCOUNT_SELECT)
    .single();

  if (error) throw error;
  return toDiscount(data);
}

export async function deleteDiscount(discountId) {
  const { error } = await supabase.from("facility_discounts").delete().eq("id", discountId);
  if (error) throw error;
}

// ---------- ประวัติการแก้ราคา และตัวอย่างราคา ----------

export async function fetchPriceHistory(facilityId) {
  const { data, error } = await supabase
    .from("facility_price_history")
    .select("id, description, created_at, profiles ( full_name, username )")
    .eq("facility_id", facilityId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    description: row.description,
    createdAt: row.created_at,
    changedByName: row.profiles?.full_name || row.profiles?.username || "ระบบ",
  }));
}

// เขียนหลัง save สำเร็จเท่านั้น — description ประกอบมาจากฝั่งเรียกแล้ว
// (เทียบค่าก่อน/หลังเอง) ตรงนี้แค่ insert ตรงๆ
export async function logPriceChange(facilityId, description) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("facility_price_history").insert({
    facility_id: facilityId,
    description,
    changed_by: user?.id ?? null,
  });

  if (error) throw error;
}

// ตัวอย่างราคาที่ลูกค้าเห็น — เรียก RPC เดียวกับที่ create_booking ใช้จริง
// (compute_facility_price, 0024) เพื่อให้ตัวเลขตรงกันเป๊ะเสมอ
export async function fetchFacilityPricePreview(facilityId, date, startTime, endTime) {
  const { data, error } = await supabase.rpc("compute_facility_price", {
    p_facility_id: facilityId,
    p_booking_date: date,
    p_start_time: startTime,
    p_end_time: endTime,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    hours: Number(row.hours),
    baseRate: Number(row.base_rate),
    isPeak: row.is_peak,
    subtotal: Number(row.subtotal),
    discountTotal: Number(row.discount_total),
    totalAmount: Number(row.total_amount),
    depositAmount: Number(row.deposit_amount),
    discountLines: (row.discount_lines ?? []).map((line) => ({
      label: line.label,
      amount: Number(line.amount),
    })),
  };
}
