// โปรไฟล์ชุมชนของผู้ใช้คนหนึ่ง — โพสต์ ผู้ติดตาม และข้อมูลแนะนำตัว
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import CreatePostDialog from "../components/CreatePostDialog";
import PostCard from "../components/PostCard";
import ReportDialog from "../components/ReportDialog";
import { useAuth } from "../context/useAuth";
import {
  useCommunityCategories,
  useCommunityProfile,
  useMutualFollows,
  useUserPosts,
} from "../hooks/useCommunity";
import { useFeedInteractions } from "../hooks/useFeedInteractions";
import { sportImage } from "../lib/catalog";
import { deleteOwnPost, toggleFollow } from "../lib/community";
import { errorMessage } from "../lib/errors";
import "./Community.css";
import "./CommunityProfile.css";

const TABS = ["โพสต์", "เกี่ยวกับ", "รูปภาพ"];

const joinedFormatter = new Intl.DateTimeFormat("th-TH", { month: "short", year: "numeric" });
const joinedFullFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

// ป้ายบอกระยะเวลาที่อยู่ในชุมชนมาแล้ว ใช้ในการ์ดไฮไลท์ของแท็บ "เกี่ยวกับ"
function membershipDuration(joinedAt) {
  if (!joinedAt) return null;

  const joined = new Date(joinedAt);
  const now = new Date();
  let months = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth());
  if (now.getDate() < joined.getDate()) months -= 1;

  if (months < 1) return "เพิ่งเข้าร่วมชุมชนหมาดๆ";

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  if (years > 0 && remainingMonths > 0) return `เป็นสมาชิกมาแล้ว ${years} ปี ${remainingMonths} เดือน`;
  if (years > 0) return `เป็นสมาชิกมาแล้ว ${years} ปี`;
  return `เป็นสมาชิกมาแล้ว ${months} เดือน`;
}

export default function CommunityProfile() {
  const { handle } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState(TABS[0]);
  const [reloadKey, setReloadKey] = useState(0);
  const [editingPost, setEditingPost] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);

  const { profile: fetchedProfile, loading, error: profileError } = useCommunityProfile(
    handle,
    reloadKey,
  );
  // keepPreviousData คงโปรไฟล์ล่าสุดไว้ระหว่าง refetch (กันจอกระพริบตอนติดตาม/
  // แก้โพสต์) แต่ถ้าเปลี่ยนไปดูโปรไฟล์คนละคน (handle เปลี่ยน) ต้องไม่โชว์ของ
  // คนเก่าค้างไว้ผิดคน — เช็คว่า id ที่ได้มายังตรงกับ handle ปัจจุบันจริงไหม
  const profile = fetchedProfile && fetchedProfile.id === handle ? fetchedProfile : null;
  const { posts } = useUserPosts(handle, reloadKey);
  const { mutuals } = useMutualFollows(user?.id, handle);
  const { categories } = useCommunityCategories();

  const isSelf = profile?.id === user?.id;

  // ถูกใจ/บันทึกโพสต์ใช้ชุดเดียวกับหน้าฟีดชุมชนและหน้ารีวิว (useFeedInteractions)
  // — pending/setError ใช้ต่อกับปุ่มติดตามบนโปรไฟล์นี้ด้วย
  const {
    posts: visiblePosts,
    error,
    setError,
    pending,
    runPending,
    resetOverrides,
    handleLike,
    handleBookmark,
  } = useFeedInteractions(posts, user?.id);

  async function handleDeletePost(post) {
    const ok = window.confirm(
      `ลบโพสต์นี้ใช่ไหม?\n\n"${post.content.slice(0, 60)}${post.content.length > 60 ? "..." : ""}"\n\nโพสต์และรูปภาพจะหายจากหน้าเว็บทันที`,
    );
    if (!ok) return;

    try {
      await deleteOwnPost(post.id, user.id);
      resetOverrides();
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("ลบโพสต์ไม่สำเร็จ:", err);
      setError(errorMessage(err));
    }
  }

  function handlePostSaved() {
    resetOverrides();
    setReloadKey((k) => k + 1);
  }

  async function handleFollow() {
    if (!profile || !user || pending.has(`follow:${profile.id}`)) return;

    await runPending(`follow:${profile.id}`, async () => {
      try {
        await toggleFollow({
          targetId: profile.id,
          userId: user.id,
          following: profile.isFollowing,
        });
        setReloadKey((k) => k + 1);
      } catch (err) {
        console.error("ติดตามไม่สำเร็จ:", err);
        setError(errorMessage(err));
      }
    });
  }

  // พาไปหน้าข้อความแบบ "ยังไม่เปิดห้องจริง" — เดิมเรียก startDirectConversation
  // ตรงนี้เลย ทำให้มีห้องว่างเปล่าโผล่ในกล่องข้อความของอีกฝ่ายทันทีที่กดปุ่ม
  // ทั้งที่ยังไม่ได้พิมพ์อะไรเลย หน้า /messages จะเป็นคนสร้างห้องจริงเองตอนกด
  // ส่งข้อความแรกเท่านั้น (ดู Messages.jsx)
  function handleMessage() {
    if (!profile || !user) return;
    navigate(`/messages?to=${profile.id}`);
  }

  const photos = visiblePosts.filter((post) => post.coverImage);

  return (
    <div className="cm">
      <AppHeader />

      <main className="cmp__main">
        <button type="button" className="cm-back" onClick={() => navigate("/community")}>
          ← กลับสู่ชุมชน
        </button>

        {loading && !profile && <p className="cm__empty">กำลังโหลดโปรไฟล์...</p>}
        {!loading && !profile && profileError && <p className="cm__empty">{profileError}</p>}

        {profile && (
          <>
            <section className="cm-card cmp__header">
              <div
                className="cmp__cover"
                aria-hidden="true"
                style={profile.cover ? { backgroundImage: `url(${profile.cover})` } : undefined}
              />

              <div className="cmp__identity">
                {profile.avatar ? (
                  <img src={profile.avatar} alt="" className="cmp__avatar" />
                ) : (
                  <span className="cmp__avatar" aria-hidden="true" />
                )}

                <div>
                  <h1 className="cmp__name">{profile.name}</h1>
                  <p className="cmp__handle">
                    {profile.username ? `@${profile.username}` : ""}
                    {profile.joinedAt
                      ? ` · เข้าร่วมเมื่อ ${joinedFormatter.format(new Date(profile.joinedAt))}`
                      : ""}
                  </p>
                  <div className="cmp__sports">
                    {profile.sports.map((sport) => (
                      <span key={sport} className="cm-chip cm-chip--sm">
                        {sport}
                      </span>
                    ))}
                  </div>
                </div>

                {/* โปรไฟล์ตัวเองไม่ต้องมีปุ่มติดตาม/ส่งข้อความ พาไปหน้าแก้ไขแทน */}
                <div className="cmp__buttons">
                  {isSelf ? (
                    <button
                      type="button"
                      className="cmp__dm"
                      onClick={() => navigate("/profile/edit")}
                    >
                      แก้ไขโปรไฟล์
                    </button>
                  ) : (
                    <>
                      <button type="button" className="cmp__follow" onClick={handleFollow}>
                        {profile.isFollowing ? "✓ กำลังติดตาม" : "+ ติดตาม"}
                      </button>
                      <button type="button" className="cmp__dm" onClick={handleMessage}>
                        💬 ส่งข้อความ
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="cmp__stats">
                <div>
                  <p className="cmp__stat-value">{profile.postCount.toLocaleString()}</p>
                  <p className="cmp__stat-label">โพสต์</p>
                </div>
                <div>
                  <p className="cmp__stat-value">{profile.followerCount.toLocaleString()}</p>
                  <p className="cmp__stat-label">ผู้ติดตาม</p>
                </div>
                <div>
                  <p className="cmp__stat-value">{profile.followingCount.toLocaleString()}</p>
                  <p className="cmp__stat-label">กำลังติดตาม</p>
                </div>
                <div>
                  <p className="cmp__stat-value">{profile.teamPostCount.toLocaleString()}</p>
                  <p className="cmp__stat-label">โพสต์หาทีม</p>
                </div>
              </div>

              {profile.bio && <p className="cmp__bio">{profile.bio}</p>}
            </section>

            {error && <p className="cm__error">{error}</p>}

            <nav className="cmp__tabs">
              {TABS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`cm-chip cmp__tab ${item === tab ? "cm-chip--active" : ""}`}
                  onClick={() => setTab(item)}
                >
                  {item}
                </button>
              ))}
            </nav>

            <div className="cmp__layout">
              <section className="cmp__posts">
                {tab === "โพสต์" && visiblePosts.length === 0 && (
                  <div className="cm-card cmp__placeholder">ยังไม่มีโพสต์</div>
                )}

                {tab === "โพสต์" &&
                  visiblePosts.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      authorName={profile.name}
                      authorAvatar={profile.avatar}
                      isOwner={isSelf}
                      onOpen={(p) => navigate(`/community/post/${p.id}`)}
                      onLike={handleLike}
                      onBookmark={handleBookmark}
                      onEdit={setEditingPost}
                      onDelete={handleDeletePost}
                      onReport={(p) => setReportTarget({ postId: p.id })}
                    />
                  ))}

                {tab === "เกี่ยวกับ" && (
                  <>
                    <div className="cm-card cmp__about-card">
                      <h3 className="cmp__about-title">
                        <span aria-hidden="true">📝</span> แนะนำตัว
                      </h3>

                      {profile.bio ? (
                        <p className="cm-body">{profile.bio}</p>
                      ) : (
                        <div className="cmp__about-empty">
                          <p>
                            {isSelf
                              ? "คุณยังไม่ได้เขียนแนะนำตัว"
                              : "ผู้ใช้รายนี้ยังไม่ได้เขียนแนะนำตัว"}
                          </p>
                          {isSelf && (
                            <button
                              type="button"
                              className="cmp__about-cta"
                              onClick={() => navigate("/profile/edit")}
                            >
                              เขียนแนะนำตัว
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="cm-card cmp__about-card">
                      <h3 className="cmp__about-title">
                        <span aria-hidden="true">🏅</span> กีฬาที่เล่น
                      </h3>

                      {profile.sports.length > 0 ? (
                        <div className="cmp__about-sports">
                          {profile.sports.map((sport) => (
                            <div key={sport} className="cmp__about-sport">
                              <img src={sportImage(sport)} alt="" className="cmp__about-sport-img" />
                              <span>{sport}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="cmp__about-empty-text">ยังไม่ได้เลือกกีฬาที่เล่น</p>
                      )}
                    </div>

                    {profile.joinedAt && (
                      <div className="cm-card cmp__about-highlight">
                        <span className="cmp__about-highlight-icon" aria-hidden="true">
                          🎉
                        </span>
                        <div>
                          <p className="cmp__about-highlight-title">
                            เข้าร่วมเมื่อ {joinedFullFormatter.format(new Date(profile.joinedAt))}
                          </p>
                          <p className="cmp__about-highlight-desc">
                            {membershipDuration(profile.joinedAt)}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {tab === "รูปภาพ" &&
                  (photos.length === 0 ? (
                    <div className="cm-card cmp__placeholder">ยังไม่มีรูปภาพ</div>
                  ) : (
                    <div className="cmp__photos">
                      {photos.map((post) => (
                        <img
                          key={post.id}
                          src={post.coverImage}
                          alt=""
                          className="cmp__photo"
                          onClick={() => navigate(`/community/post/${post.id}`)}
                        />
                      ))}
                    </div>
                  ))}
              </section>

              <aside className="cmp__side">
                <div className="cm-card cmp__panel">
                  <h2 className="cmp__panel-title">ข้อมูลทั่วไป</h2>

                  {[
                    { icon: "📍", label: "พื้นที่", value: profile.area },
                    { icon: "🏟️", label: "สนามประจำ", value: profile.homeVenue },
                    { icon: "🕐", label: "เวลาที่สะดวก", value: profile.availableTime },
                  ]
                    .filter((item) => item.value)
                    .map((item) => (
                      <div key={item.label} className="cmp__info">
                        <p className="cmp__info-label">
                          <span aria-hidden="true">{item.icon}</span> {item.label}
                        </p>
                        <p className="cmp__info-value">{item.value}</p>
                      </div>
                    ))}

                  {!profile.area && !profile.homeVenue && !profile.availableTime && (
                    <p className="cmp__info-label">ยังไม่ได้กรอกข้อมูลส่วนนี้</p>
                  )}
                </div>

                {/* ซ่อนทั้งกล่องเมื่อไม่มีเพื่อนร่วมกัน (และบนโปรไฟล์ตัวเอง
                    ที่ยังไงก็ไม่มีความหมาย) แทนที่จะขึ้นหัวข้อค้างไว้เฉย ๆ */}
                {!isSelf && mutuals.length > 0 && (
                  <div className="cm-card cmp__panel">
                    <h2 className="cmp__panel-title">เพื่อนร่วมกัน {mutuals.length} คน</h2>

                    {mutuals.map((mutual) => (
                      <div key={mutual.id} className="cmp__mutual">
                        {mutual.avatar ? (
                          <img src={mutual.avatar} alt="" className="cm-avatar cm-avatar--xs" />
                        ) : (
                          <span className="cm-avatar cm-avatar--xs" aria-hidden="true" />
                        )}
                        <span className="cmp__mutual-name">{mutual.name}</span>
                        <button
                          type="button"
                          className="cmp__mutual-link"
                          onClick={() => navigate(`/community/profile/${mutual.id}`)}
                        >
                          ดูโปรไฟล์
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
      </main>

      {editingPost && (
        <CreatePostDialog
          userId={user?.id}
          authorName={profile?.name}
          authorAvatar={profile?.avatar}
          categories={categories}
          editingPost={{
            id: editingPost.id,
            content: editingPost.content,
            categoryId: editingPost.categoryId,
            coverImage: editingPost.coverImage,
          }}
          onClose={() => setEditingPost(null)}
          onCreated={handlePostSaved}
        />
      )}

      {reportTarget && (
        <ReportDialog
          postId={reportTarget.postId}
          onClose={() => setReportTarget(null)}
          onDone={() => setError("")}
        />
      )}
    </div>
  );
}
