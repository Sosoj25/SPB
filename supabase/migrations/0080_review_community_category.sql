-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0079).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- รีวิวที่ส่งจริงให้ไปโผล่ในชุมชนอัตโนมัติ ใต้หมวด "รีวิว" หมวดใหม่
-- ============================================================
-- หมวดนี้ต้องไม่มีใครโพสต์เองได้ตรง ๆ — ไม่งั้นใครก็เขียน "รีวิว" ปลอมที่ไม่ได้
-- จองจริงลงหมวดนี้ได้เหมือนโพสต์ทั่วไป ทางเข้าเดียวที่ควรมีคือ submit_review()
-- ซึ่งเป็น security definer อยู่แล้ว (bypass RLS ได้เอง) ส่วน policy insert/update
-- ปกติของ community_posts ต้องกันไว้ไม่ให้ผู้ใช้เลือกหมวดนี้ตรง ๆ ผ่านหน้าเว็บ


-- ============================================================
-- 1. หมวดหมู่ใหม่ "รีวิว"
-- ============================================================

insert into public.community_categories (name, description)
values ('รีวิว', 'รีวิวสนามจากผู้ที่จองและเข้าใช้บริการจริงเท่านั้น ระบบโพสต์ให้อัตโนมัติ')
on conflict (name) do nothing;


-- ============================================================
-- 2. กันโพสต์ปกติเข้าหมวด "รีวิว" ตรง ๆ
-- ============================================================
-- ใช้ชื่อหมวดแทน id ตรง ๆ ให้เข้าชุดเดียวกับ team_post_count ใน 0041 ที่คำนวณ
-- จากชื่อหมวดอยู่แล้ว — coalesce กับ -1 กันกรณี lookup ไม่เจอแถว (null <> ทุกอย่าง
-- จะได้ null ทำให้ with check ผ่านไปเฉย ๆ ซึ่งไม่ใช่ที่ต้องการ)

drop policy if exists "posts_insert_own" on public.community_posts;

create policy "posts_insert_own"
on public.community_posts
for insert
to authenticated
with check (
    user_id = auth.uid()
    and category_id <> coalesce(
      (select id from public.community_categories where name = 'รีวิว'),
      -1
    )
);


drop policy if exists "posts_update_own" on public.community_posts;

create policy "posts_update_own"
on public.community_posts
for update
to authenticated
using (
    user_id = auth.uid()
    or public.is_admin()
)
with check (
    (
      user_id = auth.uid()
      and category_id <> coalesce(
        (select id from public.community_categories where name = 'รีวิว'),
        -1
      )
    )
    or public.is_admin()
);


-- ============================================================
-- 3. submit_review() โพสต์เข้าหมวด "รีวิว" ให้อัตโนมัติในทรานแซกชันเดียวกัน
-- ============================================================
-- เนื้อหาโพสต์ทำเองจากดาว + คอมเมนต์ที่ผู้ใช้กรอก ไม่ต้องมีคอลัมน์เชื่อมกลับไป
-- reviews/bookings เพิ่ม เพราะ community_posts ไม่มีช่องอ้างอิงแบบนั้นอยู่แล้ว
-- และหน้าชุมชนก็ไม่ได้ต้องพากลับไปที่ใบเสร็จ

create or replace function public.submit_review(
  p_booking_id uuid,
  p_rating     integer,
  p_comment    text default null
)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user          uuid := auth.uid();
  v_booking       public.bookings;
  v_review        public.reviews;
  v_comment       text;
  v_facility_name text;
  v_venue_name    text;
  v_category_id   bigint;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะเขียนรีวิวได้';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'กรุณาให้คะแนน 1 ถึง 5 ดาว';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found or v_booking.user_id <> v_user then
    raise exception 'ไม่พบรายการจองนี้';
  end if;

  if v_booking.status = 'completed' then
    raise exception 'การจองนี้ถูกรีวิวไปแล้ว';
  end if;

  if v_booking.status = 'no_show' then
    raise exception 'ไม่สามารถรีวิวได้ เนื่องจากไม่ได้เข้าใช้บริการตามเวลาที่จอง';
  end if;

  if v_booking.status <> 'awaiting_review' then
    raise exception 'ยังไม่สามารถรีวิวการจองนี้ได้ ต้องรอให้ถึงเวลาเล่นก่อน';
  end if;

  v_comment := nullif(btrim(coalesce(p_comment, '')), '');

  insert into public.reviews (user_id, facility_id, booking_id, rating, comment)
  values (v_user, v_booking.facility_id, p_booking_id, p_rating, v_comment)
  returning * into v_review;

  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set status = 'completed'
  where id = p_booking_id;

  perform set_config('app.booking_engine', 'off', true);

  select f.name, v.name
  into v_facility_name, v_venue_name
  from public.facilities f
  join public.venues v on v.id = f.venue_id
  where f.id = v_booking.facility_id;

  select id into v_category_id
  from public.community_categories
  where name = 'รีวิว';

  if v_category_id is not null then
    insert into public.community_posts (user_id, category_id, title, content, post_type)
    values (
      v_user,
      v_category_id,
      'รีวิว ' || coalesce(v_facility_name, 'สนาม'),
      repeat('★', p_rating) || repeat('☆', 5 - p_rating)
        || ' ' || coalesce(v_venue_name, '')
        || case when v_comment is not null then (E'\n' || v_comment) else '' end,
      'text'
    );
  end if;

  return v_review;
end;
$fn$;

revoke all on function public.submit_review(uuid, integer, text) from public, anon;
grant execute on function public.submit_review(uuid, integer, text) to authenticated;
