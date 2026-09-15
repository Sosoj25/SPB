// หน้ารีวิวสนาม — แยกออกมาจากฟีดชุมชนตั้งแต่ต้นทาง (fetchFeed ตัดหมวด "รีวิว"
// ออกจากฟีดคุยกัน และดึงเฉพาะหมวดนี้ให้หน้านี้) เพราะสองอย่างนี้คนละเรื่องกัน
// คนเข้าชุมชนมาคุย/นัดเล่น ส่วนคนหารีวิวมาหาคะแนนสนามก่อนจอง พอปนกันอยู่ฟีด
// เดียวรีวิวก็ท่วมโพสต์คุยกัน และคนหาคะแนนก็ต้องเลื่อนผ่านโพสต์คุยเล่นเป็นสิบ
//
// โพสต์หมวดนี้ระบบสร้างให้เองตอนผู้ใช้ส่งรีวิวจากหน้าใบเสร็จ (submit_review()
// ใน 0080) หน้านี้จึงไม่มีกล่องเขียนโพสต์ — มีแต่ตัวกรอง คะแนนรวม และรายการ
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import PostCard from "../components/PostCard";
import ReportDialog from "../components/ReportDialog";
import { useAuth } from "../context/useAuth";
import { useCommunityFeed, useReviewStats } from "../hooks/useCommunity";
import { useFeedInteractions } from "../hooks/useFeedInteractions";
import { FEED_FILTERS, REVIEW_RATINGS, deleteOwnPost } from "../lib/community";
import { errorMessage } from "../lib/errors";
import "./Community.css";
import "./CommunityReviews.css";

const ALL_RATINGS = 0;

export default function CommunityReviews() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [filter, setFilter] = useState(FEED_FILTERS[0]);
  const [rating, setRating] = useState(ALL_RATINGS);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [reportTarget, setReportTarget] = useState(null);

  // หน่วงคำค้นก่อนยิงจริง — pattern เดียวกับหน้าชุมชน
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(query.trim());
      setPage(1);
    }, 350);

    return () => clearTimeout(timer);
  }, [query]);

  const { stats } = useReviewStats(reloadKey);
  const { posts, hasMore, loading, error: feedError } = useCommunityFeed({
    filter,
    rating,
    query: searchTerm || undefined,
    page,
    reloadKey,
    reviewsOnly: true,
  });

  const {
    posts: visiblePosts,
    error,
    setError,
    resetOverrides,
    handleLike,
    handleBookmark,
  } = useFeedInteractions(posts, user?.id);

  // แถบจำนวนดาวยาวเทียบกับดาวที่มีคนให้เยอะที่สุด ไม่ใช่เทียบกับยอดรวม — ถ้า
  // เทียบกับยอดรวมแล้วคะแนนกระจุกที่ 5 ดาว แถวที่เหลือจะเตี้ยจนดูไม่ออกว่า
  // ต่างกันตรงไหน
  const peak = Math.max(...REVIEW_RATINGS.map((star) => stats.counts[star] ?? 0), 1);

  function changeFilter(value) {
    setFilter(value);
    setPage(1);
    resetOverrides();
  }

  function changeRating(value) {
    setRating(value === rating ? ALL_RATINGS : value);
    setPage(1);
    resetOverrides();
  }

  function changePage(next) {
    setPage(next);
    resetOverrides();
  }

  async function handleDeletePost(post) {
    const ok = window.confirm(
      "ลบรีวิวนี้ออกจากชุมชนใช่ไหม?\n\nคะแนนที่ให้ไว้กับสนามยังอยู่ แต่โพสต์รีวิวจะหายจากหน้านี้ทันที",
    );
    if (!ok) return;

    try {
      await deleteOwnPost(post.id, user.id);
      resetOverrides();
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("ลบรีวิวไม่สำเร็จ:", err);
      setError(errorMessage(err));
    }
  }

  const emptyText = searchTerm
    ? `ไม่พบรีวิวที่ตรงกับ "${searchTerm}"`
    : rating
      ? `ยังไม่มีรีวิว ${rating} ดาว`
      : filter === "ที่ติดตาม"
        ? "ยังไม่มีรีวิวจากคนที่คุณติดตาม"
        : filter === "บันทึกไว้"
          ? "ยังไม่ได้บันทึกรีวิวไหนไว้"
          : "ยังไม่มีรีวิวสนาม — รีวิวจะขึ้นที่นี่เองเมื่อผู้ใช้ให้คะแนนหลังเล่นจบ";

  return (
    <div className="cm cmr">
      <AppHeader />

      <main className="cm__main">
        <div className="cmr__layout">
          <header className="cmr__head">
            <Link className="cmr__back" to="/community">
              ‹ กลับไปหน้าชุมชน
            </Link>
            <h1 className="cmr__title">รีวิวสนาม</h1>
            <p className="cmr__lead">
              คะแนนและคำติชมจากผู้ที่จองและเข้าใช้บริการจริง ระบบบันทึกให้อัตโนมัติหลังเล่นจบ
              จึงไม่มีรีวิวที่เขียนขึ้นเอง
            </p>
          </header>

          <section className="cm-card cmr__summary">
            <div className="cmr__score">
              <p className="cmr__avg">
                {stats.total ? stats.average.toFixed(1) : "—"}
                <span className="cmr__avg-of">/5</span>
              </p>
              <span
                className="cmr__avg-stars"
                role="img"
                aria-label={`คะแนนเฉลี่ย ${stats.average.toFixed(1)} จาก 5 ดาว`}
              >
                {[1, 2, 3, 4, 5].map((star) => (
                  <span
                    key={star}
                    className={`cmr__avg-star ${
                      star <= Math.round(stats.average) ? "cmr__avg-star--on" : ""
                    }`}
                    aria-hidden="true"
                  >
                    ★
                  </span>
                ))}
              </span>
              <p className="cmr__count">จาก {stats.total.toLocaleString("th-TH")} รีวิว</p>
            </div>

            {/* กดแถวไหนก็กรองเฉพาะดาวนั้น กดซ้ำเพื่อเอาตัวกรองออก */}
            <div className="cmr__bars">
              {REVIEW_RATINGS.map((star) => {
                const count = stats.counts[star] ?? 0;

                return (
                  <button
                    key={star}
                    type="button"
                    className={`cmr__bar-row ${rating === star ? "cmr__bar-row--active" : ""}`}
                    onClick={() => changeRating(star)}
                    aria-pressed={rating === star}
                  >
                    <span className="cmr__bar-label">{star} ★</span>
                    <span className="cmr__bar-track">
                      <span
                        className="cmr__bar-fill"
                        style={{ width: `${count ? Math.max((count / peak) * 100, 4) : 0}%` }}
                      />
                    </span>
                    <span className="cmr__bar-count">{count.toLocaleString("th-TH")}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="cmr__toolbar">
            <input
              aria-label="ค้นหาชื่อสนาม / คำติชม"
              className="cm-search cmr__search"
              type="search"
              placeholder="ค้นหาชื่อสนาม / คำติชม"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

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

              {rating > 0 && (
                <button
                  type="button"
                  className="cm-chip cm__filter cmr__clear"
                  onClick={() => changeRating(rating)}
                >
                  {rating} ★ ✕
                </button>
              )}
            </div>
          </div>

          {error && <p className="cm__error cmr__error">{error}</p>}

          <section className="cm__feed">
            {loading && <p className="cm__empty">กำลังโหลดรีวิว...</p>}
            {!loading && feedError && <p className="cm__empty">{feedError}</p>}
            {!loading && !feedError && visiblePosts.length === 0 && (
              <p className="cm__empty">{emptyText}</p>
            )}

            {visiblePosts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                authorName={post.author}
                authorAvatar={post.authorAvatar}
                isOwner={post.userId === user?.id}
                onOpen={(p) => navigate(`/community/post/${p.id}`)}
                onLike={handleLike}
                onBookmark={handleBookmark}
                onEdit={() => {}}
                onDelete={handleDeletePost}
                onReport={(p) => setReportTarget({ postId: p.id })}
              />
            ))}

            {!loading && (page > 1 || hasMore) && (
              <div className="cm__pager">
                <button
                  type="button"
                  className="cm-chip"
                  disabled={page <= 1}
                  onClick={() => changePage(page - 1)}
                >
                  ‹ ก่อนหน้า
                </button>
                <span className="cm__pager-page">หน้า {page}</span>
                <button
                  type="button"
                  className="cm-chip"
                  disabled={!hasMore}
                  onClick={() => changePage(page + 1)}
                >
                  ถัดไป ›
                </button>
              </div>
            )}
          </section>
        </div>
      </main>

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
