// คิวคำขอคืนเงินของแอดมิน — ตรวจสอบ อนุมัติ/ปฏิเสธ แนบสลิปโอนคืน และแก้นโยบาย
import { useRef, useState } from "react";
import { Check, Paperclip, RefreshCw, Search } from "lucide-react";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, Pagination, Pill, StatCard } from "../components/DashboardWidgets";
import { useAdminRefundStats, useAdminRefunds } from "../hooks/useAdmin";
import { useRefundPolicy } from "../hooks/useRefundPolicy";
import { updateRefundPolicy } from "../lib/refundPolicy";
import {
  approveRefundRequest,
  completeRefundRequest,
  describeLeadTime,
  describeRefundStatus,
  fetchRefundPaymentProofSignedUrl,
  fetchRefundSlipSignedUrl,
  formatDateTime,
  rejectRefundRequest,
  uploadRefundSlip,
} from "../lib/refunds";
import { formatBaht, formatBookingDate, formatTimeRange } from "../lib/bookings";
import {
  describeGateway,
  describeMethod,
  fetchLatestPaymentInfo,
  fetchSlipSignedUrl,
} from "../lib/payments";
import { errorMessage } from "../lib/errors";
import "./AdminRefunds.css";

// ลูกค้าขอคืนเงินจากหน้าใบเสร็จ (BookingReceipt.jsx) ระบบคำนวณยอดตามนโยบาย
// ให้อัตโนมัติ แอดมินหน้านี้อนุมัติ/ปฏิเสธ แล้วแนบสลิปโอนคืนเพื่อปิดงาน
// (ดู 0034_refund_requests.sql)
//
// ส่วนนโยบายคืนเงิน (PolicyReference ด้านล่าง) ผูกกับ refund_policy_settings
// (0033) อยู่แล้ว แอดมินแก้ตัวเลขได้จากปุ่ม "แก้ไขนโยบาย"

const FILTERS = [
  { key: "", label: "ทั้งหมด" },
  { key: "pending", label: "รอตรวจสอบ" },
  { key: "approved", label: "อนุมัติแล้ว" },
  { key: "rejected", label: "ปฏิเสธแล้ว" },
  { key: "refunded", label: "คืนเงินสำเร็จ" },
];

function describeBooking(refund) {
  const booking = refund.bookings;
  if (!booking) return "—";

  const facility = booking.facilities;
  const sport = facility?.sports?.name;
  const place = facility ? (sport ? `${sport} · ${facility.name}` : facility.name) : "สนามกีฬา";

  return `${place} · ${formatBookingDate(booking.booking_date)} ${formatTimeRange(
    booking.start_time,
    booking.end_time,
  )}`;
}

function customerName(refund) {
  return refund.profiles?.full_name || refund.profiles?.username || "—";
}

function ReviewPanel({
  refund,
  policy,
  busy,
  viewingPaymentSlip,
  viewingCustomerProof,
  onApprove,
  onReject,
  onAttachSlip,
  onViewSlip,
  onViewPaymentSlip,
  onViewCustomerProof,
}) {
  const fileInputRef = useRef(null);
  const [approveAmount, setApproveAmount] = useState("");

  if (!refund) {
    return (
      <aside className="dash-card admin-refunds__review">
        <p className="dash-empty">เลือกรายการทางซ้ายเพื่อตรวจสอบคำขอ</p>
      </aside>
    );
  }

  const status = describeRefundStatus(refund.status);
  const leadTime = describeLeadTime(refund.lead_time_hours, policy);
  const booking = refund.bookings;

  return (
    <aside className="dash-card admin-refunds__review">
      <div className="admin-refunds__review-head">
        <h2>ตรวจสอบคำขอ</h2>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="dash-identity">
        <div className="dash-identity__avatar" aria-hidden="true">
          {customerName(refund).charAt(0)}
        </div>
        <div>
          <p className="dash-identity__name">{customerName(refund)}</p>
          <p className="dash-identity__email">{booking?.booking_code ?? "—"}</p>
        </div>
      </div>

      <hr className="admin-refunds__divider" />

      <dl className="admin-refunds__facts">
        <div className="admin-refunds__fact">
          <dt>การจอง</dt>
          <dd>{describeBooking(refund)}</dd>
        </div>
        <div className="admin-refunds__fact">
          <dt>ยอดชำระเดิม</dt>
          <dd>{formatBaht(booking?.total_amount)}</dd>
        </div>
        <div className="admin-refunds__fact">
          <dt>ขอคืนเงินเมื่อ</dt>
          <dd>{formatDateTime(refund.requested_at)}</dd>
        </div>
        <div className="admin-refunds__fact">
          <dt>ก่อนเวลาจอง</dt>
          <dd className={`admin-refunds__fact-value--${leadTime.tone}`}>{leadTime.label}</dd>
        </div>
      </dl>

      <div className="admin-refunds__reason">
        <p className="admin-refunds__reason-label">บัญชีรับเงินคืนที่ลูกค้าแจ้ง</p>
        <div className="admin-refunds__reason-box admin-refunds__bank-box">
          <p>
            {refund.bank_name || "—"} · {refund.account_name || "—"}
          </p>
          <p>เลขบัญชี {refund.account_number || "—"}</p>
        </div>
        <p className="admin-refunds__policy-note">
          ถ้าจ่ายด้วยการโอน+แนบสลิป ให้เทียบชื่อบัญชีกับสลิปก่อนอนุมัติ กัน
          กรณีสวมรอยขอคืนเงินเข้าบัญชีอื่น — ถ้าจ่ายผ่านพร้อมเพย์ QR ระบบเอง
          ไม่มีสลิปให้เทียบ (ยืนยันแค่ว่ามีเงินเข้าจริง ไม่ยืนยันตัวตนผู้โอน)
          แต่ลูกค้าจะแนบสลิป/ประวัติการโอนจากแอปธนาคารของตัวเองมาให้แทนตอน
          ขอคืนเงิน ดูปุ่มด้านล่างถ้ามี
        </p>
        <button
          type="button"
          className="dash-btn admin-refunds__attachment"
          disabled={viewingPaymentSlip}
          onClick={() => onViewPaymentSlip(refund)}
        >
          {viewingPaymentSlip ? (
            "กำลังเปิด..."
          ) : (
            <>
              <Search size={15} aria-hidden="true" /> ตรวจสอบการชำระเงินเดิม
            </>
          )}
        </button>
        {refund.payment_proof_slip_path && (
          <button
            type="button"
            className="dash-btn admin-refunds__attachment"
            disabled={viewingCustomerProof}
            onClick={() => onViewCustomerProof(refund)}
          >
            {viewingCustomerProof ? (
              "กำลังเปิด..."
            ) : (
              <>
                <Paperclip size={15} aria-hidden="true" /> ดูสลิปที่ลูกค้าแนบ (จ่ายผ่าน QR)
              </>
            )}
          </button>
        )}
      </div>

      <div className="admin-refunds__reason">
        <p className="admin-refunds__reason-label">เหตุผลจากลูกค้า</p>
        <div className="admin-refunds__reason-box">
          {refund.reason || "ไม่ได้ระบุเหตุผล"}
        </div>
      </div>

      {refund.status === "rejected" && refund.rejection_reason && (
        <div className="admin-refunds__reason">
          <p className="admin-refunds__reason-label">เหตุผลที่ปฏิเสธ</p>
          <div className="admin-refunds__reason-box">{refund.rejection_reason}</div>
        </div>
      )}

      <hr className="admin-refunds__divider" />

      <div className="admin-refunds__policy-amount">
        <span>ยอดคืนตามนโยบาย</span>
        <strong>{formatBaht(refund.refund_amount)}</strong>
      </div>

      {refund.status === "pending" && (
        <>
          <label className="admin-refunds__policy-field">
            <span>ยอดคืนเงินที่จะอนุมัติ</span>
            <input
              type="number"
              min="0"
              step="0.01"
              className="dash-input"
              value={approveAmount === "" ? refund.refund_amount : approveAmount}
              onChange={(e) => setApproveAmount(e.target.value)}
            />
          </label>
          <p className="admin-refunds__policy-note">
            แก้ไขได้เฉพาะกรณีพิเศษ เช่น สนามไม่พร้อมใช้งานจากฝ่ายสนาม — ปกติ
            ใช้ยอดตามนโยบายด้านบนได้เลยไม่ต้องแก้
          </p>
          <button
            type="button"
            className="admin-refunds__approve"
            disabled={busy}
            onClick={() => {
              const amount = Number(
                approveAmount === "" ? refund.refund_amount : approveAmount,
              );
              const override = amount !== Number(refund.refund_amount) ? amount : undefined;
              onApprove(refund, override);
            }}
          >
            {busy ? (
              "กำลังบันทึก..."
            ) : (
              <>
                <Check size={15} aria-hidden="true" /> อนุมัติคำขอ
              </>
            )}
          </button>
          <button
            type="button"
            className="admin-refunds__reject"
            disabled={busy}
            onClick={() => onReject(refund)}
          >
            ปฏิเสธคำขอ
          </button>
        </>
      )}

      {refund.status === "approved" && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="admin-refunds__file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onAttachSlip(refund, file);
            }}
          />
          <button
            type="button"
            className="admin-refunds__approve"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy ? (
              "กำลังอัปโหลด..."
            ) : (
              <>
                <Paperclip size={15} aria-hidden="true" /> แนบสลิปโอนคืน
              </>
            )}
          </button>
          <button
            type="button"
            className="admin-refunds__reject"
            disabled={busy}
            onClick={() => onReject(refund)}
          >
            ปฏิเสธคำขอ
          </button>
        </>
      )}

      {refund.status === "refunded" && (
        <>
          <p className="admin-refunds__resolved-note">
            คืนเงินสำเร็จเมื่อ {formatDateTime(refund.refunded_at)}
          </p>
          {refund.slip_path && (
            <button
              type="button"
              className="dash-btn admin-refunds__attachment"
              onClick={() => onViewSlip(refund)}
            >
              <Paperclip size={15} aria-hidden="true" /> ดูสลิปโอนคืน
            </button>
          )}
        </>
      )}

      {refund.status === "rejected" && (
        <p className="admin-refunds__resolved-note">คำขอนี้ถูกปฏิเสธแล้ว</p>
      )}
    </aside>
  );
}

// ตัวเลขต้องเรียงจริง (คืนเต็มจำนวน > คืนบางส่วน >= 0) และเปอร์เซ็นต์ต้องอยู่
// ในช่วง 0–100 — ตรงกับ check constraint ฝั่งฐานข้อมูล (0033) เช็คซ้ำที่นี่
// เพื่อบอกผู้ใช้ก่อนยิง request แทนให้ error จาก Supabase มาเป็นข้อความอังกฤษ
function validatePolicyForm(form) {
  const full = Number(form.fullRefundHours);
  const partial = Number(form.partialRefundHours);
  const percent = Number(form.partialRefundPercent);

  if (!Number.isFinite(full) || !Number.isFinite(partial) || !Number.isFinite(percent)) {
    return "กรุณากรอกตัวเลขให้ครบ";
  }
  if (full <= partial || partial < 0) {
    return "ชั่วโมงคืนเต็มจำนวนต้องมากกว่าชั่วโมงคืนบางส่วน และห้ามติดลบ";
  }
  if (percent < 0 || percent > 100) {
    return "สัดส่วนที่คืนต้องอยู่ระหว่าง 0-100%";
  }
  return "";
}

function PolicyEditForm({ initial, busy, error, onCancel, onSubmit }) {
  const [form, setForm] = useState(initial);

  return (
    <div className="admin-refunds__policy-form">
      <label className="admin-refunds__policy-field">
        <span>ยกเลิกก่อน (ชม.) — คืนเต็มจำนวน</span>
        <input
          type="number"
          min="0"
          className="dash-input"
          value={form.fullRefundHours}
          onChange={(e) => setForm((f) => ({ ...f, fullRefundHours: e.target.value }))}
          autoFocus
        />
      </label>
      <label className="admin-refunds__policy-field">
        <span>ยกเลิกก่อน (ชม.) — คืนบางส่วน</span>
        <input
          type="number"
          min="0"
          className="dash-input"
          value={form.partialRefundHours}
          onChange={(e) => setForm((f) => ({ ...f, partialRefundHours: e.target.value }))}
        />
      </label>
      <label className="admin-refunds__policy-field">
        <span>สัดส่วนที่คืน (%)</span>
        <input
          type="number"
          min="0"
          max="100"
          className="dash-input"
          value={form.partialRefundPercent}
          onChange={(e) => setForm((f) => ({ ...f, partialRefundPercent: e.target.value }))}
        />
      </label>

      {error && <p className="admin-refunds__policy-error">{error}</p>}

      <div className="admin-refunds__policy-form-actions">
        <button type="button" className="dash-btn" onClick={onCancel}>
          ยกเลิก
        </button>
        <button
          type="button"
          className="dash-btn dash-btn--add"
          disabled={busy}
          onClick={() => onSubmit(form)}
        >
          {busy ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </div>
  );
}

function PolicyReference({ policy, loading, loadError, editing, busy, saveError, onEdit, onCancel, onSave, panelRef }) {
  return (
    <aside className="dash-card admin-refunds__policy" ref={panelRef}>
      <h2>อัตราคืนเงินตามนโยบาย</h2>

      {loading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}
      {!loading && loadError && (
        <div className="dash-message dash-message--error">{loadError}</div>
      )}

      {!loading && !loadError && policy && !editing && (
        <>
          <div className="admin-refunds__policy-row">
            <span>ยกเลิกก่อน {policy.fullRefundHours} ชม.</span>
            <strong className="admin-refunds__fact-value--success">คืนเต็มจำนวน</strong>
          </div>
          <div className="admin-refunds__policy-row">
            <span>ยกเลิกก่อน {policy.partialRefundHours} ชม.</span>
            <strong className="admin-refunds__fact-value--warning">
              คืน {policy.partialRefundPercent}%
            </strong>
          </div>
          <div className="admin-refunds__policy-row">
            <span>ยกเลิกน้อยกว่า {policy.partialRefundHours} ชม.</span>
            <strong className="admin-refunds__fact-value--danger">ไม่คืนเงิน</strong>
          </div>
          <p className="admin-refunds__policy-note">
            กรณีสนามไม่พร้อมใช้งานจากฝ่ายสนาม แอดมินอนุมัติคืนเต็มจำนวนได้เองไม่ต้องยึดตามตาราง
          </p>
          <p className="admin-refunds__policy-note">
            ยอดมัดจำ (ถ้ามี) ไม่คืนเสมอ ไม่ว่าจะยกเลิกก่อนเวลากี่ชั่วโมงก็ตาม
          </p>
          <button type="button" className="dash-btn admin-refunds__policy-edit" onClick={onEdit}>
            แก้ไขนโยบาย
          </button>
        </>
      )}

      {!loading && !loadError && policy && editing && (
        <PolicyEditForm
          initial={{
            fullRefundHours: String(policy.fullRefundHours),
            partialRefundHours: String(policy.partialRefundHours),
            partialRefundPercent: String(policy.partialRefundPercent),
          }}
          busy={busy}
          error={saveError}
          onCancel={onCancel}
          onSubmit={onSave}
        />
      )}
    </aside>
  );
}

export default function AdminRefunds() {
  const [filter, setFilter] = useState("pending");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [viewingPaymentSlipId, setViewingPaymentSlipId] = useState(null);
  const [viewingCustomerProofId, setViewingCustomerProofId] = useState(null);
  const [actionError, setActionError] = useState("");

  const [policyReloadKey, setPolicyReloadKey] = useState(0);
  const [policyEditing, setPolicyEditing] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policySaveError, setPolicySaveError] = useState("");
  const policyRef = useRef(null);

  const { refunds, hasMore, loading, error } = useAdminRefunds({
    status: filter || undefined,
    page,
    reloadKey,
  });
  const { stats } = useAdminRefundStats(reloadKey);
  const { policy, loading: policyLoading, error: policyLoadError } = useRefundPolicy(policyReloadKey);

  const selected = refunds.find((r) => r.id === selectedId) ?? refunds[0] ?? null;

  function selectFilter(key) {
    setFilter(key);
    setPage(1);
    setSelectedId(null);
  }

  function openPolicyEditor() {
    setPolicySaveError("");
    setPolicyEditing(true);
    policyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelPolicyEdit() {
    setPolicyEditing(false);
    setPolicySaveError("");
  }

  async function handleSavePolicy(form) {
    const validationError = validatePolicyForm(form);
    if (validationError) {
      setPolicySaveError(validationError);
      return;
    }

    setPolicyBusy(true);
    setPolicySaveError("");

    try {
      await updateRefundPolicy({
        fullRefundHours: Number(form.fullRefundHours),
        partialRefundHours: Number(form.partialRefundHours),
        partialRefundPercent: Number(form.partialRefundPercent),
      });
      setPolicyEditing(false);
      setPolicyReloadKey((k) => k + 1);
    } catch (err) {
      console.error("updateRefundPolicy failed:", err);
      setPolicySaveError(errorMessage(err));
    } finally {
      setPolicyBusy(false);
    }
  }

  async function handleApprove(refund, overrideAmount) {
    const amount = overrideAmount ?? refund.refund_amount;
    const ok = window.confirm(
      `ยืนยันอนุมัติคำขอคืนเงิน ${formatBaht(amount)} ให้ ${customerName(refund)} ใช่ไหม?`,
    );
    if (!ok) return;

    setActionError("");
    setBusyId(refund.id);

    try {
      await approveRefundRequest(refund.id, overrideAmount);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("approveRefundRequest failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(refund) {
    const reason = window.prompt(
      `เหตุผลที่ปฏิเสธคำขอคืนเงินของ ${customerName(refund)} (ไม่บังคับ)`,
      "",
    );
    if (reason === null) return;

    setActionError("");
    setBusyId(refund.id);

    try {
      await rejectRefundRequest(refund.id, reason);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("rejectRefundRequest failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleAttachSlip(refund, file) {
    setActionError("");
    setBusyId(refund.id);

    try {
      const path = await uploadRefundSlip(file, refund.booking_id);
      await completeRefundRequest(refund.id, path);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("attach refund slip failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleViewSlip(refund) {
    setActionError("");
    setBusyId(refund.id);

    try {
      const url = await fetchRefundSlipSignedUrl(refund.slip_path);
      window.open(url, "_blank", "noreferrer");
    } catch (err) {
      console.error("fetchRefundSlipSignedUrl failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  // เช็กชื่อบัญชีที่ลูกค้ากรอกตอนขอคืนเงินกับสลิปการชำระเงินเดิมจริง — เอาแถว
  // payments ที่จ่ายสำเร็จล่าสุดของการจองนี้ ถ้าเป็นการจ่ายผ่านพร้อมเพย์ QR
  // จะไม่มีสลิปให้เปิดเลย (ดูคอมเมนต์ fetchLatestPaymentInfo) บอกแอดมินตรง ๆ
  // แทนที่จะแสดงเหมือนเป็นข้อผิดพลาด
  async function handleViewPaymentSlip(refund) {
    setActionError("");
    setViewingPaymentSlipId(refund.id);

    try {
      const info = await fetchLatestPaymentInfo(refund.booking_id);

      if (!info) {
        setActionError("ไม่พบรายการชำระเงินที่สำเร็จสำหรับการจองนี้");
        return;
      }

      if (!info.slip_url) {
        window.alert(
          `ชำระเงินด้วย${describeMethod(info.payment_method)} (${describeGateway(info.gateway)})\n` +
            `ยอด ${formatBaht(info.amount)} เมื่อ ${formatDateTime(info.verified_at)}\n\n` +
            `ช่องทางนี้ไม่มีสลิปให้เทียบชื่อบัญชี ระบบยืนยันแค่ว่ามีเงินเข้าจริง ` +
            `ไม่ยืนยันว่าใครเป็นผู้โอน โปรดใช้ดุลยพินิจก่อนอนุมัติ`,
        );
        return;
      }

      const url = await fetchSlipSignedUrl(info.slip_url);
      window.open(url, "_blank", "noreferrer");
    } catch (err) {
      console.error("fetchLatestPaymentInfo failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setViewingPaymentSlipId(null);
    }
  }

  // สลิป/ประวัติการโอนที่ลูกค้าแนบเองตอนขอคืนเงิน (บังคับเฉพาะจ่ายผ่าน QR,
  // ดู 0040_refund_qr_payment_proof.sql) — คนละบัคเก็ตกับ handleViewSlip
  // (สลิปโอนคืนที่แอดมินอัปโหลด) และ handleViewPaymentSlip (ข้อมูลการชำระเงิน
  // เดิมจากฝั่งเรา) เพราะเป็นไฟล์ที่ลูกค้าเป็นคนอัปโหลดเอง
  async function handleViewCustomerProof(refund) {
    setActionError("");
    setViewingCustomerProofId(refund.id);

    try {
      const url = await fetchRefundPaymentProofSignedUrl(refund.payment_proof_slip_path);
      window.open(url, "_blank", "noreferrer");
    } catch (err) {
      console.error("fetchRefundPaymentProofSignedUrl failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setViewingCustomerProofId(null);
    }
  }

  return (
    <DashboardLayout
      variant="admin"
      title="จัดการคำขอคืนเงิน"
      subtitle="ตรวจสอบและอนุมัติคำขอคืนเงินจากลูกค้า ตามนโยบายยกเลิกการจอง"
      headerExtra={
        <div className="admin-refunds__header-actions">
          <button type="button" className="dash-btn" onClick={openPolicyEditor}>
            นโยบายคืนเงิน
          </button>
          <button
            type="button"
            className="dash-btn admin-refunds__refresh"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw size={14} aria-hidden="true" /> รีเฟรชรายการ
          </button>
        </div>
      }
    >
      <section className="dash-kpi">
        <StatCard label="รอตรวจสอบ" value={stats ? stats.pendingCount : "—"} />
        <StatCard
          label="อนุมัติแล้วเดือนนี้ (รอโอน)"
          value={stats ? formatBaht(stats.approvedMonth) : "—"}
        />
        <StatCard label="ปฏิเสธแล้วเดือนนี้" value={stats ? stats.rejectedMonth : "—"} />
        <StatCard
          label="คืนเงินสำเร็จเดือนนี้"
          value={stats ? formatBaht(stats.refundedMonth) : "—"}
        />
      </section>

      <div className="dash-filters">
        {FILTERS.map((item) => (
          <Pill key={item.key} active={item.key === filter} onClick={() => selectFilter(item.key)}>
            {item.label}
          </Pill>
        ))}
      </div>

      {actionError && <div className="dash-message dash-message--error">{actionError}</div>}

      <div className="admin-refunds">
        <div className="dash-card admin-refunds__list">
          <div className="admin-refunds__list-header">
            <h2>รายการคำขอคืนเงิน</h2>
          </div>

          {loading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}

          {!loading && error && <div className="dash-message dash-message--error">{error}</div>}

          {!loading && !error && refunds.length === 0 && (
            <p className="dash-empty">ไม่มีรายการในหมวดนี้</p>
          )}

          {!loading &&
            !error &&
            refunds.map((refund) => {
              const status = describeRefundStatus(refund.status);
              const isSelected = refund.id === selected?.id;
              const busy = busyId === refund.id;

              return (
                <div
                  key={refund.id}
                  className={`admin-refunds__row ${
                    isSelected ? "admin-refunds__row--selected" : ""
                  }`}
                  onClick={() => setSelectedId(refund.id)}
                >
                  <div className="dash-identity__avatar" aria-hidden="true">
                    {customerName(refund).charAt(0)}
                  </div>

                  <div className="admin-refunds__row-info">
                    <p className="admin-refunds__row-name">{customerName(refund)}</p>
                    <p className="admin-refunds__row-context">{describeBooking(refund)}</p>
                    <p className="admin-refunds__row-reason">
                      {refund.reason || "ไม่ได้ระบุเหตุผล"}
                    </p>
                  </div>

                  <div className="admin-refunds__row-amount">
                    <p>{formatBaht(refund.refund_amount)}</p>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>

                  <div className="admin-refunds__row-actions">
                    {refund.status === "pending" ? (
                      <>
                        <button
                          type="button"
                          className="admin-refunds__row-approve"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleApprove(refund);
                          }}
                        >
                          อนุมัติ
                        </button>
                        <button
                          type="button"
                          className="admin-refunds__row-reject"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReject(refund);
                          }}
                        >
                          ปฏิเสธ
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="dash-btn admin-refunds__row-detail"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(refund.id);
                        }}
                      >
                        รายละเอียด
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

          <div className="dash-table-footer">
            <p>หน้า {page}</p>
            <Pagination page={page} hasMore={hasMore} onChange={setPage} />
          </div>
        </div>

        <div className="admin-refunds__side">
          <ReviewPanel
            key={selected?.id ?? "none"}
            refund={selected}
            policy={policy}
            busy={selected ? busyId === selected.id : false}
            viewingPaymentSlip={selected ? viewingPaymentSlipId === selected.id : false}
            viewingCustomerProof={selected ? viewingCustomerProofId === selected.id : false}
            onApprove={handleApprove}
            onReject={handleReject}
            onAttachSlip={handleAttachSlip}
            onViewSlip={handleViewSlip}
            onViewPaymentSlip={handleViewPaymentSlip}
            onViewCustomerProof={handleViewCustomerProof}
          />
          <PolicyReference
            policy={policy}
            loading={policyLoading}
            loadError={policyLoadError}
            editing={policyEditing}
            busy={policyBusy}
            saveError={policySaveError}
            onEdit={openPolicyEditor}
            onCancel={cancelPolicyEdit}
            onSave={handleSavePolicy}
            panelRef={policyRef}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
