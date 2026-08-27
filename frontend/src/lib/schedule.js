import { supabase } from "./supabase";
import { toISODate } from "./bookings";

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

const DAY_SLOT_SELECT = `
  id,
  start_time,
  end_time,
  is_active,
  closure_note,
  bookings ( id, status, profiles ( full_name, username ) )
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
    const booking = (row.bookings ?? []).find((b) => ACTIVE_BOOKING_STATUSES.includes(b.status));

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
    const booked = await supabase
      .from("bookings")
      .select("slot_id")
      .in("slot_id", dayIds)
      .in("status", ACTIVE_BOOKING_STATUSES);
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
