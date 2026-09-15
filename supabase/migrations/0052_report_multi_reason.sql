-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0051).
-- Safe to re-run: every step is idempotent.
--
-- ระบบรายงานเนื้อหา รอบที่ 2
--
-- 0000 วางตาราง community_reports ไว้แบบ "หนึ่งใบ = หนึ่งเหตุผล" แล้ว 0044 เพิ่ม
-- unique index (reporter_id, post_id) กันรายงานซ้ำ — สองอย่างนี้รวมกันแปลว่า
-- คนหนึ่งคนเลือกเหตุผลได้ข้อเดียวตลอดกาล ทั้งที่ของจริงโพสต์หนึ่งโพสต์ผิดได้
-- หลายข้อพร้อมกัน (สแปม + หลอกลวง + ข้อมูลเท็จ เป็นชุดที่มาด้วยกันบ่อยมาก)
--
-- ไฟล์นี้เติมสี่อย่าง:
--   1) เลือกเหตุผลได้ 1–3 ข้อต่อหนึ่งใบรายงาน (คอลัมน์ reasons)
--   2) RPC report_content() ที่ตรวจครบทุกเงื่อนไขในที่เดียว
--   3) คิวรายงานฝั่งแอดมินบอก "ไปดูโพสต์ไหน" และ "เหตุผลข้อไหนกี่คน" ได้
--   4) Realtime ของ community_reports ให้หน้าแอดมินเด้งเตือนทันทีที่มีคนรายงาน
--
-- คอลัมน์ reason เดิมยังอยู่และยังถูกเติมให้เสมอ (= reasons[1]) เพื่อไม่ให้
-- view/โค้ดเดิมที่อ่านคอลัมน์นั้นพังกลางคัน


-- ============================================================
-- 1. เหตุผลหลายข้อต่อหนึ่งใบรายงาน
-- ============================================================
-- เก็บเป็น array บนใบเดิม ไม่ใช่แตกเป็นหลายแถว เพราะ unique index ของ 0044
-- ตั้งใจให้ "หนึ่งคน = หนึ่งใบต่อเนื้อหา" อยู่แล้ว ถ้าแตกเป็นหลายแถวต้องรื้อ
-- index นั้นทิ้ง แล้วยอดนับ "ถูกรายงาน N ครั้ง" จะพองตามจำนวนเหตุผลที่เลือก
-- ไม่ใช่จำนวนคนที่รายงาน ซึ่งเป็นตัวเลขที่แอดมินใช้จัดลำดับความสำคัญ

alter table public.community_reports
  add column if not exists reasons public.report_reason[] not null default '{}';

-- ใบเก่าทั้งหมดมีเหตุผลเดียวอยู่แล้ว ยกขึ้นมาเป็น array ให้ตรงกัน
update public.community_reports
set reasons = array[reason]
where cardinality(reasons) = 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'community_reports_reasons_check'
  ) then
    alter table public.community_reports
      add constraint community_reports_reasons_check
      check (cardinality(reasons) between 1 and 3);
  end if;
end;
$$;

-- BEFORE trigger ทำงานก่อน check constraint เสมอ จึงเติมค่าให้ครบได้ทัน —
-- ทางที่ยิง insert ตรง ๆ ผ่าน REST (reports_insert_own ยังเปิดอยู่) ส่งมาแค่
-- reason เดียวก็ยังใช้ได้เหมือนเดิม ไม่ต้องแก้อะไรฝั่งนั้น
create or replace function public.sync_report_reasons()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_clean public.report_reason[];
begin
  if new.reasons is null or cardinality(new.reasons) = 0 then
    if new.reason is null then
      raise exception 'กรุณาเลือกเหตุผลในการรายงานอย่างน้อย 1 ข้อ';
    end if;

    new.reasons := array[new.reason];
    return new;
  end if;

  -- ตัดตัวซ้ำทิ้งก่อนนับ ไม่งั้นกดเลือก "สแปม" ซ้ำสามครั้งจากฝั่งที่ส่งข้อมูล
  -- มาไม่เรียบร้อย จะกลายเป็นครบโควตา 3 ข้อทั้งที่มีเหตุผลจริงข้อเดียว
  select array_agg(distinct r order by r) into v_clean
  from unnest(new.reasons) as r;

  if cardinality(v_clean) > 3 then
    raise exception 'เลือกเหตุผลได้ไม่เกิน 3 ข้อต่อหนึ่งรายงาน';
  end if;

  new.reasons := v_clean;
  new.reason  := v_clean[1];

  return new;
end;
$$;

drop trigger if exists sync_report_reasons on public.community_reports;
create trigger sync_report_reasons
before insert or update on public.community_reports
for each row execute function public.sync_report_reasons();


-- ============================================================
-- 2. report_content — ทางเดียวที่หน้าเว็บใช้ส่งรายงาน
-- ============================================================
-- ย้าย validation ทั้งหมดมาไว้ฝั่งเซิร์ฟเวอร์ที่เดียว: จำนวนเหตุผล ค่าที่ส่งมา
-- อยู่ใน enum จริงไหม เนื้อหามีอยู่จริงไหม และกันคนรายงานเนื้อหาของตัวเอง
-- (ซึ่งไม่ผิดกฎอะไร แต่ทำให้คิวของแอดมินมีขยะ)
--
-- security definer เพราะต้องอ่าน community_posts/comments ของคนอื่นเพื่อหา
-- เจ้าของ และต้องเขียน notifications ให้แอดมินทุกคน ซึ่ง RLS ของ notifications
-- ไม่เปิดให้ผู้ใช้ทั่วไปเขียนให้คนอื่น

create or replace function public.report_content(
  p_post_id     uuid default null,
  p_comment_id  uuid default null,
  p_reasons     text[] default null,
  p_description text default null
)
returns public.community_reports
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me        uuid := (select auth.uid());
  v_reasons   public.report_reason[];
  v_owner     uuid;
  v_preview   text;
  v_kind      text;
  v_row       public.community_reports;
begin
  if v_me is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะรายงานเนื้อหาได้';
  end if;

  if (p_post_id is null) = (p_comment_id is null) then
    raise exception 'ไม่ได้ระบุเนื้อหาที่ต้องการรายงาน';
  end if;

  if p_reasons is null or cardinality(p_reasons) = 0 then
    raise exception 'กรุณาเลือกเหตุผลในการรายงานอย่างน้อย 1 ข้อ';
  end if;

  -- แปลงเป็น enum ทีละตัวเพื่อให้ค่าที่ไม่รู้จักตอบเป็นข้อความไทย ไม่ใช่
  -- "invalid input value for enum report_reason" ดิบ ๆ
  begin
    select array_agg(distinct r::public.report_reason order by r::public.report_reason)
    into v_reasons
    from unnest(p_reasons) as r
    where btrim(r) <> '';
  exception
    when invalid_text_representation then
      raise exception 'มีเหตุผลที่ระบบไม่รู้จักอยู่ในรายการที่เลือก';
  end;

  if v_reasons is null or cardinality(v_reasons) = 0 then
    raise exception 'กรุณาเลือกเหตุผลในการรายงานอย่างน้อย 1 ข้อ';
  end if;

  if cardinality(v_reasons) > 3 then
    raise exception 'เลือกเหตุผลได้ไม่เกิน 3 ข้อต่อหนึ่งรายงาน';
  end if;

  if p_post_id is not null then
    select user_id, left(coalesce(title, content, ''), 60)
    into v_owner, v_preview
    from public.community_posts
    where id = p_post_id and status <> 'deleted';

    v_kind := 'โพสต์';
  else
    select user_id, left(coalesce(content, ''), 60)
    into v_owner, v_preview
    from public.community_comments
    where id = p_comment_id and status <> 'deleted';

    v_kind := 'ความคิดเห็น';
  end if;

  if v_owner is null then
    raise exception 'ไม่พบเนื้อหานี้ หรือเนื้อหาถูกลบไปแล้ว';
  end if;

  if v_owner = v_me then
    raise exception 'ไม่สามารถรายงานเนื้อหาของตัวเองได้';
  end if;

  begin
    insert into public.community_reports
      (reporter_id, post_id, comment_id, reason, reasons, description)
    values (
      v_me,
      p_post_id,
      p_comment_id,
      v_reasons[1],
      v_reasons,
      nullif(btrim(coalesce(p_description, '')), '')
    )
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'คุณรายงานเนื้อหานี้ไปแล้ว';
  end;

  -- แจ้งแอดมินทุกคนทันที — หน้า /admin/community มีทั้งกระดิ่งและแถบเตือน
  -- ที่อ่านคิวนี้อยู่แล้ว ตรงนี้เป็นสำเนาถาวรไว้ให้ตามย้อนหลังได้ ต่อให้
  -- ไม่มีแอดมินคนไหนเปิดหน้านั้นค้างไว้ตอนที่รายงานเข้ามา
  insert into public.notifications
    (user_id, type, title, message, reference_type, reference_id)
  select
    pr.id,
    'content_reported',
    format('%s ถูกรายงานใหม่', v_kind),
    format('%s "%s" ถูกรายงาน (%s)',
           v_kind,
           coalesce(nullif(v_preview, ''), 'ไม่มีข้อความ'),
           array_to_string(v_reasons::text[], ', ')),
    'community_report',
    coalesce(p_post_id, p_comment_id)::text
  from public.profiles pr
  where pr.role in ('admin', 'super_admin')
    and pr.is_active;

  return v_row;
end;
$fn$;

revoke all on function public.report_content(uuid, uuid, text[], text) from public, anon;
grant execute on function public.report_content(uuid, uuid, text[], text) to authenticated;


-- ============================================================
-- 3. คิวรายงานฝั่งแอดมิน — บอกได้ว่าไปดูโพสต์ไหน และเหตุผลข้อไหนกี่คน
-- ============================================================
-- ของเดิม (0043) คืน reasons มาเป็น array แบน ๆ ไม่รู้ว่าข้อไหนหนักกว่ากัน และ
-- ที่ขาดจริง ๆ คือ "ลิงก์ไปดูของจริง" — รายงานคอมเมนต์ไม่มี post_id ติดมาเลย
-- แอดมินจึงกดเข้าไปดูบริบทของคอมเมนต์นั้นไม่ได้ ได้แต่อ่านข้อความ 60 ตัวอักษร
-- ที่ตัดมาให้แล้วเดาเอาเอง
--
-- ต้อง drop ก่อนเพราะชุดคอลัมน์เปลี่ยน (create or replace view แทรกคอลัมน์
-- กลางลิสต์ไม่ได้)

drop view if exists public.admin_community_reports;

create view public.admin_community_reports
with (security_invoker = on) as
with pending as (
  select r.id, r.post_id, r.comment_id, r.created_at, r.description, r.reasons
  from public.community_reports r
  where r.status = 'pending'
),
reason_rows as (
  select p.post_id, p.comment_id, u.reason::text as reason, count(*)::int as cnt
  from pending p
  cross join lateral unnest(p.reasons) as u(reason)
  group by p.post_id, p.comment_id, u.reason
),
reason_summary as (
  select
    post_id,
    comment_id,
    jsonb_object_agg(reason, cnt)                        as reason_counts,
    array_agg(reason order by cnt desc, reason)          as reasons,
    (array_agg(reason order by cnt desc, reason))[1]     as top_reason
  from reason_rows
  group by post_id, comment_id
),
grouped as (
  select
    post_id,
    comment_id,
    count(*)::int      as report_count,
    min(created_at)    as first_reported_at,
    max(created_at)    as last_reported_at,
    array_remove(array_agg(description order by created_at desc), null) as descriptions
  from pending
  group by post_id, comment_id
)
select
  g.post_id,
  g.comment_id,
  case when g.post_id is not null then 'post' else 'comment' end as target_type,
  -- โพสต์ที่ต้องเปิดเพื่อดูของจริง: รายงานโพสต์ = ตัวมันเอง, รายงานคอมเมนต์
  -- = โพสต์ที่คอมเมนต์นั้นอยู่ข้างใต้
  coalesce(g.post_id, c.post_id) as link_post_id,
  g.report_count,
  s.reasons,
  s.reason_counts,
  s.top_reason,
  g.descriptions,
  g.first_reported_at,
  g.last_reported_at,
  coalesce(p.content, c.content)              as target_content,
  p.title                                     as target_title,
  coalesce(p.user_id, c.user_id)              as target_author_id,
  coalesce(pa.full_name, pa.username, 'ผู้ใช้ไม่ระบุตัวตน') as target_author,
  pa.avatar_url                               as target_author_avatar,
  p.status                                    as post_status
from grouped g
join reason_summary s
  on s.post_id is not distinct from g.post_id
 and s.comment_id is not distinct from g.comment_id
left join public.community_posts p    on p.id = g.post_id
left join public.community_comments c on c.id = g.comment_id
left join public.profiles pa          on pa.id = coalesce(p.user_id, c.user_id);

grant select on public.admin_community_reports to authenticated;


-- ============================================================
-- 4. สถิติแอดมิน: เพิ่มยอดรายงานที่เข้ามาใหม่ใน 24 ชม.
-- ============================================================
-- ตัวเลขที่หน้า /admin/community ใช้ขึ้นแถบ "มีรายงานใหม่" — แยกจาก
-- pending_reports เพราะคิวค้างสะสมกับ "เพิ่งเข้ามา" เป็นคนละเรื่อง คิวค้าง 40
-- ใบที่ไม่มีอะไรใหม่เลยไม่ควรเด้งเตือนซ้ำทุกครั้งที่เปิดหน้า

drop function if exists public.admin_community_stats();

create function public.admin_community_stats()
returns table (
  total_posts       int,
  total_comments    int,
  pending_reports   int,
  new_reports_24h   int,
  flagged_posts     int,
  flagged_comments  int,
  hidden_posts      int,
  pinned_posts      int,
  suspended_members int,
  total_members     int
)
language sql
stable
as $$
  select
    (select count(*) from public.community_posts where status <> 'deleted')::int,
    (select count(*) from public.community_comments where status = 'published')::int,
    (select count(*) from public.community_reports where status = 'pending')::int,
    (select count(*) from public.community_reports
      where status = 'pending' and created_at > now() - interval '24 hours')::int,
    (select count(distinct p.id)
       from public.community_posts p
       join public.community_reports r on r.post_id = p.id and r.status = 'pending'
      where p.status <> 'deleted')::int,
    (select count(distinct cm.id)
       from public.community_comments cm
       join public.community_reports r on r.comment_id = cm.id and r.status = 'pending'
      where cm.status <> 'deleted')::int,
    (select count(*) from public.community_posts where status = 'hidden')::int,
    (select count(*) from public.community_posts where is_pinned)::int,
    (select count(*) from public.profiles where not is_active)::int,
    (select count(*) from public.profiles)::int;
$$;

revoke all on function public.admin_community_stats() from public, anon;
grant execute on function public.admin_community_stats() to authenticated;


-- ============================================================
-- 5. ผู้ใช้ที่ถูกรายงานบ่อย — แยกว่าโดนเรื่องอะไรมากที่สุด
-- ============================================================
drop view if exists public.admin_reported_users;

create view public.admin_reported_users
with (security_invoker = on) as
with owned as (
  select
    coalesce(p.user_id, c.user_id) as owner_id,
    r.status,
    r.reasons
  from public.community_reports r
  left join public.community_posts p    on p.id = r.post_id
  left join public.community_comments c on c.id = r.comment_id
),
reason_rows as (
  select o.owner_id, u.reason::text as reason, count(*)::int as cnt
  from owned o
  cross join lateral unnest(o.reasons) as u(reason)
  group by o.owner_id, u.reason
)
select
  pr.id,
  pr.username,
  pr.full_name,
  pr.avatar_url,
  pr.is_active,
  count(*)::int as report_count,
  count(*) filter (where o.status = 'pending')::int as pending_report_count,
  (select array_agg(rr.reason order by rr.cnt desc, rr.reason)
     from reason_rows rr where rr.owner_id = pr.id) as reasons
from owned o
join public.profiles pr on pr.id = o.owner_id
group by pr.id, pr.username, pr.full_name, pr.avatar_url, pr.is_active;

grant select on public.admin_reported_users to authenticated;


-- ============================================================
-- 6. Realtime ของ community_reports
-- ============================================================
-- ให้หน้า /admin/community เด้งแถบ "มีรายงานใหม่เข้ามา" ทันทีโดยไม่ต้องกด
-- รีเฟรช — postgres_changes เคารพ RLS ของตารางอยู่แล้ว (reports_select_own
-- ปล่อยเฉพาะใบของตัวเองหรือแอดมิน) คนทั่วไปที่ subscribe channel เดียวกันจึง
-- ไม่ได้รับ event ของใบที่ตัวเองไม่ได้เป็นคนรายงาน
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_reports'
  ) then
    alter publication supabase_realtime add table public.community_reports;
  end if;
end
$$;
