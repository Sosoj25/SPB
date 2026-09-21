// โครงหน้าหลังบ้าน — แถบเมนูข้าง แถบหัว กระดิ่งคิวงาน และลิ้นชักเมนูบนจอแคบ
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Building2,
  CalendarDays,
  CircleCheckBig,
  Clock,
  CreditCard,
  Gift,
  History,
  LayoutDashboard,
  LayoutGrid,
  Mail,
  MessagesSquare,
  Newspaper,
  Package,
  ScanLine,
  Settings,
  Tag,
  Undo2,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useAuth } from "../context/useAuth";
import { useAdminQueueCounts } from "../hooks/useAdmin";
import { useAlertSoundSetting, useAlertSounds } from "../hooks/useAlertSounds";
import { logoRound } from "../assets/images";
import "./DashboardLayout.css";

// ใส่ได้เฉพาะลิงก์ที่มีหน้าจริงรองรับ เมนูที่ยังไม่มีหน้าจะพาไปเจอ 404 เปล่า ๆ
//
// badge ชี้ไปที่ key ของ useAdminQueueCounts — ใส่เฉพาะเมนูที่เป็น "คิวรอแอดมิน
// มากดตัดสินใจ" จริง ๆ เมนูอย่างตารางเวลา/จัดการสนามไม่มีคิวให้เคลียร์ ติดเลข
// ไว้ก็เป็นแค่สิ่งรบกวนที่แอดมินต้องหัดมองข้าม ซึ่งสุดท้ายจะลามไปกลบเลขของ
// เมนูที่ต้องรีบจริง ๆ ด้วย
const ADMIN_NAV = [
  {
    items: [
      { Icon: LayoutDashboard, label: "ภาพรวม", to: "/admin/overview" },
      { Icon: CalendarDays, label: "การจองทั้งหมด", to: "/admin/bookings" },
      { Icon: UserPlus, label: "รับลูกค้า Walk-in", to: "/admin/walk-in" },
      { Icon: CircleCheckBig, label: "เช็คอิน", to: "/admin/checkin" },
      { Icon: Building2, label: "จัดการสิ่งอำนวยความสะดวก", to: "/admin/facilities" },
      { Icon: Tag, label: "จัดการสนาม", to: "/admin/pricing" },
      { Icon: Clock, label: "ตารางเวลา", to: "/admin/schedule" },
    ],
  },
  {
    section: "การเงิน",
    items: [
      { Icon: CreditCard, label: "รายการชำระเงิน", to: "/admin/payments", badge: "payments" },
      { Icon: Undo2, label: "จัดการคำขอคืนเงิน", to: "/admin/refunds", badge: "refunds" },
      { Icon: Settings, label: "ตั้งค่าการรับชำระเงิน", to: "/admin/payments/settings" },
    ],
  },
  {
    section: "ของรางวัล",
    items: [
      { Icon: Gift, label: "จัดการรางวัล", to: "/admin/rewards" },
      {
        Icon: Package,
        label: "คำขอแลกรางวัล",
        to: "/admin/reward-requests",
        badge: "rewardRequests",
      },
      { Icon: ScanLine, label: "สแกนรับของรางวัล", to: "/admin/reward-scan" },
      { Icon: History, label: "ประวัติการแลกรางวัล", to: "/admin/reward-history" },
    ],
  },
  {
    section: "อื่นๆ",
    items: [
      { Icon: Mail, label: "ข้อความติดต่อ", to: "/admin/support", badge: "support" },
      { Icon: MessagesSquare, label: "ชุมชน", to: "/admin/community", badge: "reports" },
      { Icon: Newspaper, label: "ข่าวสาร", to: "/admin/news" },
    ],
  },
];

const SUPERADMIN_NAV = [
  {
    items: [
      { Icon: LayoutGrid, label: "ภาพรวมระบบ", to: "/superadmin/overview" },
      { Icon: Users, label: "ผู้ใช้และสิทธิ์", to: "/superadmin/users" },
    ],
  },
];

const ROLE_LABELS = {
  admin: "ผู้ดูแลสนาม (Admin)",
  super_admin: "ผู้ดูแลระบบสูงสุด (Super Admin)",
};

// เลขสามหลักขึ้นไปดันชื่อเมนูจนตกบรรทัด — คิวที่ค้างเกินร้อยรายการรู้แค่ว่า
// "เยอะมาก" ก็พอ ตัวเลขเป๊ะ ๆ ไปดูในหน้านั้นได้
const formatBadge = (count) => (count > 99 ? "99+" : String(count));

// ป้ายตัวเลขข้างเมนู — คิวที่ว่างไม่ต้องขึ้นเลข 0 ค้างไว้ ให้แถบซ้ายเหลือเฉพาะ
// จุดที่มีของรออยู่จริง สายตาจะได้จับได้ตั้งแต่แวบแรกว่าต้องไปที่ไหน
function QueueBadge({ count, className = "dash__nav-badge" }) {
  if (!count) return null;

  return (
    <span className={className}>
      <span className="dash__sr-only">รอดำเนินการ </span>
      {formatBadge(count)}
    </span>
  );
}

// รวมยอด "รอตรวจสอบ" จากการชำระเงิน (0021) คำขอคืนเงิน (0034) คำขอแลกรางวัล
// (0047) และรายงานในชุมชน (0043/0052) — คิวที่แอดมินต้องมากดตัดสินใจเองจริง ๆ
//
// รายงานชุมชนต้องอยู่ในกระดิ่งด้วย ไม่ใช่เห็นเฉพาะตอนเปิดหน้า /admin/community
// เพราะแอดมินใช้เวลาส่วนใหญ่อยู่หน้าการจอง/การเงิน โพสต์ที่ถูกรายงานจึงค้าง
// อยู่ในคิวได้เป็นวันโดยไม่มีใครรู้ว่ามันเข้ามาแล้ว
//
// counts รับมาจาก DashboardLayout ไม่ได้ยิงเอง — ตัวเลขในกระดิ่งกับป้ายข้างเมนู
// ต้องมาจากการดึงครั้งเดียวกัน ไม่งั้นสองที่บนจอเดียวกันจะไม่ตรงกันเวลาคิวขยับ
function NotificationBell({ counts }) {
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

  const newReports = counts.newReports24h;
  const total =
    counts.payments + counts.refunds + counts.rewardRequests + counts.reports + counts.support;

  // โชว์เฉพาะคิวที่มีของค้างจริง กติกาเดียวกับป้ายข้างเมนู (QueueBadge) ที่
  // ไม่ขึ้นเลข 0 ค้างไว้ — ถ้ากางครบทุกแถวเสมอ แอดมินต้องกวาดตาอ่านทั้งหมด
  // กว่าจะรู้ว่าของจริงอยู่แถวไหน
  const rows = [
    { key: "payments", to: "/admin/payments", label: "การชำระเงินรอตรวจสอบ", count: counts.payments },
    { key: "refunds", to: "/admin/refunds", label: "คำขอคืนเงินรอตรวจสอบ", count: counts.refunds },
    {
      key: "rewardRequests",
      to: "/admin/reward-requests",
      label: "คำขอแลกรางวัลรอดำเนินการ",
      count: counts.rewardRequests,
    },
    { key: "support", to: "/admin/support", label: "ข้อความติดต่อรอตอบกลับ", count: counts.support },
    {
      key: "reports",
      to: "/admin/community",
      label: "โพสต์ที่ถูกรายงาน",
      count: counts.reports,
      // รายงานที่เพิ่งเข้ามาใน 24 ชม. — คิวเดียวกันแต่บอกเพิ่มว่ามีของใหม่
      fresh: newReports,
    },
  ].filter((row) => row.count > 0);

  return (
    <div className="dash__bell" ref={rootRef}>
      <button
        type="button"
        className="dash__bell-trigger"
        aria-label={`การแจ้งเตือน ${total} รายการ`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} aria-hidden="true" /> {total}
      </button>

      {open && (
        <div className="dash__bell-panel" role="menu">
          {rows.map((row) => (
            <Link
              key={row.key}
              to={row.to}
              className="dash__bell-item"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <span>
                {row.label}
                {row.fresh > 0 && <span className="dash__bell-new"> ใหม่ {row.fresh}</span>}
              </span>
              <span className="dash__bell-count">{row.count}</span>
            </Link>
          ))}
          {rows.length === 0 && <p className="dash__bell-empty">ไม่มีรายการที่ต้องตรวจสอบ</p>}
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
  const { counts } = useAdminQueueCounts();
  // หน้าแอดมินไม่มี ChatDock เมานต์อยู่ (อยู่คนละ route guard) เสียงเตือน
  // ข้อความ/แจ้งเตือนใหม่จึงต้องแขวนไว้ที่เลย์เอาต์นี้แทน — ไม่ส่งรายการห้องไป
  // ด้วยเพราะฝั่งนี้ไม่ได้ดึงไว้อยู่แล้ว (แลกกับการไม่รู้จักห้องที่ปิดเสียงไว้)
  useAlertSounds(user?.id, { supportThreads: true });
  const { on: soundOn, toggle: toggleSound } = useAlertSoundSetting();
  // แถบข้างของแอดมินยาวเป็นสิบเมนู บนจอแคบจึงเป็นลิ้นชักที่เรียกด้วยปุ่ม
  // ขีดสามขีด ไม่ใช่พับลงมาเป็นบล็อกเต็มความกว้าง (ไม่งั้นทุกครั้งที่เปิดหน้า
  // ต้องเลื่อนผ่านเมนูทั้งชุดก่อนถึงเนื้อหา)
  const [navOpen, setNavOpen] = useState(false);

  // แมตช์แบบ prefix ให้หน้าลูกที่ไม่มีลิงก์ของตัวเอง (เช่น /admin/news/editor)
  // ยังไฮไลต์เมนูแม่ได้ แต่ถ้ามีหลายลิงก์แมตช์กันเอง (เช่น /admin/payments
  // กับ /admin/payments/settings ตอนนี้อยู่ที่หน้าอันหลัง) ต้องเลือกอันที่
  // ตรงที่สุด (path ยาวสุด) ไม่งั้นทั้งสองแถวจะไฮไลต์พร้อมกัน
  const allPaths = nav.flatMap((group) => group.items.map((item) => item.to));
  const activePath = allPaths
    .filter((to) => location.pathname === to || location.pathname.startsWith(`${to}/`))
    .sort((a, b) => b.length - a.length)[0];

  // ยอดรวมทุกคิวสำหรับป้ายบนปุ่มขีดสามขีด (จอแคบเห็นป้ายรายเมนูไม่ได้)
  const totalQueue =
    counts.payments + counts.refunds + counts.rewardRequests + counts.reports + counts.support;

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

  // เปลี่ยนหน้าแล้วลิ้นชักต้องหุบเอง ไม่งั้นมันค้างบังหน้าที่เพิ่งพาไป —
  // เทียบค่ารอบก่อนหน้าระหว่าง render แทน useEffect (pattern เดียวกับที่ใช้
  // ใน ImageCropModal.jsx) จะได้ไม่ต้องวาดรอบที่ลิ้นชักยังเปิดค้างอยู่ก่อน
  const [prevPathname, setPrevPathname] = useState(location.pathname);
  if (location.pathname !== prevPathname) {
    setPrevPathname(location.pathname);
    setNavOpen(false);
  }

  useEffect(() => {
    if (!navOpen) return undefined;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  return (
    <div className={`dash dash--${variant}`}>
      {/* ฉากหลังทึบตอนลิ้นชักกาง — แตะที่ไหนก็ได้นอกลิ้นชักเพื่อปิด
          บนเดสก์ท็อปมันถูกซ่อนไว้ (ดู @media ใน DashboardLayout.css) */}
      <div
        className={`dash__scrim ${navOpen ? "dash__scrim--open" : ""}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />

      <aside className={`dash__sidebar ${navOpen ? "dash__sidebar--open" : ""}`}>
        <div className="dash__brand">
          <img src={logoRound} alt="" className="dash__brand-logo" />
          <div>
            <p className="dash__brand-name">SPORTSBOOKING</p>
            <p className="dash__brand-role">{roleLabel}</p>
          </div>
        </div>

        <nav className="dash__nav">
          {nav.map((group, index) => {
            // ยอดรวมของทั้งหมวดไว้ข้างหัวข้อ — ถึงจะเห็นเลขรายเมนูอยู่แล้ว แต่
            // แถบซ้ายยาวเกินหนึ่งจอบนโน้ตบุ๊ก หมวดที่เลื่อนพ้นตาไปจะได้ไม่เงียบ
            // หายไปเฉย ๆ
            const groupCount = group.items.reduce(
              (sum, item) => sum + (item.badge ? counts[item.badge] : 0),
              0,
            );

            return (
              <div className="dash__nav-group" key={group.section ?? `group-${index}`}>
                {group.section && (
                  <p className="dash__nav-label">
                    {group.section}
                    <QueueBadge count={groupCount} className="dash__nav-label-badge" />
                  </p>
                )}
                {group.items.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`dash__nav-item ${
                      item.to === activePath ? "dash__nav-item--active" : ""
                    }`}
                  >
                    <item.Icon size={20} aria-hidden="true" />
                    <span className="dash__nav-text">{item.label}</span>
                    <QueueBadge count={item.badge ? counts[item.badge] : 0} />
                  </Link>
                ))}
              </div>
            );
          })}
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
          <button
            type="button"
            className="dash__burger"
            aria-label={navOpen ? "ปิดเมนู" : "เปิดเมนู"}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((value) => !value)}
          >
            <span className={`dash__burger-icon ${navOpen ? "dash__burger-icon--open" : ""}`}>
              <span />
              <span />
              <span />
            </span>
            {/* คิวที่รออยู่ต้องเห็นตั้งแต่ยังไม่กางลิ้นชัก ไม่งั้นบนมือถือ
                ป้ายตัวเลขข้างเมนูทั้งหมดถูกซ่อนอยู่หลังปุ่มนี้ */}
            <QueueBadge count={totalQueue} className="dash__burger-badge" />
          </button>

          <div className="dash__topbar-heading">
            <h1 className="dash__title">{title}</h1>
            {subtitle && <p className="dash__subtitle">{subtitle}</p>}
          </div>
          {headerExtra}

          {/* ปุ่มปิดเสียงอยู่ติดกระดิ่ง — เคาน์เตอร์ที่เปิดหน้าแอดมินค้างไว้ทั้งวัน
              ต้องปิดได้เร็วเวลามีลูกค้าอยู่ตรงหน้า ไม่ต้องเข้าไปหาในหน้าตั้งค่า */}
          <button
            type="button"
            className="dash__sound"
            role="switch"
            aria-checked={soundOn}
            aria-label={soundOn ? "ปิดเสียงแจ้งเตือน" : "เปิดเสียงแจ้งเตือน"}
            title={soundOn ? "ปิดเสียงแจ้งเตือน" : "เปิดเสียงแจ้งเตือน"}
            onClick={toggleSound}
          >
            {soundOn ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
          </button>

          <NotificationBell counts={counts} />
        </header>

        <main className="dash__content">{children}</main>
      </div>
    </div>
  );
}
