// เลย์เอาต์รูปแบบเฟซบุ๊ก — 1 รูปเต็มความกว้าง, 2 รูปคู่กัน, 3 รูปใหญ่ซ้าย +
// เล็กสองรูปขวา, 4 รูปตาราง 2x2, ตั้งแต่ 5 รูปขึ้นไปแถวบน 2 แถวล่าง 3
//
// รูปเยอะกว่าที่ช่องมีให้ไม่ได้ถูกตัดทิ้ง แค่ไม่แสดงในกริด — ช่องสุดท้ายทับ
// ป้าย "+N" บอกว่ายังมีอีกกี่รูป (เปิดกล่องแก้ไขโพสต์ดูได้ครบทุกรูป)
import "./PostImageGrid.css";

const MAX_VISIBLE = 5;

export default function PostImageGrid({ images }) {
  if (!images || images.length === 0) return null;

  const visible = images.slice(0, MAX_VISIBLE);
  const hidden = images.length - visible.length;

  return (
    <div className={`post-grid post-grid--${visible.length}`}>
      {visible.map((url, index) => (
        <div key={url} className="post-grid__tile">
          <img src={url} alt="" loading="lazy" />
          {hidden > 0 && index === visible.length - 1 && (
            <span className="post-grid__more">+{hidden}</span>
          )}
        </div>
      ))}
    </div>
  );
}
