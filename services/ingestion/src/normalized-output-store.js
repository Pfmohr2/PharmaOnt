import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { sha256 } from "./canonical.js";

export class MemoryNormalizedOutputStore {
  constructor() {
    this.records = new Map();
  }

  async putIfAbsent(output) {
    const key = output?.idempotency_key;
    if (!key) {
      throw new Error("normalized output idempotency_key is required");
    }
    const existing = this.records.get(key);
    if (existing) {
      return { created: false, record: existing };
    }
    const record = { ...output };
    this.records.set(key, record);
    return { created: true, record };
  }

  async readAll() {
    return [...this.records.values()];
  }
}

export class LocalNormalizedOutputStore {
  constructor({ rootDir }) {
    if (!rootDir) {
      throw new Error("LocalNormalizedOutputStore requires rootDir");
    }
    this.rootDir = resolve(rootDir);
  }

  async putIfAbsent(output) {
    const key = output?.idempotency_key;
    if (!key) {
      throw new Error("normalized output idempotency_key is required");
    }
    const outputPath = join(this.rootDir, `${sha256(key)}.json`);
    try {
      const existing = JSON.parse(await readFile(outputPath, "utf8"));
      return { created: false, record: existing };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    await mkdir(this.rootDir, { recursive: true });
    const record = { ...output };
    try {
      await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
      return { created: true, record };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      const existing = JSON.parse(await readFile(outputPath, "utf8"));
      return { created: false, record: existing };
    }
  }
}
