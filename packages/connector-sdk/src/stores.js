import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256, sha256Hex, stableStringify } from "./hash.js";

export class InMemoryRawArtifactStore {
  constructor() {
    this.artifacts = new Map();
  }

  async putIfAbsent({ tenant_id, environment, source_name, source_version, content, content_type = "application/octet-stream", metadata = {} }) {
    const digest = sha256(content);
    const digestToken = digest.replace("sha256:", "");
    const uri = `memory://raw-artifacts/${encodeURIComponent(tenant_id)}/${encodeURIComponent(environment)}/${encodeURIComponent(source_name)}/${encodeURIComponent(source_version)}/${digestToken}`;
    const existing = this.artifacts.get(uri);
    if (existing) {
      return { ...existing, created: false };
    }
    const artifact = {
      uri,
      digest,
      size_bytes: Buffer.byteLength(typeof content === "string" ? content : stableStringify(content)),
      content_type,
      metadata,
      content
    };
    this.artifacts.set(uri, artifact);
    return { ...artifact, created: true };
  }
}

export class FileSystemRawArtifactStore {
  constructor({ rootDir }) {
    this.rootDir = rootDir;
  }

  async putIfAbsent({ tenant_id, environment, source_name, source_version, content, content_type = "application/octet-stream", metadata = {} }) {
    const digest = sha256(content);
    const digestToken = digest.replace("sha256:", "");
    const artifactPath = join(this.rootDir, tenant_id, environment, source_name, source_version, `${digestToken}.raw`);
    const manifestPath = `${artifactPath}.manifest.json`;
    const artifact = {
      uri: artifactPath,
      digest,
      size_bytes: Buffer.byteLength(typeof content === "string" ? content : stableStringify(content)),
      content_type,
      metadata
    };
    await mkdir(dirname(artifactPath), { recursive: true });
    try {
      await writeFile(artifactPath, typeof content === "string" ? content : stableStringify(content), { flag: "wx" });
      await writeFile(manifestPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
      return { ...artifact, created: true };
    } catch (error) {
      if (error.code === "EEXIST") {
        return { ...artifact, created: false };
      }
      throw error;
    }
  }
}

export class InMemoryCheckpointStore {
  constructor() {
    this.checkpoints = new Map();
  }

  async load(key) {
    return this.checkpoints.get(key) ?? null;
  }

  async save(key, checkpoint) {
    this.checkpoints.set(key, checkpoint);
    return checkpoint;
  }
}

export class InMemoryNormalizedRecordStore {
  constructor() {
    this.records = new Map();
  }

  async upsert(record) {
    const existing = this.records.get(record.idempotency_key);
    if (existing) {
      return { record: existing, created: false };
    }
    this.records.set(record.idempotency_key, record);
    return { record, created: true };
  }
}

export function checkpointKey(runIdentity) {
  return `checkpoint:${sha256Hex(runIdentity)}`;
}
