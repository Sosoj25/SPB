-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0083).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ของที่เลือกจัดส่ง ตัดสิทธิ์ที่เคาน์เตอร์ไม่ได้
-- ============================================================
-- redeem_reward() ออกรหัสคูปอง (SPB-RW-xxxxx) ให้ทุกใบเหมือนกันหมด ไม่ว่าลูกค้า
-- จะเลือกจัดส่งตามที่อยู่หรือมารับเองที่สนาม ส่วน admin_mark_redemption_used()
-- เช็คแค่ว่าใบนั้นไม่ถูกยกเลิก ยังไม่ถูกใช้ และยังไม่หมดอายุ — ไม่เคยดูวิธีรับของ
--
-- ผลคือลูกค้าที่เลือกส่งถึงบ้านยังยื่น QR ให้สแกนที่เคาน์เตอร์ได้ แล้วได้ของ
-- สองต่อ เพราะคิวจัดส่งของแอดมิน (view admin_reward_requests) กรองด้วย
-- fulfillment_status is not null อย่างเดียว ไม่ได้ดู status ของคูปอง ใบที่ถูก
-- ตัดไปแล้วจึงยังนอนรอแพ็คส่งอยู่ในคิวตามปกติ
--
-- เกณฑ์: ดูที่ "มีที่อยู่จัดส่งบันทึกไว้" (redeem_reward เก็บ shipping_address
-- เฉพาะตอนเลือก ship) ไม่ใช่ rewards.requires_shipping — ลูกค้าที่โทรมาขอเปลี่ยน
-- ใจมารับเอง แอดมินจะตั้ง fulfillment_status = 'pickup' ให้ แล้วใบนั้นต้องกลับมา
-- ตัดที่เคาน์เตอร์ได้ตามปกติ
--
-- ไม่แตะ confirm_redemption_received() — ของที่ส่งถึงบ้านปิดจ็อบด้วยการที่ลูกค้า
-- กดยืนยันรับของเองในแอป ซึ่งเป็นคนละทางกับการสแกนที่เคาน์เตอร์

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

  if nullif(btrim(coalesce(v_row.shipping_address, '')), '') is not null
     and coalesce(v_row.fulfillment_status::text, '') <> 'pickup'
  then
    raise exception 'คูปองใบนี้ลูกค้าเลือกให้จัดส่งตามที่อยู่ ตัดสิทธิ์ที่เคาน์เตอร์ไม่ได้ — จัดการต่อที่หน้าคำขอของรางวัล (ถ้าลูกค้าขอเปลี่ยนมารับเอง ให้เปลี่ยนสถานะเป็นนัดรับที่สนามก่อน)';
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
