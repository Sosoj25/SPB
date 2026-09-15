// รายชื่อคนที่เราบล็อกไว้ + ปุ่มเลิกบล็อก
//
// ต้องมีที่รวมแบบนี้เพราะเมนู ⋯ ของห้องแชทเลิกบล็อกได้เฉพาะคนที่ยังมีห้องคุย
// ค้างอยู่ — คนที่บล็อกไปแล้วลบแชททิ้งจะไม่มีทางกลับไปเลิกบล็อกได้เลย
import { useEffect, useState } from "react";
import { fetchBlockedUsers, unblockUser } from "../lib/messages";
import { errorMessage } from "../lib/errors";
import "./BlockedUsersDialog.css";

export default function BlockedUsersDialog({ onClose, onChanged }) {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    fetchBlockedUsers()
      .then((rows) => {
        if (alive) setPeople(rows);
      })
      .catch((err) => {
        console.error("โหลดรายชื่อที่ถูกบล็อกไม่สำเร็จ:", err);
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  async function handleUnblock(person) {
    if (busyId) return;

    setBusyId(person.id);
    setError("");

    try {
      await unblockUser(person.id);
      setPeople((current) => current.filter((item) => item.id !== person.id));
      // รายการห้องแชทฝั่งนอกต้องรีเฟรชด้วย — แถบ "คุณบล็อกผู้ใช้นี้อยู่" ใน
      // ห้องที่เปิดค้างไว้ต้องหายไปพร้อมกัน ไม่ใช่ค้างจนกว่าจะโหลดหน้าใหม่
      onChanged?.();
    } catch (err) {
      console.error("เลิกบล็อกไม่สำเร็จ:", err);
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="blocked-dialog__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="blocked-dialog" role="dialog" aria-modal="true" aria-label="ผู้ใช้ที่ถูกบล็อก">
        <h2 className="blocked-dialog__title">ผู้ใช้ที่ถูกบล็อก</h2>
        <p className="blocked-dialog__lead">
          คนในรายการนี้ส่งข้อความหาคุณไม่ได้ และคุณก็ส่งหาเขาไม่ได้เช่นกัน
        </p>

        {loading && <p className="blocked-dialog__hint">กำลังโหลด...</p>}

        {!loading && people.length === 0 && (
          <p className="blocked-dialog__hint">ยังไม่ได้บล็อกใครไว้</p>
        )}

        <div className="blocked-dialog__list">
          {people.map((person) => (
            <div key={person.id} className="blocked-dialog__row">
              {person.avatar ? (
                <img src={person.avatar} alt="" className="blocked-dialog__avatar" />
              ) : (
                <span className="blocked-dialog__avatar" aria-hidden="true" />
              )}
              <span className="blocked-dialog__name">{person.name}</span>
              <button
                type="button"
                className="blocked-dialog__unblock"
                disabled={busyId === person.id}
                onClick={() => handleUnblock(person)}
              >
                {busyId === person.id ? "กำลังเลิกบล็อก..." : "เลิกบล็อก"}
              </button>
            </div>
          ))}
        </div>

        {error && <p className="blocked-dialog__error">{error}</p>}

        <div className="blocked-dialog__actions">
          <button type="button" className="blocked-dialog__close" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
