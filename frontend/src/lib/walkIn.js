// นับสนามที่ยังว่างอยู่วันนี้อย่างน้อย 1 ช่วงเวลา ทั่วทุกกีฬา — ใช้โชว์ป้าย
// "สนามว่างตอนนี้ N สนาม" ที่หัวหน้ารับลูกค้า Walk-in ไม่มี RPC ตัวเดียวที่
// รวมยอดข้ามกีฬาให้ (sport_facility_availability คิดทีละกีฬา) แต่ระบบมีสนาม
// อยู่หลักสิบเท่านั้น ไล่ทีละกีฬาจึงเร็วพอโดยไม่ต้องเพิ่ม RPC ใหม่
import { supabase } from "./supabase";
import { fetchSportCatalog, fetchSportAvailability } from "./catalog";

export async function fetchAvailableFacilityCount(date) {
  const sports = await fetchSportCatalog();

  const availabilityMaps = await Promise.all(
    sports.map((sport) => fetchSportAvailability(sport.id, date)),
  );

  return availabilityMaps.reduce(
    (count, map) => count + [...map.values()].filter((v) => v.free > 0).length,
    0,
  );
}

// สร้างการจองแทนลูกค้า walk-in — จ่ายเงินที่เคาน์เตอร์ทันที ต่างจาก
// createBooking (lib/bookings.js) ที่ลูกค้ากดจองเองแล้วรอจ่ายทีหลัง
// ดู admin_create_walk_in_booking (0064) สำหรับกติกาเต็ม
export async function createWalkInBooking({
  facilityId,
  slotIds,
  customerUserId,
  customerName,
  customerPhone,
  note,
  paymentMethod,
}) {
  const { data, error } = await supabase.rpc("admin_create_walk_in_booking", {
    p_facility_id: facilityId,
    p_slot_ids: slotIds,
    p_customer_user_id: customerUserId ?? null,
    p_customer_name: customerUserId ? null : (customerName ?? null),
    p_customer_phone: customerUserId ? null : (customerPhone ?? null),
    p_note: note ?? null,
    p_payment_method: paymentMethod,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
