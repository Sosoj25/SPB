import { useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, Pagination, Pill, SearchBox } from "../components/DashboardWidgets";
import { useAdminNews, useAdminNewsStats } from "../hooks/useNews";
import { NEWS_CATEGORIES, deleteNews } from "../lib/news";
import { formatBookingDate } from "../lib/bookings";
import { errorMessage } from "../lib/errors";
import "./AdminNews.css";

const viewsFormatter = new Intl.NumberFormat("th-TH");

function describeStatus(item) {
  if (item.status === "draft") return { label: "ฉบับร่าง", tone: "muted" };
  if (item.isScheduled) return { label: "ตั้งเวลา", tone: "warning" };
  if (item.status === "published") return { label: "เผยแพร่แล้ว", tone: "success" };
  return { label: "เก็บถาวร", tone: "muted" };
}

export default function AdminNews() {
  const [activeCategory, setActiveCategory] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [deletingId, setDeletingId] = useState(null);
  const [actionError, setActionError] = useState("");

  const { news, hasMore, loading, error } = useAdminNews({
    category: activeCategory || undefined,
    query: query || undefined,
    page,
    reloadKey,
  });
  const { stats } = useAdminNewsStats(reloadKey);

  function selectCategory(category) {
    setActiveCategory(category);
    setPage(1);
  }

  async function handleDelete(item) {
    // ข่าวที่เผยแพร่แล้วหายจากหน้าเว็บทันทีและกู้คืนไม่ได้ พร้อมรูปปกใน bucket
    const ok = window.confirm(
      `ลบข่าว "${item.title}" ถาวรใช่ไหม?\nรูปปกของข่าวนี้จะถูกลบไปด้วย`,
    );
    if (!ok) return;

    setActionError("");
    setDeletingId(item.id);

    try {
      await deleteNews(item.id);
      setReloadKey((key) => key + 1);
    } catch (err) {
      console.error("deleteNews failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <DashboardLayout
      variant="admin"
      title="จัดการข่าวสาร"
      subtitle="เพิ่ม แก้ไข และเผยแพร่ข่าวสารและกิจกรรมบนหน้าเว็บไซต์"
      headerExtra={
        <Link to="/admin/news/editor" className="dash-btn dash-btn--add admin-news__new">
          ＋ เขียนข่าวใหม่
        </Link>
      }
    >
      <section className="dash-kpi">
        <div className="stat-card">
          <p className="stat-card__value admin-news__kpi-value--primary">{stats.published}</p>
          <p className="stat-card__label">เผยแพร่แล้ว</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__value admin-news__kpi-value--muted">{stats.draft}</p>
          <p className="stat-card__label">ฉบับร่าง</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__value admin-news__kpi-value--warning">{stats.scheduled}</p>
          <p className="stat-card__label">ตั้งเวลาเผยแพร่</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__value admin-news__kpi-value--primary">
            {viewsFormatter.format(stats.totalViews)}
          </p>
          <p className="stat-card__label">ยอดเข้าชมรวม</p>
        </div>
      </section>

      <div className="dash-filters">
        <Pill active={activeCategory === ""} onClick={() => selectCategory("")}>
          ทั้งหมด
        </Pill>
        {NEWS_CATEGORIES.map((cat) => (
          <Pill key={cat} active={cat === activeCategory} onClick={() => selectCategory(cat)}>
            {cat}
          </Pill>
        ))}
        <div className="dash-filters__spacer" />
        <SearchBox
          placeholder="ค้นหาข่าว"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
        />
      </div>

      {actionError && <div className="dash-message dash-message--error">{actionError}</div>}

      <div className="dash-card dash-table-card">
        {loading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}

        {!loading && error && <div className="dash-message dash-message--error">{error}</div>}

        {!loading && !error && news.length === 0 && <p className="dash-empty">ยังไม่มีข่าวสาร</p>}

        {!loading && !error && news.length > 0 && (
          <>
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>หัวข้อข่าว</th>
                    <th>หมวดหมู่</th>
                    <th>สถานะ</th>
                    <th>วันที่เผยแพร่</th>
                    <th>เข้าชม</th>
                    <th aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  {news.map((item) => {
                    const status = describeStatus(item);
                    return (
                      <tr key={item.id}>
                        <td>
                          <div className="admin-news__row">
                            <div className="admin-news__thumb" aria-hidden="true" />
                            <div>
                              <p className="admin-news__title">{item.title}</p>
                              <p className="admin-news__meta">
                                {item.isFeatured ? "ปักหมุดเป็นข่าวเด่น" : item.subtitle || "—"}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td>{item.category}</td>
                        <td>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </td>
                        <td>
                          {item.publishedAt ? formatBookingDate(item.publishedAt.slice(0, 10)) : "—"}
                        </td>
                        <td>{viewsFormatter.format(item.viewCount)}</td>
                        <td>
                          <div className="dash-actions">
                            <Link to={`/admin/news/editor?id=${item.id}`} className="dash-btn">
                              แก้ไข
                            </Link>
                            <a href="/news" target="_blank" rel="noreferrer" className="dash-btn">
                              ดูตัวอย่าง
                            </a>
                            <button
                              type="button"
                              className="dash-btn dash-btn--cancel"
                              disabled={deletingId === item.id}
                              onClick={() => handleDelete(item)}
                            >
                              {deletingId === item.id ? "กำลังลบ..." : "ลบ"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="dash-table-footer">
              <p>หน้า {page}</p>
              <Pagination page={page} hasMore={hasMore} onChange={setPage} />
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
