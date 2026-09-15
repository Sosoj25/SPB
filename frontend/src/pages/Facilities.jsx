// หน้าสิ่งอำนวยความสะดวก (/facilities) — ข้อมูลคลับ สิ่งอำนวยความสะดวก
// และตัวเลขสถิติจริงของระบบ
import AppHeader from "../components/AppHeader";
import founderPhoto from "../assets/facilities/founder.png";
import { usePublicAmenities, useFacilitiesPageSettings } from "../hooks/useAmenities";
import { usePlatformStats } from "../hooks/useStats";
import "./Facilities.css";

const numberFormat = new Intl.NumberFormat("th-TH");

// ตัวเลขสี่ช่องท้ายหน้ามาจาก platform_stats() ตัวเดียวกับหน้าแรก
// ทุกตัวต้องเป็นค่าจริงจาก DB ห้ามพิมพ์ตัวเลขเองให้ดูดี
function statCards(stats) {
  return [
    // ช่องแรกใช้ตัวนับเดียวกับช่อง "การจองต่อเดือน" บนหน้าแรก (นับเฉพาะ
    // confirmed / awaiting_review / no_show / completed — ที่ยกเลิกกับที่ถูกปฏิเสธไม่นับ)
    { value: numberFormat.format(stats.bookingsThisMonth), label: "การจองต่อเดือน" },
    { value: numberFormat.format(stats.facilities), label: "สนามให้เลือกจอง" },
    { value: numberFormat.format(stats.sports), label: "ประเภทกีฬา" },

    // ดาวเฉลี่ยโชว์ได้ต่อเมื่อมีรีวิวที่เผยแพร่แล้วจริง ๆ เท่านั้น —
    // ระหว่างที่ยังไม่มีรีวิว ใช้ยอดจองสะสมทั้งหมดแทน
    stats.reviewsCount > 0
      ? {
          value: `${stats.avgRating.toFixed(1)}★`,
          label: `คะแนนเฉลี่ยจาก ${numberFormat.format(stats.reviewsCount)} รีวิว`,
        }
      : { value: numberFormat.format(stats.bookingsTotal), label: "การจองทั้งหมด" },
  ];
}

export default function Facilities() {
  const { amenities, loading } = usePublicAmenities();
  const { settings } = useFacilitiesPageSettings();
  const { stats } = usePlatformStats();

  return (
    <div className="facilities">
      <AppHeader />

      <main className="facilities__main">
        <section className="facilities__masthead">
          <p className="facilities__eyebrow">{settings?.eyebrow || "THE CLUB"}</p>
          <h1 className="facilities__title">{settings?.heading || "สิ่งอำนวยความสะดวก"}</h1>
          <p className="facilities__intro">{settings?.intro}</p>
        </section>

        <div className="facilities__rule facilities__rule--strong" />

        {!loading && amenities.length === 0 && (
          <p className="facilities__intro">ยังไม่มีข้อมูลสิ่งอำนวยความสะดวก</p>
        )}

        {amenities.length > 0 && (
          <>
            <section className="facilities__index">
              {amenities.map((item, index) => (
                <div key={item.id} className="facilities__index-item" data-category={item.category}>
                  <p className="facilities__index-no">{String(index + 1).padStart(2, "0")}</p>
                  <p className="facilities__index-title">{item.name}</p>
                  <p className="facilities__index-desc">{item.category}</p>
                </div>
              ))}
            </section>

            <div className="facilities__rule" />

            {amenities.map((item, index) => (
              <section
                key={item.id}
                className={`facilities__feature ${index % 2 === 1 ? "facilities__feature--reverse" : ""}`}
                data-category={item.category}
              >
                <div className="facilities__feature-photo">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} />
                  ) : (
                    <span className="facilities__feature-no facilities__feature-no--photo">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  )}
                </div>
                <div className="facilities__feature-copy">
                  <p className="facilities__feature-no">{String(index + 1).padStart(2, "0")}</p>
                  {item.category && (
                    <p className="facilities__feature-eyebrow">{item.category}</p>
                  )}
                  <h2 className="facilities__feature-title">{item.name}</h2>
                  <p className="facilities__feature-desc">{item.description}</p>
                  {item.facts.length > 0 && (
                    <dl className="facilities__facts">
                      {item.facts.map((fact) => (
                        <div key={fact.id} className="facilities__fact">
                          <dt>{fact.label}</dt>
                          <dd>{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </section>
            ))}
          </>
        )}

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

              {/* ประโยคท้ายดึงจำนวนจากตัวนับเดียวกับช่องสถิติ และหายไปทั้ง
                  ประโยคถ้าโหลดตัวเลขไม่ได้ — ห้ามเขียนจำนวนสนามค้างไว้เอง */}
              <p className="facilities__founder-bio">
                อายุ 24 ปี จบการศึกษาจากมหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ
                ก่อตั้ง SPORTSBOOKING ในปี 2026
                {stats &&
                  ` ปัจจุบันเปิดให้บริการ ${numberFormat.format(stats.venues)} สถานที่ รวม ${numberFormat.format(stats.facilities)} สนาม ครอบคลุม ${numberFormat.format(stats.sports)} ประเภทกีฬา`}
              </p>
            </div>
          </div>
        </section>

        {stats && (
          <>
            <div className="facilities__rule facilities__rule--strong" />

            <section className="facilities__stats">
              {statCards(stats).map((stat) => (
                <div key={stat.label} className="facilities__stat">
                  <p className="facilities__stat-value">{stat.value}</p>
                  <p className="facilities__stat-label">{stat.label}</p>
                </div>
              ))}
            </section>
          </>
        )}

        <div className="facilities__rule" />
      </main>
    </div>
  );
}
