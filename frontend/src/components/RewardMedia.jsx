// รูปประจำของรางวัล — ถ้าแอดมินอัปโหลดรูปจริงไว้ก็ใช้รูปนั้น ถ้ายังไม่มีก็
// ตกลงมาที่ไอคอนบนพื้นม่วงอ่อนแบบในแบบ Figma
//
// แบบเลือกไอคอนรายชิ้น ไม่ได้เลือกตามหมวดล้วน ๆ (หมวด "สิทธิพิเศษ" ใช้ทั้ง
// นาฬิกาและมงกุฎ หมวด "ของรางวัล" ใช้ทั้งเสื้อและลูกบอล) — จับคำในชื่อก่อน
// แล้วค่อยตกมาที่ไอคอนประจำหมวด รางวัลที่แอดมินเพิ่มเองทีหลังจึงได้ไอคอนที่
// เข้าเค้าเสมอ ไม่ใช่กล่องว่าง
import {
  rewardBall,
  rewardClock,
  rewardClockLarge,
  rewardCrown,
  rewardDiscount,
  rewardShirt,
} from "../assets/images";
import "./RewardMedia.css";

const KEYWORD_ICONS = [
  [/เสื้อ|shirt|jersey/i, rewardShirt],
  [/ลูกบอล|ลูกฟุตบอล|บอล|ball/i, rewardBall],
  [/ชั่วโมง|ฟรี|เวลา|hour/i, rewardClock],
];

const CATEGORY_ICONS = {
  discount: rewardDiscount,
  merchandise: rewardBall,
  privilege: rewardCrown,
};

function rewardIcon(reward, size) {
  const name = reward?.name ?? "";
  const match = KEYWORD_ICONS.find(([pattern]) => pattern.test(name));
  const icon = match ? match[1] : CATEGORY_ICONS[reward?.category] ?? rewardDiscount;

  // นาฬิกาเป็นไอคอนเส้น จึงมี export แยกสองขนาดจาก Figma — ใช้ไฟล์ 140 เฉพาะ
  // ตอนแสดงใหญ่ (หน้ารายละเอียด) ไม่งั้นเส้นจะหนา/บางผิดจากที่แบบตั้งไว้
  return icon === rewardClock && size >= 140 ? rewardClockLarge : icon;
}

// size = ด้านของไอคอน (px) ตามแบบ: การ์ดในตาราง 72, หน้ารายละเอียด 140,
// แถวในลิสต์ของแอดมิน 64/60 — ส่งเป็นตัวเลขเสมอ ไม่ปล่อยให้ยืดตามกล่อง
// เพราะไอคอนชุดนี้ตั้ง preserveAspectRatio="none" มาจาก Figma
export default function RewardMedia({ reward, size = 72, className = "" }) {
  const src = reward?.imageUrl || reward?.rewardImage;

  if (src) {
    return (
      <div className={`reward-media ${className}`}>
        <img src={src} alt="" className="reward-media__photo" />
      </div>
    );
  }

  return (
    <div className={`reward-media ${className}`}>
      <img
        src={rewardIcon(reward, size)}
        alt=""
        width={size}
        height={size}
        className="reward-media__icon"
      />
    </div>
  );
}
