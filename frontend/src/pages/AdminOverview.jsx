// แดชบอร์ดหน้าแรกของแอดมิน — ตัวเลขวันนี้ กราฟรายได้ และรายการจองล่าสุด
import { useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, Pill, StatCard } from "../components/DashboardWidgets";
import RevenueDetailDialog from "../components/RevenueDetailDialog";
import {
  useAdminOverviewStats,
  useAdminBookings,
  useAdminPaymentStats,
  useAdminRefundStats,
  useAdminRevenueSeries,
} from "../hooks/useAdmin";
import { useAdminCommunityStats } from "../hooks/useAdminCommunity";
import { useAdminFulfillmentStats } from "../hooks/useRewards";
import {
  describeFacility,
  describeSport,
  describeStatus,
  formatBaht,
  formatBookingDate,
  formatTimeRange,
} from "../lib/bookings";
import "./AdminOverview.css";

// bucket จาก admin_revenue_series() เป็น "YYYY-MM-DDTHH:mm:ss" ไม่มี tz (เวลาไทย
// ตรง ๆ อยู่แล้ว) — new Date() อ่านสตริงไม่มี tz เป็นเวลาท้องถิ่นของเบราว์เซอร์
// ซึ่งตรงกับความหมายที่ตั้งใจ ไม่ต้องแปลง tz ซ้ำ
// th-TH นับปีเป็น พ.ศ. อยู่แล้ว แต่ format() พ่วงคำว่า "พ.ศ." มาด้วยซึ่งยาวเกิน
// ป้ายใต้แท่งกราฟ — หยิบเฉพาะส่วน year ออกมาแทน
const yearParts = new Intl.DateTimeFormat("th-TH", { year: "numeric" });
const formatYear = (date) => yearParts.formatToParts(date).find((part) => part.type === "year").value;

const rangeDateFormat = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" });
const rangeMonthFormat = new Intl.DateTimeFormat("th-TH", { month: "short", year: "numeric" });

// ป้ายบอกว่าหน้าที่กำลังเปิดอยู่ครอบช่วงไหน — จำเป็นตอนเลื่อนย้อนหลัง เพราะ
// ป้ายใต้แท่ง (จ. อ. พ. / ม.ค. ก.พ.) ซ้ำกันทุกหน้า ดูไม่ออกว่าอยู่หน้าไหนแล้ว
function describeRange(scaleKey, firstBucket, lastBucket) {
  const start = new Date(firstBucket);
  const end = new Date(lastBucket);

  if (scaleKey === "year") {
    const startYear = formatYear(start);
    const endYear = formatYear(end);
    return startYear === endYear ? `ปี ${startYear}` : `ปี ${startYear} – ${endYear}`;
  }

  if (scaleKey === "month") {
    return `${rangeMonthFormat.format(start)} – ${rangeMonthFormat.format(end)}`;
  }

  // แท่งของสเกลสัปดาห์เป็นวันจันทร์ต้นสัปดาห์ — ช่วงจึงจบที่วันอาทิตย์ของแท่งสุดท้าย
  if (scaleKey === "week") end.setDate(end.getDate() + 6);

  return `${rangeDateFormat.format(start)} – ${rangeDateFormat.format(end)}`;
}

const REVENUE_SCALES = [
  {
    key: "day",
    label: "รายวัน",
    heading: "รายได้ 7 วันล่าสุด",
    formatLabel: new Intl.DateTimeFormat("th-TH", { weekday: "short" }).format,
  },
  {
    // bucket เป็นวันจันทร์ต้นสัปดาห์ — ป้ายกำกับจึงเป็นวันเริ่มสัปดาห์นั้น
    key: "week",
    label: "สัปดาห์",
    heading: "รายได้ 8 สัปดาห์ล่าสุด",
    formatLabel: new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format,
  },
  {
    key: "month",
    label: "เดือน",
    heading: "รายได้ 12 เดือนล่าสุด",
    formatLabel: new Intl.DateTimeFormat("th-TH", { month: "short" }).format,
  },
  {
    key: "year",
    label: "ปี",
    heading: "รายได้รายปี",
    formatLabel: formatYear,
  },
];

const RECENT_BOOKINGS_LIMIT = 5;

const QUICK_LINKS = [
  { icon: "🏃", label: "รับลูกค้า Walk-in", to: "/admin/walk-in" },
  { icon: "✓", label: "เช็คอิน", to: "/admin/checkin" },
  { icon: "🕘", label: "ตารางเวลา", to: "/admin/schedule" },
  { icon: "🎁", label: "จัดการรางวัล", to: "/admin/rewards" },
];

// รวมคิวที่แอดมินต้องมาตัดสินใจเอง ใช้ hook ชุดเดียวกับกระดิ่งแจ้งเตือนใน
// DashboardLayout (payments/refunds/community) เพิ่มคำขอแลกรางวัลที่ต้องจัดส่ง
// เข้ามาด้วย เพื่อให้หน้าภาพรวมเป็นจุดเริ่มงานของแอดมินได้จริง ไม่ต้องพึ่งกระดิ่งอย่างเดียว
function useAttentionQueues() {
  const { stats: paymentStats } = useAdminPaymentStats();
  const { stats: refundStats } = useAdminRefundStats();
  const { stats: communityStats } = useAdminCommunityStats();
  const { stats: fulfillmentStats } = useAdminFulfillmentStats();

  return [
    {
      key: "payments",
      label: "การชำระเงินรอตรวจสอบ",
      count: paymentStats?.pendingCount ?? 0,
      to: "/admin/payments",
    },
    {
      key: "refunds",
      label: "คำขอคืนเงินรอตรวจสอบ",
      count: refundStats?.pendingCount ?? 0,
      to: "/admin/refunds",
    },
    {
      key: "rewards",
      label: "คำขอแลกรางวัลรอจัดส่ง",
      count: fulfillmentStats?.pendingCount ?? 0,
      to: "/admin/reward-requests",
    },
    {
      key: "community",
      label: "โพสต์ที่ถูกรายงาน",
      count: communityStats?.pendingReports ?? 0,
      to: "/admin/community",
    },
  ];
}

// ผู้จองเป็น Walk-in จะไม่มี profiles (ไม่มีบัญชี) — ใช้ชื่อที่กรอกหน้าเคาน์เตอร์แทน
const describePerson = (booking) =>
  booking.profiles?.full_name ||
  booking.profiles?.username ||
  booking.walk_in_name ||
  "—";

export default function AdminOverview() {
  const [scaleKey, setScaleKey] = useState("week");
  // 0 = หน้าล่าสุด, เพิ่มทีละ 1 เมื่อกดย้อนหลังไปอีกหนึ่งหน้าเต็ม ๆ
  const [pageOffset, setPageOffset] = useState(0);
  // ตำแหน่งแท่งที่กำลังเปิดดูรายละเอียด (null = ยังไม่ได้เปิดกล่อง)
  const [detailIndex, setDetailIndex] = useState(null);
  const scale = REVENUE_SCALES.find((s) => s.key === scaleKey);

  const { stats, loading, error } = useAdminOverviewStats();
  const {
    series: revenueSeries,
    hasOlder,
    loading: revenueLoading,
  } = useAdminRevenueSeries(scaleKey, pageOffset);
  const { bookings: recentBookings, loading: bookingsLoading } = useAdminBookings({
    page: 1,
    limit: RECENT_BOOKINGS_LIMIT,
  });
  const attentionQueues = useAttentionQueues();
  const attentionTotal = attentionQueues.reduce((sum, queue) => sum + queue.count, 0);

  const maxRevenue = Math.max(1, ...revenueSeries.map((row) => row.revenue));

  // แท่งสุดท้ายของ "หน้าล่าสุด" คือช่วงปัจจุบันที่ยังนับไม่จบ (วันนี้/สัปดาห์นี้/
  // เดือนนี้/ปีนี้) — เปิดรายละเอียดได้เฉพาะช่วงที่ผ่านไปแล้ว ตัวเลขของช่วงที่ยัง
  // ไม่จบเปลี่ยนได้ตลอดวัน เอาไปเทียบย้อนหลังไม่ได้ ส่วนหน้าที่ย้อนไปแล้วจบครบ
  // ทุกแท่ง กดได้หมด
  const openPeriodIndex = pageOffset === 0 ? revenueSeries.length - 1 : -1;
  const lastClosedIndex = pageOffset === 0 ? revenueSeries.length - 2 : revenueSeries.length - 1;
  const detailRow = detailIndex == null ? null : revenueSeries[detailIndex];
  const rangeLabel =
    revenueSeries.length > 0
      ? describeRange(scaleKey, revenueSeries[0].bucket, revenueSeries[revenueSeries.length - 1].bucket)
      : "";

  function selectScale(key) {
    setScaleKey(key);
    // ตำแหน่งแท่ง/หน้าของสเกลเก่าไม่ได้แปลว่าอะไรในสเกลใหม่ กลับไปหน้าล่าสุด
    setPageOffset(0);
    setDetailIndex(null);
  }

  function stepPage(delta) {
    setPageOffset((current) => Math.max(0, current + delta));
    // แท่งชุดใหม่คนละช่วงกับที่กล่องเปิดค้างอยู่
    setDetailIndex(null);
  }

  const kpis = stats
    ? [
        { label: "การจองวันนี้", value: String(stats.bookingsToday) },
        { label: "รายได้วันนี้", value: formatBaht(stats.revenueToday), tone: "success" },
        { label: "อัตราใช้สนาม", value: `${stats.occupancyRate}%` },
        {
          label: "รอตรวจสอบ",
          value: String(stats.pendingPayments),
          hint: "การชำระเงินค้าง",
          tone: stats.pendingPayments > 0 ? "warning" : "default",
        },
      ]
    : [];

  return (
    <DashboardLayout
      variant="admin"
      title="ภาพรวม"
      subtitle="สรุปการจองและรายได้ของสนามทั้งหมด"
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

          <div className="admin-overview__grid">
            <div className="admin-overview__main">
              <section className="dash-card admin-revenue">
                <div className="admin-revenue__header">
                  <h2>{pageOffset === 0 ? scale.heading : "รายได้ย้อนหลัง"}</h2>
                  <div className="admin-revenue__scales">
                    {REVENUE_SCALES.map((s) => (
                      <Pill key={s.key} active={s.key === scaleKey} onClick={() => selectScale(s.key)}>
                        {s.label}
                      </Pill>
                    ))}
                  </div>
                </div>

                {revenueLoading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}

                {!revenueLoading && (
                  <>
                    <div className="admin-revenue__chart">
                      {revenueSeries.map((row, index) => {
                        const label = scale.formatLabel(new Date(row.bucket));
                        const closed = index !== openPeriodIndex;

                        return (
                          <div key={row.bucket} className="admin-revenue__col">
                            <p className="admin-revenue__amount">{formatBaht(row.revenue)}</p>
                            <button
                              type="button"
                              className={`admin-revenue__bar ${closed ? "" : "admin-revenue__bar--active"}`}
                              style={{ height: `${Math.max(4, (row.revenue / maxRevenue) * 100)}%` }}
                              disabled={!closed}
                              aria-label={`ดูรายละเอียด ${label} · ${formatBaht(row.revenue)}`}
                              title={
                                closed
                                  ? `${formatBaht(row.revenue)} · กดดูรายละเอียด`
                                  : `${formatBaht(row.revenue)} · ช่วงนี้ยังไม่สิ้นสุด`
                              }
                              onClick={() => setDetailIndex(index)}
                            />
                            <p>{label}</p>
                          </div>
                        );
                      })}
                    </div>

                    <div className="admin-revenue__footer">
                      <div className="admin-revenue__pager">
                        <button
                          type="button"
                          className="admin-revenue__page"
                          aria-label="ย้อนหลังอีกหนึ่งช่วง"
                          title={
                            hasOlder
                              ? "ย้อนหลังอีกหนึ่งช่วง"
                              : "ย้อนหลังอีกหนึ่งช่วง (ก่อนหน้านี้ยังไม่มีรายได้)"
                          }
                          onClick={() => stepPage(1)}
                        >
                          ‹
                        </button>
                        <span className="admin-revenue__range">{rangeLabel}</span>
                        <button
                          type="button"
                          className="admin-revenue__page"
                          disabled={pageOffset === 0}
                          aria-label="ถัดไปหนึ่งช่วง"
                          onClick={() => stepPage(-1)}
                        >
                          ›
                        </button>
                      </div>

                      <div className="admin-revenue__footer-end">
                        <p className="admin-revenue__hint">
                          {lastClosedIndex < 0
                            ? "ยังไม่มีช่วงที่สิ้นสุด จึงยังไม่มีรายละเอียดย้อนหลัง"
                            : !hasOlder && pageOffset > 0 && maxRevenue <= 1
                              ? "ก่อนหน้าช่วงนี้ยังไม่มีรายได้บันทึกไว้"
                              : "กดที่แท่งของช่วงที่ผ่านไปแล้วเพื่อดูรายละเอียด"}
                        </p>
                        <button
                          type="button"
                          className="admin-revenue__detail"
                          disabled={lastClosedIndex < 0}
                          onClick={() => setDetailIndex(lastClosedIndex)}
                        >
                          ดูรายละเอียดย้อนหลัง
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </section>

              <section className="dash-card admin-recent">
                <div className="admin-recent__header">
                  <h2>การจองล่าสุด</h2>
                  <Link to="/admin/bookings" className="admin-recent__link">
                    ดูทั้งหมด
                  </Link>
                </div>

                {bookingsLoading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}

                {!bookingsLoading && recentBookings.length === 0 && (
                  <p className="dash-empty">ยังไม่มีการจอง</p>
                )}

                {!bookingsLoading && recentBookings.length > 0 && (
                  <ul className="admin-recent__list">
                    {recentBookings.map((booking) => {
                      const status = describeStatus(booking);
                      return (
                        <li key={booking.id} className="admin-recent__item">
                          <div className="admin-recent__info">
                            <p className="admin-recent__title">
                              {describeSport(booking)} · {describeFacility(booking)}
                            </p>
                            <p className="admin-recent__meta">
                              {describePerson(booking)} · {formatBookingDate(booking.booking_date)}
                              {" · "}
                              {formatTimeRange(booking.start_time, booking.end_time)}
                            </p>
                          </div>
                          <div className="admin-recent__end">
                            <Badge tone={status.tone}>{status.label}</Badge>
                            <p className="admin-recent__amount">
                              {formatBaht(booking.total_amount)}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>

            <div className="admin-overview__side">
              <section className="dash-card admin-attention">
                <div className="admin-attention__header">
                  <h2>ต้องดำเนินการ</h2>
                  {attentionTotal > 0 && <Badge tone="warning">{attentionTotal}</Badge>}
                </div>

                {attentionTotal === 0 ? (
                  <p className="dash-empty">ไม่มีรายการที่ต้องตรวจสอบ</p>
                ) : (
                  <ul className="admin-attention__list">
                    {attentionQueues
                      .filter((queue) => queue.count > 0)
                      .map((queue) => (
                        <li key={queue.key}>
                          <Link to={queue.to} className="admin-attention__item">
                            <span>{queue.label}</span>
                            <span className="admin-attention__count">{queue.count}</span>
                          </Link>
                        </li>
                      ))}
                  </ul>
                )}
              </section>

              <section className="dash-card admin-quick">
                <h2>ทางลัด</h2>
                <div className="admin-quick__grid">
                  {QUICK_LINKS.map((link) => (
                    <Link key={link.to} to={link.to} className="admin-quick__item">
                      <span className="admin-quick__icon" aria-hidden="true">
                        {link.icon}
                      </span>
                      <span>{link.label}</span>
                    </Link>
                  ))}
                </div>
              </section>
            </div>
          </div>

          {detailRow && (
            <RevenueDetailDialog
              scale={scale}
              bucket={detailRow.bucket}
              canStepBack={detailIndex > 0}
              canStepForward={detailIndex < lastClosedIndex}
              onStep={(delta) => setDetailIndex((current) => current + delta)}
              onClose={() => setDetailIndex(null)}
            />
          )}
        </>
      )}
    </DashboardLayout>
  );
}
