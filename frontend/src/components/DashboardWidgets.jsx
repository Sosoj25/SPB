import "./DashboardWidgets.css";

export function Badge({ tone = "neutral", children }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function StatCard({ label, value, hint }) {
  return (
    <div className="stat-card">
      <p className="stat-card__label">{label}</p>
      <p className="stat-card__value">{value}</p>
      {hint && <p className="stat-card__hint">{hint}</p>}
    </div>
  );
}

// ไม่รู้จำนวนหน้าทั้งหมดจริง (ไม่ยิง count แยกต่างหาก ตาม pattern limit+1
// ใน lib/bookings.js) — โชว์แค่หน้าปัจจุบัน ปิดปุ่ม "ถัดไป" เมื่อ hasMore
// เป็น false แทนการเดาเลขหน้าสุดท้ายที่อาจผิด
export function Pagination({ page, hasMore, onChange }) {
  return (
    <div className="pagination">
      <button
        type="button"
        className="pagination__nav"
        disabled={page <= 1}
        aria-label="ก่อนหน้า"
        onClick={() => onChange(page - 1)}
      >
        ‹
      </button>
      <button type="button" className="pagination__page pagination__page--active">
        {page}
      </button>
      <button
        type="button"
        className="pagination__nav"
        disabled={!hasMore}
        aria-label="ถัดไป"
        onClick={() => onChange(page + 1)}
      >
        ›
      </button>
    </div>
  );
}

// value/onChange เป็น optional — ไม่ใส่ก็ยังใช้เป็นกล่องค้นหาตกแต่งเฉย ๆ ได้
// เหมือนเดิม (ดู AdminOverview/AdminBookings) ใส่ก็ผูกกับ state จริงได้ (AdminNews)
export function SearchBox({ placeholder = "ค้นหา...", value, onChange }) {
  return (
    <div className="dash-search">
      <span aria-hidden="true">⌕</span>
      <input
        type="text"
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      />
    </div>
  );
}

export function Pill({ active, tone = "tint", children, ...props }) {
  return (
    <button
      type="button"
      className={`dash-pill dash-pill--${tone} ${active ? "dash-pill--active" : ""}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Switch({ on, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`switch ${on ? "switch--on" : ""}`}
      onClick={() => onChange?.(!on)}
    >
      <span className="switch__thumb" />
    </button>
  );
}
