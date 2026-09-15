-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0094).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- หมวด "รีวิว" เป็นของระบบ — ลบหรือเปลี่ยนชื่อไม่ได้ + สรุปคะแนนของหน้ารีวิว
-- ============================================================
-- หมวดนี้ไม่ใช่หมวดที่แอดมินตั้งเอง แต่เป็นจุดที่ submit_review() ใช้โพสต์รีวิว
-- ให้ผู้ใช้อัตโนมัติ (0080) และทั้งฟีดชุมชนกับหน้า /community/reviews ก็แยก
-- โพสต์รีวิวออกจากโพสต์คุยกันด้วย "ชื่อหมวด" เดียวกันนี้
--
-- ทั้งสองทางอ้างถึงหมวดนี้ด้วยชื่อ ไม่ใช่ id — ลบทิ้งหรือเปลี่ยนชื่อจากหน้า
-- แอดมินทีเดียว รีวิวที่ส่งหลังจากนั้นจะเงียบหายไปโดยไม่มี error ให้เห็น
-- (submit_review() เขียน `if v_category_id is not null` ไว้ รีวิวยังบันทึกลง
-- ตาราง reviews สำเร็จ แค่ไม่มีโพสต์ขึ้นชุมชนอีกเลย) จึงต้องกันที่ฐานข้อมูล
-- ไม่ใช่กันแค่ปุ่มในหน้าแอดมิน
--
-- ใช้ trigger ไม่ใช่ policy เพราะ categories_admin_manage (0000) เป็น policy
-- เดียวคลุมทั้ง insert/update/delete การแก้ policy ให้ยกเว้นแถวเดียวจะทำให้
-- เงื่อนไขอ่านยากขึ้นมาก และ policy ก็ไม่คุ้ม service role ที่ bypass RLS ได้


-- ============================================================
-- 1. trigger กันลบ/เปลี่ยนชื่อหมวดของระบบ
-- ============================================================
-- แก้ description/icon ยังทำได้ตามปกติ — ห้ามเฉพาะสิ่งที่ทำให้ระบบหาหมวดไม่เจอ

create or replace function public.guard_system_category()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'หมวด "%" เป็นหมวดของระบบ ลบไม่ได้ เพราะระบบใช้โพสต์รีวิวให้อัตโนมัติ', old.name;
  end if;

  if new.name is distinct from old.name then
    raise exception 'หมวด "%" เป็นหมวดของระบบ เปลี่ยนชื่อไม่ได้ เพราะระบบค้นหาหมวดนี้จากชื่อ', old.name;
  end if;

  return new;
end;
$fn$;


drop trigger if exists guard_system_category_update on public.community_categories;

create trigger guard_system_category_update
before update on public.community_categories
for each row
when (old.name = 'รีวิว')
execute function public.guard_system_category();


drop trigger if exists guard_system_category_delete on public.community_categories;

create trigger guard_system_category_delete
before delete on public.community_categories
for each row
when (old.name = 'รีวิว')
execute function public.guard_system_category();


-- ============================================================
-- 2. สรุปคะแนนรีวิวสำหรับหัวหน้า /community/reviews
-- ============================================================
-- นับจาก "โพสต์ในหมวดรีวิว" ชุดเดียวกับที่หน้านั้นแสดง ไม่ใช่จากตาราง reviews
-- ทั้งตาราง — รีวิวที่ส่งก่อน 0080 ไม่มีโพสต์คู่กัน ถ้านับจาก reviews ยอดรวม
-- ข้างบนจะมากกว่าจำนวนรายการที่เลื่อนดูได้จริงข้างล่างโดยไม่มีเหตุผลให้ผู้ใช้เห็น
--
-- คะแนนอ่านจากดาวห้าดวงที่ submit_review() เขียนไว้หน้าสุดของเนื้อหาเสมอ
-- (เช่น '★★★★☆ ชื่อสาขา') — นับ ★ ใน 5 ตัวอักษรแรกคือคะแนนของรีวิวนั้น
--
-- security definer เพื่อให้ทุกคนเห็นตัวเลขชุดเดียวกัน ไม่แกว่งตาม RLS ของคนดู
-- (posts_public_read ปล่อยให้เจ้าของเห็นโพสต์ตัวเองทุกสถานะ) — ฟังก์ชันคืนแค่
-- ยอดรวมของโพสต์ที่เผยแพร่อยู่แล้ว ไม่มีข้อมูลรายคนหลุดออกไป

create or replace function public.community_review_stats()
returns table (
  total   bigint,
  average numeric,
  count_1 bigint,
  count_2 bigint,
  count_3 bigint,
  count_4 bigint,
  count_5 bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  with r as (
    select length(regexp_replace(left(p.content, 5), '[^★]', '', 'g')) as rating
    from public.community_posts p
    join public.community_categories c on c.id = p.category_id
    where c.name = 'รีวิว'
      and p.status = 'published'
  )
  select
    count(*) filter (where rating between 1 and 5),
    coalesce(round(avg(rating) filter (where rating between 1 and 5), 2), 0),
    count(*) filter (where rating = 1),
    count(*) filter (where rating = 2),
    count(*) filter (where rating = 3),
    count(*) filter (where rating = 4),
    count(*) filter (where rating = 5)
  from r;
$fn$;

revoke all on function public.community_review_stats() from public, anon;
grant execute on function public.community_review_stats() to authenticated;
