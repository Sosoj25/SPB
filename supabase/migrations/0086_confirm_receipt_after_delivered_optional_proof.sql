-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0085).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ยืนยันรับของได้ตอน "จัดส่งสำเร็จ" และรูปหลักฐานเป็นทางเลือก
-- ============================================================
-- ปรับจาก 0085 สองข้อตามการใช้งานจริง:
--
--   1) เดิมกดยืนยันได้ตั้งแต่ขั้น "จัดส่งแล้ว" (step >= 2) ซึ่งคือของเพิ่งออก
--      จากคลัง ยังอยู่กับขนส่ง — เร็วเกินไป ปุ่มควรโผล่ตอนขนส่งบอกว่าส่งถึง
--      แล้ว (delivered / พร้อมให้รับที่สนาม = step 4)
--
--   2) เดิมบังคับแนบรูปสำหรับของที่จัดส่ง ทำให้คนที่แกะกล่องทิ้งไปแล้วหรือ
--      ถ่ายรูปไม่สะดวกยืนยันไม่ได้เลย แล้วใบนั้นก็ค้างอยู่ในคิวไปเรื่อย ๆ
--      รูปยังเก็บได้เหมือนเดิม แค่ไม่บังคับ

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

  -- step 4 = 'delivered' (ขนส่งส่งถึงแล้ว) หรือ 'pickup' (พร้อมให้รับที่สนาม)
  if public.reward_fulfillment_step(v_row.fulfillment_status) < 4 then
    raise exception 'ของรางวัลยังไม่ถึงสถานะจัดส่งสำเร็จ ยังยืนยันการรับของไม่ได้';
  end if;

  -- รูปเป็นทางเลือก แต่ถ้าแนบมาต้องเป็นไฟล์ใต้โฟลเดอร์ของใบนี้เท่านั้น —
  -- กันการอ้าง path รูปของใบอื่นมาใช้ซ้ำ
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
-- แจ้งเตือนตอน "จัดส่งสำเร็จ" — รูปเป็นทางเลือกแล้ว ข้อความต้องไม่สั่งให้แนบ
-- ------------------------------------------------------------
-- โครงเดิมทั้งหมดจาก 0085 เปลี่ยนเฉพาะข้อความท้ายแจ้งเตือน
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

  v_tracking := coalesce(nullif(btrim(coalesce(p_tracking, '')), ''), v_row.tracking_number);
  v_carrier  := coalesce(nullif(btrim(coalesce(p_carrier, '')), ''), v_row.shipping_carrier);

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
             then ' — กรุณากดยืนยันเมื่อได้รับของแล้วที่หน้าประวัติการแลกรางวัล (แนบรูปของที่ได้รับด้วยก็ได้)'
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
