import { useState } from "react";
import AppHeader from "../components/AppHeader";
import leadPhoto from "../assets/news/lead-football.png";
import basketballPhoto from "../assets/news/basketball.png";
import "./News.css";

const CATEGORIES = ["ทั้งหมด", "การแข่งขัน", "กิจกรรม", "ประกาศ", "โปรโมชัน"];

const MORE_STORIES = [
  {
    no: "01",
    meta: "การแข่งขัน · 31 ต.ค. 2026",
    title: "Basketball League 3x3 เปิดรับสมัครฟรี ไม่มีค่าธรรมเนียม",
  },
  {
    no: "02",
    meta: "กิจกรรม · 14 พ.ย. 2026",
    title: "คลินิกฝึกทักษะฟุตซอลเยาวชน โดยโค้ชระดับลีกอาชีพ",
  },
  {
    no: "03",
    meta: "ประกาศ · 1 ธ.ค. 2026",
    title: "ปรับปรุงสนามแบดมินตัน คอร์ต 3–5 ระหว่าง 1–7 ธันวาคม",
  },
  {
    no: "04",
    meta: "โปรโมชัน · 8 ธ.ค. 2026",
    title: "จองสนามช่วงเช้าวันธรรมดา รับส่วนลด 20% ตลอดเดือน",
  },
];

const SPECIAL_REPORTS = [
  {
    photo: basketballPhoto,
    meta: "การแข่งขัน · 31 ต.ค. 2026",
    title: "Basketball League 3x3",
    desc: "ลีกบาสเกตบอลแบบเปิด ไม่มีค่าสมัคร แข่งขันระบบแพ้คัดออก ผู้ชนะรับถ้วยรางวัลและสิทธิ์ใช้สนามฟรี 1 ปี",
  },
  {
    photo: null,
    meta: "กิจกรรม · 14 พ.ย. 2026",
    title: "คลินิกฟุตซอลเยาวชน",
    desc: "อบรมฟรีสำหรับเยาวชนอายุ 10–15 ปี โดยโค้ชระดับลีกอาชีพ รับจำนวนจำกัด 40 คน ลงทะเบียนล่วงหน้า",
  },
  {
    photo: null,
    meta: "ประกาศ · 1 ธ.ค. 2026",
    title: "ปรับปรุงคอร์ตแบดมินตัน",
    desc: "ปิดปรับปรุงพื้นคอร์ตและระบบไฟส่องสว่าง คอร์ต 3–5 ระหว่างวันที่ 1–7 ธันวาคม คอร์ตอื่นเปิดตามปกติ",
  },
];

export default function News() {
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0]);

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

        <section className="news__lead-grid">
          <article className="news__lead">
            <div className="news__lead-photo">
              <img src={leadPhoto} alt="ทีมเยาวชนแข่งขันฟุตบอลลีก U18" />
            </div>
            <p className="news__meta">การแข่งขัน · 25 ธันวาคม 2026</p>
            <h2 className="news__lead-title">
              ฟุตบอลลีก รุ่น U18 ชิงเงินรางวัลรวม 300,000 บาท
            </h2>
            <p className="news__lead-desc">
              เปิดรับสมัครทีมเยาวชนจากทั่วประเทศ แข่งขันระบบลีกที่ SPB Arena รามอินทรา
              ตลอดเดือนธันวาคม ปิดรับสมัครวันที่ 20 ธันวาคม 2026 สอบถามเพิ่มเติม 099-191-5489
            </p>
            <button type="button" className="news__lead-link">
              อ่านรายงานฉบับเต็ม
            </button>
          </article>

          <aside className="news__sidebar">
            <p className="news__sidebar-title">เรื่องอื่นในสัปดาห์นี้</p>
            <div className="news__sidebar-list">
              {MORE_STORIES.map((story) => (
                <div key={story.no} className="news__sidebar-item">
                  <span className="news__sidebar-no">{story.no}</span>
                  <div>
                    <p className="news__sidebar-meta">{story.meta}</p>
                    <p className="news__sidebar-headline">{story.title}</p>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="news__sidebar-all">
              ดูข่าวทั้งหมด →
            </button>
          </aside>
        </section>

        <div className="news__rule news__rule--strong" />
        <p className="news__section-label">รายงานพิเศษ</p>

        <section className="news__grid">
          {SPECIAL_REPORTS.map((report) => (
            <article key={report.title} className="news__card">
              <div className="news__card-photo">
                {report.photo ? (
                  <img src={report.photo} alt="" />
                ) : (
                  <div className="news__card-placeholder" aria-hidden="true" />
                )}
              </div>
              <p className="news__meta">{report.meta}</p>
              <h3 className="news__card-title">{report.title}</h3>
              <p className="news__card-desc">{report.desc}</p>
              <p className="news__card-link">อ่านต่อ →</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
