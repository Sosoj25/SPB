// จัดการชุมชน — คิวรายงาน โพสต์ ความคิดเห็น หมวดหมู่ และสมาชิกที่ถูกรายงาน
import { useEffect, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, Pagination, Pill, SearchBox } from "../components/DashboardWidgets";
import TextPromptDialog from "../components/TextPromptDialog";
import {
  useAdminCommunityComments,
  useAdminCommunityPosts,
  useAdminCommunityStats,
  useCategoryStats,
  usePendingReports,
  useReportedUsers,
} from "../hooks/useAdminCommunity";
import { useAuth } from "../context/useAuth";
import {
  POST_FILTERS,
  REPORT_FILTERS,
  createCategory,
  deleteCategory,
  isSystemCategory,
  deleteComment,
  deletePost,
  renameCategory,
  resolveReport,
  setPostHidden,
  setPostPinned,
  subscribeToReports,
} from "../lib/adminCommunity";
import { setUserActive } from "../lib/admin";
import { relativeTime } from "../lib/community";
import { errorMessage } from "../lib/errors";
import "./AdminCommunity.css";

const numberFormatter = new Intl.NumberFormat("th-TH");

const TABS = [
  { key: "posts", label: "โพสต์" },
  { key: "comments", label: "ความคิดเห็น" },
];

const COMMENT_FILTERS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "reported", label: "ถูกรายงาน" },
];

export default function AdminCommunity() {
  const { user } = useAuth();

  const [tab, setTab] = useState("posts");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [categoryDialog, setCategoryDialog] = useState(null);
  const [reportGroup, setReportGroup] = useState("");
  // นับเฉพาะรายงานที่เข้ามา "ระหว่างที่หน้านี้เปิดค้างอยู่" — แยกจาก
  // stats.newReports24h ที่เป็นยอดสะสมของวัน ไม่งั้นแถบเตือนจะขึ้นค้างทุกครั้ง
  // ที่เปิดหน้าแม้ไม่มีอะไรใหม่เลยตั้งแต่ครั้งก่อน
  const [liveReports, setLiveReports] = useState(0);

  const { stats } = useAdminCommunityStats(reloadKey);
  const {
    posts,
    total: postTotal,
    hasMore: postsHasMore,
    loading: postsLoading,
    error: postsError,
  } = useAdminCommunityPosts({ filter, query: query || undefined, page, reloadKey });
  const {
    comments,
    total: commentTotal,
    hasMore: commentsHasMore,
    loading: commentsLoading,
    error: commentsError,
  } = useAdminCommunityComments({ filter, query: query || undefined, page, reloadKey });
  const { reports } = usePendingReports(reportGroup, reloadKey);
  const { categories } = useCategoryStats(reloadKey);
  const { users: reportedUsers } = useReportedUsers(reloadKey);

  // รายงานใหม่เด้งเข้ามาเองโดยไม่ต้องกดรีเฟรช (0052 เปิด Realtime ให้
  // community_reports แล้ว) — ตั้งใจไม่ดึงข้อมูลใหม่อัตโนมัติ เพราะแอดมินอาจ
  // กำลังอ่านใบใดใบหนึ่งอยู่ แล้วรายการกระโดดสลับที่กลางคัน ให้ขึ้นแถบบอกแล้ว
  // กดโหลดเองเมื่อพร้อม
  useEffect(() => subscribeToReports(() => setLiveReports((n) => n + 1)), []);

  const onPosts = tab === "posts";
  const total = onPosts ? postTotal : commentTotal;
  const hasMore = onPosts ? postsHasMore : commentsHasMore;
  const loading = onPosts ? postsLoading : commentsLoading;
  const listError = onPosts ? postsError : commentsError;
  const shownCount = onPosts ? posts.length : comments.length;

  function refresh() {
    setActionError("");
    setLiveReports(0);
    setReloadKey((key) => key + 1);
  }

  function selectTab(key) {
    setTab(key);
    setFilter("all");
    setPage(1);
  }

  function selectFilter(key) {
    setFilter(key);
    setPage(1);
  }

  // ทุกปุ่มบนหน้านี้แก้ข้อมูลจริงทันที จึงห่อด้วยตัวจัดการเดียวกันหมด — ล็อก
  // ปุ่มระหว่างทำงาน โชว์ error ที่แถบบน แล้วดึงข้อมูลใหม่เมื่อสำเร็จ
  async function run(id, action) {
    if (busyId) return;

    setActionError("");
    setBusyId(id);

    try {
      await action();
      setReloadKey((key) => key + 1);
    } catch (err) {
      console.error("จัดการชุมชนไม่สำเร็จ:", err);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  function handleDelete(post) {
    const preview = post.content.slice(0, 40);
    const ok = window.confirm(
      `ลบโพสต์ของ ${post.author} ใช่ไหม?\n\n"${preview}${post.content.length > 40 ? "..." : ""}"\n\nโพสต์จะหายจากหน้าเว็บทันที`,
    );
    if (!ok) return;

    run(post.id, () => deletePost(post.id, user.id));
  }

  function handleDeleteComment(comment) {
    const ok = window.confirm(
      `ลบความคิดเห็นของ ${comment.author} ใช่ไหม?\n\n"${comment.content.slice(0, 60)}"`,
    );
    if (!ok) return;

    run(comment.id, () => deleteComment(comment.id));
  }

  function handleReportAction(report, action) {
    const key = report.postId ?? report.commentId;

    if (action === "delete") {
      const ok = window.confirm(
        `ลบเนื้อหาที่ถูกรายงาน ${report.reportCount} ครั้งนี้ใช่ไหม?\n\n"${report.content.slice(0, 60)}"`,
      );
      if (!ok) return;
    }

    run(key, () =>
      resolveReport({ postId: report.postId, commentId: report.commentId, action }),
    );
  }

  function handleSuspend(target) {
    const ok = window.confirm(
      target.isActive
        ? `ระงับบัญชีของ ${target.name} ใช่ไหม?\n\nผู้ใช้จะเข้าสู่ระบบไม่ได้ และโพสต์ทั้งหมดของเขาจะหายจากฟีดทันที`
        : `เปิดใช้งานบัญชีของ ${target.name} อีกครั้งใช่ไหม?\nโพสต์ทั้งหมดจะกลับมาแสดงในฟีด`,
    );
    if (!ok) return;

    run(target.id, () => setUserActive(target.id, !target.isActive));
  }

  function handleDeleteCategory(category) {
    const ok = window.confirm(
      `ลบหมวดหมู่ "${category.name}" ใช่ไหม?\nลบได้เฉพาะหมวดที่ไม่มีโพสต์อยู่แล้ว`,
    );
    if (!ok) return;

    run(`cat-${category.id}`, () => deleteCategory(category));
  }

  function submitCategoryDialog(value) {
    const dialog = categoryDialog;
    setCategoryDialog(null);

    if (dialog.mode === "create") {
      run("new-category", () => createCategory({ name: value }));
    } else {
      run(`cat-${dialog.category.id}`, () => renameCategory(dialog.category, value));
    }
  }

  const filterCounts = {
    all: stats.totalPosts,
    reported: stats.flaggedPosts,
    pinned: stats.pinnedPosts,
    hidden: stats.hiddenPosts,
  };

  return (
    <DashboardLayout
      variant="admin"
      title="จัดการชุมชน"
      subtitle="ดูแลโพสต์ ความคิดเห็น หมวดหมู่ และรายงานการละเมิดในหน้าชุมชน"
      headerExtra={
        <button type="button" className="dash-btn admin-cm__refresh" onClick={refresh}>
          ⟳ รีเฟรชรายการ
        </button>
      }
    >
      <section className="dash-kpi">
        <div className="stat-card">
          <p className="stat-card__value admin-cm__kpi--primary">
            {numberFormatter.format(stats.totalPosts)}
          </p>
          <p className="stat-card__label">โพสต์ทั้งหมด</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__value admin-cm__kpi--danger">{stats.pendingReports}</p>
          <p className="stat-card__label">
            รายงานที่รอตรวจสอบ
            {stats.newReports24h > 0 && (
              <span className="admin-cm__kpi-new"> · ใหม่วันนี้ {stats.newReports24h}</span>
            )}
          </p>
        </div>
        <div className="stat-card">
          <p className="stat-card__value admin-cm__kpi--warning">{stats.suspendedMembers}</p>
          <p className="stat-card__label">สมาชิกที่ถูกระงับ</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__value admin-cm__kpi--primary">
            {numberFormatter.format(stats.totalMembers)}
          </p>
          <p className="stat-card__label">สมาชิกทั้งหมด</p>
        </div>
      </section>

      <nav className="admin-cm__tabs">
        {TABS.map((item) => (
          <Pill key={item.key} active={item.key === tab} onClick={() => selectTab(item.key)}>
            {item.label} (
            {numberFormatter.format(
              item.key === "posts" ? stats.totalPosts : stats.totalComments,
            )}
            )
          </Pill>
        ))}
      </nav>

      <div className="dash-filters">
        {(onPosts ? POST_FILTERS : COMMENT_FILTERS).map((item) => (
          <Pill
            key={item.key}
            active={item.key === filter}
            onClick={() => selectFilter(item.key)}
          >
            {item.label}
            {onPosts && item.key !== "all" && ` (${filterCounts[item.key] ?? 0})`}
          </Pill>
        ))}
        <div className="dash-filters__spacer" />
        <SearchBox
          placeholder={onPosts ? "ค้นหาโพสต์" : "ค้นหาความคิดเห็น"}
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
        />
      </div>

      {liveReports > 0 && (
        <div className="dash-message admin-cm__live" role="status">
          <span>
            🔔 มีรายงานใหม่เข้ามา {liveReports} รายการระหว่างที่คุณเปิดหน้านี้อยู่
          </span>
          <button type="button" className="dash-btn" onClick={refresh}>
            โหลดคิวใหม่
          </button>
        </div>
      )}

      {actionError && <div className="dash-message dash-message--error">{actionError}</div>}

      <div className="admin-cm__layout">
        <div className="dash-card admin-cm__posts">
          <header className="admin-cm__card-head">
            <h2 className="admin-cm__card-title">
              {onPosts ? "โพสต์ล่าสุด" : "ความคิดเห็นล่าสุด"}
            </h2>
            <Badge tone="tint">
              {numberFormatter.format(total)} {onPosts ? "โพสต์" : "ความคิดเห็น"}
            </Badge>
          </header>

          {loading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}
          {!loading && listError && (
            <div className="dash-message dash-message--error">{listError}</div>
          )}
          {!loading && !listError && shownCount === 0 && (
            <p className="dash-empty">ไม่มีรายการในเงื่อนไขนี้</p>
          )}

          {!loading &&
            onPosts &&
            posts.map((post) => (
              <article
                key={post.id}
                className={`admin-cm__post ${
                  post.reportCount > 0 ? "admin-cm__post--flagged" : ""
                }`}
              >
                <header className="admin-cm__post-head">
                  {post.authorAvatar ? (
                    <img src={post.authorAvatar} alt="" className="admin-cm__avatar" />
                  ) : (
                    <span className="admin-cm__avatar" aria-hidden="true" />
                  )}

                  <div className="admin-cm__post-who">
                    <p className="admin-cm__post-author">
                      {post.author}
                      {post.authorSuspended && <Badge tone="danger">ถูกระงับ</Badge>}
                    </p>
                    <p className="admin-cm__post-meta">
                      {relativeTime(post.createdAt)} · {post.category}
                    </p>
                  </div>

                  <div className="admin-cm__post-tags">
                    {post.reportCount > 0 && (
                      <span className="admin-cm__flag">⚑ ถูกรายงาน {post.reportCount}</span>
                    )}
                    {post.status === "hidden" && (
                      <Badge tone="warning">
                        {post.hiddenByAdmin ? "แอดมินซ่อน" : "เจ้าของซ่อน"}
                      </Badge>
                    )}
                    {post.isPinned && <Badge tone="tint">📌 ปักหมุด</Badge>}
                  </div>
                </header>

                <p className="admin-cm__post-body">{post.content}</p>

                <footer className="admin-cm__post-foot">
                  <span className="admin-cm__stat">♡ {post.likeCount}</span>
                  <span className="admin-cm__stat">💬 {post.commentCount}</span>

                  <div className="admin-cm__post-actions">
                    <button
                      type="button"
                      className="dash-btn"
                      disabled={busyId === post.id}
                      onClick={() => run(post.id, () => setPostPinned(post.id, !post.isPinned))}
                    >
                      {post.isPinned ? "เลิกปักหมุด" : "ปักหมุด"}
                    </button>
                    <button
                      type="button"
                      className="dash-btn"
                      disabled={busyId === post.id}
                      onClick={() =>
                        run(post.id, () =>
                          setPostHidden(post.id, post.status !== "hidden", user.id),
                        )
                      }
                    >
                      {post.status === "hidden" ? "เลิกซ่อน" : "ซ่อนโพสต์"}
                    </button>
                    <button
                      type="button"
                      className="dash-btn dash-btn--cancel"
                      disabled={busyId === post.id}
                      onClick={() => handleDelete(post)}
                    >
                      ลบโพสต์
                    </button>
                  </div>
                </footer>
              </article>
            ))}

          {!loading &&
            !onPosts &&
            comments.map((comment) => (
              <article
                key={comment.id}
                className={`admin-cm__post ${
                  comment.reportCount > 0 ? "admin-cm__post--flagged" : ""
                }`}
              >
                <header className="admin-cm__post-head">
                  {comment.authorAvatar ? (
                    <img src={comment.authorAvatar} alt="" className="admin-cm__avatar" />
                  ) : (
                    <span className="admin-cm__avatar" aria-hidden="true" />
                  )}

                  <div className="admin-cm__post-who">
                    <p className="admin-cm__post-author">
                      {comment.author}
                      {comment.authorSuspended && <Badge tone="danger">ถูกระงับ</Badge>}
                    </p>
                    <p className="admin-cm__post-meta">
                      {relativeTime(comment.createdAt)} · ใต้โพสต์ &ldquo;
                      {comment.postTitle.slice(0, 40)}&rdquo;
                    </p>
                  </div>

                  <div className="admin-cm__post-tags">
                    {comment.reportCount > 0 && (
                      <span className="admin-cm__flag">⚑ ถูกรายงาน {comment.reportCount}</span>
                    )}
                  </div>
                </header>

                <p className="admin-cm__post-body">{comment.content}</p>

                <footer className="admin-cm__post-foot">
                  <div className="admin-cm__post-actions">
                    <a
                      className="dash-btn"
                      href={`/community/post/${comment.postId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ดูในหน้าโพสต์
                    </a>
                    <button
                      type="button"
                      className="dash-btn dash-btn--cancel"
                      disabled={busyId === comment.id}
                      onClick={() => handleDeleteComment(comment)}
                    >
                      ลบความคิดเห็น
                    </button>
                  </div>
                </footer>
              </article>
            ))}

          {!loading && shownCount > 0 && (
            <div className="admin-cm__pager">
              <p className="admin-cm__pager-text">
                แสดง {shownCount} จาก {numberFormatter.format(total)}{" "}
                {onPosts ? "โพสต์" : "ความคิดเห็น"}
              </p>
              <Pagination page={page} hasMore={hasMore} onChange={setPage} />
            </div>
          )}
        </div>

        <aside className="admin-cm__side">
          <section className="dash-card admin-cm__panel admin-cm__panel--alert">
            <h2 className="admin-cm__panel-title">
              ⚠ รอตรวจสอบ {stats.pendingReports} รายการ
            </h2>

            {/* แยกตามหมวดของเหตุผล — เรื่อง "หลอกลวง/ฉ้อโกง" ต้องรีบกว่าเรื่อง
                "สแปม" มาก การให้ทุกใบกองรวมกันเรียงตามจำนวนคนรายงานอย่างเดียว
                ทำให้เรื่องด่วนที่มีคนเห็นแค่คนเดียวจมอยู่ล่างสุด */}
            <div className="admin-cm__report-filters">
              {REPORT_FILTERS.map((item) => (
                <Pill
                  key={item.key || "all"}
                  active={item.key === reportGroup}
                  onClick={() => setReportGroup(item.key)}
                >
                  {item.label}
                </Pill>
              ))}
            </div>

            {reports.length === 0 && (
              <p className="dash-empty">
                {reportGroup ? "ไม่มีรายงานค้างอยู่ในหมวดนี้" : "ไม่มีรายงานค้างอยู่"}
              </p>
            )}

            {reports.map((report) => {
              const key = report.postId ?? report.commentId;

              return (
                <div key={key} className="admin-cm__report">
                  <div className="admin-cm__report-head">
                    <Badge tone="danger">{report.reportCount} รายงาน</Badge>
                    <Badge tone="warning">{report.topGroup}</Badge>
                    <span className="admin-cm__report-time">
                      ล่าสุด {relativeTime(report.lastReportedAt)}
                    </span>
                  </div>

                  {report.title && (
                    <p className="admin-cm__report-title">{report.title}</p>
                  )}

                  <p className="admin-cm__report-content">
                    {report.content.slice(0, 120)}
                    {report.content.length > 120 ? "..." : ""}
                  </p>

                  <p className="admin-cm__report-meta">
                    {report.targetType === "comment" ? "ความคิดเห็น" : "โพสต์"} ของ {report.author}
                  </p>

                  {/* เหตุผลพร้อมจำนวนคนที่เลือกข้อนั้น — ใบรายงานหนึ่งใบเลือกได้
                      ถึง 3 ข้อ (0052) ตัวเลขจึงเป็นตัวบอกว่าคนส่วนใหญ่ติดใจเรื่องอะไร */}
                  <div className="admin-cm__report-reasons">
                    {report.reasons.map((reason) => (
                      <span key={reason.value} className="admin-cm__reason">
                        {reason.label}
                        {reason.count > 1 && (
                          <span className="admin-cm__reason-count">{reason.count}</span>
                        )}
                      </span>
                    ))}
                  </div>

                  {report.notes.length > 0 && (
                    <p className="admin-cm__report-note">
                      “{report.notes[0]}”
                      {report.notes.length > 1 && ` (+อีก ${report.notes.length - 1} ความเห็น)`}
                    </p>
                  )}

                  <div className="admin-cm__report-actions">
                    {/* กดเข้าไปดูของจริงในบริบทของมัน — รายงานคอมเมนต์เปิดโพสต์
                        แม่ให้ ไม่ใช่ปล่อยให้แอดมินตัดสินจากข้อความที่ตัดมา
                        แค่บรรทัดเดียว (posts_public_read มี or is_admin() อยู่แล้ว
                        โพสต์ที่ซ่อนไว้จึงยังเปิดดูได้) */}
                    {report.linkPostId && (
                      <a
                        className="dash-btn"
                        href={`/community/post/${report.linkPostId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        ดูโพสต์
                      </a>
                    )}
                    <button
                      type="button"
                      className="dash-btn dash-btn--cancel"
                      disabled={busyId === key}
                      onClick={() => handleReportAction(report, "delete")}
                    >
                      ลบเนื้อหา
                    </button>
                    <button
                      type="button"
                      className="dash-btn"
                      disabled={busyId === key}
                      onClick={() => handleReportAction(report, "dismiss")}
                    >
                      เพิกเฉย
                    </button>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="dash-card admin-cm__panel">
            <header className="admin-cm__card-head">
              <h2 className="admin-cm__panel-title">หมวดหมู่ชุมชน</h2>
              <button
                type="button"
                className="dash-btn dash-btn--add"
                onClick={() => setCategoryDialog({ mode: "create" })}
              >
                ＋ เพิ่ม
              </button>
            </header>

            {/* หมวด "รีวิว" ระบบใช้โพสต์รีวิวให้ผู้ใช้อัตโนมัติ (submit_review()
                ค้นหาหมวดนี้จากชื่อ) ลบหรือเปลี่ยนชื่อทีเดียวรีวิวใหม่จะหยุดลง
                ชุมชนเงียบ ๆ — ปุ่มแก้/ลบจึงไม่มีให้กด เหลือแค่ป้ายบอกว่าเป็น
                หมวดของระบบ (ฝั่งฐานข้อมูลกันไว้อีกชั้นใน 0095) */}
            {categories.map((category) => (
              <div key={category.id} className="admin-cm__category">
                <span className="admin-cm__category-name">{category.name}</span>
                <span className="admin-cm__category-count">
                  {numberFormatter.format(category.postCount)} โพสต์
                </span>

                {isSystemCategory(category) ? (
                  <span
                    className="admin-cm__category-system"
                    title="หมวดของระบบ ใช้โพสต์รีวิวอัตโนมัติ จึงลบหรือเปลี่ยนชื่อไม่ได้"
                  >
                    🔒 ระบบ
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="admin-cm__category-edit"
                      aria-label={`แก้ชื่อหมวด ${category.name}`}
                      disabled={busyId === `cat-${category.id}`}
                      onClick={() => setCategoryDialog({ mode: "rename", category })}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="admin-cm__category-edit admin-cm__category-edit--danger"
                      aria-label={`ลบหมวด ${category.name}`}
                      disabled={busyId === `cat-${category.id}`}
                      onClick={() => handleDeleteCategory(category)}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}
          </section>

          <section className="dash-card admin-cm__panel">
            <h2 className="admin-cm__panel-title">ผู้ใช้ที่ถูกรายงานบ่อย</h2>

            {reportedUsers.length === 0 && (
              <p className="dash-empty">ยังไม่มีผู้ใช้ที่ถูกรายงาน</p>
            )}

            {reportedUsers.map((target) => (
              <div key={target.id} className="admin-cm__user">
                {target.avatar ? (
                  <img src={target.avatar} alt="" className="admin-cm__avatar" />
                ) : (
                  <span className="admin-cm__avatar" aria-hidden="true" />
                )}
                <div className="admin-cm__user-info">
                  <p className="admin-cm__user-name">{target.name}</p>
                  <p className="admin-cm__user-meta">
                    ถูกรายงาน {target.reportCount} ครั้ง
                    {target.pendingCount > 0 && ` · ค้าง ${target.pendingCount}`}
                  </p>
                  {target.topReasons.length > 0 && (
                    <p className="admin-cm__user-meta">{target.topReasons.join(" · ")}</p>
                  )}
                </div>
                <button
                  type="button"
                  className={`dash-btn ${target.isActive ? "dash-btn--cancel" : ""}`}
                  disabled={busyId === target.id}
                  onClick={() => handleSuspend(target)}
                >
                  {target.isActive ? "ระงับ" : "เปิดใช้"}
                </button>
              </div>
            ))}
          </section>
        </aside>
      </div>

      {categoryDialog && (
        <TextPromptDialog
          title={categoryDialog.mode === "create" ? "เพิ่มหมวดหมู่ใหม่" : "แก้ชื่อหมวดหมู่"}
          label="ชื่อหมวดหมู่"
          initialValue={categoryDialog.category?.name ?? ""}
          confirmLabel={categoryDialog.mode === "create" ? "เพิ่ม" : "บันทึก"}
          onSubmit={submitCategoryDialog}
          onClose={() => setCategoryDialog(null)}
        />
      )}
    </DashboardLayout>
  );
}
