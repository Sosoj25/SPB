// หน้ารายละเอียดโพสต์ — เนื้อโพสต์เต็ม แกลเลอรีรูป และคอมเมนต์พร้อมการตอบกลับ
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import ClampText from "../components/ClampText";
import CreatePostDialog from "../components/CreatePostDialog";
import PostImageCarousel from "../components/PostImageCarousel";
import ReportDialog from "../components/ReportDialog";
import ReviewPostBody from "../components/ReviewPostBody";
import { useAuth } from "../context/useAuth";
import { useCommunityCategories, useCommunityPost, usePostComments } from "../hooks/useCommunity";
import { usePendingSet } from "../hooks/usePendingSet";
import {
  addComment,
  deleteOwnComment,
  deleteOwnPost,
  incrementPostView,
  isReviewPost,
  parseReviewPost,
  postableCategories,
  relativeTime,
  toggleBookmark,
  togglePostLike,
} from "../lib/community";
import { errorMessage } from "../lib/errors";
import "./Community.css";
import "./CommunityPost.css";

// จัดคอมเมนต์แบนราบให้เป็น "หัวข้อ + คำตอบ" ชั้นเดียว — ตอบกลับคำตอบอีกที
// ยังบันทึก parent_id ของคำตอบนั้นจริง ๆ ใน DB (เก็บสายที่ตอบไว้ครบ) แต่ฝั่ง
// แสดงผลรวบทุกคำตอบไว้ใต้ต้นทางเดียวกันเพื่อไม่ให้ย่อหน้าลึกจนอ่านยาก
function organizeComments(comments) {
  const byId = new Map(comments.map((c) => [c.id, c]));

  function rootIdOf(comment) {
    let current = comment;
    while (current.parentId && byId.has(current.parentId)) {
      current = byId.get(current.parentId);
    }
    return current.id;
  }

  const roots = [];
  const repliesByRoot = new Map();

  comments.forEach((comment) => {
    if (!comment.parentId || !byId.has(comment.parentId)) {
      roots.push(comment);
      return;
    }

    const rootId = rootIdOf(comment);
    const replyToName =
      comment.parentId !== rootId ? byId.get(comment.parentId)?.author : null;

    const list = repliesByRoot.get(rootId) ?? [];
    list.push({ ...comment, replyToName });
    repliesByRoot.set(rootId, list);
  });

  return roots.map((root) => ({ ...root, replies: repliesByRoot.get(root.id) ?? [] }));
}

export default function CommunityPost() {
  const { id } = useParams();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const composerInputRef = useRef(null);

  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [reportTarget, setReportTarget] = useState(null);
  const [editingOpen, setEditingOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  // กดถูกใจ/บันทึกแล้วต้องขยับทันที ไม่ใช่รอ round trip — pattern เดียวกับ
  // Community.jsx แทนการ bump reloadKey ที่ทำให้ทั้งหน้ากระพริบทุกครั้งที่กด
  const [overrides, setOverrides] = useState({});
  const [pending, runPending] = usePendingSet();

  const { post: fetchedPost, loading, error: postError } = useCommunityPost(id, reloadKey);
  const { comments } = usePostComments(id, reloadKey);
  const { categories } = useCommunityCategories();
  const composerCategories = useMemo(() => postableCategories(categories), [categories]);

  // keepPreviousData (ใน useCommunityPost/usePostComments) คงข้อมูลเดิมไว้
  // ระหว่าง refetch กันจอกระพริบ/โฟกัสหลุดตอนไลก์/คอมเมนต์ — แต่ถ้าเปลี่ยนไป
  // เปิดโพสต์คนละอัน (id เปลี่ยน) ต้องไม่โชว์โพสต์เก่าค้างไว้ผิดอัน จึงต้อง
  // เช็คว่า id ที่ได้มายังตรงกับ id ปัจจุบันจริงไหมก่อนเชื่อว่าใช้แสดงผลได้
  const rawPost = fetchedPost && fetchedPost.id === id ? fetchedPost : null;
  const override = rawPost && overrides[rawPost.id];
  const post = !rawPost
    ? null
    : !override
      ? rawPost
      : {
          ...rawPost,
          isLiked: override.isLiked ?? rawPost.isLiked,
          likeCount:
            rawPost.likeCount +
            ((override.isLiked ?? rawPost.isLiked) === rawPost.isLiked
              ? 0
              : override.isLiked
                ? 1
                : -1),
          isBookmarked: override.isBookmarked ?? rawPost.isBookmarked,
        };

  const threadedComments = organizeComments(comments);
  const isOwner = post?.userId === user?.id;
  // โพสต์หมวด "รีวิว" แสดงเป็นบล็อกคะแนนแทนข้อความดิบ (ดู ReviewPostBody)
  const review = parseReviewPost(post);
  // โพสต์รีวิวมาจากหน้ารีวิว (/community/reviews) ไม่ใช่ฟีดชุมชน — ปุ่มย้อนกลับ
  // และปลายทางหลังลบจึงต้องพากลับไปหน้าที่ผู้ใช้มา ไม่ใช่โยนไปฟีดที่ไม่มีรีวิว
  // ให้เห็นสักอัน
  const backTo = isReviewPost(post) ? "/community/reviews" : "/community";

  // นับยอดเข้าชมครั้งเดียวต่อการเปิดโพสต์ — ผูกกับ id ไม่ใช่ reloadKey ไม่งั้น
  // ทุกครั้งที่กดถูกใจแล้วดึงข้อมูลใหม่ ยอดวิวจะเด้งขึ้นตามไปด้วย
  useEffect(() => {
    if (id) incrementPostView(id);
  }, [id]);

  async function handleLike() {
    if (!user || !post || pending.has(`like:${post.id}`)) return;

    setOverrides((current) => ({
      ...current,
      [post.id]: { ...current[post.id], isLiked: !post.isLiked },
    }));

    await runPending(`like:${post.id}`, async () => {
      try {
        await togglePostLike({ postId: post.id, userId: user.id, liked: post.isLiked });
      } catch (err) {
        console.error("กดถูกใจไม่สำเร็จ:", err);
        setOverrides((current) => ({
          ...current,
          [post.id]: { ...current[post.id], isLiked: post.isLiked },
        }));
        setError(errorMessage(err));
      }
    });
  }

  async function handleBookmark() {
    if (!user || !post || pending.has(`bookmark:${post.id}`)) return;

    setOverrides((current) => ({
      ...current,
      [post.id]: { ...current[post.id], isBookmarked: !post.isBookmarked },
    }));

    await runPending(`bookmark:${post.id}`, async () => {
      try {
        await toggleBookmark({ postId: post.id, userId: user.id, bookmarked: post.isBookmarked });
      } catch (err) {
        console.error("บันทึกโพสต์ไม่สำเร็จ:", err);
        setOverrides((current) => ({
          ...current,
          [post.id]: { ...current[post.id], isBookmarked: post.isBookmarked },
        }));
        setError(errorMessage(err));
      }
    });
  }

  async function handleComment() {
    if (sending || !post || !draft.trim()) return;
    setError("");
    setSending(true);

    try {
      await addComment({
        postId: post.id,
        userId: user.id,
        content: draft,
        parentId: replyTo?.id ?? null,
      });
      setDraft("");
      setReplyTo(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("ส่งความคิดเห็นไม่สำเร็จ:", err);
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function startReply(comment) {
    setReplyTo({ id: comment.id, author: comment.author });
    composerInputRef.current?.focus();
  }

  async function handleDeleteComment(comment) {
    const ok = window.confirm("ลบความคิดเห็นนี้ใช่ไหม?");
    if (!ok) return;

    try {
      await deleteOwnComment(comment.id);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("ลบความคิดเห็นไม่สำเร็จ:", err);
      setError(errorMessage(err));
    }
  }

  function handlePostSaved() {
    setEditingOpen(false);
    setReloadKey((k) => k + 1);
  }

  async function handleDeletePost() {
    setMenuOpen(false);
    const ok = window.confirm("ลบโพสต์นี้ใช่ไหม?\nโพสต์ ความคิดเห็น และรูปภาพจะหายจากหน้าเว็บทันที");
    if (!ok) return;

    try {
      await deleteOwnPost(post.id, user.id);
      navigate(backTo);
    } catch (err) {
      console.error("ลบโพสต์ไม่สำเร็จ:", err);
      setError(errorMessage(err));
    }
  }

  // พาไปหน้าข้อความแบบ "ยังไม่เปิดห้องจริง" — เดิมเรียก startDirectConversation
  // ตรงนี้เลย ทำให้มีห้องว่างเปล่าโผล่ในกล่องข้อความของอีกฝ่ายทันทีที่กดปุ่ม
  // ทั้งที่ยังไม่ได้พิมพ์อะไรเลย หน้า /messages จะเป็นคนสร้างห้องจริงเองตอนกด
  // ส่งข้อความแรกเท่านั้น (ดู Messages.jsx)
  function handleMessage() {
    if (!post) return;
    setMenuOpen(false);
    navigate(`/messages?to=${post.userId}`);
  }

  function autoGrowComposer(e) {
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  return (
    <div className="cm">
      <AppHeader />

      <main className="cm-post__main">
        <button type="button" className="cm-back" onClick={() => navigate(backTo)}>
          {backTo === "/community" ? "← กลับสู่ชุมชน" : "← กลับไปหน้ารีวิวสนาม"}
        </button>

        {loading && !post && <p className="cm__empty">กำลังโหลดโพสต์...</p>}
        {!loading && !post && postError && <p className="cm__empty">{postError}</p>}

        {post && (
          <>
            <article className={`cm-card cm-post__card ${review ? "cm-post__card--review" : ""}`}>
              <header className="cm-post__head">
                {post.authorAvatar ? (
                  <img src={post.authorAvatar} alt="" className="cm-avatar" />
                ) : (
                  <span className="cm-avatar" aria-hidden="true" />
                )}
                <div>
                  <button
                    type="button"
                    className="cm-name cm-post__author"
                    onClick={() => navigate(`/community/profile/${post.userId}`)}
                  >
                    {post.author}
                  </button>
                  <p className="cm-time">
                    {relativeTime(post.createdAt)} · เข้าชม {post.viewCount}
                    {post.isEdited && " · แก้ไขแล้ว"}
                  </p>
                </div>
                <span className="cm__post-tags">
                  <span className={`cm-chip ${review ? "cm-chip--review" : ""}`}>
                    {review ? "★ รีวิวสนาม" : post.category}
                  </span>

                  {/* เมนู ⋯ — เจ้าของได้แก้ไข/ลบ คนอื่นได้ส่งข้อความ/รายงาน
                      รายการเมนูต้องตรงกับของการ์ดในฟีด (PostCard) */}
                  <span className="cm__menu" role="presentation">
                    <button
                      type="button"
                      className="cm__menu-trigger"
                      aria-label="ตัวเลือกโพสต์"
                      aria-expanded={menuOpen}
                      onClick={() => setMenuOpen((current) => !current)}
                    >
                      ⋯
                    </button>

                    {menuOpen && (
                      <span className="cm__menu-panel" role="menu">
                        {isOwner ? (
                          <>
                            {/* รีวิวแก้ไม่ได้ — policy ฝั่ง DB บล็อกการอัปเดต
                                หมวดนี้ไว้ (0080) กดไปก็ได้แต่ error */}
                            {!isReviewPost(post) && (
                              <button
                                type="button"
                                className="cm__menu-item"
                                role="menuitem"
                                onClick={() => {
                                  setMenuOpen(false);
                                  setEditingOpen(true);
                                }}
                              >
                                ✎ แก้ไขโพสต์
                              </button>
                            )}
                            <button
                              type="button"
                              className="cm__menu-item cm__menu-item--danger"
                              role="menuitem"
                              onClick={handleDeletePost}
                            >
                              🗑 ลบโพสต์
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="cm__menu-item"
                              role="menuitem"
                              onClick={handleMessage}
                            >
                              💬 ส่งข้อความ
                            </button>
                            <button
                              type="button"
                              className="cm__menu-item cm__menu-item--danger"
                              role="menuitem"
                              onClick={() => {
                                setMenuOpen(false);
                                setReportTarget({ postId: post.id });
                              }}
                            >
                              ⚑ รายงาน
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </span>
              </header>

              {review ? (
                <ReviewPostBody review={review} lines={8} />
              ) : (
                <>
                  {post.title && <h1 className="cm-post__title">{post.title}</h1>}
                  {post.content && (
                    <ClampText text={post.content} className="cm-body cm-post__text" lines={8} />
                  )}
                </>
              )}

              <PostImageCarousel images={post.images} />

              <div className="cm-post__foot">
                <button
                  type="button"
                  className={`cm-action ${post.isLiked ? "cm-action--on" : ""}`}
                  onClick={handleLike}
                >
                  <span className="cm-action__icon" aria-hidden="true">
                    {post.isLiked ? "♥" : "♡"}
                  </span>{" "}
                  ถูกใจ {post.likeCount}
                </button>
                <span className="cm-action">
                  <span className="cm-action__icon" aria-hidden="true">💬</span> ความคิดเห็น{" "}
                  {post.commentCount}
                </span>
                <button
                  type="button"
                  className={`cm-action ${post.isBookmarked ? "cm-action--on" : ""}`}
                  onClick={handleBookmark}
                >
                  <span className="cm-action__icon" aria-hidden="true">🔖</span>{" "}
                  {post.isBookmarked ? "บันทึกแล้ว" : "บันทึก"}
                </button>
              </div>
            </article>

            <div className="cm-post__composer">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="cm-avatar cm-avatar--sm" />
              ) : (
                <span className="cm-avatar cm-avatar--sm" aria-hidden="true" />
              )}
              <div className="cm-post__composer-col">
                {replyTo && (
                  <div className="cm-post__reply-banner">
                    กำลังตอบกลับ <strong>{replyTo.author}</strong>
                    <button type="button" onClick={() => setReplyTo(null)} aria-label="ยกเลิกการตอบกลับ">
                      ✕
                    </button>
                  </div>
                )}
                <textarea
                  ref={composerInputRef}
                  className="cm-post__composer-input"
                  aria-label={replyTo ? `ตอบกลับ ${replyTo.author}` : "เขียนความคิดเห็น"}
                  rows={1}
                  placeholder={replyTo ? `ตอบกลับ ${replyTo.author}...` : "เขียนความคิดเห็น..."}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    autoGrowComposer(e);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleComment();
                    }
                  }}
                />
              </div>
              <button
                type="button"
                className="cm-post__send"
                onClick={handleComment}
                disabled={sending || !draft.trim()}
              >
                {sending ? "..." : "ส่ง"}
              </button>
            </div>

            {error && <p className="cm__error">{error}</p>}

            <h2 className="cm-post__comments-title">ความคิดเห็น {post.commentCount} รายการ</h2>

            {comments.length === 0 && (
              <p className="cm__empty">ยังไม่มีความคิดเห็น มาเป็นคนแรกกันเลย</p>
            )}

            {threadedComments.map((comment) => (
              <div key={comment.id}>
                <div
                  className={`cm-post__comment ${
                    comment.userId === post.userId ? "cm-post__comment--author" : ""
                  }`}
                >
                  <div className="cm-post__comment-head">
                    {comment.authorAvatar ? (
                      <img src={comment.authorAvatar} alt="" className="cm-avatar cm-avatar--xs" />
                    ) : (
                      <span className="cm-avatar cm-avatar--xs" aria-hidden="true" />
                    )}
                    <span className="cm-post__comment-name">{comment.author}</span>
                    <span className="cm-post__comment-time">· {relativeTime(comment.createdAt)}</span>
                    {comment.userId === post.userId && (
                      <span className="cm-chip cm-chip--sm">ผู้เขียนโพสต์</span>
                    )}

                    <span className="cm-post__comment-tools">
                      <button
                        type="button"
                        className="cm-post__comment-link"
                        onClick={() => startReply(comment)}
                      >
                        ตอบกลับ
                      </button>
                      {comment.userId === user?.id ? (
                        <button
                          type="button"
                          className="cm-post__comment-link"
                          onClick={() => handleDeleteComment(comment)}
                        >
                          ลบ
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="cm-post__comment-link"
                          onClick={() => setReportTarget({ commentId: comment.id })}
                        >
                          รายงาน
                        </button>
                      )}
                    </span>
                  </div>

                  <ClampText
                    text={comment.content}
                    className="cm-body cm-post__comment-body"
                    lines={3}
                  />
                </div>

                {comment.replies.length > 0 && (
                  <div className="cm-post__replies">
                    {comment.replies.map((reply) => (
                      <div
                        key={reply.id}
                        className={`cm-post__comment cm-post__comment--reply ${
                          reply.userId === post.userId ? "cm-post__comment--author" : ""
                        }`}
                      >
                        <div className="cm-post__comment-head">
                          {reply.authorAvatar ? (
                            <img src={reply.authorAvatar} alt="" className="cm-avatar cm-avatar--xs" />
                          ) : (
                            <span className="cm-avatar cm-avatar--xs" aria-hidden="true" />
                          )}
                          <span className="cm-post__comment-name">{reply.author}</span>
                          <span className="cm-post__comment-time">
                            · {relativeTime(reply.createdAt)}
                          </span>
                          {reply.userId === post.userId && (
                            <span className="cm-chip cm-chip--sm">ผู้เขียนโพสต์</span>
                          )}

                          <span className="cm-post__comment-tools">
                            <button
                              type="button"
                              className="cm-post__comment-link"
                              onClick={() => startReply(reply)}
                            >
                              ตอบกลับ
                            </button>
                            {reply.userId === user?.id ? (
                              <button
                                type="button"
                                className="cm-post__comment-link"
                                onClick={() => handleDeleteComment(reply)}
                              >
                                ลบ
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="cm-post__comment-link"
                                onClick={() => setReportTarget({ commentId: reply.id })}
                              >
                                รายงาน
                              </button>
                            )}
                          </span>
                        </div>

                        <ClampText
                          text={reply.content}
                          prefix={
                            reply.replyToName && (
                              <span className="cm-post__reply-to">@{reply.replyToName} </span>
                            )
                          }
                          className="cm-body cm-post__comment-body"
                          lines={3}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </main>

      {editingOpen && post && (
        <CreatePostDialog
          userId={user?.id}
          authorName={post.author}
          authorAvatar={post.authorAvatar}
          categories={composerCategories}
          editingPost={{
            id: post.id,
            content: post.content,
            categoryId: post.categoryId,
            coverImage: post.coverImage,
          }}
          onClose={() => setEditingOpen(false)}
          onCreated={handlePostSaved}
        />
      )}

      {reportTarget && (
        <ReportDialog
          postId={reportTarget.postId}
          commentId={reportTarget.commentId}
          onClose={() => setReportTarget(null)}
          onDone={() => setError("")}
        />
      )}
    </div>
  );
}
