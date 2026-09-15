// คิวจัดส่งของรางวัล — ของที่ต้องส่งจริงหรือให้มารับที่สนาม
import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import RewardMedia from "../components/RewardMedia";
import { Badge, Pagination, Pill, StatCard } from "../components/DashboardWidgets";
import TextPromptDialog from "../components/TextPromptDialog";
import { useAdminFulfillmentStats, useAdminRewardRequests } from "../hooks/useRewards";
import {
  ADMIN_FULFILLMENT_STATUSES,
  FULFILLMENT_FILTERS,
  buildFulfillmentCsv,
  cancelRedemption,
  fetchAllRewardRequests,
  fetchRedemptionReceiptSignedUrl,
  formatPoints,
  formatRewardDate,
  fulfillmentLabel,
  fulfillmentStep,
  needsTrackingInfo,
  updateFulfillment,
} from "../lib/rewards";
import { errorMessage } from "../lib/errors";
import "./AdminRewardRequests.css";

// คิวจัดส่งของรางวัลที่เป็นของจริง — อ่านจาก view admin_reward_requests (0047)
// ซึ่ง join ชื่อ/เบอร์ลูกค้ามาให้แล้ว (profiles_select_own ปิดไม่ให้อ่านตรง ๆ)
//
// ทุกการเปลี่ยนสถานะไปผ่าน RPC เพราะต้องเขียนแจ้งเตือนให้ลูกค้าและ (ตอน
// ยกเลิก) คืนแต้มกับคืนสต๊อกในทรานแซกชันเดียวกัน

const STATUS_TONES = {
  pending: "warning",
  preparing: "warning",
  shipped: "primary",
  shipping: "primary",
  in_transit: "primary",
  delivered: "success",
  received: "success",
  pickup: "tint",
};

// ผู้เรียกใส่ key ผูกกับ id ของคำขอ — React จึง remount แผงนี้ใหม่ทุกครั้งที่
// สลับไปดูคำขอใบอื่น เลขพัสดุที่พิมพ์ค้างไว้จึงหายไปเอง ไม่ต้องมี effect คอย
// ล้าง state (และไม่มีจังหวะที่กด "จัดส่งแล้ว" ให้คำขอ B ด้วยเลขของคำขอ A)
function ShippingPanel({ request, busy, onUpdate, onCancel }) {
  const [tracking, setTracking] = useState(request?.trackingNumber ?? "");
  const [carrier, setCarrier] = useState(request?.carrier ?? "");
  const [note, setNote] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [proofBusy, setProofBusy] = useState(false);
  const [proofError, setProofError] = useState("");

  // บัคเก็ต reward-receipts เป็นแบบส่วนตัว (ในรูปมีหน้าบ้าน/ชื่อผู้รับ) จึงขอ
  // signed URL ตอนแอดมินกดดูจริงเท่านั้น ไม่ยิงล่วงหน้าให้ทุกแถวในคิว
  async function showProof() {
    setProofBusy(true);
    setProofError("");

    try {
      setProofUrl(await fetchRedemptionReceiptSignedUrl(request.receiptProofPath));
    } catch (err) {
      console.error("เปิดรูปหลักฐานการรับของไม่สำเร็จ:", err);
      setProofError(errorMessage(err));
    } finally {
      setProofBusy(false);
    }
  }

  if (!request) {
    return (
      <aside className="dash-card admin-requests__panel">
        <p className="dash-empty">เลือกคำขอทางซ้ายเพื่อจัดการการจัดส่ง</p>
      </aside>
    );
  }

  // ลูกค้ากดยืนยันรับของแล้ว = จบงาน แอดมินแก้สถานะย้อนกลับไม่ได้แล้ว
  // (0055 ปฏิเสธไว้ที่ฝั่ง RPC ด้วย ไม่ได้กันแค่ปุ่ม)
  const done = request.fulfillmentStatus === "received";
  const cancelled = request.status === "cancelled";
  const step = fulfillmentStep(request.fulfillmentStatus);
  // ของที่ส่งเป็นพัสดุต้องมีขนส่ง + เลขพัสดุก่อนถึงขั้น "จัดส่งแล้ว" —
  // admin_update_redemption_fulfillment() (0085) ปฏิเสธไว้ที่ฝั่งเซิร์ฟเวอร์
  const missingTracking = needsTrackingInfo(request, { carrier, tracking });

  return (
    <aside className="dash-card admin-requests__panel">
      <div className="admin-requests__panel-head">
        <h2>จัดการการจัดส่ง</h2>
        <Badge tone={cancelled ? "danger" : STATUS_TONES[request.fulfillmentStatus] ?? "muted"}>
          {cancelled ? "ยกเลิกแล้ว" : fulfillmentLabel(request.fulfillmentStatus)}
        </Badge>
      </div>

      <div className="dash-identity">
        <div className="dash-identity__avatar" aria-hidden="true">
          {request.customerName.charAt(0)}
        </div>
        <div>
          <p className="dash-identity__name">{request.customerName}</p>
          <p className="dash-identity__email">{request.phone || "ไม่ได้ระบุเบอร์โทร"}</p>
        </div>
      </div>

      <hr className="admin-requests__divider" />

      <dl className="admin-requests__facts">
        <div className="admin-requests__fact">
          <dt>ของรางวัล</dt>
          <dd>
            {request.rewardName}
            {request.optionLabel ? ` (ไซซ์ ${request.optionLabel})` : ""}
          </dd>
        </div>
        <div className="admin-requests__fact">
          <dt>รหัสคูปอง</dt>
          <dd>{request.code}</dd>
        </div>
        <div className="admin-requests__fact">
          <dt>วันที่แลก</dt>
          <dd>{formatRewardDate(request.createdAt)}</dd>
        </div>
        <div className="admin-requests__fact">
          <dt>แต้มที่ใช้</dt>
          <dd>{formatPoints(request.pointsUsed)} แต้ม</dd>
        </div>
      </dl>

      <div className="admin-requests__address">
        <p className="admin-requests__address-label">
          {request.address ? "ที่อยู่จัดส่ง" : "วิธีรับของ"}
        </p>
        <p className="admin-requests__address-body">
          {request.address || "ลูกค้าเลือกมารับเองที่สนาม — ติดต่อนัดวันรับของ"}
        </p>
      </div>

      {cancelled ? (
        <p className="dash-message dash-message--error">
          คำขอนี้ถูกยกเลิกและคืนแต้มให้ลูกค้าแล้ว
          {request.cancelReason ? ` (${request.cancelReason})` : ""}
        </p>
      ) : (
        <>
          {/* เลขพัสดุกับชื่อขนส่งต้องมาคู่กัน — เลขอย่างเดียวตามของไม่ได้ถ้า
              ไม่รู้ว่าเป็นของเจ้าไหน (เลข Kerry กับ Flash หน้าตาใกล้กันมาก) */}
          {request.fulfillmentStatus !== "pickup" && (
            <>
              <label className="dash-field">
                <span className="dash-field__label">บริษัทขนส่ง</span>
                <input
                  type="text"
                  className="dash-input"
                  placeholder="เช่น Kerry Express, Flash, ไปรษณีย์ไทย"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  disabled={done}
                />
              </label>

              <label className="dash-field">
                <span className="dash-field__label">เลขพัสดุ (ลูกค้าเห็นเลขนี้)</span>
                <input
                  type="text"
                  className="dash-input"
                  placeholder="เช่น TH88213420XX"
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                  disabled={done}
                />
              </label>
            </>
          )}

          <label className="dash-field">
            <span className="dash-field__label">หมายเหตุถึงลูกค้า (ไม่บังคับ)</span>
            <input
              type="text"
              className="dash-input"
              placeholder="เช่น นัดรับที่เคาน์เตอร์ในเวลาทำการ"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={done}
            />
          </label>

          {/* เดินสถานะทีละขั้นตามเส้นทางจริง แทนปุ่ม "จัดส่งแล้ว" ปุ่มเดียวที่
              กระโดดข้ามทุกขั้น — ขั้นที่ผ่านมาแล้วยังกดซ้ำได้ (แก้ข้อมูลย้อนหลัง)
              แต่จะไม่ยิงแจ้งเตือนซ้ำถ้าไม่ได้เปลี่ยนอะไรจริง ๆ ที่ฝั่ง RPC
              ส่วน "ลูกค้ายืนยันได้รับแล้ว" ไม่มีปุ่มให้แอดมินกดโดยตั้งใจ */}
          <div className="admin-requests__steps">
            {ADMIN_FULFILLMENT_STATUSES.map((item) => {
              // ขั้นก่อน "จัดส่งแล้ว" (รอดำเนินการ/กำลังเตรียม) กับการนัดรับที่
              // สนามยังไม่มีพัสดุ จึงไม่ต้องรอเลขอะไร
              const blocked =
                missingTracking && item.key !== "pickup" && fulfillmentStep(item.key) >= 2;

              return (
                <button
                  key={item.key}
                  type="button"
                  className={`dash-btn admin-requests__step ${
                    request.fulfillmentStatus === item.key ? "admin-requests__step--now" : ""
                  } ${fulfillmentStep(item.key) < step ? "admin-requests__step--past" : ""}`}
                  disabled={busy || done || blocked || request.fulfillmentStatus === item.key}
                  title={blocked ? "กรอกบริษัทขนส่งและเลขพัสดุก่อน" : undefined}
                  onClick={() => onUpdate(request, item.key, { tracking, carrier, note })}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {missingTracking && !done && (
            <p className="admin-requests__note">
              กรอกบริษัทขนส่งและเลขพัสดุด้านบนก่อน จึงจะกด "จัดส่งแล้ว"
              และขั้นถัดจากนั้นได้ — ลูกค้าจะได้เลขไปตามของกับขนส่งเองได้
              และเลขนี้จะติดไปกับแจ้งเตือนที่ส่งให้ด้วย
            </p>
          )}

          {done && (
            <p className="dash-message dash-message--success">
              ลูกค้ายืนยันว่าได้รับของรางวัลแล้วเมื่อ {formatRewardDate(request.receivedAt)}
            </p>
          )}

          {request.receiptProofPath && (
            <div className="admin-requests__proof">
              <p className="admin-requests__address-label">หลักฐานการรับของจากลูกค้า</p>
              {proofUrl ? (
                <img
                  src={proofUrl}
                  alt="รูปของรางวัลที่ลูกค้าได้รับ"
                  className="admin-requests__proof-img"
                />
              ) : (
                <button
                  type="button"
                  className="dash-btn"
                  disabled={proofBusy}
                  onClick={showProof}
                >
                  {proofBusy ? "กำลังเปิดรูป..." : "🖼 ดูรูปที่ลูกค้าแนบ"}
                </button>
              )}
              {proofError && <p className="dash-message dash-message--error">{proofError}</p>}
            </div>
          )}

          {request.fulfillmentStatus === "delivered" && (
            <p className="admin-requests__note">
              รอลูกค้ากดยืนยันการรับของที่หน้าประวัติการแลกรางวัลของตัวเอง
              — สถานะสุดท้ายนี้แอดมินตั้งแทนลูกค้าไม่ได้
            </p>
          )}

          <button
            type="button"
            className="dash-btn admin-requests__cancel"
            disabled={busy}
            onClick={() => onCancel(request)}
          >
            ยกเลิกคำขอ
          </button>

          <p className="admin-requests__note">
            การยกเลิกจะคืนแต้ม {formatPoints(request.pointsUsed)} แต้มเข้าบัญชีลูกค้า
            และคืนสต๊อกให้อัตโนมัติ
          </p>
        </>
      )}
    </aside>
  );
}

export default function AdminRewardRequests() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [exporting, setExporting] = useState(false);

  const { stats } = useAdminFulfillmentStats(reloadKey);
  const { requests, hasMore, loading, error } = useAdminRewardRequests({
    status,
    page,
    reloadKey,
  });

  const reload = () => setReloadKey((key) => key + 1);

  // แถวที่เลือกไว้อาจหลุดออกจากหน้าหลังเปลี่ยนสถานะหรือสลับตัวกรอง — ยึด
  // แถวสดจากรายการล่าสุดเสมอ ไม่ใช่สำเนาที่ค้างอยู่ใน state ตั้งแต่ตอนคลิก
  const current = selected ? requests.find((r) => r.id === selected) ?? null : null;

  function switchFilter(key) {
    setStatus(key);
    setPage(1);
    setSelected(null);
  }

  async function run(action, successText) {
    setBusy(true);
    setMessage(null);

    try {
      await action();
      setMessage({ tone: "success", text: successText });
      reload();
    } catch (err) {
      console.error("fulfillment action failed:", err);
      setMessage({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    // ยิงดึงทั้งรายการก่อน ไม่ใช่ใช้ requests ที่เป็นแค่หน้าปัจจุบัน — ปุ่มชื่อ
    // "ส่งออกรายการจัดส่ง" คนกดย่อมคาดหวังได้ทุกแถวตามตัวกรองที่เลือกไว้
    setExporting(true);

    let rows;
    try {
      rows = await fetchAllRewardRequests({ status });
    } catch (err) {
      console.error("export failed:", err);
      setMessage({ tone: "error", text: errorMessage(err) });
      setExporting(false);
      return;
    }

    setExporting(false);

    const blob = new Blob([buildFulfillmentCsv(rows)], {
      type: "text/csv;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `reward-fulfillment-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  }

  return (
    <DashboardLayout
      variant="admin"
      title="คำขอแลกรางวัล"
      subtitle="จัดส่งและติดตามของรางวัลที่ลูกค้าแลกไว้ เช่น เสื้อและของที่ระลึก"
      headerExtra={
        <div className="admin-requests__header-actions">
          <button
            type="button"
            className="dash-btn"
            disabled={exporting || requests.length === 0}
            onClick={handleExport}
          >
            {exporting ? "กำลังรวบรวม..." : "ส่งออกรายการจัดส่ง"}
          </button>
          <button type="button" className="dash-btn admin-requests__refresh" onClick={reload}>
            ↻ รีเฟรชรายการ
          </button>
        </div>
      }
    >
      <div className="dash-kpi">
        <StatCard label="รอดำเนินการ" value={stats?.pendingCount ?? "—"} tone="warning" />
        <StatCard label="กำลังเตรียม / ส่งแล้ว" value={
          stats ? stats.preparingCount + stats.shippedCount : "—"
        } />
        <StatCard label="อยู่ระหว่างขนส่ง" value={stats?.transitCount ?? "—"} />
        <StatCard label="รอลูกค้ายืนยันรับของ" value={
          stats ? stats.deliveredCount + stats.pickupCount : "—"
        } tone="success" />
      </div>

      <div className="dash-filters">
        {FULFILLMENT_FILTERS.map((item) => (
          <Pill
            key={item.key}
            active={item.key === status}
            onClick={() => switchFilter(item.key)}
          >
            {item.label}
          </Pill>
        ))}
      </div>

      {message && (
        <p className={`dash-message dash-message--${message.tone}`}>{message.text}</p>
      )}

      <div className="admin-requests">
        <section className="dash-card admin-requests__list">
          <header className="admin-requests__list-header">
            <h2>คำขอที่ต้องจัดส่ง</h2>
            <Badge tone="tint">{requests.length} รายการ</Badge>
          </header>

          {loading && <p className="dash-empty">กำลังโหลดคำขอ...</p>}
          {!loading && error && <p className="dash-empty">{error}</p>}
          {!loading && !error && requests.length === 0 && (
            <p className="dash-empty">ยังไม่มีคำขอในสถานะนี้</p>
          )}

          {requests.map((request) => (
            <button
              key={request.id}
              type="button"
              className={`admin-requests__row ${
                request.id === selected ? "admin-requests__row--selected" : ""
              }`}
              onClick={() => setSelected(request.id)}
            >
              <span className="admin-requests__thumb">
                <RewardMedia
                  reward={{
                    name: request.rewardName,
                    category: request.rewardCategory,
                    imageUrl: request.rewardImage,
                  }}
                  size={32}
                />
              </span>

              <span className="admin-requests__row-info">
                <span className="admin-requests__row-name">{request.customerName}</span>
                <span className="admin-requests__row-reward">
                  {request.rewardName}
                  {request.optionLabel ? ` (ไซซ์ ${request.optionLabel})` : ""}
                </span>
                <span className="admin-requests__row-meta">
                  {request.code} · แลกเมื่อ {formatRewardDate(request.createdAt)}
                </span>
              </span>

              <span className="admin-requests__row-status">
                <Badge
                  tone={
                    request.status === "cancelled"
                      ? "danger"
                      : STATUS_TONES[request.fulfillmentStatus] ?? "muted"
                  }
                >
                  {request.status === "cancelled"
                    ? "ยกเลิกแล้ว"
                    : fulfillmentLabel(request.fulfillmentStatus)}
                </Badge>
              </span>
            </button>
          ))}

          <footer className="dash-table-footer">
            <p>หน้า {page}</p>
            <Pagination page={page} hasMore={hasMore} onChange={setPage} />
          </footer>
        </section>

        <ShippingPanel
          key={current?.id ?? "none"}
          request={current}
          busy={busy}
          onUpdate={(request, nextStatus, shipping) =>
            run(
              () => updateFulfillment(request.id, nextStatus, shipping),
              `อัปเดตเป็น “${fulfillmentLabel(nextStatus)}” และแจ้งลูกค้าแล้ว`,
            )
          }
          onCancel={setCancelTarget}
        />
      </div>

      {cancelTarget && (
        <TextPromptDialog
          title={`ยกเลิกคำขอของ ${cancelTarget.customerName}`}
          label={`เหตุผลที่ยกเลิก (ลูกค้าจะเห็นในการแจ้งเตือน) — คืน ${formatPoints(
            cancelTarget.pointsUsed,
          )} แต้มและคืนสต๊อกให้อัตโนมัติ`}
          confirmLabel="ยืนยันยกเลิกคำขอ"
          onClose={() => setCancelTarget(null)}
          onSubmit={(reason) => {
            const target = cancelTarget;
            setCancelTarget(null);
            run(() => cancelRedemption(target.id, reason), "ยกเลิกคำขอและคืนแต้มให้ลูกค้าแล้ว");
          }}
        />
      )}
    </DashboardLayout>
  );
}
