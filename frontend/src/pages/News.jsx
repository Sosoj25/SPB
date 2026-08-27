import { useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
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

  const filtered = useMemo(
    () => (activeCategory === "ทั้งหมด" ? news : news.filter((n) => n.category === activeCategory)),
    [news, activeCategory],
  );

  const lead = filtered.find((n) => n.isFeatured) ?? filtered[0] ?? null;
  const sidebarStories = filtered.filter((n) => n.id !== lead?.id).slice(0, 4);
  const gridStories = filtered.filter((n) => n.id !== lead?.id).slice(4, 7);

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
        {!loading && !error && !lead && <p className="news__empty">ยังไม่มีข่าวในหมวดนี้</p>}

        {lead && (
          <section className="news__lead-grid">
            <article className="news__lead">
              <div className="news__lead-photo">
                {lead.coverImage ? (
                  <img src={lead.coverImage} alt={lead.title} />
                ) : (
                  <div className="news__card-placeholder" aria-hidden="true" />
                )}
              </div>
              <p className="news__meta">{meta(lead)}</p>
              <h2 className="news__lead-title">{lead.title}</h2>
              <p className="news__lead-desc">{lead.subtitle || lead.excerpt}</p>
            </article>

            {sidebarStories.length > 0 && (
              <aside className="news__sidebar">
                <p className="news__sidebar-title">เรื่องอื่นในสัปดาห์นี้</p>
                <div className="news__sidebar-list">
                  {sidebarStories.map((story, index) => (
                    <div key={story.id} className="news__sidebar-item">
                      <span className="news__sidebar-no">{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <p className="news__sidebar-meta">{meta(story)}</p>
                        <p className="news__sidebar-headline">{story.title}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </aside>
            )}
          </section>
        )}

        {gridStories.length > 0 && (
          <>
            <div className="news__rule news__rule--strong" />
            <p className="news__section-label">รายงานพิเศษ</p>

            <section className="news__grid">
              {gridStories.map((report) => (
                <article key={report.id} className="news__card">
                  <div className="news__card-photo">
                    {report.coverImage ? (
                      <img src={report.coverImage} alt={report.title} />
                    ) : (
                      <div className="news__card-placeholder" aria-hidden="true" />
                    )}
                  </div>
                  <p className="news__meta">{meta(report)}</p>
                  <h3 className="news__card-title">{report.title}</h3>
                  <p className="news__card-desc">{report.subtitle || report.excerpt}</p>
                </article>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
