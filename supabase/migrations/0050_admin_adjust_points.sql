-- ปุ่ม "ปรับแต้มลูกค้า" ฝั่งแอดมิน (หน้าจัดการรางวัล) — ให้/หักแต้มลูกค้า
-- ตรง ๆ เช่น ชดเชยความผิดพลาดหรือให้แต้มพิเศษนอกเหนือจากการจอง
--
-- ใช้ apply_point_change (0047) ตัวเดียวกับที่ redeem_reward และ
-- admin_cancel_redemption ใช้ เพื่อให้ profiles.points กับ point_transactions
-- ตรงกันเสมอ — ห้ามมีทาง .update({points}) ตรง ๆ (ล็อกไว้ตั้งแต่ 0002)

create or replace function public.admin_adjust_points(
  p_user_id uuid,
  p_amount  integer,
  p_reason  text
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_balance integer;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  if v_reason is null then
    raise exception 'กรุณาระบุเหตุผลในการปรับแต้ม';
  end if;

  v_balance := public.apply_point_change(
    p_user_id,
    p_amount,
    'adjustment',
    'admin',
    auth.uid()::text,
    v_reason
  );

  insert into public.notifications
    (user_id, type, title, message)
  values (
    p_user_id,
    'points_adjusted',
    case when p_amount > 0 then 'ได้รับแต้มเพิ่ม' else 'แต้มถูกปรับลด' end,
    format(
      '%s%s แต้ม เหตุผล: %s (ยอดคงเหลือ %s แต้ม)',
      case when p_amount > 0 then '+' else '' end,
      to_char(p_amount, 'FM999,999,990'),
      v_reason,
      to_char(v_balance, 'FM999,999,990')
    )
  );

  return v_balance;
end;
$fn$;

revoke all on function public.admin_adjust_points(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_points(uuid, integer, text) to authenticated, service_role;
