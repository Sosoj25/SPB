-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0078).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- แก้บั๊ก: cron complete-past-bookings พังทุกรอบมาตั้งแต่ apply 0076
-- ============================================================
-- literal string ใน CASE expression ('no_show' / 'awaiting_review') ถูกมองเป็น
-- type text ไม่ใช่ booking_status (ต่างจาก assign ค่าเดียวตรง ๆ ที่ postgres
-- cast ให้อัตโนมัติ) ทำให้ update พังด้วย
--   "column status is of type booking_status but expression is of type text"
-- ผลคือทุก booking ที่ควรเลื่อนเป็น awaiting_review/no_show ค้างเป็น confirmed
-- มาตลอดตั้งแต่วันที่ apply 0076 — ต้อง cast ให้ตรง type ทั้งสองฝั่งของ case

create or replace function public.complete_past_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_done integer;
begin
  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set status = case
    when checked_in_at is null then 'no_show'::public.booking_status
    else 'awaiting_review'::public.booking_status
  end
  where status = 'confirmed'
    and payment_status in ('paid', 'approved')
    and (booking_date + end_time) <= (now() at time zone 'Asia/Bangkok');

  get diagnostics v_done = row_count;

  perform set_config('app.booking_engine', 'off', true);

  return v_done;
end;
$fn$;

revoke all on function public.complete_past_bookings() from public, anon, authenticated;
