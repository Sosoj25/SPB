import AppHeader from "../components/AppHeader";
import founderPhoto from "../assets/facilities/founder.png";
import { usePublicAmenities, useFacilitiesPageSettings } from "../hooks/useAmenities";
import "./Facilities.css";

const STATS = [
  { value: "120+", label: "สนามพันธมิตร" },
  { value: "8,400+", label: "การจองต่อเดือน" },
  { value: "4.8", label: "คะแนนผู้ใช้เฉลี่ย" },
  { value: "2024", label: "ปีที่ก่อตั้ง" },
];

export default function Facilities() {
  const { amenities, loading } = usePublicAmenities();
  const { settings } = useFacilitiesPageSettings();

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
                <div key={item.id} className="facilities__index-item">
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
              >
                <div className="facilities__feature-photo">
                  {item.imageUrl && <img src={item.imageUrl} alt={item.name} />}
                </div>
                <div className="facilities__feature-copy">
                  <p className="facilities__feature-no">{String(index + 1).padStart(2, "0")}</p>
                  <p className="facilities__feature-eyebrow">{item.category}</p>
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
