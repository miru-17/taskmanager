/**
 * Allow-list of attachment types. The stored MIME type comes from this table (never from
 * the browser), and the file's first bytes must match what its extension claims, so a
 * renamed executable or an HTML page posing as an image is rejected.
 */

type Check = (b: Buffer) => boolean;

const starts = (sig: number[], offset = 0): Check => (b) => sig.every((byte, i) => b[offset + i] === byte);
const ZIP = starts([0x50, 0x4b, 0x03, 0x04]);
const OLE = starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // legacy .doc/.xls/.ppt

/** Text files: valid UTF-8 without NUL bytes or an HTML/SVG/script prologue. */
const TEXT: Check = (b) => {
  const head = b.subarray(0, 8192);
  if (head.includes(0)) return false;
  const text = head.toString("utf8");
  if (text.includes("�")) return false;
  return !/^\s*<(\?xml|!doctype|html|svg|script)/i.test(text);
};

interface FileType {
  mime: string;
  check: Check;
  /** Safe to show in the browser (images and PDF); everything else downloads */
  inline: boolean;
}

export const FILE_TYPES: Record<string, FileType> = {
  png: { mime: "image/png", check: starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), inline: true },
  jpg: { mime: "image/jpeg", check: starts([0xff, 0xd8, 0xff]), inline: true },
  jpeg: { mime: "image/jpeg", check: starts([0xff, 0xd8, 0xff]), inline: true },
  gif: { mime: "image/gif", check: (b) => starts([0x47, 0x49, 0x46, 0x38])(b), inline: true },
  webp: { mime: "image/webp", check: (b) => starts([0x52, 0x49, 0x46, 0x46])(b) && starts([0x57, 0x45, 0x42, 0x50], 8)(b), inline: true },
  pdf: { mime: "application/pdf", check: starts([0x25, 0x50, 0x44, 0x46, 0x2d]), inline: true },
  txt: { mime: "text/plain", check: TEXT, inline: false },
  md: { mime: "text/markdown", check: TEXT, inline: false },
  csv: { mime: "text/csv", check: TEXT, inline: false },
  json: { mime: "application/json", check: TEXT, inline: false },
  log: { mime: "text/plain", check: TEXT, inline: false },
  zip: { mime: "application/zip", check: ZIP, inline: false },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", check: ZIP, inline: false },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", check: ZIP, inline: false },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", check: ZIP, inline: false },
  odt: { mime: "application/vnd.oasis.opendocument.text", check: ZIP, inline: false },
  ods: { mime: "application/vnd.oasis.opendocument.spreadsheet", check: ZIP, inline: false },
  doc: { mime: "application/msword", check: OLE, inline: false },
  xls: { mime: "application/vnd.ms-excel", check: OLE, inline: false },
  ppt: { mime: "application/vnd.ms-powerpoint", check: OLE, inline: false },
};

export const extensionOf = (name: string) => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
};

/** Keeps only the base name, strips control and path characters, caps the length. */
export const safeFileName = (raw: string) => {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/^\.+/, "").trim();
  if (!cleaned) return "file";
  if (cleaned.length <= 200) return cleaned;
  const ext = extensionOf(cleaned);
  return `${cleaned.slice(0, 200 - ext.length - 1)}.${ext}`;
};

export const detect = (fileName: string, data: Buffer): FileType | null => {
  const type = FILE_TYPES[extensionOf(fileName)];
  if (!type || !data.length || !type.check(data)) return null;
  return type;
};

export const isInline = (mime: string) => Object.values(FILE_TYPES).some((t) => t.inline && t.mime === mime);
