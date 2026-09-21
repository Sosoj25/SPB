// หน้ารวมข่าว — ข่าวเด่นด้านบน กรองตามหมวด และป้าย "ยังไม่ได้อ่าน" รายข่าว
import { useMemo, useState } from "react";
import useReveal from "../hooks/useReveal";
import { Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import NewsHighlightCarousel from "../components/NewsHighlightCarousel";
import { useAuth } from "../context/useAuth";
import { usePublicNews } from "../hooks/useNews";
import { NEWS_CATEGORIES, isNewsUnseen, loadReadNewsIds } from "../lib/news";
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
  const revealRef = useReveal();
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0]);
  const { news, loading, error } = usePublicNews();
  const navigate = useNavigate();
  const { user } = useAuth();

  // แค่เปิดหน้ารวมข่าวไม่ได้แปลว่าอ่านครบทุกข่าวแล้ว — จุดแดง "ยังไม่ได้อ่าน"
  // ต่อข่าว (และป้าย "ใหม่" ต่อหมวดที่รวมมาจากมัน) ต้องอิงจากข่าวที่เปิดอ่าน
  // จริงเท่านั้น (markNewsRead ใน NewsDetail.jsx) ไม่ใช่จากเวลาที่เข้าหน้านี้
  // ไม่งั้นกดอ่านข่าวเดียวแล้วกลับมา จุด/ป้ายของข่าวอื่นจะหายพร้อมกันหมด
  // ไม่ต้อง useMemo — Set ที่ได้จาก localStorage เป็น object ใหม่ทุกรอบ render
  // อยู่แล้ว (loadReadNewsIds) จึง memo ไม่ได้ผลจริง และรายการข่าวมีไม่กี่สิบ
  // แถวต่อครั้ง คำนวณตรง ๆ ทุกรอบก็เบาอยู่แล้ว
  const readIds = loadReadNewsIds(user?.id);
  const unreadNews = news.filter((item) => isNewsUnseen(item, readIds));
  const unreadIds = new Set(unreadNews.map((item) => item.id));
  const newCategories = new Set(unreadNews.map((item) => item.category));

  // จำนวนข่าวต่อหมวดโชว์บนแท็บ — นับจากข่าวทั้งหมด (ไม่ใช่ filtered) เพราะ
  // ต้องคงที่ไม่ว่ากำลังเลือกแท็บไหนอยู่ ผู้ใช้จะได้เห็นว่าแต่ละหมวดมีกี่ข่าว
  // ก่อนตัดสินใจกดเข้าไปดู
  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const item of news) counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, [news]);

  const filtered = useMemo(
    () => (activeCategory === "ทั้งหมด" ? news : news.filter((n) => n.category === activeCategory)),
    [news, activeCategory],
  );

  // ข่าวเด่นแสดงในสไลด์ได้ทุกข่าวที่ปักหมุดไว้ (ไม่จำกัดแค่ข่าวเดียว) — และ
  // ยังรวมอยู่ในตาราง "ข่าวทั้งหมด" ด้านล่างด้วย (ติดป้ายข่าวเด่นไว้ให้เห็น)
  // ไม่ได้แยกออกไปเหมือนเดิม
  const featured = useMemo(() => filtered.filter((n) => n.isFeatured), [filtered]);
  // ผูก key ของ carousel กับชุด id ข่าวเด่น — สลับหมวดหมู่แล้ว React จะ
  // remount carousel ใหม่ทั้งก้อน ทำให้กลับไปเริ่มที่ข่าวแรกของชุดใหม่เสมอ
  const featuredKey = useMemo(() => featured.map((n) => n.id).join(","), [featured]);

  function openArticle(id) {
    navigate(`/news/${id}`);
  }

  return (
    <div className="news">
      <AppHeader />

      <main className="news__main" ref={revealRef}>
        <section className="news__masthead" data-reveal>
          <p className="news__eyebrow">
            <span className="news__eyebrow-text">NEWSROOM</span>
          </p>
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
              data-category={cat}
              className={`news__category ${cat === activeCategory ? "news__category--active" : ""}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
              <span className="news__category-count">
                {cat === "ทั้งหมด" ? news.length : categoryCounts[cat] ?? 0}
              </span>
              {(cat === "ทั้งหมด" ? newCategories.size > 0 : newCategories.has(cat)) && (
                <span className="news__category-dot" aria-label="มีข่าวใหม่ในหมวดนี้" />
              )}
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
            <NewsHighlightCarousel
              key={featuredKey}
              items={featured}
              onSelect={openArticle}
              unreadIds={unreadIds}
            />
          </>
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            <div className="news__rule news__rule--strong" />
            <p className="news__section-label">ข่าวทั้งหมด</p>

            {/* หน่วงการจางเข้ามาทีละใบตามคอลัมน์ ไม่ใช่ตามลำดับทั้งหมด ไม่งั้น
                การ์ดใบท้าย ๆ ของหน้ายาว ๆ จะรอนานจนดูเหมือนค้าง */}
            <section className="news__grid">
              {filtered.map((item, index) => (
                <article
                  key={item.id}
                  className="news__card"
                  data-category={item.category}
                  data-reveal
                  data-reveal-delay={index % 3}
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
                    {item.isFeatured && (
                      <span className="news__card-featured-badge">
                        <Star size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" />{" "}
                        ข่าวเด่น
                      </span>
                    )}
                    {unreadIds.has(item.id) && (
                      <span className="news__card-unread-dot" aria-label="ข่าวที่ยังไม่ได้อ่าน" />
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
