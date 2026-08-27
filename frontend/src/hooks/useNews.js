import { useAsyncData } from "./useAsyncData";
import {
  ADMIN_NEWS_PAGE_SIZE,
  fetchAdminNews,
  fetchAdminNewsStats,
  fetchNewsById,
  fetchPublicNews,
} from "../lib/news";

const EMPTY_NEWS_PAGE = { news: [], hasMore: false };
const EMPTY_STATS = { published: 0, draft: 0, scheduled: 0, totalViews: 0 };

export function usePublicNews() {
  const { data, loading, error } = useAsyncData(() => fetchPublicNews(), "public-news", []);
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
