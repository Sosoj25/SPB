import { supabase } from "./supabase";
import { toHhMm } from "./bookings";
import {
  sportBasketball,
  sportFootball,
  sportTennis,
  sportVolleyball,
} from "../assets/images";

// facility_images ยังว่างอยู่ (ยังไม่มีหน้าแอดมินให้อัปโหลดรูปสนามจริง)
// จนกว่าจะมี ใช้ภาพประจำกีฬาเป็นตัวแทนไปก่อน
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
  sports ( id, name ),
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
    image: images[0]?.image_url ?? sportImage(row.sports?.name),
  };
}

// รายการกีฬาพร้อมจำนวนสนามและราคาเริ่มต้น
//
// นับ/หาราคาต่ำสุดที่ฝั่ง client เพราะ PostgREST รวมยอดใน nested select ไม่ได้
// และทั้งระบบมีสนามหลักสิบ ไม่ใช่หลักหมื่น — ไม่คุ้มที่จะเพิ่ม RPC อีกตัว
export async function fetchSportCatalog() {
  const { data, error } = await supabase
    .from("sports")
    .select("id, name, description, facilities ( id, price_per_hour, status )")
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
        image: sportImage(sport.name),
        courtCount: open.length,
        minPrice: open.length
          ? Math.min(...open.map((f) => Number(f.price_per_hour)))
          : null,
      };
    })
    .filter((sport) => sport.courtCount > 0);
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
