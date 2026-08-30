import { useCallback, useEffect, useRef, useState } from "react";
import { formatBookingDate } from "../lib/bookings";
import "./NewsHighlightCarousel.css";

const AUTO_SLIDE_MS = 3500;
const SWIPE_THRESHOLD_PX = 40;

function meta(item) {
  return `${item.category} · ${formatBookingDate(item.publishedAt.slice(0, 10))}`;
}

// ปักหมุดข่าวเด่นได้หลายข่าว — component นี้รับ list มาแล้วเลื่อนดูทีละข่าว
// เอง แทนที่จะโชว์แค่ข่าวแรกแบบเดิม
//
// เมื่อสลับหมวดหมู่แล้วชุดข่าวเด่นเปลี่ยน ผู้เรียกต้องส่ง key ที่ผูกกับชุดข่าว
// (เช่น id ต่อกัน) มาด้วย เพื่อให้ React remount component นี้ใหม่และ index
// กลับไปเริ่มที่ 0 เอง — ไม่ใช้ effect + setState เพราะจะยิง render ซ้อนกัน
export default function NewsHighlightCarousel({ items, onSelect }) {
  const [index, setIndex] = useState(0);
  // ทิศทางที่เลื่อน — ใช้เลือกว่า slide ใหม่จะเลื่อนเข้าจากขวาหรือซ้าย
  // (ดู .news-highlight__content--next/--prev ใน CSS)
  const [direction, setDirection] = useState("next");
  const touchStartX = useRef(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (items.length <= 1) return undefined;

    const timer = setInterval(() => {
      if (pausedRef.current) return;
      setDirection("next");
      setIndex((i) => (i + 1) % items.length);
    }, AUTO_SLIDE_MS);

    return () => clearInterval(timer);
  }, [items.length]);

  const goPrev = useCallback(() => {
    setDirection("prev");
    setIndex((i) => (i - 1 + items.length) % items.length);
  }, [items.length]);

  const goNext = useCallback(() => {
    setDirection("next");
    setIndex((i) => (i + 1) % items.length);
  }, [items.length]);

  function handleTouchStart(e) {
    pausedRef.current = true;
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e) {
    pausedRef.current = false;
    if (touchStartX.current == null) return;

    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;

    if (delta > SWIPE_THRESHOLD_PX) goPrev();
    else if (delta < -SWIPE_THRESHOLD_PX) goNext();
  }

  if (items.length === 0) return null;

  const current = items[index] ?? items[0];
  const hasMultiple = items.length > 1;

  return (
    <section
      className="news-highlight"
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
      onTouchStart={hasMultiple ? handleTouchStart : undefined}
      onTouchEnd={hasMultiple ? handleTouchEnd : undefined}
    >
      <article
        className="news-highlight__slide"
        role="button"
        tabIndex={0}
        onClick={() => onSelect(current.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSelect(current.id);
        }}
      >
        <div key={current.id} className={`news-highlight__content news-highlight__content--${direction}`}>
          <div className="news-highlight__photo">
            {current.coverImage ? (
              <img src={current.coverImage} alt={current.title} draggable="false" />
            ) : (
              <div className="news__card-placeholder" aria-hidden="true" />
            )}

            {hasMultiple && (
              <>
                <button
                  type="button"
                  className="news-highlight__nav news-highlight__nav--prev"
                  aria-label="ข่าวเด่นก่อนหน้า"
                  onClick={(e) => {
                    e.stopPropagation();
                    goPrev();
                  }}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="news-highlight__nav news-highlight__nav--next"
                  aria-label="ข่าวเด่นถัดไป"
                  onClick={(e) => {
                    e.stopPropagation();
                    goNext();
                  }}
                >
                  ›
                </button>
              </>
            )}
          </div>

          <p className="news__meta">{meta(current)}</p>
          <h2 className="news-highlight__title">{current.title}</h2>
          <p className="news-highlight__desc">{current.subtitle || current.excerpt}</p>
        </div>
      </article>

      {hasMultiple && (
        <div className="news-highlight__footer">
          <div className="news-highlight__dots">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                className={`news-highlight__dot ${i === index ? "news-highlight__dot--active" : ""}`}
                aria-label={`ไปที่ข่าวเด่นลำดับที่ ${i + 1}`}
                onClick={() => {
                  setDirection(i >= index ? "next" : "prev");
                  setIndex(i);
                }}
              />
            ))}
          </div>
          <p className="news-highlight__counter">
            {index + 1} / {items.length}
          </p>
        </div>
      )}
    </section>
  );
}
