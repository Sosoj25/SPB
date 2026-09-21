// หน้าแลกรางวัลของลูกค้า — อ่านจาก view reward_catalog (0047) ที่คำนวณยอด
// คงเหลือของแต่ละรางวัลมาให้แล้ว ฝั่งนี้จึงไม่ต้องรู้ว่าเพดานเป็นสต๊อกหรือ
// โควตาต่อเดือน
//
// แต้มมาจาก profile ใน AuthContext (โหลดพร้อม session อยู่แล้ว) ไม่ยิงคิวรี
// เพิ่ม — หลังกดแลกสำเร็จหน้า RewardDetail จะสั่ง refreshProfile() ให้เลขตรง
import { useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import RewardMedia from "../components/RewardMedia";
import { useAuth } from "../context/useAuth";
import {
  usePendingReceiptCount,
  useRewardCatalog,
  useRewardSettings,
} from "../hooks/useRewards";
import {
  REWARD_CATEGORIES,
  describeLimit,
  formatPoints,
  nextGoal,
} from "../lib/rewards";
import "./Rewards.css";

const TABS = [{ key: "", label: "ทั้งหมด" }, ...REWARD_CATEGORIES];

function RewardCard({ reward, points }) {
  const limit = describeLimit(reward);
  const affordable = points >= reward.pointsRequired;

  // แอดมินเปิดหน้านี้จะเห็นของที่ปิดอยู่ด้วย (rewards_public_read ปล่อยให้เห็น)
  // — ต้องบอกให้ชัดว่าลูกค้าไม่เห็นชิ้นนี้ ไม่ใช่ปล่อยให้ดูเหมือนของปกติแล้ว
  // กดแลกจนเจอ error จาก redeem_reward
  const hidden = !reward.isActive;
  const disabled = hidden || limit.soldOut || !affordable;

  const label = hidden
    ? "ปิดการแลกอยู่"
    : limit.soldOut
      ? "หมดแล้ว"
      : affordable
        ? "แลกเลย"
        : "แต้มไม่พอ";

  return (
    <article className={`reward-card ${hidden ? "reward-card--hidden" : ""}`}>
      <div className="reward-card__media">
        <RewardMedia reward={reward} size={72} />
      </div>

      <div className="reward-card__body">
        <h2 className="reward-card__name">
          {reward.name}
          {hidden && <span className="reward-card__flag">ซ่อนจากลูกค้า</span>}
        </h2>
        <p className="reward-card__desc">{reward.description}</p>

        <div className="reward-card__footer">
          <span className="reward-card__points">
            <Trophy size={14} aria-hidden="true" /> {formatPoints(reward.pointsRequired)} แต้ม
          </span>
          <span className="reward-card__rule" aria-hidden="true" />

          {disabled ? (
            <span className="reward-card__cta reward-card__cta--disabled">{label}</span>
          ) : (
            <Link to={`/rewards/${reward.id}`} className="reward-card__cta">
              {label}
            </Link>
          )}
        </div>

        {reward.limitType !== "unlimited" && (
          <p className="reward-card__limit">{limit.short}</p>
        )}
      </div>
    </article>
  );
}

export default function Rewards() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("");
  const [howToOpen, setHowToOpen] = useState(false);

  const points = profile?.points ?? 0;

  // ดึงทั้งคลังครั้งเดียวแล้วกรองแท็บฝั่งหน้าเว็บ — จำนวนของรางวัลอยู่ในหลัก
  // สิบ ไม่คุ้มที่จะยิงคิวรีใหม่ทุกครั้งที่สลับแท็บ และแถบความคืบหน้าด้านบน
  // ต้องรู้ราคาของรางวัลทุกชิ้นอยู่แล้วเพื่อหาเป้าหมายถัดไป
  const { rewards, loading, error } = useRewardCatalog();

  // อัตราแต้มมาจากตารางที่แอดมินแก้ได้ (reward_settings, 0049) ไม่ใช่เลขที่
  // ฮาร์ดโค้ดไว้ในหน้าเว็บแล้วลืมแก้ตามตอนแอดมินปรับอัตรา
  const { settings } = useRewardSettings();

  // แต้มโบนัสต่อรีวิว (0106) — ปิดไว้หรือตั้งเป็น 0 ก็ไม่ต้องโฆษณาให้ลูกค้า
  const reviewBonus =
    settings?.reviewPointsEnabled === false ? 0 : settings?.reviewPoints ?? 0;

  // ของที่ส่งถึงแล้วแต่ยังไม่ได้กดยืนยัน — เตือนซ้ำที่หน้านี้ด้วย เพราะคนส่วน
  // ใหญ่เข้ามาทางหน้าแลกรางวัล ไม่ได้เปิดเมนูโปรไฟล์ทุกครั้ง
  const pendingReceiptCount = usePendingReceiptCount(user?.id);

  const visible = useMemo(
    () => (tab ? rewards.filter((r) => r.category === tab) : rewards),
    [rewards, tab],
  );

  const goal = useMemo(() => nextGoal(rewards, points), [rewards, points]);
  const progress = goal ? Math.min((points / goal.pointsRequired) * 100, 100) : 100;

  return (
    <div className="rewards">
      <AppHeader />

      <main className="rewards__main">
        <h1 className="rewards__title">แลกรางวัล</h1>
        <p className="rewards__intro">ใช้แต้มสะสมแลกส่วนลด ของรางวัล และสิทธิพิเศษต่างๆ</p>

        <section className="rewards__balance">
          <div className="rewards__balance-info">
            <p className="rewards__balance-label">แต้มสะสมของคุณ</p>
            <p className="rewards__balance-value">{formatPoints(points)} แต้ม</p>

            <div className="rewards__progress">
              <div
                className="rewards__progress-fill"
                style={{ width: `${progress}%` }}
                role="progressbar"
                aria-valuenow={Math.round(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="ความคืบหน้าสู่ของรางวัลชิ้นถัดไป"
              />
            </div>

            <p className="rewards__balance-hint">
              {goal
                ? `อีก ${formatPoints(goal.pointsRequired - points)} แต้ม แลก${goal.name}`
                : "แต้มของคุณแลกได้ทุกรางวัลในคลังแล้ว"}
            </p>
          </div>

          <div className="rewards__balance-actions">
            {/* ป้ายจำนวนของที่ส่งถึงแล้วแต่ยังไม่ได้กดยืนยัน — ปุ่มนี้คือทาง
                เดียวที่พาไปกดยืนยันได้ ถ้าไม่บอกตรงนี้ลูกค้าจะไม่รู้ว่ามีอะไร
                ค้างอยู่ */}
            <button
              type="button"
              className="rewards__balance-btn rewards__balance-btn--solid"
              onClick={() => navigate("/rewards/history")}
            >
              ประวัติการแลกรางวัล
              {pendingReceiptCount > 0 && (
                <span className="rewards__balance-badge">{pendingReceiptCount}</span>
              )}
            </button>
            <button
              type="button"
              className="rewards__balance-btn"
              aria-expanded={howToOpen}
              onClick={() => setHowToOpen((open) => !open)}
            >
              วิธีสะสมแต้มเพิ่ม
            </button>
          </div>
        </section>

        {howToOpen && (
          <section className="rewards__howto">
            <h2 className="rewards__howto-title">วิธีสะสมแต้ม</h2>
            {settings?.earningEnabled === false && reviewBonus === 0 ? (
              <p className="rewards__howto-body">
                ตอนนี้ระบบสะสมแต้มปิดใช้งานชั่วคราว แต้มที่มีอยู่ยังใช้แลกรางวัลได้ตามปกติ
              </p>
            ) : (
              <ol className="rewards__howto-list">
                {settings?.earningEnabled !== false && (
                  <li>
                    จองสนามและชำระเงินตามปกติ — ทุก{" "}
                    <strong>{formatPoints(settings?.bahtPerPoint ?? 10)} บาท</strong> ที่จ่ายจริง
                    จะได้ <strong>1 แต้ม</strong>
                  </li>
                )}
                {/* แต้มทุกก้อนจ่ายตอนกดส่งรีวิว (submit_review, 0106) ไม่ใช่ตอน
                    ระบบปิดงานการจองอีกแล้ว — ต้องบอกให้ตรงกับของจริง ไม่งั้น
                    ลูกค้าจะรอแต้มที่ไม่มีวันมาเองโดยไม่รู้ว่าต้องรีวิวก่อน */}
                <li>
                  เล่นจบแล้วเปิดใบเสร็จของการจองนั้นแล้ว <strong>เขียนรีวิว</strong> — แต้ม
                  เข้าบัญชีทันทีที่ส่งรีวิว
                </li>
                {reviewBonus > 0 && (
                  <li>
                    ทุกรีวิวรับโบนัสเพิ่มอีก <strong>{formatPoints(reviewBonus)} แต้ม</strong>{" "}
                    (หนึ่งการจองรีวิวได้ครั้งเดียว)
                  </li>
                )}
                {settings?.earningEnabled !== false && (
                  <li>คิดจากยอดหลังหักส่วนลดคูปองแล้ว และปัดเศษลง</li>
                )}
              </ol>
            )}
            <button
              type="button"
              className="rewards__howto-cta"
              onClick={() => navigate("/booking/sport")}
            >
              จองสนามเลย
            </button>
          </section>
        )}

        <nav className="rewards__tabs" aria-label="หมวดหมู่ของรางวัล">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`rewards__tab ${item.key === tab ? "rewards__tab--active" : ""}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {loading && <p className="rewards__empty">กำลังโหลดของรางวัล...</p>}
        {!loading && error && <p className="rewards__empty">{error}</p>}
        {!loading && !error && visible.length === 0 && (
          <p className="rewards__empty">ยังไม่มีของรางวัลในหมวดนี้</p>
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="rewards__grid">
            {visible.map((reward) => (
              <RewardCard key={reward.id} reward={reward} points={points} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
