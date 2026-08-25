import { supabase } from "./supabase";

// RPC ที่ returns table เดียวคืนมาเป็น array 1 แถวเสมอ — แกะให้เหลือ object
function firstRow(data) {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export async function fetchAdminOverviewStats() {
  const [statsRes, revenueRes] = await Promise.all([
    supabase.rpc("admin_overview_stats"),
    supabase.rpc("admin_revenue_last_7_days"),
  ]);

  if (statsRes.error) throw statsRes.error;
  if (revenueRes.error) throw revenueRes.error;

  const stats = firstRow(statsRes.data) ?? {
    bookings_today: 0,
    revenue_today: 0,
    occupancy_rate: 0,
    pending_payments: 0,
  };

  return {
    bookingsToday: stats.bookings_today,
    revenueToday: Number(stats.revenue_today),
    occupancyRate: Number(stats.occupancy_rate),
    pendingPayments: stats.pending_payments,
    revenueByDay: (revenueRes.data ?? []).map((row) => ({
      day: row.day,
      revenue: Number(row.revenue),
    })),
  };
}

export async function fetchSuperAdminOverviewStats() {
  const [statsRes, venuesRes] = await Promise.all([
    supabase.rpc("superadmin_overview_stats"),
    supabase.rpc("superadmin_venue_breakdown"),
  ]);

  if (statsRes.error) throw statsRes.error;
  if (venuesRes.error) throw venuesRes.error;

  const stats = firstRow(statsRes.data) ?? {
    venues_count: 0,
    users_count: 0,
    admins_count: 0,
    revenue_this_month: 0,
  };

  return {
    venuesCount: stats.venues_count,
    usersCount: stats.users_count,
    adminsCount: stats.admins_count,
    revenueThisMonth: Number(stats.revenue_this_month),
    venues: (venuesRes.data ?? []).map((row) => ({
      id: row.venue_id,
      name: row.venue_name,
      bookingsThisMonth: row.bookings_this_month,
      revenueThisMonth: Number(row.revenue_this_month),
      status: row.status,
    })),
  };
}

// facilities/venues มี RLS ของตัวเอง (สนามที่ปิดอยู่จะ join กลับมาเป็น null)
// เหมือน BOOKING_SELECT ใน lib/bookings.js — เพิ่ม profiles มาโชว์ชื่อผู้จอง
const ADMIN_BOOKING_SELECT = `
  id,
  booking_code,
  booking_date,
  start_time,
  end_time,
  status,
  payment_status,
  total_amount,
  note,
  profiles ( username, full_name ),
  facilities (
    name,
    sports ( name ),
    venues ( name )
  )
`;

export const ADMIN_BOOKING_PAGE_SIZE = 20;

// ขอเกินมา 1 แถวเพื่อรู้ว่ายังมีหน้าถัดไปไหม เหมือน fetchUserBookings
export async function fetchAdminBookings({
  status,
  date,
  page = 1,
  limit = ADMIN_BOOKING_PAGE_SIZE,
} = {}) {
  let query = supabase
    .from("bookings")
    .select(ADMIN_BOOKING_SELECT)
    .order("booking_date", { ascending: false })
    .order("start_time", { ascending: false });

  if (status) query = query.eq("status", status);
  if (date) query = query.eq("booking_date", date);

  const from = (page - 1) * limit;
  const { data, error } = await query.range(from, from + limit);

  if (error) throw error;

  const rows = data ?? [];
  return { bookings: rows.slice(0, limit), hasMore: rows.length > limit };
}

const ADMIN_USER_SELECT = "id, username, full_name, role, is_active, points, created_at";

export const ADMIN_USER_PAGE_SIZE = 20;

// ตัด %, _, ,, ( ) ทิ้งจากคำค้น — .or() ของ supabase-js เป็นสตริง filter ดิบ
// ถ้าปล่อยให้ผู้ใช้พิมพ์ "," หรือ ")" ผ่านเข้าไปได้ จะต่อเงื่อนไข filter
// ใหม่ที่ไม่ตั้งใจเข้าไปในคำสั่งได้ (เช่นแอบเทียบคอลัมน์อื่นที่ไม่ได้ตั้งใจเปิดให้ค้น)
const escapeSearchTerm = (value) => value.replace(/[%_,()]/g, "").trim();

export async function fetchUsers({ role, query, page = 1, limit = ADMIN_USER_PAGE_SIZE } = {}) {
  let q = supabase
    .from("profiles")
    .select(ADMIN_USER_SELECT)
    .order("created_at", { ascending: false });

  if (role) q = q.eq("role", role);

  const term = query ? escapeSearchTerm(query) : "";
  if (term) q = q.or(`username.ilike.%${term}%,full_name.ilike.%${term}%`);

  const from = (page - 1) * limit;
  const { data, error } = await q.range(from, from + limit);

  if (error) throw error;

  const rows = data ?? [];
  return { users: rows.slice(0, limit), hasMore: rows.length > limit };
}

// นับจำนวนผู้ใช้แยกตาม role สำหรับการ์ดสรุปบนหน้า SuperAdminUsers
// ใช้ count: "exact", head: true เพื่อขอแค่ตัวเลข ไม่ต้องโอนข้อมูลแถวจริงมา
export async function fetchUserRoleCounts() {
  const [customerRes, adminRes, superAdminRes] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "customer"),
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "admin"),
    supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "super_admin"),
  ]);

  if (customerRes.error) throw customerRes.error;
  if (adminRes.error) throw adminRes.error;
  if (superAdminRes.error) throw superAdminRes.error;

  return {
    customer: customerRes.count ?? 0,
    admin: adminRes.count ?? 0,
    superAdmin: superAdminRes.count ?? 0,
  };
}

// เปลี่ยน role ต้องผ่าน RPC set_user_role (เช็ค is_super_admin() เข้มกว่า
// is_admin() ที่ RLS ของ profiles ใช้ — กันไม่ให้ admin ธรรมดายกระดับตัวเอง
// เป็น super_admin ผ่าน .update() ตรง ๆ)
export async function updateUserRole(userId, role) {
  const { data, error } = await supabase.rpc("set_user_role", {
    p_user_id: userId,
    p_role: role,
  });

  if (error) throw error;

  return firstRow(data);
}

// ระงับ/เปิดใช้งานบัญชีไม่ใช่การยกระดับสิทธิ์ — profiles_admin_all (RLS)
// อนุญาต admin/super_admin แก้ is_active ของคนอื่นตรง ๆ อยู่แล้ว ไม่ต้องผ่าน RPC
export async function setUserActive(userId, isActive) {
  const { data, error } = await supabase
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", userId)
    .select(ADMIN_USER_SELECT)
    .single();

  if (error) throw error;

  return data;
}
