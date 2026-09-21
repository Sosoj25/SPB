// หน้าต่างแชทลอยหนึ่งห้อง — ตัวจัดการว่าจะเปิดกี่ห้องอยู่ที่ ChatDock
import { useEffect, useRef, useState } from "react";
import { BellOff, Image as ImageIcon, Send, Smile, Trash2 } from "lucide-react";
import ConversationMenu from "./ConversationMenu";
import { useAuth } from "../context/useAuth";
import { useConversationMessages } from "../hooks/useMessages";
import {
  EMOJI_SET,
  deleteMessage,
  isMuted,
  markConversationRead,
  messageTime,
  presenceState,
  sendMessage,
  uploadChatImage,
} from "../lib/messages";
import { errorMessage } from "../lib/errors";
// ใช้คลาส .cm-avatar และฟองข้อความ (.msg__bubble ฯลฯ) ชุดเดียวกับหน้า
// /messages เต็มจอ — จะได้หน้าตาตรงกันโดยไม่ต้องก็อปสไตล์มาซ้ำ ต้อง import
// ตรงนี้เองเพราะป๊อปอัปโผล่ได้ทุกหน้า ไม่ใช่แค่หน้าที่เผอิญโหลดสไตล์พวกนี้ไว้แล้ว
import "../pages/Community.css";
import "../pages/Messages.css";
import "./ChatPopup.css";

// หน้าต่างแชทลอยหนึ่งห้อง (แบบ Facebook) — ทำได้แค่พิมพ์/ส่งรูป/ส่งอีโมจิ/
// เลื่อนอ่าน ไม่มี reply-to-reply เพราะพื้นที่แคบกว่าหน้า /messages มาก
// ฟีเจอร์ครบ ๆ อยู่ที่หน้านั้น
export default function ChatPopup({
  conversation,
  minimized,
  onClose,
  onToggleMinimize,
  onRead,
  onChanged,
}) {
  const { user } = useAuth();
  const [draft, setDraft] = useState("");
  const [sendingImage, setSendingImage] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [error, setError] = useState("");
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  const { messages, loading, append } = useConversationMessages(conversation.id);

  // บล็อกกันอยู่ = ส่งไม่ได้ทั้งสองทาง (ดู 0094) — ตรงกับที่หน้า /messages ทำ
  const blocked = Boolean(conversation.blockedAny);

  // เข้ามาดูห้องนี้แล้วถือว่าอ่านแล้ว — ทำครั้งเดียวตอนเปิด/ขยายจากย่อ เหมือน
  // ที่หน้า /messages ทำกับ activeId ไม่ใช่ทุกครั้งที่มีข้อความใหม่เข้ามา
  useEffect(() => {
    if (minimized) return;

    markConversationRead(conversation.id)
      .then(() => onRead?.())
      .catch((err) => console.error("อัปเดตสถานะอ่านแล้วไม่สำเร็จ:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, minimized]);

  useEffect(() => {
    const box = bodyRef.current;
    if (box && !minimized) box.scrollTop = box.scrollHeight;
  }, [messages, minimized]);

  // แทรกอีโมจิตรงตำแหน่งเคอร์เซอร์ ไม่ใช่ต่อท้ายเสมอ — เหมือนหน้า /messages
  function insertEmoji(emoji) {
    const input = inputRef.current;

    if (!input) {
      setDraft((current) => current + emoji);
      return;
    }

    const start = input.selectionStart ?? draft.length;
    const end = input.selectionEnd ?? draft.length;

    setDraft(draft.slice(0, start) + emoji + draft.slice(end));

    requestAnimationFrame(() => {
      input.focus();
      const at = start + emoji.length;
      input.setSelectionRange(at, at);
    });
  }

  async function handleDeleteMessage(message) {
    const ok = window.confirm("ลบข้อความนี้ใช่ไหม? ทุกคนในห้องจะไม่เห็นเนื้อหาเดิมอีก");
    if (!ok) return;

    setError("");

    try {
      await deleteMessage(message.id);
      // ฟองเปลี่ยนเป็น "ข้อความถูกลบแล้ว" เองผ่าน event UPDATE ของ Realtime
      onChanged?.();
    } catch (err) {
      console.error("ลบข้อความไม่สำเร็จ:", err);
      setError(errorMessage(err));
    }
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || blocked) return;

    setDraft("");
    setError("");
    setShowEmoji(false);

    try {
      const message = await sendMessage({ conversationId: conversation.id, userId: user.id, content: text });
      if (message) append(message);
    } catch (err) {
      console.error("ส่งข้อความไม่สำเร็จ:", err);
      setDraft(text);
      setError(errorMessage(err));
    }
  }

  async function handlePickImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || blocked) return;

    setSendingImage(true);
    setError("");

    try {
      const imageUrl = await uploadChatImage(file, user.id, conversation.id);
      const message = await sendMessage({
        conversationId: conversation.id,
        userId: user.id,
        content: draft.trim(),
        imageUrl,
      });

      if (message) append(message);
      setDraft("");
    } catch (err) {
      console.error("ส่งรูปไม่สำเร็จ:", err);
      setError(errorMessage(err));
    } finally {
      setSendingImage(false);
    }
  }

  const online = !conversation.isGroup && presenceState(conversation.otherLastSeenAt).online;

  // ย่อแล้วยุบทั้งกล่องเหลือแค่วงกลมอวาตาร์ลอย (แบบ chat head ของ Facebook)
  // กดที่วงกลมเพื่อขยายกลับ
  if (minimized) {
    return (
      <div
        className="chat-popup-bubble"
        role="button"
        tabIndex={0}
        onClick={onToggleMinimize}
        onKeyDown={(e) => {
          if (e.key === "Enter") onToggleMinimize();
        }}
        aria-label={`เปิดแชทกับ ${conversation.name}`}
      >
        {conversation.avatar ? (
          <img src={conversation.avatar} alt="" className="cm-avatar chat-popup-bubble__avatar" />
        ) : (
          <span className="cm-avatar chat-popup-bubble__avatar" aria-hidden="true" />
        )}
        {online && <span className="chat-popup-bubble__dot" aria-hidden="true" />}
        {conversation.unread > 0 && (
          <span className="chat-popup-bubble__unread" aria-hidden="true">
            {conversation.unread > 9 ? "9+" : conversation.unread}
          </span>
        )}
        <button
          type="button"
          className="chat-popup-bubble__close"
          aria-label="ปิดหน้าต่างแชท"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="chat-popup">
      <div className="chat-popup__head">
        <span className="chat-popup__head-avatar">
          {conversation.avatar ? (
            <img src={conversation.avatar} alt="" className="cm-avatar cm-avatar--xs" />
          ) : (
            <span className="cm-avatar cm-avatar--xs" aria-hidden="true" />
          )}
          {online && <span className="chat-popup__dot" aria-hidden="true" />}
        </span>
        <span className="chat-popup__head-name">
          {conversation.name}
          {isMuted(conversation.mutedUntil) && (
            <span className="chat-popup__muted" title="ปิดการแจ้งเตือนอยู่">
              <BellOff size={13} aria-hidden="true" />
            </span>
          )}
        </span>

        {/* คำสั่งจัดการห้องชุดเดียวกับหน้า /messages — ปิดเสียง/บล็อกเป็นสิ่งที่
            คนอยากทำ "ตอนที่กำลังโดนกวน" ซึ่งมักเกิดตรงหน้าต่างลอยนี่เอง ไม่ใช่
            ตอนที่ตั้งใจเปิดหน้าข้อความเต็มจอ */}
        <ConversationMenu
          conversation={conversation}
          className="chat-popup__menu"
          label={`ตัวเลือกการสนทนากับ ${conversation.name}`}
          onChanged={onChanged}
          onCleared={onClose}
          onLeft={onClose}
          onMarkedUnread={onClose}
          onError={setError}
        />

        <button
          type="button"
          className="chat-popup__minimize"
          aria-label="ย่อหน้าต่างแชท"
          onClick={onToggleMinimize}
        >
          −
        </button>
        <button
          type="button"
          className="chat-popup__close"
          aria-label="ปิดหน้าต่างแชท"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="chat-popup__body" ref={bodyRef}>
        {loading && <p className="chat-popup__hint">กำลังโหลด...</p>}
        {!loading && messages.length === 0 && (
          <p className="chat-popup__hint">เริ่มทักทายกันได้เลย</p>
        )}

        {messages.map((message) => {
          const mine = message.senderId === user?.id;
          return (
            <div key={message.id} className={`msg__row ${mine ? "msg__row--mine" : ""}`}>
              {/* ปุ่มลบข้างฟองของตัวเอง เหมือนหน้า /messages (สไตล์มาจาก
                  Messages.css ที่ไฟล์นี้ import ไว้อยู่แล้ว) */}
              {mine && !message.deleted && (
                <button
                  type="button"
                  className="msg__bubble-delete"
                  aria-label="ลบข้อความนี้"
                  onClick={() => handleDeleteMessage(message)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}

              <div
                className={`msg__bubble ${message.imageUrl ? "msg__bubble--image" : ""} ${
                  message.deleted ? "msg__bubble--deleted" : ""
                }`}
              >
                {message.imageUrl && (
                  <img
                    src={message.imageUrl}
                    alt="รูปที่ส่งในแชท"
                    className="msg__image"
                    loading="lazy"
                  />
                )}
                {message.deleted ? "ข้อความถูกลบแล้ว" : message.content}
                <span className="msg__bubble-time">{messageTime(message.createdAt)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="chat-popup__error">{error}</p>}

      {showEmoji && !blocked && (
        <div className="chat-popup__emoji" role="group" aria-label="เลือกอีโมจิ">
          {EMOJI_SET.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="chat-popup__emoji-item"
              onClick={() => insertEmoji(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {blocked ? (
        <p className="chat-popup__blocked">
          {conversation.blockedByMe
            ? "คุณบล็อกผู้ใช้นี้อยู่ — เลิกบล็อกได้จากเมนู ⋯"
            : "ส่งข้อความในบทสนทนานี้ไม่ได้ในตอนนี้"}
        </p>
      ) : (
      <div className="chat-popup__footer">
        <button
          type="button"
          className="msg__tool"
          aria-label="แนบรูปภาพ"
          disabled={sendingImage}
          onClick={() => fileRef.current?.click()}
        >
          {sendingImage ? "…" : <ImageIcon size={18} aria-hidden="true" />}
        </button>
        <input
          ref={fileRef}
          type="file"
          className="msg__file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handlePickImage}
        />

        <button
          type="button"
          className={`msg__tool ${showEmoji ? "msg__tool--on" : ""}`}
          aria-label="เลือกอีโมจิ"
          aria-expanded={showEmoji}
          onClick={() => setShowEmoji((value) => !value)}
        >
          <Smile size={18} aria-hidden="true" />
        </button>

        <input
          aria-label="พิมพ์ข้อความ"
          ref={inputRef}
          className="chat-popup__input"
          type="text"
          placeholder="พิมพ์ข้อความ..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
        />
        <button
          type="button"
          className="chat-popup__send"
          aria-label="ส่ง"
          onClick={handleSend}
          disabled={!draft.trim()}
        >
          <Send size={17} aria-hidden="true" />
        </button>
      </div>
      )}
    </div>
  );
}
