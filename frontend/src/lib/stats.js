// ตัวเลขบนหน้าแรก
//
// bookings_select_own ทำให้ client นับการจองรวมทั้งระบบไม่ได้ (เห็นแต่ของตัวเอง)
// จึงต้องผ่าน platform_stats() ที่เป็น security definer และคืนออกมาแค่ "จำนวน"
// ไม่ใช่ตัวข้อมูล
import { supabase } from "./supabase";

export async function fetchPlatformStats() {
  const { data, error } = await supabase.rpc("platform_stats");

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    venues: row.venues,
    facilities: row.facilities,
    sports: row.sports,
    openSlots: row.open_slots,
    bookingsTotal: row.bookings_total,
    bookingsThisMonth: row.bookings_this_month,
    reviewsCount: row.reviews_count,
    avgRating: row.avg_rating === null ? null : Number(row.avg_rating),
  };
}
