// หน้าแชทเต็มจอ — รายการห้องด้านซ้าย ห้องที่เปิดอยู่ด้านขวา
//
// เวอร์ชันย่อของหน้านี้คือ ChatPopup ที่ลอยอยู่มุมจอ ฟีเจอร์ที่มีแค่ที่นี่คือ
// การตอบกลับข้อความ การสร้างกลุ่ม และการจัดการคนที่บล็อกไว้
import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, BellOff, Image as ImageIcon, Pin, Smile, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import BlockedUsersDialog from "../components/BlockedUsersDialog";
import ConversationMenu from "../components/ConversationMenu";
import NewGroupDialog from "../components/NewGroupDialog";
import { useAuth } from "../context/useAuth";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  useConversationMembers,
  useConversationMessages,
  useConversations,
  usePeerReadAt,
  usePresenceRefresh,
} from "../hooks/useMessages";
import { fetchCommunityProfile } from "../lib/community";
import {
  EMOJI_SET,
  THREAD_FILTERS,
  conversationTime,
  dayLabel,
  deleteMessage,
  filterConversations,
  isBlockedWith,
  isMuted,
  markConversationRead,
  messageTime,
  muteLabel,
  presenceState,
  sendMessage,
  startDirectConversation,
  uploadChatImage,
} from "../lib/messages";
import { errorMessage } from "../lib/errors";
import "./Community.css";
import "./Messages.css";

// ป้ายสถานะออนไลน์/ออฟไลน์ — จุดสีเขียวเมื่อออนไลน์ วงสีเทาพร้อมเวลาที่ผ่านมา
// เมื่อออฟไลน์ (จุดเขียว = ออนไลน์ / จุดเทา = ใช้งานล่าสุด 5 นาทีที่แล้ว)
function PresenceDot({ lastSeenAt, showLabel = false }) {
  const state = presenceState(lastSeenAt);

  return (
    <span
      className={`msg__presence ${state.online ? "msg__presence--on" : ""}`}
      title={state.label}
    >
      <span className="msg__presence-dot" aria-hidden="true" />
      {/* ป้ายข้อความยังอยู่ในหน้าเสมอแม้ตอนไม่โชว์ เพื่อให้โปรแกรมอ่านหน้าจอ
          บอกสถานะได้ ไม่ใช่เห็นแค่จุดสีที่ไม่มีความหมายกับคนที่มองไม่เห็น */}
      <span className={`msg__presence-text ${showLabel ? "" : "msg__presence-text--hidden"}`}>
        {state.label}
      </span>
    </span>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const bubblesRef = useRef(null);

  const [filter, setFilter] = useState(THREAD_FILTERS[0]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [sendingImage, setSendingImage] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [pendingProfile, setPendingProfile] = useState(null); // { key: toUserId, profile }
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  // heartbeat สถานะออนไลน์ย้ายไปอยู่ที่ ChatDock (เมานต์ตลอดทุกหน้าใน
  // ProtectedRoute) แล้ว ไม่ต้องยิงซ้ำอีกรอบตรงนี้

  // ดึงสถานะของคนอื่นกลับมาเป็นระยะ ไม่งั้นจุดเขียวค้างอยู่จนกว่าจะมี action
  // สักอย่างมาดัน reloadKey
  usePresenceRefresh(Boolean(user?.id), () => setReloadKey((key) => key + 1));

  // useConversations คง keepPreviousData ไว้เองแล้ว (ดู hooks/useMessages.js)
  // รายการห้องจึงไม่หล่นเป็น [] ชั่วขณะระหว่างรีโหลดเบื้องหลัง (จาก
  // markConversationRead/ส่งข้อความ) — ไม่งั้น activeId จะหล่นเป็น undefined
  // แล้วเด้งกลับ ทำให้จอกระพริบ และ effect ด้านล่างยิงซ้ำไม่จบ
  const { conversations, loading: loadingList } = useConversations(reloadKey);

  // ห้องที่เปิดอยู่เก็บไว้ใน query string (?c=) ไม่ใช่ state ล้วน — หน้าโพสต์
  // กด "ส่งข้อความ" แล้วพามาที่ห้องนั้นได้ตรง ๆ และ refresh แล้วยังอยู่ห้องเดิม
  //
  // ?to=<userId> คือ "จะเริ่มคุยกับคนนี้" ที่ยังไม่มีห้องจริง (มาจากปุ่ม
  // ส่งข้อความในโพสต์/โปรไฟล์) — เดิมกดปุ่มแล้วสร้างห้องทันที ทำให้มีห้องว่าง
  // เปล่าโผล่ในกล่องข้อความของอีกฝ่ายทั้งที่ยังไม่ได้พิมพ์อะไรเลย ตอนนี้เช็ค
  // ก่อนว่ามีห้องเดิมกับคนนี้อยู่แล้วไหม ถ้าไม่มีค่อยรอสร้างจริงตอนกดส่งข้อความ
  // แรก (ดู handleSend/handlePickImage)
  const toUserId = params.get("to");
  const existingForTo = toUserId
    ? conversations.find((c) => !c.isGroup && c.otherUserId === toUserId) ?? null
    : null;

  // ปกติหน้านี้เปิดห้องบนสุดให้เองเมื่อไม่มี ?c= — แต่หลังจากลบแชท/ออกจากกลุ่ม/
  // ทำเป็นยังไม่อ่าน ต้องไม่เด้งไปเปิดห้องอื่นต่อ เพราะการเปิดห้องเท่ากับมาร์ก
  // ว่าอ่านแล้วทันที (effect ข้างล่าง) ซึ่งจะล้างสิ่งที่ผู้ใช้เพิ่งสั่งไปทิ้ง
  const [noAutoSelect, setNoAutoSelect] = useState(false);

  // จอแคบแสดงทีละจอแบบแอปแชททั่วไป (รายการห้อง → กดแล้วเข้าห้อง → ปุ่มย้อนกลับ)
  // จุดตัดต้องตรงกับ @media ใน Messages.css ที่สลับสองแผงเป็นทีละจอ
  const isNarrow = useMediaQuery("(max-width: 1000px)");

  const cParam = params.get("c");
  // บนจอแคบห้ามเปิดห้องบนสุดให้เอง ไม่งั้นกดเข้าหน้าข้อความแล้วเด้งเข้าห้อง
  // ใดห้องหนึ่งทันทีโดยไม่ได้เลือก แถมห้องนั้นถูกมาร์กว่าอ่านแล้วไปด้วย
  const autoId = toUserId || noAutoSelect || isNarrow ? null : conversations[0]?.id;
  const activeId = cParam ?? existingForTo?.id ?? autoId ?? null;

  // รอรายการห้องโหลดให้เสร็จก่อนค่อยฟันธงว่า "ไม่มีห้องเดิมจริง ๆ" กันเคส
  // conversations ยังโหลดไม่เสร็จแล้วเข้าใจผิดว่าต้องเริ่มห้องใหม่
  const isPendingNewChat = Boolean(toUserId) && !existingForTo && !loadingList;

  // เก็บผลลัพธ์คู่กับ key (toUserId) ที่ยิงไปตอนนั้น แบบเดียวกับ useAsyncData —
  // กันเคสสลับไปเริ่มแชทกับอีกคนก่อนที่คำขอเดิมจะโหลดเสร็จ ไม่งั้นจะเห็นชื่อ/
  // รูปของคนก่อนหน้าค้างโผล่มาแป๊บนึงตอนคนใหม่ยังโหลดไม่เสร็จ
  useEffect(() => {
    if (!isPendingNewChat) return undefined;

    let alive = true;

    // ถามสถานะบล็อกไปพร้อมกัน — ห้องที่มีอยู่แล้วรู้จาก list_my_conversations
    // แต่เคส "เริ่มแชทใหม่" ยังไม่มีแถวห้องให้ค่านั้นติดมา ถ้าไม่ถามตรงนี้
    // ผู้ใช้จะพิมพ์จนจบแล้วค่อยโดนปฏิเสธตอนกดส่ง
    Promise.all([fetchCommunityProfile(toUserId), isBlockedWith(toUserId)])
      .then(([profile, blocked]) => {
        if (alive) {
          setPendingProfile({
            key: toUserId,
            profile: { id: profile.id, name: profile.name, avatar: profile.avatar },
            blocked,
          });
        }
      })
      .catch((err) => {
        console.error("โหลดโปรไฟล์ไม่สำเร็จ:", err);
        if (alive) setError(errorMessage(err));
      });

    return () => {
      alive = false;
    };
  }, [isPendingNewChat, toUserId]);

  const pendingReady = isPendingNewChat && pendingProfile?.key === toUserId;
  const pendingUser = pendingReady ? pendingProfile.profile : null;

  const active = activeId
    ? conversations.find((c) => c.id === activeId) ?? null
    : pendingUser
      ? {
          id: null,
          isGroup: false,
          otherUserId: pendingUser.id,
          name: pendingUser.name,
          avatar: pendingUser.avatar,
          otherLastSeenAt: null,
          peerLastReadAt: null,
          blockedByMe: false,
          blockedAny: pendingProfile.blocked,
        }
      : null;

  // ส่งข้อความไม่ได้เมื่อมีการบล็อกคั่นอยู่ ไม่ว่าฝั่งไหนเป็นคนบล็อก — ฝั่งที่
  // เป็นคนบล็อกเองได้เห็นเหตุผลตรง ๆ ส่วนฝั่งที่ถูกบล็อกเห็นแค่ว่าส่งไม่ได้
  // (ระบบตั้งใจไม่บอกว่าใครบล็อกใคร ดู 0094)
  const blocked = Boolean(active?.blockedAny);

  const { messages, loading: loadingMessages, append } = useConversationMessages(activeId);
  const { members } = useConversationMembers(active?.isGroup ? activeId : null, reloadKey);

  // อีกฝ่ายอ่านถึงเวลาไหน — ขยับเองผ่าน Realtime ไม่ต้องรอโหลดรายการห้องใหม่
  const peerReadAt = usePeerReadAt(activeId, active?.peerLastReadAt, user?.id);

  // ฟองสุดท้ายที่เป็นของเราและอีกฝ่ายอ่านไปแล้ว — ติ๊ก "อ่านแล้ว" ขึ้นแค่ใบเดียว
  // ตรงนั้น ไม่ใช่ห้อยท้ายทุกฟองจนรกทั้งห้อง (แบบเดียวกับแอปแชททั่วไป)
  const lastReadMineId = useMemo(() => {
    if (!peerReadAt) return null;

    const readTime = new Date(peerReadAt).getTime();
    const mine = messages.filter(
      (m) => m.senderId === user?.id && new Date(m.createdAt).getTime() <= readTime,
    );

    return mine.length > 0 ? mine[mine.length - 1].id : null;
  }, [messages, peerReadAt, user?.id]);

  const threads = useMemo(
    () => filterConversations(conversations, filter, query),
    [conversations, filter, query],
  );

  // เปิดห้องไหนก็ถือว่าอ่านแล้ว — เคลียร์ badge ทันทีแล้วค่อยดึงรายการใหม่
  useEffect(() => {
    if (!activeId) return;

    markConversationRead(activeId)
      .then(() => setReloadKey((k) => k + 1))
      .catch((err) => console.error("อัปเดตสถานะอ่านแล้วไม่สำเร็จ:", err));
  }, [activeId]);

  // เลื่อนลงล่างสุดทุกครั้งที่มีข้อความเพิ่ม ไม่ว่าจะของเราเองหรือของอีกฝ่าย
  useEffect(() => {
    const box = bubblesRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages]);

  function openThread(id) {
    setNoAutoSelect(false);
    setParams({ c: id });
  }

  // ปุ่มย้อนกลับของจอแคบ — กลับไปหน้ารายการห้อง (ซ่อนบนเดสก์ท็อปที่เห็นสองแผง
  // พร้อมกันอยู่แล้ว) ต้องตั้ง noAutoSelect ด้วย ไม่งั้นพอ ?c= ถูกล้าง ห้องบนสุด
  // จะถูกเปิดขึ้นมาแทนทันทีแล้วเหมือนปุ่มกดไม่ติด
  function backToList() {
    setNoAutoSelect(true);
    setParams({});
  }

  function handleGroupCreated(conversationId) {
    setShowNewGroup(false);
    setParams({ c: conversationId });
    setReloadKey((k) => k + 1);
  }

  const refresh = () => setReloadKey((k) => k + 1);

  // ห้องที่ถูกลบ/ออก/ทำเป็นยังไม่อ่าน ต้องไม่ค้างเปิดอยู่ในกล่องขวา — ถ้าเป็น
  // ห้องที่เปิดค้างอยู่ effect มาร์กอ่านแล้วจะวิ่งทับทันที (กรณียังไม่อ่าน)
  // หรือกลายเป็นห้องที่ไม่มีในรายการแล้ว (กรณีลบ/ออก)
  function closeIfActive(conversationId) {
    if (conversationId !== activeId) return;

    setNoAutoSelect(true);
    setParams({});
  }

  async function handleDeleteMessage(message) {
    const ok = window.confirm("ลบข้อความนี้ใช่ไหม? ทุกคนในห้องจะไม่เห็นเนื้อหาเดิมอีก");
    if (!ok) return;

    setError("");

    try {
      await deleteMessage(message.id);
      // ฟองเปลี่ยนเป็น "ข้อความถูกลบแล้ว" เองผ่าน event UPDATE ของ Realtime
      // (subscribeToMessages) — ทั้งฝั่งเราและฝั่งอีกคนใช้ทางเดียวกัน
      refresh();
    } catch (err) {
      console.error("ลบข้อความไม่สำเร็จ:", err);
      setError(errorMessage(err));
    }
  }

  async function handleSend() {
    const text = draft.trim();
    // blocked กันไว้อีกชั้นเผื่อกด Enter ค้างจากตอนก่อนที่แถบบล็อกจะขึ้น
    if (!text || blocked || (!activeId && !pendingUser)) return;

    setDraft("");
    setError("");
    setShowEmoji(false);

    try {
      // ยังไม่มีห้องจริง (มาจาก ?to=) — เพิ่งสร้างตอนกดส่งครั้งแรกนี่แหละ
      // start_direct_conversation คืนห้องเดิมให้เองถ้าดันมีคนอื่นสร้างแซงไปก่อน
      const conversationId = activeId ?? (await startDirectConversation(pendingUser.id));
      if (!activeId) setParams({ c: conversationId });

      const message = await sendMessage({ conversationId, userId: user.id, content: text });
      // ขึ้นจอเลยไม่ต้องรอ event จาก Realtime — append กันซ้ำด้วย id ให้แล้ว
      if (message) append(message);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("ส่งข้อความไม่สำเร็จ:", err);
      setDraft(text);
      setError(errorMessage(err));
    }
  }

  // แทรกอีโมจิตรงตำแหน่งเคอร์เซอร์ ไม่ใช่ต่อท้ายเสมอ — คนที่พิมพ์ค้างไว้แล้ว
  // อยากใส่อีโมจิกลางประโยคจะได้ไม่ต้องลบพิมพ์ใหม่
  function insertEmoji(emoji) {
    const input = inputRef.current;

    if (!input) {
      setDraft((current) => current + emoji);
      return;
    }

    const start = input.selectionStart ?? draft.length;
    const end = input.selectionEnd ?? draft.length;

    setDraft(draft.slice(0, start) + emoji + draft.slice(end));

    // คืนโฟกัสให้ช่องพิมพ์แล้ววางเคอร์เซอร์ต่อท้ายอีโมจิที่เพิ่งใส่
    requestAnimationFrame(() => {
      input.focus();
      const at = start + emoji.length;
      input.setSelectionRange(at, at);
    });
  }

  async function handlePickImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || blocked || (!activeId && !pendingUser)) return;

    setSendingImage(true);
    setError("");

    try {
      const conversationId = activeId ?? (await startDirectConversation(pendingUser.id));
      if (!activeId) setParams({ c: conversationId });

      const imageUrl = await uploadChatImage(file, user.id, conversationId);
      const message = await sendMessage({
        conversationId,
        userId: user.id,
        // ข้อความที่พิมพ์ค้างไว้ส่งไปพร้อมรูปเลย ไม่ต้องแยกเป็นสองฟอง
        content: draft.trim(),
        imageUrl,
      });

      if (message) append(message);
      setDraft("");
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("ส่งรูปไม่สำเร็จ:", err);
      setError(errorMessage(err));
    } finally {
      setSendingImage(false);
    }
  }

  return (
    <div className="cm">
      <AppHeader />

      <main className="msg__main">
        <div className="msg__title-row">
          <h1 className="msg__title">ข้อความ</h1>
          {/* ทางเดียวที่จะเลิกบล็อกคนที่ลบแชททิ้งไปแล้ว — เมนู ⋯ ของห้องทำได้
              เฉพาะคนที่ยังมีห้องค้างอยู่ */}
          <button type="button" className="msg__blocked-link" onClick={() => setShowBlocked(true)}>
            ผู้ใช้ที่ถูกบล็อก
          </button>
          <button type="button" className="msg__new-group" onClick={() => setShowNewGroup(true)}>
            + กลุ่มใหม่
          </button>
        </div>

        {/* --chat-open บอก CSS ว่าตอนนี้มีห้องเปิดอยู่ ซึ่งบนจอแคบแปลว่าให้ซ่อน
            รายการห้องแล้วโชว์ห้องแชทเต็มจอแทน (ดู @media ใน Messages.css) */}
        <div className={`msg__layout ${active ? "msg__layout--chat-open" : ""}`}>
          <section className="cm-card msg__list">
            <input
              aria-label="ค้นหาผู้สนทนา"
              className="cm-search"
              type="search"
              placeholder="ค้นหาผู้สนทนา"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <div className="msg__filters">
              {THREAD_FILTERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`cm-chip cm-chip--sm msg__filter ${
                    item === filter ? "cm-chip--active" : ""
                  }`}
                  onClick={() => setFilter(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="msg__threads">
              {loadingList && conversations.length === 0 && (
                <p className="cm-time">กำลังโหลด...</p>
              )}

              {!loadingList && threads.length === 0 && (
                <p className="cm-time">
                  {conversations.length === 0
                    ? "ยังไม่มีบทสนทนา — เริ่มได้จากปุ่มส่งข้อความในโพสต์หรือหน้าโปรไฟล์"
                    : "ไม่มีบทสนทนาในหมวดนี้"}
                </p>
              )}

              {/* ห่อด้วย div เพราะเมนู ⋯ เป็นปุ่มที่ต้องอยู่ข้างในแถว — ซ้อน
                  <button> ใน <button> เป็น HTML ที่ใช้ไม่ได้ (เบราว์เซอร์แยก
                  เป็นสองปุ่มพี่น้องให้เอง แล้วคลิกทะลุกันมั่ว) */}
              {threads.map((thread) => (
                <div
                  key={thread.id}
                  className={`msg__thread-wrap ${
                    thread.id === activeId ? "msg__thread-wrap--active" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="msg__thread"
                    onClick={() => openThread(thread.id)}
                  >
                    <span className="msg__thread-avatar">
                      {thread.avatar ? (
                        <img src={thread.avatar} alt="" className="cm-avatar cm-avatar--sm" />
                      ) : (
                        <span className="cm-avatar cm-avatar--sm" aria-hidden="true" />
                      )}
                      {/* ห้องกลุ่มไม่มีสถานะออนไลน์ของ "อีกฝ่าย" ให้แสดง */}
                      {!thread.isGroup && <PresenceDot lastSeenAt={thread.otherLastSeenAt} />}
                    </span>
                    <span className="msg__thread-text">
                      <span className="msg__thread-name">
                        {thread.isPinned && (
                          <span className="msg__thread-flag" title="ปักหมุดไว้">
                            <Pin size={13} aria-hidden="true" />
                          </span>
                        )}
                        {thread.name}
                        {isMuted(thread.mutedUntil) && (
                          <span className="msg__thread-flag" title="ปิดการแจ้งเตือนอยู่">
                            <BellOff size={13} aria-hidden="true" />
                          </span>
                        )}
                        {thread.blockedByMe && (
                          <span className="msg__thread-flag" title="คุณบล็อกผู้ใช้นี้อยู่">
                            <Ban size={13} aria-hidden="true" />
                          </span>
                        )}
                      </span>
                      <p className="msg__thread-preview">{thread.preview || "ยังไม่มีข้อความ"}</p>
                    </span>
                    <span className="msg__thread-side">
                      <span className="msg__thread-time">
                        {conversationTime(thread.lastMessageAt)}
                      </span>
                      {thread.unread > 0 && <span className="msg__unread">{thread.unread}</span>}
                    </span>
                  </button>

                  <ConversationMenu
                    conversation={thread}
                    className="msg__thread-menu"
                    label={`ตัวเลือกการสนทนากับ ${thread.name}`}
                    onChanged={refresh}
                    onCleared={closeIfActive}
                    onMarkedUnread={closeIfActive}
                    onLeft={closeIfActive}
                    onError={setError}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="cm-card msg__chat">
            {!active && isPendingNewChat && <p className="cm__empty">กำลังโหลด...</p>}

            {!active && !isPendingNewChat && (
              <p className="cm__empty">เลือกบทสนทนาทางซ้ายเพื่อเริ่มอ่านข้อความ</p>
            )}

            {active && (
              <>
                <header className="msg__chat-head">
                  <button
                    type="button"
                    className="msg__back"
                    aria-label="กลับไปรายการข้อความ"
                    onClick={backToList}
                  >
                    ‹
                  </button>

                  {/* กดที่รูปเพื่อดูโปรไฟล์ได้เลย — ห้องกลุ่มไม่มี otherUserId
                      ให้กด เลยเหลือรูปเฉย ๆ ไม่ใช่ปุ่ม */}
                  {active.otherUserId ? (
                    <button
                      type="button"
                      className="msg__chat-avatar-btn"
                      aria-label="ดูโปรไฟล์"
                      onClick={() => navigate(`/community/profile/${active.otherUserId}`)}
                    >
                      {active.avatar ? (
                        <img src={active.avatar} alt="" className="cm-avatar cm-avatar--sm" />
                      ) : (
                        <span className="cm-avatar cm-avatar--sm" aria-hidden="true" />
                      )}
                    </button>
                  ) : active.avatar ? (
                    <img src={active.avatar} alt="" className="cm-avatar cm-avatar--sm" />
                  ) : (
                    <span className="cm-avatar cm-avatar--sm" aria-hidden="true" />
                  )}
                  <div>
                    <p className="cm-name">{active.name}</p>
                    {active.isGroup ? (
                      members.length > 0 && (
                        <p className="msg__chat-members">
                          {members.length} สมาชิก ·{" "}
                          {/* ในกลุ่มบอกจำนวนคนที่ออนไลน์อยู่ตอนนี้แทนการไล่ชื่อ
                              ทีละคนว่าใครออฟไลน์มากี่นาที ซึ่งยาวเกินหัวห้อง */}
                          ออนไลน์{" "}
                          {
                            // ไม่นับตัวเอง — "ออนไลน์ 1 คน" ในกลุ่มที่ไม่มีใคร
                            // อยู่เลยนอกจากเราเองอ่านแล้วเข้าใจผิด
                            members.filter(
                              (m) => m.id !== user?.id && presenceState(m.lastSeenAt).online,
                            ).length
                          }{" "}
                          คน
                        </p>
                      )
                    ) : (
                      <p className="msg__chat-presence">
                        <PresenceDot lastSeenAt={active.otherLastSeenAt} showLabel />
                      </p>
                    )}
                  </div>
                  <div className="msg__chat-links">
                    {isMuted(active.mutedUntil) && (
                      <span className="msg__chat-flag" title={muteLabel(active.mutedUntil)}>
                        <BellOff size={13} aria-hidden="true" /> ปิดเสียงอยู่
                      </span>
                    )}
                    {/* ห้องที่ยังไม่ถูกสร้างจริง (?to=) ยังไม่มีอะไรให้ตั้งค่า —
                        ปักหมุด/ปิดเสียงต้องมีแถวสมาชิกอยู่ก่อน */}
                    {active.id && (
                      <ConversationMenu
                        conversation={active}
                        label="ตัวเลือกห้องสนทนานี้"
                        onChanged={refresh}
                        onCleared={closeIfActive}
                        onMarkedUnread={closeIfActive}
                        onLeft={closeIfActive}
                        onError={setError}
                      />
                    )}
                  </div>
                </header>

                <div className="msg__bubbles" ref={bubblesRef}>
                  {loadingMessages && <p className="cm-time">กำลังโหลดข้อความ...</p>}

                  {!loadingMessages && messages.length === 0 && (
                    <p className="cm-time">ยังไม่มีข้อความในห้องนี้ ทักไปก่อนได้เลย</p>
                  )}

                  {messages.map((message, index) => {
                    const mine = message.senderId === user?.id;
                    const previous = messages[index - 1];
                    // ขึ้นหัวคั่นเฉพาะตอนข้ามวันเท่านั้น
                    const showDay =
                      !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt);

                    return (
                      <div key={message.id} className="msg__group">
                        {showDay && <span className="msg__daymark">{dayLabel(message.createdAt)}</span>}

                        <div className={`msg__row ${mine ? "msg__row--mine" : ""}`}>
                          {!mine && <span className="cm-avatar cm-avatar--xs" aria-hidden="true" />}

                          {/* ปุ่มลบโผล่ตอนชี้ที่ฟองของตัวเอง (ดู .msg__row:hover
                              ใน Messages.css) — วางไว้ก่อนฟองเพราะแถวของเรา
                              ชิดขวา ปุ่มจึงไปอยู่ด้านซ้ายของฟองพอดี */}
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
                            className={`msg__bubble ${
                              message.imageUrl ? "msg__bubble--image" : ""
                            } ${message.deleted ? "msg__bubble--deleted" : ""}`}
                          >
                            {message.imageUrl && (
                              <button
                                type="button"
                                className="msg__image-btn"
                                onClick={() => setLightbox(message.imageUrl)}
                              >
                                <img
                                  src={message.imageUrl}
                                  alt="รูปที่ส่งในแชท"
                                  className="msg__image"
                                  loading="lazy"
                                />
                              </button>
                            )}
                            {message.deleted ? "ข้อความถูกลบแล้ว" : message.content}
                            <span className="msg__bubble-time">
                              {messageTime(message.createdAt)}
                            </span>
                          </div>
                        </div>

                        {/* ติ๊กอ่านแล้วขึ้นที่ฟองสุดท้ายที่อีกฝ่ายอ่านถึงเท่านั้น */}
                        {mine && message.id === lastReadMineId && (
                          <p className="msg__read">อ่านแล้ว</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {showEmoji && !blocked && (
                  <div className="msg__emoji" role="group" aria-label="เลือกอีโมจิ">
                    {EMOJI_SET.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="msg__emoji-item"
                        onClick={() => insertEmoji(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                {/* แถบแทนช่องพิมพ์เมื่อบล็อกกันอยู่ — ปิดช่องพิมพ์เฉย ๆ โดยไม่
                    บอกอะไรเลยทำให้ผู้ใช้นึกว่าระบบพัง ฝั่งที่เป็นคนบล็อกเองได้
                    เห็นเหตุผลตรง ๆ พร้อมทางเลิกบล็อก ส่วนฝั่งที่ถูกบล็อกเห็น
                    แค่ว่าส่งไม่ได้ (ไม่เปิดเผยว่าใครบล็อกใคร ดู 0094) */}
                {blocked ? (
                  <div className="msg__blocked-bar">
                    {active.blockedByMe
                      ? `คุณบล็อก ${active.name} อยู่ — เลิกบล็อกจากเมนู ⋯ เพื่อคุยกันต่อ`
                      : "ส่งข้อความในบทสนทนานี้ไม่ได้ในตอนนี้"}
                  </div>
                ) : (
                <div className="msg__composer">
                  <button
                    type="button"
                    className="msg__tool"
                    aria-label="แนบรูปภาพ"
                    aria-pressed={sendingImage}
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
                    className="msg__input"
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
                    className="msg__send"
                    onClick={handleSend}
                    disabled={!draft.trim()}
                  >
                    ส่ง
                  </button>
                </div>
                )}

                {error && <p className="cm__error msg__error">{error}</p>}
              </>
            )}
          </section>
        </div>
      </main>

      {showNewGroup && (
        <NewGroupDialog onClose={() => setShowNewGroup(false)} onCreated={handleGroupCreated} />
      )}

      {showBlocked && (
        <BlockedUsersDialog onClose={() => setShowBlocked(false)} onChanged={refresh} />
      )}

      {/* กดรูปในแชทเพื่อดูเต็ม — รูปในฟองถูกย่อไว้ให้อ่านบทสนทนาต่อได้
          รายละเอียดในภาพ (เช่นสลิปหรือแผนที่สนาม) จึงต้องมีทางขยายดู */}
      {lightbox && (
        <div
          className="msg__lightbox"
          role="presentation"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="รูปที่ส่งในแชท" />
        </div>
      )}
    </div>
  );
}
