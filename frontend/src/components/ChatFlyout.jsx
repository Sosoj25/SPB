// แผงรายชื่อห้องแชทที่กางจากปุ่ม 💬 บนแถบหัวเว็บ — กดห้องแล้วสั่งให้
// ChatDock เปิดหน้าต่างแชทลอยให้ (ผ่าน ChatPopupProvider)
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChatPopup } from "../context/useChatPopup";
import { useConversations } from "../hooks/useMessages";
import {
  THREAD_FILTERS,
  conversationTime,
  filterConversations,
  isMuted,
  presenceState,
  subscribeToUnreadMessages,
} from "../lib/messages";
// ใช้ .cm-avatar ร่วมกับหน้าอื่น ๆ — ปุ่มนี้โผล่ได้ทุกหน้าที่มี AppHeader
// ไม่ใช่แค่หน้าที่เผอิญโหลดสไตล์นี้ไว้แล้ว
import "../pages/Community.css";
import "./ChatFlyout.css";

// ปุ่มแชทบนหัวเว็บ (ข้าง ๆ กระดิ่งแจ้งเตือน) กดแล้วกางแผงรายชื่อบทสนทนา
// ล่าสุดแบบ Facebook — เลือกห้องไหนแล้วไม่ได้พาไปหน้า /messages แต่สั่งเปิด
// เป็นหน้าต่างแชทลอยแทน (ผ่าน ChatPopupContext ไปหา ChatDock)
export default function ChatFlyout({ userId }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(THREAD_FILTERS[0]);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const navigate = useNavigate();
  const { requestOpen } = useChatPopup();

  // อัปเดตแบบเรียลไทม์ผ่าน subscribeToUnreadMessages แทนที่จะรอ 60 วิของ
  // presence refresh — ไม่งั้นป้าย/รายการในแผงนี้จะค้างของตอนโหลดหน้าแรกไว้
  // ตลอด เพราะไม่มีอะไรมา bump reloadKey ให้เองเลย
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribeToUnreadMessages(userId, () => setReloadKey((k) => k + 1));
  }, [userId]);

  const { conversations } = useConversations(reloadKey);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const filtered = useMemo(
    () => filterConversations(conversations, filter, query),
    [conversations, filter, query],
  );

  const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);

  function openChat(conversation) {
    setOpen(false);
    requestOpen(conversation.id);
  }

  if (!userId) return null;

  return (
    <div className="app-header__bell chat-flyout" ref={rootRef}>
      <button
        type="button"
        className="app-header__bell-trigger"
        aria-label={`แชท ${totalUnread} รายการที่ยังไม่ได้อ่าน`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        💬
        {totalUnread > 0 && <span className="app-header__bell-badge">{totalUnread}</span>}
      </button>

      {open && (
        <div className="app-header__bell-panel chat-flyout__panel" role="menu">
          <div className="chat-flyout__head">
            <p className="app-header__bell-title chat-flyout__title">แชท</p>
            <button
              type="button"
              className="chat-flyout__expand"
              aria-label="ขยายเป็นหน้าข้อความเต็มจอ"
              onClick={() => {
                setOpen(false);
                navigate("/messages");
              }}
            >
              ⛶
            </button>
          </div>

          <input
            aria-label="ค้นหาห้องสนทนา"
            className="chat-flyout__search"
            type="search"
            placeholder="ค้นหา"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="chat-flyout__filters">
            {THREAD_FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                className={`chat-flyout__filter ${
                  item === filter ? "chat-flyout__filter--active" : ""
                }`}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="chat-flyout__list">
            {filtered.length === 0 && (
              <p className="app-header__bell-empty">ไม่มีบทสนทนาในหมวดนี้</p>
            )}

            {filtered.slice(0, 20).map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                role="menuitem"
                className="chat-flyout__item"
                onClick={() => openChat(conversation)}
              >
                <span className="chat-flyout__item-avatar">
                  {conversation.avatar ? (
                    <img src={conversation.avatar} alt="" className="cm-avatar cm-avatar--sm" />
                  ) : (
                    <span className="cm-avatar cm-avatar--sm" aria-hidden="true" />
                  )}
                  {!conversation.isGroup && presenceState(conversation.otherLastSeenAt).online && (
                    <span className="chat-flyout__presence" aria-hidden="true" />
                  )}
                </span>

                <span className="chat-flyout__item-text">
                  <span className="chat-flyout__item-name">
                    {conversation.isPinned && <span title="ปักหมุดไว้">📌 </span>}
                    {conversation.name}
                    {isMuted(conversation.mutedUntil) && (
                      <span title="ปิดการแจ้งเตือนอยู่"> 🔕</span>
                    )}
                  </span>
                  <span className="chat-flyout__item-preview">
                    {conversation.preview || "ยังไม่มีข้อความ"}
                    {conversation.lastMessageAt
                      ? ` · ${conversationTime(conversation.lastMessageAt)}`
                      : ""}
                  </span>
                </span>

                {conversation.unread > 0 && (
                  <span className="chat-flyout__unread" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="app-header__bell-viewall chat-flyout__viewall"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/messages");
            }}
          >
            ดูข้อความทั้งหมด
          </button>
        </div>
      )}
    </div>
  );
}
