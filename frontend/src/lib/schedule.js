import { supabase } from "./supabase";
import { hoursBetween, toISODate } from "./bookings";

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "completed"];

// แอดมินเห็นทุกแถวของ facility_time_slots ผ่าน RLS admin manage (0010) อยู่แล้ว
// ไม่ต้องผ่าน RPC เหมือน fetchDayAvailability ฝั่งลูกค้าใน lib/catalog.js ที่ต้อง
// ซ่อนรายละเอียดการจองของคนอื่น — แอดมินเห็นได้ทุกอย่างตรง ๆ

// คืน Map<'YYYY-MM-DD', 'open' | 'partial' | 'closed'> ให้ปฏิทินทั้งเดือน
export async function fetchMonthSlotSummary(facilityId, year, month) {
  const from = toISODate(new Date(year, month, 1));
  const to = toISODate(new Date(year, month + 1, 0));

  const { data, error } = await supabase
    .from("facility_time_slots")
    .select("slot_date, is_active")
    .eq("facility_id", facilityId)
    .gte("slot_date", from)
    .lte("slot_date", to);

  if (error) throw error;

  const byDay = new Map();
  for (const row of data ?? []) {
    const entry = byDay.get(row.slot_date) ?? { active: 0, total: 0 };
    entry.total += 1;
    if (row.is_active) entry.active += 1;
    byDay.set(row.slot_date, entry);
  }

  const summary = new Map();
  for (const [day, { active, total }] of byDay) {
    if (active === 0) summary.set(day, "closed");
    else if (active === total) summary.set(day, "open");
    else summary.set(day, "partial");
  }
  return summary;
}

// ผ่าน booking_slots แทนการ join bookings.slot_id ตรง ๆ เพราะตั้งแต่จองหลาย
// ช่วงต่อกันได้ในครั้งเดียว (0035) มีแค่ slot แรกของช่วงเท่านั้นที่ผูกผ่าน
// bookings.slot_id — slot ที่ 2 เป็นต้นไปเห็นได้ผ่าน booking_slots เท่านั้น
//
// ต้องระบุ !bookings_user_id_fkey ตรง ๆ เพราะตั้งแต่ 0038 เพิ่ม
// checked_in_by / checked_out_by (ก็ชี้ไปที่ profiles เหมือนกัน) bookings
// มี FK ไปหา profiles ถึง 3 เส้น PostgREST เดาไม่ได้แล้วว่าจะ join ผ่านเส้นไหน
const DAY_SLOT_SELECT = `
  id,
  start_time,
  end_time,
  is_active,
  closure_note,
  booking_slots ( bookings ( id, status, profiles!bookings_user_id_fkey ( full_name, username ) ) )
`;

export async function fetchDaySlots(facilityId, date) {
  const { data, error } = await supabase
    .from("facility_time_slots")
    .select(DAY_SLOT_SELECT)
    .eq("facility_id", facilityId)
    .eq("slot_date", date)
    .order("start_time");

  if (error) throw error;

  return (data ?? []).map((row) => {
    const bookings = (row.booking_slots ?? []).map((bs) => bs.bookings).filter(Boolean);
    const booking = bookings.find((b) => ACTIVE_BOOKING_STATUSES.includes(b.status));

    return {
      id: row.id,
      startTime: row.start_time,
      endTime: row.end_time,
      isActive: row.is_active,
      closureNote: row.closure_note ?? "",
      bookedBy: booking
        ? booking.profiles?.full_name || booking.profiles?.username || "ลูกค้า"
        : null,
    };
  });
}

// เติมช่วงเวลาล่วงหน้าให้ทุกสนามครบ p_days วัน (ปกติ cron รันให้ทุกคืนตามที่
// ตั้งไว้ใน 0021 อยู่แล้ว — ปุ่มนี้ให้แอดมินกดเติมเองได้ทันทีโดยไม่ต้องรอ
// เช่นหลังเพิ่มสนามใหม่ หรือช่วงเวลาใกล้หมดตอนนี้)
export async function ensureFutureSlots(days = 70) {
  const { data, error } = await supabase.rpc("ensure_future_slots", { p_days: days });
  if (error) throw error;
  return data ?? 0;
}

// เพิ่มช่วงเวลาที่แอดมินกำหนดเองสำหรับวันเดียว (นอกเหนือจากเวลาเปิด-ปิดปกติ
// ของ venue ที่ ensureFutureSlots ใช้) — ส่ง p_slot_minutes เท่ากับความยาว
// ของช่วงพอดี ให้ generate_facility_slots สร้างช่วงเดียวตามเวลาที่ระบุ
// ไม่ถูกหั่นเป็นช่วงย่อยตามความยาวมาตรฐาน
export async function addCustomSlot(facilityId, date, startTime, endTime) {
  const minutes = Math.round(hoursBetween(startTime, endTime) * 60);
  if (!(minutes > 0)) throw new Error("เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม");

  const { data, error } = await supabase.rpc("generate_facility_slots", {
    p_facility_id: facilityId,
    p_from: date,
    p_to: date,
    p_start_time: startTime,
    p_end_time: endTime,
    p_slot_minutes: minutes,
  });

  if (error) throw error;
  if (!data) throw new Error("ช่วงเวลานี้ทับกับช่วงที่มีอยู่แล้ว");
  return data;
}

// ลบช่วงเวลาทิ้งจริง (ต่างจาก setSlotActive ที่แค่ปิดไว้) — ใช้ตอนแอดมิน
// เพิ่มช่วงเวลาผิดแล้วอยากเอาออกจากตารางไปเลย ไม่ใช่แค่ปิดรับจอง
//
// เช็คว่ามีคนจองอยู่ก่อนเสมอแทนที่จะเชื่อปุ่มฝั่ง UI ที่ disabled ไว้แล้ว —
// กันเคสจองแทรกเข้ามาระหว่างที่หน้าจอยังโหลดข้อมูลเก่าอยู่ (เหมือน
// setDayActive) — เช็คผ่าน booking_slots (0035) ไม่ใช่ bookings.slot_id
// ตรง ๆ เพราะ slot นี้อาจเป็นช่วงที่ 2 เป็นต้นไปของการจองหลายช่วงต่อกัน
// ซึ่งไม่มีทางเห็นผ่าน bookings.slot_id (ชี้แค่ slot แรกของช่วง)
export async function deleteSlot(slotId) {
  const booked = await supabase
    .from("booking_slots")
    .select("slot_id, bookings!inner ( status )")
    .eq("slot_id", slotId)
    .in("bookings.status", ACTIVE_BOOKING_STATUSES)
    .limit(1);
  if (booked.error) throw booked.error;
  if ((booked.data ?? []).length > 0) {
    throw new Error("ลบไม่ได้ เพราะมีคนจองช่วงเวลานี้อยู่แล้ว");
  }

  const { error } = await supabase.from("facility_time_slots").delete().eq("id", slotId);
  if (error) throw error;
}

export async function setSlotActive(slotId, isActive, closureNote = null) {
  const { error } = await supabase
    .from("facility_time_slots")
    .update({ is_active: isActive, closure_note: isActive ? null : closureNote })
    .eq("id", slotId);

  if (error) throw error;
}

// เปิด/ปิดทั้งวันรวด — ข้ามช่วงที่มีคนจองอยู่แล้วไม่ให้ปิดทับ (ลูกค้าจ่ายเงินไปแล้ว
// การปิดช่วงที่มีการจองจริงต้องยกเลิกการจองก่อน ไม่ใช่งานของปุ่มนี้)
export async function setDayActive(facilityId, date, isActive) {
  const daySlots = await supabase
    .from("facility_time_slots")
    .select("id")
    .eq("facility_id", facilityId)
    .eq("slot_date", date);
  if (daySlots.error) throw daySlots.error;

  const dayIds = (daySlots.data ?? []).map((s) => s.id);
  if (dayIds.length === 0) return;

  let editableIds = dayIds;

  if (!isActive) {
    // ผ่าน booking_slots ไม่ใช่ bookings.slot_id ตรง ๆ ด้วยเหตุผลเดียวกับ
    // deleteSlot — กันเคสปิดสล็อตที่ 2 เป็นต้นไปของการจองหลายช่วงต่อกัน
    const booked = await supabase
      .from("booking_slots")
      .select("slot_id, bookings!inner ( status )")
      .in("slot_id", dayIds)
      .in("bookings.status", ACTIVE_BOOKING_STATUSES);
    if (booked.error) throw booked.error;

    const bookedIds = new Set((booked.data ?? []).map((b) => b.slot_id));
    editableIds = dayIds.filter((id) => !bookedIds.has(id));
  }

  if (editableIds.length === 0) return;

  const { error } = await supabase
    .from("facility_time_slots")
    .update({ is_active: isActive, closure_note: isActive ? null : "ปิดทั้งวัน" })
    .in("id", editableIds);

  if (error) throw error;
}
