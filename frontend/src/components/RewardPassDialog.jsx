// บัตรรับของรางวัล — QR + รหัสคูปองของใบเดียวแบบเต็มจอ
//
// โชว์ทีละใบ เต็มจอ พื้นขาว และรวมข้อมูลที่ต้องยืนยันหน้างาน (ของรางวัล ไซซ์
// วันหมดอายุ) ไว้ในจอเดียว เพราะหน้างานจริงเจ้าหน้าที่ต้องสแกนเร็วและต้องไม่
// สแกนผิดใบ
//
// QR เข้ารหัส redemption_code ตรง ๆ — ต้องตรงกับที่หน้าสแกนของแอดมิน
// (AdminRewardScan) คาดหวัง
//
// ใบที่เลือกให้จัดส่งตามที่อยู่ใช้กล่องเดียวกันแต่เป็นโหมด "รายละเอียดการแลก":
// ไม่มี QR (ยื่นที่เคาน์เตอร์ไม่ได้ — 0084 ปฏิเสธไว้ที่ฝั่งเซิร์ฟเวอร์ การโชว์
// QR จึงมีแต่จะพาลูกค้าไปต่อคิวแล้วโดนปฏิเสธ) แต่ยังมีรหัสอ้างอิง ที่อยู่ผู้รับ
// และเลขพัสดุครบ เพราะนั่นคือสิ่งที่ลูกค้าต้องใช้ตอนถามเจ้าหน้าที่เรื่องของ
import { useEffect, useState } from "react";
import RewardMedia from "./RewardMedia";
import { generateQrDataUrl } from "../lib/qr";
import {
  formatPoints,
  formatRewardDate,
  fulfillmentLabel,
  isPickupRedemption,
  isShippedRedemption,
} from "../lib/rewards";
import "./RewardPassDialog.css";

// ขอรูปใหญ่กว่าที่แสดงจริงราวเท่าตัว — จอมือถือความหนาแน่นสูงจะได้ไม่เห็นขอบ
// โมดูลเบลอ ซึ่งเป็นสาเหตุที่กล้องอ่าน QR ไม่ติดบ่อยที่สุด
const QR_OPTIONS = { width: 720 };

// เตือนล่วงหน้าหนึ่งสัปดาห์ — ของรางวัลที่ต้องมารับที่สนามต้องเผื่อเวลาให้
// ลูกค้าหาวันว่างมาได้ก่อนคูปองหมดอายุ
const EXPIRY_WARN_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(value) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / DAY_MS);
}

export default function RewardPassDialog({ item, onClose }) {
  const [dataUrl, setDataUrl] = useState("");
  const [qrError, setQrError] = useState("");
  const [copied, setCopied] = useState(false);

  const shipped = isShippedRedemption(item);

  useEffect(() => {
    if (shipped) return undefined;

    let alive = true;

    generateQrDataUrl(item.code, QR_OPTIONS)
      .then((url) => {
        if (alive) setDataUrl(url);
      })
      .catch((err) => {
        console.error("generateQrDataUrl failed:", err);
        // รหัสที่พิมพ์ไว้ใต้ QR ใช้แจ้งปากเปล่าได้อยู่แล้ว กล่องจึงยังมีประโยชน์
        // แม้สร้างรูปไม่สำเร็จ — บอกให้ชัดว่าให้ใช้ทางไหนแทน
        if (alive) setQrError("สร้าง QR ไม่สำเร็จ — แจ้งรหัสคูปองด้านล่างให้เจ้าหน้าที่แทนได้");
      });

    return () => {
      alive = false;
    };
  }, [item.code, shipped]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // ล็อกการเลื่อนของหน้าที่อยู่ข้างหลัง — บนมือถือการปัดบนกล่องที่เลื่อนไม่ได้
  // จะไปเลื่อนรายการข้างหลังแทน พอปิดกล่องกลับมาจะหลงว่าอยู่ตรงไหนของประวัติ
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // คืนโฟกัสให้ปุ่มที่เปิดบัตรตอนปิด — ไม่งั้นโฟกัสตกไปที่ body คนที่ใช้
  // คีย์บอร์ดหรือโปรแกรมอ่านหน้าจอจะต้องไล่แท็บจากหัวหน้าใหม่ทุกครั้ง
  useEffect(() => {
    const opener = document.activeElement;
    return () => opener?.focus?.();
  }, []);

  // กันจอดับระหว่างยื่นให้เจ้าหน้าที่สแกน — คิวหน้าเคาน์เตอร์กินเวลาเกิน
  // timeout ของจอได้ง่าย และจอที่ดับไปแล้วต้องปลดล็อกใหม่ทั้งที่ QR ค้างอยู่
  //
  // เบราว์เซอร์ที่ไม่รองรับหรือปฏิเสธ (แท็บไม่ได้อยู่หน้าจอ) ไม่ใช่ความผิดพลาด
  // ที่ต้องบอกผู้ใช้ — ปล่อยให้จอทำงานตามปกติไป
  useEffect(() => {
    let sentinel = null;
    let cancelled = false;

    navigator.wakeLock
      ?.request("screen")
      .then((lock) => {
        if (cancelled) lock.release().catch(() => {});
        else sentinel = lock;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      sentinel?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(item.code);
      setCopied(true);
    } catch (err) {
      // บางเบราว์เซอร์บล็อก clipboard เมื่อไม่ได้อยู่บน https — รหัสยังอยู่บนจอ
      // ให้ผู้ใช้เลือกเองได้ ไม่ต้องขัดจังหวะด้วย error
      console.error("คัดลอกรหัสคูปองไม่สำเร็จ:", err);
    }
  }

  const left = daysUntil(item.expiresAt);
  const expiringSoon = left !== null && left >= 0 && left <= EXPIRY_WARN_DAYS;
  const isPickup = isPickupRedemption(item);

  return (
    <div
      className="reward-pass__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="reward-pass"
        role="dialog"
        aria-modal="true"
        aria-label={
          shipped
            ? `รายละเอียดการแลก ${item.rewardName}`
            : `บัตรรับของรางวัล ${item.rewardName}`
        }
      >
        <header className="reward-pass__head">
          {/* RewardMedia ยืดเต็มกล่องที่ครอบมันเสมอ (รูปจริงใช้ object-fit
              cover) — ต้องมีกรอบขนาดคงที่ให้ ไม่งั้นรูปของรางวัลจะกินความกว้าง
              ทั้งหัวบัตรจนชื่อถูกบีบเหลือทีละตัวอักษร */}
          <div className="reward-pass__thumb">
            <RewardMedia
              reward={{
                name: item.rewardName,
                category: item.rewardCategory,
                imageUrl: item.rewardImage,
              }}
              size={28}
            />
          </div>
          <div className="reward-pass__title">
            <h2>{item.rewardName}</h2>
            <p>
              {shipped
                ? "จัดส่งถึงที่อยู่ที่คุณกรอกไว้"
                : isPickup
                  ? "รับของที่สนาม"
                  : "ยื่นให้เจ้าหน้าที่ที่เคาน์เตอร์"}
            </p>
          </div>
          <button
            type="button"
            className="reward-pass__close"
            onClick={onClose}
            aria-label={shipped ? "ปิดรายละเอียดการแลก" : "ปิดบัตรรับของรางวัล"}
            autoFocus
          >
            ✕
          </button>
        </header>

        <div className="reward-pass__body">
          {shipped ? (
            <div className="reward-pass__ship">
              <span className="reward-pass__ship-icon" aria-hidden="true">
                🚚
              </span>
              <p className="reward-pass__ship-status">{fulfillmentLabel(item.fulfillmentStatus)}</p>
              <p className="reward-pass__ship-text">
                ของชิ้นนี้จะถูกส่งไปตามที่อยู่ด้านล่าง ไม่ต้องมารับที่สนาม
              </p>
            </div>
          ) : (
            <div className="reward-pass__qr">
              {qrError ? (
                <p className="reward-pass__qr-error">{qrError}</p>
              ) : dataUrl ? (
                <img src={dataUrl} alt={`QR รับของรางวัล ${item.code}`} />
              ) : (
                <p className="reward-pass__qr-loading">กำลังสร้าง QR...</p>
              )}
            </div>
          )}

          <p className="reward-pass__code-label">
            {shipped ? "รหัสอ้างอิงการแลก" : "รหัสคูปอง"}
          </p>
          {/* ตัวใหญ่พอให้เจ้าหน้าที่อ่านจากอีกฝั่งเคาน์เตอร์แล้วพิมพ์เองได้
              ตอนสแกนไม่ติด — เว้นระยะตัวอักษรกัน 0/O และ 1/I อ่านสลับกัน */}
          <p className="reward-pass__code">{item.code}</p>

          <div className="reward-pass__actions">
            <button type="button" className="reward-pass__action" onClick={handleCopy}>
              {copied ? "✓ คัดลอกแล้ว" : "⧉ คัดลอกรหัส"}
            </button>
            {!shipped && dataUrl && (
              // เก็บ QR ไว้ในคลังรูปได้ เผื่อหน้างานเน็ตไม่มีหรือเข้าเว็บไม่ได้
              <a
                className="reward-pass__action"
                href={dataUrl}
                download={`${item.code}.png`}
              >
                ⤓ บันทึกรูป QR
              </a>
            )}
          </div>

          {expiringSoon && (
            <p className="reward-pass__warn">
              ⚠ เหลือเวลาใช้อีก {left === 0 ? "วันนี้วันสุดท้าย" : `${left} วัน`} · หมดอายุ{" "}
              {formatRewardDate(item.expiresAt)}
            </p>
          )}

          <dl className="reward-pass__facts">
            {item.optionLabel && (
              <>
                <dt>ตัวเลือก</dt>
                <dd>{item.optionLabel}</dd>
              </>
            )}
            <dt>แลกเมื่อ</dt>
            <dd>{formatRewardDate(item.createdAt)}</dd>
            <dt>{shipped ? "หมดอายุ" : "ใช้ได้ถึง"}</dt>
            <dd>{formatRewardDate(item.expiresAt)}</dd>
            <dt>แต้มที่ใช้</dt>
            <dd>{formatPoints(item.pointsUsed)} แต้ม</dd>

            {/* ข้อมูลจัดส่งอยู่ในกล่องนี้ด้วย ลูกค้าจะได้ตรวจที่อยู่ที่กรอกไว้
                ได้โดยไม่ต้องกางแผงติดตามอีกที */}
            {shipped && item.recipientName && (
              <>
                <dt>ผู้รับ</dt>
                <dd>
                  {item.recipientName}
                  {item.phone ? ` · ${item.phone}` : ""}
                </dd>
              </>
            )}
            {shipped && item.address && (
              <>
                <dt>ที่อยู่จัดส่ง</dt>
                <dd className="reward-pass__address">{item.address}</dd>
              </>
            )}
            {shipped && item.trackingNumber && (
              <>
                <dt>เลขพัสดุ</dt>
                <dd>
                  {item.trackingNumber}
                  {item.carrier ? ` · ${item.carrier}` : ""}
                </dd>
              </>
            )}
          </dl>

          <p className="reward-pass__hint">
            {shipped
              ? "ใช้รหัสนี้อ้างอิงเวลาสอบถามเจ้าหน้าที่เรื่องพัสดุ และกดยืนยันเมื่อได้รับของแล้วที่ปุ่มสถานะการจัดส่งในหน้าประวัติ"
              : "เจ้าหน้าที่จะสแกน QR นี้เพื่อตัดสิทธิ์รับของรางวัล ใช้ได้ครั้งเดียวเท่านั้น จึงไม่ควรส่งต่อรหัสให้คนอื่น"}
          </p>
        </div>
      </div>
    </div>
  );
}
