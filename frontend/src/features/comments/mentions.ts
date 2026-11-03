export interface Mention {
  id: number;
  name: string;
}

const TOKEN = /@\[([^\]\n]{1,80})\]\(user:(\d{1,10})\)/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Stored body → what the person edits ("@Sam") plus the mentions it contained. */
export const decodeMentions = (body: string): { text: string; mentions: Mention[] } => {
  const mentions: Mention[] = [];
  const text = body.replace(TOKEN, (_m, name: string, id: string) => {
    if (!mentions.some((x) => x.id === Number(id))) mentions.push({ id: Number(id), name });
    return `@${name}`;
  });
  return { text, mentions };
};

/** "@Sam" chosen from the picker → the stored token. Typed-but-not-picked names stay plain text. */
export const encodeMentions = (text: string, mentions: Mention[]): string => {
  let out = text;
  // Longest names first so "@Sam Lee" wins over "@Sam"
  for (const m of [...mentions].sort((a, b) => b.name.length - a.name.length)) {
    out = out.replace(new RegExp(`(^|[^\\w\\]])@${escapeRe(m.name)}(?![\\w])`, "g"), (_all, pre: string) => `${pre}@[${m.name}](user:${m.id})`);
  }
  return out;
};

/** The "@query" being typed right before the caret, if any. */
export const activeQuery = (text: string, caret: number): { start: number; query: string } | null => {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
  return m ? { start: before.length - m[2].length - 1, query: m[2] } : null;
};
