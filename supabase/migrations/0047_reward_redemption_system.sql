-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0046).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ระบบแลกรางวัลด้วยแต้มสะสม
-- ============================================================
--
-- ตาราง rewards / reward_redemptions / point_transactions กับคอลัมน์
-- profiles.points มีมาตั้งแต่ 0000 แล้ว พร้อม RLS ครบ แต่ไม่เคยมีอะไรเขียน
-- ลงไปเลยสักแถว — ไม่มี UI ไหนอ่าน ไม่มี RPC ไหนเขียน และที่สำคัญกว่านั้น
-- คือ "ไม่มีทางได้แต้มมาตั้งแต่แรก" เพราะไม่มีโค้ดตรงไหนเพิ่ม points ให้ใคร
-- เมนู "แลกรางวัล" ใน AppHeader.jsx จึงชี้กลับไปที่ /home มาตลอด
--
-- ไฟล์นี้เติมสามส่วนที่ขาด:
--   1) ฝั่ง "ได้แต้ม"  — complete_past_bookings() แจกแต้มตอนปิดงานการจอง
--   2) ฝั่ง "ใช้แต้ม"  — redeem_reward() ตัดแต้ม ออกคูปอง ตัดสต๊อก
--   3) ฝั่งแอดมิน      — จัดการคลังรางวัล และจัดส่งของรางวัลที่เป็นของจริง
--
-- คอลัมน์ที่เพิ่มเข้า rewards/reward_redemptions ทั้งหมดมาจากสิ่งที่แบบใน
-- Figma แสดงจริง (หมวดหมู่, โควตาต่อเดือน, อายุคูปอง, เงื่อนไข, ไซซ์,
-- ที่อยู่จัดส่ง, เลขพัสดุ) ไม่ได้เผื่อไว้ล่วงหน้า


-- ============================================================
-- 1. ชนิดข้อมูลใหม่
-- ============================================================
-- redemption_status เดิม (pending/completed/cancelled) ใช้ต่อได้ตรง ๆ โดยไม่
-- ต้องเพิ่มค่า เพราะสามสถานะที่หน้าประวัติต้องแสดงแมปลงตัวพอดี:
--   ยังไม่ได้ใช้ = pending + ยังไม่เลยวันหมดอายุ
--   ใช้แล้ว     = completed
--   หมดอายุ     = pending + เลยวันหมดอายุแล้ว   (คำนวณจาก expires_at ไม่เก็บซ้ำ)
-- ส่วน cancelled ใช้ตอนแอดมินยกเลิกคำขอแล้วคืนแต้มให้
--
-- สถานะการจัดส่งเป็นคนละแกนกัน (ของชิ้นเดียวกันเป็น "ยังไม่ได้ใช้" และ
-- "กำลังจัดส่ง" พร้อมกันได้) จึงต้องแยกเป็น enum ของตัวเอง ไม่ยัดรวมกัน

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'reward_category'
  ) then
    create type public.reward_category as enum (
      'discount',     -- ส่วนลดค่าสนาม
      'merchandise',  -- ของรางวัล (ของจริง ต้องจัดส่ง)
      'privilege'     -- สิทธิพิเศษ
    );
  end if;

  if not exists (
    select 1 from pg_type where typname = 'reward_fulfillment_status'
  ) then
    create type public.reward_fulfillment_status as enum (
      'pending',   -- รอจัดส่ง
      'shipping',  -- กำลังจัดส่ง
      'shipped',   -- จัดส่งแล้ว / ส่งมอบแล้ว
      'pickup'     -- นัดรับที่สนาม (รอลูกค้ามารับ)
    );
  end if;
end;
$$;


-- ============================================================
-- 2. คอลัมน์เพิ่มของตาราง rewards
-- ============================================================
-- monthly_quota กับ track_stock เป็นเพดานคนละแบบ และรางวัลหนึ่งใช้ได้อย่างมาก
-- อย่างเดียว (แบบในหน้า admin: เสื้อโชว์ "เหลือ 3 / 50" ซึ่งเป็นจำนวนชิ้นจริง
-- ส่วนชั่วโมงเล่นฟรีโชว์ "เหลือ 8 / 40" ซึ่งเป็นสิทธิ์ต่อเดือน และส่วนลดโชว์
-- "ไม่จำกัด" คือไม่ตั้งเพดานอะไรเลย)
--
-- ต้องมี track_stock แยกต่างหากเพราะ stock เป็น NOT NULL default 0 มาแต่เดิม
-- ถ้าอ่าน stock ตรง ๆ รางวัลที่ไม่ได้ตั้งใจจำกัดจำนวนจะกลายเป็น "หมดสต๊อก"
-- ตั้งแต่วินาทีที่สร้างขึ้นมา

alter table public.rewards
  add column if not exists category public.reward_category not null default 'discount',
  add column if not exists monthly_quota integer,
  add column if not exists track_stock boolean not null default false,
  add column if not exists valid_days integer not null default 90,
  add column if not exists terms text,
  add column if not exists requires_shipping boolean not null default false,
  add column if not exists options text[] not null default '{}',
  add column if not exists sort_order integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rewards_monthly_quota_check'
  ) then
    alter table public.rewards
      add constraint rewards_monthly_quota_check
      check (monthly_quota is null or monthly_quota > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'rewards_valid_days_check'
  ) then
    alter table public.rewards
      add constraint rewards_valid_days_check
      check (valid_days between 1 and 3650);
  end if;
end;
$$;


-- ============================================================
-- 3. คอลัมน์เพิ่มของตาราง reward_redemptions
-- ============================================================
-- points_used / redemption_code / status มีอยู่แล้ว ที่เพิ่มคืออายุคูปอง
-- ข้อมูลการใช้งาน และข้อมูลการจัดส่งสำหรับของรางวัลที่เป็นของจริง
--
-- reward_name/points เก็บซ้ำไม่ได้ตั้งใจ — join กลับไปที่ rewards เอาชื่อได้อยู่
-- แล้ว และ on delete restrict กันไม่ให้รางวัลที่มีคนแลกไปแล้วถูกลบทิ้ง

alter table public.reward_redemptions
  add column if not exists expires_at         timestamptz,
  add column if not exists used_at            timestamptz,
  add column if not exists used_note          text,
  add column if not exists option_label       text,
  add column if not exists fulfillment_status public.reward_fulfillment_status,
  add column if not exists recipient_name     text,
  add column if not exists shipping_phone     text,
  add column if not exists shipping_address   text,
  add column if not exists tracking_number    text,
  add column if not exists shipped_at         timestamptz,
  add column if not exists cancel_reason      text;

create index if not exists idx_redemptions_user_created
on public.reward_redemptions(user_id, created_at desc);

create index if not exists idx_redemptions_fulfillment
on public.reward_redemptions(fulfillment_status)
where fulfillment_status is not null;

create index if not exists idx_redemptions_reward_created
on public.reward_redemptions(reward_id, created_at desc);


-- ============================================================
-- 4. ช่องทางให้เครื่องยนต์แต้มแก้ profiles.points ได้
-- ============================================================
-- protect_profile_privileged_columns (0002 → 0029) ล็อก points ไว้ให้แก้ได้
-- เฉพาะ service_role กับแอดมิน ซึ่งถูกต้องสำหรับการยิง REST ตรง ๆ แต่ทำให้
-- RPC ของระบบแลกรางวัลตัดแต้มไม่ได้ด้วย — security definer รันด้วยสิทธิ์
-- เจ้าของตารางก็จริง แต่ auth.role() ยังเป็น 'authenticated' ตามผู้เรียกอยู่ดี
--
-- ใช้ทางออกเดียวกับที่ 0009 ทำไว้กับ bookings แล้ว: GUC ระดับ transaction ที่
-- มีแต่ฟังก์ชันในไฟล์นี้เป็นคนเปิด ลูกค้าที่ยิง REST เข้ามาตั้ง app.* เองไม่ได้
-- (PostgREST ตั้งให้เฉพาะ request.* จาก JWT เท่านั้น)

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.role is distinct from old.role and not public.is_super_admin() then
    raise exception 'role cannot be modified directly';
  end if;

  if not public.is_admin() then
    if new.points is distinct from old.points
       and coalesce(current_setting('app.points_engine', true), '') <> 'on'
    then
      raise exception 'points cannot be modified directly';
    end if;

    if new.is_active is distinct from old.is_active then
      raise exception 'is_active cannot be modified directly';
    end if;

    if new.username is distinct from old.username then
      raise exception 'username cannot be modified directly';
    end if;
  end if;

  return new;
end;
$function$;


-- ตัวช่วยกลาง: ขยับแต้มพร้อมลงบัญชีใน point_transactions เสมอ
--
-- แยกออกมาเพราะทั้งการแลก การคืนแต้มตอนยกเลิก และการแจกแต้มตอนจองจบ ต้องทำ
-- สองอย่างนี้คู่กันทุกครั้ง — ถ้าปล่อยให้แต่ละที่เขียนเอง วันหนึ่งจะมีที่ที่
-- ลืมลงบัญชี แล้วยอดแต้มกับประวัติจะไม่ตรงกันโดยไม่มีใครรู้
--
-- ล็อกแถว profiles ก่อนอ่านยอด (for update) กันกดแลกรัว ๆ สองครั้งพร้อมกัน
-- แล้วทั้งคู่เห็นยอดเดิมเหมือนกัน

create or replace function public.apply_point_change(
  p_user_id        uuid,
  p_amount         integer,
  p_type           public.point_transaction_type,
  p_reference_type text default null,
  p_reference_id   text default null,
  p_description    text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_balance integer;
begin
  if p_amount = 0 then
    raise exception 'จำนวนแต้มต้องไม่เป็นศูนย์';
  end if;

  select points into v_balance
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'ไม่พบผู้ใช้นี้';
  end if;

  if v_balance + p_amount < 0 then
    raise exception 'แต้มสะสมของคุณไม่พอ (มี % แต้ม ต้องใช้ % แต้ม)',
      v_balance, abs(p_amount);
  end if;

  perform set_config('app.points_engine', 'on', true);

  update public.profiles
  set points = points + p_amount
  where id = p_user_id
  returning points into v_balance;

  perform set_config('app.points_engine', 'off', true);

  insert into public.point_transactions
    (user_id, amount, type, reference_type, reference_id, description)
  values
    (p_user_id, p_amount, p_type, p_reference_type, p_reference_id, p_description);

  return v_balance;
end;
$fn$;

revoke all on function public.apply_point_change(uuid, integer, public.point_transaction_type, text, text, text)
  from public, anon, authenticated;


-- ============================================================
-- 5. คลังรางวัลพร้อมยอดคงเหลือ (view)
-- ============================================================
-- "เหลือเท่าไร" คำนวณต่างกันตามชนิดเพดาน จึงคิดที่เดียวใน view นี้แล้วให้ทั้ง
-- หน้าลูกค้า หน้าแอดมิน และ redeem_reward() อ่านนิยามเดียวกัน — ไม่งั้นเลข
-- ที่ลูกค้าเห็นกับเลขที่ระบบใช้ตัดสินใจตอนกดแลกจะเป็นคนละสูตรกัน
--
-- นับ "เดือนนี้" ตามเวลาไทย ไม่ใช่ UTC ไม่งั้นวันที่ 1 ของเดือนช่วงหัวค่ำ
-- โควตาจะยังไม่รีเซ็ต (เหมือนที่ admin_overview_stats ทำไว้)
--
-- security_invoker = on ให้ rewards_public_read เป็นตัวกั้นเอง: ลูกค้าเห็นแค่
-- รางวัลที่เปิดใช้งาน ส่วนแอดมินเห็นทั้งหมดรวมที่ปิดไว้

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
  end::int as remaining
from public.rewards r
left join lateral (
  select count(*) as redeemed_month
  from public.reward_redemptions rr
  where rr.reward_id = r.id
    and rr.status <> 'cancelled'
    and date_trunc('month', rr.created_at at time zone 'Asia/Bangkok')
      = date_trunc('month', now()      at time zone 'Asia/Bangkok')
) m on true;

grant select on public.reward_catalog to anon, authenticated;


-- ============================================================
-- 6. แลกรางวัล (ฝั่งลูกค้า)
-- ============================================================
-- ทุกอย่างอยู่ใน transaction เดียว: ตัดแต้ม → ลงบัญชีแต้ม → ออกคูปอง →
-- ตัดสต๊อก ถ้าขั้นไหนพัง ทุกขั้นย้อนกลับหมด ไม่มีทางเกิดคูปองที่ไม่ได้ตัดแต้ม
-- หรือแต้มที่หายไปโดยไม่ได้คูปอง
--
-- ล็อกแถว rewards ไว้ก่อนเช็คเพดาน (for update) — สองคนกดแลกชิ้นสุดท้าย
-- พร้อมกันจะถูกบังคับให้เข้าคิว คนที่สองเห็นยอดหลังคนแรกตัดไปแล้วจริง ๆ
--
-- ทำไมไม่เช็ค p_option ว่าอยู่ใน r.options ฝั่งหน้าเว็บอย่างเดียว: หน้าเว็บ
-- ส่งอะไรมาก็ได้ ถ้าไม่กันตรงนี้จะได้คำขอ "เสื้อไซซ์ 6XL" ที่ไม่มีอยู่จริง
-- เข้าคิวจัดส่งของแอดมิน

create or replace function public.redeem_reward(
  p_reward_id       bigint,
  p_option          text default null,
  p_delivery_method text default null,   -- 'ship' | 'pickup'
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

  -- ตัวเลือก (ไซซ์เสื้อ ฯลฯ) — บังคับเลือกเฉพาะรางวัลที่ตั้งตัวเลือกไว้
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

  -- ข้อมูลจัดส่ง — บังคับเฉพาะของรางวัลที่เป็นของจริง
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

  -- รหัสคูปองแบบ SPB-RW-##### ตามแบบ — วนจนกว่าจะได้รหัสที่ยังไม่ถูกใช้
  -- (redemption_code เป็น unique อยู่แล้ว ตรงนี้แค่กันไม่ให้ผู้ใช้เจอ error
  -- ซ้ำคีย์ดิบ ๆ ในกรณีที่สุ่มชนกันจริง)
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

  -- ตัดสต๊อกเฉพาะรางวัลที่นับจำนวนชิ้นจริง — โควตาต่อเดือนไม่ต้องตัดอะไร
  -- เพราะ view นับจากจำนวนแถวที่แลกในเดือนนั้นอยู่แล้ว
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
-- 7. สรุปตัวเลขหน้าจัดการรางวัล (แอดมิน)
-- ============================================================
-- "ใกล้หมดสต๊อก" นับรางวัลที่เปิดใช้งานอยู่และเหลือไม่เกิน 10 (ไม่นับรางวัล
-- ที่ไม่ได้ตั้งเพดาน เพราะไม่มีวันหมด)

create or replace function public.admin_reward_stats()
returns table (
  total_rewards   integer,
  redeemed_month  integer,
  points_month    integer,
  low_stock_count integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_month timestamp := date_trunc('month', now() at time zone 'Asia/Bangkok');
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  return query
  select
    (select count(*) from public.rewards)::integer,
    (select count(*)
       from public.reward_redemptions rr
      where rr.status <> 'cancelled'
        and date_trunc('month', rr.created_at at time zone 'Asia/Bangkok') = v_month)::integer,
    (select coalesce(sum(rr.points_used), 0)
       from public.reward_redemptions rr
      where rr.status <> 'cancelled'
        and date_trunc('month', rr.created_at at time zone 'Asia/Bangkok') = v_month)::integer,
    (select count(*)
       from public.reward_catalog c
      where c.is_active
        and c.remaining is not null
        and c.remaining <= 10)::integer;
end;
$fn$;

revoke all on function public.admin_reward_stats() from public, anon;
grant execute on function public.admin_reward_stats() to authenticated, service_role;


-- ============================================================
-- 8. สรุปตัวเลขหน้าคำขอแลกรางวัล (แอดมิน)
-- ============================================================

create or replace function public.admin_reward_fulfillment_stats()
returns table (
  pending_count  integer,
  shipping_count integer,
  shipped_month  integer,
  pickup_count   integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_month timestamp := date_trunc('month', now() at time zone 'Asia/Bangkok');
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  return query
  select
    (select count(*) from public.reward_redemptions
      where fulfillment_status = 'pending' and status <> 'cancelled')::integer,
    (select count(*) from public.reward_redemptions
      where fulfillment_status = 'shipping' and status <> 'cancelled')::integer,
    (select count(*) from public.reward_redemptions
      where fulfillment_status = 'shipped'
        and shipped_at is not null
        and date_trunc('month', shipped_at at time zone 'Asia/Bangkok') = v_month)::integer,
    (select count(*) from public.reward_redemptions
      where fulfillment_status = 'pickup' and status <> 'cancelled')::integer;
end;
$fn$;

revoke all on function public.admin_reward_fulfillment_stats() from public, anon;
grant execute on function public.admin_reward_fulfillment_stats() to authenticated, service_role;


-- ============================================================
-- 9. คิวจัดส่งของแอดมิน (view)
-- ============================================================
-- แอดมินต้องเห็นชื่อและเบอร์ของลูกค้าคนอื่น ซึ่ง profiles_select_own ปิดไว้
-- อยู่แล้ว — view นี้จึงเป็น security definer (ไม่ใส่ security_invoker) และมี
-- is_admin() คุมอยู่ในตัว where เอง ไม่ใช่ปล่อยให้ RLS ของ profiles เป็นคนกั้น

create or replace view public.admin_reward_requests as
select
  rr.id,
  rr.user_id,
  rr.reward_id,
  rr.redemption_code,
  rr.points_used,
  rr.status,
  rr.fulfillment_status,
  rr.option_label,
  rr.recipient_name,
  rr.shipping_phone,
  rr.shipping_address,
  rr.tracking_number,
  rr.shipped_at,
  rr.cancel_reason,
  rr.created_at,
  rr.expires_at,
  rr.used_at,
  r.name     as reward_name,
  r.category as reward_category,
  r.image_url as reward_image,
  p.username,
  p.full_name,
  p.avatar_url,
  p.phone
from public.reward_redemptions rr
join public.rewards  r on r.id = rr.reward_id
join public.profiles p on p.id = rr.user_id
where rr.fulfillment_status is not null
  and public.is_admin();

grant select on public.admin_reward_requests to authenticated;


-- ============================================================
-- 10. อัปเดตสถานะการจัดส่ง (แอดมิน)
-- ============================================================
-- พอของถึงมือลูกค้าแล้ว (shipped) ถือว่าคูปองใบนั้นใช้ไปแล้วด้วย — หน้าประวัติ
-- ของลูกค้าจะขึ้น "ใช้แล้ว" ตรงกับแบบ ไม่ใช่ค้างเป็น "ยังไม่ได้ใช้" ตลอดไป
-- ทั้งที่ของอยู่ในมือแล้ว

create or replace function public.admin_update_redemption_fulfillment(
  p_id       uuid,
  p_status   public.reward_fulfillment_status,
  p_tracking text default null
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
    raise exception 'คำขอนี้ถูกยกเลิกไปแล้ว';
  end if;

  if v_row.fulfillment_status is null then
    raise exception 'ของรางวัลนี้ไม่ต้องจัดส่ง จึงอัปเดตสถานะจัดส่งไม่ได้';
  end if;

  select * into v_reward from public.rewards where id = v_row.reward_id;

  update public.reward_redemptions
  set fulfillment_status = p_status,
      tracking_number    = coalesce(nullif(btrim(coalesce(p_tracking, '')), ''), tracking_number),
      shipped_at         = case when p_status = 'shipped' then coalesce(shipped_at, now()) else shipped_at end,
      status             = case when p_status = 'shipped' then 'completed'::public.redemption_status else status end,
      used_at            = case when p_status = 'shipped' then coalesce(used_at, now()) else used_at end
  where id = p_id
  returning * into v_row;

  if p_status in ('shipping', 'shipped') then
    insert into public.notifications
      (user_id, type, title, message, reference_type, reference_id)
    values (
      v_row.user_id,
      'reward_shipping',
      case when p_status = 'shipped' then 'ของรางวัลจัดส่งแล้ว' else 'ของรางวัลกำลังจัดส่ง' end,
      case
        when p_status = 'shipped' and v_row.tracking_number is not null then
          format('"%s" จัดส่งแล้ว เลขพัสดุ %s', v_reward.name, v_row.tracking_number)
        when p_status = 'shipped' then
          format('"%s" จัดส่ง/ส่งมอบเรียบร้อยแล้ว', v_reward.name)
        else
          format('"%s" กำลังอยู่ระหว่างจัดส่ง', v_reward.name)
      end,
      'redemption',
      v_row.id::text
    );
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.admin_update_redemption_fulfillment(uuid, public.reward_fulfillment_status, text)
  from public, anon;
grant execute on function public.admin_update_redemption_fulfillment(uuid, public.reward_fulfillment_status, text)
  to authenticated, service_role;


-- ============================================================
-- 11. ยกเลิกคำขอ + คืนแต้ม (แอดมิน)
-- ============================================================
-- คืนแต้มเสมอ เพราะเหตุที่ยกเลิกคือฝั่งเราส่งของไม่ได้ ไม่ใช่ลูกค้าทำผิด
-- และคืนสต๊อกกลับด้วยถ้ารางวัลนั้นนับจำนวนชิ้น

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

  select * into v_reward from public.rewards where id = v_row.reward_id;

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
-- 12. ทำเครื่องหมายว่าใช้คูปองแล้ว (แอดมิน)
-- ============================================================
-- สำหรับคูปองที่ไม่ใช่ของจริง (ส่วนลดค่าสนาม / ชั่วโมงเล่นฟรี) ที่ลูกค้าเอา
-- รหัสมายื่นหน้าสนาม — รับ redemption_code เพราะแอดมินอ่านรหัสจากมือถือลูกค้า
-- ไม่ได้มี id ในมือ
--
-- ยังไม่มีหน้าเว็บไหนเรียกฟังก์ชันนี้: แบบใน Figma ทั้ง 5 หน้าไม่มีหน้าจอ
-- "ใช้คูปองตอนจอง/ตอนเช็คอิน" ปล่อยไว้ให้ฝั่งข้อมูลครบก่อน เพื่อไม่ให้สถานะ
-- "ใช้แล้ว" ที่หน้าประวัติต้องแสดง เป็นสถานะที่ไม่มีทางไปถึงได้เลย

create or replace function public.admin_mark_redemption_used(
  p_code text,
  p_note text default null
)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.reward_redemptions;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select * into v_row
  from public.reward_redemptions
  where upper(redemption_code) = upper(btrim(coalesce(p_code, '')))
  for update;

  if not found then
    raise exception 'ไม่พบรหัสคูปองนี้';
  end if;

  if v_row.status = 'cancelled' then
    raise exception 'คูปองใบนี้ถูกยกเลิกไปแล้ว';
  end if;

  if v_row.status = 'completed' then
    raise exception 'คูปองใบนี้ถูกใช้ไปแล้วเมื่อ %',
      to_char(v_row.used_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI');
  end if;

  if v_row.expires_at is not null and v_row.expires_at < now() then
    raise exception 'คูปองใบนี้หมดอายุแล้วเมื่อ %',
      to_char(v_row.expires_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY');
  end if;

  update public.reward_redemptions
  set status    = 'completed',
      used_at   = now(),
      used_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.admin_mark_redemption_used(text, text) from public, anon;
grant execute on function public.admin_mark_redemption_used(text, text) to authenticated, service_role;


-- ============================================================
-- 13. แจกแต้มตอนปิดงานการจอง
-- ============================================================
-- จุดที่ขาดไปทั้งระบบ: ไม่เคยมีอะไรเพิ่ม profiles.points ให้ใครเลย หน้าแลก
-- รางวัลที่ทำขึ้นมาจึงว่างเปล่าตลอดกาลถ้าไม่เติมตรงนี้
--
-- แจกตอน complete_past_bookings() ปิดงาน (cron รายชั่วโมง, jobid 2) ไม่ใช่ตอน
-- จ่ายเงิน เพราะรายการที่จ่ายแล้วยังยกเลิกและขอคืนเงินได้อยู่ ถ้าแจกตั้งแต่
-- จ่ายเงินจะต้องมาไล่ยึดแต้มคืนทีหลัง — "เล่นจบแล้ว" เป็นจุดที่ย้อนกลับไม่ได้
--
-- อัตรา: ทุก 10 บาทของยอดที่จ่ายจริง = 1 แต้ม (ปัดลง) แก้ตัวเลขได้ที่
-- v_baht_per_point ตัวเดียวข้างล่างนี้
--
-- reference_id = booking id และเช็คซ้ำก่อนแจกทุกครั้ง — ต่อให้ cron รันทับกัน
-- หรือมีคนเรียกซ้ำ การจองหนึ่งรายการก็ได้แต้มครั้งเดียว

create or replace function public.complete_past_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_done           integer := 0;
  v_baht_per_point constant integer := 10;
  v_booking        record;
  v_points         integer;
begin
  perform set_config('app.booking_engine', 'on', true);

  -- วน UPDATE ... RETURNING โดยตรง เพื่อให้ "รายการที่เพิ่งปิดงานรอบนี้"
  -- กับ "รายการที่จะแจกแต้ม" เป็นชุดเดียวกันแน่นอน ไม่ต้องยิง select ซ้ำ
  -- ซึ่งอาจไปคว้ารายการที่ปิดไปตั้งแต่รอบก่อนมาด้วย
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

    v_points := floor(coalesce(v_booking.total_amount, 0) / v_baht_per_point)::int;

    continue when v_points <= 0;

    continue when exists (
      select 1 from public.point_transactions t
      where t.user_id        = v_booking.user_id
        and t.reference_type = 'booking'
        and t.reference_id   = v_booking.id::text
        and t.type           = 'earned'
    );

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
  end loop;

  perform set_config('app.booking_engine', 'off', true);

  return v_done;
end;
$fn$;

revoke all on function public.complete_past_bookings() from public, anon, authenticated;


-- ============================================================
-- 14. Storage bucket รูปของรางวัล
-- ============================================================
-- แบบเดียวกับ bucket news (0018): อ่านสาธารณะเพราะต้องแสดงบนหน้าแลกรางวัล
-- เขียนได้เฉพาะแอดมิน เพราะรูปของรางวัลเป็นของทีมงานร่วมกัน ไม่มีเจ้าของรายคน

insert into storage.buckets (id, name, public)
values ('rewards', 'rewards', true)
on conflict (id) do nothing;

update storage.buckets
set file_size_limit   = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'rewards';

drop policy if exists "Reward images are publicly accessible" on storage.objects;
create policy "Reward images are publicly accessible"
on storage.objects for select
using ( bucket_id = 'rewards' );

drop policy if exists "Admins can upload reward images" on storage.objects;
create policy "Admins can upload reward images"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'rewards' and (select public.is_admin()) );

drop policy if exists "Admins can update reward images" on storage.objects;
create policy "Admins can update reward images"
on storage.objects for update
to authenticated
using ( bucket_id = 'rewards' and (select public.is_admin()) );

drop policy if exists "Admins can delete reward images" on storage.objects;
create policy "Admins can delete reward images"
on storage.objects for delete
to authenticated
using ( bucket_id = 'rewards' and (select public.is_admin()) );


-- ============================================================
-- 15. RLS เพิ่มเติมของ reward_redemptions
-- ============================================================
-- redemptions_insert_own (0000) เปิดให้ลูกค้า insert แถวของตัวเองได้ตรง ๆ
-- ซึ่งแปลว่าออกคูปองให้ตัวเองโดยไม่เสียแต้มได้ — ทั้งหมดต้องผ่าน
-- redeem_reward() ที่ตัดแต้มให้ในทรานแซกชันเดียวกันเท่านั้น
--
-- redeem_reward เป็น security definer จึงไม่ติด policy นี้

drop policy if exists "redemptions_insert_own" on public.reward_redemptions;


-- ============================================================
-- 16. ข้อมูลตั้งต้นของรางวัล
-- ============================================================
-- ชุดเดียวกับที่แบบใน Figma แสดงไว้ ให้หน้าเว็บมีของจริงให้ดูตั้งแต่ครั้งแรก
-- ที่เปิด — แอดมินแก้/ปิด/เพิ่มเองได้จากหน้าจัดการรางวัล
--
-- on conflict (name) do nothing ต้องมี unique index บนชื่อก่อน ซึ่งตารางเดิม
-- ไม่มี — ใช้ where not exists แทนเพื่อให้รันซ้ำได้โดยไม่ต้องแตะ schema เดิม

insert into public.rewards
  (name, description, terms, points_required, category, valid_days,
   stock, track_stock, monthly_quota, requires_shipping, options, sort_order)
select * from (values
  ('ส่วนลด 50 บาท',
   'ใช้ลดค่าสนามได้ทุกประเภท',
   'ใช้ได้ 1 ครั้งต่อคูปอง ไม่สามารถแลกเป็นเงินสดได้',
   500, 'discount'::public.reward_category, 90,
   0, false, null, false, '{}'::text[], 10),

  ('ส่วนลด 100 บาท',
   'ใช้ลดค่าสนามได้ทุกประเภท',
   'ใช้ได้ 1 ครั้งต่อคูปอง ไม่สามารถแลกเป็นเงินสดได้',
   900, 'discount'::public.reward_category, 90,
   0, false, null, false, '{}'::text[], 20),

  ('ชั่วโมงเล่นฟรี 1 ชม.',
   'แลกชั่วโมงเล่นฟรี ใช้ได้กับสนามกีฬาทุกประเภทในเครือ SPORTSBOOKING จองผ่านแอปตามปกติแล้วเลือกใช้คูปองนี้ตอนชำระเงิน',
   'ใช้ได้ 1 ครั้งต่อคูปอง ไม่สามารถแลกเป็นเงินสดได้',
   2000, 'privilege'::public.reward_category, 90,
   0, false, 40, false, '{}'::text[], 30),

  ('เสื้อ SPORTSBOOKING',
   'เสื้อทีมลิมิเต็ดอิดิชัน เลือกไซซ์ได้',
   'จัดส่งภายใน 14 วันทำการ หรือเลือกรับเองที่สนามได้',
   1500, 'merchandise'::public.reward_category, 90,
   50, true, null, true, array['S', 'M', 'L', 'XL'], 40),

  ('ลูกฟุตบอลแบรนด์เนม',
   'ลูกฟุตบอลมาตรฐานแข่งขัน',
   'จัดส่งภายใน 14 วันทำการ หรือเลือกรับเองที่สนามได้',
   1800, 'merchandise'::public.reward_category, 90,
   30, true, null, true, '{}'::text[], 50),

  ('สิทธิ์จองล่วงหน้า 30 วัน',
   'จองสนามล่วงหน้าได้นานกว่าปกติ 1 เดือน',
   'มีผลกับบัญชีของคุณ 30 วันนับจากวันที่แลก',
   3000, 'privilege'::public.reward_category, 30,
   0, false, null, false, '{}'::text[], 60)
) as seed(name, description, terms, points_required, category, valid_days,
          stock, track_stock, monthly_quota, requires_shipping, options, sort_order)
where not exists (
  select 1 from public.rewards r where r.name = seed.name
);
