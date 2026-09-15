// แคตตาล็อกกีฬา/สนาม และการถามว่าช่วงเวลาไหนยังว่าง — มุมมองฝั่งลูกค้า
//
// ส่วนของ "ความว่าง" ต้องผ่าน RPC เสมอ (เหตุผลอยู่ที่หัวข้อคั่นด้านล่าง)
// ส่วนงานแก้ตารางเวลาของแอดมินอยู่ที่ lib/schedule.js
import { supabase } from "./supabase";
import { toHhMm } from "./bookings";
import { assertImageFile, imageExt, removeStorageFolder } from "./uploads";
import {
  sportBasketball,
  sportFootball,
  sportTennis,
  sportVolleyball,
} from "../assets/images";

// รูปสำรองสุดท้ายของสนาม เมื่อทั้ง facility_images และ sports.icon_url ว่าง
// (ลำดับการเลือกรูปจริงอยู่ใน toFacility ข้างล่าง)
//
// แม็ปด้วย "ชื่อกีฬา" ไม่ใช่ sports.id เพราะ id เป็น identity column —
// เลขบนเครื่อง dev กับบน production ไม่รับประกันว่าตรงกัน
const SPORT_IMAGES = {
  ฟุตบอล: sportFootball,
  ฟุตซอล: sportFootball,
  บาสเกตบอล: sportBasketball,
  วอลเลย์บอล: sportVolleyball,
  เทนนิส: sportTennis,
  แบดมินตัน: sportTennis,
};

export const sportImage = (name) => SPORT_IMAGES[name] ?? sportFootball;

const FACILITY_SELECT = `
  id,
  name,
  description,
  capacity,
  price_per_hour,
  sports ( id, name, icon_url ),
  venues!inner ( id, name, address, phone, opening_time, closing_time ),
  facility_images ( image_url, is_primary, sort_order )
`;

function toFacility(row) {
  const images = [...(row.facility_images ?? [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order
  );

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    capacity: row.capacity,
    pricePerHour: Number(row.price_per_hour),
    sportId: row.sports?.id ?? null,
    sportName: row.sports?.name ?? "กีฬา",
    venueId: row.venues?.id ?? null,
    venueName: row.venues?.name ?? "สนามกีฬา",
    venueAddress: row.venues?.address ?? "",
    venuePhone: row.venues?.phone ?? "",
    openingTime: toHhMm(row.venues?.opening_time),
    closingTime: toHhMm(row.venues?.closing_time),
    image: images[0]?.image_url ?? row.sports?.icon_url ?? sportImage(row.sports?.name),
  };
}

// รายการกีฬาพร้อมจำนวนสนามและราคาเริ่มต้น
//
// นับ/หาราคาต่ำสุดที่ฝั่ง client เพราะ PostgREST รวมยอดใน nested select ไม่ได้
// และทั้งระบบมีสนามหลักสิบ ไม่ใช่หลักหมื่น — ไม่คุ้มที่จะเพิ่ม RPC อีกตัว
export async function fetchSportCatalog() {
  const { data, error } = await supabase
    .from("sports")
    .select("id, name, description, icon_url, facilities ( id, price_per_hour, status )")
    .eq("is_active", true)
    .order("id");

  if (error) throw error;

  return (data ?? [])
    .map((sport) => {
      // facilities RLS ปล่อยทั้ง available และ maintenance ผ่านมา
      // ("status <> inactive") แต่ที่จองได้จริงมีแค่ available
      const open = (sport.facilities ?? []).filter((f) => f.status === "available");

      return {
        id: sport.id,
        name: sport.name,
        description: sport.description ?? "",
        image: sport.icon_url || sportImage(sport.name),
        courtCount: open.length,
        minPrice: open.length
          ? Math.min(...open.map((f) => Number(f.price_per_hour)))
          : null,
      };
    })
    .filter((sport) => sport.courtCount > 0);
}

// รายชื่อกีฬาทั้งหมดสำหรับหน้าแอดมิน — ต่างจาก fetchSportCatalog (หน้าลูกค้า)
// ตรงที่ไม่กรองกีฬาที่ยังไม่มีสนามเปิดจองออก ไม่งั้นกีฬาที่เพิ่งสร้างใหม่จะไม่
// โผล่ให้เลือกเพื่อเพิ่มสนามแรกของมันได้เลย (ไก่กับไข่ — สร้างกีฬาไม่มีสนาม
// เลยไม่โผล่ ไม่โผล่เลยเลือกไม่ได้เพื่อเพิ่มสนาม)
export async function fetchAdminSports() {
  const { data, error } = await supabase
    .from("sports")
    .select("id, name, description, icon_url")
    .order("id");

  if (error) throw error;

  return (data ?? []).map((sport) => ({
    id: sport.id,
    name: sport.name,
    description: sport.description ?? "",
    image: sport.icon_url || sportImage(sport.name),
  }));
}

// รายชื่อกีฬาทั้งหมดให้ผู้ใช้เลือกตอนแก้ไขโปรไฟล์ — ไม่กรอง courtCount เหมือน
// fetchSportCatalog เพราะแค่ให้เลือก "กีฬาที่เล่น" ไม่เกี่ยวกับว่าจองได้จริงไหม
export async function fetchSportNames() {
  const { data, error } = await supabase
    .from("sports")
    .select("name")
    .eq("is_active", true)
    .order("id");

  if (error) throw error;

  return (data ?? []).map((sport) => sport.name);
}

// เพิ่มกีฬาใหม่เข้าตาราง sports — sports_admin_manage (0000) ให้สิทธิ์ admin
// insert อยู่แล้ว กีฬาที่เพิ่งสร้างจะยังไม่โผล่ในหน้าเลือกกีฬาของลูกค้า
// (fetchSportCatalog กรอง courtCount > 0) จนกว่าจะมีสนามที่เปิดจองได้แล้ว
export async function createSport({ name, description }) {
  const { data, error } = await supabase
    .from("sports")
    .insert({ name, description: description || null })
    .select("id, name, description, icon_url")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error(`มีกีฬาชื่อ "${name}" อยู่แล้ว กรุณาใช้ชื่ออื่น`);
    throw error;
  }

  return {
    id: data.id,
    name: data.name,
    description: data.description ?? "",
    image: data.icon_url || sportImage(data.name),
  };
}

// ลบกีฬาทิ้ง — facilities.sport_id เป็น on delete restrict (0000) จึงลบไม่ได้
// ถ้ายังมีสนามผูกอยู่แม้แต่สนามเดียว (แม้สนามนั้นจะปิดให้บริการแล้วก็ตาม)
// ต้องลบสนามทั้งหมดของกีฬานี้ก่อน — ดักโค้ด 23503 (foreign_key_violation)
// ไว้บอกเหตุผลเป็นภาษาไทยแทนข้อความ Postgres ดิบ
export async function deleteSport(sportId) {
  const { error } = await supabase.from("sports").delete().eq("id", sportId);

  if (error) {
    if (error.code === "23503") {
      throw new Error("ลบไม่ได้ เพราะกีฬานี้ยังมีสนามผูกอยู่ กรุณาลบสนามทั้งหมดของกีฬานี้ก่อน");
    }
    throw error;
  }

  await removeStorageFolder("sport-images", sportId);
}

// ---------- Admin: รูปภาพประจำกีฬา ----------
//
// เป็นรูปตั้งต้นของกีฬานั้นบนหน้ารายการกีฬา และรูปสำรองของสนาม (toFacility
// ด้านบน) เมื่อสนามยังไม่มีรูปของตัวเองใน facility_images — sports_admin_manage
// (0000) ให้สิทธิ์ admin update ตาราง sports อยู่แล้ว ที่นี่แค่อัปโหลดไฟล์แล้ว
// เขียน public URL ทับ icon_url เดิม
export async function uploadSportIcon(file, sportId) {
  assertImageFile(file);

  const path = `${sportId}/${Date.now()}.${imageExt(file)}`;

  const { error: uploadError } = await supabase.storage
    .from("sport-images")
    .upload(path, file, { upsert: true });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from("sport-images").getPublicUrl(path);

  const { error } = await supabase
    .from("sports")
    .update({ icon_url: publicData.publicUrl })
    .eq("id", sportId);
  if (error) throw error;

  return publicData.publicUrl;
}

// ใช้ตอนยืนยันครอบตัดรูปกีฬา (ImageCropModal) — ผลลัพธ์จาก canvas เป็น jpeg
// ที่ควบคุมขนาดไว้แล้วเสมอ จึงไม่ต้องเช็ค assertImageFile ซ้ำ (เหมือน
// replaceImageFile ใน lib/facilityImages.js) คนละ path ใหม่กันแคชเบราว์เซอร์ค้าง
export async function replaceSportIcon(blob, sportId) {
  const path = `${sportId}/${Date.now()}-cropped.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("sport-images")
    .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from("sport-images").getPublicUrl(path);

  const { error } = await supabase
    .from("sports")
    .update({ icon_url: publicData.publicUrl })
    .eq("id", sportId);
  if (error) throw error;

  return publicData.publicUrl;
}

export async function fetchFacilitiesBySport(sportId) {
  const { data, error } = await supabase
    .from("facilities")
    .select(FACILITY_SELECT)
    .eq("sport_id", sportId)
    .eq("status", "available")
    .eq("venues.status", "active")
    .order("id");

  if (error) throw error;

  return (data ?? []).map(toFacility);
}

export async function fetchFacility(facilityId) {
  const { data, error } = await supabase
    .from("facilities")
    .select(FACILITY_SELECT)
    .eq("id", facilityId)
    .eq("venues.status", "active")
    .maybeSingle();

  if (error) throw error;

  return data ? toFacility(data) : null;
}

// ---------- ความว่าง (ต้องผ่าน RPC เท่านั้น) ----------
//
// bookings_select_own ให้ผู้ใช้เห็นเฉพาะการจองของตัวเอง การถามว่า
// "ช่วงนี้มีคนจองหรือยัง" จาก client ตรง ๆ จึงได้ [] เสมอ
// ทั้งสามฟังก์ชันข้างล่างเรียก security definer ที่ตอบแค่ว่าง/ไม่ว่าง
//
// ช่วงเวลามาจาก facility_time_slots ที่แอดมินลงไว้เป็นรายวัน (0010)
// วันที่แอดมินยังไม่ได้เปิด จะได้ total = 0 ซึ่งคนละความหมายกับ "เต็ม"

export async function fetchFacilitySlots(facilityId, date) {
  const { data, error } = await supabase.rpc("facility_slots", {
    p_facility_id: facilityId,
    p_date: date,
  });

  if (error) throw error;

  return (data ?? []).map((slot) => ({
    id: slot.slot_id,
    start: toHhMm(slot.slot_start),
    end: toHhMm(slot.slot_end),
    isBooked: slot.is_booked,
  }));
}

// คืน Map<'YYYY-MM-DD', { free, total }> ให้ปฏิทินเปิดดูทีละวันได้เร็ว
export async function fetchDayAvailability(facilityId, from, to) {
  const { data, error } = await supabase.rpc("facility_day_availability", {
    p_facility_id: facilityId,
    p_from: from,
    p_to: to,
  });

  if (error) throw error;

  return new Map(
    (data ?? []).map((row) => [row.day, { free: row.free_slots, total: row.total_slots }])
  );
}

// คืน Map<facilityId, { free, total }> ให้หน้ารายการสนามติดป้าย "ว่าง/เต็ม"
export async function fetchSportAvailability(sportId, date) {
  const { data, error } = await supabase.rpc("sport_facility_availability", {
    p_sport_id: sportId,
    p_date: date,
  });

  if (error) throw error;

  return new Map(
    (data ?? []).map((row) => [row.facility_id, { free: row.free_slots, total: row.total_slots }])
  );
}
