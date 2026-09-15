// แปลงเนื้อหาข่าวจากข้อความดิบเป็น React element ตอนแสดงผล
//
// เนื้อหาข่าวเก็บเป็นข้อความธรรมดาที่มี syntax ง่าย ๆ ซึ่ง toolbar ใน
// AdminNewsEditor แทรกให้ (ดู applyFormatting ในหน้านั้น):
//   **ตัวหนา**   *ตัวเอียง*   <u>ขีดเส้นใต้</u>
//   > ข้อความคำพูด (นำหน้าแต่ละบรรทัด)
//   - รายการ (นำหน้าแต่ละบรรทัด)
//   [ข้อความลิงก์](url)   ![คำอธิบายรูป](url)
//
// syntax ที่นี่ต้องตรงกับที่ toolbar แทรกเสมอ ไม่งั้นปุ่มในหน้าแอดมินจะกลาย
// เป็นปุ่มที่กดแล้วไม่มีผลกับหน้าที่ผู้อ่านเห็น
//
// ไม่ใช้ dangerouslySetInnerHTML เพื่อไม่เปิดช่องให้ข้อความที่พิมพ์เข้ามา
// บังเอิญมีรูปแบบคล้าย HTML ถูกตีความเป็น markup จริง — ข้อความที่ไม่ตรงกับ
// syntax ที่รู้จักจะโดน React escape เป็นตัวอักษรธรรมดาเสมอ

const INLINE_REGEX =
  /\*\*(.+?)\*\*|\*(.+?)\*|<u>(.+?)<\/u>|!\[(.*?)\]\((\S+?)\)|\[(.+?)\]\((\S+?)\)/g;
const STANDALONE_IMAGE_REGEX = /^!\[(.*)\]\((\S+)\)$/;

// กันลิงก์/รูปที่ผู้เขียนแปะ url แบบ javascript:/data: มาโดยไม่ได้ตั้งใจ (หรือ
// ตั้งใจ) ไม่ให้ถูก render เป็น href/src จริง — รับเฉพาะ URL แบบ http(s),
// protocol-relative หรือ path สัมพัทธ์ในเว็บเราเอง
function isSafeUrl(url) {
  return /^(https?:)?\/\//i.test(url) || url.startsWith("/");
}

function renderInline(text, keyPrefix) {
  const nodes = [];
  let lastIndex = 0;
  let key = 0;
  let match;

  INLINE_REGEX.lastIndex = 0;
  while ((match = INLINE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));

    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${key++}`}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${key++}`}>{match[2]}</em>);
    } else if (match[3] !== undefined) {
      nodes.push(<u key={`${keyPrefix}-${key++}`}>{match[3]}</u>);
    } else if (match[4] !== undefined) {
      const src = match[5];
      nodes.push(
        isSafeUrl(src) ? (
          <img
            key={`${keyPrefix}-${key++}`}
            src={src}
            alt={match[4]}
            className="news-content__image news-content__image--inline"
          />
        ) : (
          match[4]
        ),
      );
    } else if (match[6] !== undefined) {
      const href = match[7];
      nodes.push(
        isSafeUrl(href) ? (
          <a key={`${keyPrefix}-${key++}`} href={href} target="_blank" rel="noreferrer">
            {match[6]}
          </a>
        ) : (
          match[6]
        ),
      );
    }

    lastIndex = INLINE_REGEX.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function parseBlocks(content) {
  const lines = (content ?? "").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const imageMatch = line.trim().match(STANDALONE_IMAGE_REGEX);
    if (imageMatch) {
      blocks.push({ type: "image", alt: imageMatch[1], src: imageMatch[2] });
      i++;
      continue;
    }

    if (line.startsWith("> ") || line === ">") {
      const quoteLines = [];
      while (i < lines.length && (lines[i].startsWith("> ") || lines[i] === ">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    if (line.startsWith("- ")) {
      const items = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("> ") &&
      !lines[i].startsWith("- ") &&
      !STANDALONE_IMAGE_REGEX.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", lines: paraLines });
  }

  return blocks;
}

export function renderNewsContent(content) {
  return parseBlocks(content).map((block, i) => {
    const key = `b${i}`;

    if (block.type === "image") {
      if (!isSafeUrl(block.src)) return null;
      return <img key={key} src={block.src} alt={block.alt} className="news-content__image" />;
    }

    if (block.type === "quote") {
      return (
        <blockquote key={key} className="news-content__quote">
          {block.lines.map((line, li) => (
            <p key={li}>{renderInline(line, `${key}-${li}`)}</p>
          ))}
        </blockquote>
      );
    }

    if (block.type === "list") {
      return (
        <ul key={key} className="news-content__list">
          {block.items.map((item, li) => (
            <li key={li}>{renderInline(item, `${key}-${li}`)}</li>
          ))}
        </ul>
      );
    }

    return (
      <p key={key}>
        {block.lines.map((line, li) => (
          <span key={li}>
            {renderInline(line, `${key}-${li}`)}
            {li < block.lines.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  });
}

// ใช้กับ excerpt (ตัดข้อความสั้น ๆ ไว้โชว์บนการ์ด) — ตัด syntax ทิ้งให้เหลือ
// ข้อความอ่านง่าย ไม่โชว์เครื่องหมาย ** * [] () ดิบ ๆ ปนอยู่
export function stripNewsFormatting(content) {
  return (content ?? "")
    .replace(/!\[(.*?)\]\(\S+?\)/g, "$1")
    .replace(/\[(.*?)\]\(\S+?\)/g, "$1")
    .replace(/<\/?u>/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^- /gm, "")
    .replace(/\n+/g, " ")
    .trim();
}
