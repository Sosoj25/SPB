// กล่องสร้างกลุ่มแชทใหม่ — ค้นหาคนด้วย usePeopleSearch ตัวเดียวกับที่ฟีด
// ชุมชนใช้ค้นหาคน แล้วสะสมรายชื่อที่เลือกไว้เป็น chip ก่อนยิงสร้างจริงทีเดียว
import { useState } from "react";
import { usePeopleSearch } from "../hooks/useCommunity";
import { createGroupConversation } from "../lib/messages";
import { errorMessage } from "../lib/errors";
import "./NewGroupDialog.css";

export default function NewGroupDialog({ onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const { people, loading } = usePeopleSearch(query);

  const selectedIds = new Set(selected.map((p) => p.id));
  const results = people.filter((p) => !selectedIds.has(p.id));

  function addPerson(person) {
    setSelected((current) => [...current, person]);
    setQuery("");
  }

  function removePerson(id) {
    setSelected((current) => current.filter((p) => p.id !== id));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (sending) return;

    if (!title.trim()) {
      setError("กรุณาตั้งชื่อกลุ่ม");
      return;
    }
    if (selected.length < 2) {
      setError("เลือกสมาชิกอย่างน้อย 2 คน (กลุ่มมีอย่างน้อย 3 คนรวมคุณ)");
      return;
    }

    setError("");
    setSending(true);

    try {
      const conversationId = await createGroupConversation({
        title: title.trim(),
        memberIds: selected.map((p) => p.id),
      });
      onCreated(conversationId);
    } catch (err) {
      console.error("สร้างกลุ่มไม่สำเร็จ:", err);
      setError(errorMessage(err));
      setSending(false);
    }
  }

  return (
    <div
      className="group-dialog__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="group-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="สร้างกลุ่มแชทใหม่"
        onSubmit={handleSubmit}
      >
        <h2 className="group-dialog__title">สร้างกลุ่มแชทใหม่</h2>

        <label className="group-dialog__label">
          ชื่อกลุ่ม
          <input
            className="group-dialog__input"
            type="text"
            value={title}
            autoFocus
            placeholder="เช่น ทีมแบดตอนเย็น"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        {selected.length > 0 && (
          <div className="group-dialog__chips">
            {selected.map((person) => (
              <span key={person.id} className="group-dialog__chip">
                {person.name}
                <button
                  type="button"
                  aria-label={`เอา ${person.name} ออก`}
                  onClick={() => removePerson(person.id)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <label className="group-dialog__label">
          เพิ่มสมาชิก
          <input
            className="group-dialog__input"
            type="text"
            placeholder="ค้นหาชื่อผู้ใช้"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        {query.trim() && (
          <div className="group-dialog__results">
            {loading && <p className="group-dialog__hint">กำลังค้นหา...</p>}
            {!loading && results.length === 0 && (
              <p className="group-dialog__hint">ไม่พบผู้ใช้ที่ตรงกับคำค้น</p>
            )}
            {results.map((person) => (
              <button
                key={person.id}
                type="button"
                className="group-dialog__result"
                onClick={() => addPerson(person)}
              >
                {person.avatar ? (
                  <img src={person.avatar} alt="" />
                ) : (
                  <span className="group-dialog__avatar" aria-hidden="true" />
                )}
                {person.name}
              </button>
            ))}
          </div>
        )}

        {error && <p className="group-dialog__error">{error}</p>}

        <div className="group-dialog__actions">
          <button type="button" className="group-dialog__cancel" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="submit" className="group-dialog__submit" disabled={sending}>
            {sending ? "กำลังสร้าง..." : "สร้างกลุ่ม"}
          </button>
        </div>
      </form>
    </div>
  );
}
