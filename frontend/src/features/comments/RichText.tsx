import type { ReactNode } from "react";

/**
 * Renders comment text as React elements, never as HTML, so nothing a user types can run.
 * Supports **bold**, *italic*, `code`, http(s) links, line breaks and @mentions.
 */
const PATTERN = /(@\[([^\]\n]{1,80})\]\(user:(\d{1,10})\))|(`[^`\n]{1,500}`)|(\*\*[^*\n]{1,500}\*\*)|(\*[^*\n]{1,500}\*)|(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)'\]])/g;

const inline = (line: string, keyBase: string, meId?: number): ReactNode[] => {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of line.matchAll(PATTERN)) {
    if (m.index! > last) out.push(line.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[1]) {
      const mine = Number(m[3]) === meId;
      out.push(
        <span key={key} className={mine ? "rounded bg-accent/20 px-1 font-medium text-accent" : "rounded bg-accent/10 px-1 font-medium text-accent"} data-mention={m[3]}>
          @{m[2]}
        </span>
      );
    } else if (m[4]) out.push(<code key={key} className="rounded bg-elev-2 px-1 py-px text-[0.85em]">{m[4].slice(1, -1)}</code>);
    else if (m[5]) out.push(<strong key={key}>{m[5].slice(2, -2)}</strong>);
    else if (m[6]) out.push(<em key={key}>{m[6].slice(1, -1)}</em>);
    else if (m[7])
      out.push(
        <a key={key} href={m[7]} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-accent underline underline-offset-2 break-all">
          {m[7]}
        </a>
      );
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
};

const RichText = ({ text, meId }: { text: string; meId?: number }) => (
  <div className="text-sm leading-relaxed text-fg break-words whitespace-pre-wrap">
    {text.split("\n").map((line, i, all) => (
      <span key={i}>
        {inline(line, String(i), meId)}
        {i < all.length - 1 && "\n"}
      </span>
    ))}
  </div>
);

export default RichText;
