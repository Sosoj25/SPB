// ถูกใจ/บันทึกโพสต์ของการ์ดในฟีด — ทุกหน้าที่วาง PostCard (ฟีดชุมชน
// โปรไฟล์ชุมชน หน้ารีวิว) ต้องใช้ hook ตัวนี้ ห้ามเขียนตรรกะกดถูกใจซ้ำในหน้า
//
// กดแล้วต้องขยับทันที ไม่ใช่รอ round trip — เก็บผลที่กดไปแล้วทับบนข้อมูลจาก
// เซิร์ฟเวอร์ไว้ก่อน แล้วค่อยตรงกันเองตอนฟีดถูกดึงใหม่ ส่วน pending กันกดรัว ๆ
// ยิงซ้ำก่อนคำขอเดิมจบ (คีย์ผูก action ไว้ด้วย เช่น like:<id> เพราะไลก์กับ
// บุ๊กมาร์กโพสต์เดียวกันเป็นคนละคำขอ ไม่ควรบล็อกกันเอง)
//
// คืน pending/runPending/setError ออกไปด้วย ให้หน้าที่มี action อื่น (เช่น
// ปุ่มติดตามข้างฟีด) ใช้เซตเดียวกันได้ ไม่ต้องตั้ง usePendingSet ซ้อนอีกชุด
import { useCallback, useMemo, useState } from "react";
import { usePendingSet } from "./usePendingSet";
import { toggleBookmark, togglePostLike } from "../lib/community";
import { errorMessage } from "../lib/errors";

export function useFeedInteractions(posts, userId) {
  const [overrides, setOverrides] = useState({});
  const [error, setError] = useState("");
  const [pending, runPending] = usePendingSet();

  const visiblePosts = useMemo(
    () =>
      posts.map((post) => {
        const override = overrides[post.id];
        if (!override) return post;

        const liked = override.isLiked ?? post.isLiked;
        return {
          ...post,
          isLiked: liked,
          likeCount: post.likeCount + (liked === post.isLiked ? 0 : liked ? 1 : -1),
          isBookmarked: override.isBookmarked ?? post.isBookmarked,
        };
      }),
    [posts, overrides],
  );

  const resetOverrides = useCallback(() => setOverrides({}), []);

  const handleLike = useCallback(
    async (post) => {
      if (!userId || pending.has(`like:${post.id}`)) return;

      setOverrides((current) => ({
        ...current,
        [post.id]: { ...current[post.id], isLiked: !post.isLiked },
      }));

      await runPending(`like:${post.id}`, async () => {
        try {
          await togglePostLike({ postId: post.id, userId, liked: post.isLiked });
        } catch (err) {
          console.error("กดถูกใจไม่สำเร็จ:", err);
          setOverrides((current) => ({
            ...current,
            [post.id]: { ...current[post.id], isLiked: post.isLiked },
          }));
          setError(errorMessage(err));
        }
      });
    },
    [pending, runPending, userId],
  );

  const handleBookmark = useCallback(
    async (post) => {
      if (!userId || pending.has(`bookmark:${post.id}`)) return;

      setOverrides((current) => ({
        ...current,
        [post.id]: { ...current[post.id], isBookmarked: !post.isBookmarked },
      }));

      await runPending(`bookmark:${post.id}`, async () => {
        try {
          await toggleBookmark({ postId: post.id, userId, bookmarked: post.isBookmarked });
        } catch (err) {
          console.error("บันทึกโพสต์ไม่สำเร็จ:", err);
          setOverrides((current) => ({
            ...current,
            [post.id]: { ...current[post.id], isBookmarked: post.isBookmarked },
          }));
          setError(errorMessage(err));
        }
      });
    },
    [pending, runPending, userId],
  );

  return {
    posts: visiblePosts,
    error,
    setError,
    pending,
    runPending,
    resetOverrides,
    handleLike,
    handleBookmark,
  };
}
