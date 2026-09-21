// ตั้งราคาและรายละเอียดของสนามหนึ่งสนาม — ราคาพื้นฐาน ราคาตามช่วงเวลา ส่วนลด
// รูปภาพ และประวัติการแก้ราคา
//
// กล่องพรีวิวราคาเรียก compute_facility_price จริงเสมอ ตัวเลขที่แอดมินเห็น
// จึงเป็นตัวเลขเดียวกับที่ลูกค้าจะถูกเรียกเก็บ
import { useRef, useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import DashboardLayout from "../components/DashboardLayout";
import ImageCropModal from "../components/ImageCropModal";
import { Switch, Badge } from "../components/DashboardWidgets";
import { useAsyncData } from "../hooks/useAsyncData";
import { useFacilityImages } from "../hooks/useFacilityImages";
import {
  createSport,
  deleteSport,
  fetchAdminSports,
  fetchFacilitiesBySport,
  replaceSportIcon,
  uploadSportIcon,
} from "../lib/catalog";
import { useFacilityPricingConfig, useFacilityPriceHistory } from "../hooks/usePricing";
import {
  applyBasePriceToSport,
  createDiscount,
  createFacility,
  createPricingRule,
  createVenue,
  deleteDiscount,
  deleteFacility,
  deletePricingRule,
  fetchFacilityPricePreview,
  fetchVenues,
  logPriceChange,
  updateDiscount,
  updateFacilityBasePrice,
  updatePricingRule,
  updateVenueDetails,
} from "../lib/pricing";
import { ensureFutureSlots } from "../lib/schedule";
import {
  MAX_IMAGES_PER_FACILITY,
  RECOMMENDED_HEIGHT,
  RECOMMENDED_WIDTH,
  deleteFacilityImage,
  reorderFacilityImages,
  replaceImageFile,
  setPrimaryImage,
  updateImageCaption,
  uploadFacilityImage,
} from "../lib/facilityImages";
import { formatBaht } from "../lib/bookings";
import { assertImageFile } from "../lib/uploads";
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

// ลากสลับลำดับ (ทั้งช่วงราคาและรูปภาพ) ใช้ order ชั่วคราวตัวเดียวกันนี้ระหว่าง
// รอ reorder จริงยืนยันกลับมา กันแถวกระตุกกลับตำแหน่งเดิมก่อนโดดไปตำแหน่งใหม่
function applyLocalOrder(items, orderIds) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = orderIds.map((id) => byId.get(id)).filter(Boolean);
  const orderedIds = new Set(orderIds);
  const rest = items.filter((item) => !orderedIds.has(item.id));
  return [...ordered, ...rest];
}

function formatKb(bytes) {
  if (!bytes) return "";
  return `${Math.round(bytes / 1024)} KB`;
}


const PRICE_FIELDS = [
  { field: "weekdayPrice", label: "จ–ศ" },
  { field: "weekendPrice", label: "ส–อา" },
  { field: "holidayPrice", label: "วันหยุดนักขัตฤกษ์" },
];

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
      {/* แถวนี้ซ้ำได้หลายแถว (กฎราคาหนึ่งช่วงเวลาต่อหนึ่งแถว) จึงผูก id/label
          ไม่ได้ ใช้ aria-label ที่มีชื่อกฎกำกับแทน เพื่อให้โปรแกรมอ่านหน้าจอ
          แยกออกว่ากำลังแก้ช่องของกฎไหนอยู่ */}
      <input
        className="dash-input pricing-rule__label"
        aria-label="ชื่อกฎราคา"
        value={draft.label}
        onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
        onBlur={() => commitField("label", draft.label)}
        disabled={busy}
      />
      <div className="pricing-rule__times">
        <input
          type="time"
          className="dash-input"
          aria-label={`เวลาเริ่มของกฎ ${draft.label || "ราคา"}`}
          value={draft.startTime}
          onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value }))}
          onBlur={() => commitField("startTime", draft.startTime)}
          disabled={busy}
        />
        <span>–</span>
        <input
          type="time"
          className="dash-input"
          aria-label={`เวลาสิ้นสุดของกฎ ${draft.label || "ราคา"}`}
          value={draft.endTime}
          onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value }))}
          onBlur={() => commitField("endTime", draft.endTime)}
          disabled={busy}
        />
      </div>
      {/* data-label คือชื่อคอลัมน์ของช่องราคานั้น — บนจอกว้างชื่อนี้อยู่ที่แถว
          หัวตาราง แต่พอจอแคบลงจนแถวถูกพับเป็นสองคอลัมน์ หัวตารางจะไม่ตรงกับ
          ช่องอีกต่อไป (ดู @media ใน AdminFacilityPricing.css) จึงต้องมีชื่อ
          ติดมากับช่องเอง ไม่งั้นแอดมินไม่รู้ว่ากำลังแก้ราคาวันไหน */}
      {PRICE_FIELDS.map(({ field, label }) => (
        <div className="pricing-rule__price" data-label={label} key={field}>
          <span>฿</span>
          <input
            type="number"
            min="0"
            step="1"
            className="pricing-rule__price-input"
            aria-label={`ราคา${label}`}
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
  const fileInputRef = useRef(null);
  const uploaderRef = useRef(null);
  const sportIconInputRef = useRef(null);

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

  // สถานะฝั่งรูปภาพ (เดิมอยู่หน้า AdminFacilityImages แยกต่างหาก — ย้ายมารวม
  // กับหน้าราคาเพราะทั้งคู่แก้ไข "สนาม" เดียวกัน ใช้ตัวเลือกกีฬา/สนามร่วมกัน)
  const [uploading, setUploading] = useState(false);
  const [sportIconUploading, setSportIconUploading] = useState(false);
  const [sportIconError, setSportIconError] = useState("");
  const [dragOverDrop, setDragOverDrop] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [cropTarget, setCropTarget] = useState(null);
  const [captionDrafts, setCaptionDrafts] = useState({});
  const [editingCaptionId, setEditingCaptionId] = useState(null);
  const [savingCaptions, setSavingCaptions] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [localOrder, setLocalOrder] = useState(null);

  // ฟอร์มเพิ่มกีฬา/สถานที่/สนามใหม่ — เปิดทีละอันจากปุ่มแถวตัวเลือกกีฬา/สนาม
  const [addingSport, setAddingSport] = useState(false);
  const [newSport, setNewSport] = useState({ name: "", description: "" });
  const [savingSport, setSavingSport] = useState(false);

  const [addingFacility, setAddingFacility] = useState(false);
  const [addingVenue, setAddingVenue] = useState(false);
  const [newVenue, setNewVenue] = useState({
    name: "",
    address: "",
    phone: "",
    openingTime: "08:00",
    closingTime: "22:00",
  });
  const [savingVenue, setSavingVenue] = useState(false);
  const [newFacility, setNewFacility] = useState({
    venueId: "",
    name: "",
    description: "",
    capacity: "",
    pricePerHour: "",
    minBookingHours: "1",
    depositPercent: "0",
  });
  const [savingFacility, setSavingFacility] = useState(false);

  const { data: venues } = useAsyncData(fetchVenues, `pricing-venues:${reloadKey}`, EMPTY_LIST);

  // key ผูกกับ reloadKey ด้วย เพื่อให้รูปกีฬาที่เพิ่งอัปโหลด (handleSportIconChange
  // ด้านล่าง) สะท้อนขึ้นพรีวิวทันทีหลังอัปเดต icon_url สำเร็จ
  const { data: sports } = useAsyncData(fetchAdminSports, `pricing-sports:${reloadKey}`, EMPTY_LIST);
  const effectiveSportId = sportId ?? sports[0]?.id ?? null;
  const effectiveSport = sports.find((s) => s.id === effectiveSportId) ?? null;

  const { data: facilities } = useAsyncData(
    () => fetchFacilitiesBySport(effectiveSportId),
    effectiveSportId != null ? `pricing-facilities:${effectiveSportId}:${reloadKey}` : null,
    EMPTY_LIST,
  );

  const effectiveFacilityId = facilities.some((f) => f.id === facilityId)
    ? facilityId
    : (facilities[0]?.id ?? null);
  const selectedFacility = facilities.find((f) => f.id === effectiveFacilityId);

  const { config, loading: configLoading } = useFacilityPricingConfig(effectiveFacilityId, reloadKey);
  const { history } = useFacilityPriceHistory(effectiveFacilityId, reloadKey);

  const { data: preview, loading: previewLoading } = useAsyncData(
    () => fetchFacilityPricePreview(effectiveFacilityId, PREVIEW_DATE, PREVIEW_START, PREVIEW_END),
    effectiveFacilityId != null ? `pricing-preview:${effectiveFacilityId}:${reloadKey}` : null,
  );

  const { images, loading: imagesLoading } = useFacilityImages(effectiveFacilityId, reloadKey);

  // order ชั่วคราวของแกลเลอรีรูป ล้างด้วยการเทียบ loading กับรอบก่อนหน้าตอน
  // render แทน useEffect (เหมือน AdminFacilities.jsx / AdminFacilityImages เดิม)
  const [prevImagesLoading, setPrevImagesLoading] = useState(imagesLoading);
  if (imagesLoading !== prevImagesLoading) {
    setPrevImagesLoading(imagesLoading);
    if (!imagesLoading) setLocalOrder(null);
  }

  const displayImages = localOrder ? applyLocalOrder(images, localOrder) : images;
  const coverImage = images.find((img) => img.isPrimary) ?? images[0] ?? null;
  const lowResImages = images.filter(
    (img) => img.width && img.height && (img.width < RECOMMENDED_WIDTH || img.height < RECOMMENDED_HEIGHT),
  );

  // headerDraft เป็น null จนกว่าผู้ใช้จะพิมพ์ — ก่อนหน้านั้นอิงจากค่าที่โหลด
  // มาตรง ๆ (เหมือน AdminFacilities.jsx เลี่ยง setState ใน effect)
  const [baseDraft, setBaseDraft] = useState(null);
  const base = baseDraft ?? config.basePrice;

  function reload() {
    setReloadKey((k) => k + 1);
  }

  async function handleCreateSport() {
    const name = newSport.name.trim();
    if (!name) {
      setActionError("กรุณากรอกชื่อกีฬา");
      return;
    }

    setSavingSport(true);
    setActionError("");
    setActionMessage("");
    try {
      const sport = await createSport({ name, description: newSport.description.trim() });
      setNewSport({ name: "", description: "" });
      setAddingSport(false);
      setSportId(sport.id);
      setFacilityId(null);
      setActionMessage(`เพิ่มกีฬา "${sport.name}" แล้ว — เพิ่มสนามให้กีฬานี้ต่อได้เลย`);
      reload();
    } catch (err) {
      console.error("createSport failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setSavingSport(false);
    }
  }

  async function handleCreateVenue() {
    const name = newVenue.name.trim();
    const address = newVenue.address.trim();
    if (!name || !address) {
      setActionError("กรุณากรอกชื่อและที่อยู่ของสถานที่ใหม่");
      return;
    }

    setSavingVenue(true);
    setActionError("");
    try {
      const venue = await createVenue({
        name,
        address,
        phone: newVenue.phone.trim(),
        openingTime: newVenue.openingTime,
        closingTime: newVenue.closingTime,
      });
      setNewVenue({ name: "", address: "", phone: "", openingTime: "08:00", closingTime: "22:00" });
      setAddingVenue(false);
      setNewFacility((f) => ({ ...f, venueId: String(venue.id) }));
      reload();
    } catch (err) {
      console.error("createVenue failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setSavingVenue(false);
    }
  }

  async function handleCreateFacility() {
    if (!effectiveSportId) {
      setActionError("กรุณาเลือกกีฬาก่อน");
      return;
    }
    const name = newFacility.name.trim();
    if (!newFacility.venueId) {
      setActionError("กรุณาเลือกสถานที่ของสนามใหม่");
      return;
    }
    if (!name) {
      setActionError("กรุณากรอกชื่อสนาม");
      return;
    }
    const price = Number(newFacility.pricePerHour);
    if (!price || price <= 0) {
      setActionError("กรุณากรอกราคาต่อชั่วโมงให้ถูกต้อง");
      return;
    }

    setSavingFacility(true);
    setActionError("");
    setActionMessage("");
    try {
      const createdFacilityId = await createFacility({
        venueId: Number(newFacility.venueId),
        sportId: effectiveSportId,
        name,
        description: newFacility.description.trim(),
        capacity: newFacility.capacity === "" ? null : Number(newFacility.capacity),
        pricePerHour: price,
        minBookingHours: Number(newFacility.minBookingHours) || 1,
        depositPercent: Number(newFacility.depositPercent) || 0,
      });

      // เปิดตารางเวลาให้จองล่วงหน้าทันที ไม่ต้องรอ cron รอบถัดไป (เหมือนปุ่ม
      // "เติมช่วงเวลาล่วงหน้า" ในหน้าจัดการตารางเวลา)
      await ensureFutureSlots(70);

      setNewFacility({
        venueId: "",
        name: "",
        description: "",
        capacity: "",
        pricePerHour: "",
        minBookingHours: "1",
        depositPercent: "0",
      });
      setAddingFacility(false);
      setFacilityId(createdFacilityId);
      setActionMessage("เพิ่มสนามใหม่และเปิดตารางเวลาให้จองล่วงหน้าแล้ว");
      reload();
    } catch (err) {
      console.error("createFacility failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setSavingFacility(false);
    }
  }

  async function handleDeleteSport() {
    if (!effectiveSportId || !effectiveSport) return;
    if (!window.confirm(`ลบกีฬา "${effectiveSport.name}" ทิ้งเลยหรือไม่?`)) return;

    setActionError("");
    setActionMessage("");
    try {
      await deleteSport(effectiveSportId);
      setSportId(null);
      setFacilityId(null);
      setActionMessage(`ลบกีฬา "${effectiveSport.name}" แล้ว`);
      reload();
    } catch (err) {
      console.error("deleteSport failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function handleDeleteFacility() {
    if (!effectiveFacilityId || !selectedFacility) return;
    if (
      !window.confirm(
        `ลบสนาม "${selectedFacility.name}" ทิ้งเลยหรือไม่? รูปภาพ ราคา ส่วนลด และตารางเวลาของสนามนี้จะถูกลบไปด้วยทั้งหมด`,
      )
    ) {
      return;
    }

    setActionError("");
    setActionMessage("");
    try {
      await deleteFacility(effectiveFacilityId);
      setFacilityId(null);
      setActionMessage(`ลบสนาม "${selectedFacility.name}" แล้ว`);
      reload();
    } catch (err) {
      console.error("deleteFacility failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function handleSaveBasePrice() {
    if (!config.basePrice || !effectiveFacilityId) return;

    const name = base.name.trim();
    const venueName = base.venueName.trim();
    const venueAddress = base.venueAddress.trim();
    if (!name) {
      setActionError("กรุณากรอกชื่อสนาม");
      return;
    }
    if (!venueName || !venueAddress) {
      setActionError("กรุณากรอกชื่อและที่อยู่ของสถานที่");
      return;
    }

    setSavingBase(true);
    setActionError("");
    setActionMessage("");

    try {
      const before = config.basePrice;
      const payload = {
        name,
        pricePerHour: Number(base.pricePerHour),
        minBookingHours: Number(base.minBookingHours),
        depositPercent: Number(base.depositPercent),
      };

      await updateFacilityBasePrice(effectiveFacilityId, payload);

      if (venueName !== before.venueName || venueAddress !== before.venueAddress) {
        await updateVenueDetails(before.venueId, { name: venueName, address: venueAddress });
      }

      if (before.name !== payload.name) {
        await logPriceChange(
          effectiveFacilityId,
          `เปลี่ยนชื่อสนาม "${before.name}" → "${payload.name}"`,
        );
      }
      if (venueName !== before.venueName) {
        await logPriceChange(
          effectiveFacilityId,
          `เปลี่ยนชื่อสถานที่ "${before.venueName}" → "${venueName}"`,
        );
      }
      if (venueAddress !== before.venueAddress) {
        await logPriceChange(effectiveFacilityId, "เปลี่ยนที่อยู่สถานที่");
      }
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
      setActionMessage("บันทึกข้อมูลสนามเรียบร้อย");
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

  async function handleFiles(fileList) {
    if (!effectiveFacilityId) return;
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    setActionError("");
    setUploading(true);

    let count = images.length;
    const errors = [];

    for (const file of files) {
      try {
        await uploadFacilityImage(file, effectiveFacilityId, {
          existingCount: count,
          isFirst: count === 0,
        });
        count += 1;
      } catch (err) {
        console.error("uploadFacilityImage failed:", err);
        errors.push(errorMessage(err));
      }
    }

    setUploading(false);
    if (errors.length > 0) setActionError(errors.join(" · "));
    reload();
  }

  async function handleSportIconChange(file) {
    if (!file || !effectiveSportId) return;

    setSportIconError("");
    try {
      assertImageFile(file);
    } catch (err) {
      setSportIconError(err.message);
      return;
    }

    setSportIconUploading(true);
    try {
      await uploadSportIcon(file, effectiveSportId);
      reload();
    } catch (err) {
      console.error("uploadSportIcon failed:", err);
      setSportIconError(errorMessage(err));
    } finally {
      setSportIconUploading(false);
    }
  }

  function handleDropzoneDrop(e) {
    e.preventDefault();
    setDragOverDrop(false);
    handleFiles(e.dataTransfer.files);
  }

  async function handleSetPrimary(image) {
    setActionError("");
    try {
      await setPrimaryImage(image.id);
      reload();
    } catch (err) {
      console.error("setPrimaryImage failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function handleDeleteImage(image) {
    setActionError("");
    try {
      await deleteFacilityImage(image);
      setConfirmDeleteId(null);
      reload();
    } catch (err) {
      console.error("deleteFacilityImage failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function handleCropConfirm(blob) {
    setActionError("");
    try {
      if (cropTarget.kind === "sport-icon") {
        await replaceSportIcon(blob, cropTarget.sportId);
      } else {
        await replaceImageFile(cropTarget, blob);
      }
      setCropTarget(null);
      reload();
    } catch (err) {
      console.error("crop confirm failed:", err);
      setActionError(errorMessage(err));
    }
  }

  function handleGalleryDragEnd() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  async function handleGalleryDrop(index) {
    const from = dragIndex;
    handleGalleryDragEnd();
    if (from === null || from === index) return;

    const reordered = [...displayImages];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(index, 0, moved);

    setLocalOrder(reordered.map((i) => i.id));
    setActionError("");
    try {
      await reorderFacilityImages(reordered);
      reload();
    } catch (err) {
      console.error("reorderFacilityImages failed:", err);
      setActionError(errorMessage(err));
      setLocalOrder(null);
    }
  }

  const dirtyCaptionCount = Object.entries(captionDrafts).filter(
    ([id, value]) => images.find((i) => String(i.id) === id)?.caption !== value,
  ).length;

  async function handleSaveCaptions() {
    setSavingCaptions(true);
    setActionError("");
    try {
      const dirty = Object.entries(captionDrafts).filter(
        ([id, value]) => images.find((i) => String(i.id) === id)?.caption !== value,
      );
      await Promise.all(dirty.map(([id, value]) => updateImageCaption(Number(id), value)));
      setEditingCaptionId(null);
      reload();
    } catch (err) {
      console.error("updateImageCaption failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setSavingCaptions(false);
    }
  }

  return (
    <DashboardLayout
      variant="admin"
      title="จัดการสนาม"
      subtitle="ชื่อ ที่ตั้ง ราคา และรูปภาพของแต่ละสนาม"
      headerExtra={
        <div className="pricing-page__actions">
          {effectiveSportId != null && (
            <a
              href={`/booking/field?sport=${effectiveSportId}`}
              target="_blank"
              rel="noreferrer"
              className="dash-btn"
            >
              ดูหน้าเว็บ
            </a>
          )}
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
            disabled={savingCaptions || dirtyCaptionCount === 0}
            onClick={handleSaveCaptions}
          >
            {savingCaptions ? "กำลังบันทึก..." : "บันทึกรูปภาพ"}
          </button>
          <button
            type="button"
            className="dash-btn dash-btn--add"
            disabled={savingBase || !config.basePrice}
            onClick={handleSaveBasePrice}
          >
            {savingBase ? "กำลังบันทึก..." : "บันทึกข้อมูลสนาม"}
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
            aria-label="เลือกกีฬา"
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
          <button
            type="button"
            className="dash-btn"
            onClick={() => {
              setAddingSport((v) => !v);
              setAddingFacility(false);
            }}
          >
            ＋ กีฬาใหม่
          </button>
          <button
            type="button"
            className="dash-btn dash-btn--cancel"
            disabled={!effectiveSportId}
            onClick={handleDeleteSport}
          >
            ลบกีฬานี้
          </button>
        </div>
        <div className="pricing-page__context-field">
          <span className="pricing-page__context-label">สนาม</span>
          <select
            className="dash-select"
            aria-label="เลือกสนาม"
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
          <button
            type="button"
            className="dash-btn"
            disabled={!effectiveSportId}
            onClick={() => {
              setAddingFacility((v) => !v);
              setAddingSport(false);
            }}
          >
            ＋ สนามใหม่
          </button>
          <button
            type="button"
            className="dash-btn dash-btn--cancel"
            disabled={!effectiveFacilityId}
            onClick={handleDeleteFacility}
          >
            ลบสนามนี้
          </button>
        </div>
        <div className="dash-filters__spacer" />
        <button type="button" className="dash-pill dash-pill--tint" onClick={handleApplyToSport}>
          ใช้ราคานี้กับทุกสนามในกีฬาเดียวกัน
        </button>
      </div>

      {addingSport && (
        <section className="dash-card">
          <h2>เพิ่มกีฬาใหม่</h2>
          <div className="pricing-page__base-grid">
            <label className="dash-field">
              <span className="dash-field__label">ชื่อกีฬา</span>
              <input
                type="text"
                className="dash-input"
                autoFocus
                value={newSport.name}
                onChange={(e) => setNewSport((s) => ({ ...s, name: e.target.value }))}
              />
            </label>
            <label className="dash-field">
              <span className="dash-field__label">คำอธิบาย (ไม่บังคับ)</span>
              <input
                type="text"
                className="dash-input"
                value={newSport.description}
                onChange={(e) => setNewSport((s) => ({ ...s, description: e.target.value }))}
              />
            </label>
          </div>
          <div className="pricing-discount-form__actions">
            <button type="button" className="dash-btn" onClick={() => setAddingSport(false)}>
              ยกเลิก
            </button>
            <button
              type="button"
              className="dash-btn dash-btn--add"
              disabled={savingSport}
              onClick={handleCreateSport}
            >
              {savingSport ? "กำลังบันทึก..." : "เพิ่มกีฬา"}
            </button>
          </div>
        </section>
      )}

      {addingFacility && (
        <section className="dash-card">
          <h2>เพิ่มสนามใหม่{effectiveSport ? ` — ${effectiveSport.name}` : ""}</h2>
          <div className="pricing-page__base-grid">
            {/* ช่องนี้ครอบด้วย <label> แบบช่องอื่นในกริดไม่ได้ เพราะมีปุ่ม
                "เพิ่มสถานที่ใหม่" อยู่ข้างในด้วย — การคลิก label จะส่งโฟกัส/
                เปิด select ตามไปด้วยทุกครั้งที่กดปุ่มนั้น ใช้ aria-label ที่ตัว
                select แทน ได้ชื่อให้โปรแกรมอ่านหน้าจอเหมือนกันโดยไม่พ่วงพฤติกรรม */}
            <div className="dash-field">
              <span className="dash-field__label">สถานที่</span>
              <select
                className="dash-select"
                aria-label="สถานที่ของสนามใหม่"
                value={newFacility.venueId}
                onChange={(e) => setNewFacility((f) => ({ ...f, venueId: e.target.value }))}
              >
                <option value="">— เลือกสถานที่ —</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="dash-btn"
                style={{ marginTop: "0.5rem" }}
                onClick={() => setAddingVenue((v) => !v)}
              >
                ＋ เพิ่มสถานที่ใหม่
              </button>
            </div>

            {addingVenue && (
              <>
                <label className="dash-field">
                  <span className="dash-field__label">ชื่อสถานที่ใหม่</span>
                  <input
                    type="text"
                    className="dash-input"
                    value={newVenue.name}
                    onChange={(e) => setNewVenue((v) => ({ ...v, name: e.target.value }))}
                  />
                </label>
                <label className="dash-field">
                  <span className="dash-field__label">ที่อยู่</span>
                  <input
                    type="text"
                    className="dash-input"
                    value={newVenue.address}
                    onChange={(e) => setNewVenue((v) => ({ ...v, address: e.target.value }))}
                  />
                </label>
                <label className="dash-field">
                  <span className="dash-field__label">เบอร์โทร (ไม่บังคับ)</span>
                  <input
                    type="text"
                    className="dash-input"
                    value={newVenue.phone}
                    onChange={(e) => setNewVenue((v) => ({ ...v, phone: e.target.value }))}
                  />
                </label>
                {/*
                  ช่องนี้มีสองอินพุตใต้หัวข้อเดียว จึงครอบด้วย <label> แบบช่องอื่น
                  ไม่ได้ (label หนึ่งตัวผูกได้กับ control เดียว) ใช้ role="group"
                  + aria-labelledby แทน แล้วให้แต่ละอินพุตมี aria-label ของตัวเอง
                  ไม่งั้นโปรแกรมอ่านหน้าจอจะอ่านทั้งคู่เป็น "ช่องเวลา" เฉย ๆ
                  แยกไม่ออกว่าอันไหนเปิดอันไหนปิด
                */}
                <div
                  className="dash-field"
                  role="group"
                  aria-labelledby="new-venue-hours-label"
                >
                  <span className="dash-field__label" id="new-venue-hours-label">
                    เวลาเปิด–ปิด
                  </span>
                  <div className="pricing-rule__times">
                    <input
                      type="time"
                      className="dash-input"
                      aria-label="เวลาเปิด"
                      value={newVenue.openingTime}
                      onChange={(e) => setNewVenue((v) => ({ ...v, openingTime: e.target.value }))}
                    />
                    <span>–</span>
                    <input
                      type="time"
                      className="dash-input"
                      aria-label="เวลาปิด"
                      value={newVenue.closingTime}
                      onChange={(e) => setNewVenue((v) => ({ ...v, closingTime: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="dash-field">
                  <button
                    type="button"
                    className="dash-btn dash-btn--add"
                    disabled={savingVenue}
                    onClick={handleCreateVenue}
                  >
                    {savingVenue ? "กำลังบันทึก..." : "บันทึกสถานที่ใหม่"}
                  </button>
                </div>
              </>
            )}

            <label className="dash-field">
              <span className="dash-field__label">ชื่อสนาม</span>
              <input
                type="text"
                className="dash-input"
                value={newFacility.name}
                onChange={(e) => setNewFacility((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="dash-field">
              <span className="dash-field__label">ความจุ (คน, ไม่บังคับ)</span>
              <input
                type="number"
                min="0"
                className="dash-input"
                value={newFacility.capacity}
                onChange={(e) => setNewFacility((f) => ({ ...f, capacity: e.target.value }))}
              />
            </label>
            <label className="dash-field">
              <span className="dash-field__label">ราคาต่อชั่วโมง</span>
              <input
                type="number"
                min="0"
                className="dash-input"
                value={newFacility.pricePerHour}
                onChange={(e) => setNewFacility((f) => ({ ...f, pricePerHour: e.target.value }))}
              />
            </label>
            <label className="dash-field">
              <span className="dash-field__label">ขั้นต่ำต่อการจอง (ชม.)</span>
              <input
                type="number"
                min="1"
                className="dash-input"
                value={newFacility.minBookingHours}
                onChange={(e) => setNewFacility((f) => ({ ...f, minBookingHours: e.target.value }))}
              />
            </label>
            <label className="dash-field">
              <span className="dash-field__label">มัดจำ (%)</span>
              <input
                type="number"
                min="0"
                max="100"
                className="dash-input"
                value={newFacility.depositPercent}
                onChange={(e) => setNewFacility((f) => ({ ...f, depositPercent: e.target.value }))}
              />
            </label>
            <label className="dash-field">
              <span className="dash-field__label">คำอธิบาย (ไม่บังคับ)</span>
              <input
                type="text"
                className="dash-input"
                value={newFacility.description}
                onChange={(e) => setNewFacility((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
          </div>
          <p className="pricing-page__hint">
            หลังบันทึกจะเปิดตารางเวลาให้จองล่วงหน้าอัตโนมัติ 70 วัน ตามเวลาเปิด-ปิดของสถานที่ที่เลือก
          </p>
          <div className="pricing-discount-form__actions">
            <button type="button" className="dash-btn" onClick={() => setAddingFacility(false)}>
              ยกเลิก
            </button>
            <button
              type="button"
              className="dash-btn dash-btn--add"
              disabled={savingFacility}
              onClick={handleCreateFacility}
            >
              {savingFacility ? "กำลังบันทึก..." : "เพิ่มสนาม"}
            </button>
          </div>
        </section>
      )}

      {!effectiveFacilityId ? (
        <p className="dash-empty">ยังไม่มีสนามที่เปิดให้จองสำหรับกีฬานี้</p>
      ) : (
        <div className="pricing-page">
          <div className="pricing-page__main">
            <section className="dash-card">
              <h2>ข้อมูลสนาม</h2>
              <p className="pricing-page__hint">
                ชื่อ ที่ตั้ง และราคาพื้นฐาน (ใช้เมื่อไม่มีราคาตามช่วงเวลากำหนดไว้)
              </p>

              {configLoading || !base ? (
                <p className="dash-empty">กำลังโหลดข้อมูล...</p>
              ) : (
                <div className="pricing-page__base-grid">
                  <label className="dash-field">
                    <span className="dash-field__label">ชื่อสนาม</span>
                    <input
                      type="text"
                      className="dash-input"
                      value={base.name}
                      onChange={(e) => setBaseDraft({ ...base, name: e.target.value })}
                    />
                  </label>
                  <label className="dash-field">
                    <span className="dash-field__label">สถานที่</span>
                    <input
                      type="text"
                      className="dash-input"
                      value={base.venueName}
                      onChange={(e) => setBaseDraft({ ...base, venueName: e.target.value })}
                    />
                    <p className="dash-field__hint">มีผลกับทุกสนามในสถานที่เดียวกัน</p>
                  </label>
                  <label className="dash-field">
                    <span className="dash-field__label">ที่อยู่</span>
                    <input
                      type="text"
                      className="dash-input"
                      value={base.venueAddress}
                      onChange={(e) => setBaseDraft({ ...base, venueAddress: e.target.value })}
                    />
                    <p className="dash-field__hint">มีผลกับทุกสนามในสถานที่เดียวกัน</p>
                  </label>
                  <label className="dash-field">
                    <span className="dash-field__label">ราคาต่อชั่วโมง</span>
                    <input
                      type="number"
                      min="0"
                      className="dash-input"
                      value={base.pricePerHour}
                      onChange={(e) =>
                        setBaseDraft({ ...base, pricePerHour: e.target.value })
                      }
                    />
                  </label>
                  <label className="dash-field">
                    <span className="dash-field__label">ขั้นต่ำต่อการจอง (ชม.)</span>
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
                  </label>
                  <label className="dash-field">
                    <span className="dash-field__label">มัดจำ (%)</span>
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
                  </label>
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

            <section className="dash-card">
              <div className="photos-page__section-header">
                <div>
                  <h2>รูปภาพประจำกีฬา</h2>
                  <p className="photos-page__hint">
                    ใช้เป็นรูปของ &quot;{effectiveSport?.name ?? "กีฬา"}&quot; บนหน้ารายการกีฬา
                    และเป็นรูปสำรองของสนามที่ยังไม่มีรูปของตัวเอง
                  </p>
                </div>
              </div>

              {sportIconError && (
                <div className="dash-message dash-message--error">{sportIconError}</div>
              )}

              <div className="photos-preview-card" style={{ maxWidth: "320px" }}>
                <div
                  className="photos-preview-card__image"
                  style={effectiveSport?.image ? { backgroundImage: `url(${effectiveSport.image})` } : undefined}
                />
              </div>
              <input
                ref={sportIconInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="photos-page__file-input"
                onChange={(e) => {
                  handleSportIconChange(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  className="dash-btn"
                  disabled={sportIconUploading || !effectiveSportId}
                  onClick={() => sportIconInputRef.current?.click()}
                >
                  {sportIconUploading ? "กำลังอัปโหลด..." : "เปลี่ยนรูปกีฬา"}
                </button>
                <button
                  type="button"
                  className="dash-btn"
                  disabled={!effectiveSport?.image}
                  onClick={() =>
                    setCropTarget({
                      kind: "sport-icon",
                      sportId: effectiveSportId,
                      imageUrl: effectiveSport.image,
                    })
                  }
                >
                  ครอบตัด
                </button>
              </div>
            </section>

            <section className="dash-card" ref={uploaderRef}>
              <h2>อัปโหลดรูปภาพ</h2>
              <div
                className={`dash-dropzone photos-page__dropzone ${dragOverDrop ? "photos-page__dropzone--over" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverDrop(true);
                }}
                onDragLeave={() => setDragOverDrop(false)}
                onDrop={handleDropzoneDrop}
              >
                <strong>ลากไฟล์มาวาง หรือคลิกเพื่อเลือกรูป</strong>
                <span>
                  JPG, PNG, WebP · แนะนำ {RECOMMENDED_WIDTH} × {RECOMMENDED_HEIGHT} px (อัตราส่วน 16:9) ·
                  ไม่เกิน 5 MB ต่อไฟล์
                </span>
                <button type="button" className="dash-btn" disabled={uploading}>
                  {uploading ? "กำลังอัปโหลด..." : "เลือกไฟล์"}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="photos-page__file-input"
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </section>

            <section className="dash-card">
              <div className="photos-page__section-header">
                <div>
                  <h2>คลังรูปของสนามนี้</h2>
                  <p className="photos-page__hint">ลากเพื่อจัดลำดับ · รูปแรกจะถูกใช้เป็นหน้าปก</p>
                </div>
              </div>

              {!imagesLoading && images.length === 0 && (
                <p className="dash-empty">ยังไม่มีรูปภาพ อัปโหลดรูปแรกด้านบน</p>
              )}

              <div className="photos-gallery">
                {displayImages.map((image, index) => (
                  <div
                    key={image.id}
                    className={`photos-gallery__item ${dragIndex === index ? "photos-gallery__item--dragging" : ""} ${
                      dragOverIndex === index ? "photos-gallery__item--drag-over" : ""
                    }`}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragEnter={() => {
                      if (dragIndex !== null && index !== dragIndex) setDragOverIndex(index);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleGalleryDrop(index)}
                    onDragEnd={handleGalleryDragEnd}
                  >
                    <div
                      className={`photos-gallery__thumb ${image.isPrimary ? "photos-gallery__thumb--cover" : ""}`}
                      style={{ backgroundImage: `url(${image.imageUrl})` }}
                    >
                      <span className={`photos-gallery__badge ${image.isPrimary ? "photos-gallery__badge--cover" : ""}`}>
                        {image.isPrimary ? "หน้าปก" : index + 1}
                      </span>
                    </div>

                    {editingCaptionId === image.id ? (
                      <input
                        className="dash-input photos-gallery__caption-input"
                        autoFocus
                        value={captionDrafts[image.id] ?? image.caption}
                        onChange={(e) =>
                          setCaptionDrafts((d) => ({ ...d, [image.id]: e.target.value }))
                        }
                        onBlur={() => setEditingCaptionId(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="photos-gallery__caption"
                        onClick={() => setEditingCaptionId(image.id)}
                      >
                        {(captionDrafts[image.id] ?? image.caption) || "เพิ่มคำบรรยาย"}
                      </button>
                    )}

                    <p className="photos-gallery__meta">
                      {image.width && image.height ? `${image.width} × ${image.height} · ` : ""}
                      {formatKb(image.sizeBytes)}
                    </p>

                    <div className="photos-gallery__row-actions">
                      {!image.isPrimary && (
                        <button type="button" className="dash-btn" onClick={() => handleSetPrimary(image)}>
                          ตั้งเป็นหน้าปก
                        </button>
                      )}
                      <button type="button" className="dash-btn" onClick={() => setCropTarget(image)}>
                        ครอบตัด
                      </button>
                      {confirmDeleteId === image.id ? (
                        <>
                          <button type="button" className="dash-btn" onClick={() => setConfirmDeleteId(null)}>
                            ยกเลิก
                          </button>
                          <button
                            type="button"
                            className="dash-btn dash-btn--cancel"
                            onClick={() => handleDeleteImage(image)}
                          >
                            ยืนยันลบ
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="dash-btn dash-btn--cancel"
                          onClick={() => setConfirmDeleteId(image.id)}
                        >
                          ลบ
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
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
                    <X size={14} aria-hidden="true" />
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

            <section className="dash-card">
              <h2>ตัวอย่างการ์ดสนาม</h2>
              <p className="photos-page__hint">แบบที่ลูกค้าเห็นในหน้าเลือกสนาม</p>

              <div className="photos-preview-card">
                <div
                  className="photos-preview-card__image"
                  style={{
                    backgroundImage: `url(${coverImage?.imageUrl ?? selectedFacility?.image})`,
                  }}
                />
                <div className="photos-preview-card__body">
                  <p className="photos-preview-card__name">{selectedFacility?.name ?? "สนาม"}</p>
                  <p className="photos-preview-card__sub">
                    {selectedFacility?.sportName ?? ""}
                    {selectedFacility?.capacity ? ` · ${selectedFacility.capacity} คน` : ""}
                  </p>
                  <div className="photos-preview-card__row">
                    <span className="photos-preview-card__price">
                      {selectedFacility ? `${formatBaht(selectedFacility.pricePerHour)}/ชม.` : ""}
                    </span>
                    <span className="dash-pill dash-pill--active photos-preview-card__cta">เลือก</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="dash-card">
              <h2>ครอบตัดรูป</h2>
              <p className="photos-page__hint">เลือกอัตราส่วนที่จะใช้แสดงผล แล้วกด "ครอบตัด" ที่รูปในคลังด้านบน</p>
              <p className="photos-page__note">อัตราส่วน 16:9 คือค่าที่การ์ดสนามใช้แสดงผล</p>
            </section>

            <section className="dash-card">
              <h2>ข้อกำหนดรูปภาพ</h2>
              <div className="photos-requirements">
                <div className="photos-requirements__row">
                  <span>ขนาดแนะนำ</span>
                  <strong>
                    {RECOMMENDED_WIDTH} × {RECOMMENDED_HEIGHT} px
                  </strong>
                </div>
                <div className="photos-requirements__row">
                  <span>อัตราส่วน</span>
                  <strong>16:9</strong>
                </div>
                <div className="photos-requirements__row">
                  <span>ขนาดไฟล์</span>
                  <strong>ไม่เกิน 5 MB</strong>
                </div>
                <div className="photos-requirements__row">
                  <span>จำนวนรูป</span>
                  <strong>สูงสุด {MAX_IMAGES_PER_FACILITY} รูปต่อสนาม</strong>
                </div>
                <div className="photos-requirements__row">
                  <span>นามสกุล</span>
                  <strong>JPG, PNG, WebP</strong>
                </div>
              </div>
            </section>

            {lowResImages.length > 0 && (
              <section className="photos-warning">
                <p className="photos-warning__title">
                  <TriangleAlert size={15} aria-hidden="true" /> พบรูปความละเอียดต่ำ{" "}
                  {lowResImages.length} รูป
                </p>
                <p className="photos-warning__text">
                  {lowResImages
                    .map((img) => `"${img.caption || "ไม่มีชื่อ"}" (${img.width} × ${img.height} px)`)
                    .join(", ")}{" "}
                  ต่ำกว่าที่แนะนำ อาจแตกเมื่อแสดงบนหน้าจอใหญ่
                </p>
                <button
                  type="button"
                  className="dash-btn photos-warning__btn"
                  onClick={() => {
                    fileInputRef.current?.click();
                    uploaderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  อัปโหลดใหม่
                </button>
              </section>
            )}
          </div>
        </div>
      )}

      {cropTarget && (
        <ImageCropModal
          imageUrl={cropTarget.imageUrl}
          onCancel={() => setCropTarget(null)}
          onConfirm={handleCropConfirm}
        />
      )}
    </DashboardLayout>
  );
}
