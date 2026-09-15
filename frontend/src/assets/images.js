// รูปภาพทั้งหมดของแอป รวมไว้ที่เดียวเพื่อให้ import จากหน้าไหนก็ชื่อเดียวกัน
//
// รูปถ่ายเป็น .webp เสมอ (ต้นฉบับ .png วางไว้ข้าง ๆ ไฟล์ละ 1.5-3 MB หนักเกิน
// กว่าจะส่งให้ผู้ใช้จริง) — เพิ่มรูปใหม่ต้องย่อตามขนาดที่แสดงจริง x2
// แล้วบีบเป็น webp ก่อนเสมอ
import bgField from "./bg-field.webp";
import logoShield from "./logo-shield.webp";
import logoRound from "./logo-round.webp";
import userIcon from "./user-icon.svg";
import playIcon from "./play-icon.png";
import heroSports from "./booking/hero-sports.webp";
import heroFields from "./booking/hero-fields.webp";
import sportFootball from "./booking/sport-football.webp";
import sportBasketball from "./booking/sport-basketball.webp";
import sportVolleyball from "./booking/sport-volleyball.webp";
import sportTennis from "./booking/sport-tennis.webp";
// ไอคอนหมวดของรางวัล — export ตรงจาก Figma (viewBox สี่เหลี่ยมจัตุรัสทั้งชุด)
// ใช้เป็นรูปแทนเมื่อแอดมินยังไม่ได้อัปโหลดรูปของรางวัลจริง
//
// นาฬิกามีสองไฟล์เพราะมันวาดด้วยเส้น (stroke-width 1.8) ไม่ใช่พื้นทึบเหมือน
// ไอคอนตัวอื่น ถ้าเอาไฟล์ 140 ไปย่อเป็น 72 เส้นจะบางลงครึ่งหนึ่งจากที่แบบตั้งไว้
// จึงใช้ export ของแต่ละขนาดตามที่ Figma ให้มาจริง
import rewardDiscount from "./rewards/discount.svg";
import rewardClock from "./rewards/clock-72.svg";
import rewardClockLarge from "./rewards/clock-140.svg";
import rewardShirt from "./rewards/shirt.svg";
import rewardBall from "./rewards/ball.svg";
import rewardCrown from "./rewards/crown.svg";

export {
  bgField,
  logoShield,
  logoRound,
  userIcon,
  playIcon,
  heroSports,
  heroFields,
  sportFootball,
  sportBasketball,
  sportVolleyball,
  sportTennis,
  rewardDiscount,
  rewardClock,
  rewardClockLarge,
  rewardShirt,
  rewardBall,
  rewardCrown,
};
