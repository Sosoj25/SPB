// แกลเลอรีรูปในหน้ารายละเอียดโพสต์ — เลื่อนดูทีละรูป มีปุ่มซ้าย/ขวา จุดบอก
// ตำแหน่ง ปัดบนมือถือ และกดลูกศรบนคีย์บอร์ดได้
//
// ไม่เลื่อนอัตโนมัติเหมือน NewsHighlightCarousel เพราะที่นี่ผู้ใช้ตั้งใจเปิด
// เข้ามาดูรูปอยู่แล้ว รูปขยับเองจะกวนมากกว่าช่วย — ส่วนในฟีดใช้ PostImageGrid
// เรียงเป็นโมเสกแทน (เห็นหลายรูปพร้อมกันในสายตาเดียว)
import { useCallback, useRef, useState } from "react";
import "./PostImageCarousel.css";

const SWIPE_THRESHOLD_PX = 40;

export default function PostImageCarousel({ images }) {
  const [index, setIndex] = useState(0);
  // ทิศทางที่เลื่อน — ใช้เลือกว่ารูปใหม่จะเลื่อนเข้าจากทางไหน
  const [direction, setDirection] = useState("next");
  const touchStartX = useRef(null);

  const total = images?.length ?? 0;

  const goPrev = useCallback(() => {
    setDirection("prev");
    setIndex((i) => (i - 1 + total) % total);
  }, [total]);

  const goNext = useCallback(() => {
    setDirection("next");
    setIndex((i) => (i + 1) % total);
  }, [total]);

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e) {
    if (touchStartX.current == null) return;

    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;

    if (delta > SWIPE_THRESHOLD_PX) goPrev();
    else if (delta < -SWIPE_THRESHOLD_PX) goNext();
  }

  if (total === 0) return null;

  // เจ้าของโพสต์ลบรูปทิ้งระหว่างที่เปิดหน้าค้างไว้ได้ — กัน index ค้างเกินขอบเขต
  // ไม่ให้กลายเป็นจอว่าง
  const safeIndex = Math.min(index, total - 1);
  const hasMultiple = total > 1;

  return (
    <section className="post-carousel" aria-roledescription="แกลเลอรีรูปภาพ">
      <div
        className="post-carousel__frame"
        tabIndex={hasMultiple ? 0 : -1}
        onKeyDown={(e) => {
          if (!hasMultiple) return;
          if (e.key === "ArrowLeft") goPrev();
          if (e.key === "ArrowRight") goNext();
        }}
        onTouchStart={hasMultiple ? handleTouchStart : undefined}
        onTouchEnd={hasMultiple ? handleTouchEnd : undefined}
      >
        {/* key ผูกกับ URL เพื่อให้ React สร้าง img ใหม่ทุกครั้งที่เปลี่ยนรูป
            แอนิเมชันเลื่อนเข้าจะได้เล่นใหม่ (วิธีเดียวกับ NewsHighlightCarousel) */}
        <img
          key={images[safeIndex]}
          src={images[safeIndex]}
          alt={`รูปที่ ${safeIndex + 1} จากทั้งหมด ${total} รูป`}
          className={`post-carousel__photo post-carousel__photo--${direction}`}
          draggable="false"
        />

        {hasMultiple && (
          <>
            <button
              type="button"
              className="post-carousel__nav post-carousel__nav--prev"
              aria-label="รูปก่อนหน้า"
              onClick={goPrev}
            >
              ‹
            </button>
            <button
              type="button"
              className="post-carousel__nav post-carousel__nav--next"
              aria-label="รูปถัดไป"
              onClick={goNext}
            >
              ›
            </button>
            <span className="post-carousel__counter">
              {safeIndex + 1} / {total}
            </span>
          </>
        )}
      </div>

      {hasMultiple && (
        <div className="post-carousel__dots">
          {images.map((url, i) => (
            <button
              key={url}
              type="button"
              className={`post-carousel__dot ${
                i === safeIndex ? "post-carousel__dot--active" : ""
              }`}
              aria-label={`ไปที่รูปที่ ${i + 1}`}
              onClick={() => {
                setDirection(i >= safeIndex ? "next" : "prev");
                setIndex(i);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
