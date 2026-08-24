-- ============================================================
-- SPORTSBOOKING DATABASE
-- Supabase / PostgreSQL
-- Version 1.0
-- ============================================================
--
-- รันซ้ำได้ (idempotent) ทุกคำสั่ง
--
-- หมายเหตุ: Postgres ไม่มี CREATE POLICY IF NOT EXISTS เลยสักเวอร์ชัน
-- ตอนแรกไฟล์นี้จึงพังเมื่อรันรอบสอง ด้วย
--     ERROR: 42710: policy "profiles_select_own" for table "profiles" already exists
-- ทุก create policy จึงต้องมี drop policy if exists นำหน้าเสมอ
-- ถ้าเพิ่ม policy ใหม่ในอนาคต อย่าลืมทำแบบเดียวกัน
--


-- ============================================================
-- 0. EXTENSIONS
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";


-- ============================================================
-- 1. ENUM TYPES
-- ============================================================

do $$
begin

    if not exists (
        select 1 from pg_type where typname = 'user_role'
    ) then
        create type public.user_role as enum (
            'customer',
            'admin',
            'super_admin'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'venue_status'
    ) then
        create type public.venue_status as enum (
            'active',
            'inactive'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'facility_status'
    ) then
        create type public.facility_status as enum (
            'available',
            'maintenance',
            'inactive'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'booking_status'
    ) then
        create type public.booking_status as enum (
            'pending',
            'confirmed',
            'completed',
            'cancelled',
            'rejected'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'payment_status'
    ) then
        create type public.payment_status as enum (
            'unpaid',
            'pending',
            'paid',
            'approved',
            'rejected'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'payment_method'
    ) then
        create type public.payment_method as enum (
            'bank_transfer',
            'qr',
            'other'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'review_status'
    ) then
        create type public.review_status as enum (
            'published',
            'hidden'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'point_transaction_type'
    ) then
        create type public.point_transaction_type as enum (
            'earned',
            'spent',
            'adjustment'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'redemption_status'
    ) then
        create type public.redemption_status as enum (
            'pending',
            'completed',
            'cancelled'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'post_type'
    ) then
        create type public.post_type as enum (
            'text',
            'image',
            'poll',
            'event'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'content_status'
    ) then
        create type public.content_status as enum (
            'published',
            'hidden',
            'deleted'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'report_reason'
    ) then
        create type public.report_reason as enum (
            'spam',
            'harassment',
            'inappropriate',
            'scam',
            'misinformation',
            'other'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'report_status'
    ) then
        create type public.report_status as enum (
            'pending',
            'reviewed',
            'resolved',
            'rejected'
        );
    end if;


    if not exists (
        select 1 from pg_type where typname = 'news_status'
    ) then
        create type public.news_status as enum (
            'draft',
            'published',
            'archived'
        );
    end if;

end
$$;


-- ============================================================
-- 2. PROFILES
-- ============================================================

create table if not exists public.profiles (

    id uuid primary key
        references auth.users(id)
        on delete cascade,

    username varchar(50) not null unique,

    full_name varchar(150),

    phone varchar(30),

    avatar_url text,

    bio text,

    role public.user_role not null default 'customer',

    points integer not null default 0,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint profiles_points_check
        check (points >= 0),

    constraint profiles_username_length
        check (char_length(username) >= 3)

);


-- ============================================================
-- 3. SPORTS
-- ============================================================

create table if not exists public.sports (

    id bigint generated by default as identity primary key,

    name varchar(100) not null unique,

    description text,

    icon_url text,

    is_active boolean not null default true,

    created_at timestamptz not null default now()

);


-- ============================================================
-- 4. VENUES
-- ============================================================

create table if not exists public.venues (

    id bigint generated by default as identity primary key,

    name varchar(200) not null,

    description text,

    address text not null,

    latitude decimal(10,7),

    longitude decimal(10,7),

    phone varchar(30),

    opening_time time not null,

    closing_time time not null,

    owner_id uuid
        references public.profiles(id)
        on delete set null,

    status public.venue_status not null default 'active',

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint venues_latitude_check
        check (
            latitude is null
            or latitude between -90 and 90
        ),

    constraint venues_longitude_check
        check (
            longitude is null
            or longitude between -180 and 180
        ),

    constraint venues_time_check
        check (closing_time > opening_time)

);


-- ============================================================
-- 5. FACILITIES
-- ============================================================

create table if not exists public.facilities (

    id bigint generated by default as identity primary key,

    venue_id bigint not null
        references public.venues(id)
        on delete cascade,

    sport_id bigint not null
        references public.sports(id)
        on delete restrict,

    name varchar(200) not null,

    description text,

    capacity integer,

    price_per_hour numeric(12,2) not null,

    status public.facility_status not null default 'available',

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint facilities_capacity_check
        check (capacity is null or capacity > 0),

    constraint facilities_price_check
        check (price_per_hour >= 0),

    constraint facilities_unique_name
        unique (venue_id, name)

);


-- ============================================================
-- 6. FACILITY IMAGES
-- ============================================================

create table if not exists public.facility_images (

    id bigint generated by default as identity primary key,

    facility_id bigint not null
        references public.facilities(id)
        on delete cascade,

    image_url text not null,

    is_primary boolean not null default false,

    sort_order integer not null default 0,

    created_at timestamptz not null default now(),

    constraint facility_images_sort_check
        check (sort_order >= 0)

);


-- ============================================================
-- 7. BOOKINGS
-- ============================================================

create table if not exists public.bookings (

    id uuid primary key default gen_random_uuid(),

    booking_code varchar(30) not null unique,

    user_id uuid not null
        references public.profiles(id)
        on delete restrict,

    facility_id bigint not null
        references public.facilities(id)
        on delete restrict,

    booking_date date not null,

    start_time time not null,

    end_time time not null,

    total_amount numeric(12,2) not null,

    status public.booking_status not null default 'pending',

    payment_status public.payment_status not null default 'unpaid',

    note text,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint bookings_time_check
        check (end_time > start_time),

    constraint bookings_amount_check
        check (total_amount >= 0),

    constraint bookings_date_check
        check (booking_date >= current_date)

);


-- ============================================================
-- 8. PREVENT DOUBLE BOOKING
-- ============================================================

alter table public.bookings
add column if not exists booking_slot tsrange
generated always as (
    tsrange(
        (booking_date + start_time)::timestamp,
        (booking_date + end_time)::timestamp,
        '[)'
    )
) stored;


alter table public.bookings
drop constraint if exists bookings_no_overlap;


alter table public.bookings
add constraint bookings_no_overlap
exclude using gist (

    facility_id with =,
    booking_slot with &&

)
where (
    status in (
        'pending',
        'confirmed'
    )
);


-- ============================================================
-- 9. PAYMENTS
-- ============================================================

create table if not exists public.payments (

    id uuid primary key default gen_random_uuid(),

    booking_id uuid not null
        references public.bookings(id)
        on delete cascade,

    user_id uuid not null
        references public.profiles(id)
        on delete restrict,

    amount numeric(12,2) not null,

    payment_method public.payment_method not null,

    slip_url text,

    status public.payment_status not null default 'pending',

    verified_by uuid
        references public.profiles(id)
        on delete set null,

    verified_at timestamptz,

    rejection_reason text,

    created_at timestamptz not null default now(),

    constraint payments_amount_check
        check (amount > 0)

);


-- ============================================================
-- 10. REVIEWS
-- ============================================================

create table if not exists public.reviews (

    id bigint generated by default as identity primary key,

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    facility_id bigint not null
        references public.facilities(id)
        on delete cascade,

    booking_id uuid not null unique
        references public.bookings(id)
        on delete cascade,

    rating integer not null,

    comment text,

    status public.review_status not null default 'published',

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint reviews_rating_check
        check (rating between 1 and 5)

);


-- ============================================================
-- 11. POINT TRANSACTIONS
-- ============================================================

create table if not exists public.point_transactions (

    id bigint generated by default as identity primary key,

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    amount integer not null,

    type public.point_transaction_type not null,

    reference_type varchar(50),

    reference_id text,

    description text,

    created_at timestamptz not null default now(),

    constraint point_transactions_amount_check
        check (amount <> 0)

);


-- ============================================================
-- 12. REWARDS
-- ============================================================

create table if not exists public.rewards (

    id bigint generated by default as identity primary key,

    name varchar(200) not null,

    description text,

    points_required integer not null,

    stock integer not null default 0,

    image_url text,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint rewards_points_check
        check (points_required > 0),

    constraint rewards_stock_check
        check (stock >= 0)

);


-- ============================================================
-- 13. REWARD REDEMPTIONS
-- ============================================================

create table if not exists public.reward_redemptions (

    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references public.profiles(id)
        on delete restrict,

    reward_id bigint not null
        references public.rewards(id)
        on delete restrict,

    points_used integer not null,

    status public.redemption_status not null default 'pending',

    redemption_code varchar(50) not null unique,

    created_at timestamptz not null default now(),

    constraint reward_redemptions_points_check
        check (points_used > 0)

);


-- ============================================================
-- 14. COMMUNITY CATEGORIES
-- ============================================================

create table if not exists public.community_categories (

    id bigint generated by default as identity primary key,

    name varchar(100) not null unique,

    description text,

    icon varchar(100),

    created_at timestamptz not null default now()

);


-- ============================================================
-- 15. COMMUNITY POSTS
-- ============================================================

create table if not exists public.community_posts (

    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    category_id bigint not null
        references public.community_categories(id)
        on delete restrict,

    title varchar(255) not null,

    content text not null,

    post_type public.post_type not null default 'text',

    status public.content_status not null default 'published',

    view_count integer not null default 0,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint community_posts_view_check
        check (view_count >= 0)

);


-- ============================================================
-- 16. POST IMAGES
-- ============================================================

create table if not exists public.post_images (

    id bigint generated by default as identity primary key,

    post_id uuid not null
        references public.community_posts(id)
        on delete cascade,

    image_url text not null,

    sort_order integer not null default 0,

    created_at timestamptz not null default now(),

    constraint post_images_sort_check
        check (sort_order >= 0)

);


-- ============================================================
-- 17. COMMUNITY COMMENTS
-- ============================================================

create table if not exists public.community_comments (

    id uuid primary key default gen_random_uuid(),

    post_id uuid not null
        references public.community_posts(id)
        on delete cascade,

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    parent_id uuid
        references public.community_comments(id)
        on delete cascade,

    content text not null,

    status public.content_status not null default 'published',

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint community_comments_content_check
        check (char_length(trim(content)) > 0)

);


-- ============================================================
-- 18. POST LIKES
-- ============================================================

create table if not exists public.post_likes (

    post_id uuid not null
        references public.community_posts(id)
        on delete cascade,

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    created_at timestamptz not null default now(),

    primary key (post_id, user_id)

);


-- ============================================================
-- 19. POST BOOKMARKS
-- ============================================================

create table if not exists public.post_bookmarks (

    post_id uuid not null
        references public.community_posts(id)
        on delete cascade,

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    created_at timestamptz not null default now(),

    primary key (post_id, user_id)

);


-- ============================================================
-- 20. COMMUNITY REPORTS
-- ============================================================

create table if not exists public.community_reports (

    id uuid primary key default gen_random_uuid(),

    reporter_id uuid not null
        references public.profiles(id)
        on delete cascade,

    post_id uuid
        references public.community_posts(id)
        on delete cascade,

    comment_id uuid
        references public.community_comments(id)
        on delete cascade,

    reason public.report_reason not null,

    description text,

    status public.report_status not null default 'pending',

    reviewed_by uuid
        references public.profiles(id)
        on delete set null,

    reviewed_at timestamptz,

    created_at timestamptz not null default now(),

    constraint community_reports_target_check
        check (
            (post_id is not null and comment_id is null)
            or
            (post_id is null and comment_id is not null)
        )

);


-- ============================================================
-- 21. USER FOLLOWS
-- ============================================================

create table if not exists public.user_follows (

    follower_id uuid not null
        references public.profiles(id)
        on delete cascade,

    following_id uuid not null
        references public.profiles(id)
        on delete cascade,

    created_at timestamptz not null default now(),

    primary key (follower_id, following_id),

    constraint user_follows_self_check
        check (follower_id <> following_id)

);


-- ============================================================
-- 22. NOTIFICATIONS
-- ============================================================

create table if not exists public.notifications (

    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    type varchar(50) not null,

    title varchar(255) not null,

    message text not null,

    reference_type varchar(50),

    reference_id text,

    is_read boolean not null default false,

    created_at timestamptz not null default now()

);


-- ============================================================
-- 23. NEWS
-- ============================================================

create table if not exists public.news (

    id bigint generated by default as identity primary key,

    author_id uuid not null
        references public.profiles(id)
        on delete restrict,

    title varchar(255) not null,

    content text not null,

    cover_image text,

    status public.news_status not null default 'draft',

    published_at timestamptz,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()

);


-- ============================================================
-- 24. INDEXES
-- ============================================================

create index if not exists idx_venues_owner
on public.venues(owner_id);

create index if not exists idx_facilities_venue
on public.facilities(venue_id);

create index if not exists idx_facilities_sport
on public.facilities(sport_id);

create index if not exists idx_facility_images_facility
on public.facility_images(facility_id);

create index if not exists idx_bookings_user
on public.bookings(user_id);

create index if not exists idx_bookings_facility_date
on public.bookings(facility_id, booking_date);

create index if not exists idx_bookings_status
on public.bookings(status);

create index if not exists idx_payments_booking
on public.payments(booking_id);

create index if not exists idx_payments_user
on public.payments(user_id);

create index if not exists idx_payments_status
on public.payments(status);

create index if not exists idx_reviews_facility
on public.reviews(facility_id);

create index if not exists idx_reviews_user
on public.reviews(user_id);

create index if not exists idx_points_user
on public.point_transactions(user_id);

create index if not exists idx_redemptions_user
on public.reward_redemptions(user_id);

create index if not exists idx_posts_user
on public.community_posts(user_id);

create index if not exists idx_posts_category
on public.community_posts(category_id);

create index if not exists idx_posts_created
on public.community_posts(created_at desc);

create index if not exists idx_comments_post
on public.community_comments(post_id);

create index if not exists idx_comments_user
on public.community_comments(user_id);

create index if not exists idx_comments_parent
on public.community_comments(parent_id);

create index if not exists idx_post_likes_user
on public.post_likes(user_id);

create index if not exists idx_bookmarks_user
on public.post_bookmarks(user_id);

create index if not exists idx_reports_status
on public.community_reports(status);

create index if not exists idx_reports_post
on public.community_reports(post_id);

create index if not exists idx_reports_comment
on public.community_reports(comment_id);

create index if not exists idx_follows_follower
on public.user_follows(follower_id);

create index if not exists idx_follows_following
on public.user_follows(following_id);

create index if not exists idx_notifications_user
on public.notifications(user_id);

create index if not exists idx_notifications_unread
on public.notifications(user_id, is_read);

create index if not exists idx_news_status
on public.news(status);

create index if not exists idx_news_published
on public.news(published_at desc);


-- ============================================================
-- 25. UPDATED_AT TRIGGER
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;


drop trigger if exists trg_profiles_updated_at
on public.profiles;

create trigger trg_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();


drop trigger if exists trg_venues_updated_at
on public.venues;

create trigger trg_venues_updated_at
before update on public.venues
for each row
execute function public.set_updated_at();


drop trigger if exists trg_facilities_updated_at
on public.facilities;

create trigger trg_facilities_updated_at
before update on public.facilities
for each row
execute function public.set_updated_at();


drop trigger if exists trg_bookings_updated_at
on public.bookings;

create trigger trg_bookings_updated_at
before update on public.bookings
for each row
execute function public.set_updated_at();


drop trigger if exists trg_reviews_updated_at
on public.reviews;

create trigger trg_reviews_updated_at
before update on public.reviews
for each row
execute function public.set_updated_at();


drop trigger if exists trg_rewards_updated_at
on public.rewards;

create trigger trg_rewards_updated_at
before update on public.rewards
for each row
execute function public.set_updated_at();


drop trigger if exists trg_posts_updated_at
on public.community_posts;

create trigger trg_posts_updated_at
before update on public.community_posts
for each row
execute function public.set_updated_at();


drop trigger if exists trg_comments_updated_at
on public.community_comments;

create trigger trg_comments_updated_at
before update on public.community_comments
for each row
execute function public.set_updated_at();


drop trigger if exists trg_news_updated_at
on public.news;

create trigger trg_news_updated_at
before update on public.news
for each row
execute function public.set_updated_at();


-- ============================================================
-- 26. AUTO CREATE PROFILE AFTER SUPABASE AUTH SIGNUP
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
    generated_username text;
begin

    generated_username :=
        coalesce(
            new.raw_user_meta_data->>'username',
            'user_' || substr(new.id::text, 1, 8)
        );

    insert into public.profiles (
        id,
        username,
        full_name
    )
    values (
        new.id,
        generated_username,
        new.raw_user_meta_data->>'full_name'
    )
    on conflict (id) do nothing;

    return new;

end;
$$;


drop trigger if exists on_auth_user_created
on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();


-- ============================================================
-- 27. ADMIN CHECK FUNCTION
-- ============================================================

create or replace function public.is_admin()
returns boolean
security definer
set search_path = public
stable
language sql
as $$
    select exists (
        select 1
        from public.profiles
        where id = auth.uid()
        and role in ('admin', 'super_admin')
        and is_active = true
    );
$$;


create or replace function public.is_super_admin()
returns boolean
security definer
set search_path = public
stable
language sql
as $$
    select exists (
        select 1
        from public.profiles
        where id = auth.uid()
        and role = 'super_admin'
        and is_active = true
    );
$$;


-- ============================================================
-- 28. ENABLE RLS
-- ============================================================

alter table public.profiles enable row level security;
alter table public.sports enable row level security;
alter table public.venues enable row level security;
alter table public.facilities enable row level security;
alter table public.facility_images enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.reviews enable row level security;
alter table public.point_transactions enable row level security;
alter table public.rewards enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.community_categories enable row level security;
alter table public.community_posts enable row level security;
alter table public.post_images enable row level security;
alter table public.community_comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_bookmarks enable row level security;
alter table public.community_reports enable row level security;
alter table public.user_follows enable row level security;
alter table public.notifications enable row level security;
alter table public.news enable row level security;


-- ============================================================
-- 29. PROFILES RLS
-- ============================================================

drop policy if exists "profiles_select_own" on public.profiles;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (
    id = auth.uid()
    or public.is_admin()
);


drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (
    id = auth.uid()
)
with check (
    id = auth.uid()
);


drop policy if exists "profiles_admin_all" on public.profiles;

create policy "profiles_admin_all"
on public.profiles
for all
to authenticated
using (
    public.is_admin()
)
with check (
    public.is_admin()
);


-- ============================================================
-- 30. SPORTS RLS
-- ============================================================

drop policy if exists "sports_public_read" on public.sports;

create policy "sports_public_read"
on public.sports
for select
to anon, authenticated
using (
    is_active = true
    or public.is_admin()
);


drop policy if exists "sports_admin_manage" on public.sports;

create policy "sports_admin_manage"
on public.sports
for all
to authenticated
using (
    public.is_admin()
)
with check (
    public.is_admin()
);


-- ============================================================
-- 31. VENUES RLS
-- ============================================================

drop policy if exists "venues_public_read" on public.venues;

create policy "venues_public_read"
on public.venues
for select
to anon, authenticated
using (
    status = 'active'
    or public.is_admin()
);


drop policy if exists "venues_admin_manage" on public.venues;

create policy "venues_admin_manage"
on public.venues
for all
to authenticated
using (
    public.is_admin()
)
with check (
    public.is_admin()
);


-- ============================================================
-- 32. FACILITIES RLS
-- ============================================================

drop policy if exists "facilities_public_read" on public.facilities;

create policy "facilities_public_read"
on public.facilities
for select
to anon, authenticated
using (
    status <> 'inactive'
    or public.is_admin()
);


drop policy if exists "facilities_admin_manage" on public.facilities;

create policy "facilities_admin_manage"
on public.facilities
for all
to authenticated
using (
    public.is_admin()
)
with check (
    public.is_admin()
);


-- ============================================================
-- 33. FACILITY IMAGES RLS
-- ============================================================

drop policy if exists "facility_images_public_read" on public.facility_images;

create policy "facility_images_public_read"
on public.facility_images
for select
to anon, authenticated
using (true);


drop policy if exists "facility_images_admin_manage" on public.facility_images;

create policy "facility_images_admin_manage"
on public.facility_images
for all
to authenticated
using (
    public.is_admin()
)
with check (
    public.is_admin()
);


-- ============================================================
-- 34. BOOKINGS RLS
-- ============================================================

drop policy if exists "bookings_select_own" on public.bookings;

create policy "bookings_select_own"
on public.bookings
for select
to authenticated
using (
    user_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "bookings_insert_own" on public.bookings;

create policy "bookings_insert_own"
on public.bookings
for insert
to authenticated
with check (
    user_id = auth.uid()
);


drop policy if exists "bookings_update_own" on public.bookings;

create policy "bookings_update_own"
on public.bookings
for update
to authenticated
using (
    user_id = auth.uid()
    or public.is_admin()
)
with check (
    user_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "bookings_admin_delete" on public.bookings;

create policy "bookings_admin_delete"
on public.bookings
for delete
to authenticated
using (
    public.is_admin()
);


-- ============================================================
-- 35. PAYMENTS RLS
-- ============================================================

drop policy if exists "payments_select_own" on public.payments;

create policy "payments_select_own"
on public.payments
for select
to authenticated
using (
    user_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "payments_insert_own" on public.payments;

create policy "payments_insert_own"
on public.payments
for insert
to authenticated
with check (
    user_id = auth.uid()
);


drop policy if exists "payments_admin_manage" on public.payments;

create policy "payments_admin_manage"
on public.payments
for update
to authenticated
using (
    public.is_admin()
)
with check (
    public.is_admin()
);


-- ============================================================
-- 36. REVIEWS RLS
-- ============================================================

drop policy if exists "reviews_public_read" on public.reviews;

create policy "reviews_public_read"
on public.reviews
for select
to anon, authenticated
using (
    status = 'published'
    or user_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "reviews_insert_own" on public.reviews;

create policy "reviews_insert_own"
on public.reviews
for insert
to authenticated
with check (
    user_id = auth.uid()
);


drop policy if exists "reviews_update_own" on public.reviews;

create policy "reviews_update_own"
on public.reviews
for update
to authenticated
using (
    user_id = auth.uid()
    or public.is_admin()
)
with check (
    user_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "reviews_delete_own" on public.reviews;

create policy "reviews_delete_own"
on public.reviews
for delete
to authenticated
using (
    user_id = auth.uid()
    or public.is_admin()
);


-- ============================================================
-- 37. POINT TRANSACTIONS RLS
-- ============================================================

drop policy if exists "points_select_own" on public.point_transactions;

create policy "points_select_own"
on public.point_transactions
for select
to authenticated
using (
    user_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "points_admin_manage" on public.point_transactions;

create policy "points_admin_manage"
on public.point_transactions
for all
to authenticated
using (
    public.is_admin()
)
with check (
    public.is_admin()
);


-- ============================================================
-- 38. REWARDS RLS
-- ============================================================

drop policy if exists "rewards_public_read" on public.rewards;

create policy "rewards_public_read"
on public.rewards
for select
to anon, authenticated
using (
    is_active = true
    or public.is_admin()
);


drop policy if exists "rewards_admin_manage" on public.rewards;

create policy "rewards_admin_manage"
on public.rewards
for all
to authenticated
using (
    public.is_admin()
)
with check (
    public.is_admin()
);


-- ============================================================
-- 39. REWARD REDEMPTIONS RLS
-- ============================================================

drop policy if exists "redemptions_select_own" on public.reward_redemptions;

create policy "redemptions_select_own"
on public.reward_redemptions
for select
to authenticated
using (
    user_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "redemptions_insert_own" on public.reward_redemptions;

create policy "redemptions_insert_own"
on public.reward_redemptions
for insert
to authenticated
with check (
    user_id = auth.uid()
);


drop policy if exists "redemptions_admin_manage" on public.reward_redemptions;

create policy "redemptions_admin_manage"
on public.reward_redemptions
for update
to authenticated
using (
    public.is_admin()
)
with check (
    public.is_admin()
);


-- ============================================================
-- 40. COMMUNITY CATEGORIES RLS
-- ============================================================

drop policy if exists "categories_public_read" on public.community_categories;

create policy "categories_public_read"
on public.community_categories
for select
to anon, authenticated
using (true);


drop policy if exists "categories_admin_manage" on public.community_categories;

create policy "categories_admin_manage"
on public.community_categories
for all
to authenticated
using (
    public.is_admin()
)
with check (
    public.is_admin()
);


-- ============================================================
-- 41. COMMUNITY POSTS RLS
-- ============================================================

drop policy if exists "posts_public_read" on public.community_posts;

create policy "posts_public_read"
on public.community_posts
for select
to anon, authenticated
using (
    status = 'published'
    or user_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "posts_insert_own" on public.community_posts;

create policy "posts_insert_own"
on public.community_posts
for insert
to authenticated
with check (
    user_id = auth.uid()
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
    user_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "posts_delete_own" on public.community_posts;

create policy "posts_delete_own"
on public.community_posts
for delete
to authenticated
using (
    user_id = auth.uid()
    or public.is_admin()
);


-- ============================================================
-- 42. POST IMAGES RLS
-- ============================================================

drop policy if exists "post_images_public_read" on public.post_images;

create policy "post_images_public_read"
on public.post_images
for select
to anon, authenticated
using (true);


drop policy if exists "post_images_owner_manage" on public.post_images;

create policy "post_images_owner_manage"
on public.post_images
for all
to authenticated
using (
    exists (
        select 1
        from public.community_posts p
        where p.id = post_images.post_id
        and (
            p.user_id = auth.uid()
            or public.is_admin()
        )
    )
)
with check (
    exists (
        select 1
        from public.community_posts p
        where p.id = post_images.post_id
        and (
            p.user_id = auth.uid()
            or public.is_admin()
        )
    )
);


-- ============================================================
-- 43. COMMUNITY COMMENTS RLS
-- ============================================================

drop policy if exists "comments_public_read" on public.community_comments;

create policy "comments_public_read"
on public.community_comments
for select
to anon, authenticated
using (
    status = 'published'
    or user_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "comments_insert_own" on public.community_comments;

create policy "comments_insert_own"
on public.community_comments
for insert
to authenticated
with check (
    user_id = auth.uid()
);


drop policy if exists "comments_update_own" on public.community_comments;

create policy "comments_update_own"
on public.community_comments
for update
to authenticated
using (
    user_id = auth.uid()
    or public.is_admin()
)
with check (
    user_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "comments_delete_own" on public.community_comments;

create policy "comments_delete_own"
on public.community_comments
for delete
to authenticated
using (
    user_id = auth.uid()
    or public.is_admin()
);


-- ============================================================
-- 44. POST LIKES RLS
-- ============================================================

drop policy if exists "likes_public_read" on public.post_likes;

create policy "likes_public_read"
on public.post_likes
for select
to anon, authenticated
using (true);


drop policy if exists "likes_insert_own" on public.post_likes;

create policy "likes_insert_own"
on public.post_likes
for insert
to authenticated
with check (
    user_id = auth.uid()
);


drop policy if exists "likes_delete_own" on public.post_likes;

create policy "likes_delete_own"
on public.post_likes
for delete
to authenticated
using (
    user_id = auth.uid()
);


-- ============================================================
-- 45. BOOKMARK RLS
-- ============================================================

drop policy if exists "bookmarks_select_own" on public.post_bookmarks;

create policy "bookmarks_select_own"
on public.post_bookmarks
for select
to authenticated
using (
    user_id = auth.uid()
);


drop policy if exists "bookmarks_insert_own" on public.post_bookmarks;

create policy "bookmarks_insert_own"
on public.post_bookmarks
for insert
to authenticated
with check (
    user_id = auth.uid()
);


drop policy if exists "bookmarks_delete_own" on public.post_bookmarks;

create policy "bookmarks_delete_own"
on public.post_bookmarks
for delete
to authenticated
using (
    user_id = auth.uid()
);


-- ============================================================
-- 46. REPORTS RLS
-- ============================================================

drop policy if exists "reports_insert_own" on public.community_reports;

create policy "reports_insert_own"
on public.community_reports
for insert
to authenticated
with check (
    reporter_id = auth.uid()
);


drop policy if exists "reports_select_own" on public.community_reports;

create policy "reports_select_own"
on public.community_reports
for select
to authenticated
using (
    reporter_id = auth.uid()
    or public.is_admin()
);


drop policy if exists "reports_admin_manage" on public.community_reports;

create policy "reports_admin_manage"
on public.community_reports
for update
to authenticated
using (
    public.is_admin()
)
with check (
    public.is_admin()
);


-- ============================================================
-- 47. USER FOLLOWS RLS
-- ============================================================

drop policy if exists "follows_public_read" on public.user_follows;

create policy "follows_public_read"
on public.user_follows
for select
to anon, authenticated
using (true);


drop policy if exists "follows_insert_own" on public.user_follows;

create policy "follows_insert_own"
on public.user_follows
for insert
to authenticated
with check (
    follower_id = auth.uid()
);


drop policy if exists "follows_delete_own" on public.user_follows;

create policy "follows_delete_own"
on public.user_follows
for delete
to authenticated
using (
    follower_id = auth.uid()
);


-- ============================================================
-- 48. NOTIFICATIONS RLS
-- ============================================================

drop policy if exists "notifications_select_own" on public.notifications;

create policy "notifications_select_own"
on public.notifications
for select
to authenticated
using (
    user_id = auth.uid()
);


drop policy if exists "notifications_update_own" on public.notifications;

create policy "notifications_update_own"
on public.notifications
for update
to authenticated
using (
    user_id = auth.uid()
)
with check (
    user_id = auth.uid()
);


drop policy if exists "notifications_admin_insert" on public.notifications;

create policy "notifications_admin_insert"
on public.notifications
for insert
to authenticated
with check (
    public.is_admin()
);


-- ============================================================
-- 49. NEWS RLS
-- ============================================================

drop policy if exists "news_public_read" on public.news;

create policy "news_public_read"
on public.news
for select
to anon, authenticated
using (
    status = 'published'
    or public.is_admin()
);


drop policy if exists "news_admin_manage" on public.news;

create policy "news_admin_manage"
on public.news
for all
to authenticated
using (
    public.is_admin()
)
with check (
    public.is_admin()
);


-- ============================================================
-- 50. INITIAL SPORTS
-- ============================================================

insert into public.sports (name, description)
values
    ('ฟุตบอล', 'กีฬาฟุตบอล'),
    ('ฟุตซอล', 'กีฬาฟุตซอล'),
    ('บาสเกตบอล', 'กีฬาบาสเกตบอล'),
    ('แบดมินตัน', 'กีฬาแบดมินตัน'),
    ('เทนนิส', 'กีฬาเทนนิส'),
    ('วอลเลย์บอล', 'กีฬาวอลเลย์บอล')
on conflict (name) do nothing;


-- ============================================================
-- 51. INITIAL COMMUNITY CATEGORIES
-- ============================================================

insert into public.community_categories
    (name, description)
values
    ('พูดคุยทั่วไป', 'พูดคุยเรื่องกีฬาและหัวข้อต่าง ๆ'),
    ('หาเพื่อนเล่นกีฬา', 'หาเพื่อนหรือผู้เล่นร่วมกิจกรรม'),
    ('หาคนร่วมทีม', 'หาสมาชิกเข้าร่วมทีม'),
    ('กิจกรรมกีฬา', 'ประกาศและพูดคุยเกี่ยวกับกิจกรรมกีฬา'),
    ('เทคนิคกีฬา', 'แชร์เทคนิคและความรู้ด้านกีฬา'),
    ('ซื้อขายอุปกรณ์', 'ซื้อขายหรือแลกเปลี่ยนอุปกรณ์กีฬา'),
    ('ข่าวสารกีฬา', 'ข่าวสารและเหตุการณ์ด้านกีฬา')
on conflict (name) do nothing;


-- ============================================================
-- DONE
-- ============================================================
