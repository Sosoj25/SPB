-- ============================================================
-- ปิดรูที่การจอง "แนบสลิปแล้วรอแอดมิน" ค้างถาวรและล็อกสนามไว้ตลอดกาล
-- ============================================================
-- รอยต่อของ cron สองตัวที่มีอยู่เดิมเปิดช่องไว้ตรงนี้:
--
--   expire_unpaid_bookings(10)  ล้างเฉพาะ payment_status = 'unpaid'
--   complete_past_bookings()    กวาดเฉพาะ status = 'confirmed' + จ่ายแล้ว
--
-- แต่ submit_bank_transfer_payment() ดัน payment_status เป็น 'pending' ทันที
-- ที่ผู้ใช้แนบสลิป การจองใบนั้นจึงหลุดจากตะแกรงทั้งสองอัน ไม่มีวันหมดอายุ
-- และ facility_slots() นับ slot ว่าถูกจองแล้วเมื่อมี booking ที่
-- status in ('pending','confirmed') ทับอยู่ — สนามช่วงนั้นเลยถูกล็อกค้าง
-- จนกว่าแอดมินจะเข้ามากดเอง
--
-- ตอนเขียน migration นี้มีของค้างจริงในฐาน 3 ใบ สองใบวันเล่นผ่านไปตั้งแต่
-- ต้นเดือนแต่ยังเป็น 'pending' อยู่ กินทั้ง slot ทั้งคิวตรวจสลิปของแอดมิน
--
-- ------------------------------------------------------------
-- ทำไมถึงกวาดเฉพาะใบที่ "เลยเวลาใช้สนามไปแล้ว"
-- ------------------------------------------------------------
-- เพราะคนที่แนบสลิปมาอาจโอนเงินมาจริง ๆ การตั้งเวลาถอยหลังแล้วยกเลิกใบที่ยัง
-- ไม่ถึงวันเล่นทิ้งไปเฉย ๆ เท่ากับยกเลิกการจองที่จ่ายเงินแล้ว ซึ่งแย่กว่าปัญหา
-- เดิมมาก ใบที่เลยเวลาไปแล้วต่างออกไป — slot นั้นหมดค่าไปแล้วแน่นอน การปล่อย
-- ให้ค้างเป็น 'pending' ต่อมีแต่ทำให้รายงานเพี้ยนกับคิวแอดมินรก
--
-- ส่วนใบที่ยังไม่ถึงวันเล่นแก้ด้วยอีกทางคือ notify_admins_stale_slips()
-- ข้างล่าง — เตือนแอดมินว่ามีสลิปค้างตรวจ แทนที่จะปล่อยให้เน่าเงียบ ๆ
-- ============================================================

create or replace function public.sweep_stale_slip_bookings(p_grace_hours integer default 2)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if p_grace_hours < 0 then
    raise exception 'ช่วงผ่อนผันต้องไม่ติดลบ';
  end if;

  -- เลือกใบที่เข้าเงื่อนไขมาก่อนแล้วค่อยแก้ทีละขั้น ไม่รวบเป็น CTE ก้อนเดียว
  -- เพราะต้องเขียนตาราง bookings สองอย่าง (status กับ payment_status) การมี
  -- data-modifying CTE สองตัวแตะตารางเดียวกันในคำสั่งเดียว Postgres ไม่รับรอง
  -- ผลลัพธ์ เขียนแยกเป็นคำสั่งตามลำดับชัดเจนกว่าและถูกต้องแน่นอน
  --
  -- skip locked เพื่อไม่ไปแย่ง lock กับแอดมินที่กำลังกดอนุมัติใบเดียวกันพอดี
  -- รอบนี้ข้ามไป รอบหน้าอีกชั่วโมงค่อยมาเก็บ ไม่มีอะไรเสียหาย
  select array_agg(t.id) into v_ids
  from (
    select b.id
    from public.bookings b
    where b.status         = 'pending'
      and b.payment_status = 'pending'
      and (b.booking_date + b.end_time)
            < ((now() at time zone 'Asia/Bangkok') - make_interval(hours => p_grace_hours))
    for update skip locked
  ) t;

  if v_ids is null then
    return 0;
  end if;

  -- ต้องเปิด booking_engine เอง — pg_cron รันในฐานะ postgres ไม่มี JWT
  -- auth.role() จึงไม่ใช่ 'service_role' และ is_admin() ก็เป็น false
  -- protect_booking_privileged_columns จะบล็อกการแก้ status ถ้าไม่ตั้งค่านี้
  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set status         = 'cancelled',
      payment_status = 'rejected',
      cancelled_at   = now(),
      cancel_reason  = 'ระบบยกเลิกอัตโนมัติ — แนบสลิปไว้แต่ไม่ได้รับการตรวจสอบจนเลยเวลาใช้สนาม'
  where id = any(v_ids);

  perform set_config('app.booking_engine', 'off', true);

  -- ปิดแถว payments ที่ค้างคู่กันด้วย ไม่งั้นยอด "รอตรวจสอบ" บนหน้าแอดมิน
  -- จะนับใบที่ยกเลิกไปแล้วรวมอยู่ตลอดไป
  update public.payments
  set status           = 'rejected',
      verified_at      = now(),
      rejection_reason = 'ยกเลิกอัตโนมัติ — เลยเวลาใช้สนามโดยที่สลิปยังไม่ได้ตรวจสอบ'
  where booking_id = any(v_ids)
    and status     = 'pending';

  insert into public.notifications
    (user_id, type, title, message, reference_type, reference_id)
  select
    b.user_id,
    'payment_rejected',
    'การจองถูกยกเลิกอัตโนมัติ',
    format(
      'การจอง %s ถูกยกเลิกเพราะเลยเวลาใช้สนามไปแล้วโดยที่สลิปยังไม่ได้รับ'
      || 'การตรวจสอบ หากคุณโอนเงินไปแล้วจริง กรุณาติดต่อเจ้าหน้าที่เพื่อขอคืนเงิน',
      b.booking_code
    ),
    'booking',
    b.id::text
  from public.bookings b
  where b.id = any(v_ids);

  return array_length(v_ids, 1);
end;
$$;

-- cron เรียกเท่านั้น ไม่มีเหตุให้หน้าเว็บยิงถึง
revoke all on function public.sweep_stale_slip_bookings(integer) from public, anon, authenticated;
grant execute on function public.sweep_stale_slip_bookings(integer) to service_role;


-- ============================================================
-- เตือนแอดมินว่ามีสลิปค้างตรวจ — กันไม่ให้คิวเน่าเงียบ ๆ
-- ============================================================
-- ส่งเป็น "สรุปรวมวันละครั้ง" ไม่ใช่ใบละหนึ่งการแจ้งเตือน เพราะถ้าแยกใบจะกลาย
-- เป็นสแปมซ้ำทุกวันจนแอดมินเลิกอ่าน และไม่ส่งเลยถ้าไม่มีใบไหนค้างเกินกำหนด
create or replace function public.notify_admins_stale_slips(p_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending integer;
  v_oldest  timestamptz;
  v_sent    integer;
begin
  select count(*), min(p.created_at)
  into v_pending, v_oldest
  from public.payments p
  join public.bookings b on b.id = p.booking_id
  where p.status  = 'pending'
    and p.gateway = 'manual'
    and b.status  = 'pending'
    and p.created_at < now() - make_interval(hours => p_hours);

  if coalesce(v_pending, 0) = 0 then
    return 0;
  end if;

  with sent as (
    insert into public.notifications
      (user_id, type, title, message, reference_type, reference_id)
    select
      pr.id,
      'payment_pending_review',
      'มีสลิปรอตรวจสอบค้างอยู่',
      format(
        'มีสลิปการโอนเงิน %s รายการที่รอตรวจสอบนานเกิน %s ชั่วโมง '
        || 'รายการที่เก่าสุดค้างมาตั้งแต่ %s — ช่วงเวลาสนามของรายการเหล่านี้ถูกล็อกไว้อยู่',
        v_pending,
        p_hours,
        to_char(v_oldest at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')
      ),
      'admin_payments',
      null
    from public.profiles pr
    where pr.role in ('admin', 'super_admin')
      and pr.is_active
      -- ส่งซ้ำไม่เกินวันละครั้งต่อแอดมินหนึ่งคน
      and not exists (
        select 1
        from public.notifications n
        where n.user_id = pr.id
          and n.type    = 'payment_pending_review'
          and n.created_at > now() - interval '20 hours'
      )
    returning 1
  )
  select count(*)::integer into v_sent from sent;

  return v_sent;
end;
$$;

revoke all on function public.notify_admins_stale_slips(integer) from public, anon, authenticated;
grant execute on function public.notify_admins_stale_slips(integer) to service_role;


-- ============================================================
-- ตั้งเวลาให้ทั้งสองตัว
-- ============================================================
-- กวาดทุกชั่วโมงที่นาทีที่ 17 — เลี่ยงไม่ให้ชนกับ complete_past_bookings
-- (นาทีที่ 7) และ expire_unpaid_bookings (ทุก 5 นาที) ที่แย่ง lock แถวเดียวกัน
select cron.schedule(
  'sweep-stale-slip-bookings',
  '17 * * * *',
  $cron$ select public.sweep_stale_slip_bookings(2) $cron$
);

-- เตือนแอดมินวันละครั้งตอน 9 โมงเช้าไทย (02:00 UTC) — เวลาที่คนน่าจะเปิดดู
select cron.schedule(
  'notify-admins-stale-slips',
  '0 2 * * *',
  $cron$ select public.notify_admins_stale_slips(24) $cron$
);
