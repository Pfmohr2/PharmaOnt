import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { materializeContent, sha256 } from "./canonical.js";

export class LocalRawArtifactStore {
  constructor({ rootDir }) {
    if (!rootDir) {
      throw new Error("LocalRawArtifactStore requires rootDir");
    }
    this.rootDir = resolve(rootDir);
  }

  async putArtifact({
    tenantId,
    environment,
    connectorId,
    sourceName,
    sourceVersion,
    sourceRecordId,
    content,
    contentType = "application/json",
    metadata = {}
  }) {
    assertNonEmpty(tenantId, "tenantId");
    assertNonEmpty(environment, "environment");
    assertNonEmpty(connectorId, "connectorId");
    assertNonEmpty(sourceName, "sourceName");
    assertNonEmpty(sourceVersion, "sourceVersion");
    assertNonEmpty(sourceRecordId, "sourceRecordId");

    const bytes = materializeContent(content);
    const digest = `sha256:${sha256(bytes)}`;
    const relativePath = join(
      "tenants",
      safeSegment(tenantId),
      safeSegment(environment),
      "connectors",
      safeSegment(connectorId),
      "raw",
      "sources",
      safeSegment(sourceName),
      "versions",
      safeSegment(sourceVersion),
      "records",
      safeSegment(sourceRecordId),
      `${digest.slice("sha256:".length)}.artifact`
    );
    const artifactPath = join(this.rootDir, relativePath);
    await mkdir(dirname(artifactPath), { recursive: true });

    let existed = false;
    try {
      await writeFile(artifactPath, bytes, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      existed = true;
    }

    const metadataPath = `${artifactPath}.metadata.json`;
    const metadataRecord = {
      tenant_id: tenantId,
      environment,
      connector_id: connectorId,
      source_name: sourceName,
      source_version: sourceVersion,
      source_record_id: sourceRecordId,
      artifact_digest: digest,
      content_type: contentType,
      size_bytes: Buffer.byteLength(bytes),
      metadata
    };
    try {
      await writeFile(metadataPath, `${JSON.stringify(metadataRecord, null, 2)}\n`, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }

    const artifactStat = await stat(artifactPath);
    return {
      uri: pathToFileURL(artifactPath).href,
      path: artifactPath,
      digest,
      size_bytes: artifactStat.size,
      content_type: contentType,
      existed
    };
  }
}

export function safeSegment(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128) || "unknown";
}

function assertNonEmpty(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} is required for raw artifact persistence`);
  }
}
