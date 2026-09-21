// ประวัติการแลกรางวัลของลูกค้าเอง — redemptions_select_own (0000) กันไม่ให้
// เห็นของคนอื่นอยู่แล้ว ฝั่งนี้กรองแค่ตามสถานะที่ผู้ใช้เลือก
//
// ?code=... มาจากหน้า RewardDetail หลังแลกสำเร็จ ใช้ไฮไลต์คูปองใบที่เพิ่งได้
// ไม่ให้ต้องไล่หาเองในรายการที่ยาวขึ้นเรื่อย ๆ
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Camera,
  Check,
  Copy,
  Package,
  QrCode,
  ReceiptText,
  RefreshCw,
  Truck,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import RewardMedia from "../components/RewardMedia";
import { Pagination } from "../components/DashboardWidgets";
import RewardPassDialog from "../components/RewardPassDialog";
import { useAuth } from "../context/useAuth";
import { useMyRedemptions, useShipmentEvents } from "../hooks/useRewards";
import {
  HISTORY_FILTERS,
  PICKUP_TIMELINE,
  SHIPPING_TIMELINE,
  canConfirmReceipt,
  confirmRedemptionReceived,
  describeRedemptionState,
  formatPoints,
  formatRewardDate,
  fulfillmentLabel,
  fulfillmentStep,
  isPickupRedemption,
  isShippedRedemption,
  redemptionState,
  uploadRedemptionReceipt,
} from "../lib/rewards";
import { assertImageFile } from "../lib/uploads";
import { errorMessage } from "../lib/errors";
import "./RewardHistory.css";

// บรรทัดที่สามของแต่ละแถวเปลี่ยนไปตามสถานะ — แบบใน Figma โชว์คนละอย่างกัน
// ทั้งสี่แถว (วันหมดอายุ / วันที่ใช้ / หมดอายุไปแล้วเมื่อไหร่ / สถานะจัดส่ง)
function describeDetail(item, state) {
  if (state === "cancelled") {
    return item.cancelReason ? `ยกเลิกแล้ว · ${item.cancelReason}` : "ยกเลิกแล้ว";
  }

  if (item.fulfillmentStatus) {
    const parts = [fulfillmentLabel(item.fulfillmentStatus)];
    if (item.optionLabel) parts.push(`ไซซ์ ${item.optionLabel}`);
    if (item.trackingNumber) parts.push(`เลขพัสดุ ${item.trackingNumber}`);
    return parts.join(" · ");
  }

  if (state === "used") {
    // used_note ถูกเขียนอัตโนมัติตอนเงินเข้า (0049) ว่าใช้กับการจองไหน สนามอะไร
    return item.usedNote || `ใช้เมื่อ ${formatRewardDate(item.usedAt)}`;
  }

  if (state === "expired") return `หมดอายุแล้วเมื่อ ${formatRewardDate(item.expiresAt)}`;

  return `หมดอายุ ${formatRewardDate(item.expiresAt)}`;
}

// ปุ่มคัดลอกรหัส — รหัสคูปองคือของชิ้นเดียวที่ลูกค้าต้องเอาไปใช้จริง เดิมต้อง
// ลากเมาส์คลุมเอาเอง ซึ่งบนมือถือแทบเป็นไปไม่ได้
function CopyCode({ code }) {
  const [copied, setCopied] = useState(false);

  // ล้าง timer ตอนถูกถอดออกจากหน้า — เปลี่ยนหน้า/เปลี่ยนตัวกรองภายในสองวินาที
  // หลังกดคัดลอก จะเหลือ timer ที่สั่ง setState ให้คอมโพเนนต์ที่ไม่อยู่แล้ว
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch (err) {
      // บางเบราว์เซอร์บล็อก clipboard เมื่อไม่ได้อยู่บน https — ไม่ใช่เรื่อง
      // คอขวด ปล่อยให้ผู้ใช้เลือกข้อความเองแทน
      console.error("คัดลอกรหัสคูปองไม่สำเร็จ:", err);
    }
  }

  return (
    <button type="button" className="reward-history__copy" onClick={handleCopy}>
      {copied ? (
        <>
          <Check size={15} aria-hidden="true" /> คัดลอกแล้ว
        </>
      ) : (
        <>
          <Copy size={15} aria-hidden="true" /> คัดลอกรหัส
        </>
      )}
    </button>
  );
}

// แผงติดตามการจัดส่ง — กางออกเฉพาะใบที่ผู้ใช้กดดู เพราะคูปองส่วนลดส่วนใหญ่
// ไม่มีการจัดส่งเลย ดึงไทม์ไลน์มาทุกใบตั้งแต่โหลดหน้าจึงเปลืองเปล่า ๆ
function ShippingPanel({ item, onConfirmed }) {
  const { events, loading } = useShipmentEvents(item.id);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const [proofFile, setProofFile] = useState(null);
  const [proofPreview, setProofPreview] = useState("");

  const isPickup = isPickupRedemption(item);
  // ช่องแนบรูปมีเฉพาะของที่ส่งเป็นพัสดุ — ของที่มารับเองที่สนามเจ้าหน้าที่
  // ส่งมอบกับมืออยู่แล้ว ไม่มีอะไรต้องพิสูจน์
  //
  // แนบหรือไม่แนบก็ยืนยันได้ (0086) รูปมีไว้เผื่อมีปัญหาเรื่องของทีหลัง ไม่ใช่
  // ด่านที่ขวางไม่ให้ปิดรายการ — คนที่แกะกล่องทิ้งไปแล้วก็ต้องกดยืนยันได้
  const canAttachProof = isShippedRedemption(item);
  const timeline = isPickup ? PICKUP_TIMELINE : SHIPPING_TIMELINE;
  const current = fulfillmentStep(item.fulfillmentStatus);

  useEffect(() => {
    if (!proofPreview) return undefined;
    return () => URL.revokeObjectURL(proofPreview);
  }, [proofPreview]);

  function handlePickProof(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // เช็คชนิด/ขนาดตั้งแต่ตอนเลือก ไม่ปล่อยให้รู้ตัวหลังรออัปโหลดจนจบ
      assertImageFile(file);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }

    setError("");
    setProofFile(file);
    setProofPreview(URL.createObjectURL(file));
  }

  async function handleConfirm() {
    setConfirming(true);
    setError("");

    try {
      // อัปโหลดก่อน แล้วค่อยส่ง path เข้า RPC — ถ้าอัปโหลดพลาด สถานะยังไม่ถูก
      // เปลี่ยน ลูกค้ากดใหม่ได้เลยโดยไม่มีใบที่ยืนยันแล้วแต่ไม่มีหลักฐานค้างอยู่
      const proofPath = proofFile ? await uploadRedemptionReceipt(proofFile, item.id) : null;

      await confirmRedemptionReceived(item.id, { proofPath });
      onConfirmed();
    } catch (err) {
      console.error("ยืนยันรับของรางวัลไม่สำเร็จ:", err);
      setError(errorMessage(err));
      setConfirming(false);
    }
  }

  return (
    <div className="reward-history__shipping">
      <ol className="reward-track">
        {timeline.map((step) => {
          const done = current >= fulfillmentStep(step.key);
          const active = item.fulfillmentStatus === step.key;

          return (
            <li
              key={step.key}
              className={`reward-track__step ${done ? "reward-track__step--done" : ""} ${
                active ? "reward-track__step--now" : ""
              }`}
            >
              <span className="reward-track__dot" aria-hidden="true" />
              <span className="reward-track__label">{step.label}</span>
            </li>
          );
        })}
      </ol>

      <dl className="reward-track__meta">
        {item.carrier && (
          <>
            <dt>ขนส่งโดย</dt>
            <dd>{item.carrier}</dd>
          </>
        )}
        {item.trackingNumber && (
          <>
            <dt>เลขติดตามพัสดุ</dt>
            <dd className="reward-track__code">{item.trackingNumber}</dd>
          </>
        )}
        {item.recipientName && (
          <>
            <dt>ผู้รับ</dt>
            <dd>
              {item.recipientName}
              {item.phone ? ` · ${item.phone}` : ""}
            </dd>
          </>
        )}
        {item.address && (
          <>
            <dt>ที่อยู่จัดส่ง</dt>
            <dd>{item.address}</dd>
          </>
        )}
        {item.shippedAt && (
          <>
            <dt>ส่งออกเมื่อ</dt>
            <dd>{formatRewardDate(item.shippedAt)}</dd>
          </>
        )}
        {item.receivedAt && (
          <>
            <dt>ยืนยันรับของเมื่อ</dt>
            <dd>{formatRewardDate(item.receivedAt)}</dd>
          </>
        )}
      </dl>

      {item.shippingNote && <p className="reward-track__note">{item.shippingNote}</p>}

      {loading && <p className="reward-track__note">กำลังโหลดความเคลื่อนไหวล่าสุด...</p>}

      {events.length > 0 && (
        <ul className="reward-track__log">
          {events.map((event) => (
            <li key={event.id}>
              <span className="reward-track__log-time">{formatRewardDate(event.createdAt)}</span>
              <span className="reward-track__log-label">{event.label}</span>
              {event.note && <span className="reward-track__log-note">{event.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="reward-track__error">{error}</p>}

      {canConfirmReceipt(item) && (
        <div className="reward-track__confirm-box">
          {canAttachProof && (
            <>
              <p className="reward-track__proof-label">
                แนบรูปของที่ได้รับ (ไม่บังคับ) — ถ่ายกล่องพัสดุหรือของที่แกะแล้วก็ได้
                เก็บไว้เป็นหลักฐานหากมีปัญหาภายหลัง
              </p>

              <label className="reward-track__proof-pick">
                <input type="file" accept="image/*" onChange={handlePickProof} />
                <span>
                  {proofFile ? (
                    <>
                      <RefreshCw size={15} aria-hidden="true" /> เปลี่ยนรูป
                    </>
                  ) : (
                    <>
                      <Camera size={15} aria-hidden="true" /> เลือกรูป
                    </>
                  )}
                </span>
              </label>

              {proofPreview && (
                <img
                  src={proofPreview}
                  alt="รูปของรางวัลที่ได้รับ"
                  className="reward-track__proof-preview"
                />
              )}
            </>
          )}

          <button
            type="button"
            className="reward-track__confirm"
            disabled={confirming}
            onClick={handleConfirm}
          >
            {confirming ? (
              "กำลังยืนยัน..."
            ) : (
              <>
                <Check size={15} aria-hidden="true" /> ยืนยันว่าได้รับของรางวัลแล้ว
              </>
            )}
          </button>
        </div>
      )}

      {item.fulfillmentStatus === "received" && (
        <p className="reward-track__done">คุณยืนยันการรับของรางวัลนี้แล้ว ขอบคุณครับ/ค่ะ</p>
      )}
    </div>
  );
}

export default function RewardHistory() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [passItem, setPassItem] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const highlight = params.get("code");
  const { redemptions, hasMore, loading, error } = useMyRedemptions(user?.id, page, reloadKey);

  function handleConfirmed() {
    setOpenId(null);
    setReloadKey((key) => key + 1);
  }

  // กรองสถานะฝั่งหน้าเว็บ เพราะ "หมดอายุ" ไม่ใช่ค่าที่เก็บในฐานข้อมูล (ดู
  // redemptionState) — กรองทับผลของหน้านั้น ๆ ไม่ใช่ทั้งตาราง
  const visible = useMemo(
    () => (filter ? redemptions.filter((r) => redemptionState(r) === filter) : redemptions),
    [redemptions, filter],
  );

  function switchFilter(key) {
    setFilter(key);
    setPage(1);
  }

  return (
    <div className="reward-history">
      <AppHeader />

      <main className="reward-history__main">
        {/* หน้านี้เข้ามาได้ทั้งจากหน้าแลกรางวัลและจากกล่อง "แลกสำเร็จ" — พาไป
            /rewards ตรง ๆ แทน navigate(-1) เพราะทางหลังจะเด้งกลับไปหน้ารายละเอียด
            ของใบที่เพิ่งแลก ซึ่งไม่ใช่ที่ที่ผู้ใช้ตั้งใจจะกลับไป */}
        <Link to="/rewards" className="reward-history__back">
          <ArrowLeft size={15} aria-hidden="true" /> กลับสู่หน้าแลกรางวัล
        </Link>

        <h1 className="reward-history__title">ประวัติการแลกรางวัล</h1>
        <p className="reward-history__intro">รายการคูปองและของรางวัลที่คุณเคยแลกไว้ทั้งหมด</p>

        <nav className="reward-history__tabs" aria-label="กรองตามสถานะคูปอง">
          {HISTORY_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`reward-history__tab ${
                item.key === filter ? "reward-history__tab--active" : ""
              }`}
              onClick={() => switchFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {loading && <p className="reward-history__empty">กำลังโหลดประวัติ...</p>}
        {!loading && error && <p className="reward-history__empty">{error}</p>}

        {!loading && !error && visible.length === 0 && (
          <div className="reward-history__blank">
            <p className="reward-history__empty">
              {redemptions.length === 0
                ? "คุณยังไม่เคยแลกรางวัล เริ่มใช้แต้มสะสมได้เลย"
                : "ไม่มีคูปองในสถานะนี้บนหน้านี้"}
            </p>
            <Link to="/rewards" className="reward-history__cta">
              ไปหน้าแลกรางวัล
            </Link>
          </div>
        )}

        {!loading && !error && visible.length > 0 && (
          <ol className="reward-history__list">
            {visible.map((item) => {
              const state = redemptionState(item);
              const badge = describeRedemptionState(state);
              // ของที่ส่งถึงบ้านไม่มีอะไรให้ยื่นที่เคาน์เตอร์ — โชว์ QR/รหัสไว้
              // มีแต่จะพาไปต่อคิวหน้าเคาน์เตอร์ฟรี ๆ แล้วโดนปฏิเสธ
              const shipped = isShippedRedemption(item);
              // ของถึงปลายทางแล้วแต่ยังไม่ได้กดยืนยัน — ทำแถวนี้ให้สะดุดตา
              // เพราะปุ่มยืนยันตัวจริงอยู่ในแผงสถานะที่ต้องกดกางก่อน ลูกค้า
              // ที่ไม่รู้ว่าต้องกดจะปล่อยรายการค้างไว้ทั้งที่ของถึงมือแล้ว
              const awaitingReceipt = canConfirmReceipt(item);

              return (
                <li
                  key={item.id}
                  className={`reward-history__row ${
                    item.code === highlight ? "reward-history__row--new" : ""
                  } ${awaitingReceipt ? "reward-history__row--await" : ""}`}
                >
                  <div className="reward-history__thumb">
                    <RewardMedia
                      reward={{
                        name: item.rewardName,
                        category: item.rewardCategory,
                        imageUrl: item.rewardImage,
                      }}
                      size={40}
                    />
                  </div>

                  <div className="reward-history__info">
                    <p className="reward-history__name">{item.rewardName}</p>
                    <p className="reward-history__meta">
                      รหัสคูปอง: {item.code} · แลกเมื่อ {formatRewardDate(item.createdAt)}
                    </p>
                    <p className="reward-history__detail">{describeDetail(item, state)}</p>

                    {awaitingReceipt && (
                      <p className="reward-history__await">
                        <Package size={15} aria-hidden="true" />{" "}
                        {isPickupRedemption(item) ? "พร้อมให้รับที่สนามแล้ว" : "ส่งถึงแล้ว"} —
                        กรุณากดยืนยันการรับของเพื่อปิดรายการนี้
                      </p>
                    )}
                  </div>

                  <div className="reward-history__side">
                    <p className="reward-history__points">-{formatPoints(item.pointsUsed)} แต้ม</p>
                    <span className={`reward-history__badge reward-history__badge--${badge.tone}`}>
                      {badge.label}
                    </span>
                    {/* QR คือทางหลักที่ลูกค้าใช้รับของ/ใช้คูปองหน้าเคาน์เตอร์ —
                        เปิดเป็นบัตรเต็มจอทีละใบ เพื่อไม่ให้เจ้าหน้าที่สแกนโดน
                        ใบข้างเคียง ส่วนคัดลอกรหัสเก็บไว้เป็นทางสำรอง (สแกนไม่ติด
                        หรือเอาไปกรอกในหน้าชำระเงินเอง) จึงเป็นปุ่มรอง */}
                    {/* ของที่ส่งถึงบ้านไม่มี QR ให้ยื่น แต่ยังต้องดูรหัสกับ
                        รายละเอียดของใบตัวเองได้ (ไว้อ้างอิงตอนถามเจ้าหน้าที่
                        เรื่องพัสดุ) — กล่องเดียวกัน คนละเนื้อหา */}
                    {state === "unused" && (
                      <button
                        type="button"
                        className={
                          shipped ? "reward-history__detail-toggle" : "reward-history__qr-toggle"
                        }
                        aria-haspopup="dialog"
                        onClick={() => setPassItem(item)}
                      >
                        {shipped ? (
                          <>
                            <ReceiptText size={15} aria-hidden="true" /> รายละเอียดการแลก
                          </>
                        ) : (
                          <>
                            <QrCode size={15} aria-hidden="true" /> แสดง QR รับของรางวัล
                          </>
                        )}
                      </button>
                    )}

                    {state === "unused" && <CopyCode code={item.code} />}

                    {/* ของที่ต้องจัดส่ง/มารับเองมีสถานะเป็นของตัวเอง — กางดู
                        ไทม์ไลน์ เลขพัสดุ และกดยืนยันรับของได้จากตรงนี้
                        ของที่นัดรับเองไม่มีพัสดุให้ติดตาม แต่ยังมีขั้นตอนของมัน
                        (กำลังเตรียม → พร้อมให้รับ) กับปุ่มยืนยันว่ารับแล้ว
                        ปุ่มจึงยังอยู่ เปลี่ยนแค่ชื่อให้ตรงกับสิ่งที่อยู่ข้างใน */}
                    {item.fulfillmentStatus && (
                      <button
                        type="button"
                        className={`reward-history__track ${
                          awaitingReceipt && openId !== item.id ? "reward-history__track--cta" : ""
                        }`}
                        aria-expanded={openId === item.id}
                        onClick={() => setOpenId(openId === item.id ? null : item.id)}
                      >
                        {openId === item.id ? (
                          "ซ่อนสถานะ"
                        ) : awaitingReceipt ? (
                          <>
                            <Check size={15} aria-hidden="true" /> ยืนยันรับของ
                          </>
                        ) : isPickupRedemption(item) ? (
                          <>
                            <Building2 size={15} aria-hidden="true" /> สถานะการรับของ
                          </>
                        ) : (
                          <>
                            <Truck size={15} aria-hidden="true" /> ติดตามการจัดส่ง
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {openId === item.id && item.fulfillmentStatus && (
                    <ShippingPanel item={item} onConfirmed={handleConfirmed} />
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {!loading && !error && (page > 1 || hasMore) && (
          <div className="reward-history__pager">
            <Pagination page={page} hasMore={hasMore} onChange={setPage} />
          </div>
        )}
      </main>

      {passItem && <RewardPassDialog item={passItem} onClose={() => setPassItem(null)} />}
    </div>
  );
}
