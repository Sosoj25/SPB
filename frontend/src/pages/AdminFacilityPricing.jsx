import { useRef, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Switch, Badge } from "../components/DashboardWidgets";
import { useAsyncData } from "../hooks/useAsyncData";
import { fetchFacilitiesBySport, fetchSportCatalog } from "../lib/catalog";
import { useFacilityPricingConfig, useFacilityPriceHistory } from "../hooks/usePricing";
import {
  applyBasePriceToSport,
  createDiscount,
  createPricingRule,
  deleteDiscount,
  deletePricingRule,
  fetchFacilityPricePreview,
  logPriceChange,
  updateDiscount,
  updateFacilityBasePrice,
  updatePricingRule,
} from "../lib/pricing";
import { formatBaht } from "../lib/bookings";
import { errorMessage } from "../lib/errors";
import "./AdminFacilityPricing.css";

const EMPTY_LIST = [];

const DISCOUNT_TYPE_LABELS = {
  member: "สมาชิก",
  advance_booking: "จองล่วงหน้า",
  long_booking: "จองต่อเนื่อง",
  student: "นักเรียน/นักศึกษา",
};

function describeDiscount(discount) {
  const parts = [];
  if (discount.discountType === "advance_booking" && discount.thresholdDays != null) {
    parts.push(`ล่วงหน้า ${discount.thresholdDays} วันขึ้นไป`);
  }
  if (discount.discountType === "long_booking" && discount.thresholdHours != null) {
    parts.push(`${discount.thresholdHours} ชม. ขึ้นไป`);
  }
  if (discount.valuePercent != null) parts.push(`ลด ${discount.valuePercent}%`);
  if (discount.valueFlat != null) parts.push(`ลด ${formatBaht(discount.valueFlat)}`);
  return parts.join(" · ");
}

// วันเสาร์ถัดไป 18:00–21:00 — สถานการณ์ตัวอย่างคงที่ให้พรีวิวใช้ แต่ตัวเลข
// ที่คำนวณออกมายังมาจาก compute_facility_price จริงเสมอ ไม่ใช่ค่า mock
function nextPreviewDate() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSat = (6 - day + 7) % 7 || 7;
  const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSat);
  const pad = (n) => String(n).padStart(2, "0");
  return `${sat.getFullYear()}-${pad(sat.getMonth() + 1)}-${pad(sat.getDate())}`;
}

const PREVIEW_DATE = nextPreviewDate();
const PREVIEW_START = "18:00";
const PREVIEW_END = "21:00";

const previewDateFormatter = new Intl.DateTimeFormat("th-TH", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function PricingRuleRow({ rule, onCommit, onDelete }) {
  const [draft, setDraft] = useState({
    label: rule.label,
    startTime: rule.startTime,
    endTime: rule.endTime,
    weekdayPrice: String(rule.weekdayPrice),
    weekendPrice: String(rule.weekendPrice),
    holidayPrice: String(rule.holidayPrice),
  });
  const [busy, setBusy] = useState(false);

  async function commitField(field, parsed) {
    if (parsed === rule[field]) return;
    setBusy(true);
    try {
      await onCommit(rule, { [field]: parsed });
    } catch {
      // error แสดงที่หัวการ์ดแล้ว — คืนค่าเดิมไม่ให้ค้างค่าที่ยังไม่ถูกบันทึก
      setDraft((d) => ({ ...d, [field]: String(rule[field]) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pricing-rule">
      <input
        className="dash-input pricing-rule__label"
        value={draft.label}
        onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
        onBlur={() => commitField("label", draft.label)}
        disabled={busy}
      />
      <div className="pricing-rule__times">
        <input
          type="time"
          className="dash-input"
          value={draft.startTime}
          onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value }))}
          onBlur={() => commitField("startTime", draft.startTime)}
          disabled={busy}
        />
        <span>–</span>
        <input
          type="time"
          className="dash-input"
          value={draft.endTime}
          onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value }))}
          onBlur={() => commitField("endTime", draft.endTime)}
          disabled={busy}
        />
      </div>
      {["weekdayPrice", "weekendPrice", "holidayPrice"].map((field) => (
        <div className="pricing-rule__price" key={field}>
          <span>฿</span>
          <input
            type="number"
            min="0"
            step="1"
            className="pricing-rule__price-input"
            value={draft[field]}
            onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
            onBlur={() => commitField(field, Number(draft[field]))}
            disabled={busy}
          />
        </div>
      ))}
      <label className="pricing-rule__peak">
        <input
          type="checkbox"
          checked={rule.isPeak}
          onChange={(e) => onCommit(rule, { isPeak: e.target.checked })}
          disabled={busy}
        />
        พีค
      </label>
      <button type="button" className="dash-btn dash-btn--cancel" onClick={() => onDelete(rule)}>
        ลบ
      </button>
    </div>
  );
}

export default function AdminFacilityPricing() {
  const previewRef = useRef(null);

  const [sportId, setSportId] = useState(null);
  const [facilityId, setFacilityId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [savingBase, setSavingBase] = useState(false);
  const [addingDiscount, setAddingDiscount] = useState(false);
  const [newDiscount, setNewDiscount] = useState({
    label: "",
    discountType: "member",
    valuePercent: "",
    valueFlat: "",
    thresholdDays: "",
    thresholdHours: "",
  });

  const { data: sports } = useAsyncData(fetchSportCatalog, "pricing-sports", EMPTY_LIST);
  const effectiveSportId = sportId ?? sports[0]?.id ?? null;

  const { data: facilities } = useAsyncData(
    () => fetchFacilitiesBySport(effectiveSportId),
    effectiveSportId != null ? `pricing-facilities:${effectiveSportId}` : null,
    EMPTY_LIST,
  );

  const effectiveFacilityId = facilities.some((f) => f.id === facilityId)
    ? facilityId
    : (facilities[0]?.id ?? null);

  const { config, loading: configLoading } = useFacilityPricingConfig(effectiveFacilityId, reloadKey);
  const { history } = useFacilityPriceHistory(effectiveFacilityId, reloadKey);

  const { data: preview, loading: previewLoading } = useAsyncData(
    () => fetchFacilityPricePreview(effectiveFacilityId, PREVIEW_DATE, PREVIEW_START, PREVIEW_END),
    effectiveFacilityId != null ? `pricing-preview:${effectiveFacilityId}:${reloadKey}` : null,
  );

  // headerDraft เป็น null จนกว่าผู้ใช้จะพิมพ์ — ก่อนหน้านั้นอิงจากค่าที่โหลด
  // มาตรง ๆ (เหมือน AdminFacilities.jsx เลี่ยง setState ใน effect)
  const [baseDraft, setBaseDraft] = useState(null);
  const base = baseDraft ?? config.basePrice;

  function reload() {
    setReloadKey((k) => k + 1);
  }

  async function handleSaveBasePrice() {
    if (!config.basePrice || !effectiveFacilityId) return;
    setSavingBase(true);
    setActionError("");
    setActionMessage("");

    try {
      const before = config.basePrice;
      const payload = {
        pricePerHour: Number(base.pricePerHour),
        minBookingHours: Number(base.minBookingHours),
        depositPercent: Number(base.depositPercent),
      };

      await updateFacilityBasePrice(effectiveFacilityId, payload);

      if (before.pricePerHour !== payload.pricePerHour) {
        await logPriceChange(
          effectiveFacilityId,
          `ปรับราคาพื้นฐาน ${formatBaht(before.pricePerHour)} → ${formatBaht(payload.pricePerHour)}`,
        );
      }
      if (before.depositPercent !== payload.depositPercent) {
        await logPriceChange(
          effectiveFacilityId,
          `ปรับมัดจำ ${before.depositPercent}% → ${payload.depositPercent}%`,
        );
      }
      if (before.minBookingHours !== payload.minBookingHours) {
        await logPriceChange(
          effectiveFacilityId,
          `ปรับขั้นต่ำต่อการจอง ${before.minBookingHours} ชม. → ${payload.minBookingHours} ชม.`,
        );
      }

      setBaseDraft(null);
      setActionMessage("บันทึกราคาเรียบร้อย");
      reload();
    } catch (err) {
      console.error("updateFacilityBasePrice failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setSavingBase(false);
    }
  }

  async function handleApplyToSport() {
    if (!config.basePrice || !effectiveFacilityId || !effectiveSportId) return;
    if (!window.confirm("คัดลอกราคาพื้นฐานนี้ไปยังทุกสนามในกีฬาเดียวกันหรือไม่?")) return;

    setActionError("");
    setActionMessage("");
    try {
      const count = await applyBasePriceToSport(effectiveSportId, effectiveFacilityId, {
        pricePerHour: Number(base.pricePerHour),
        minBookingHours: Number(base.minBookingHours),
        depositPercent: Number(base.depositPercent),
      });
      setActionMessage(count > 0 ? `คัดลอกราคาไปยัง ${count} สนามแล้ว` : "ไม่มีสนามอื่นในกีฬานี้");
    } catch (err) {
      console.error("applyBasePriceToSport failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function handleAddRule() {
    if (!effectiveFacilityId || !config.basePrice) return;
    setActionError("");
    try {
      const price = config.basePrice.pricePerHour;
      await createPricingRule(effectiveFacilityId, {
        label: "ช่วงใหม่",
        startTime: "00:00",
        endTime: "01:00",
        weekdayPrice: price,
        weekendPrice: price,
        holidayPrice: price,
        isPeak: false,
        sortOrder: config.rules.length,
      });
      reload();
    } catch (err) {
      console.error("createPricingRule failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function handleCommitRule(rule, patch) {
    setActionError("");
    try {
      await updatePricingRule(rule.id, patch);
      await logPriceChange(effectiveFacilityId, `แก้ไขช่วงราคา "${rule.label}"`);
      reload();
    } catch (err) {
      console.error("updatePricingRule failed:", err);
      setActionError(errorMessage(err));
      throw err;
    }
  }

  async function handleDeleteRule(rule) {
    if (!window.confirm(`ลบช่วงเวลา "${rule.label}" หรือไม่?`)) return;
    setActionError("");
    try {
      await deletePricingRule(rule.id);
      await logPriceChange(effectiveFacilityId, `ลบช่วงราคา "${rule.label}"`);
      reload();
    } catch (err) {
      console.error("deletePricingRule failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function handleToggleDiscount(discount) {
    setActionError("");
    try {
      await updateDiscount(discount.id, { isEnabled: !discount.isEnabled });
      reload();
    } catch (err) {
      console.error("updateDiscount failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function handleDeleteDiscount(discount) {
    if (!window.confirm(`ลบกฎส่วนลด "${discount.label}" หรือไม่?`)) return;
    setActionError("");
    try {
      await deleteDiscount(discount.id);
      reload();
    } catch (err) {
      console.error("deleteDiscount failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function handleConfirmAddDiscount() {
    if (!newDiscount.label.trim()) return;
    setActionError("");
    try {
      await createDiscount(effectiveFacilityId, {
        label: newDiscount.label.trim(),
        discountType: newDiscount.discountType,
        valuePercent: newDiscount.valuePercent === "" ? null : Number(newDiscount.valuePercent),
        valueFlat: newDiscount.valueFlat === "" ? null : Number(newDiscount.valueFlat),
        thresholdDays: newDiscount.thresholdDays === "" ? null : Number(newDiscount.thresholdDays),
        thresholdHours: newDiscount.thresholdHours === "" ? null : Number(newDiscount.thresholdHours),
        isEnabled: true,
        sortOrder: config.discounts.length,
      });
      setAddingDiscount(false);
      setNewDiscount({
        label: "",
        discountType: "member",
        valuePercent: "",
        valueFlat: "",
        thresholdDays: "",
        thresholdHours: "",
      });
      reload();
    } catch (err) {
      console.error("createDiscount failed:", err);
      setActionError(errorMessage(err));
    }
  }

  return (
    <DashboardLayout
      variant="admin"
      title="แก้ไขราคา"
      subtitle="ตั้งราคาพื้นฐาน ราคาตามช่วงเวลา และส่วนลดของแต่ละสนาม"
      headerExtra={
        <div className="pricing-page__actions">
          <button
            type="button"
            className="dash-btn"
            onClick={() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            ดูตัวอย่างราคา
          </button>
          <button
            type="button"
            className="dash-btn dash-btn--add"
            disabled={savingBase || !config.basePrice}
            onClick={handleSaveBasePrice}
          >
            {savingBase ? "กำลังบันทึก..." : "บันทึกราคา"}
          </button>
        </div>
      }
    >
      {actionError && <div className="dash-message dash-message--error">{actionError}</div>}
      {actionMessage && <div className="dash-message dash-message--success">{actionMessage}</div>}

      <div className="pricing-page__context">
        <div className="pricing-page__context-field">
          <span className="pricing-page__context-label">กีฬา</span>
          <select
            className="dash-select"
            value={effectiveSportId ?? ""}
            onChange={(e) => {
              setSportId(Number(e.target.value));
              setFacilityId(null);
              setBaseDraft(null);
            }}
          >
            {sports.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="pricing-page__context-field">
          <span className="pricing-page__context-label">สนาม</span>
          <select
            className="dash-select"
            value={effectiveFacilityId ?? ""}
            onChange={(e) => {
              setFacilityId(Number(e.target.value));
              setBaseDraft(null);
            }}
          >
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.venueName} · {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="dash-filters__spacer" />
        <button type="button" className="dash-pill dash-pill--tint" onClick={handleApplyToSport}>
          ใช้ราคานี้กับทุกสนามในกีฬาเดียวกัน
        </button>
      </div>

      {!effectiveFacilityId ? (
        <p className="dash-empty">ยังไม่มีสนามที่เปิดให้จองสำหรับกีฬานี้</p>
      ) : (
        <div className="pricing-page">
          <div className="pricing-page__main">
            <section className="dash-card">
              <h2>ราคาพื้นฐาน</h2>
              <p className="pricing-page__hint">ใช้เมื่อไม่มีราคาตามช่วงเวลากำหนดไว้</p>

              {configLoading || !base ? (
                <p className="dash-empty">กำลังโหลดข้อมูล...</p>
              ) : (
                <div className="pricing-page__base-grid">
                  <div className="dash-field">
                    <label className="dash-field__label">ราคาต่อชั่วโมง</label>
                    <input
                      type="number"
                      min="0"
                      className="dash-input"
                      value={base.pricePerHour}
                      onChange={(e) =>
                        setBaseDraft({ ...base, pricePerHour: e.target.value })
                      }
                    />
                  </div>
                  <div className="dash-field">
                    <label className="dash-field__label">ขั้นต่ำต่อการจอง (ชม.)</label>
                    <input
                      type="number"
                      min="1"
                      className="dash-input"
                      value={base.minBookingHours}
                      onChange={(e) =>
                        setBaseDraft({ ...base, minBookingHours: e.target.value })
                      }
                    />
                    <p className="dash-field__hint">บันทึกไว้เป็นข้อมูล ยังไม่บังคับที่ขั้นตอนจอง</p>
                  </div>
                  <div className="dash-field">
                    <label className="dash-field__label">มัดจำ (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className="dash-input"
                      value={base.depositPercent}
                      onChange={(e) =>
                        setBaseDraft({ ...base, depositPercent: e.target.value })
                      }
                    />
                  </div>
                </div>
              )}
            </section>

            <section className="dash-card pricing-page__rules-card">
              <div className="pricing-page__section-header">
                <div>
                  <h2>ราคาตามช่วงเวลา</h2>
                  <p className="pricing-page__hint">ตั้งราคาต่างกันได้ระหว่างวันธรรมดาและวันหยุด</p>
                </div>
                <button type="button" className="dash-btn" onClick={handleAddRule}>
                  ＋ เพิ่มช่วงเวลา
                </button>
              </div>

              <div className="pricing-rule pricing-rule--header">
                <span className="pricing-rule__label">ช่วงเวลา</span>
                <span className="pricing-rule__times">เวลา</span>
                <span>จ–ศ</span>
                <span>ส–อา</span>
                <span>วันหยุดนักขัตฤกษ์</span>
                <span />
              </div>

              {config.rules.length === 0 && (
                <p className="dash-empty">ยังไม่มีราคาตามช่วงเวลา ใช้ราคาพื้นฐานทุกช่วง</p>
              )}

              {config.rules.map((rule) => (
                <PricingRuleRow
                  key={rule.id}
                  rule={rule}
                  onCommit={handleCommitRule}
                  onDelete={handleDeleteRule}
                />
              ))}
            </section>
          </div>

          <div className="pricing-page__side">
            <section className="dash-card">
              <h2>ส่วนลด</h2>

              {config.discounts.length === 0 && !addingDiscount && (
                <p className="dash-empty">ยังไม่มีกฎส่วนลด</p>
              )}

              {config.discounts.map((discount) => (
                <div
                  key={discount.id}
                  className={`pricing-discount ${!discount.isEnabled ? "pricing-discount--off" : ""}`}
                >
                  <div className="pricing-discount__info">
                    <p className="pricing-discount__label">{discount.label}</p>
                    <p className="pricing-discount__desc">{describeDiscount(discount)}</p>
                  </div>
                  <Switch
                    on={discount.isEnabled}
                    onChange={() => handleToggleDiscount(discount)}
                    label={`เปิด/ปิดส่วนลด ${discount.label}`}
                  />
                  <button
                    type="button"
                    className="pricing-discount__remove"
                    aria-label={`ลบส่วนลด ${discount.label}`}
                    onClick={() => handleDeleteDiscount(discount)}
                  >
                    ✕
                  </button>
                </div>
              ))}

              {addingDiscount ? (
                <div className="pricing-discount-form">
                  <input
                    className="dash-input"
                    placeholder="ชื่อส่วนลด"
                    value={newDiscount.label}
                    onChange={(e) => setNewDiscount((d) => ({ ...d, label: e.target.value }))}
                    autoFocus
                  />
                  <select
                    className="dash-select-field"
                    value={newDiscount.discountType}
                    onChange={(e) => setNewDiscount((d) => ({ ...d, discountType: e.target.value }))}
                  >
                    {Object.entries(DISCOUNT_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <div className="pricing-discount-form__row">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className="dash-input"
                      placeholder="ลด %"
                      value={newDiscount.valuePercent}
                      onChange={(e) => setNewDiscount((d) => ({ ...d, valuePercent: e.target.value }))}
                    />
                    <input
                      type="number"
                      min="0"
                      className="dash-input"
                      placeholder="ลด ฿ (คงที่)"
                      value={newDiscount.valueFlat}
                      onChange={(e) => setNewDiscount((d) => ({ ...d, valueFlat: e.target.value }))}
                    />
                  </div>
                  {newDiscount.discountType === "advance_booking" && (
                    <input
                      type="number"
                      min="0"
                      className="dash-input"
                      placeholder="จองล่วงหน้ากี่วัน"
                      value={newDiscount.thresholdDays}
                      onChange={(e) => setNewDiscount((d) => ({ ...d, thresholdDays: e.target.value }))}
                    />
                  )}
                  {newDiscount.discountType === "long_booking" && (
                    <input
                      type="number"
                      min="0"
                      className="dash-input"
                      placeholder="จองกี่ชั่วโมงขึ้นไป"
                      value={newDiscount.thresholdHours}
                      onChange={(e) => setNewDiscount((d) => ({ ...d, thresholdHours: e.target.value }))}
                    />
                  )}
                  <div className="pricing-discount-form__actions">
                    <button type="button" className="dash-btn" onClick={() => setAddingDiscount(false)}>
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      className="dash-btn dash-btn--add"
                      onClick={handleConfirmAddDiscount}
                    >
                      เพิ่ม
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="dash-btn pricing-page__add-discount"
                  onClick={() => setAddingDiscount(true)}
                >
                  ＋ เพิ่มกฎส่วนลด
                </button>
              )}
            </section>

            <section className="dash-card" ref={previewRef}>
              <h2>ตัวอย่างราคาที่ลูกค้าเห็น</h2>
              <p className="pricing-page__hint">
                {previewDateFormatter.format(new Date(`${PREVIEW_DATE}T00:00:00`))} · {PREVIEW_START} –{" "}
                {PREVIEW_END} น.
              </p>

              {previewLoading && <p className="dash-empty">กำลังคำนวณ...</p>}

              {preview && (
                <>
                  <div className="pricing-preview">
                    <div className="pricing-preview__row">
                      <span>
                        ค่าสนาม {preview.hours} ชม. × {formatBaht(preview.baseRate)}
                      </span>
                      <strong>{formatBaht(preview.subtotal)}</strong>
                    </div>
                    {preview.discountLines.map((line, i) => (
                      <div className="pricing-preview__row" key={i}>
                        <span>{line.label}</span>
                        <strong className="pricing-preview__discount">-{formatBaht(line.amount)}</strong>
                      </div>
                    ))}
                    <hr className="pricing-preview__divider" />
                    <div className="pricing-preview__row pricing-preview__row--total">
                      <span>ยอดที่ลูกค้าจ่าย</span>
                      <strong>{formatBaht(preview.totalAmount)}</strong>
                    </div>
                  </div>
                  {preview.isPeak && <Badge tone="warning">ราคาพีค</Badge>}
                </>
              )}
            </section>

            <section className="dash-card">
              <h2>ประวัติการเปลี่ยนราคา</h2>
              {history.length === 0 && <p className="dash-empty">ยังไม่มีประวัติ</p>}
              {history.map((entry) => (
                <div className="pricing-history__entry" key={entry.id}>
                  <p className="pricing-history__desc">{entry.description}</p>
                  <p className="pricing-history__meta">
                    {new Date(entry.createdAt).toLocaleDateString("th-TH", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}{" "}
                    · โดย {entry.changedByName}
                  </p>
                </div>
              ))}
            </section>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
