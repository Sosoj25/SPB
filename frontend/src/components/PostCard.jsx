// การ์ดโพสต์ตัวเดียวที่ใช้ร่วมกันทั้งฟีดหลักและแท็บ "โพสต์" บนโปรไฟล์
// ห้ามก็อปมาร์กอัปนี้ไปไว้ในหน้าใดหน้าหนึ่ง ไม่งั้นสองหน้าจะมีปุ่มไม่ครบเท่ากัน
//
// authorName/authorAvatar รับแยกจาก post เพราะหน้าโปรไฟล์อยากใช้ชื่อ/รูป
// เจ้าของโปรไฟล์เสมอ (โพสต์ทุกอันในหน้านั้นเป็นของคนเดียวกันอยู่แล้ว) ส่วน
// ฟีดรวมอยากใช้ post.author/post.authorAvatar ของแต่ละโพสต์
import { useState } from "react";
import { Bookmark, Flag, Heart, MessageCircle, Pencil, Pin, Star, Trash2 } from "lucide-react";
import ClampText from "./ClampText";
import PostImageGrid from "./PostImageGrid";
import ReviewPostBody from "./ReviewPostBody";
import { isReviewPost, parseReviewPost, relativeTime } from "../lib/community";

export default function PostCard({
  post,
  authorName,
  authorAvatar,
  isOwner,
  onOpen,
  onLike,
  onBookmark,
  onEdit,
  onDelete,
  onReport,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // โพสต์หมวด "รีวิว" แสดงเป็นบล็อกคะแนนแทนข้อความดิบ (ดู ReviewPostBody)
  const review = parseReviewPost(post);

  return (
    <article
      className={`cm-card cm__post ${review ? "cm__post--review" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(post)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(post);
      }}
    >
      <header className="cm__post-head">
        {authorAvatar ? (
          <img src={authorAvatar} alt="" className="cm-avatar" />
        ) : (
          <span className="cm-avatar" aria-hidden="true" />
        )}
        <div>
          <p className="cm-name">{authorName}</p>
          <p className="cm-time">
            {relativeTime(post.createdAt)}
            {post.isEdited && " · แก้ไขแล้ว"}
          </p>
        </div>

        <span className="cm__post-tags">
          {post.isPinned && <span className="cm-chip cm-chip--sm">
              <Pin size={13} aria-hidden="true" /> ปักหมุด
            </span>}
          <span className={`cm-chip ${review ? "cm-chip--review" : ""}`}>
            {review ? (
              <>
                <Star size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" /> รีวิวสนาม
              </>
            ) : (
              post.category
            )}
          </span>

          {/* เมนู ⋯ — เจ้าของได้แก้ไข/ลบ คนอื่นได้รายงาน */}
          <span className="cm__menu" role="presentation" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="cm__menu-trigger"
              aria-label="ตัวเลือกโพสต์"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
            >
              ⋯
            </button>

            {menuOpen && (
              <span className="cm__menu-panel" role="menu">
                {isOwner ? (
                  <>
                    {/* รีวิวแก้ไม่ได้ — หมวดนี้ถูก policy ฝั่ง DB บล็อกการอัปเดต
                        ไว้ (0080) กดไปก็ได้แต่ error ปุ่มจึงไม่ควรมีให้กด */}
                    {!isReviewPost(post) && (
                      <button
                        type="button"
                        className="cm__menu-item"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onEdit(post);
                        }}
                      >
                        <Pencil size={15} aria-hidden="true" /> แก้ไขโพสต์
                      </button>
                    )}
                    <button
                      type="button"
                      className="cm__menu-item cm__menu-item--danger"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onDelete(post);
                      }}
                    >
                      <Trash2 size={15} aria-hidden="true" /> ลบโพสต์
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="cm__menu-item cm__menu-item--danger"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onReport(post);
                    }}
                  >
                    <Flag size={15} aria-hidden="true" /> รายงานโพสต์
                  </button>
                )}
              </span>
            )}
          </span>
        </span>
      </header>

      {review ? (
        <ReviewPostBody review={review} />
      ) : (
        <>
          {post.title && <h3 className="cm__post-title">{post.title}</h3>}
          {post.content && <ClampText text={post.content} className="cm-body cm__post-body" />}
        </>
      )}

      <PostImageGrid images={post.images} />

      <div className="cm-actions">
        <button
          type="button"
          className={`cm-action ${post.isLiked ? "cm-action--on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onLike(post);
          }}
        >
          <Heart
            size={17}
            aria-hidden="true"
            fill={post.isLiked ? "currentColor" : "none"}
          />{" "}
          ถูกใจ {post.likeCount}
        </button>
        <span className="cm-action">
          <MessageCircle size={17} aria-hidden="true" /> ความคิดเห็น{" "}
          {post.commentCount}
        </span>
        <button
          type="button"
          className={`cm-action ${post.isBookmarked ? "cm-action--on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onBookmark(post);
          }}
        >
          <Bookmark
            size={17}
            aria-hidden="true"
            fill={post.isBookmarked ? "currentColor" : "none"}
          />{" "}
          {post.isBookmarked ? "บันทึกแล้ว" : "บันทึก"}
        </button>
      </div>
    </article>
  );
}
