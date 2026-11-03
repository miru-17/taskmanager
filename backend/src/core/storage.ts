import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { config } from "./config";

/**
 * File storage behind a small interface, so local disk (fine for one server) can be
 * swapped for S3-compatible storage later without touching the attachment code.
 */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
}

/** Keys are generated here, never from user input: "ab/<64 hex chars>". */
export const newStorageKey = () => {
  const id = randomBytes(32).toString("hex");
  return `${id.slice(0, 2)}/${id}`;
};

const KEY = /^[a-f0-9]{2}\/[a-f0-9]{64}$/;

class LocalDiskStorage implements Storage {
  private readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Defence in depth: even a malformed key can't escape the upload folder. */
  private resolve(key: string) {
    if (!KEY.test(key)) throw new Error("Invalid storage key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: "wx", mode: 0o640 }); // never overwrite
  }

  async read(key: string) {
    const full = this.resolve(key);
    await stat(full); // throws ENOENT before headers are sent
    return createReadStream(full);
  }

  async remove(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

export const storage: Storage = new LocalDiskStorage(config.UPLOAD_DIR);
