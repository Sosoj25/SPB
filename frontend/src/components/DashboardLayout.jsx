import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { useAdminPaymentStats, useAdminRefundStats } from "../hooks/useAdmin";
import { logoRound } from "../assets/images";
import "./DashboardLayout.css";

// เหลือแค่ลิงก์ที่มีหน้าจริงรองรับ — ที่เหลือ (รายงานรายได้, ลูกค้า,
// ตั้งค่าสนาม ฯลฯ) ยังไม่มีหน้าจริง ใส่ไว้จะพาไปเจอ 404 เฉยๆ
const ADMIN_NAV = [
  {
    items: [
      { icon: "▤", label: "ภาพรวม", to: "/admin/overview" },
      { icon: "🗓", label: "จัดการการจอง", to: "/admin/bookings" },
      { icon: "✓", label: "เช็คอิน", to: "/admin/checkin" },
      { icon: "🏟", label: "จัดการสิ่งอำนวยความสะดวก", to: "/admin/facilities" },
      { icon: "💰", label: "จัดการสนาม", to: "/admin/pricing" },
      { icon: "🕘", label: "ตารางเวลา", to: "/admin/schedule" },
    ],
  },
  {
    section: "การเงิน",
    items: [
      { icon: "฿", label: "รายการชำระเงิน", to: "/admin/payments" },
      { icon: "↩", label: "จัดการคำขอคืนเงิน", to: "/admin/refunds" },
      { icon: "⚙", label: "ตั้งค่าการรับชำระเงิน", to: "/admin/payments/settings" },
    ],
  },
  {
    section: "อื่นๆ",
    items: [{ icon: "📰", label: "ข่าวสาร", to: "/admin/news" }],
  },
];

const SUPERADMIN_NAV = [
  {
    items: [
      { icon: "▦", label: "ภาพรวมระบบ", to: "/superadmin/overview" },
      { icon: "👤", label: "ผู้ใช้และสิทธิ์", to: "/superadmin/users" },
    ],
  },
];

const ROLE_LABELS = {
  admin: "ผู้ดูแลสนาม (Admin)",
  super_admin: "ผู้ดูแลระบบสูงสุด (Super Admin)",
};

// รวมยอด "รอตรวจสอบ" จากการชำระเงิน (0021) และคำขอคืนเงิน (0034) — สอง
// คิวเดียวที่แอดมินต้องมากดอนุมัติ/ปฏิเสธเองจริง ๆ ในระบบตอนนี้ ก่อนหน้านี้
// กระดิ่งเป็นแค่เลข 0 ฮาร์ดโค้ด ไม่เคยต่อกับข้อมูลจริงเลย
function NotificationBell() {
  const { stats: paymentStats } = useAdminPaymentStats();
  const { stats: refundStats } = useAdminRefundStats();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const paymentCount = paymentStats?.pendingCount ?? 0;
  const refundCount = refundStats?.pendingCount ?? 0;
  const total = paymentCount + refundCount;

  return (
    <div className="dash__bell" ref={rootRef}>
      <button
        type="button"
        className="dash__bell-trigger"
        aria-label={`การแจ้งเตือน ${total} รายการ`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        🔔 {total}
      </button>

      {open && (
        <div className="dash__bell-panel" role="menu">
          <Link
            to="/admin/payments"
            className="dash__bell-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <span>การชำระเงินรอตรวจสอบ</span>
            <span className="dash__bell-count">{paymentCount}</span>
          </Link>
          <Link
            to="/admin/refunds"
            className="dash__bell-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <span>คำขอคืนเงินรอตรวจสอบ</span>
            <span className="dash__bell-count">{refundCount}</span>
          </Link>
          {total === 0 && <p className="dash__bell-empty">ไม่มีรายการที่ต้องตรวจสอบ</p>}
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout({
  variant,
  title,
  subtitle,
  headerExtra,
  children,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile: authProfile, logout } = useAuth();
  const nav = variant === "superadmin" ? SUPERADMIN_NAV : ADMIN_NAV;

  // แมตช์แบบ prefix ให้หน้าลูกที่ไม่มีลิงก์ของตัวเอง (เช่น /admin/news/editor)
  // ยังไฮไลต์เมนูแม่ได้ แต่ถ้ามีหลายลิงก์แมตช์กันเอง (เช่น /admin/payments
  // กับ /admin/payments/settings ตอนนี้อยู่ที่หน้าอันหลัง) ต้องเลือกอันที่
  // ตรงที่สุด (path ยาวสุด) ไม่งั้นทั้งสองแถวจะไฮไลต์พร้อมกัน
  const allPaths = nav.flatMap((group) => group.items.map((item) => item.to));
  const activePath = allPaths
    .filter((to) => location.pathname === to || location.pathname.startsWith(`${to}/`))
    .sort((a, b) => b.length - a.length)[0];

  const displayName = authProfile?.full_name || authProfile?.username || "ผู้ใช้งาน";
  const roleLabel = ROLE_LABELS[authProfile?.role] ?? "";

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // error ถูก log ไว้ใน AuthContext แล้ว
    }

    navigate("/login");
  };

  return (
    <div className={`dash dash--${variant}`}>
      <aside className="dash__sidebar">
        <div className="dash__brand">
          <img src={logoRound} alt="" className="dash__brand-logo" />
          <div>
            <p className="dash__brand-name">SPORTSBOOKING</p>
            <p className="dash__brand-role">{roleLabel}</p>
          </div>
        </div>

        <nav className="dash__nav">
          {nav.map((group, index) => (
            <div className="dash__nav-group" key={group.section ?? `group-${index}`}>
              {group.section && <p className="dash__nav-label">{group.section}</p>}
              {group.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`dash__nav-item ${
                    item.to === activePath ? "dash__nav-item--active" : ""
                  }`}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="dash__profile">
          <div className="dash__profile-avatar" aria-hidden="true">
            {displayName.charAt(0)}
          </div>
          <div className="dash__profile-info">
            <p className="dash__profile-name">{displayName}</p>
            <p className="dash__profile-email">{user?.email}</p>
          </div>
          <button
            type="button"
            className="dash__logout"
            aria-label="ออกจากระบบ"
            onClick={handleLogout}
          >
            ⎋
          </button>
        </div>
      </aside>

      <div className="dash__body">
        <header className="dash__topbar">
          <div className="dash__topbar-heading">
            <h1 className="dash__title">{title}</h1>
            {subtitle && <p className="dash__subtitle">{subtitle}</p>}
          </div>
          {headerExtra}
          <NotificationBell />
        </header>

        <main className="dash__content">{children}</main>
      </div>
    </div>
  );
}
