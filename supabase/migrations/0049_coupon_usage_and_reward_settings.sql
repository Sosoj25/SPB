-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0048).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ทำให้คูปองที่แลกไปแล้ว "ใช้ได้จริง" + ให้แอดมินคุมอัตราแต้มเอง
-- ============================================================
--
-- 0047 ทำให้แลกรางวัลได้ แต่คูปองที่ได้มาเป็นแค่รหัสที่ไม่มีใครรับ — "ส่วนลด
-- 50 บาท" แลกแล้วก็จบตรงนั้น ไม่มีหน้าไหนเอาไปลดราคาได้ และสถานะ "ใช้แล้ว"
-- ที่หน้าประวัติต้องแสดง ไปถึงได้เฉพาะของที่ต้องจัดส่งเท่านั้น
--
-- คำอธิบายของรางวัลที่ seed ไว้ใน 0047 บอกวิธีใช้ไว้เองอยู่แล้ว:
--   "จองผ่านแอปตามปกติแล้วเลือกใช้คูปองนี้ตอนชำระเงิน"
-- ไฟล์นี้ทำให้ประโยคนั้นเป็นจริง
--
-- ไฟล์นี้ยังเก็บงานที่ค้างจาก 0047 อีกสามเรื่อง:
--   - อัตราแต้มเคยเป็นค่าคงที่ในโค้ด ตอนนี้ย้ายมาอยู่ในตารางที่แอดมินแก้ได้
--   - ลำดับล็อกที่กลับด้านกันระหว่าง redeem_reward กับ admin_cancel_redemption
--   - แต้มพังทีเดียวแล้วทำให้ cron ปิดงานการจองพังทั้งรอบ


-- ============================================================
-- 1. ตั้งค่าระบบแต้ม (แอดมินแก้เองได้)
-- ============================================================
-- แถวเดียวตายตัว (id = 1) เหมือน refund_policy_settings ใน 0033 — ไม่ต้องมี
-- ตรรกะ "เอาแถวไหน" กระจายอยู่ตามหน้าเว็บ
--
-- อ่านได้ทุกคนรวมทั้งคนที่ยังไม่ล็อกอิน เพราะหน้า "วิธีสะสมแต้ม" ต้องบอก
-- อัตราจริงให้ลูกค้าเห็น ไม่ใช่ตัวเลขที่ฮาร์ดโค้ดไว้ในหน้าเว็บแล้วลืมแก้ตาม

create table if not exists public.reward_settings (
    id smallint primary key default 1,
    baht_per_point integer not null default 10,
    earning_enabled boolean not null default true,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id) on delete set null,

    constraint reward_settings_singleton check (id = 1),

    -- เพดานบนกันพิมพ์ผิดแล้วแจกแต้มมหาศาล (เช่นตั้ง 0 แล้วหารด้วยศูนย์
    -- หรือติดลบแล้วแต้มไหลกลับ)
    constraint reward_settings_rate_check
        check (baht_per_point between 1 and 100000)
);

insert into public.reward_settings (id) values (1) on conflict (id) do nothing;

alter table public.reward_settings enable row level security;

drop policy if exists "reward_settings_public_read" on public.reward_settings;
create policy "reward_settings_public_read"
on public.reward_settings
for select
to anon, authenticated
using (true);

drop policy if exists "reward_settings_admin_write" on public.reward_settings;
create policy "reward_settings_admin_write"
on public.reward_settings
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- ไม่เปิด insert/delete ให้ใครเลย — แถวเดียวนี้มีอยู่แล้วและต้องมีอยู่ตลอด
revoke all on public.reward_settings from anon, authenticated;
grant select on public.reward_settings to anon, authenticated;
grant update on public.reward_settings to authenticated;

drop trigger if exists trg_reward_settings_updated_at on public.reward_settings;
create trigger trg_reward_settings_updated_at
before update on public.reward_settings
for each row execute function public.set_updated_at();


-- ============================================================
-- 2. ของรางวัลให้สิทธิประโยชน์อะไร
-- ============================================================
-- 0047 เก็บแค่ "ชื่อ + คำอธิบาย" ซึ่งพอสำหรับการแสดงผล แต่ไม่พอให้ระบบรู้ว่า
-- คูปองใบนี้ควรลดเงินเท่าไร — "ส่วนลด 50 บาท" กับ "ส่วนลด 100 บาท" ต่างกัน
-- แค่ตัวอักษรในชื่อ ซึ่งเอาไปคำนวณไม่ได้
--
--   none          = คูปองเชิงสัญลักษณ์/ของจริง แอดมินตัดให้เองหน้างาน
--   discount_baht = ลดตรง ๆ ตามจำนวนบาทใน benefit_value
--   free_hours    = ลดเท่ากับค่าสนาม benefit_value ชั่วโมงของการจองใบนั้น
--
-- free_hours คิดจากราคาจริงของการจองใบนั้น ไม่ใช่ราคากลาง เพราะสนามแต่ละแห่ง
-- และแต่ละช่วงเวลาราคาไม่เท่ากัน (ดู compute_facility_price ใน 0024)

do $$
begin
  if not exists (select 1 from pg_type where typname = 'reward_benefit_type') then
    create type public.reward_benefit_type as enum ('none', 'discount_baht', 'free_hours');
  end if;
end;
$$;

alter table public.rewards
  add column if not exists benefit_type public.reward_benefit_type not null default 'none',
  add column if not exists benefit_value numeric(10, 2) not null default 0,
  add column if not exists per_user_limit integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rewards_benefit_value_check') then
    alter table public.rewards
      add constraint rewards_benefit_value_check check (benefit_value >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'rewards_per_user_limit_check') then
    alter table public.rewards
      add constraint rewards_per_user_limit_check
      check (per_user_limit is null or per_user_limit > 0);
  end if;
end;
$$;

-- ผูกสิทธิประโยชน์ให้ของที่ seed ไว้ใน 0047 — จับจากชื่อครั้งเดียวตอนอัปเกรด
-- แล้วจากนี้ไปแอดมินตั้งเองจากหน้าจัดการรางวัล
update public.rewards set benefit_type = 'discount_baht', benefit_value = 50
where name = 'ส่วนลด 50 บาท' and benefit_type = 'none';

update public.rewards set benefit_type = 'discount_baht', benefit_value = 100
where name = 'ส่วนลด 100 บาท' and benefit_type = 'none';

update public.rewards set benefit_type = 'free_hours', benefit_value = 1
where name = 'ชั่วโมงเล่นฟรี 1 ชม.' and benefit_type = 'none';

-- ของจริงจำกัดคนละ 1 ชิ้น ไม่งั้นคนที่มีแต้มเยอะกวาดสต๊อกไปคนเดียวได้ในนาทีเดียว
update public.rewards set per_user_limit = 1
where requires_shipping and per_user_limit is null;


-- ============================================================
-- 3. คอลัมน์คูปองบนตาราง bookings
-- ============================================================
-- original_amount เก็บยอดก่อนหักคูปองไว้ เพื่อถอดคูปองแล้วคืนยอดเดิมได้ตรง ๆ
-- โดยไม่ต้องเรียก compute_facility_price ซ้ำ (ซึ่งอาจให้คนละราคาถ้าแอดมิน
-- แก้ตารางราคาระหว่างนั้น — ลูกค้าต้องได้ราคาที่ตกลงกันไว้ตอนกดจอง)

alter table public.bookings
  add column if not exists redemption_id uuid
      references public.reward_redemptions(id) on delete set null,
  add column if not exists discount_amount numeric(10, 2) not null default 0,
  add column if not exists original_amount numeric(10, 2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_discount_check') then
    alter table public.bookings
      add constraint bookings_discount_check check (discount_amount >= 0);
  end if;
end;
$$;

-- คูปองหนึ่งใบผูกได้กับการจองที่ยัง "มีชีวิต" ใบเดียวเท่านั้น
--
-- กรอง status ออกด้วย เพราะการจองที่ถูกยกเลิก/หมดเวลาไปแล้วยังเก็บ
-- redemption_id ไว้เป็นประวัติ ถ้าไม่กรอง คูปองที่ถูกปล่อยกลับมาแล้วจะเอาไป
-- ใช้กับการจองใบใหม่ไม่ได้ เพราะติด unique กับใบเก่าที่ตายไปแล้ว
create unique index if not exists idx_bookings_active_redemption
on public.bookings(redemption_id)
where redemption_id is not null and status in ('pending', 'confirmed', 'completed');


-- ============================================================
-- 4. คูปองที่ใช้กับการจองได้ (view)
-- ============================================================
-- "ใช้ได้" = เป็นของเรา ยังไม่ถูกใช้ ยังไม่หมดอายุ ยังไม่ถูกยกเลิก ให้ส่วนลด
-- ได้จริง และยังไม่ถูกจองไว้กับการจองใบอื่นที่ยังมีชีวิตอยู่
--
-- security_invoker = on → redemptions_select_own (0000) กันไม่ให้เห็นคูปอง
-- ของคนอื่นอยู่แล้ว ไม่ต้องเช็ค user_id ซ้ำในตัว view

create or replace view public.usable_coupons
with (security_invoker = on) as
select
  rr.id,
  rr.user_id,
  rr.redemption_code,
  rr.expires_at,
  rr.created_at,
  r.name          as reward_name,
  r.category      as reward_category,
  r.benefit_type,
  r.benefit_value
from public.reward_redemptions rr
join public.rewards r on r.id = rr.reward_id
where rr.status = 'pending'
  and r.benefit_type <> 'none'
  and (rr.expires_at is null or rr.expires_at > now())
  and not exists (
    select 1 from public.bookings b
    where b.redemption_id = rr.id
      and b.status in ('pending', 'confirmed', 'completed')
  );

revoke all on public.usable_coupons from anon, authenticated;
grant select on public.usable_coupons to authenticated;


-- ============================================================
-- 5. ใช้คูปองกับการจอง
-- ============================================================
-- ใช้ได้เฉพาะตอนที่การจองยังไม่ได้จ่ายเงิน และยังไม่มีรายการชำระเงินค้างอยู่ —
-- ถ้ามี QR ที่สร้างไปแล้ว ยอดบน QR จะไม่ตรงกับยอดใหม่ และตัวกระทบยอด
-- (reconcile-plernpay-payments) จะจับคู่เงินเข้าไม่ได้
--
-- ไม่ mark คูปองว่า "ใช้แล้ว" ตรงนี้ — แค่จองไว้ ตัวที่เปลี่ยนสถานะจริงคือ
-- trigger ตอนเงินเข้า (ข้อ 7) ถ้าลูกค้าไม่จ่ายจนการจองหมดเวลา คูปองกลับมา
-- ใช้ได้เองโดยไม่ต้องมีใครไปตามคืน

create or replace function public.apply_booking_coupon(
  p_booking_id uuid,
  p_code       text
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user     uuid := auth.uid();
  v_booking  public.bookings;
  v_coupon   public.reward_redemptions;
  v_reward   public.rewards;
  v_base     numeric(10, 2);
  v_hours    numeric;
  v_discount numeric(10, 2);
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อน';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found or v_booking.user_id <> v_user then
    raise exception 'ไม่พบการจองนี้';
  end if;

  if v_booking.redemption_id is not null then
    raise exception 'การจองนี้ใช้คูปองไปแล้ว ถ้าต้องการเปลี่ยนให้นำคูปองเดิมออกก่อน';
  end if;

  if v_booking.status <> 'pending' or v_booking.payment_status <> 'unpaid' then
    raise exception 'ใช้คูปองได้เฉพาะการจองที่ยังไม่ได้ชำระเงินเท่านั้น';
  end if;

  if exists (
    select 1 from public.payments
    where booking_id = p_booking_id
      and status in ('pending', 'paid', 'approved')
  ) then
    raise exception 'มีรายการชำระเงินค้างอยู่ กรุณายกเลิก QR หรือสลิปเดิมก่อนใช้คูปอง';
  end if;

  select * into v_coupon
  from public.reward_redemptions
  where upper(redemption_code) = upper(btrim(coalesce(p_code, '')))
  for update;

  if not found or v_coupon.user_id <> v_user then
    raise exception 'ไม่พบคูปองนี้ในบัญชีของคุณ';
  end if;

  if v_coupon.status = 'cancelled' then
    raise exception 'คูปองใบนี้ถูกยกเลิกไปแล้ว';
  end if;

  if v_coupon.status = 'completed' then
    raise exception 'คูปองใบนี้ถูกใช้ไปแล้ว';
  end if;

  if v_coupon.expires_at is not null and v_coupon.expires_at < now() then
    raise exception 'คูปองใบนี้หมดอายุแล้วเมื่อ %',
      to_char(v_coupon.expires_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY');
  end if;

  if exists (
    select 1 from public.bookings b
    where b.redemption_id = v_coupon.id
      and b.status in ('pending', 'confirmed', 'completed')
  ) then
    raise exception 'คูปองใบนี้ถูกใช้กับการจองอื่นอยู่';
  end if;

  select * into v_reward from public.rewards where id = v_coupon.reward_id;

  if v_reward.benefit_type = 'none' then
    raise exception 'คูปอง "%s" ใช้ลดค่าสนามไม่ได้ ต้องติดต่อเจ้าหน้าที่ที่สนาม', v_reward.name;
  end if;

  -- ยอดตั้งต้นคือยอดก่อนหักคูปองเสมอ ไม่ใช่ยอดปัจจุบัน — กันกรณีถอดแล้วใส่ใหม่
  -- ซ้ำ ๆ จนส่วนลดถูกหักทบไปเรื่อย ๆ
  v_base := coalesce(v_booking.original_amount, v_booking.total_amount);

  if v_reward.benefit_type = 'discount_baht' then
    v_discount := least(v_reward.benefit_value, v_base);
  else
    v_hours := extract(epoch from (v_booking.end_time - v_booking.start_time)) / 3600.0;

    if v_hours is null or v_hours <= 0 then
      raise exception 'การจองนี้ไม่มีช่วงเวลาที่คิดเป็นชั่วโมงได้';
    end if;

    v_discount := least(round(v_base / v_hours * v_reward.benefit_value, 2), v_base);
  end if;

  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set original_amount = v_base,
      discount_amount = v_discount,
      total_amount    = v_base - v_discount,
      -- มัดจำต้องไม่เกินยอดที่ต้องจ่ายจริง ไม่งั้นหน้าชำระเงินจะขอเก็บมัดจำ
      -- มากกว่ายอดเต็มของการจองที่ลดราคาแล้ว
      deposit_amount  = least(deposit_amount, v_base - v_discount),
      redemption_id   = v_coupon.id
  where id = p_booking_id
  returning * into v_booking;

  perform set_config('app.booking_engine', 'off', true);

  return v_booking;
end;
$fn$;

revoke all on function public.apply_booking_coupon(uuid, text) from public, anon;
grant execute on function public.apply_booking_coupon(uuid, text) to authenticated;


-- ============================================================
-- 6. นำคูปองออกจากการจอง
-- ============================================================

create or replace function public.remove_booking_coupon(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user    uuid := auth.uid();
  v_booking public.bookings;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อน';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found or v_booking.user_id <> v_user then
    raise exception 'ไม่พบการจองนี้';
  end if;

  if v_booking.redemption_id is null then
    return v_booking;
  end if;

  if v_booking.status <> 'pending' or v_booking.payment_status <> 'unpaid' then
    raise exception 'นำคูปองออกได้เฉพาะการจองที่ยังไม่ได้ชำระเงินเท่านั้น';
  end if;

  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set total_amount    = coalesce(original_amount, total_amount),
      discount_amount = 0,
      original_amount = null,
      redemption_id   = null
  where id = p_booking_id
  returning * into v_booking;

  perform set_config('app.booking_engine', 'off', true);

  return v_booking;
end;
$fn$;

revoke all on function public.remove_booking_coupon(uuid) from public, anon;
grant execute on function public.remove_booking_coupon(uuid) to authenticated;


-- ============================================================
-- 7. ตัดคูปองอัตโนมัติเมื่อเงินเข้า
-- ============================================================
-- ผูกกับสถานะการจ่ายเงินของการจอง ไม่ใช่ปุ่มที่ใครต้องกด — เงินเข้าได้หลายทาง
-- (QR ตัดเอง / แอดมินอนุมัติสลิป / ตัวกระทบยอดของ PlernPay) ถ้าให้แต่ละทาง
-- ตัดคูปองเอง จะมีสักทางที่ลืม แล้วคูปองใบนั้นจะถูกใช้ซ้ำได้
--
-- trigger นี้แตะเฉพาะตาราง reward_redemptions ไม่เขียนกลับลง bookings จึงไม่มี
-- โอกาสวนเรียกตัวเอง

create or replace function public.consume_booking_coupon()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_place text;
begin
  if new.redemption_id is null then
    return new;
  end if;

  if new.payment_status not in ('paid', 'approved') then
    return new;
  end if;

  if old.payment_status in ('paid', 'approved') then
    return new;
  end if;

  select f.name into v_place
  from public.facilities f
  where f.id = new.facility_id;

  update public.reward_redemptions
  set status    = 'completed',
      used_at   = coalesce(used_at, now()),
      used_note = coalesce(
        used_note,
        format('ใช้กับการจอง %s%s', new.booking_code, coalesce(' · ' || v_place, ''))
      )
  where id = new.redemption_id
    and status = 'pending';

  return new;
end;
$fn$;

revoke all on function public.consume_booking_coupon() from public, anon, authenticated;

drop trigger if exists trg_consume_booking_coupon on public.bookings;
create trigger trg_consume_booking_coupon
after update of payment_status on public.bookings
for each row execute function public.consume_booking_coupon();


-- ============================================================
-- 8. แก้ลำดับล็อกที่กลับด้านกัน (deadlock)
-- ============================================================
-- redeem_reward ล็อก rewards ก่อนแล้วค่อยขอ profiles (ผ่าน apply_point_change)
-- ส่วน admin_cancel_redemption เดิมขอ profiles ก่อนแล้วค่อยเขียน rewards —
-- ถ้าลูกค้ากดแลกพร้อมกับแอดมินกดยกเลิกบนรางวัลชิ้นเดียวกัน สองฝั่งจะถือล็อก
-- ที่อีกฝั่งรออยู่ Postgres จะฆ่าอันหนึ่งทิ้งด้วย deadlock error ภาษาอังกฤษ
-- ซึ่ง errorMessage() กลืนเป็น "เกิดข้อผิดพลาด" ผู้ใช้ไม่รู้เลยว่าเกิดอะไร
--
-- แก้โดยให้ทุกเส้นทางล็อกเรียงเหมือนกันหมด: rewards ก่อน แล้วค่อย profiles

create or replace function public.admin_cancel_redemption(
  p_id     uuid,
  p_reason text default null
)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row    public.reward_redemptions;
  v_reward public.rewards;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select * into v_row
  from public.reward_redemptions
  where id = p_id
  for update;

  if not found then
    raise exception 'ไม่พบคำขอแลกรางวัลนี้';
  end if;

  if v_row.status = 'cancelled' then
    return v_row;
  end if;

  -- ล็อกแถวรางวัลก่อนแตะแต้ม ให้ลำดับตรงกับ redeem_reward
  select * into v_reward
  from public.rewards
  where id = v_row.reward_id
  for update;

  update public.reward_redemptions
  set status        = 'cancelled',
      cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_id
  returning * into v_row;

  perform public.apply_point_change(
    v_row.user_id,
    v_row.points_used,
    'adjustment',
    'reward',
    v_row.reward_id::text,
    format('คืนแต้มจากการยกเลิก "%s"', v_reward.name)
  );

  if v_reward.track_stock then
    update public.rewards set stock = stock + 1 where id = v_reward.id;
  end if;

  insert into public.notifications
    (user_id, type, title, message, reference_type, reference_id)
  values (
    v_row.user_id,
    'reward_cancelled',
    'คำขอแลกรางวัลถูกยกเลิก',
    format(
      'คำขอ "%s" (%s) ถูกยกเลิก%s คืน %s แต้มเข้าบัญชีของคุณแล้ว',
      v_reward.name,
      v_row.redemption_code,
      coalesce(' เหตุผล: ' || v_row.cancel_reason, ''),
      to_char(v_row.points_used, 'FM999,999,990')
    ),
    'redemption',
    v_row.id::text
  );

  return v_row;
end;
$fn$;

revoke all on function public.admin_cancel_redemption(uuid, text) from public, anon;
grant execute on function public.admin_cancel_redemption(uuid, text) to authenticated, service_role;


-- ============================================================
-- 9. เพดานการแลกต่อคน
-- ============================================================
-- 0047 มีแต่เพดานรวม (สต๊อก/โควตาเดือน) คนที่มีแต้มเยอะจึงกวาดของทั้งล็อต
-- ไปคนเดียวได้ในนาทีเดียว — นับเฉพาะใบที่ยังไม่ถูกยกเลิก ใบที่แอดมินยกเลิก
-- และคืนแต้มให้แล้วไม่ควรนับกินโควตาของลูกค้า

create or replace function public.redeem_reward(
  p_reward_id       bigint,
  p_option          text default null,
  p_delivery_method text default null,
  p_recipient_name  text default null,
  p_phone           text default null,
  p_address         text default null
)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user       uuid := auth.uid();
  v_reward     public.rewards;
  v_remaining  integer;
  v_limit_type text;
  v_mine       integer;
  v_option     text := nullif(btrim(coalesce(p_option, '')), '');
  v_method     text := nullif(btrim(coalesce(p_delivery_method, '')), '');
  v_code       text;
  v_row        public.reward_redemptions;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนแลกรางวัล';
  end if;

  select * into v_reward
  from public.rewards
  where id = p_reward_id
  for update;

  if not found then
    raise exception 'ไม่พบของรางวัลนี้';
  end if;

  if not v_reward.is_active then
    raise exception 'ของรางวัลนี้ปิดการแลกอยู่';
  end if;

  select remaining, limit_type into v_remaining, v_limit_type
  from public.reward_catalog
  where id = p_reward_id;

  if v_remaining is not null and v_remaining <= 0 then
    if v_limit_type = 'quota' then
      raise exception 'ของรางวัลนี้เต็มโควตาของเดือนนี้แล้ว ลองใหม่เดือนหน้า';
    else
      raise exception 'ของรางวัลนี้หมดสต๊อกแล้ว';
    end if;
  end if;

  if v_reward.per_user_limit is not null then
    select count(*) into v_mine
    from public.reward_redemptions
    where user_id = v_user
      and reward_id = p_reward_id
      and status <> 'cancelled';

    if v_mine >= v_reward.per_user_limit then
      raise exception 'ของรางวัลนี้จำกัด % ชิ้นต่อคน คุณแลกครบแล้ว',
        v_reward.per_user_limit;
    end if;
  end if;

  if array_length(v_reward.options, 1) is not null then
    if v_option is null then
      raise exception 'กรุณาเลือกตัวเลือกของรางวัลก่อน';
    end if;

    if not (v_option = any (v_reward.options)) then
      raise exception 'ตัวเลือก "%" ไม่มีให้เลือกสำหรับของรางวัลนี้', v_option;
    end if;
  else
    v_option := null;
  end if;

  if v_reward.requires_shipping then
    if v_method is null or v_method not in ('ship', 'pickup') then
      raise exception 'กรุณาเลือกวิธีรับของรางวัล';
    end if;

    if v_method = 'ship' then
      if nullif(btrim(coalesce(p_recipient_name, '')), '') is null
         or nullif(btrim(coalesce(p_phone, '')), '')   is null
         or nullif(btrim(coalesce(p_address, '')), '') is null
      then
        raise exception 'กรุณากรอกชื่อผู้รับ เบอร์โทร และที่อยู่จัดส่งให้ครบ';
      end if;
    end if;
  else
    v_method := null;
  end if;

  loop
    v_code := 'SPB-RW-' || lpad((floor(random() * 100000))::int::text, 5, '0');
    exit when not exists (
      select 1 from public.reward_redemptions where redemption_code = v_code
    );
  end loop;

  perform public.apply_point_change(
    v_user,
    -v_reward.points_required,
    'spent',
    'reward',
    p_reward_id::text,
    format('แลก %s', v_reward.name)
  );

  insert into public.reward_redemptions (
    user_id, reward_id, points_used, status, redemption_code,
    expires_at, option_label, fulfillment_status,
    recipient_name, shipping_phone, shipping_address
  )
  values (
    v_user,
    p_reward_id,
    v_reward.points_required,
    'pending',
    v_code,
    now() + make_interval(days => v_reward.valid_days),
    v_option,
    case
      when not v_reward.requires_shipping then null
      when v_method = 'pickup'            then 'pickup'::public.reward_fulfillment_status
      else                                     'pending'::public.reward_fulfillment_status
    end,
    case when v_method = 'ship' then btrim(p_recipient_name) end,
    case when v_method = 'ship' then btrim(p_phone) end,
    case when v_method = 'ship' then btrim(p_address) end
  )
  returning * into v_row;

  if v_reward.track_stock then
    update public.rewards
    set stock = greatest(stock - 1, 0)
    where id = p_reward_id;
  end if;

  insert into public.notifications
    (user_id, type, title, message, reference_type, reference_id)
  values (
    v_user,
    'reward_redeemed',
    'แลกรางวัลสำเร็จ',
    format(
      'คุณแลก "%s" ด้วย %s แต้มเรียบร้อยแล้ว รหัสคูปอง %s',
      v_reward.name,
      to_char(v_reward.points_required, 'FM999,999,990'),
      v_code
    ),
    'redemption',
    v_row.id::text
  );

  return v_row;
end;
$fn$;

revoke all on function public.redeem_reward(bigint, text, text, text, text, text)
  from public, anon;
grant execute on function public.redeem_reward(bigint, text, text, text, text, text)
  to authenticated, service_role;


-- ============================================================
-- 10. คลังรางวัลเปิดเผยคอลัมน์ใหม่
-- ============================================================

create or replace view public.reward_catalog
with (security_invoker = on) as
select
  r.id,
  r.name,
  r.description,
  r.terms,
  r.points_required,
  r.category,
  r.image_url,
  r.is_active,
  r.stock,
  r.track_stock,
  r.monthly_quota,
  r.valid_days,
  r.requires_shipping,
  r.options,
  r.sort_order,
  r.created_at,
  coalesce(m.redeemed_month, 0)::int as redeemed_month,
  case
    when r.monthly_quota is not null then 'quota'
    when r.track_stock                then 'stock'
    else                                   'unlimited'
  end as limit_type,
  case
    when r.monthly_quota is not null
      then greatest(r.monthly_quota - coalesce(m.redeemed_month, 0), 0)
    when r.track_stock then r.stock
    else null
  end::int as remaining,
  -- คอลัมน์ใหม่ของ 0049 ต้องต่อท้ายสุด — create or replace view แทรกคอลัมน์
  -- กลางลิสต์ไม่ได้ ต้อง drop ทิ้งก่อนซึ่งไม่คุ้มกับการเรียงให้สวย
  r.benefit_type,
  r.benefit_value,
  r.per_user_limit
from public.rewards r
left join lateral (
  select count(*) as redeemed_month
  from public.reward_redemptions rr
  where rr.reward_id = r.id
    and rr.status <> 'cancelled'
    and date_trunc('month', rr.created_at at time zone 'Asia/Bangkok')
      = date_trunc('month', now()      at time zone 'Asia/Bangkok')
) m on true;

revoke all on public.reward_catalog from anon, authenticated;
grant select on public.reward_catalog to anon, authenticated;


-- ============================================================
-- 11. แจกแต้มตามอัตราที่แอดมินตั้ง + ไม่ให้แต้มพังลากงานจองไปด้วย
-- ============================================================
-- 0047 เอาการแจกแต้มยัดเข้าไปในลูปของ complete_past_bookings ตรง ๆ ซึ่งแปลว่า
-- ถ้าการแจกแต้มของ "การจองใบเดียว" พัง ทรานแซกชันทั้งก้อนย้อนกลับ = ไม่มีการ
-- จองใบไหนถูกปิดงานเลยในรอบนั้น และจะพังซ้ำทุกชั่วโมงเงียบ ๆ
--
-- ระบบจองสำคัญกว่าระบบแต้มมาก จึงครอบส่วนแจกแต้มด้วย exception block รายใบ
-- ปิดงานการจองต้องเดินต่อได้เสมอ ส่วนแต้มที่พลาดไปมี point_transactions เป็น
-- ตัวกันซ้ำอยู่แล้ว รอบหน้าจะไม่แจกซ้ำให้ใบที่แจกไปแล้ว
--
-- แต้มคิดจาก total_amount ซึ่งเป็นยอดหลังหักคูปองแล้ว = ลูกค้าได้แต้มตามเงิน
-- ที่จ่ายจริง ไม่ใช่ตามราคาป้าย

create or replace function public.complete_past_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_done      integer := 0;
  v_rate      integer;
  v_enabled   boolean;
  v_booking   record;
  v_points    integer;
begin
  select baht_per_point, earning_enabled into v_rate, v_enabled
  from public.reward_settings where id = 1;

  v_rate    := coalesce(v_rate, 10);
  v_enabled := coalesce(v_enabled, true);

  perform set_config('app.booking_engine', 'on', true);

  for v_booking in
    with done as (
      update public.bookings
      set status = 'completed'
      where status = 'confirmed'
        and payment_status in ('paid', 'approved')
        and (booking_date + end_time) <= (now() at time zone 'Asia/Bangkok')
      returning id, user_id, total_amount
    )
    select id, user_id, total_amount from done
  loop
    v_done := v_done + 1;

    continue when not v_enabled;

    v_points := floor(coalesce(v_booking.total_amount, 0) / v_rate)::int;

    continue when v_points <= 0;

    continue when exists (
      select 1 from public.point_transactions t
      where t.user_id        = v_booking.user_id
        and t.reference_type = 'booking'
        and t.reference_id   = v_booking.id::text
        and t.type           = 'earned'
    );

    begin
      perform public.apply_point_change(
        v_booking.user_id,
        v_points,
        'earned',
        'booking',
        v_booking.id::text,
        'แต้มสะสมจากการใช้บริการสนาม'
      );

      insert into public.notifications
        (user_id, type, title, message, reference_type, reference_id)
      values (
        v_booking.user_id,
        'points_earned',
        format('ได้รับ %s แต้ม', to_char(v_points, 'FM999,999,990')),
        format(
          'ขอบคุณที่ใช้บริการ คุณได้รับ %s แต้มสะสมจากการจองนี้ นำไปแลกของรางวัลได้เลย',
          to_char(v_points, 'FM999,999,990')
        ),
        'booking',
        v_booking.id::text
      );
    exception
      when others then
        -- ไม่ re-raise: การปิดงานการจองต้องรอด แต้มใบนี้ไปต่อรอบหน้า
        raise warning 'แจกแต้มให้การจอง % ไม่สำเร็จ: %', v_booking.id, sqlerrm;
    end;
  end loop;

  perform set_config('app.booking_engine', 'off', true);

  return v_done;
end;
$fn$;

revoke all on function public.complete_past_bookings() from public, anon, authenticated;
