import DashboardLayout from "../components/DashboardLayout";
import { StatCard, SearchBox } from "../components/DashboardWidgets";
import { useAdminOverviewStats } from "../hooks/useAdmin";
import { formatBaht } from "../lib/bookings";
import "./AdminOverview.css";

const dayLabelFormatter = new Intl.DateTimeFormat("th-TH", { weekday: "short" });

// วันที่จาก RPC เป็น "YYYY-MM-DD" — ต่อ T00:00:00 ให้อ่านเป็นเวลาท้องถิ่น
// เหมือน toLocalDate ใน lib/bookings.js ไม่งั้นวันจะเพี้ยนในโซนเวลาไทย
const dayLabel = (isoDate) => dayLabelFormatter.format(new Date(`${isoDate}T00:00:00`));

export default function AdminOverview() {
  const { stats, loading, error } = useAdminOverviewStats();

  const maxRevenue = stats
    ? Math.max(1, ...stats.revenueByDay.map((row) => row.revenue))
    : 1;

  const kpis = stats
    ? [
        { label: "การจองวันนี้", value: String(stats.bookingsToday) },
        { label: "รายได้วันนี้", value: formatBaht(stats.revenueToday) },
        { label: "อัตราใช้สนาม", value: `${stats.occupancyRate}%` },
        { label: "รอตรวจสอบ", value: String(stats.pendingPayments), hint: "การชำระเงินค้าง" },
      ]
    : [];

  return (
    <DashboardLayout
      variant="admin"
      title="ภาพรวม"
      subtitle="สรุปการจองและรายได้ของสนามทั้งหมด"
      headerExtra={<SearchBox />}
    >
      {loading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}

      {!loading && error && <div className="dash-message dash-message--error">{error}</div>}

      {!loading && !error && (
        <>
          <section className="dash-kpi">
            {kpis.map((kpi) => (
              <StatCard key={kpi.label} {...kpi} />
            ))}
          </section>

          <section className="dash-card admin-revenue">
            <div className="admin-revenue__header">
              <h2>รายได้ 7 วันล่าสุด</h2>
              <span className="dash-pill dash-pill--tint">สัปดาห์นี้</span>
            </div>
            <div className="admin-revenue__chart">
              {stats.revenueByDay.map((row, index) => (
                <div key={row.day} className="admin-revenue__col">
                  <div
                    className={`admin-revenue__bar ${
                      index === stats.revenueByDay.length - 1 ? "admin-revenue__bar--active" : ""
                    }`}
                    style={{ height: `${Math.max(4, (row.revenue / maxRevenue) * 100)}%` }}
                    title={formatBaht(row.revenue)}
                  />
                  <p>{dayLabel(row.day)}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </DashboardLayout>
  );
}
