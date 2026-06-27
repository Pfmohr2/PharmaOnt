import { createHash } from "node:crypto";
import { filterAuthorizedResults, isExportRegulatedResultComplete } from "../../authz-filter/src/index.js";

const REQUIRED_EXPORT_ID_FIELDS = Object.freeze(["id"]);

export function buildAuthorizedExport({
  principal,
  candidateResults,
  export_id,
  releaseContext = null,
  format = "json"
}) {
  const authorizedRows = filterAuthorizedResults({
    principal,
    results: candidateResults,
    action: "export",
    releaseContext
  });
  const rows = authorizedRows.filter(isExportRegulatedResultComplete);
  const droppedForMissingFields = authorizedRows.length - rows.length;
  const row_content_hashes = rows.map((row) => buildExportRowContentHash(row));
  return {
    export_id,
    tenant_id: principal.tenant_id,
    environment: principal.environment,
    format,
    authorization_filtered: true,
    record_count: rows.length,
    invalid_record_count: droppedForMissingFields,
    rows,
    row_content_hashes,
    manifest_digest: sha256({
      export_id,
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      release_id: releaseContext?.release_id ?? principal.release_id ?? null,
      format,
      record_count: rows.length,
      rows: rows.map(canonicalExportRow)
    })
  };
}

export function assertExportRowComplete(row) {
  const missing = missingExportFields(row);
  if (missing.length > 0) {
    throw new Error(`export row missing required regulated fields: ${missing.join(", ")}`);
  }
  return true;
}

export function missingExportFields(row) {
  const missing = [];
  for (const field of REQUIRED_EXPORT_ID_FIELDS) {
    if (!nonEmpty(row?.[field])) {
      missing.push(field);
    }
  }
  for (const field of ["tenant_id", "environment", "release_id", "provenance_id", "artifact_hash", "license_status", "license_policy_id"]) {
    if (!nonEmpty(row?.[field])) {
      missing.push(field);
    }
  }
  if (!nonEmpty(row?.license_classification ?? row?.license?.classification ?? row?.license?.license_classification)) {
    missing.push("license_classification");
  }
  if (requiresVocabularyVersions(row)) {
    for (const field of ["source_vocabulary_version", "target_vocabulary_version"]) {
      if (!nonEmpty(row?.[field])) {
        missing.push(field);
      }
    }
  }
  return missing;
}

export function canonicalExportRow(row) {
  assertExportRowComplete(row);
  return sortValue({
    id: row.id,
    resource_id: row.resource_id ?? null,
    semantic_object_id: row.semantic_object_id ?? null,
    tenant_id: row.tenant_id,
    environment: row.environment,
    assertion_type: row.assertion_type ?? row.result_type ?? null,
    release_id: row.release_id,
    lifecycle_status: row.lifecycle_status ?? null,
    review_status: row.review_status ?? null,
    provenance_id: row.provenance_id,
    source_vocabulary: row.source_vocabulary ?? null,
    source_vocabulary_version: row.source_vocabulary_version ?? null,
    target_vocabulary: row.target_vocabulary ?? null,
    target_vocabulary_version: row.target_vocabulary_version ?? null,
    source_version: row.source_version ?? null,
    artifact_hash: row.artifact_hash,
    content_hash: row.content_hash ?? null,
    manifest_digest: row.manifest_digest ?? null,
    evidence_ids: row.evidence_ids ?? [],
    license_status: row.license_status,
    license_classification: row.license_classification ?? row.license?.classification ?? row.license?.license_classification,
    license_policy_id: row.license_policy_id,
    permitted_uses: row.permitted_uses ?? row.license?.permitted_uses ?? [],
    export_restrictions: row.export_restrictions ?? row.license?.export_restrictions ?? []
  });
}

export function buildExportRowContentHash(row) {
  return sha256(canonicalExportRow(row));
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex")}`;
}

function requiresVocabularyVersions(row) {
  const assertionType = String(row?.assertion_type ?? row?.result_type ?? "");
  return ["mapping", "synonym", "relationship", "canonical", "approved", "released"].includes(assertionType);
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
