// โพสต์หมวด "รีวิว" ระบบเขียนให้เองตอนผู้ใช้ส่งรีวิวจากหน้าใบเสร็จ (0080) —
// เนื้อหาที่เก็บไว้เป็นข้อความล้วน "★★★★☆ ชื่อสาขา\nคำติชม" ถ้าปล่อยให้การ์ด
// โพสต์ทั่วไปแสดงตรง ๆ ดาวจะกลายเป็นตัวอักษรเล็ก ๆ ปนกับข้อความ อ่านยากและ
// ดูไม่ออกว่าเป็นรีวิว — บล็อกนี้เอาค่าที่แกะแล้ว (parseReviewPost) มาวาดเป็น
// ดาวจริง คะแนน ชื่อสนาม และคำติชมแยกส่วนกัน
import ClampText from "./ClampText";
import { CircleCheck, MapPin, Star } from "lucide-react";

const VERDICTS = ["", "ควรปรับปรุง", "พอใช้", "ปานกลาง", "ดี", "ดีเยี่ยม"];

export default function ReviewPostBody({ review, lines = 4 }) {
  return (
    <div className="cm-review">
      <div className="cm-review__score">
        <span
          className="cm-review__stars"
          role="img"
          aria-label={`ให้คะแนน ${review.rating} จาก 5 ดาว`}
        >
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              size={20}
              fill="currentColor"
              strokeWidth={0}
              className={`cm-review__star ${star <= review.rating ? "cm-review__star--on" : ""}`}
              aria-hidden="true"
            />
          ))}
        </span>
        <span className="cm-review__number">
          {review.rating}
          <span className="cm-review__of">/5</span>
        </span>
        <span className="cm-review__verdict">{VERDICTS[review.rating]}</span>
      </div>

      {(review.facility || review.venue) && (
        <p className="cm-review__place">
          <span className="cm-review__facility">{review.facility || "สนาม"}</span>
          {review.venue && (
            <span className="cm-review__venue">
              <MapPin size={13} aria-hidden="true" /> {review.venue}
            </span>
          )}
        </p>
      )}

      {review.comment ? (
        <ClampText text={review.comment} className="cm-body cm-review__comment" lines={lines} />
      ) : (
        <p className="cm-review__no-comment">ให้คะแนนไว้โดยไม่ได้เขียนคำติชมเพิ่มเติม</p>
      )}

      {/* หมวดนี้โพสต์เองไม่ได้ ทุกอันจึงมาจากคนที่จองและเล่นจบจริง — บอกไว้
          ให้คนอ่านเชื่อถือคะแนนได้ว่าไม่ใช่รีวิวปลอม */}
      <p className="cm-review__verified">
        <CircleCheck size={15} aria-hidden="true" /> รีวิวจากผู้ที่จองและเข้าใช้บริการจริง
      </p>
    </div>
  );
}
