import AppHeader from "../components/AppHeader";
import barPhoto from "../assets/facilities/bar.png";
import omakasePhoto from "../assets/facilities/omakase.png";
import founderPhoto from "../assets/facilities/founder.png";
import "./Facilities.css";

const AMENITIES = [
  { no: "01", title: "SIDESTBAR", desc: "มินิบาร์ค็อกเทล" },
  { no: "02", title: "OMAKASE", desc: "ห้องอาหารญี่ปุ่น" },
  { no: "03", title: "ห้องอาบน้ำ", desc: "พร้อมล็อกเกอร์" },
  { no: "04", title: "ที่จอดรถ", desc: "รองรับ 200 คัน" },
  { no: "05", title: "Wi-Fi", desc: "ฟรีทั่วบริเวณ" },
];

const STATS = [
  { value: "120+", label: "สนามพันธมิตร" },
  { value: "8,400+", label: "การจองต่อเดือน" },
  { value: "4.8", label: "คะแนนผู้ใช้เฉลี่ย" },
  { value: "2024", label: "ปีที่ก่อตั้ง" },
];

export default function Facilities() {
  return (
    <div className="facilities">
      <AppHeader />

      <main className="facilities__main">
        <section className="facilities__masthead">
          <p className="facilities__eyebrow">THE CLUB</p>
          <h1 className="facilities__title">สิ่งอำนวยความสะดวก</h1>
          <p className="facilities__intro">
            มากกว่าแค่สนามกีฬา — สปอร์ตคลับของเรามีบาร์ ห้องอาหาร และบริการครบครัน
            เพื่อให้ทุกการมาเยือนสมบูรณ์แบบ
          </p>
        </section>

        <div className="facilities__rule facilities__rule--strong" />

        <section className="facilities__index">
          {AMENITIES.map((item) => (
            <div key={item.no} className="facilities__index-item">
              <p className="facilities__index-no">{item.no}</p>
              <p className="facilities__index-title">{item.title}</p>
              <p className="facilities__index-desc">{item.desc}</p>
            </div>
          ))}
        </section>

        <div className="facilities__rule" />

        <section className="facilities__feature">
          <div className="facilities__feature-photo">
            <img src={barPhoto} alt="มินิบาร์ค็อกเทลภายในสปอร์ตคลับ" />
          </div>
          <div className="facilities__feature-copy">
            <p className="facilities__feature-no">01</p>
            <p className="facilities__feature-eyebrow">บาร์ &amp; เครื่องดื่ม</p>
            <h2 className="facilities__feature-title">SIDESTBAR</h2>
            <p className="facilities__feature-desc">
              มินิบาร์บรรยากาศอบอุ่นภายในสปอร์ตคลับ แสงไฟสลัวและที่นั่งเคาน์เตอร์ยาว
              เหมาะสำหรับนั่งพักหลังเล่นกีฬา หรือสังสรรค์กับทีมหลังจบเกม
            </p>
            <dl className="facilities__facts">
              <div className="facilities__fact">
                <dt>ตำแหน่ง</dt>
                <dd>โซนชั้นในของที่พัก</dd>
              </div>
              <div className="facilities__fact">
                <dt>เมนูซิกเนเจอร์</dt>
                <dd>Cocktail White Whiskey</dd>
              </div>
              <div className="facilities__fact">
                <dt>เวลาเปิด</dt>
                <dd>17:00 – 24:00 น.</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="facilities__feature facilities__feature--reverse">
          <div className="facilities__feature-copy">
            <p className="facilities__feature-no">02</p>
            <p className="facilities__feature-eyebrow">ห้องอาหาร</p>
            <h2 className="facilities__feature-title">OMAKASE</h2>
            <p className="facilities__feature-desc">
              ร้านอาหารซิกเนเจอร์ของสปอร์ตคลับ นำเข้าวัตถุดิบสดจากญี่ปุ่นทุกวัน
              เสิร์ฟแบบโอมากาเสะโดยเชฟประจำร้าน ที่นั่งเคาน์เตอร์ 12 ที่ ควรจองล่วงหน้า
            </p>
            <dl className="facilities__facts">
              <div className="facilities__fact">
                <dt>ตำแหน่ง</dt>
                <dd>โซนชั้นในของห้องอาหาร</dd>
              </div>
              <div className="facilities__fact">
                <dt>เมนูซิกเนเจอร์</dt>
                <dd>Otoro Roll, Uni Sauce</dd>
              </div>
              <div className="facilities__fact">
                <dt>เวลาเปิด</dt>
                <dd>11:00 – 22:00 น.</dd>
              </div>
            </dl>
          </div>
          <div className="facilities__feature-photo">
            <img src={omakasePhoto} alt="เชฟกำลังปรุงซูชิในห้องโอมากาเสะ" />
          </div>
        </section>

        <div className="facilities__rule facilities__rule--strong" />

        <section className="facilities__founder">
          <p className="facilities__section-label">ผู้ก่อตั้ง</p>
          <div className="facilities__founder-grid">
            <div className="facilities__founder-photo">
              <img src={founderPhoto} alt="ศุภพล อนุกูล ผู้ก่อตั้ง SPORTSBOOKING" />
            </div>
            <div className="facilities__founder-copy">
              <p className="facilities__quote">
                “อยากให้คนไทยเข้าถึงสนามกีฬาได้ง่ายขึ้น จองสะดวก ราคาโปร่งใส
                และมีชุมชนคนรักกีฬาที่แข็งแรง”
              </p>
              <div className="facilities__rule" />
              <p className="facilities__founder-name">ศุภพล อนุกูล</p>
              <p className="facilities__founder-role">CEO &amp; FOUNDER — SPORTSBOOKING</p>
              <p className="facilities__founder-bio">
                อายุ 24 ปี จบการศึกษาจากมหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ
                ก่อตั้ง SPORTSBOOKING ในปี 2024 ปัจจุบันให้บริการสนามพันธมิตรกว่า 120 แห่ง
                ทั่วกรุงเทพฯ และปริมณฑล
              </p>
            </div>
          </div>
        </section>

        <div className="facilities__rule facilities__rule--strong" />

        <section className="facilities__stats">
          {STATS.map((stat) => (
            <div key={stat.label} className="facilities__stat">
              <p className="facilities__stat-value">{stat.value}</p>
              <p className="facilities__stat-label">{stat.label}</p>
            </div>
          ))}
        </section>

        <div className="facilities__rule" />
      </main>
    </div>
  );
}
