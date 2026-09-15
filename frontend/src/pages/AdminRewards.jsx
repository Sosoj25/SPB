// คลังของรางวัล — เพิ่ม/แก้ไขของรางวัล ตั้งอัตราแต้ม และปรับแต้มลูกค้ารายคน
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout";
import RewardMedia from "../components/RewardMedia";
import AdjustPointsDialog from "../components/AdjustPointsDialog";
import { Badge, Pill, SearchBox, StatCard, Switch } from "../components/DashboardWidgets";
import { useAdminRewardStats, useRewardCatalog, useRewardSettings } from "../hooks/useRewards";
import { useCustomerSearch } from "../hooks/useAdmin";
import { adjustUserPoints } from "../lib/admin";
import {
  BENEFIT_TYPES,
  REWARD_CATEGORIES,
  createReward,
  deleteReward,
  describeBenefit,
  describeLimit,
  formatPoints,
  setRewardActive,
  updateReward,
  updateRewardSettings,
  uploadRewardImage,
} from "../lib/rewards";
import { formatBaht } from "../lib/bookings";
import { useAuth } from "../context/useAuth";
import { errorMessage } from "../lib/errors";
import "./AdminRewards.css";

// หน้าจัดการคลังของรางวัล — CRUD ตรงกับตาราง rewards ผ่าน RLS
// (rewards_admin_manage, 0000) ไม่ต้องมี RPC เพราะไม่ได้แตะแต้มของใคร
//
// เพดานของรางวัลมีสามแบบและใช้ร่วมกันไม่ได้ (ไม่จำกัด / สต๊อกเป็นชิ้น /
// โควตาต่อเดือน) — ฟอร์มบังคับให้เลือกแบบเดียว แล้ว fromRewardPayload()
// ล้างอีกฝั่งให้เอง ดูคอมเมนต์ใน lib/rewards.js

const FILTERS = [{ key: "", label: "ทั้งหมด" }, ...REWARD_CATEGORIES];

const LIMIT_TYPES = [
  { key: "unlimited", label: "ไม่จำกัด" },
  { key: "stock", label: "สต๊อกเป็นชิ้น" },
  { key: "quota", label: "โควตาต่อเดือน" },
];

const BLANK = {
  name: "",
  category: "discount",
  description: "",
  terms: "",
  pointsRequired: "",
  validDays: "90",
  limitType: "unlimited",
  stock: "",
  monthlyQuota: "",
  requiresShipping: false,
  options: "",
  benefitType: "none",
  benefitValue: "",
  perUserLimit: "",
  isActive: true,
};

function toForm(reward) {
  return {
    name: reward.name,
    category: reward.category,
    description: reward.description,
    terms: reward.terms,
    pointsRequired: String(reward.pointsRequired),
    validDays: String(reward.validDays),
    limitType: reward.limitType,
    stock: String(reward.stock ?? ""),
    monthlyQuota: String(reward.monthlyQuota ?? ""),
    requiresShipping: reward.requiresShipping,
    options: (reward.options ?? []).join(", "),
    benefitType: reward.benefitType,
    benefitValue: reward.benefitValue ? String(reward.benefitValue) : "",
    perUserLimit: reward.perUserLimit ? String(reward.perUserLimit) : "",
    isActive: reward.isActive,
  };
}

// ผู้เรียกใส่ key ผูกกับ id ของรางวัล — React จึง remount แผงนี้ใหม่ทุกครั้งที่
// สลับรายการที่กำลังแก้ ฟอร์มจึงเริ่มจากค่าของรางวัลชิ้นนั้นเสมอ ไม่ต้องมี
// effect คอยรีเซ็ต และไม่มีทางที่ค่าที่พิมพ์ค้างของชิ้นก่อนจะถูกบันทึกทับ
function EditPanel({ reward, onSaved, onCancel }) {
  const [form, setForm] = useState(() => (reward ? toForm(reward) : BLANK));
  const [imageFile, setImageFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  function handlePickImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    // คืน blob ของรูปก่อนหน้าก่อนสร้างอันใหม่ — เลือกรูปหลายรอบแล้ว blob เก่า
    // ค้างใน memory ตลอดอายุแท็บถ้าไม่ revoke
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setImageFile(file);
  }

  async function handleSave() {
    setError("");
    setBusy(true);

    try {
      const payload = {
        ...form,
        options: form.options
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      };

      // รูปอัปโหลดหลังจากมี id แล้ว เพราะ path ใน bucket ใช้ id เป็นโฟลเดอร์
      // (pattern เดียวกับ uploadNewsCoverImage) — ของใหม่จึงต้อง insert ก่อน
      // แล้วค่อยวนกลับมา update เฉพาะ url ของรูป ส่วนของเดิมอัปเดตรวดเดียวจบ
      const id = reward ? reward.id : await createReward(payload);

      if (imageFile) {
        payload.imageUrl = await uploadRewardImage(imageFile, id);
      }

      if (reward || imageFile) await updateReward(id, payload);

      onSaved();
    } catch (err) {
      console.error("save reward failed:", err);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const shownImage = preview || reward?.imageUrl;

  return (
    <aside className="dash-card admin-rewards__panel">
      <h2 className="admin-rewards__panel-title">
        {reward ? `แก้ไข: ${reward.name}` : "เพิ่มของรางวัลใหม่"}
      </h2>

      <div className="admin-rewards__preview">
        {shownImage ? (
          <img src={shownImage} alt="" className="admin-rewards__preview-img" />
        ) : (
          <RewardMedia reward={{ name: form.name, category: form.category }} size={72} />
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={handlePickImage}
      />
      <button type="button" className="dash-btn" onClick={() => fileRef.current?.click()}>
        {shownImage ? "เปลี่ยนรูปภาพ" : "อัปโหลดรูปภาพ"}
      </button>

      <label className="dash-field">
        <span className="dash-field__label">ชื่อของรางวัล</span>
        <input
          type="text"
          className="dash-input"
          value={form.name}
          onChange={(e) => set("name")(e.target.value)}
        />
      </label>

      <label className="dash-field">
        <span className="dash-field__label">หมวดหมู่</span>
        <select
          className="dash-input"
          value={form.category}
          onChange={(e) => set("category")(e.target.value)}
        >
          {REWARD_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="dash-field">
        <span className="dash-field__label">คำอธิบาย</span>
        <textarea
          className="dash-textarea"
          value={form.description}
          onChange={(e) => set("description")(e.target.value)}
        />
      </label>

      <label className="dash-field">
        <span className="dash-field__label">เงื่อนไขการใช้</span>
        <textarea
          className="dash-textarea"
          value={form.terms}
          onChange={(e) => set("terms")(e.target.value)}
        />
      </label>

      <div className="admin-rewards__pair">
        <label className="dash-field">
          <span className="dash-field__label">แต้มที่ใช้แลก</span>
          <input
            type="number"
            min="1"
            className="dash-input"
            value={form.pointsRequired}
            onChange={(e) => set("pointsRequired")(e.target.value)}
          />
        </label>

        <label className="dash-field">
          <span className="dash-field__label">ระยะเวลาใช้งานคูปอง (วัน)</span>
          <input
            type="number"
            min="1"
            max="3650"
            className="dash-input"
            value={form.validDays}
            onChange={(e) => set("validDays")(e.target.value)}
          />
        </label>
      </div>

      <div className="dash-field">
        <span className="dash-field__label">การจำกัดจำนวน</span>
        <div className="admin-rewards__limit-types">
          {LIMIT_TYPES.map((item) => (
            <Pill
              key={item.key}
              active={form.limitType === item.key}
              onClick={() => set("limitType")(item.key)}
            >
              {item.label}
            </Pill>
          ))}
        </div>
        <p className="dash-field__hint">
          สต๊อกนับเป็นชิ้นและลดลงทุกครั้งที่มีคนแลก ส่วนโควตานับใหม่ทุกต้นเดือน
        </p>
      </div>

      {form.limitType === "stock" && (
        <label className="dash-field">
          <span className="dash-field__label">จำนวนคงเหลือ (ชิ้น)</span>
          <input
            type="number"
            min="0"
            className="dash-input"
            value={form.stock}
            onChange={(e) => set("stock")(e.target.value)}
          />
        </label>
      )}

      {form.limitType === "quota" && (
        <label className="dash-field">
          <span className="dash-field__label">จำกัดสิทธิ์ต่อเดือน</span>
          <input
            type="number"
            min="1"
            className="dash-input"
            value={form.monthlyQuota}
            onChange={(e) => set("monthlyQuota")(e.target.value)}
          />
        </label>
      )}

      <label className="dash-field">
        <span className="dash-field__label">ตัวเลือก (คั่นด้วยจุลภาค)</span>
        <input
          type="text"
          className="dash-input"
          placeholder="เช่น S, M, L, XL"
          value={form.options}
          onChange={(e) => set("options")(e.target.value)}
        />
        <p className="dash-field__hint">เว้นว่างถ้าไม่ต้องให้ลูกค้าเลือกไซซ์หรือแบบ</p>
      </label>

      <label className="dash-field">
        <span className="dash-field__label">คูปองนี้ให้อะไร</span>
        <select
          className="dash-input"
          value={form.benefitType}
          onChange={(e) => set("benefitType")(e.target.value)}
        >
          {BENEFIT_TYPES.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>
        <p className="dash-field__hint">
          เลือก &ldquo;ลดเป็นจำนวนเงิน&rdquo; หรือ &ldquo;ฟรีค่าสนาม&rdquo; แล้วลูกค้าจะใช้คูปองนี้
          ลดยอดเองได้ในหน้าชำระเงิน ส่วน &ldquo;ไม่ลดราคา&rdquo; ต้องให้เจ้าหน้าที่ตัดให้ที่สนาม
        </p>
      </label>

      {form.benefitType !== "none" && (
        <label className="dash-field">
          <span className="dash-field__label">
            {form.benefitType === "free_hours"
              ? "จำนวนชั่วโมงที่ให้ฟรี"
              : form.benefitType === "advance_booking"
                ? "จำนวนวันที่จองล่วงหน้าได้เพิ่ม"
                : "จำนวนเงินที่ลด (บาท)"}
          </span>
          <input
            type="number"
            min="0"
            step={form.benefitType === "free_hours" ? "0.5" : "1"}
            className="dash-input"
            value={form.benefitValue}
            onChange={(e) => set("benefitValue")(e.target.value)}
          />
          {form.benefitType === "free_hours" && (
            <p className="dash-field__hint">
              คิดจากราคาต่อชั่วโมงจริงของการจองใบนั้น ไม่เกินยอดรวมของการจอง
            </p>
          )}
          {/* สิทธิ์แบบนี้ไม่ใช่คูปองที่เอาไปยื่นตอนจ่ายเงิน — มีผลกับบัญชี
              ทันทีที่แลก และหมดอายุตามช่อง "อายุคูปอง" ด้านบน (0055) */}
          {form.benefitType === "advance_booking" && (
            <p className="dash-field__hint">
              บวกจากค่าพื้นฐานที่ตั้งไว้ในหน้าตั้งค่าแต้ม มีผลกับบัญชีลูกค้าทันทีที่แลก
              และหมดอายุตามอายุคูปองที่ตั้งไว้ ไม่ต้องนำไปใช้ตอนชำระเงิน
            </p>
          )}
        </label>
      )}

      <label className="dash-field">
        <span className="dash-field__label">จำกัดต่อคน (ชิ้น)</span>
        <input
          type="number"
          min="1"
          className="dash-input"
          placeholder="เว้นว่าง = ไม่จำกัด"
          value={form.perUserLimit}
          onChange={(e) => set("perUserLimit")(e.target.value)}
        />
        <p className="dash-field__hint">
          กันคนที่มีแต้มเยอะกวาดสต๊อกไปคนเดียว — นับเฉพาะใบที่ยังไม่ถูกยกเลิก
        </p>
      </label>

      <div className="admin-rewards__toggle">
        <span>ต้องจัดส่ง / นัดรับที่สนาม</span>
        <Switch
          on={form.requiresShipping}
          label="ต้องจัดส่ง"
          onChange={set("requiresShipping")}
        />
      </div>

      <div className="admin-rewards__toggle">
        <span>แสดงในหน้าแลกรางวัล</span>
        <Switch on={form.isActive} label="แสดงในหน้าแลกรางวัล" onChange={set("isActive")} />
      </div>

      {error && <p className="dash-message dash-message--error">{error}</p>}

      <div className="admin-rewards__panel-actions">
        <button type="button" className="dash-btn dash-btn--cancel" onClick={onCancel}>
          ยกเลิก
        </button>
        <button
          type="button"
          className="dash-btn dash-btn--add"
          disabled={busy}
          onClick={handleSave}
        >
          {busy ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </aside>
  );
}

// แผงตั้งค่าอัตราแต้ม — เดิมอัตราเป็นค่าคงที่ฝังอยู่ใน complete_past_bookings()
// แก้ทีต้องเขียน migration ใหม่ ตอนนี้อ่านจาก reward_settings (0049) ซึ่งทั้ง
// ฟังก์ชันแจกแต้มและหน้า "วิธีสะสมแต้ม" ฝั่งลูกค้าอ่านตัวเดียวกัน
//
// แต้มมีสองก้อนที่ตั้งแยกกัน: ตามยอดที่จ่าย (baht_per_point) และโบนัสต่อรีวิว
// (review_points, 0106) ทั้งคู่จ่ายตอนลูกค้ากดส่งรีวิวในหน้าใบเสร็จ
function SettingsPanel({ settings, onSaved, onCancel }) {
  const { user } = useAuth();
  const [rate, setRate] = useState(String(settings?.bahtPerPoint ?? 10));
  const [enabled, setEnabled] = useState(settings?.earningEnabled ?? true);
  const [reviewPoints, setReviewPoints] = useState(String(settings?.reviewPoints ?? 20));
  const [reviewEnabled, setReviewEnabled] = useState(settings?.reviewPointsEnabled ?? true);
  const [advanceDays, setAdvanceDays] = useState(String(settings?.advanceBookingDays ?? 30));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    setBusy(true);

    try {
      await updateRewardSettings(
        {
          bahtPerPoint: rate,
          earningEnabled: enabled,
          reviewPoints,
          reviewPointsEnabled: reviewEnabled,
          advanceBookingDays: advanceDays,
        },
        user?.id,
      );
      onSaved();
    } catch (err) {
      console.error("updateRewardSettings failed:", err);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="dash-card admin-rewards__panel">
      <h2 className="admin-rewards__panel-title">ตั้งค่าการสะสมแต้ม</h2>

      <label className="dash-field">
        <span className="dash-field__label">ทุกกี่บาท = 1 แต้ม</span>
        <input
          type="number"
          min="1"
          max="100000"
          className="dash-input"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
        <p className="dash-field__hint">
          คิดจากยอดที่ลูกค้าจ่ายจริง (หลังหักคูปองแล้ว) และปัดเศษลง — ตั้ง
          {" "}{rate || "?"} หมายถึงจ่าย {rate || "?"} บาทได้ 1 แต้ม
        </p>
      </label>

      <div className="admin-rewards__toggle">
        <span>เปิดระบบสะสมแต้ม</span>
        <Switch on={enabled} label="เปิดระบบสะสมแต้ม" onChange={setEnabled} />
      </div>

      <p className="dash-field__hint">
        ปิดแล้วการจองใหม่จะไม่ได้แต้มเพิ่ม แต่แต้มที่ลูกค้ามีอยู่ยังใช้แลกรางวัลได้ตามปกติ
        และการเปลี่ยนอัตรามีผลกับการจองที่ปิดงานหลังจากนี้เท่านั้น ไม่ย้อนหลัง
      </p>

      {/* แต้มโบนัสของการรีวิว — คนละก้อนกับแต้มตามยอดข้างบน ทั้งคู่จ่ายพร้อมกัน
          ตอนลูกค้ากดส่งรีวิว (submit_review, 0106) ปรับตรงนี้มีผลกับรีวิวที่ส่ง
          หลังจากนี้เท่านั้น */}
      <label className="dash-field">
        <span className="dash-field__label">แต้มที่ได้จากการรีวิว (ต่อ 1 รีวิว)</span>
        <input
          type="number"
          min="0"
          max="100000"
          className="dash-input"
          value={reviewPoints}
          onChange={(e) => setReviewPoints(e.target.value)}
        />
        <p className="dash-field__hint">
          ลูกค้าเขียนรีวิวการจองที่เล่นจบแล้ว จะได้ {reviewPoints || "?"} แต้ม
          เพิ่มจากแต้มตามยอดที่จ่าย — หนึ่งการจองรีวิวได้ครั้งเดียว
        </p>
      </label>

      <div className="admin-rewards__toggle">
        <span>เปิดแต้มจากการรีวิว</span>
        <Switch on={reviewEnabled} label="เปิดแต้มจากการรีวิว" onChange={setReviewEnabled} />
      </div>

      <p className="dash-field__hint">
        ปิดแล้วลูกค้ายังรีวิวได้ตามปกติ แต่จะไม่ได้แต้มโบนัสก้อนนี้ (จำนวนแต้มที่ตั้งไว้
        ยังถูกเก็บไว้ เปิดกลับมาเมื่อไหร่ก็ใช้ค่าเดิม)
      </p>

      {/* ฐานของสิทธิ์จองล่วงหน้า — รางวัลประเภท "ขยายวันจองล่วงหน้า" จะบวก
          จำนวนวันเพิ่มจากค่านี้ให้เฉพาะคนที่แลกไว้ (0055) ถ้าตั้งค่านี้ไว้สูง
          เท่ากับที่รางวัลให้ สิทธิ์ที่ขายก็จะไม่มีความหมาย */}
      <label className="dash-field">
        <span className="dash-field__label">จองล่วงหน้าได้กี่วัน (ทุกคน)</span>
        <input
          type="number"
          min="1"
          max="365"
          className="dash-input"
          value={advanceDays}
          onChange={(e) => setAdvanceDays(e.target.value)}
        />
        <p className="dash-field__hint">
          ลูกค้าทั่วไปเลือกวันจองได้ไกลสุด {advanceDays || "?"} วันนับจากวันนี้
          ส่วนคนที่แลกรางวัล &ldquo;สิทธิ์จองล่วงหน้า&rdquo; จะได้เพิ่มตามจำนวนวันของรางวัลใบนั้น
        </p>
      </label>

      {error && <p className="dash-message dash-message--error">{error}</p>}

      <div className="admin-rewards__panel-actions">
        <button type="button" className="dash-btn dash-btn--cancel" onClick={onCancel}>
          ยกเลิก
        </button>
        <button
          type="button"
          className="dash-btn dash-btn--add"
          disabled={busy}
          onClick={handleSave}
        >
          {busy ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </aside>
  );
}

export default function AdminRewards() {
  const [filter, setFilter] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(null); // reward | "new" | null
  const [rowError, setRowError] = useState("");

  const [customerQuery, setCustomerQuery] = useState("");
  const [pointsReloadKey, setPointsReloadKey] = useState(0);
  const [pointsTarget, setPointsTarget] = useState(null); // ลูกค้าที่กำลังปรับแต้ม
  const [pointsBusy, setPointsBusy] = useState(false);
  const [pointsMessage, setPointsMessage] = useState(null);

  const { stats } = useAdminRewardStats(reloadKey);
  const { settings } = useRewardSettings(reloadKey);
  const { rewards, loading, error } = useRewardCatalog(filter || undefined, reloadKey);
  const { customers, loading: customersLoading } = useCustomerSearch(
    customerQuery,
    pointsReloadKey,
  );

  const reload = () => setReloadKey((key) => key + 1);

  async function handleAdjustPoints(amount, reason) {
    const target = pointsTarget;
    setPointsTarget(null);
    setPointsBusy(true);
    setPointsMessage(null);

    try {
      await adjustUserPoints(target.id, amount, reason);
      setPointsMessage({
        tone: "success",
        text: `ปรับแต้มของ ${target.full_name || target.username} เรียบร้อยแล้ว`,
      });
      setPointsReloadKey((key) => key + 1);
    } catch (err) {
      console.error("adjustUserPoints failed:", err);
      setPointsMessage({ tone: "error", text: errorMessage(err) });
    } finally {
      setPointsBusy(false);
    }
  }

  // "ใกล้หมด" = เหลือไม่เกิน 10 เท่ากับที่ admin_reward_stats() นับ — ถ้าใช้
  // เกณฑ์คนละตัวกับ KPI ด้านบน กล่องเตือนจะบอกจำนวนไม่ตรงกับตัวเลขในการ์ด
  const lowStock = useMemo(
    () => rewards.filter((r) => r.isActive && r.remaining != null && r.remaining <= 10),
    [rewards],
  );

  async function handleDelete(reward) {
    // ยืนยันก่อนเพราะลบแล้วไม่มีทางกู้ — ส่วนของที่มีคนแลกไปแล้วจะถูก FK
    // ปฏิเสธที่ฐานข้อมูลอยู่แล้ว lib แปลงเป็นข้อความไทยให้
    if (!window.confirm(`ลบ "${reward.name}" ถาวร?

ถ้าเคยมีคนแลกไปแล้วจะลบไม่ได้ ให้ใช้ปิดใช้งานแทน`)) {
      return;
    }

    setRowError("");

    try {
      await deleteReward(reward.id);
      if (editing?.id === reward.id) setEditing(null);
      reload();
    } catch (err) {
      console.error("deleteReward failed:", err);
      setRowError(errorMessage(err));
    }
  }

  async function handleToggleActive(reward) {
    setRowError("");

    try {
      await setRewardActive(reward.id, !reward.isActive);
      reload();
    } catch (err) {
      console.error("setRewardActive failed:", err);
      setRowError(errorMessage(err));
    }
  }

  return (
    <DashboardLayout
      variant="admin"
      title="จัดการรางวัล"
      subtitle="เพิ่ม แก้ไข และควบคุมสต๊อกของรางวัลที่แสดงในหน้าแลกรางวัล"
      headerExtra={
        <div className="admin-rewards__header-actions">
          <Link to="/rewards" className="dash-btn">
            ดูหน้าเว็บ
          </Link>
          <button
            type="button"
            className="dash-btn"
            onClick={() => setEditing("settings")}
          >
            ⚙ ตั้งค่าแต้ม (
            {settings
              ? `${settings.bahtPerPoint} บาท = 1 แต้ม${
                  settings.reviewPointsEnabled && settings.reviewPoints > 0
                    ? ` · รีวิว +${settings.reviewPoints}`
                    : ""
                }`
              : "..."}
            )
          </button>
          <button
            type="button"
            className="dash-btn dash-btn--add"
            onClick={() => setEditing("new")}
          >
            ＋ เพิ่มของรางวัล
          </button>
        </div>
      }
    >
      <div className="dash-kpi">
        <StatCard label="รางวัลทั้งหมด" value={stats?.totalRewards ?? "—"} />
        <StatCard label="แลกไปแล้วเดือนนี้" value={stats?.redeemedMonth ?? "—"} />
        <StatCard
          label="มูลค่าแต้มที่แลกเดือนนี้"
          value={stats ? formatBaht(stats.pointsMonth) : "—"}
          hint="คิดจากแต้มที่ถูกใช้ไปทั้งหมด"
        />
        <StatCard
          label="ใกล้หมดสต๊อก"
          value={stats?.lowStockCount ?? "—"}
          tone={stats?.lowStockCount ? "danger" : "default"}
        />
      </div>

      <section className="dash-card admin-points">
        <header className="admin-rewards__list-header">
          <h2>ปรับแต้มลูกค้า</h2>
        </header>

        <div className="admin-points__body">
          <SearchBox
            placeholder="ค้นหาชื่อหรือ username ลูกค้า..."
            value={customerQuery}
            onChange={setCustomerQuery}
          />

          {pointsMessage && (
            <p className={`dash-message dash-message--${pointsMessage.tone}`}>
              {pointsMessage.text}
            </p>
          )}

          {customerQuery.trim() === "" && (
            <p className="dash-empty">พิมพ์ชื่อหรือ username เพื่อค้นหาลูกค้า</p>
          )}
          {customerQuery.trim() !== "" && customersLoading && (
            <p className="dash-empty">กำลังค้นหา...</p>
          )}
          {customerQuery.trim() !== "" && !customersLoading && customers.length === 0 && (
            <p className="dash-empty">ไม่พบลูกค้าที่ตรงกับคำค้นหา</p>
          )}

          {customers.map((customer) => (
            <div key={customer.id} className="admin-points__row">
              <div className="dash-identity">
                <div className="dash-identity__avatar" aria-hidden="true">
                  {(customer.full_name || customer.username).charAt(0)}
                </div>
                <div>
                  <p className="dash-identity__name">
                    {customer.full_name || customer.username}
                  </p>
                  <p className="dash-identity__email">@{customer.username}</p>
                </div>
              </div>

              <div className="admin-points__balance">
                <p>{formatPoints(customer.points)} แต้ม</p>
                <button
                  type="button"
                  className="dash-btn"
                  disabled={pointsBusy}
                  onClick={() => setPointsTarget(customer)}
                >
                  ปรับแต้ม
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="dash-filters">
        {FILTERS.map((item) => (
          <Pill
            key={item.key}
            active={item.key === filter}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
          </Pill>
        ))}
      </div>

      <div className="admin-rewards">
        <section className="dash-card admin-rewards__list">
          <header className="admin-rewards__list-header">
            <h2>คลังของรางวัล</h2>
            <Badge tone="tint">{rewards.length} รายการ</Badge>
          </header>

          {loading && <p className="dash-empty">กำลังโหลดคลังของรางวัล...</p>}
          {!loading && error && <p className="dash-empty">{error}</p>}
          {!loading && !error && rewards.length === 0 && (
            <p className="dash-empty">ยังไม่มีของรางวัลในหมวดนี้</p>
          )}
          {rowError && <p className="dash-message dash-message--error">{rowError}</p>}

          {rewards.map((reward) => {
            const limit = describeLimit(reward);

            return (
              <div
                key={reward.id}
                className={`admin-rewards__row ${
                  editing?.id === reward.id ? "admin-rewards__row--selected" : ""
                }`}
              >
                <div className="admin-rewards__thumb">
                  <RewardMedia reward={reward} size={36} />
                </div>

                <div className="admin-rewards__row-info">
                  <p className="admin-rewards__row-name">
                    {reward.name}
                    {!reward.isActive && <span className="admin-rewards__off">ปิดอยู่</span>}
                  </p>
                  <p className="admin-rewards__row-meta">
                    {reward.categoryLabel} · {describeBenefit(reward)} ·{" "}
                    {reward.redeemedMonth} ครั้งเดือนนี้
                  </p>
                </div>

                <div className="admin-rewards__row-points">
                  <p>{formatPoints(reward.pointsRequired)} แต้ม</p>
                  <Badge tone={limit.soldOut ? "danger" : "success"}>{limit.short}</Badge>
                </div>

                <div className="admin-rewards__row-actions">
                  <button
                    type="button"
                    className="dash-btn"
                    onClick={() => setEditing(reward)}
                  >
                    แก้ไข
                  </button>
                  <button
                    type="button"
                    className="dash-btn"
                    onClick={() => handleToggleActive(reward)}
                  >
                    {reward.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                  </button>
                  <button
                    type="button"
                    className="dash-btn admin-rewards__delete"
                    onClick={() => handleDelete(reward)}
                  >
                    ลบ
                  </button>
                </div>
              </div>
            );
          })}
        </section>

        <div className="admin-rewards__side">
          {editing === "settings" ? (
            <SettingsPanel
              key={`settings:${settings?.bahtPerPoint}:${settings?.earningEnabled}:${settings?.reviewPoints}:${settings?.reviewPointsEnabled}:${settings?.advanceBookingDays}`}
              settings={settings}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                reload();
              }}
            />
          ) : editing ? (
            <EditPanel
              key={editing === "new" ? "new" : editing.id}
              reward={editing === "new" ? null : editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                reload();
              }}
            />
          ) : (
            <aside className="dash-card admin-rewards__panel">
              <p className="dash-empty">เลือกของรางวัลทางซ้ายเพื่อแก้ไข หรือกดเพิ่มของรางวัล</p>
            </aside>
          )}

          {lowStock.length > 0 && (
            <aside className="admin-rewards__alert">
              <p className="admin-rewards__alert-title">
                ⚠ ใกล้หมดสต๊อก {lowStock.length} รายการ
              </p>
              <p className="admin-rewards__alert-body">
                {lowStock
                  .map((r) => `“${r.name}” ${describeLimit(r).short}`)
                  .join(" และ ")}{" "}
                ควรเติมสต๊อกหรือปรับโควตา
              </p>
              <button
                type="button"
                className="dash-btn"
                onClick={() => setEditing(lowStock[0])}
              >
                จัดการสต๊อก
              </button>
            </aside>
          )}
        </div>
      </div>

      {pointsTarget && (
        <AdjustPointsDialog
          customer={pointsTarget}
          onClose={() => setPointsTarget(null)}
          onSubmit={handleAdjustPoints}
        />
      )}
    </DashboardLayout>
  );
}
