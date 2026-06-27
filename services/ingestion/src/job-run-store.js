import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export class LocalJobRunStore {
  constructor({ runLogPath }) {
    if (!runLogPath) {
      throw new Error("LocalJobRunStore requires runLogPath");
    }
    this.runLogPath = resolve(runLogPath);
  }

  async record(snapshot) {
    await mkdir(dirname(this.runLogPath), { recursive: true });
    await appendFile(this.runLogPath, `${JSON.stringify(snapshot)}\n`);
    return snapshot;
  }

  async readAll() {
    try {
      const body = await readFile(this.runLogPath, "utf8");
      return body.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

export class MemoryJobRunStore {
  constructor() {
    this.snapshots = [];
  }

  async record(snapshot) {
    this.snapshots.push(snapshot);
    return snapshot;
  }

  async readAll() {
    return [...this.snapshots];
  }
}
