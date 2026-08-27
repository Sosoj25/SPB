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
import { fetchDaySlots, fetchMonthSlotSummary } from "../lib/schedule";
import {
  ADMIN_PAYMENT_PAGE_SIZE,
  fetchAdminPaymentStats,
  fetchAdminPayments,
} from "../lib/payments";

const EMPTY_BOOKINGS_PAGE = { bookings: [], hasMore: false };
const EMPTY_USERS_PAGE = { users: [], hasMore: false };
const EMPTY_MONTH_SUMMARY = new Map();

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

// facilityId เป็น null ระหว่างที่ยังโหลดรายการสนามอยู่ — key เป็น null ทำให้
// useAsyncData ไม่ยิง query จนกว่าจะมี facility ให้เลือกจริง (ดู useAsyncData.js)
export function useAdminScheduleMonth(facilityId, year, month, reloadKey = 0) {
  const key = facilityId != null ? `schedule-month:${facilityId}:${year}:${month}:${reloadKey}` : null;

  const { data, loading, error } = useAsyncData(
    () => fetchMonthSlotSummary(facilityId, year, month),
    key,
    EMPTY_MONTH_SUMMARY,
  );

  return { summary: data, loading, error };
}

export function useAdminDaySlots(facilityId, date, reloadKey = 0) {
  const key = facilityId != null && date ? `schedule-day:${facilityId}:${date}:${reloadKey}` : null;

  const { data, loading, error } = useAsyncData(() => fetchDaySlots(facilityId, date), key, []);

  return { slots: data, loading, error };
}

const EMPTY_PAYMENTS_PAGE = { payments: [], hasMore: false };

export function useAdminPayments({
  status,
  page = 1,
  limit = ADMIN_PAYMENT_PAGE_SIZE,
  reloadKey = 0,
}) {
  const { data, loading, error } = useAsyncData(
    () => fetchAdminPayments({ status, page, limit }),
    `admin-payments:${status ?? ""}:${page}:${limit}:${reloadKey}`,
    EMPTY_PAYMENTS_PAGE,
  );

  return { payments: data.payments, hasMore: data.hasMore, loading, error };
}

export function useAdminPaymentStats(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchAdminPaymentStats,
    `admin-payment-stats:${reloadKey}`,
  );

  return { stats: data, loading, error };
}
