import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export class LocalDeadLetterQueue {
  constructor({ queuePath }) {
    if (!queuePath) {
      throw new Error("LocalDeadLetterQueue requires queuePath");
    }
    this.queuePath = resolve(queuePath);
  }

  async enqueue(entry) {
    await mkdir(dirname(this.queuePath), { recursive: true });
    const record = {
      queued_at: new Date().toISOString(),
      replay_status: "pending",
      ...entry
    };
    await appendFile(this.queuePath, `${JSON.stringify(record)}\n`);
    return record;
  }

  async readAll() {
    try {
      const body = await readFile(this.queuePath, "utf8");
      return body.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

export class MemoryDeadLetterQueue {
  constructor() {
    this.entries = [];
  }

  async enqueue(entry) {
    const record = {
      queued_at: new Date().toISOString(),
      replay_status: "pending",
      ...entry
    };
    this.entries.push(record);
    return record;
  }

  async readAll() {
    return [...this.entries];
  }
}
