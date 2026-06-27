import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { filterAuthorizedResults, isExportRegulatedResultComplete } from "../../authz-filter/src/index.js";
import {
  PILOT_SOURCE_LICENSE_PACKET_PATH,
  evaluatePilotSourceLicenseExportRequest
} from "../../ops/src/source-license-export-approval.js";

const REQUIRED_EXPORT_ID_FIELDS = Object.freeze(["id"]);

export class SourceLicenseExportPolicyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SourceLicenseExportPolicyError";
    this.details = details;
  }
}

export function buildAuthorizedExport({
  principal,
  candidateResults,
  export_id,
  releaseContext = null,
  format = "json",
  sourceLicenseApprovalPacket = null,
  requestedScopes = [],
  action = "export.create"
}) {
  const authorizedRows = filterAuthorizedResults({
    principal,
    results: candidateResults,
    action: "export",
    releaseContext
  });
  const rows = authorizedRows.filter(isExportRegulatedResultComplete);
  const droppedForMissingFields = authorizedRows.length - rows.length;
  if (!sourceLicenseApprovalPacket && requiresSourceLicenseApprovalPacket({ rows })) {
    throw missingSourceLicenseApprovalPacketError({
      principal,
      export_id,
      requestedScopes,
      action
    });
  }
  const sourceLicensePolicy = sourceLicenseApprovalPacket
    ? enforceSourceLicenseApprovalPacket({
        packet: sourceLicenseApprovalPacket,
        principal,
        rows,
        requestedScopes,
        action,
        export_id
      })
    : null;
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
    source_license_policy: sourceLicensePolicy,
    manifest_digest: sha256({
      export_id,
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      release_id: releaseContext?.release_id ?? principal.release_id ?? null,
      format,
      record_count: rows.length,
      source_license_policy: sourceLicensePolicy
        ? {
            approval_ids: sourceLicensePolicy.approval_ids,
            requested_scopes: sourceLicensePolicy.requested_scopes,
            audit_event_id: sourceLicensePolicy.audit_event?.audit_event_id ?? null,
            packet_digest: sourceLicenseApprovalPacket.packet_digest ?? null
          }
        : null,
      rows: rows.map(canonicalExportRow)
    })
  };
}

function requiresSourceLicenseApprovalPacket({ rows }) {
  return rows.some((row) => !isExplicitlyUngovernedExportRow(row));
}

function isExplicitlyUngovernedExportRow(row) {
  return [
    row?.source_key,
    row?.source_name,
    row?.source_version,
    row?.source_vocabulary,
    row?.source_vocabulary_version,
    row?.target_vocabulary,
    row?.target_vocabulary_version,
    row?.source_terms_uri,
    row?.license?.source_terms_uri
  ].every((value) => !nonEmpty(value)) &&
    !Array.isArray(row?.underlying_source_refs) &&
    !Array.isArray(row?.source_refs) &&
    !Array.isArray(row?.evidence_refs) &&
    String(row?.license_policy_id ?? "").startsWith("license-policy:internal:") &&
    String(row?.provenance_id ?? "").startsWith("pharmprov:internal:");
}

function missingSourceLicenseApprovalPacketError({
  principal,
  export_id,
  requestedScopes,
  action
}) {
  const auditEvent = {
    audit_event_id: `audit:${sha256({
      export_id,
      action,
      reason: "missing-source-license-approval-packet"
    }).slice("sha256:".length, "sha256:".length + 24)}`,
    event_type: action === "export.create"
      ? "source_license_export.creation_denied"
      : "source_license_export.preview_denied",
    tenant_id: principal?.tenant_id ?? null,
    environment: principal?.environment ?? null,
    status: "denied",
    metadata: {
      requested_export_scopes: [...requestedScopes],
      blocks: ["missing source-license approval packet for governed source export"]
    }
  };
  return new SourceLicenseExportPolicyError("source-license approval packet is required for governed export request", {
    export_id,
    action,
    requested_scopes: requestedScopes,
    denied_scopes: [],
    blocks: auditEvent.metadata.blocks,
    approval_ids: [],
    audit_event: auditEvent
  });
}

export async function readSourceLicenseApprovalPacket({
  packetPath = PILOT_SOURCE_LICENSE_PACKET_PATH
} = {}) {
  return JSON.parse(await readFile(packetPath, "utf8"));
}

export function enforceSourceLicenseApprovalPacket({
  packet,
  principal,
  rows,
  requestedScopes,
  action,
  export_id
}) {
  const evaluation = evaluatePilotSourceLicenseExportRequest({
    packet,
    principal,
    sourceRows: rows,
    requestedScopes,
    action,
    exportId: export_id
  });
  if (!evaluation.allowed || (action === "export.create" && !evaluation.export_job_creatable)) {
    throw new SourceLicenseExportPolicyError("source-license approval packet denied export request", {
      export_id,
      action,
      requested_scopes: requestedScopes,
      denied_scopes: evaluation.denied_scopes,
      blocks: evaluation.blocks,
      approval_ids: evaluation.approval_ids,
      audit_event: evaluation.audit_event
    });
  }
  return {
    ...evaluation,
    requested_scopes: [...requestedScopes]
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
    source_key: row.source_key ?? null,
    source_name: row.source_name ?? null,
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
    source_terms_uri: row.source_terms_uri ?? row.license?.source_terms_uri ?? null,
    license_conditions: row.license_conditions ?? row.license?.conditions ?? null,
    permitted_uses: row.permitted_uses ?? row.license?.permitted_uses ?? [],
    export_restrictions: row.export_restrictions ?? row.license?.export_restrictions ?? [],
    disclaimer_ids: row.disclaimer_ids ?? row.license?.disclaimer_ids ?? [],
    audit_event_ids: row.audit_event_ids ?? [],
    row_hashes: row.row_hashes ?? []
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
