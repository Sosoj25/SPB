// ข้อมูลของหน้าชุมชนและหน้ารีวิว — ฟีด โพสต์ คอมเมนต์ โปรไฟล์ และการค้นหา
//
// ทุกตัวรับ reloadKey เพื่อให้หน้าสั่งดึงใหม่หลังผู้ใช้ทำอะไรลงไป
import { useAsyncData } from "./useAsyncData";
import {
  fetchCategories,
  fetchComments,
  fetchCommunityProfile,
  fetchFeed,
  fetchMutualFollows,
  fetchPostById,
  fetchReviewStats,
  fetchSuggestedUsers,
  fetchUserPosts,
  searchPeople,
} from "../lib/community";

const EMPTY = [];
const EMPTY_PAGE = { posts: [], hasMore: false };
const EMPTY_REVIEW_STATS = { total: 0, average: 0, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };

export function useCommunityCategories() {
  const { data, loading, error } = useAsyncData(fetchCategories, "community-categories", EMPTY);
  return { categories: data, loading, error };
}

// reloadKey ให้หน้าเว็บสั่งดึงใหม่หลังโพสต์/กดถูกใจ โดยไม่ต้องยกสถานะฟีด
// ทั้งก้อนขึ้นมาไว้ใน state ของหน้า
export function useCommunityFeed({
  categoryId,
  filter,
  query,
  page = 1,
  reloadKey = 0,
  reviewsOnly = false,
  rating = 0,
}) {
  const { data, loading, error } = useAsyncData(
    () => fetchFeed({ categoryId, filter, query, page, reviewsOnly, rating }),
    `community-feed:${reviewsOnly ? "reviews" : "posts"}:${categoryId ?? ""}:${filter}:${
      query ?? ""
    }:${rating}:${page}:${reloadKey}`,
    EMPTY_PAGE,
  );

  return { posts: data.posts, hasMore: data.hasMore, loading, error };
}

// สรุปคะแนนหัวหน้ารีวิว — ดึงใหม่ตาม reloadKey เดียวกับฟีด เพราะรีวิวใหม่ที่
// เพิ่งเข้ามาต้องขยับทั้งค่าเฉลี่ยและแถบจำนวนดาวพร้อมกับรายการข้างล่าง
export function useReviewStats(reloadKey = 0) {
  const { data, loading } = useAsyncData(
    fetchReviewStats,
    `community-review-stats:${reloadKey}`,
    EMPTY_REVIEW_STATS,
    { keepPreviousData: true },
  );

  return { stats: data, loading };
}

// ผลค้นหา "ผู้ใช้" ที่โชว์คู่กับผลค้นหาโพสต์ — ยิงเฉพาะตอนพิมพ์คำค้นจริง
export function usePeopleSearch(query) {
  const term = (query ?? "").trim();

  const { data, loading } = useAsyncData(
    () => searchPeople(term),
    term ? `people-search:${term}` : null,
    EMPTY,
  );

  return { people: data, loading };
}

// keepPreviousData: true — ไลก์/บุ๊กมาร์ก/คอมเมนต์ทุกครั้ง bump reloadKey เพื่อ
// ดึงยอดที่เซิร์ฟเวอร์คำนวณจริงมาแทน ถ้ารีเซ็ตเป็น null ระหว่างรอ หน้าทั้งหน้า
// (รวมช่องคอมเมนต์) จะ unmount/remount ทุกครั้งที่กดอะไรสักอย่าง
export function useCommunityPost(id, reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    () => fetchPostById(id),
    id != null ? `community-post:${id}:${reloadKey}` : null,
    null,
    { keepPreviousData: true },
  );

  return { post: data, loading, error };
}

export function usePostComments(postId, reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    () => fetchComments(postId),
    postId != null ? `post-comments:${postId}:${reloadKey}` : null,
    EMPTY,
    { keepPreviousData: true },
  );

  return { comments: data, loading, error };
}

export function useSuggestedUsers(userId, reloadKey = 0) {
  const { data, loading } = useAsyncData(
    () => fetchSuggestedUsers(userId),
    userId ? `suggested-users:${userId}:${reloadKey}` : null,
    EMPTY,
  );

  return { users: data, loading };
}

export function useCommunityProfile(userId, reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    () => fetchCommunityProfile(userId),
    userId ? `community-profile:${userId}:${reloadKey}` : null,
  );

  return { profile: data, loading, error };
}

export function useMutualFollows(userId, otherId) {
  const { data, loading } = useAsyncData(
    () => fetchMutualFollows(userId, otherId),
    userId && otherId ? `mutual-follows:${userId}:${otherId}` : null,
    EMPTY,
  );

  return { mutuals: data, loading };
}

export function useUserPosts(userId, reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    () => fetchUserPosts(userId),
    userId ? `user-posts:${userId}:${reloadKey}` : null,
    EMPTY,
    { keepPreviousData: true },
  );

  return { posts: data, loading, error };
}
