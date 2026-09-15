-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0076).
-- Safe to re-run: idempotent.
--
-- ============================================================
-- เปิด Realtime ให้ตาราง bookings
-- ============================================================
-- ให้การ์ด "รายการถัดไป" ในหน้า Home (NextBookingCard) อัปเดตสถานะ
-- ชำระเงิน/สถานะการจองเองทันทีที่แอดมินอนุมัติ/ปฏิเสธการชำระเงิน โดยไม่ต้อง
-- รอผู้ใช้กดรีเฟรช — postgres_changes เคารพ RLS ของตารางอยู่แล้ว
-- (bookings_select_own) แต่ subscribeToBookingChanges ใส่ filter user_id
-- ซ้ำเพื่อไม่ให้ฝั่ง Realtime server ต้องส่ง event ของคนอื่นมาเช็ค RLS
-- ทุกแถวโดยไม่จำเป็น (รูปแบบเดียวกับ 0065_notifications_realtime.sql)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
end
$$;
