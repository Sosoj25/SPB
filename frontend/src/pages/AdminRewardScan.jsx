// หน้าสแกนรับของรางวัลที่เคาน์เตอร์ — ค้นรหัส ดูรายละเอียด แล้วกดยืนยันตัดสิทธิ์
import { useEffect, useRef, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Badge } from "../components/DashboardWidgets";
import RewardMedia from "../components/RewardMedia";
import {
  describeRedemptionState,
  fetchRedemptionByCode,
  formatPoints,
  formatRewardDate,
  isShippedRedemption,
  markCouponUsed,
} from "../lib/rewards";
import { errorMessage } from "../lib/errors";
import { playFeedbackTone } from "../lib/feedback";
import "./AdminRewardScan.css";

// สแกนรับของรางวัลหน้าเคาน์เตอร์ — คนละหน้ากับ CouponRedeemBox (ที่ฝังอยู่ใน
// AdminCheckin) ตรงที่หน้านี้ค้นรหัสขึ้นมาโชว์รายละเอียดให้แอดมินเห็นก่อน
// (ชื่อลูกค้า ของรางวัล สถานะ) แล้วค่อยกดยืนยันตัดสิทธิ์ แทนที่จะพิมพ์รหัส
// แล้วตัดทันที — ลดโอกาสตัดผิดใบตอนมีลูกค้าหลายคนรอพร้อมกัน
//
// ใช้รหัสเดียวกับที่หน้า RewardHistory ออก QR ให้ลูกค้า (redemption_code) —
// ไม่มี stream กล้องให้ต่อเหมือนหน้าเช็คอิน เครื่องสแกน QR แบบฮาร์ดแวร์
// (USB/บลูทูธ) ทำงานเป็น keyboard wedge พิมพ์ค่าใส่ช่องค้นหาที่โฟกัสอยู่แล้ว
// ตามด้วย Enter
const RECENT_LIMIT = 5;

export default function AdminRewardScan() {
  const [query, setQuery] = useState("");
  const [hint, setHint] = useState("");
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState(null);
  const [note, setNote] = useState("");
  const [completing, setCompleting] = useState(false);
  const [message, setMessage] = useState(null);
  const [recent, setRecent] = useState([]);

  const searchRef = useRef(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [message]);

  async function runLookup() {
    const code = query.trim();
    if (!code) return;

    // เคลียร์ช่องทันทีที่ยิงค้นหา — เครื่องสแกนพิมพ์ต่อท้ายค่าที่ค้างอยู่
    // การสแกนใบถัดไปจะกลายเป็นรหัสสองใบต่อกันถ้าไม่ล้างก่อน (เหมือน AdminCheckin)
    setQuery("");
    setHint("");
    setSearching(true);

    try {
      const row = await fetchRedemptionByCode(code);
      if (!row) {
        playFeedbackTone(false);
        setHint(`ไม่พบรหัสคูปอง "${code}" ในระบบ`);
        setFound(null);
      } else {
        playFeedbackTone(true);
        setFound(row);
      }
    } catch (err) {
      console.error("fetchRedemptionByCode failed:", err);
      playFeedbackTone(false);
      setHint(errorMessage(err));
      setFound(null);
    } finally {
      setSearching(false);
      searchRef.current?.focus();
    }
  }

  function handleReset() {
    setFound(null);
    setNote("");
    setHint("");
    searchRef.current?.focus();
  }

  async function handleConfirmPickup() {
    if (!found) return;

    setCompleting(true);

    try {
      const row = await markCouponUsed(found.code, note);
      playFeedbackTone(true);
      setMessage({ tone: "success", text: `มอบ "${found.rewardName}" ให้ ${found.customerName} แล้ว` });
      setRecent((prev) =>
        [
          {
            code: row?.redemption_code ?? found.code,
            rewardName: found.rewardName,
            customerName: found.customerName,
            time: new Date(),
          },
          ...prev,
        ].slice(0, RECENT_LIMIT),
      );
      setFound(null);
      setNote("");
    } catch (err) {
      console.error("markCouponUsed failed:", err);
      playFeedbackTone(false);
      setMessage({ tone: "error", text: errorMessage(err) });
    } finally {
      setCompleting(false);
      searchRef.current?.focus();
    }
  }

  const badge = found ? describeRedemptionState(found.usageState) : null;
  // ใบที่เลือกจัดส่งตามที่อยู่ตัดที่เคาน์เตอร์ไม่ได้ — admin_mark_redemption_used()
  // (0084) ปฏิเสธไว้อยู่แล้ว ตรงนี้บอกล่วงหน้าพร้อมบอกว่าต้องไปทำที่ไหนแทน
  // จะได้ไม่ต้องกดจนเจอ error ตอนลูกค้ายืนรออยู่
  const shipped = found ? isShippedRedemption(found) : false;

  return (
    <DashboardLayout
      variant="admin"
      title="สแกนรับของรางวัล"
      subtitle="สแกน QR หรือพิมพ์รหัสคูปองที่เคาน์เตอร์ เพื่อยืนยันว่าลูกค้ารับของรางวัลแล้ว"
    >
      {message && (
        <div className={`dash-message dash-message--${message.tone}`}>{message.text}</div>
      )}

      <div className="admin-reward-scan">
        <div className="admin-reward-scan__main">
          <section className="dash-card admin-reward-scan__scanner">
            <div className="admin-reward-scan__scanner-head">
              <h2>สแกน QR รับของรางวัล</h2>
              <Badge tone="success">● พร้อมรับสัญญาณจากเครื่องสแกน</Badge>
            </div>

            <div className="admin-reward-scan__viewfinder">
              <div className="admin-reward-scan__viewfinder-frame">
                <span className="admin-reward-scan__viewfinder-scanline" />
              </div>
              <p>
                สแกน QR จากหน้าประวัติการแลกรางวัลของลูกค้าด้วยเครื่องสแกน QR
                <br />
                ระบบจะรับค่าเข้าช่องค้นหาด้านล่างให้อัตโนมัติ
              </p>
            </div>

            <div className="admin-reward-scan__divider">
              <span />
              <p>หรือพิมพ์รหัสคูปองเอง</p>
              <span />
            </div>

            <div className="admin-reward-scan__search">
              <label className="admin-reward-scan__search-field">
                <span aria-hidden="true">⌕</span>
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="รหัสคูปอง เช่น SPB-RW-88213"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runLookup()}
                />
              </label>
              <button
                type="button"
                className="admin-reward-scan__search-btn"
                onClick={runLookup}
                disabled={searching}
              >
                {searching ? "กำลังค้นหา..." : "ค้นหา"}
              </button>
            </div>
            {hint && <p className="admin-reward-scan__search-hint">{hint}</p>}
          </section>
        </div>

        <div className="admin-reward-scan__side">
          <section className="dash-card admin-reward-scan__confirm">
            {found ? (
              <>
                <div className="admin-reward-scan__confirm-head">
                  <h2>รายละเอียดคูปอง</h2>
                  <span className={`admin-reward-scan__badge admin-reward-scan__badge--${badge.tone}`}>
                    {badge.label}
                  </span>
                </div>

                <div className="admin-reward-scan__confirm-item">
                  <RewardMedia
                    reward={{
                      name: found.rewardName,
                      category: found.rewardCategory,
                      imageUrl: found.rewardImage,
                    }}
                    size={64}
                  />
                  <div>
                    <p className="admin-reward-scan__confirm-name">{found.rewardName}</p>
                    <p className="admin-reward-scan__confirm-code">{found.code}</p>
                  </div>
                </div>

                <hr className="admin-reward-scan__confirm-divider" />

                <dl className="admin-reward-scan__confirm-facts">
                  <div>
                    <dt>ลูกค้า</dt>
                    <dd>
                      {found.customerName}
                      {found.phone ? ` · ${found.phone}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>แต้มที่ใช้แลก</dt>
                    <dd>{formatPoints(found.pointsUsed)} แต้ม</dd>
                  </div>
                  {found.optionLabel && (
                    <div>
                      <dt>ตัวเลือก</dt>
                      <dd>{found.optionLabel}</dd>
                    </div>
                  )}
                  <div>
                    <dt>แลกเมื่อ</dt>
                    <dd>{formatRewardDate(found.createdAt)}</dd>
                  </div>
                  {found.fulfillmentStatus && (
                    <div>
                      <dt>วิธีรับของ</dt>
                      <dd>{shipped ? "จัดส่งตามที่อยู่" : "รับเองที่สนาม"}</dd>
                    </div>
                  )}
                  {shipped && found.address && (
                    <div>
                      <dt>ที่อยู่จัดส่ง</dt>
                      <dd>{found.address}</dd>
                    </div>
                  )}
                  {found.usageState === "unused" && (
                    <div>
                      <dt>หมดอายุ</dt>
                      <dd>{formatRewardDate(found.expiresAt)}</dd>
                    </div>
                  )}
                  {found.usageState === "used" && (
                    <div>
                      <dt>ใช้ไปแล้วเมื่อ</dt>
                      <dd>{formatRewardDate(found.usedAt)}</dd>
                    </div>
                  )}
                  {found.usageState === "cancelled" && found.cancelReason && (
                    <div>
                      <dt>เหตุผลที่ยกเลิก</dt>
                      <dd>{found.cancelReason}</dd>
                    </div>
                  )}
                </dl>

                {found.usageState === "unused" && shipped ? (
                  <p className="admin-reward-scan__confirm-warning admin-reward-scan__confirm-warning--block">
                    ใบนี้ลูกค้าเลือกให้จัดส่งตามที่อยู่ ตัดสิทธิ์ที่เคาน์เตอร์ไม่ได้ —
                    จัดการต่อที่หน้า "คำขอของรางวัล" (ถ้าลูกค้าขอเปลี่ยนมารับเอง
                    ให้เปลี่ยนสถานะเป็น "นัดรับที่สนาม" ก่อน แล้วสแกนใหม่อีกครั้ง)
                  </p>
                ) : found.usageState === "unused" ? (
                  <>
                    <label className="dash-field">
                      <span className="dash-field__label">บันทึกเพิ่มเติม (ไม่บังคับ)</span>
                      <input
                        type="text"
                        className="dash-input"
                        placeholder="เช่น รับเสื้อไซซ์ L ที่เคาน์เตอร์"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>

                    <button
                      type="button"
                      className="admin-reward-scan__confirm-btn"
                      disabled={completing}
                      onClick={handleConfirmPickup}
                    >
                      {completing ? "กำลังยืนยัน..." : "✓ ยืนยันมอบของรางวัลแล้ว"}
                    </button>
                  </>
                ) : (
                  <p className="admin-reward-scan__confirm-warning">
                    คูปองใบนี้ใช้รับของรางวัลไม่ได้แล้ว
                  </p>
                )}

                <button
                  type="button"
                  className="admin-reward-scan__confirm-cancel"
                  onClick={handleReset}
                >
                  ค้นหาใหม่
                </button>
              </>
            ) : (
              <p className="dash-empty">สแกน QR หรือค้นหาด้วยรหัสคูปองเพื่อดูรายละเอียด</p>
            )}
          </section>

          <section className="dash-card admin-reward-scan__recent">
            <h2>รับของรางวัลล่าสุด</h2>
            {recent.length === 0 && <p className="dash-empty">ยังไม่มีรายการในรอบนี้</p>}
            {recent.map((item) => (
              <div key={`${item.code}-${item.time.getTime()}`} className="admin-reward-scan__recent-row">
                <span>
                  {item.time.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <div>
                  <p className="admin-reward-scan__recent-name">{item.customerName}</p>
                  <p className="admin-reward-scan__recent-detail">{item.rewardName}</p>
                </div>
                <Badge tone="success">✓</Badge>
              </div>
            ))}
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
