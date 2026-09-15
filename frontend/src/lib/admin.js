// งานหลังบ้านของแอดมิน/ซูเปอร์แอดมิน — ตัวเลขสรุป กราฟรายได้ รายการจอง
// ผู้ใช้ และตัวเลขคิวค้างที่โชว์ข้างเมนู
//
// การชำระเงิน/คืนเงิน/ของรางวัล/ชุมชน/ติดต่อเรา แยกอยู่คนละไฟล์ ที่นี่ import
// เฉพาะ "ตัวนับคิว" ของแต่ละหมวดมารวมให้แถบเมนูใช้ (ดูหัวข้อสุดท้ายของไฟล์)
import { supabase } from "./supabase";
import { escapeSearchTerm } from "./searchTerm";
import { fetchAdminStats as fetchAdminCommunityStats } from "./adminCommunity";
import { fetchAdminPaymentStats } from "./payments";
import { fetchAdminRefundStats } from "./refunds";
import { fetchAdminFulfillmentStats } from "./rewards";
import { fetchAdminSupportPendingCount } from "./support";

// RPC ที่ returns table เดียวคืนมาเป็น array 1 แถวเสมอ — แกะให้เหลือ object
function firstRow(data) {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export async function fetchAdminOverviewStats() {
  const { data, error } = await supabase.rpc("admin_overview_stats");

  if (error) throw error;

  const stats = firstRow(data) ?? {
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
  };
}

export const ADMIN_REVENUE_SCALES = ["day", "week", "month", "year"];

// ข้อมูลกราฟรายได้ทีละหน้า
//
// offset 0 = หน้าล่าสุด, 1 = ถอยหลังไปอีกหนึ่งหน้าเต็ม ๆ ไปเรื่อย ๆ
//
// bucket เป็น timestamp ไม่มี tz (เวลาไทยตรง ๆ อยู่แล้ว) ส่งต่อเป็น string ดิบ
// ให้ฝั่งหน้าเว็บ new Date() เองตอน format ป้ายกำกับ
//
// has_older ติดมาทุกแถว (ค่าเดียวกันหมด) — ยกขึ้นมาเป็นค่าเดี่ยวให้หน้าเว็บ
// ใช้ปิดปุ่มย้อนกลับตอนสุดข้อมูลจริง
export async function fetchAdminRevenueSeries(scale, offset = 0) {
  const { data, error } = await supabase.rpc("admin_revenue_series", {
    p_scale: scale,
    p_offset: offset,
  });

  if (error) throw error;

  const rows = data ?? [];

  return {
    rows: rows.map((row) => ({
      bucket: row.bucket,
      revenue: Number(row.revenue),
    })),
    hasOlder: rows[0]?.has_older ?? false,
  };
}

// รายละเอียดของแท่งเดียวในกราฟรายได้ — bucket ต้องส่งสตริงเดิมที่
// admin_revenue_series() คืนมา (timestamp ไม่มี tz) ฝั่ง RPC จะได้ตัดช่วงตรงกับ
// แท่งที่ผู้ใช้กดเป๊ะ ไม่ต้องเดาขอบเขตซ้ำสองฝั่ง
export async function fetchAdminRevenueBucketDetail(scale, bucket) {
  const { data, error } = await supabase.rpc("admin_revenue_bucket_detail", {
    p_scale: scale,
    p_bucket: bucket,
  });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    facilityId: row.facility_id,
    facilityName: row.facility_name,
    sportName: row.sport_name,
    bookingsCount: Number(row.bookings_count),
    paymentsCount: Number(row.payments_count),
    revenue: Number(row.revenue),
  }));
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
//
// ต้องระบุ !bookings_xxx_fkey ตรง ๆ ทุกเส้น เพราะ bookings มี FK ไปหา profiles
// ถึง 4 เส้นแล้ว (user_id, checked_in_by, checked_out_by ตั้งแต่ 0038 และ
// cancelled_by ตั้งแต่ 0069) PostgREST เดาไม่ได้ว่าจะ join ผ่านเส้นไหนถ้าไม่
// ระบุ — ตั้งชื่อ alias แยกให้แต่ละเส้นเพราะ embed ตารางเดียวกันซ้ำในคิวรีเดียว
//
// เพิ่ม payments มาด้วยเพื่อโชว์เหตุผล/แอดมินที่ปฏิเสธการชำระเงิน (rejection_
// reason, verified_by) — หนึ่ง booking มีได้หลายแถว payments ถ้าลูกค้าโดน
// ปฏิเสธแล้วจ่ายใหม่ จึงต้อง order by created_at desc (สั่งที่ query ด้านล่าง
// ไม่ใช่ในสตริงนี้) แล้วให้ฝั่งหน้าเว็บหยิบแถวล่าสุดที่ status='rejected' เอง
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
  is_walk_in,
  walk_in_name,
  walk_in_phone,
  checked_in_at,
  checked_out_at,
  cancelled_at,
  cancel_reason,
  profiles!bookings_user_id_fkey ( username, full_name ),
  checked_in_by_profile:profiles!bookings_checked_in_by_fkey ( username, full_name ),
  checked_out_by_profile:profiles!bookings_checked_out_by_fkey ( username, full_name ),
  cancelled_by_profile:profiles!bookings_cancelled_by_fkey ( username, full_name ),
  payments (
    status,
    rejection_reason,
    verified_at,
    created_at,
    rejected_by_profile:profiles!payments_verified_by_fkey ( username, full_name )
  ),
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
    .order("start_time", { ascending: false })
    .order("created_at", { ascending: false, foreignTable: "payments" });

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

// รายชื่อผู้ใช้สำหรับหน้าจัดการผู้ใช้ — ขอเกินมา 1 แถวเพื่อรู้ว่ามีหน้าถัดไปไหม
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

// ค้นหาลูกค้าเพื่อปรับแต้ม — ใช้ query เดียวกับ fetchUsers แต่จำกัดเฉพาะ role
// "customer" และจำนวนผลลัพธ์น้อย ๆ (ดูปุ่ม "ปรับแต้ม" ใน AdminRewards)
export async function searchCustomers(query, limit = 5) {
  return fetchUsers({ role: "customer", query, page: 1, limit });
}

// ค้นหาสมาชิกเดิมด้วยเบอร์โทร — ใช้ในหน้ารับลูกค้า Walk-in (AdminWalkIn)
// ต่างจาก searchCustomers (ค้นด้วยชื่อ/username) เพราะที่เคาน์เตอร์แอดมินมัก
// มีแค่เบอร์โทรที่ลูกค้าบอก ไม่รู้ username เดิม — profiles_admin_all (RLS)
// ให้แอดมินอ่านทุกแถวอยู่แล้ว เหมือน fetchUsers
export async function searchCustomersByPhone(phone, limit = 5) {
  const term = escapeSearchTerm(phone);
  if (!term) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, phone")
    .eq("role", "customer")
    .ilike("phone", `%${term}%`)
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// ให้/หักแต้มลูกค้าตรง ๆ ต้องผ่าน RPC เหมือนของรางวัลอื่น ๆ เพราะ points ถูก
// ล็อกไม่ให้แก้ผ่าน .update() ตรง ๆ ตั้งแต่ 0002 — ดู admin_adjust_points (0050)
export async function adjustUserPoints(userId, amount, reason) {
  const { data, error } = await supabase.rpc("admin_adjust_points", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
  });

  if (error) throw error;

  return data;
}

// ---------- ตัวเลขคิวค้างของทุกหมวดในแถบซ้าย (DashboardLayout) ----------

// ยิงรวดเดียวจากที่เดียว แล้วแจกให้ทั้ง badge ข้างเมนูและกระดิ่งบนหัวใช้ร่วมกัน
// ถ้าปล่อยให้แต่ละจุดเรียก hook ของตัวเอง RPC ชุดเดียวกันจะถูกยิงซ้ำสองรอบ
// ทุกครั้งที่แอดมินเปลี่ยนหน้า
//
// allSettled ไม่ใช่ all เพราะคิวหนึ่งพัง (เช่น RPC ของรางวัลถูกถอนสิทธิ์) ไม่ควร
// ลบเลขของอีกสามคิวที่ยังอ่านได้ทิ้งไปด้วย — อันที่พังคืน 0 แล้ว log ไว้เฉย ๆ
function queueValue(result, pick) {
  if (result.status === "fulfilled") return pick(result.value) ?? 0;

  console.error("Supabase query failed:", result.reason);
  return 0;
}

export async function fetchAdminQueueCounts() {
  const [payments, refunds, rewardRequests, community, support] = await Promise.allSettled([
    fetchAdminPaymentStats(),
    fetchAdminRefundStats(),
    fetchAdminFulfillmentStats(),
    fetchAdminCommunityStats(),
    fetchAdminSupportPendingCount(),
  ]);

  return {
    payments: queueValue(payments, (stats) => stats.pendingCount),
    refunds: queueValue(refunds, (stats) => stats.pendingCount),
    rewardRequests: queueValue(rewardRequests, (stats) => stats.pendingCount),
    reports: queueValue(community, (stats) => stats.pendingReports),
    newReports24h: queueValue(community, (stats) => stats.newReports24h),
    // เรื่องติดต่อที่ยังไม่ปิด (0096) — คิวนี้คืนตัวเลขมาตรง ๆ ไม่ใช่ object
    // สรุปเหมือนคิวอื่น จึงส่ง identity ให้ queueValue
    support: queueValue(support, (count) => count),
  };
}
