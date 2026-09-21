// ประวัติการแลกรางวัลทั้งระบบ
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import DashboardLayout from "../components/DashboardLayout";
import RewardMedia from "../components/RewardMedia";
import { Badge, Pagination, Pill, SearchBox, StatCard } from "../components/DashboardWidgets";
import { useAdminRedemptionHistory, useAdminRedemptionStats } from "../hooks/useRewards";
import {
  REWARD_CATEGORIES,
  USAGE_STATE_FILTERS,
  describeRedemptionState,
  formatPoints,
  formatRewardDate,
  fulfillmentLabel,
} from "../lib/rewards";
import "./AdminRedemptionHistory.css";

// ประวัติการแลกรางวัลทั้งระบบ — หน้านี้ตอบสามคำถามที่หน้าคำขอแลกรางวัลตอบไม่ได้
// เพราะ admin_reward_requests กรองเฉพาะของที่ต้องจัดส่ง (fulfillment_status
// ไม่เป็น null) คูปองส่วนลดที่คนแลกเยอะที่สุดจึงไม่เคยปรากฏในหน้าไหนเลย:
//
//   1) ใครแลกรางวัลอะไรไปบ้าง
//   2) ใช้รางวัลไปแล้วกี่รายการ
//   3) แลกแล้วแต่ยังไม่ได้ใช้กี่รายการ
//
// อ่านจาก view admin_redemption_history (0055) ที่มี is_admin() คุมอยู่ในตัว
// และคำนวณ usage_state มาให้แล้วด้วยสูตรเดียวกับฝั่งลูกค้า

const numberFormatter = new Intl.NumberFormat("th-TH");

const CATEGORY_FILTERS = [
  { key: "", label: "ทุกประเภท" },
  ...REWARD_CATEGORIES.map((item) => ({ key: item.key, label: item.label })),
];

// สรุปว่าใบนี้ไปถึงไหนแล้ว — ของที่ต้องจัดส่งบอกสถานะจัดส่ง ส่วนคูปองบอกว่า
// เอาไปใช้กับอะไร (used_note ถูกเขียนอัตโนมัติตอนเงินเข้า ดู 0049)
function describeProgress(row) {
  if (row.usageState === "cancelled") {
    return row.cancelReason ? `ยกเลิก · ${row.cancelReason}` : "ยกเลิกแล้ว";
  }

  if (row.fulfillmentStatus) {
    const parts = [fulfillmentLabel(row.fulfillmentStatus)];
    if (row.carrier) parts.push(row.carrier);
    if (row.trackingNumber) parts.push(row.trackingNumber);
    return parts.join(" · ");
  }

  if (row.usageState === "used") {
    return row.usedNote || `ใช้เมื่อ ${formatRewardDate(row.usedAt)}`;
  }

  if (row.usageState === "expired") {
    return `หมดอายุเมื่อ ${formatRewardDate(row.expiresAt)}`;
  }

  return `ใช้ได้ถึง ${formatRewardDate(row.expiresAt)}`;
}

export default function AdminRedemptionHistory() {
  const [state, setState] = useState("");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  const { stats } = useAdminRedemptionStats(reloadKey);
  const { rows, total, hasMore, loading, error } = useAdminRedemptionHistory({
    state,
    category,
    query: query || undefined,
    page,
    reloadKey,
  });

  // เปลี่ยนตัวกรองแล้วต้องกลับหน้า 1 เสมอ ไม่งั้นค้างอยู่หน้า 5 ของผลลัพธ์ชุด
  // ใหม่ที่อาจมีแค่หน้าเดียว แล้วเห็นตารางว่างทั้งที่มีข้อมูล
  function apply(setter) {
    return (value) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <DashboardLayout
      variant="admin"
      title="ประวัติการแลกรางวัล"
      subtitle="ดูว่าใครแลกอะไรไปบ้าง ใช้ไปแล้วกี่รายการ และยังค้างไม่ได้ใช้อีกเท่าไร"
      headerExtra={
        <button
          type="button"
          className="dash-btn"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCw size={14} aria-hidden="true" /> รีเฟรชรายการ
        </button>
      }
    >
      <div className="dash-kpi">
        <StatCard label="แลกทั้งหมด" value={stats ? numberFormatter.format(stats.totalCount) : "—"} />
        <StatCard
          label="ใช้แล้ว"
          value={stats ? numberFormatter.format(stats.usedCount) : "—"}
          tone="success"
        />
        <StatCard
          label="แลกแล้วยังไม่ได้ใช้"
          value={stats ? numberFormatter.format(stats.unusedCount) : "—"}
          tone="warning"
        />
        <StatCard
          label="รอลูกค้ายืนยันรับของ"
          value={stats ? numberFormatter.format(stats.awaitingReceipt) : "—"}
        />
      </div>

      <div className="dash-kpi admin-redeem__kpi-secondary">
        <StatCard label="หมดอายุ" value={stats ? numberFormatter.format(stats.expiredCount) : "—"} />
        <StatCard label="ยกเลิก" value={stats ? numberFormatter.format(stats.cancelledCount) : "—"} />
        <StatCard
          label="แต้มที่ถูกใช้ไป"
          value={stats ? numberFormatter.format(stats.pointsSpent) : "—"}
        />
        <StatCard
          label="สมาชิกที่เคยแลก"
          value={stats ? numberFormatter.format(stats.memberCount) : "—"}
        />
      </div>

      <div className="dash-filters">
        {USAGE_STATE_FILTERS.map((item) => (
          <Pill key={item.key || "all"} active={item.key === state} onClick={() => apply(setState)(item.key)}>
            {item.label}
          </Pill>
        ))}
        <div className="dash-filters__spacer" />
        <SearchBox
          placeholder="ค้นหาชื่อลูกค้า รหัสคูปอง หรือชื่อรางวัล"
          value={query}
          onChange={apply(setQuery)}
        />
      </div>

      <div className="dash-filters">
        {CATEGORY_FILTERS.map((item) => (
          <Pill
            key={item.key || "all"}
            active={item.key === category}
            onClick={() => apply(setCategory)(item.key)}
          >
            {item.label}
          </Pill>
        ))}
      </div>

      <section className="dash-card admin-redeem__card">
        <header className="admin-redeem__head">
          <h2 className="admin-redeem__title">รายการแลกรางวัล</h2>
          <Badge tone="tint">{numberFormatter.format(total)} รายการ</Badge>
        </header>

        {loading && <p className="dash-empty">กำลังโหลดประวัติ...</p>}
        {!loading && error && <div className="dash-message dash-message--error">{error}</div>}
        {!loading && !error && rows.length === 0 && (
          <p className="dash-empty">ไม่มีรายการแลกรางวัลในเงื่อนไขนี้</p>
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="admin-redeem__scroll">
            <table className="admin-redeem__table">
              <thead>
                <tr>
                  <th>ลูกค้า</th>
                  <th>ของรางวัล</th>
                  <th>รหัสคูปอง</th>
                  <th>แลกเมื่อ</th>
                  <th>แต้ม</th>
                  <th>ความคืบหน้า</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const badge = describeRedemptionState(row.usageState);

                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="admin-redeem__who">
                          {row.avatarUrl ? (
                            <img src={row.avatarUrl} alt="" className="admin-redeem__avatar" />
                          ) : (
                            <span className="admin-redeem__avatar" aria-hidden="true" />
                          )}
                          <div>
                            <p className="admin-redeem__name">{row.customerName}</p>
                            {row.phone && <p className="admin-redeem__sub">{row.phone}</p>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="admin-redeem__reward">
                          <RewardMedia
                            reward={{
                              name: row.rewardName,
                              category: row.rewardCategory,
                              imageUrl: row.rewardImage,
                            }}
                            size={28}
                          />
                          <div>
                            <p className="admin-redeem__name">{row.rewardName}</p>
                            {row.optionLabel && (
                              <p className="admin-redeem__sub">ตัวเลือก {row.optionLabel}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="admin-redeem__code">{row.code}</td>
                      <td>{formatRewardDate(row.createdAt)}</td>
                      <td>{formatPoints(row.pointsUsed)}</td>
                      <td className="admin-redeem__progress">{describeProgress(row)}</td>
                      <td>
                        <Badge tone={badge.tone === "neutral" ? "muted" : badge.tone}>
                          {badge.label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <footer className="dash-table-footer">
          <p>
            แสดง {rows.length} จาก {numberFormatter.format(total)} รายการ
          </p>
          <Pagination page={page} hasMore={hasMore} onChange={setPage} />
        </footer>
      </section>
    </DashboardLayout>
  );
}
