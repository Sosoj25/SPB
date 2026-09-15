// เรื่องติดต่อเรา — ฝั่งลูกค้า ฝั่งแอดมิน และป้ายตัวเลขคำตอบที่ยังไม่ได้อ่าน
//
// ทุกตัวฟัง Realtime ผ่าน useSupportRealtimeTick ทั้งสองฝั่งจึงเห็นข้อความใหม่
// โดยไม่ต้องรีเฟรชหน้า
import { useEffect, useState } from "react";
import { useAuth } from "../context/useAuth";
import { useAsyncData } from "./useAsyncData";
import {
  ADMIN_SUPPORT_PAGE_SIZE,
  fetchAdminSupportStats,
  fetchAdminSupportTickets,
  fetchMySupportTickets,
  fetchSupportContactSettings,
  fetchUnreadSupportReplies,
  subscribeToSupportThreads,
} from "../lib/support";
import { subscribeToNotifications } from "../lib/notifications";

const EMPTY_TICKETS = [];
const EMPTY_TICKETS_PAGE = { tickets: EMPTY_TICKETS, hasMore: false };
const EMPTY_STATS = {
  total: 0,
  new: 0,
  pending: 0,
  closed: 0,
  repliedToday: 0,
  avgResponseHours: null,
};

// นับรอบทุกครั้งที่มีข้อความ/เรื่องติดต่อเปลี่ยนเข้ามาทาง Realtime (0097) แล้ว
// เอาไปผสมเป็น key ของ useAsyncData ให้ยิงดึงใหม่เอง — pattern เดียวกับ
// useNotificationsTick ใน useNotifications.js
//
// ใช้ตัวเดียวกันได้ทั้งสองฝั่งเพราะ RLS เป็นคนกรองว่าใครได้ event ไหน ฝั่งลูกค้า
// จะถูกปลุกเฉพาะตอนเรื่องของตัวเองขยับ ไม่ใช่ทุกครั้งที่มีคนอื่นส่งเรื่องเข้ามา
export function useSupportRealtimeTick() {
  const [tick, setTick] = useState(0);

  useEffect(() => subscribeToSupportThreads(() => setTick((value) => value + 1)), []);

  return tick;
}

// เรื่องที่ผู้ใช้คนนี้เคยส่งเข้ามา — reloadKey ให้หน้าที่เรียกเพิ่มค่าเองหลัง
// ส่งเรื่องใหม่/ตอบกลับ ส่วน tick มาจาก Realtime ตอนแอดมินตอบกลับมา
export function useMySupportTickets(reloadKey = 0, limit = 10) {
  const { user } = useAuth();
  const userId = user?.id;
  const tick = useSupportRealtimeTick();

  const { data, loading, error } = useAsyncData(
    () => fetchMySupportTickets(userId, limit),
    userId ? `support-tickets:${userId}:${limit}:${reloadKey}:${tick}` : null,
    EMPTY_TICKETS,
    // เธรดที่กางอยู่ต้องไม่วูบเป็น "กำลังโหลด" ทุกครั้งที่อีกฝ่ายพิมพ์ตอบ —
    // tick เป็นคำถามเดิม (ขอข้อมูลชุดเดิมใหม่) ไม่ใช่คำถามใหม่
    { keepPreviousData: true },
  );

  return { tickets: data, loading, error };
}

export function useAdminSupportTickets({
  status,
  query,
  page = 1,
  limit = ADMIN_SUPPORT_PAGE_SIZE,
  reloadKey = 0,
}) {
  const tick = useSupportRealtimeTick();

  const { data, loading, error } = useAsyncData(
    () => fetchAdminSupportTickets({ status, query, page, limit }),
    `admin-support:${status ?? ""}:${query ?? ""}:${page}:${limit}:${reloadKey}:${tick}`,
    EMPTY_TICKETS_PAGE,
    { keepPreviousData: true },
  );

  return { tickets: data.tickets, hasMore: data.hasMore, loading, error };
}

export function useAdminSupportStats(reloadKey = 0) {
  const tick = useSupportRealtimeTick();

  const { data, loading, error } = useAsyncData(
    fetchAdminSupportStats,
    `admin-support-stats:${reloadKey}:${tick}`,
    EMPTY_STATS,
    { keepPreviousData: true },
  );

  return { stats: data, loading, error };
}

// ค่าตั้งต้นระหว่างรอโหลด — ปล่อยว่างทั้งหมดแทนการใส่เบอร์/ที่อยู่หลอกไว้
// เพราะการ์ดช่องทางที่ค่าว่างจะถูกซ่อน (buildContactChannels) ดีกว่าให้ผู้ใช้
// เห็นข้อมูลติดต่อชุดหนึ่งแวบหนึ่งแล้วสลับเป็นอีกชุดตอนข้อมูลจริงมาถึง
const EMPTY_CONTACT_SETTINGS = {
  phone: "",
  phoneHint: "",
  email: "",
  emailHint: "",
  lineId: "",
  lineHint: "",
  lineUrl: "",
  officeAddress: "",
  mapUrl: "",
};

export function useSupportContactSettings(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchSupportContactSettings,
    `support-contact-settings:${reloadKey}`,
    EMPTY_CONTACT_SETTINGS,
  );

  return { settings: data, loading, error };
}

const EMPTY_UNREAD = { count: 0, byTicket: new Map(), latestTicketId: null };

// ป้ายตัวเลขข้างเมนู "ติดต่อเรา" ใน AppHeader และตัวชี้ว่าของใหม่มาจากเรื่องไหน
// (byTicket) สำหรับไฮไลต์เธรดในหน้าติดต่อเรา — ฟังตาราง notifications (0065)
// ไม่ใช่ตารางเธรด เพราะสิ่งที่ต้องบอกคือ "มีคำตอบที่ยังไม่ได้อ่าน" ซึ่งจะหายไป
// ตอนลูกค้ากางเธรดอ่าน (markSupportTicketNotificationsRead) ไม่ใช่ตอนมีข้อความ
// ใหม่เฉย ๆ
export function useUnreadSupportReplies(userId) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribeToNotifications(userId, () => setTick((value) => value + 1));
  }, [userId]);

  const { data } = useAsyncData(
    () => fetchUnreadSupportReplies(userId),
    userId ? `support-unread:${userId}:${tick}` : null,
    EMPTY_UNREAD,
    { keepPreviousData: true },
  );

  return data;
}
