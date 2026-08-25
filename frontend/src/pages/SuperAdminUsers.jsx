import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, Pill, Pagination, SearchBox } from "../components/DashboardWidgets";
import { useAuth } from "../context/useAuth";
import { useAdminUsers, useUserRoleCounts } from "../hooks/useAdmin";
import { setUserActive, updateUserRole } from "../lib/admin";
import { errorMessage } from "../lib/errors";
import "./SuperAdminUsers.css";

const FILTERS = [
  { key: "", label: "ทั้งหมด" },
  { key: "super_admin", label: "Super Admin" },
  { key: "admin", label: "Admin" },
  { key: "customer", label: "ลูกค้า" },
];

const ROLE_LABEL = {
  super_admin: "Super Admin",
  admin: "Admin",
  customer: "ลูกค้า",
};

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const formatJoinedDate = (isoTimestamp) => dateFormatter.format(new Date(isoTimestamp));

export default function SuperAdminUsers() {
  const { user: currentUser } = useAuth();
  const [activeFilter, setActiveFilter] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [updatingId, setUpdatingId] = useState(null);
  const [actionError, setActionError] = useState("");

  const { counts } = useUserRoleCounts(reloadKey);
  const { users, hasMore, loading, error } = useAdminUsers({
    role: activeFilter || undefined,
    page,
    reloadKey,
  });

  const roleStats = [
    { role: "Super Admin", count: counts?.superAdmin ?? 0, desc: "เข้าถึงทุกอย่าง" },
    { role: "Admin", count: counts?.admin ?? 0, desc: "จัดการสนามและการจอง" },
    { role: "ลูกค้า", count: counts?.customer ?? 0, desc: "จองและดูประวัติตนเอง" },
  ];

  function selectFilter(key) {
    setActiveFilter(key);
    setPage(1);
  }

  async function handleRoleChange(userId, role) {
    setActionError("");
    setUpdatingId(userId);

    try {
      await updateUserRole(userId, role);
      setReloadKey((key) => key + 1);
    } catch (err) {
      console.error("set_user_role failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleToggleActive(user) {
    setActionError("");
    setUpdatingId(user.id);

    try {
      await setUserActive(user.id, !user.is_active);
      setReloadKey((key) => key + 1);
    } catch (err) {
      console.error("update is_active failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <DashboardLayout
      variant="superadmin"
      title="ผู้ใช้และสิทธิ์"
      subtitle="กำหนดบทบาทและสิทธิ์การเข้าถึงของผู้ใช้ในระบบ"
      headerExtra={<SearchBox />}
    >
      <section className="dash-kpi">
        {roleStats.map((stat) => (
          <div key={stat.role} className="sa-role-card">
            <p className="sa-role-card__label">{stat.role}</p>
            <p className="sa-role-card__value">{stat.count.toLocaleString()}</p>
            <p className="sa-role-card__desc">{stat.desc}</p>
          </div>
        ))}
      </section>

      <div className="dash-filters">
        {FILTERS.map((filter) => (
          <Pill
            key={filter.key}
            active={filter.key === activeFilter}
            onClick={() => selectFilter(filter.key)}
          >
            {filter.label}
          </Pill>
        ))}
      </div>

      {actionError && <div className="dash-message dash-message--error">{actionError}</div>}

      <div className="dash-card dash-table-card">
        {loading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}

        {!loading && error && <div className="dash-message dash-message--error">{error}</div>}

        {!loading && !error && users.length === 0 && (
          <p className="dash-empty">ไม่พบผู้ใช้</p>
        )}

        {!loading && !error && users.length > 0 && (
          <>
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>ผู้ใช้</th>
                    <th>บทบาท</th>
                    <th>สมัครเมื่อ</th>
                    <th>สถานะ</th>
                    <th aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const isSelf = user.id === currentUser?.id;
                    const busy = updatingId === user.id;

                    return (
                      <tr key={user.id}>
                        <td>
                          <div className="dash-identity">
                            <div className="dash-identity__avatar" aria-hidden="true">
                              {(user.full_name || user.username).charAt(0)}
                            </div>
                            <div>
                              <p className="dash-identity__name">
                                {user.full_name || user.username}
                              </p>
                              <p className="dash-identity__email">@{user.username}</p>
                            </div>
                          </div>
                        </td>
                        <td>
                          <select
                            className="dash-select"
                            value={user.role}
                            disabled={isSelf || busy}
                            onChange={(e) => handleRoleChange(user.id, e.target.value)}
                            aria-label={`บทบาทของ ${user.username}`}
                          >
                            <option value="customer">{ROLE_LABEL.customer}</option>
                            <option value="admin">{ROLE_LABEL.admin}</option>
                            <option value="super_admin">{ROLE_LABEL.super_admin}</option>
                          </select>
                        </td>
                        <td>{formatJoinedDate(user.created_at)}</td>
                        <td>
                          <Badge tone={user.is_active ? "success" : "danger"}>
                            {user.is_active ? "ใช้งาน" : "ระงับ"}
                          </Badge>
                        </td>
                        <td>
                          <div className="dash-actions">
                            <button
                              type="button"
                              className={`dash-btn ${user.is_active ? "dash-btn--cancel" : ""}`}
                              disabled={isSelf || busy}
                              onClick={() => handleToggleActive(user)}
                            >
                              {busy ? "กำลังบันทึก..." : user.is_active ? "ระงับ" : "เปิดใช้งาน"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="dash-table-footer">
              <p>หน้า {page}</p>
              <Pagination page={page} hasMore={hasMore} onChange={setPage} />
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
