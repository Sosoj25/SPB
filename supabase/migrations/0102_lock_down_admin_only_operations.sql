-- ============================================================
-- ปิดงานที่ควรเป็นของแอดมิน/ระบบเท่านั้น ไม่ให้ผู้ใช้ทั่วไปยิงถึง
-- ============================================================

-- ------------------------------------------------------------
-- ensure_future_slots() — เดิม authenticated ทุกคนเรียกได้
-- ------------------------------------------------------------
-- 0021 grant ให้ authenticated ไว้ตอนที่หน้า AdminSchedule ยังเรียกตัวนี้ตรง ๆ
-- แต่ข้างในไม่มี is_admin() เลยสักบรรทัด ผู้ใช้ธรรมดาคนไหนก็ยิง
-- POST /rest/v1/rpc/ensure_future_slots {"p_days": 365} ได้ แล้ววนสร้าง slot
-- ของทุกสนามยาวหนึ่งปีรวด (ตอนนี้ตารางมีหมื่นกว่าแถวจาก 70 วัน ยิงทีเดียว
-- พุ่งไปหลายหมื่น) เป็นทั้งภาระเขียนและทำให้ตารางบวมโดยไม่มีใครสั่ง
--
-- ใส่ด่าน is_admin() ไว้ข้างในแทนการถอน grant อย่างเดียว เพราะหน้า
-- AdminSchedule ยังต้องเรียกได้อยู่จริง (lib/schedule.js) — ด่านอยู่ข้างใน
-- ฟังก์ชันจึงกันได้ทั้ง REST และทุกทางที่อาจเรียกในอนาคต ส่วน cron ที่รันใน
-- ฐานะ postgres ผ่านด่านนี้ด้วย service_role check
create or replace function public.ensure_future_slots(p_days integer default 70)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_total integer := 0;
begin
  -- pg_cron รันในฐานะ postgres (ไม่มี JWT) — auth.role() คืน null ไม่ใช่
  -- 'service_role' จึงต้องเช็ค current_user เพิ่มด้วย ไม่งั้น job
  -- ensure-future-slots ที่ตั้งไว้ตั้งแต่ 0021 จะพังทันทีที่ migration นี้ลง
  if not (
       public.is_admin()
    or auth.role() = 'service_role'
    or current_user in ('postgres', 'supabase_admin')
  ) then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  if p_days < 1 or p_days > 365 then
    raise exception 'จำนวนวันล่วงหน้าต้องอยู่ระหว่าง 1 ถึง 365';
  end if;

  for r in
    select
      f.id,
      v.opening_time,
      v.closing_time,
      case when s.name in ('แบดมินตัน', 'เทนนิส') then 60 else 120 end as slot_minutes
    from public.facilities f
    join public.venues v on v.id = f.venue_id
    join public.sports s on s.id = f.sport_id
    where f.status = 'available'
      and v.status = 'active'
  loop
    v_total := v_total + public.generate_facility_slots(
      r.id,
      current_date,
      current_date + p_days,
      r.opening_time,
      r.closing_time,
      r.slot_minutes
    );
  end loop;

  return v_total;
end;
$$;

revoke all on function public.ensure_future_slots(integer) from public, anon;
grant execute on function public.ensure_future_slots(integer) to authenticated, service_role;


-- ------------------------------------------------------------
-- bucket sport-images — ตั้งเพดานให้เท่ากับ bucket อื่นทั้ง 10 ตัว
-- ------------------------------------------------------------
-- bucket อื่นทุกตัวตั้ง file_size_limit 5 MB และจำกัด mime เป็นรูป 4 ชนิด
-- เหมือนกันหมด แต่ sport-images (0032) ลืมตั้ง ทั้งสองค่าเป็น null = ไม่จำกัด
-- ทั้งขนาดและชนิดไฟล์ อัปโหลดต้องเป็นแอดมินก็จริง แต่ bucket เป็น public
-- ไฟล์ HTML/SVG ที่หลุดเข้าไปจะถูกเสิร์ฟจากโดเมน storage ตรง ๆ
update storage.buckets
set file_size_limit    = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'sport-images';
