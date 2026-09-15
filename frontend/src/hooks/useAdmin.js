// ข้อมูลของแดชบอร์ดแอดมิน/ซูเปอร์แอดมิน — ตัวเลขสรุป กราฟรายได้ รายการจอง
// ผู้ใช้ เช็คอิน และตัวเลขคิวค้างข้างเมนู
import { useEffect, useState } from "react";
import { useAsyncData } from "./useAsyncData";
import {
  ADMIN_BOOKING_PAGE_SIZE,
  ADMIN_USER_PAGE_SIZE,
  fetchAdminBookings,
  fetchAdminOverviewStats,
  fetchAdminQueueCounts,
  fetchAdminRevenueBucketDetail,
  fetchAdminRevenueSeries,
  fetchSuperAdminOverviewStats,
  fetchUserRoleCounts,
  fetchUsers,
  searchCustomers,
} from "../lib/admin";
import { fetchAdminCheckins } from "../lib/checkin";
import { fetchDaySlots, fetchMonthSlotSummary } from "../lib/schedule";
import {
  ADMIN_PAYMENT_PAGE_SIZE,
  fetchAdminPaymentStats,
  fetchAdminPayments,
} from "../lib/payments";
import {
  ADMIN_REFUND_PAGE_SIZE,
  fetchAdminRefundStats,
  fetchAdminRefunds,
} from "../lib/refunds";
import { useSupportRealtimeTick } from "./useSupport";

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

const EMPTY_REVENUE_SERIES = { rows: [], hasOlder: false };
const EMPTY_REVENUE_DETAIL = [];

export function useAdminRevenueSeries(scale, offset = 0) {
  const { data, loading, error } = useAsyncData(
    () => fetchAdminRevenueSeries(scale, offset),
    `admin-revenue-series:${scale}:${offset}`,
    EMPTY_REVENUE_SERIES,
  );

  return { series: data.rows, hasOlder: data.hasOlder, loading, error };
}

// bucket = null ตอนที่ยังไม่ได้เปิดกล่องรายละเอียด — useAsyncData ข้าม query
// ให้เองเมื่อ key เป็น null จึงไม่ต้องมี state แยกว่า "โหลดหรือยัง"
export function useAdminRevenueBucketDetail(scale, bucket) {
  const { data, loading, error } = useAsyncData(
    () => fetchAdminRevenueBucketDetail(scale, bucket),
    bucket ? `admin-revenue-detail:${scale}:${bucket}` : null,
    EMPTY_REVENUE_DETAIL,
  );

  return { rows: data, loading, error };
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

const EMPTY_REFUNDS_PAGE = { refunds: [], hasMore: false };

export function useAdminRefunds({
  status,
  page = 1,
  limit = ADMIN_REFUND_PAGE_SIZE,
  reloadKey = 0,
}) {
  const { data, loading, error } = useAsyncData(
    () => fetchAdminRefunds({ status, page, limit }),
    `admin-refunds:${status ?? ""}:${page}:${limit}:${reloadKey}`,
    EMPTY_REFUNDS_PAGE,
  );

  return { refunds: data.refunds, hasMore: data.hasMore, loading, error };
}

export function useAdminRefundStats(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchAdminRefundStats,
    `admin-refund-stats:${reloadKey}`,
  );

  return { stats: data, loading, error };
}

// ค้นหาลูกค้าเพื่อปรับแต้ม — key เป็น null ตอนยังไม่พิมพ์อะไร (useAsyncData
// ไม่ยิง query) กันไม่ให้โหลดลูกค้าทั้งระบบมาก่อนที่แอดมินจะพิมพ์คำค้นหา
export function useCustomerSearch(query, reloadKey = 0) {
  const trimmed = query.trim();
  const key = trimmed ? `customer-search:${trimmed}:${reloadKey}` : null;

  const { data, loading, error } = useAsyncData(
    () => searchCustomers(trimmed),
    key,
    EMPTY_USERS_PAGE,
  );

  return { customers: data.users, loading, error };
}

const EMPTY_CHECKINS = [];

export function useAdminCheckins(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchAdminCheckins,
    `admin-checkins:${reloadKey}`,
    EMPTY_CHECKINS,
  );

  return { entries: data, loading, error };
}

const EMPTY_QUEUE_COUNTS = {
  payments: 0,
  refunds: 0,
  rewardRequests: 0,
  reports: 0,
  newReports24h: 0,
  support: 0,
};

const QUEUE_REFRESH_MS = 60_000;

// เด้งตัวเลขคิวเองเป็นระยะ ๆ โดยไม่ยิงตอนแท็บถูกซ่อนอยู่ (แอดมินเปิดหน้าเดิม
// ค้างไว้ทั้งวันเป็นเรื่องปกติ ถ้าต้องกดเปลี่ยนหน้าก่อนถึงจะรู้ว่ามีสลิปใหม่เข้ามา
// ป้ายแจ้งเตือนก็แทบไม่มีความหมาย) แล้วยิงทันทีหนึ่งรอบตอนสลับกลับเข้ามาที่แท็บ
// เพื่อให้เลขแรกที่เห็นเป็นของจริง ไม่ใช่ของเมื่อชั่วโมงที่แล้ว
function useRefreshTick(intervalMs) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    const timer = setInterval(() => {
      if (!document.hidden) bump();
    }, intervalMs);
    const handleVisibility = () => {
      if (!document.hidden) bump();
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs]);

  return tick;
}

// ยอดคิวค้างของทุกหมวดในแถบซ้าย — เรียกที่ DashboardLayout ที่เดียว แล้วส่งต่อ
// ให้ทั้งป้ายข้างเมนูและกระดิ่งบนหัวใช้ชุดเดียวกัน ตัวเลขสองที่จะได้ไม่ขัดกันเอง
//
// keepPreviousData เพราะ tick ที่เพิ่มทุกนาทีคือ "คำถามเดิม" ไม่ใช่คำถามใหม่
// ถ้าไม่คงค่าเดิมไว้ ป้ายตัวเลขทั้งแถบจะวูบหายทุกนาทีระหว่างรอรอบใหม่กลับมา
// supportTick มาจาก Realtime ของเธรดติดต่อ (0097) — เรื่องที่ลูกค้าเพิ่งส่งเข้ามา
// ต้องขึ้นป้ายตัวเลขในแถบซ้ายกับกระดิ่งทันที ไม่ใช่รอรอบรีเฟรชนาทีถัดไป
// เพราะลูกค้าที่กำลังนั่งรออยู่หน้าเว็บจะรู้สึกได้ทันทีว่าช้าไปหนึ่งนาทีเต็ม
export function useAdminQueueCounts(reloadKey = 0) {
  const tick = useRefreshTick(QUEUE_REFRESH_MS);
  const supportTick = useSupportRealtimeTick();

  const { data, loading, error } = useAsyncData(
    fetchAdminQueueCounts,
    `admin-queue-counts:${reloadKey}:${tick}:${supportTick}`,
    EMPTY_QUEUE_COUNTS,
    { keepPreviousData: true },
  );

  return { counts: data, loading, error };
}
