import { useAsyncData } from "./useAsyncData";
import {
  ADMIN_BOOKING_PAGE_SIZE,
  ADMIN_USER_PAGE_SIZE,
  fetchAdminBookings,
  fetchAdminOverviewStats,
  fetchSuperAdminOverviewStats,
  fetchUserRoleCounts,
  fetchUsers,
} from "../lib/admin";

const EMPTY_BOOKINGS_PAGE = { bookings: [], hasMore: false };
const EMPTY_USERS_PAGE = { users: [], hasMore: false };

export function useAdminOverviewStats() {
  const { data, loading, error } = useAsyncData(
    fetchAdminOverviewStats,
    "admin-overview-stats"
  );

  return { stats: data, loading, error };
}

export function useSuperAdminOverviewStats() {
  const { data, loading, error } = useAsyncData(
    fetchSuperAdminOverviewStats,
    "superadmin-overview-stats"
  );

  return { stats: data, loading, error };
}

// reloadKey ให้หน้าที่เรียกเพิ่มค่าเองหลังทำ action (ยกเลิกการจอง ฯลฯ)
// เพื่อบังคับ useAsyncData ยิงซ้ำ — pattern เดียวกับ BookingReceipt.jsx
export function useAdminBookings({
  status,
  date,
  page = 1,
  limit = ADMIN_BOOKING_PAGE_SIZE,
  reloadKey = 0,
}) {
  const { data, loading, error } = useAsyncData(
    () => fetchAdminBookings({ status, date, page, limit }),
    `admin-bookings:${status ?? ""}:${date ?? ""}:${page}:${limit}:${reloadKey}`,
    EMPTY_BOOKINGS_PAGE
  );

  return { bookings: data.bookings, hasMore: data.hasMore, loading, error };
}

export function useUserRoleCounts(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchUserRoleCounts,
    `user-role-counts:${reloadKey}`
  );

  return { counts: data, loading, error };
}

export function useAdminUsers({
  role,
  query,
  page = 1,
  limit = ADMIN_USER_PAGE_SIZE,
  reloadKey = 0,
}) {
  const { data, loading, error } = useAsyncData(
    () => fetchUsers({ role, query, page, limit }),
    `admin-users:${role ?? ""}:${query ?? ""}:${page}:${limit}:${reloadKey}`,
    EMPTY_USERS_PAGE
  );

  return { users: data.users, hasMore: data.hasMore, loading, error };
}
