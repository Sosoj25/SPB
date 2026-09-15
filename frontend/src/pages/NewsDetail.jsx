// หน้าอ่านข่าวรายชิ้น — เป็นที่เดียวที่ตัดข่าวออกจากรายการ "ยังไม่ได้อ่าน"
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { useAuth } from "../context/useAuth";
import { usePublicNewsById } from "../hooks/useNews";
import { formatBookingDate } from "../lib/bookings";
import { markNewsRead } from "../lib/news";
import { renderNewsContent } from "../lib/newsContent";
import "./NewsDetail.css";

export default function NewsDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { news, loading, error } = usePublicNewsById(id);

  // ตัดข่าวนี้ออกจากที่ต้องแจ้งเตือนตอนโหลดสำเร็จจริง (มี news.id แล้ว) ไม่ใช่
  // แค่มาถึง route นี้ — id ที่พิมพ์ผิดหรือข่าวที่ถูกลบไปแล้วไม่ควรถูกนับว่า
  // "อ่านแล้ว"
  useEffect(() => {
    if (user?.id && news?.id != null) markNewsRead(user.id, news.id);
  }, [user?.id, news?.id]);

  return (
    <div className="news-detail">
      <AppHeader />

      <main className="news-detail__main">
        <button type="button" className="news-detail__back" onClick={() => navigate("/news")}>
          ‹ กลับไปหน้าข่าวสาร
        </button>

        {loading && <p className="news-detail__empty">กำลังโหลดข่าวสาร...</p>}

        {/* RLS กันข่าวที่ยังไม่เผยแพร่ไว้แล้ว (news_public_read, 0018) — ถ้า id
            ไม่ตรงกับข่าวที่เผยแพร่แล้วจริง fetchPublicNewsById จะได้ error
            กลับมาเสมอ ไม่ต้องแยกเคส "ไม่พบ" กับ "ยังไม่เผยแพร่" */}
        {!loading && error && (
          <p className="news-detail__empty">ไม่พบข่าวนี้ หรือข่าวถูกลบไปแล้ว</p>
        )}

        {!loading && !error && news && (
          <article className="news-detail__article">
            <p className="news-detail__meta">
              {news.category} · {formatBookingDate(news.publishedAt.slice(0, 10))}
            </p>
            <h1 className="news-detail__title">{news.title}</h1>
            {news.subtitle && <p className="news-detail__subtitle">{news.subtitle}</p>}

            <div className="news-detail__photo">
              {news.coverImage ? (
                <img src={news.coverImage} alt={news.title} />
              ) : (
                <div className="news-detail__placeholder" aria-hidden="true" />
              )}
            </div>

            <div className="news-detail__content">{renderNewsContent(news.content)}</div>
          </article>
        )}
      </main>
    </div>
  );
}
