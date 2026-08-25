import DashboardLayout from "../components/DashboardLayout";
import { StatCard, Badge } from "../components/DashboardWidgets";
import { useSuperAdminOverviewStats } from "../hooks/useAdmin";
import { formatBaht } from "../lib/bookings";
import "./SuperAdminOverview.css";

const STATUS_TONE = {
  active: "success",
  inactive: "danger",
};

const STATUS_LABEL = {
  active: "เปิดให้บริการ",
  inactive: "ปิดให้บริการ",
};

export default function SuperAdminOverview() {
  const { stats, loading, error } = useSuperAdminOverviewStats();

  const kpis = stats
    ? [
        { label: "Venue ทั้งหมด", value: String(stats.venuesCount) },
        { label: "ผู้ใช้ทั้งหมด", value: stats.usersCount.toLocaleString() },
        { label: "รายได้เดือนนี้", value: formatBaht(stats.revenueThisMonth) },
        { label: "ผู้ดูแลระบบ", value: String(stats.adminsCount) },
      ]
    : [];

  return (
    <DashboardLayout
      variant="superadmin"
      title="ภาพรวมระบบ"
      subtitle="สรุปการใช้งานทุก venue ทั่วระบบ"
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

          <div className="dash-card sa-branches">
            <div className="sa-branches__header">
              <h2>ผลประกอบการรายสนาม</h2>
              <span className="dash-pill dash-pill--tint">เดือนนี้</span>
            </div>
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Venue</th>
                    <th>การจอง</th>
                    <th>รายได้</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.venues.map((venue) => (
                    <tr key={venue.id}>
                      <td>{venue.name}</td>
                      <td>{venue.bookingsThisMonth}</td>
                      <td>{formatBaht(venue.revenueThisMonth)}</td>
                      <td>
                        <Badge tone={STATUS_TONE[venue.status]}>
                          {STATUS_LABEL[venue.status] ?? venue.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
