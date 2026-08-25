-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0012).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ปัญหา: การจอง "เล่นจบแล้ว" ไม่มีอยู่จริง และรีวิวไม่ต้องเคยไปเล่นก็เขียนได้
-- ============================================================
--
-- 1) ไม่มีอะไรทำให้ booking กลายเป็น completed
--    enum booking_status มีค่า 'completed' และ describeStatus() ฝั่งหน้าเว็บ
--    มี label "สำเร็จ" รออยู่ แต่ไม่มีโค้ดตรงไหนเลยที่เขียนค่านี้ลงไป
--    ทุกรายการจึงค้างที่ confirmed ตลอดกาลแม้เล่นจบไปเป็นเดือนแล้ว
--
-- 2) reviews_insert_own (0000) เช็คแค่ user_id = auth.uid()
--    ทั้งที่ตารางมีของครบอยู่แล้ว — booking_id เป็น NOT NULL + FK + UNIQUE
--    แต่ policy ไม่ได้ใช้มันเลย ผลคือผู้ใช้:
--      - รีวิวการจองที่ตัวเองยกเลิกไปแล้ว หรือยังไม่ถึงวันเล่น ได้
--      - ใส่ facility_id เป็นคนละสนามกับที่จองจริงได้
--        (จองสนาม A ราคาถูก แล้วเอาไปให้ 1 ดาวกับสนาม B ที่ไม่เคยไป)
--
-- 3) reviews_update_own ก็ให้แก้ทุกคอลัมน์เหมือนกัน
--    ต่อให้ปิดตอน insert ผู้ใช้ก็แค่ insert ให้ถูกก่อนแล้วค่อย update
--    facility_id ทีหลัง — เป็นช่องเดียวกับที่เจอใน bookings เมื่อรอบก่อน


-- ============================================================
-- 1. ปิดงานการจองที่เล่นจบแล้ว
-- ============================================================
-- นับว่าจบเมื่อเลยเวลา end_time ของวันนั้นไปแล้ว (เวลาไทย) และจ่ายเงินแล้ว
-- รายการที่ยังไม่จ่ายจะถูก expire_unpaid_bookings (0012) เก็บไปก่อนอยู่แล้ว
--
-- ไม่ grant ให้ role ไหน เหมือน expire_unpaid_bookings — เขียน status ของ
-- การจองคนอื่นได้ จึงต้องไม่มีทางเรียกจาก API

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
  set status = 'completed'
  where status = 'confirmed'
    and payment_status in ('paid', 'approved')
    and (booking_date + end_time) <= (now() at time zone 'Asia/Bangkok');

  get diagnostics v_done = row_count;

  perform set_config('app.booking_engine', 'off', true);

  return v_done;
end;
$fn$;


revoke all on function public.complete_past_bookings() from public, anon, authenticated;


-- ============================================================
-- 2. รีวิวได้เฉพาะสนามที่ไปเล่นมาจริง
-- ============================================================
-- ต้องเขียน reviews.booking_id / reviews.facility_id แบบเต็มชื่อตาราง
-- ไม่ใช่ชื่อคอลัมน์เปล่า ๆ เพราะ bookings ก็มีคอลัมน์ facility_id เหมือนกัน
-- ถ้าเขียน b.facility_id = facility_id มันจะกลายเป็นเทียบกับตัวเอง (ผ่านเสมอ)

drop policy if exists "reviews_insert_own" on public.reviews;

create policy "reviews_insert_own"
on public.reviews
for insert
to authenticated
with check (
    user_id = auth.uid()
    and exists (
        select 1
        from public.bookings b
        where b.id          = reviews.booking_id
          and b.user_id     = auth.uid()
          and b.facility_id = reviews.facility_id
          and b.status      = 'completed'
    )
);


-- ============================================================
-- 3. รีวิวแก้ได้เฉพาะคะแนนกับข้อความ
-- ============================================================
-- status เป็นสถานะการตรวจของแอดมิน (published / hidden) ไม่ใช่ของผู้เขียน
-- ถ้าปล่อยให้แก้เอง รีวิวที่ถูกซ่อนเพราะผิดกฎก็กดกลับมาเองได้

create or replace function public.protect_review_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if new.booking_id  is distinct from old.booking_id
     or new.facility_id is distinct from old.facility_id
     or new.user_id     is distinct from old.user_id
  then
    raise exception 'รีวิวนี้ผูกกับการจองเดิม เปลี่ยนสนามหรือรายการจองไม่ได้';
  end if;

  if new.status is distinct from old.status then
    raise exception 'สถานะการแสดงผลของรีวิวแก้ไขเองไม่ได้';
  end if;

  return new;
end;
$fn$;


drop trigger if exists protect_review_privileged_columns on public.reviews;

create trigger protect_review_privileged_columns
before update on public.reviews
for each row
execute function public.protect_review_privileged_columns();


-- ============================================================
-- 4. ตัวเลขจริงสำหรับหน้าแรก
-- ============================================================
-- หน้า Home โชว์ "120+ สนามพันธมิตร / 8,400+ การจองต่อเดือน / 4.8 ดาว"
-- ซึ่งไม่ได้มาจากไหนเลย เป็นตัวเลขที่พิมพ์ไว้ในโค้ดตั้งแต่ทำดีไซน์
-- ของจริงคือ 3 สนาม, การจองหลักหน่วย, ยังไม่มีรีวิวสักอัน
--
-- ต้องเป็น security definer เพราะ bookings_select_own ทำให้ client
-- นับการจองรวมทั้งระบบไม่ได้ — แต่คืนออกไปแค่ "จำนวน" ไม่ใช่ตัวข้อมูล

create or replace function public.platform_stats()
returns table (
  venues              integer,
  facilities          integer,
  sports              integer,
  open_slots          integer,
  bookings_total      integer,
  bookings_this_month integer,
  reviews_count       integer,
  avg_rating          numeric
)
language sql
security definer
set search_path = public
stable
as $fn$
  select
    (select count(*) from public.venues where status = 'active')::integer,

    (select count(*)
     from public.facilities f
     join public.venues v on v.id = f.venue_id
     where f.status = 'available' and v.status = 'active')::integer,

    (select count(distinct f.sport_id)
     from public.facilities f
     join public.venues v on v.id = f.venue_id
     where f.status = 'available' and v.status = 'active')::integer,

    (select count(*)
     from public.facility_time_slots s
     join public.facilities f on f.id = s.facility_id
     where s.is_active
       and s.slot_date >= current_date
       and f.status = 'available')::integer,

    (select count(*) from public.bookings
     where status in ('confirmed', 'completed'))::integer,

    (select count(*) from public.bookings
     where status in ('confirmed', 'completed')
       and booking_date >= date_trunc('month', current_date)::date)::integer,

    (select count(*) from public.reviews where status = 'published')::integer,

    (select round(avg(rating), 1) from public.reviews where status = 'published');
$fn$;


revoke all on function public.platform_stats() from public;
grant execute on function public.platform_stats() to anon, authenticated;


-- ============================================================
-- 5. ตั้งเวลาปิดงานอัตโนมัติ
-- ============================================================
-- รายชั่วโมงพอ — ต่างจาก expire_unpaid_bookings ที่ต้องถี่ (ทุก 5 นาที)
-- เพราะการปล่อยช่วงเวลาคืนมีคนรออยู่จริง แต่การเปลี่ยน confirmed ->
-- completed ไม่มีใครรอ มีผลแค่กับการเขียนรีวิวและรายงานย้อนหลัง

do $outer$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'ยังไม่ได้เปิด pg_cron - ข้ามการตั้ง schedule';
    return;
  end if;

  perform cron.unschedule('complete-past-bookings')
  where exists (select 1 from cron.job where jobname = 'complete-past-bookings');

  perform cron.schedule(
    'complete-past-bookings',
    '7 * * * *',
    $cron$ select public.complete_past_bookings() $cron$
  );
end;
$outer$;
