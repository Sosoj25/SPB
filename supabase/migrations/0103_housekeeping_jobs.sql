-- ============================================================
-- งานบ้าน: ล้างข้อมูลที่โตขึ้นเรื่อย ๆ โดยไม่มีใครลบ
-- ============================================================

-- ------------------------------------------------------------
-- 1) cron.job_run_details — ใหญ่กว่าข้อมูลแอปทั้งระบบรวมกัน
-- ------------------------------------------------------------
-- job reconcile-plernpay-payments รันทุก 30 วินาทีตลอด 24 ชม. = 2,880 แถว/วัน
-- ตอนเขียน migration นี้ตารางนี้อยู่ที่ 58,070 แถว / 43 MB ขณะที่ตารางใหญ่สุด
-- ของแอปเอง (facility_time_slots) แค่ 4.2 MB — คิดเป็นราว 1.3 GB ต่อปีถ้า
-- ปล่อยไว้ pg_cron ไม่ล้างประวัติให้เองต้องตั้ง job ลบเอง
--
-- เก็บไว้ 7 วันพอสำหรับไล่ดูย้อนหลังตอน job พัง
create or replace function public.purge_cron_history(p_keep_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  v_deleted integer;
begin
  if p_keep_days < 1 then
    raise exception 'ต้องเก็บประวัติอย่างน้อย 1 วัน';
  end if;

  delete from cron.job_run_details
  where end_time < now() - make_interval(days => p_keep_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_cron_history(integer) from public, anon, authenticated;
grant execute on function public.purge_cron_history(integer) to service_role;


-- ------------------------------------------------------------
-- 2) facility_time_slots ที่ผ่านไปแล้วและไม่เคยถูกจอง
-- ------------------------------------------------------------
-- ensure_future_slots() เติม slot ล่วงหน้า 70 วันทุกคืน แต่ไม่มีใครลบของเก่า
-- ตอนเขียนนี้มี 2,574 แถวที่ slot_date ผ่านไปแล้ว และ 2,555 แถวในนั้นไม่เคย
-- ถูกจองเลย โตวันละ ~180 แถวไปเรื่อย ๆ
--
-- สำคัญ: ลบเฉพาะ slot ที่ "ไม่มี booking_slots อ้างถึง" เท่านั้น เพราะ
-- booking_slots.slot_id เป็น FK แบบ on delete cascade — ถ้าเผลอลบ slot ที่มี
-- การจองผูกอยู่ แถว booking_slots ของการจองนั้นจะหายตามไปด้วย ประวัติการจอง
-- กับใบเสร็จย้อนหลังจะพังทันทีโดยไม่มีอะไรฟ้อง
--
-- เว้นระยะ 90 วันไว้ด้วย เผื่อมีรายงานย้อนหลังที่ยัง join กลับมาที่ slot
create or replace function public.purge_past_unused_slots(p_keep_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_keep_days < 1 then
    raise exception 'ต้องเก็บ slot ย้อนหลังอย่างน้อย 1 วัน';
  end if;

  delete from public.facility_time_slots s
  where s.slot_date < (now() at time zone 'Asia/Bangkok')::date - p_keep_days
    and not exists (
      select 1 from public.booking_slots bs where bs.slot_id = s.id
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_past_unused_slots(integer) from public, anon, authenticated;
grant execute on function public.purge_past_unused_slots(integer) to service_role;


-- ------------------------------------------------------------
-- ตั้งเวลา — ตี 3 ครึ่งไทย (20:30 UTC) ช่วงที่ไม่มีคนใช้งาน
-- ------------------------------------------------------------
select cron.schedule(
  'purge-cron-history',
  '30 20 * * *',
  $cron$ select public.purge_cron_history(7) $cron$
);

select cron.schedule(
  'purge-past-unused-slots',
  '45 20 * * *',
  $cron$ select public.purge_past_unused_slots(90) $cron$
);
