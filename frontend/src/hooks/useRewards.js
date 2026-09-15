// ของรางวัลและแต้มสะสม — แคตตาล็อก/ประวัติของลูกค้า และคิวจัดของฝั่งแอดมิน
import { useAsyncData } from "./useAsyncData";
import {
  ADMIN_HISTORY_PAGE_SIZE,
  ADMIN_REQUEST_PAGE_SIZE,
  HISTORY_PAGE_SIZE,
  fetchAdminFulfillmentStats,
  fetchAdminRedemptionHistory,
  fetchAdminRedemptionStats,
  fetchAdminRewardRequests,
  fetchAdminRewardStats,
  fetchMyRedemptions,
  fetchPendingReceiptCount,
  fetchRewardById,
  fetchRewardCatalog,
  fetchRewardSettings,
  fetchShipmentEvents,
  fetchUsableCoupons,
} from "../lib/rewards";

const EMPTY = [];
const EMPTY_REQUESTS_PAGE = { requests: [], hasMore: false };
const EMPTY_HISTORY_PAGE = { redemptions: [], hasMore: false };
const EMPTY_ADMIN_HISTORY_PAGE = { rows: [], total: 0, hasMore: false };

// reloadKey ให้หน้าที่เรียกเพิ่มค่าเองหลังกดแลก/แก้ไข เพื่อบังคับดึงใหม่ —
// pattern เดียวกับ useAdminBookings/useCommunityFeed
export function useRewardCatalog(category, reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    () => fetchRewardCatalog(category),
    `reward-catalog:${category ?? ""}:${reloadKey}`,
    EMPTY,
  );

  return { rewards: data, loading, error };
}

// keepPreviousData: true — หน้ารายละเอียด bump reloadKey หลังแลกสำเร็จเพื่อดึง
// ยอดคงเหลือ/โควตาใหม่ ซึ่งยังเป็น "คำถามเดิม" (ของรางวัลชิ้นเดิม) การ์ดจึงไม่
// ควรหายไปเป็นหน้าโหลดระหว่างนั้น
export function useReward(id, reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    () => fetchRewardById(id),
    id != null ? `reward:${id}:${reloadKey}` : null,
    null,
    { keepPreviousData: true },
  );

  return { reward: data, loading, error };
}

export function useMyRedemptions(userId, page = 1, reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    () => fetchMyRedemptions(userId, page, HISTORY_PAGE_SIZE),
    userId ? `my-redemptions:${userId}:${page}:${reloadKey}` : null,
    EMPTY_HISTORY_PAGE,
  );

  return { redemptions: data.redemptions, hasMore: data.hasMore, loading, error };
}

// ของรางวัลที่ส่งถึงแล้วแต่ยังรอลูกค้ากดยืนยัน — คำนวณสดทุกครั้งที่คอมโพเนนต์
// ที่เรียกถูก mount (เปลี่ยนหน้าเมื่อไหร่ก็ได้เลขใหม่) แบบเดียวกับป้ายเตือน
// การจองที่รอชำระเงินใน AppHeader
export function usePendingReceiptCount(userId, reloadKey = 0) {
  const { data } = useAsyncData(
    () => fetchPendingReceiptCount(userId),
    userId ? `pending-receipts:${userId}:${reloadKey}` : null,
    0,
  );

  return data ?? 0;
}

// คูปองที่เอาไปลดค่าสนามได้ตอนนี้ — หน้าชำระเงินใช้
export function useUsableCoupons(userId, reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchUsableCoupons,
    userId ? `usable-coupons:${userId}:${reloadKey}` : null,
    EMPTY,
  );

  return { coupons: data, loading, error };
}

// อัตราแต้มที่แอดมินตั้งไว้ — อ่านได้ทุกคน เพราะหน้าลูกค้าต้องบอกอัตราจริง
export function useRewardSettings(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchRewardSettings,
    `reward-settings:${reloadKey}`,
  );

  return { settings: data, loading, error };
}

export function useAdminRewardStats(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchAdminRewardStats,
    `admin-reward-stats:${reloadKey}`,
  );

  return { stats: data, loading, error };
}

export function useAdminFulfillmentStats(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchAdminFulfillmentStats,
    `admin-fulfillment-stats:${reloadKey}`,
  );

  return { stats: data, loading, error };
}

// ประวัติการแลกทั้งระบบ (แอดมิน) — รวมคูปองที่ไม่ต้องจัดส่งด้วย
export function useAdminRedemptionHistory({
  state,
  category,
  query,
  page = 1,
  limit = ADMIN_HISTORY_PAGE_SIZE,
  reloadKey = 0,
}) {
  const { data, loading, error } = useAsyncData(
    () => fetchAdminRedemptionHistory({ state, category, query, page, limit }),
    `admin-redemption-history:${state ?? ""}:${category ?? ""}:${query ?? ""}:${page}:${limit}:${reloadKey}`,
    EMPTY_ADMIN_HISTORY_PAGE,
  );

  return { rows: data.rows, total: data.total, hasMore: data.hasMore, loading, error };
}

export function useAdminRedemptionStats(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchAdminRedemptionStats,
    `admin-redemption-stats:${reloadKey}`,
  );

  return { stats: data, loading, error };
}

// ไทม์ไลน์การจัดส่งของคูปองใบเดียว — โหลดเฉพาะใบที่ผู้ใช้กดกางดู ไม่ดึงมา
// ทั้งหน้าประวัติ เพราะส่วนใหญ่เป็นคูปองส่วนลดที่ไม่มีการจัดส่งเลย
export function useShipmentEvents(redemptionId, reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    () => fetchShipmentEvents(redemptionId),
    redemptionId ? `shipment-events:${redemptionId}:${reloadKey}` : null,
    EMPTY,
  );

  return { events: data, loading, error };
}

export function useAdminRewardRequests({
  status,
  page = 1,
  limit = ADMIN_REQUEST_PAGE_SIZE,
  reloadKey = 0,
}) {
  const { data, loading, error } = useAsyncData(
    () => fetchAdminRewardRequests({ status, page, limit }),
    `admin-reward-requests:${status ?? ""}:${page}:${limit}:${reloadKey}`,
    EMPTY_REQUESTS_PAGE,
  );

  return { requests: data.requests, hasMore: data.hasMore, loading, error };
}
