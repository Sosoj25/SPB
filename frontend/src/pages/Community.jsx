// หน้าชุมชน — ฟีดโพสต์ กรองตามหมวด ค้นหาโพสต์/คน และแผงแนะนำผู้ใช้ข้าง ๆ
//
// โพสต์หมวด "รีวิว" ไม่อยู่ในฟีดนี้ (แยกไปหน้า CommunityReviews)
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import CreatePostDialog from "../components/CreatePostDialog";
import PostCard from "../components/PostCard";
import ReportDialog from "../components/ReportDialog";
import { useAuth } from "../context/useAuth";
import {
  useCommunityCategories,
  useCommunityFeed,
  usePeopleSearch,
  useSuggestedUsers,
} from "../hooks/useCommunity";
import { useFeedInteractions } from "../hooks/useFeedInteractions";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { FEED_FILTERS, deleteOwnPost, postableCategories, toggleFollow } from "../lib/community";
import { errorMessage } from "../lib/errors";
import "./Community.css";

const ALL_CATEGORIES = "ทั้งหมด";

export default function Community() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [categoryId, setCategoryId] = useState(null);
  const [filter, setFilter] = useState(FEED_FILTERS[0]);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);

  const [composer, setComposer] = useState(null); // null ปิดอยู่ / { openFilePicker } เปิดอยู่
  const [editingPost, setEditingPost] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);

  // หน่วงคำค้นก่อนยิงจริง — ตอนนี้ค้นที่ฐานข้อมูลแล้ว ถ้ายิงทุกตัวอักษรจะได้
  // query ชุดหนึ่งต่อการกดแป้นหนึ่งครั้ง
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(query.trim());
      setPage(1);
    }, 350);

    return () => clearTimeout(timer);
  }, [query]);

  const { categories } = useCommunityCategories();
  // หมวด "รีวิว" ไม่อยู่ในชุดนี้ — ระบบโพสต์ให้เองอย่างเดียว และย้ายไปมีหน้าของ
  // ตัวเองแล้ว ทั้งแถบหมวดข้างฟีดและกล่องเขียนโพสต์จึงใช้ชุดเดียวกันได้
  const feedCategories = useMemo(() => postableCategories(categories), [categories]);
  const { posts, hasMore, loading, error: feedError } = useCommunityFeed({
    categoryId,
    filter,
    query: searchTerm || undefined,
    page,
    reloadKey,
  });
  const { people } = usePeopleSearch(searchTerm);
  const { users: suggested } = useSuggestedUsers(user?.id, reloadKey);

  // ตรงกับจุดตัดที่ CSS พับแถบข้างลงมาเป็นคอลัมน์เดียว (ดู @media ของ
  // Community.css) — ต้องเช็คจาก JS ด้วยเพราะที่อยู่ของก้อน "ผู้ใช้แนะนำ"
  // เปลี่ยนไปอยู่คนละพ่อแม่ ไม่ใช่แค่สลับลำดับ ซึ่ง CSS ทำให้ไม่ได้
  const isNarrow = useMediaQuery("(max-width: 1000px)");

  // ถูกใจ/บันทึกโพสต์ใช้ชุดเดียวกับหน้ารีวิวและหน้าโปรไฟล์ชุมชน (ดู
  // useFeedInteractions) — pending/runPending/setError คืนออกมาให้ปุ่มติดตาม
  // ข้างฟีดใช้เซตเดียวกันต่อได้
  const {
    posts: visiblePosts,
    error,
    setError,
    pending,
    runPending,
    resetOverrides,
    handleLike,
    handleBookmark,
  } = useFeedInteractions(posts, user?.id);

  // สลับได้สองทาง — เดิมส่ง following: false ตายตัว กดซ้ำเลยได้ error ซ้ำคีย์
  async function handleFollow(target) {
    if (!user || pending.has(`follow:${target.id}`)) return;

    await runPending(`follow:${target.id}`, async () => {
      try {
        await toggleFollow({
          targetId: target.id,
          userId: user.id,
          following: target.isFollowing ?? false,
        });
        setReloadKey((k) => k + 1);
      } catch (err) {
        console.error("ติดตามไม่สำเร็จ:", err);
        setError(errorMessage(err));
      }
    });
  }

  async function handleDeletePost(post) {
    const ok = window.confirm(
      `ลบโพสต์นี้ใช่ไหม?\n\n"${post.content.slice(0, 60)}${post.content.length > 60 ? "..." : ""}"\n\nโพสต์และรูปภาพจะหายจากหน้าเว็บทันที`,
    );
    if (!ok) return;

    try {
      await deleteOwnPost(post.id, user.id);
      resetOverrides();
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("ลบโพสต์ไม่สำเร็จ:", err);
      setError(errorMessage(err));
    }
  }

  const authorDisplayName =
    profile?.full_name || profile?.username || user?.email?.split("@")[0] || "คุณ";

  function handlePostCreated() {
    resetOverrides();
    setPage(1);
    setReloadKey((k) => k + 1);
  }

  function openPost(id) {
    navigate(`/community/post/${id}`);
  }

  function changeFilter(value) {
    setFilter(value);
    setPage(1);
    resetOverrides();
  }

  function changeCategory(value) {
    setCategoryId(value);
    setPage(1);
    resetOverrides();
  }

  /* ก้อนนี้มีชุดเดียวและเรนเดอร์ที่เดียวต่อครั้ง — จอกว้างไปต่อท้ายแถบข้าง
     จอแคบแทรกกลางฟีด (ดู isNarrow ข้างล่าง) ไม่ใช่วาด DOM สองชุดแล้วซ่อน
     ทิ้งอันหนึ่ง ซึ่งจะได้ปุ่ม "ติดตาม" ซ้ำสองตัวให้ตัวอ่านหน้าจออ่านเจอ */
  const suggestedBlock = (
    <div className="cm__side-block cm__side-block--people">
      <hr className="cm__divider" />

      <h2 className="cm__side-title">ผู้ใช้แนะนำ</h2>
      {suggested.length === 0 && <p className="cm-time">ยังไม่มีผู้ใช้ที่จะแนะนำ</p>}

      {suggested.length > 0 && (
        <div className="cm__suggested-list">
          {suggested.map((item) => (
            <div key={item.id} className="cm__user cm__user--card">
              {/* บนมือถือแถวนี้ถูกจัดใหม่เป็นการ์ดที่มีรูปใหญ่อยู่บนสุด
                  (ดู @media ใน Community.css) รูปจึงกลายเป็นเป้ากดที่
                  ใหญ่ที่สุดของการ์ด ต้องกดเข้าโปรไฟล์ได้เหมือนชื่อ
                  ไม่ใช่เป็นภาพประดับที่กดแล้วเงียบ */}
              <button
                type="button"
                className="cm__user-photo-btn"
                aria-label={`ดูโปรไฟล์ของ ${item.name}`}
                onClick={() => navigate(`/community/profile/${item.id}`)}
              >
                {item.avatar ? (
                  <img
                    src={item.avatar}
                    alt=""
                    className="cm-avatar cm-avatar--sm cm__user-photo"
                  />
                ) : (
                  /* กล่องเปล่าในการ์ดใหญ่ดูเหมือนรูปโหลดไม่ขึ้น ใส่อักษร
                     ตัวแรกของชื่อแทน (ทรงเดียวกับอวาตาร์ฝั่งแอดมิน) —
                     ยัง aria-hidden อยู่เพราะชื่อเต็มอยู่ใต้รูปแล้ว */
                  <span
                    className="cm-avatar cm-avatar--sm cm__user-photo cm__user-photo--empty"
                    aria-hidden="true"
                  >
                    {item.name.charAt(0)}
                  </span>
                )}
              </button>

              <span className="cm__user-text">
                <button
                  type="button"
                  className="cm__user-name"
                  onClick={() => navigate(`/community/profile/${item.id}`)}
                >
                  {item.name}
                </button>
                {/* ไม่โชว์ถ้าชื่อที่แสดงคือ username อยู่แล้ว (คนที่ยัง
                    ไม่ได้ตั้งชื่อจริง) ไม่งั้นการ์ดจะเขียนของซ้ำสองบรรทัด */}
                {item.username && item.username !== item.name && (
                  <span className="cm__user-handle">@{item.username}</span>
                )}
              </span>

              <button
                type="button"
                className="cm__follow"
                onClick={() => handleFollow(item)}
              >
                ติดตาม
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="cm">
      <AppHeader />

      <main className="cm__main">
        <div className="cm__layout">
          {/* แถบข้างถูกซอยเป็นก้อนย่อย ไม่ใช่เพราะเดสก์ท็อปต้องการ (บนจอกว้าง
              มันเรียงต่อกันเหมือนเดิมเป๊ะ) แต่เพราะบนจอแคบทั้งแถบนี้อยู่ "ก่อน"
              ฟีดใน DOM — พอพับเหลือคอลัมน์เดียว ผู้ใช้ต้องเลื่อนผ่านช่องค้นหา
              หมวดหมู่ และทางเข้ารีวิวกว่าจะเห็นโพสต์แรก พอแยกเป็นก้อนแล้ว CSS
              ถึงสลับลำดับเฉพาะจอแคบได้ (ดู order ใน @media ของ Community.css)
              โดยไม่ต้องวาด DOM สองชุด
              ข้อยกเว้นคือก้อน "ผู้ใช้แนะนำ" ที่จอแคบต้องย้ายไปอยู่ในฟีดเลย
              ไม่ใช่แค่สลับลำดับ — อันนั้นเปลี่ยนพ่อแม่ CSS จึงทำแทนไม่ได้ */}
          <aside className="cm__sidebar">
            <div className="cm__side-block cm__side-block--search">
              <input
                aria-label="ค้นหาโพสต์ / ผู้ใช้"
                className="cm-search"
                type="search"
                placeholder="ค้นหาโพสต์ / ผู้ใช้"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />

              {/* ผลค้นหาคน โผล่เฉพาะตอนพิมพ์คำค้นและมีคนตรงจริง */}
              {searchTerm && people.length > 0 && (
                <>
                  <h2 className="cm__side-title">ผู้ใช้ที่ตรงกับคำค้น</h2>
                  {people.map((person) => (
                    <div key={person.id} className="cm__user">
                      {person.avatar ? (
                        <img src={person.avatar} alt="" className="cm-avatar cm-avatar--sm" />
                      ) : (
                        <span className="cm-avatar cm-avatar--sm" aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        className="cm__user-name"
                        onClick={() => navigate(`/community/profile/${person.id}`)}
                      >
                        {person.name}
                      </button>
                    </div>
                  ))}
                  <hr className="cm__divider" />
                </>
              )}
            </div>

            {/* รีวิวสนามแยกไปอยู่หน้าของตัวเองแล้ว ไม่ปนกับฟีดคุยกันอีก — ตรงนี้
                เหลือไว้เป็นทางเข้า จะได้ยังหาเจอจากหน้าชุมชนเหมือนเดิม */}
            <Link className="cm__reviews-link cm__side-block--reviews" to="/community/reviews">
              <span className="cm__reviews-link-star" aria-hidden="true">
                ★
              </span>
              <span className="cm__reviews-link-text">
                <strong>รีวิวสนาม</strong>
                <small>คะแนนจากคนที่จองและเล่นจริง</small>
              </span>
              <span className="cm__reviews-link-go" aria-hidden="true">
                ›
              </span>
            </Link>

            <div className="cm__side-block cm__side-block--categories">
              <h2 className="cm__side-title">หมวดหมู่</h2>
              <div className="cm__categories">
                <button
                  type="button"
                  className={`cm__category ${categoryId === null ? "cm__category--active" : ""}`}
                  onClick={() => changeCategory(null)}
                >
                  {ALL_CATEGORIES}
                </button>

                {feedCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`cm__category ${cat.id === categoryId ? "cm__category--active" : ""}`}
                    onClick={() => changeCategory(cat.id)}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            {/* จอแคบย้ายก้อนนี้ไปแทรกกลางฟีดแทน (ดูในฟีดข้างล่าง) */}
            {!isNarrow && suggestedBlock}
          </aside>

          <section className="cm__feed">
            <div className="cm__composer">
              <div className="cm__composer-top">
                {/* กดรูปแยกจากกดข้อความ — รูปพาไปหน้าโปรไฟล์ชุมชนของตัวเอง
                    ข้อความยังเปิดกล่องเขียนโพสต์เหมือนเดิม */}
                <button
                  type="button"
                  className="cm__composer-avatar-btn"
                  aria-label="ดูโปรไฟล์ของฉัน"
                  onClick={() => navigate(`/community/profile/${user?.id}`)}
                >
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="cm-avatar cm-avatar--sm" />
                  ) : (
                    <span className="cm-avatar cm-avatar--sm" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  className="cm__composer-trigger"
                  onClick={() => setComposer({ openFilePicker: false })}
                >
                  <span className="cm__composer-placeholder">
                    {authorDisplayName} คุณกำลังคิดอะไรอยู่?
                  </span>
                </button>
              </div>

              <hr className="cm__composer-divider" />

              <button
                type="button"
                className="cm__composer-photo-btn"
                onClick={() => setComposer({ openFilePicker: true })}
              >
                🖼️ <span>รูปภาพ/วิดีโอ</span>
              </button>

              {error && <p className="cm__error">{error}</p>}
            </div>

            <div className="cm__filters">
              {FEED_FILTERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`cm-chip cm__filter ${item === filter ? "cm-chip--active" : ""}`}
                  onClick={() => changeFilter(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            {loading && <p className="cm__empty">กำลังโหลดโพสต์...</p>}
            {!loading && feedError && <p className="cm__empty">{feedError}</p>}
            {!loading && !feedError && visiblePosts.length === 0 && (
              <p className="cm__empty">
                {searchTerm
                  ? `ไม่พบโพสต์ที่ตรงกับ "${searchTerm}"`
                  : filter === "ที่ติดตาม"
                    ? "ยังไม่มีโพสต์จากคนที่คุณติดตาม"
                    : filter === "บันทึกไว้"
                      ? "ยังไม่ได้บันทึกโพสต์ไหนไว้ (รีวิวที่บันทึกไว้ดูได้ในหน้ารีวิวสนาม)"
                      : "ยังไม่มีโพสต์ในหมวดนี้ เริ่มโพสต์แรกได้เลย"}
              </p>
            )}

            {visiblePosts.map((post, index) => (
              <Fragment key={post.id}>
                <PostCard
                  post={post}
                  authorName={post.author}
                  authorAvatar={post.authorAvatar}
                  isOwner={post.userId === user?.id}
                  onOpen={(p) => openPost(p.id)}
                  onLike={handleLike}
                  onBookmark={handleBookmark}
                  onEdit={setEditingPost}
                  onDelete={handleDeletePost}
                  onReport={(p) => setReportTarget({ postId: p.id })}
                />

                {/* บนจอแคบแถบข้างทั้งแถบพับลงมาต่อกันเป็นคอลัมน์เดียว ก้อนนี้
                    เคยถูกสั่งให้ไปอยู่ท้ายสุด (ใต้ทั้งฟีดและปุ่มเปลี่ยนหน้า)
                    เพราะเป็นส่วนที่รีบน้อยที่สุด แต่ผลคือไม่มีใครเห็นเลย ต้อง
                    เลื่อนผ่านโพสต์ทั้งหน้าก่อน แถมพอกดไปหน้า 2 มันก็เลื่อนหนี
                    ลงไปอีก — ย้ายมาแทรกหลังโพสต์ใบแรกแทน (ทรงเดียวกับ "คนที่
                    คุณอาจรู้จัก" ของแอปโซเชียล) เห็นได้โดยไม่ต้องเลื่อนไกล
                    และยังไม่ขวางโพสต์แรกตอนเปิดหน้ามา */}
                {isNarrow && index === 0 && suggestedBlock}
              </Fragment>
            ))}

            {/* ฟีดว่างก็ไม่มีโพสต์ใบแรกให้แทรกต่อท้าย แต่เป็นจังหวะที่ยิ่งควร
                มีคนให้ตามต่อ */}
            {isNarrow && !loading && visiblePosts.length === 0 && suggestedBlock}

            {!loading && (page > 1 || hasMore) && (
              <div className="cm__pager">
                <button
                  type="button"
                  className="cm-chip"
                  disabled={page <= 1}
                  onClick={() => {
                    setPage((p) => p - 1);
                    resetOverrides();
                  }}
                >
                  ‹ ก่อนหน้า
                </button>
                <span className="cm__pager-page">หน้า {page}</span>
                <button
                  type="button"
                  className="cm-chip"
                  disabled={!hasMore}
                  onClick={() => {
                    setPage((p) => p + 1);
                    resetOverrides();
                  }}
                >
                  ถัดไป ›
                </button>
              </div>
            )}
          </section>
        </div>
      </main>

      {(composer || editingPost) && (
        <CreatePostDialog
          userId={user?.id}
          authorName={authorDisplayName}
          authorAvatar={profile?.avatar_url}
          categories={feedCategories}
          openFilePickerOnMount={composer?.openFilePicker}
          editingPost={
            editingPost
              ? {
                  id: editingPost.id,
                  content: editingPost.content,
                  categoryId: editingPost.categoryId,
                  coverImage: editingPost.coverImage,
                }
              : undefined
          }
          onClose={() => {
            setComposer(null);
            setEditingPost(null);
          }}
          onCreated={handlePostCreated}
        />
      )}

      {reportTarget && (
        <ReportDialog
          postId={reportTarget.postId}
          onClose={() => setReportTarget(null)}
          onDone={() => setError("")}
        />
      )}
    </div>
  );
}
