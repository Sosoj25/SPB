import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import NewsHighlightCarousel from "../components/NewsHighlightCarousel";
import { usePublicNews } from "../hooks/useNews";
import { NEWS_CATEGORIES } from "../lib/news";
import { formatBookingDate } from "../lib/bookings";
import "./News.css";

const CATEGORIES = ["ทั้งหมด", ...NEWS_CATEGORIES];

// published_at เป็น timestamptz (ต่างจาก booking_date ที่เป็น date ล้วน) —
// ตัดเอาแค่ส่วนวันที่ก่อนส่งให้ formatBookingDate ไม่งั้น "T00:00:00" ที่มันต่อ
// ต่อท้ายจะไปต่อกับเวลาที่ติดมาจาก published_at อยู่แล้ว กลายเป็นสตริงวันที่ผิด
function meta(item) {
  return `${item.category} · ${formatBookingDate(item.publishedAt.slice(0, 10))}`;
}

export default function News() {
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0]);
  const { news, loading, error } = usePublicNews();
  const navigate = useNavigate();

  const filtered = useMemo(
    () => (activeCategory === "ทั้งหมด" ? news : news.filter((n) => n.category === activeCategory)),
    [news, activeCategory],
  );

  // ข่าวเด่นแสดงในสไลด์ได้ทุกข่าวที่ปักหมุดไว้ (ไม่จำกัดแค่ข่าวเดียว) ส่วนข่าว
  // ทั่วไปที่เหลือแสดงเป็นตารางด้านล่างครบทุกข่าว ไม่ตัดจำนวน
  const featured = useMemo(() => filtered.filter((n) => n.isFeatured), [filtered]);
  const others = useMemo(() => filtered.filter((n) => !n.isFeatured), [filtered]);
  // ผูก key ของ carousel กับชุด id ข่าวเด่น — สลับหมวดหมู่แล้ว React จะ
  // remount carousel ใหม่ทั้งก้อน ทำให้กลับไปเริ่มที่ข่าวแรกของชุดใหม่เสมอ
  const featuredKey = useMemo(() => featured.map((n) => n.id).join(","), [featured]);

  function openArticle(id) {
    navigate(`/news/${id}`);
  }

  return (
    <div className="news">
      <AppHeader />

      <main className="news__main">
        <section className="news__masthead">
          <p className="news__eyebrow">NEWSROOM</p>
          <h1 className="news__title">ข่าวสารและกิจกรรม</h1>
          <p className="news__intro">
            รายงานการแข่งขัน กิจกรรม และประกาศจากสนามในเครือ SPORTSBOOKING อัปเดตทุกสัปดาห์
          </p>
        </section>

        <nav className="news__categories">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`news__category ${cat === activeCategory ? "news__category--active" : ""}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </nav>
        <div className="news__rule" />

        {loading && <p className="news__empty">กำลังโหลดข่าวสาร...</p>}
        {!loading && error && <p className="news__empty">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="news__empty">ยังไม่มีข่าวในหมวดนี้</p>
        )}

        {!loading && !error && featured.length > 0 && (
          <>
            <p className="news__section-label">ข่าวเด่น</p>
            <NewsHighlightCarousel key={featuredKey} items={featured} onSelect={openArticle} />
          </>
        )}

        {!loading && !error && others.length > 0 && (
          <>
            <div className="news__rule news__rule--strong" />
            <p className="news__section-label">ข่าวทั้งหมด</p>

            <section className="news__grid">
              {others.map((item) => (
                <article
                  key={item.id}
                  className="news__card"
                  role="button"
                  tabIndex={0}
                  onClick={() => openArticle(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openArticle(item.id);
                  }}
                >
                  <div className="news__card-photo">
                    {item.coverImage ? (
                      <img src={item.coverImage} alt={item.title} />
                    ) : (
                      <div className="news__card-placeholder" aria-hidden="true" />
                    )}
                  </div>
                  <p className="news__meta">{meta(item)}</p>
                  <h3 className="news__card-title">{item.title}</h3>
                  <p className="news__card-desc">{item.subtitle || item.excerpt}</p>
                </article>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
