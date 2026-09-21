// หน้ารายละเอียด + ยืนยันการแลก
//
// ตัวเลขที่โชว์ในกล่องสรุปด้านขวาเป็นแค่การพรีวิว — การตัดสินใจจริงว่าแลกได้
// ไหมเกิดที่ redeem_reward() ฝั่งเซิร์ฟเวอร์ ซึ่งล็อกแถวและเช็คซ้ำทั้งแต้ม
// สต๊อก โควตา และตัวเลือกอีกรอบ ปุ่มที่ปิดอยู่ตรงนี้จึงเป็นเรื่องของ UX
// ไม่ใช่ด่านความปลอดภัย
import { useState } from "react";
import { ArrowLeft, Check, Gift, TriangleAlert } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AlertDialog from "../components/AlertDialog";
import AppHeader from "../components/AppHeader";
import RewardMedia from "../components/RewardMedia";
import { useAuth } from "../context/useAuth";
import { useReward } from "../hooks/useRewards";
import { describeLimit, formatPoints, redeemReward } from "../lib/rewards";
import { errorMessage } from "../lib/errors";
import "./RewardDetail.css";

const PHONE_LENGTH = 10;

// type="tel" ไม่ได้กันตัวอักษร และ maxLength ก็ไม่ครอบคลุมค่าที่เบราว์เซอร์
// autofill มาให้ — กรองตั้งแต่ตอนเก็บลง state แทน จะได้ไม่มีเบอร์อย่าง
// "081-234-5678 ต่อ 2" หลุดไปอยู่ในใบจัดส่งที่แอดมินต้องโทรตาม
function toPhoneDigits(value) {
  return value.replace(/\D/g, "").slice(0, PHONE_LENGTH);
}

export default function RewardDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, refreshProfile } = useAuth();

  const [reloadKey, setReloadKey] = useState(0);
  const { reward, loading, error } = useReward(id, reloadKey);

  const [option, setOption] = useState("");
  const [method, setMethod] = useState("ship");
  const [recipientName, setRecipientName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirming, setConfirming] = useState(false);
  // สรุปผลของใบที่เพิ่งแลก เก็บเป็นสแนปช็อตตอนแลกสำเร็จ ไม่ใช่อ่านจาก profile
  // ตอนแสดงผล — ยอดใน AuthContext อาจยังโหลดใหม่ไม่เสร็จ (หรือโหลดพลาด)
  // กล่อง "แลกสำเร็จ" จะได้ไม่โชว์แต้มคงเหลือเป็นยอดก่อนตัด
  const [done, setDone] = useState(null);

  const points = profile?.points ?? 0;

  // มีของรางวัลอยู่แล้วก็แสดงต่อระหว่างโหลดรอบใหม่ (bump reloadKey หลังแลก) —
  // ไม่งั้นทั้งหน้าจะกลายเป็นข้อความ "กำลังโหลด" พร้อมพากล่องแจ้งผลหายไปด้วย
  if (loading && !reward) {
    return (
      <div className="reward-detail">
        <AppHeader />
        <main className="reward-detail__main">
          <p className="reward-detail__empty">กำลังโหลดของรางวัล...</p>
        </main>
      </div>
    );
  }

  if (error || !reward) {
    return (
      <div className="reward-detail">
        <AppHeader />
        <main className="reward-detail__main">
          <Link to="/rewards" className="reward-detail__back">
            <ArrowLeft size={15} aria-hidden="true" /> กลับสู่หน้าแลกรางวัล
          </Link>
          <p className="reward-detail__empty">{error || "ไม่พบของรางวัลนี้"}</p>
        </main>
      </div>
    );
  }

  const limit = describeLimit(reward);
  const after = points - reward.pointsRequired;
  const affordable = after >= 0;

  // เงื่อนไขชุดเดียวกับที่ redeem_reward() เช็คฝั่งเซิร์ฟเวอร์ — เช็คซ้ำตรงนี้
  // เพื่อปิดปุ่มไว้ก่อน ผู้ใช้จะได้ไม่ต้องกดแล้วเจอ error ว่ายังไม่ได้เลือกไซซ์
  // หรือยังกรอกที่อยู่ไม่ครบ
  const needsOption = reward.options.length > 0 && !option;
  const shipping = reward.requiresShipping && method === "ship";
  const needsAddress = shipping && !(recipientName.trim() && phone && address.trim());
  const badPhone = shipping && phone.length > 0 && phone.length !== PHONE_LENGTH;

  const blocked = !affordable || limit.soldOut || needsOption || needsAddress || badPhone;

  const ctaLabel = limit.soldOut
    ? "ของรางวัลหมดแล้ว"
    : !affordable
      ? "แต้มไม่เพียงพอ"
      : needsOption
        ? "กรุณาเลือกตัวเลือกก่อน"
        : needsAddress
          ? "กรอกข้อมูลจัดส่งให้ครบ"
          : badPhone
            ? "เบอร์โทรต้องเป็นตัวเลข 10 หลัก"
            : "ยืนยันการแลกรางวัล";

  async function handleRedeem() {
    setFormError("");
    setBusy(true);

    let row;

    // แยก try ของ "การแลก" ออกจากทุกอย่างที่ทำหลังแลกสำเร็จ — ถ้ารวมไว้ก้อน
    // เดียว แล้ว refreshProfile() พังเพราะเน็ตกระตุก ผู้ใช้จะเห็นข้อความว่า
    // ผิดพลาดทั้งที่แต้มถูกตัดและคูปองออกให้แล้ว แล้วกดแลกซ้ำจนเสียแต้มสองรอบ
    try {
      row = await redeemReward(reward.id, {
        option,
        deliveryMethod: reward.requiresShipping ? method : null,
        recipientName,
        phone,
        address,
      });
    } catch (err) {
      console.error("redeemReward failed:", err);
      setFormError(errorMessage(err));
      setBusy(false);
      return;
    }

    // แต้มใน AuthContext เป็นค่าที่โหลดมาตอน login — ถ้าไม่สั่งโหลดใหม่
    // ตัวเลขบนหัวเว็บกับหน้าแลกรางวัลจะยังเป็นยอดก่อนแลกจนกว่าจะรีเฟรช
    //
    // ล้มเหลวก็ไม่เป็นไร ยอดจะตรงเองรอบหน้าที่โหลดโปรไฟล์ — สิ่งที่ห้ามเกิดคือ
    // การพาผู้ใช้ไปหน้าที่บอกว่าแลกไม่สำเร็จทั้งที่สำเร็จแล้ว
    try {
      await refreshProfile();
    } catch (err) {
      console.error("refreshProfile after redeem failed:", err);
    }

    // ไม่พาไปหน้าประวัติเองทันที — บอกผลตรงนี้ก่อนพร้อมรหัสคูปอง แล้วให้ผู้ใช้
    // เลือกว่าจะไปดูคูปองต่อหรืออยู่หน้าเดิม
    setBusy(false);
    setConfirming(false);
    setDone({ code: row.redemption_code, remaining: after });

    // ดึงของรางวัลใหม่ด้วย — ผู้ใช้ที่ปิดกล่องแล้วอยู่หน้าเดิมจะได้เห็นยอดคงเหลือ
    // และโควตาต่อเดือนตามจริง ไม่ใช่ตัวเลขก่อนแลกที่ทำให้กดแลกซ้ำแล้วโดน
    // redeem_reward() ปฏิเสธ
    setReloadKey((key) => key + 1);
  }

  return (
    <div className="reward-detail">
      <AppHeader />

      <main className="reward-detail__main">
        <Link to="/rewards" className="reward-detail__back">
          <ArrowLeft size={15} aria-hidden="true" /> กลับสู่หน้าแลกรางวัล
        </Link>

        <div className="reward-detail__layout">
          <article className="reward-detail__card">
            <div className="reward-detail__media">
              <RewardMedia reward={reward} size={140} />
            </div>

            <div className="reward-detail__body">
              <span className="reward-detail__category">{reward.categoryLabel}</span>

              <h1 className="reward-detail__name">{reward.name}</h1>
              <p className="reward-detail__desc">{reward.description}</p>

              <hr className="reward-detail__divider" />

              <dl className="reward-detail__facts">
                <div className="reward-detail__fact">
                  <dt>ระยะเวลาใช้งาน</dt>
                  <dd>{reward.validDays} วันหลังแลก</dd>
                </div>
                {reward.terms && (
                  <div className="reward-detail__fact">
                    <dt>เงื่อนไข</dt>
                    <dd>{reward.terms}</dd>
                  </div>
                )}
                <div className="reward-detail__fact">
                  <dt>คงเหลือ</dt>
                  <dd>{limit.label}</dd>
                </div>
              </dl>
            </div>
          </article>

          <aside className="reward-detail__summary">
            <h2 className="reward-detail__summary-title">ยืนยันการแลกรางวัล</h2>

            <div className="reward-detail__balance">
              <span>แต้มคงเหลือปัจจุบัน</span>
              <strong>{formatPoints(points)}</strong>
            </div>

            <div className="reward-detail__row">
              <span>ใช้แต้มแลก</span>
              <span className="reward-detail__rule" aria-hidden="true" />
              <strong>-{formatPoints(reward.pointsRequired)} แต้ม</strong>
            </div>

            <hr className="reward-detail__divider" />

            <div className="reward-detail__row reward-detail__row--total">
              <strong>แต้มคงเหลือหลังแลก</strong>
              <span className="reward-detail__rule" aria-hidden="true" />
              <strong className={affordable ? "" : "reward-detail__negative"}>
                {affordable ? "" : "−"}
                {formatPoints(Math.abs(after))} แต้ม
              </strong>
            </div>

            {/* ตัวเลือก (ไซซ์) — บังคับเลือกก่อน เพราะ RPC จะปฏิเสธถ้าไม่ส่งมา */}
            {reward.options.length > 0 && (
              <fieldset className="reward-detail__field">
                <legend>เลือกตัวเลือก</legend>
                <div className="reward-detail__options">
                  {reward.options.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`reward-detail__option ${
                        option === value ? "reward-detail__option--active" : ""
                      }`}
                      onClick={() => setOption(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {/* ที่อยู่จัดส่ง — เฉพาะของรางวัลที่เป็นของจริง */}
            {reward.requiresShipping && (
              <div className="reward-detail__shipping">
                <div className="reward-detail__options">
                  <button
                    type="button"
                    className={`reward-detail__option ${
                      method === "ship" ? "reward-detail__option--active" : ""
                    }`}
                    onClick={() => setMethod("ship")}
                  >
                    จัดส่งตามที่อยู่
                  </button>
                  <button
                    type="button"
                    className={`reward-detail__option ${
                      method === "pickup" ? "reward-detail__option--active" : ""
                    }`}
                    onClick={() => setMethod("pickup")}
                  >
                    รับเองที่สนาม
                  </button>
                </div>

                {method === "ship" ? (
                  <>
                    <label className="reward-detail__field">
                      <span>ชื่อผู้รับ</span>
                      <input
                        type="text"
                        className="reward-detail__input"
                        value={recipientName}
                        onChange={(e) => setRecipientName(e.target.value)}
                      />
                    </label>
                    <label className="reward-detail__field">
                      <span>เบอร์โทรติดต่อ</span>
                      <input
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        maxLength={PHONE_LENGTH}
                        className="reward-detail__input"
                        value={phone}
                        onChange={(e) => setPhone(toPhoneDigits(e.target.value))}
                      />
                    </label>
                    <label className="reward-detail__field">
                      <span>ที่อยู่จัดส่ง</span>
                      <textarea
                        className="reward-detail__input reward-detail__textarea"
                        rows={3}
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <p className="reward-detail__note">
                    เจ้าหน้าที่จะติดต่อนัดวันรับของที่สนาม กรุณามารับภายใน 30 วันหลังแลก
                  </p>
                )}
              </div>
            )}

            {!affordable && (
              <p className="reward-detail__warn">
                <TriangleAlert size={15} aria-hidden="true" /> แต้มของคุณไม่พอสำหรับของรางวัลนี้
              </p>
            )}
            {limit.soldOut && (
              <p className="reward-detail__warn">
                <TriangleAlert size={15} aria-hidden="true" /> ของรางวัลนี้หมดแล้ว ลองดูรางวัลชิ้นอื่น
              </p>
            )}
            {formError && <p className="reward-detail__error">{formError}</p>}

            <button
              type="button"
              className="reward-detail__cta"
              disabled={blocked || busy}
              onClick={() => {
                setFormError("");
                setConfirming(true);
              }}
            >
              {busy ? "กำลังแลก..." : ctaLabel}
            </button>

            <p className="reward-detail__note">
              แต้มที่ใช้แลกแล้วไม่สามารถขอคืนได้ คูปองจะถูกส่งไปที่ประวัติการแลกรางวัลทันที
            </p>
          </aside>
        </div>
      </main>

      {confirming && (
        <AlertDialog
          icon={<Gift size={26} aria-hidden="true" />}
          title="ยืนยันการแลกรางวัล"
          description="แต้มจะถูกตัดทันทีที่กดยืนยัน และขอคืนไม่ได้ไม่ว่ากรณีใด"
          facts={[
            { label: "ของรางวัล", value: reward.name },
            ...(option ? [{ label: "ตัวเลือก", value: option }] : []),
            ...(reward.requiresShipping
              ? [{ label: "วิธีรับของ", value: method === "ship" ? "จัดส่งตามที่อยู่" : "รับเองที่สนาม" }]
              : []),
            { label: "ใช้แต้ม", value: `${formatPoints(reward.pointsRequired)} แต้ม` },
            { label: "แต้มคงเหลือ", value: `${formatPoints(after)} แต้ม` },
          ]}
          error={formError}
          busy={busy}
          confirmLabel={busy ? "กำลังแลก..." : "ยืนยันการแลก"}
          cancelLabel="ยกเลิก"
          onConfirm={handleRedeem}
          onClose={() => setConfirming(false)}
        />
      )}

      {done && (
        <AlertDialog
          tone="success"
          icon={<Check size={26} aria-hidden="true" />}
          title="แลกรางวัลสำเร็จ"
          description="เก็บรหัสคูปองนี้ไว้ยื่นให้เจ้าหน้าที่ ดูซ้ำหรือเปิด QR ได้ทุกเมื่อในประวัติการแลกรางวัล"
          facts={[
            { label: "รหัสคูปอง", value: done.code },
            { label: "แต้มคงเหลือ", value: `${formatPoints(done.remaining)} แต้ม` },
          ]}
          confirmLabel="ดูคูปองของฉัน"
          cancelLabel="ปิด"
          onConfirm={() => navigate(`/rewards/history?code=${done.code}`)}
          onClose={() => setDone(null)}
        />
      )}
    </div>
  );
}
