import { readFileSync, writeFileSync } from "node:fs";

export class JsonFileReleaseLedger {
  constructor({ ledgerPath }) {
    this.ledgerPath = ledgerPath;
  }

  async insertReleaseMetadata(record) {
    assertReleaseMetadataRecord(record);
    const existing = readJsonLines(this.ledgerPath);
    if (existing.some((row) =>
      row.tenant_id === record.tenant_id &&
      row.environment === record.environment &&
      row.release_id === record.release_id
    )) {
      throw new Error(`release metadata row already exists for ${record.tenant_id}/${record.environment}/${record.release_id}`);
    }
    writeFileSync(this.ledgerPath, `${JSON.stringify(record)}\n`, { flag: "a" });
    return record;
  }
}

export class PostgresReleaseLedger {
  constructor({ client, releaseWorkflowServiceAccountId = null }) {
    if (!client || typeof client.query !== "function") {
      throw new Error("PostgresReleaseLedger requires a transaction-scoped Postgres client with query(sql, values)");
    }
    this.client = client;
    this.releaseWorkflowServiceAccountId = releaseWorkflowServiceAccountId;
  }

  async insertReleaseMetadata(record) {
    assertReleaseMetadataRecord(record);
    if (record.created_by_user_id) {
      throw new Error("PostgresReleaseLedger inserts must use the release-workflow service account path");
    }
    if (this.releaseWorkflowServiceAccountId && record.created_by_service_account_id !== this.releaseWorkflowServiceAccountId) {
      throw new Error("PostgresReleaseLedger created_by_service_account_id does not match release workflow service account");
    }

    const columns = [
      "tenant_id",
      "environment",
      "release_id",
      "semantic_version",
      "status",
      "release_candidate_id",
      "previous_release_id",
      "manifest_uri",
      "manifest_digest",
      "ontology_digest",
      "shape_digest",
      "source_version_pins",
      "included_graphs",
      "validation_report_refs",
      "changelog_uri",
      "artifact_hashes",
      "approval_trace",
      "audit_event_range",
      "rollback_target_release_id",
      "created_by_user_id",
      "created_by_service_account_id"
    ];
    const values = columns.map((column) => jsonbColumnNames.has(column) ? JSON.stringify(record[column]) : record[column]);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const result = await this.client.query(
      `INSERT INTO pharmaops.release_metadata (${columns.join(", ")})
VALUES (${placeholders.join(", ")})
RETURNING ${columns.join(", ")}, created_at, updated_at`,
      values
    );
    if (!result.rows?.[0]) {
      throw new Error("PostgresReleaseLedger insert returned no release_metadata row");
    }
    return result.rows[0];
  }
}

export class NoopReleaseLedger {
  async insertReleaseMetadata(record) {
    assertReleaseMetadataRecord(record);
    return record;
  }
}

export function assertReleaseMetadataRecord(record) {
  for (const field of ["tenant_id", "environment", "release_id", "semantic_version", "status", "manifest_uri", "manifest_digest"]) {
    if (!record[field]) {
      throw new Error(`release metadata record missing required field: ${field}`);
    }
  }
  const hasUser = Boolean(record.created_by_user_id);
  const hasServiceAccount = Boolean(record.created_by_service_account_id);
  if (hasUser === hasServiceAccount) {
    throw new Error("release metadata record requires exactly one creator column");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(record.manifest_digest)) {
    throw new Error("release metadata manifest_digest must be sha256-prefixed hex");
  }
  assertNonEmptyArray(record.source_version_pins, "source_version_pins");
  assertNonEmptyArray(record.included_graphs, "included_graphs");
  assertNonEmptyArray(record.validation_report_refs, "validation_report_refs");
  assertNonEmptyArray(record.approval_trace, "approval_trace");
  assertNonEmptyObject(record.artifact_hashes, "artifact_hashes");
  if (!record.audit_event_range?.first || !record.audit_event_range?.last) {
    throw new Error("release metadata audit_event_range requires first and last event identifiers");
  }
  return true;
}

const jsonbColumnNames = new Set([
  "source_version_pins",
  "included_graphs",
  "validation_report_refs",
  "artifact_hashes",
  "approval_trace",
  "audit_event_range"
]);

function assertNonEmptyArray(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`release metadata ${fieldName} must be a non-empty array`);
  }
}

function assertNonEmptyObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) {
    throw new Error(`release metadata ${fieldName} must be a non-empty object`);
  }
}

function readJsonLines(path) {
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
