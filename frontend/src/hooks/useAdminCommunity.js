// ข้อมูลทุกแผงของหน้าแอดมิน "จัดการชุมชน"
//
// ทุกตัวรับ reloadKey เพื่อให้หน้าสั่งดึงใหม่หลังกดจัดการอะไรสักอย่าง
import { useAsyncData } from "./useAsyncData";
import {
  ADMIN_POSTS_PAGE_SIZE,
  fetchAdminComments,
  fetchAdminPosts,
  fetchAdminStats,
  fetchCategoryStats,
  fetchPendingReports,
  fetchReportedUsers,
} from "../lib/adminCommunity";

const EMPTY = [];
const EMPTY_PAGE = { posts: [], total: 0, hasMore: false };
const EMPTY_COMMENT_PAGE = { comments: [], total: 0, hasMore: false };
const EMPTY_STATS = {
  totalPosts: 0,
  totalComments: 0,
  pendingReports: 0,
  newReports24h: 0,
  flaggedPosts: 0,
  flaggedComments: 0,
  hiddenPosts: 0,
  pinnedPosts: 0,
  suspendedMembers: 0,
  totalMembers: 0,
};

export function useAdminCommunityStats(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchAdminStats,
    `admin-community-stats:${reloadKey}`,
    EMPTY_STATS,
  );

  return { stats: data, loading, error };
}

export function useAdminCommunityPosts({
  filter,
  query,
  page = 1,
  limit = ADMIN_POSTS_PAGE_SIZE,
  reloadKey = 0,
}) {
  const { data, loading, error } = useAsyncData(
    () => fetchAdminPosts({ filter, query, page, limit }),
    `admin-community-posts:${filter}:${query ?? ""}:${page}:${limit}:${reloadKey}`,
    EMPTY_PAGE,
  );

  return { posts: data.posts, total: data.total, hasMore: data.hasMore, loading, error };
}

export function useAdminCommunityComments({ filter, query, page = 1, reloadKey = 0 }) {
  const { data, loading, error } = useAsyncData(
    () => fetchAdminComments({ filter, query, page }),
    `admin-community-comments:${filter}:${query ?? ""}:${page}:${reloadKey}`,
    EMPTY_COMMENT_PAGE,
  );

  return { comments: data.comments, total: data.total, hasMore: data.hasMore, loading, error };
}

export function usePendingReports(group = "", reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    () => fetchPendingReports({ group }),
    `admin-community-reports:${group}:${reloadKey}`,
    EMPTY,
  );

  return { reports: data, loading, error };
}

export function useCategoryStats(reloadKey = 0) {
  const { data, loading } = useAsyncData(
    fetchCategoryStats,
    `admin-community-categories:${reloadKey}`,
    EMPTY,
  );

  return { categories: data, loading };
}

export function useReportedUsers(reloadKey = 0) {
  const { data, loading } = useAsyncData(
    () => fetchReportedUsers(),
    `admin-reported-users:${reloadKey}`,
    EMPTY,
  );

  return { users: data, loading };
}
