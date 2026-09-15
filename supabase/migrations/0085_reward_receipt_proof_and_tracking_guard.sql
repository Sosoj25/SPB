-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0084).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- หลักฐานการรับของจากลูกค้า + บังคับเลขพัสดุก่อนกด "จัดส่งแล้ว"
-- ============================================================
-- สองด้านของปัญหาเดียวกัน: ไม่มีใครพิสูจน์ได้ว่าของถึงมือลูกค้าจริงไหม
--
--   * ฝั่งลูกค้า — confirm_redemption_received() เดิมกดยืนยันได้ด้วยมือเปล่า
--     พอมีเคสอ้างว่า "กดไปแล้วแต่ยังไม่ได้ของ" ก็ไม่มีอะไรให้เทียบ
--   * ฝั่งแอดมิน — admin_update_redemption_fulfillment() ตั้งสถานะ "จัดส่งแล้ว"
--     ได้โดยไม่ต้องมีเลขพัสดุ ลูกค้าที่ของหายจึงไม่มีเลขให้ตามกับขนส่ง และ
--     แจ้งเตือนที่ส่งออกไปก็เขียนว่าจัดส่งแล้วแบบไม่มีเลขติดไปด้วย
--
-- บังคับเฉพาะเส้นทางพัสดุจริง (มี shipping_address และไม่ได้เปลี่ยนเป็นนัดรับ
-- ที่สนาม) — ของที่ลูกค้ามารับเองไม่มีขนส่งให้กรอกและเจ้าหน้าที่เห็นตัวจริง
-- ตอนส่งมอบอยู่แล้ว

-- ------------------------------------------------------------
-- 1. คอลัมน์เก็บ path ของรูปหลักฐาน
-- ------------------------------------------------------------
alter table public.reward_redemptions
  add column if not exists receipt_proof_path text;

comment on column public.reward_redemptions.receipt_proof_path is
  'path ในบัคเก็ต reward-receipts ของรูปที่ลูกค้าแนบตอนกดยืนยันรับของ (เฉพาะของที่จัดส่ง)';


-- ------------------------------------------------------------
-- 2. บัคเก็ตรูปหลักฐาน (ส่วนตัว — ในรูปมีหน้าบ้าน/ชื่อผู้รับติดมาด้วย)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reward-receipts', 'reward-receipts', false,
  5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public             = false,
    file_size_limit    = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

-- path รูปแบบ <redemption_id>/<timestamp>.<ext> — โฟลเดอร์แรกคือใบที่อ้างถึง
-- ตรวจสิทธิ์แบบเดียวกับ refund-payment-proofs (0040)
drop policy if exists "Owners can upload reward receipt proof" on storage.objects;
create policy "Owners can upload reward receipt proof"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'reward-receipts'
  and exists (
    select 1
    from public.reward_redemptions rr
    where rr.id::text = (storage.foldername(name))[1]
      and rr.user_id = (select auth.uid())
  )
);

drop policy if exists "Admins and owners can view reward receipt proof" on storage.objects;
create policy "Admins and owners can view reward receipt proof"
on storage.objects for select
to authenticated
using (
  bucket_id = 'reward-receipts'
  and (
    public.is_admin()
    or exists (
      select 1
      from public.reward_redemptions rr
      where rr.id::text = (storage.foldername(name))[1]
        and rr.user_id = (select auth.uid())
    )
  )
);


-- ------------------------------------------------------------
-- 3. ลูกค้ายืนยันรับของ — ของที่จัดส่งต้องแนบรูป
-- ------------------------------------------------------------
-- เพิ่มพารามิเตอร์ที่สาม จึงต้อง drop ตัวเดิมทิ้งก่อน ไม่งั้นจะมีสองตัวชื่อ
-- เดียวกันและ PostgREST เลือกไม่ถูกเวลาเรียกด้วย named arguments
drop function if exists public.confirm_redemption_received(uuid, text);

create or replace function public.confirm_redemption_received(
  p_id         uuid,
  p_note       text default null,
  p_proof_path text default null
)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me    uuid := (select auth.uid());
  v_row   public.reward_redemptions;
  v_proof text := nullif(btrim(coalesce(p_proof_path, '')), '');
begin
  if v_me is null then
    raise exception 'ต้องเข้าสู่ระบบก่อน';
  end if;

  select * into v_row
  from public.reward_redemptions
  where id = p_id
  for update;

  if not found or v_row.user_id <> v_me then
    raise exception 'ไม่พบรายการแลกรางวัลนี้';
  end if;

  if v_row.status = 'cancelled' then
    raise exception 'รายการนี้ถูกยกเลิกไปแล้ว';
  end if;

  if v_row.fulfillment_status is null then
    raise exception 'ของรางวัลนี้ไม่มีการจัดส่ง จึงไม่ต้องยืนยันการรับของ';
  end if;

  if v_row.fulfillment_status = 'received' then
    return v_row;
  end if;

  if public.reward_fulfillment_step(v_row.fulfillment_status) < 2 then
    raise exception 'ของรางวัลยังไม่ถูกจัดส่ง ยังยืนยันการรับของไม่ได้';
  end if;

  -- ของที่ส่งถึงบ้านต้องมีรูปของจริงที่ได้รับ ส่วนของที่มารับเองที่สนามไม่ต้อง
  -- (เจ้าหน้าที่ส่งมอบกับมือและเห็นลูกค้าตัวเป็น ๆ อยู่แล้ว)
  if v_proof is null
     and nullif(btrim(coalesce(v_row.shipping_address, '')), '') is not null
     and coalesce(v_row.fulfillment_status::text, '') <> 'pickup'
  then
    raise exception 'กรุณาแนบรูปของที่ได้รับก่อนกดยืนยัน';
  end if;

  -- path ต้องอยู่ใต้โฟลเดอร์ของใบนี้เท่านั้น — กันการอ้างรูปของใบอื่นมาใช้ซ้ำ
  if v_proof is not null and split_part(v_proof, '/', 1) <> p_id::text then
    raise exception 'ไฟล์หลักฐานไม่ตรงกับรายการแลกรางวัลนี้';
  end if;

  update public.reward_redemptions
  set fulfillment_status = 'received',
      received_at        = coalesce(received_at, now()),
      delivered_at       = coalesce(delivered_at, now()),
      status             = 'completed',
      used_at            = coalesce(used_at, now()),
      receipt_proof_path = coalesce(v_proof, receipt_proof_path),
      used_note          = coalesce(used_note, nullif(btrim(coalesce(p_note, '')), ''),
                                    'ลูกค้ายืนยันว่าได้รับของรางวัลแล้ว')
  where id = p_id
  returning * into v_row;

  insert into public.reward_shipment_events
    (redemption_id, status, note, tracking_number, carrier, created_by)
  values (
    p_id,
    'received',
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'ลูกค้ายืนยันว่าได้รับของรางวัลแล้ว'),
    v_row.tracking_number,
    v_row.shipping_carrier,
    v_me
  );

  return v_row;
end;
$fn$;

revoke all on function public.confirm_redemption_received(uuid, text, text) from public, anon;
grant execute on function public.confirm_redemption_received(uuid, text, text) to authenticated;


-- ------------------------------------------------------------
-- 4. แอดมินอัปเดตสถานะ — ต้องมีขนส่ง + เลขพัสดุก่อนถึงขั้นจัดส่ง
-- ------------------------------------------------------------
-- โครงเดิมทั้งหมดจาก 0060 (การถอยสถานะกลับ) เพิ่มเฉพาะด่านตรวจเลขพัสดุ
create or replace function public.admin_update_redemption_fulfillment(
  p_id       uuid,
  p_status   public.reward_fulfillment_status,
  p_tracking text default null,
  p_carrier  text default null,
  p_note     text default null
)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row      public.reward_redemptions;
  v_reward   public.rewards;
  v_label    text;
  v_step     integer := public.reward_fulfillment_step(p_status);
  v_tracking text;
  v_carrier  text;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  if p_status = 'received' then
    raise exception 'สถานะ "ลูกค้ายืนยันได้รับแล้ว" ต้องให้ลูกค้าเป็นคนกดยืนยันเอง';
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

  if v_row.fulfillment_status = 'received' then
    raise exception 'ลูกค้ายืนยันรับของแล้ว ไม่สามารถเปลี่ยนสถานะย้อนกลับได้';
  end if;

  -- ค่าที่จะถูกบันทึกจริง (ของใหม่ถ้ากรอกมา ไม่งั้นของเดิมที่มีอยู่)
  v_tracking := coalesce(nullif(btrim(coalesce(p_tracking, '')), ''), v_row.tracking_number);
  v_carrier  := coalesce(nullif(btrim(coalesce(p_carrier, '')), ''), v_row.shipping_carrier);

  -- ตั้งแต่ขั้น "จัดส่งแล้ว" เป็นต้นไป ของที่ส่งเป็นพัสดุต้องมีทั้งชื่อขนส่งและ
  -- เลขพัสดุ — เลขอย่างเดียวตามของไม่ได้ถ้าไม่รู้ว่าเจ้าไหน และแจ้งเตือนที่ส่ง
  -- ให้ลูกค้าตอนนี้ก็จะมีเลขติดไปด้วยเสมอ
  if v_step >= 2
     and p_status <> 'pickup'
     and nullif(btrim(coalesce(v_row.shipping_address, '')), '') is not null
  then
    if nullif(btrim(coalesce(v_carrier, '')), '') is null
       or nullif(btrim(coalesce(v_tracking, '')), '') is null
    then
      raise exception 'กรุณากรอกบริษัทขนส่งและเลขพัสดุก่อนอัปเดตเป็นสถานะนี้';
    end if;
  end if;

  select * into v_reward from public.rewards where id = v_row.reward_id;

  update public.reward_redemptions
  set fulfillment_status = p_status,
      tracking_number    = coalesce(nullif(btrim(coalesce(p_tracking, '')), ''), tracking_number),
      shipping_carrier   = coalesce(nullif(btrim(coalesce(p_carrier, '')), ''), shipping_carrier),
      shipping_note      = coalesce(nullif(btrim(coalesce(p_note, '')), ''), shipping_note),

      -- ถอยกลับก่อน "จัดส่งแล้ว" = ของยังไม่ได้ออกจากคลัง ล้างเวลาส่งทิ้ง
      shipped_at = case
        when p_status = 'shipped' then coalesce(shipped_at, now())
        when v_step < 2           then null
        else shipped_at
      end,

      delivered_at = case
        when p_status = 'delivered' then coalesce(delivered_at, now())
        when v_step < 4             then null
        else delivered_at
      end,

      -- คืนคูปองกลับเป็น "ยังไม่ได้ใช้" เฉพาะใบที่ถูกปิดด้วยการจัดส่งเท่านั้น
      status = case
        when p_status = 'delivered' then 'completed'::public.redemption_status
        when v_step < 4
             and v_row.received_at is null
             and v_row.delivered_at is not null
             and status = 'completed'
          then 'pending'::public.redemption_status
        else status
      end,

      used_at = case
        when p_status = 'delivered' then coalesce(used_at, now())
        when v_step < 4
             and v_row.received_at is null
             and v_row.delivered_at is not null
          then null
        else used_at
      end
  where id = p_id
  returning * into v_row;

  insert into public.reward_shipment_events
    (redemption_id, status, note, tracking_number, carrier, created_by)
  values (
    p_id,
    p_status,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_row.tracking_number,
    v_row.shipping_carrier,
    (select auth.uid())
  );

  v_label := case p_status
    when 'preparing'  then 'กำลังเตรียมสินค้า'
    when 'shipped'    then 'จัดส่งแล้ว'
    when 'in_transit' then 'อยู่ระหว่างขนส่ง'
    when 'delivered'  then 'จัดส่งสำเร็จ'
    when 'pickup'     then 'พร้อมให้รับที่สนาม'
    else 'รอดำเนินการ'
  end;

  -- ไม่แจ้งเตือนตอนถอยกลับไป 'pending' — เป็นการแก้ข้อมูลฝั่งหลังบ้าน ไม่ใช่
  -- ความคืบหน้าที่ลูกค้าต้องรู้
  if p_status <> 'pending' then
    insert into public.notifications
      (user_id, type, title, message, reference_type, reference_id)
    values (
      v_row.user_id,
      'reward_shipping',
      format('ของรางวัล: %s', v_label),
      format(
        '"%s" %s%s%s',
        v_reward.name,
        v_label,
        coalesce(' · เลขพัสดุ ' || v_row.tracking_number, ''),
        case when p_status = 'delivered'
             then ' — กรุณากดยืนยันพร้อมแนบรูปของที่ได้รับที่หน้าประวัติการแลกรางวัล'
             else '' end
      ),
      'redemption',
      v_row.id::text
    );
  end if;

  return v_row;
end;
$fn$;

alter function public.admin_update_redemption_fulfillment(
  uuid, public.reward_fulfillment_status, text, text, text
) set search_path = public;

revoke all on function public.admin_update_redemption_fulfillment(
  uuid, public.reward_fulfillment_status, text, text, text
) from public, anon;

grant execute on function public.admin_update_redemption_fulfillment(
  uuid, public.reward_fulfillment_status, text, text, text
) to authenticated, service_role;


-- ------------------------------------------------------------
-- 5. คิวจัดส่ง (แอดมิน) — ส่ง path รูปหลักฐานมาด้วย
-- ------------------------------------------------------------
drop view if exists public.admin_reward_requests;

create view public.admin_reward_requests as
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
  rr.shipping_carrier,
  rr.shipping_note,
  rr.receipt_proof_path,
  rr.shipped_at,
  rr.delivered_at,
  rr.received_at,
  rr.cancel_reason,
  rr.created_at,
  rr.expires_at,
  rr.used_at,
  r.name      as reward_name,
  r.category  as reward_category,
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

revoke all on public.admin_reward_requests from anon, authenticated;
grant select on public.admin_reward_requests to authenticated;
