// ข่าว — ฝั่งผู้อ่าน (รวมป้าย "ข่าวใหม่") และฝั่งแอดมินที่เขียนข่าว
//
// ฝั่งผู้อ่านฟังการเปลี่ยนแปลงแบบเรียลไทม์ ข่าวที่เพิ่งเผยแพร่จึงโผล่เองโดย
// ไม่ต้องรีเฟรชหน้า
import { useEffect, useMemo, useState } from "react";
import { useAsyncData } from "./useAsyncData";
import {
  ADMIN_NEWS_PAGE_SIZE,
  fetchAdminNews,
  fetchAdminNewsStats,
  fetchNewsById,
  fetchPublicNews,
  fetchPublicNewsById,
  isNewsUnseen,
  loadReadNewsIds,
  subscribeToPublicNews,
} from "../lib/news";

const EMPTY_NEWS_PAGE = { news: [], hasMore: false };
const EMPTY_STATS = { published: 0, draft: 0, scheduled: 0, totalViews: 0 };

// นับรอบทุกครั้งที่มีข่าวเปลี่ยน (เผยแพร่ใหม่/แก้ไข/ลบ) เข้ามาทาง Realtime —
// ผสมเป็น key ให้ useAsyncData ยิง fetchPublicNews ใหม่เอง เหมือน
// useNotificationsTick ใน useNotifications.js
function usePublicNewsTick() {
  const [tick, setTick] = useState(0);

  useEffect(() => subscribeToPublicNews(() => setTick((value) => value + 1)), []);

  return tick;
}

export function usePublicNews(limit = 60) {
  const tick = usePublicNewsTick();
  const { data, loading, error } = useAsyncData(
    () => fetchPublicNews({ limit }),
    `public-news:${limit}:${tick}`,
    [],
  );
  return { news: data, loading, error };
}

// เปิด/ปิด badge บนปุ่ม "ข่าว" ใน AppHeader — "ยังไม่เห็น" นับเป็นรายข่าว
// (เทียบกับ id ที่เคยเปิดอ่านจริง ดู markNewsRead ใน NewsDetail.jsx) ไม่ใช่
// แค่เคยเปิดหน้ารวมข่าวหรือยัง เพราะเปิดหน้ารวมไม่ได้แปลว่าอ่านครบทุกข่าวแล้ว
export function useHasUnseenNews(userId) {
  const { news, loading } = usePublicNews();

  return useMemo(() => {
    if (!userId || loading) return false;
    const readIds = loadReadNewsIds(userId);
    return news.some((item) => isNewsUnseen(item, readIds));
  }, [news, loading, userId]);
}

// ข่าวเด่นที่ยังไม่มีใครอ่าน — โผล่เป็นแจ้งเตือนสังเคราะห์ที่กระดิ่งของ
// AppHeader (ดู featuredNewsToNotificationItem) ไม่ใช้ useMemo เหมือน
// useHasUnseenNews เพราะกระดิ่งต้อง mark read แล้วให้รายการหายทันทีในรอบ
// render เดียวกัน (setReloadKey เปลี่ยนแค่ state ของ component เรียก ไม่ใช่
// deps ของ hook นี้) — รายการข่าวมีไม่กี่สิบแถว คำนวณตรง ๆ ทุกรอบก็เบาอยู่แล้ว
// เหมือนที่ตัดสินใจไว้ใน News.jsx
export function useUnreadFeaturedNews(userId) {
  const { news, loading } = usePublicNews();
  if (!userId || loading) return [];

  const readIds = loadReadNewsIds(userId);
  return news.filter((item) => item.isFeatured && isNewsUnseen(item, readIds));
}

// id มาจาก useParams() เสมอเป็น string — key เทียบ id ตรง ๆ ก็พอ ไม่ต้อง
// แปลงเป็นตัวเลขเพราะ fetchPublicNewsById ส่งต่อให้ .eq() ซึ่งแปลงเองได้
export function usePublicNewsById(id) {
  const { data, loading, error } = useAsyncData(
    () => fetchPublicNewsById(id),
    id != null ? `public-news:${id}` : null,
  );

  return { news: data, loading, error };
}

export function useAdminNews({ category, query, page = 1, limit = ADMIN_NEWS_PAGE_SIZE, reloadKey = 0 }) {
  const { data, loading, error } = useAsyncData(
    () => fetchAdminNews({ category, query, page, limit }),
    `admin-news:${category ?? ""}:${query ?? ""}:${page}:${limit}:${reloadKey}`,
    EMPTY_NEWS_PAGE,
  );

  return { news: data.news, hasMore: data.hasMore, loading, error };
}

// id เป็น null ตอนสร้างข่าวใหม่ — key เป็น null ทำให้ useAsyncData ไม่ยิง query
// (ดู useAsyncData.js) หน้าเลยเริ่มด้วยฟอร์มว่างได้ทันทีโดยไม่ต้องรอ
export function useNewsById(id) {
  const { data, loading, error } = useAsyncData(
    () => fetchNewsById(id),
    id != null ? `news:${id}` : null,
  );

  return { news: data, loading, error };
}

export function useAdminNewsStats(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchAdminNewsStats,
    `admin-news-stats:${reloadKey}`,
    EMPTY_STATS,
  );

  return { stats: data, loading, error };
}
