import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chemblMetadata } from "../../../connectors/chembl/src/index.js";
import { uniprotMetadata } from "../../../connectors/uniprot/src/index.js";
import { sha256, stableStringify } from "../../../packages/connector-sdk/src/hash.js";
import { PILOT_TENANT_ID } from "./pilot-provisioning.js";

export const PILOT_SOURCE_LICENSE_PACKET_SCHEMA = "pilot-source-license-export-approval.v1";
export const PILOT_SOURCE_LICENSE_PACKET_PATH = ".generated/source-license-approvals/tenant-pilot-antiplatelet.source-license-export-approval-packet.json";
export const PILOT_SOURCE_LICENSE_CORRELATION_ID = "corr:pilot-source-license-export-approval";

export const PILOT_SOURCE_LICENSE_ENVIRONMENTS = Object.freeze(["staging", "controlled-prod"]);
export const CONTROLLED_PROD_PENDING_STATUS = "approved_pending_promotion_gates";
export const STAGING_ACTIVE_STATUS = "approved_active";

export const COMMON_APPROVED_EXPORT_SCOPES = Object.freeze([
  "export.preview",
  "export.release_manifest",
  "export.released_curated_assertions",
  "export.provenance_metadata",
  "export.license_metadata",
  "export.source_version_pins",
  "export.artifact_hashes",
  "export.public_evidence_pointers",
  "export.public_evidence_snippets_metadata_only"
]);

export const MANUAL_CURATION_EXTRA_APPROVED_EXPORT_SCOPES = Object.freeze([
  "export.approval_trace",
  "export.rationale_digest",
  "export.audit_event_ids",
  "export.row_hashes"
]);

export const DENIED_EXPORT_SCOPES = Object.freeze([
  "export.working_graph_unapproved",
  "export.model_suggested_unapproved",
  "export.hidden_only_scope",
  "export.raw_restricted_evidence",
  "export.raw_connector_payload_bulk",
  "export.phi",
  "export.pii",
  "export.unpinned_source_versions",
  "export.faers_openfda",
  "export.external_bulk_redistribution_without_legal_review"
]);

const PILOT_RELEASE_ID = "mvp-2026-06-27-rc1";
const PILOT_RELEASE_CANDIDATE_ID = "rc:mvp-2026-06-27";
const APPROVAL_TIME = "2026-06-27T13:25:00.000Z";
const DEFAULT_ACTOR = "user:compliance-legal:source-license-approver";

export function buildPilotSourceLicenseApprovalPacket({
  actor = DEFAULT_ACTOR,
  approvedAt = APPROVAL_TIME,
  mode = "approval-packet"
} = {}) {
  const sourceRecords = [
    sourceDefinition("chembl", chemblMetadata({ sourceVersion: "CHEMBL_34" }), {
      license_name: "CC BY-SA 3.0",
      license_obligations: [
        "attribution_required",
        "sharealike_review_required",
        "CC BY-SA 3.0 ShareAlike terms reviewed and accepted by compliance/legal"
      ]
    }),
    sourceDefinition("uniprot", uniprotMetadata({ sourceVersion: "2026_02" }), {
      license_name: "CC BY 4.0",
      license_obligations: [
        "attribution_required",
        "CC BY 4.0 attribution requirements reviewed and accepted by compliance/legal"
      ]
    }),
    manualCurationDefinition()
  ];

  const approvals = PILOT_SOURCE_LICENSE_ENVIRONMENTS.flatMap((environment) =>
    sourceRecords.map((source) => approvalRecord({ source, environment, actor, approvedAt }))
  );

  const disabledSources = [
    disabledSourceRecord("openfda_faers", "openFDA FAERS", "not_in_this_approval_packet"),
    disabledSourceRecord("internal_phi_pii", "Internal PHI/PII", "prohibited_for_pilot_export_scope")
  ];

  const auditEvents = [
    ...approvals.flatMap((approval) => [
      sourceLicenseAuditEvent("source_license.approval_record_created", approval.approval_id, actor, {
        environment: approval.environment,
        status: approval.status
      }),
      sourceLicenseAuditEvent("source_license.export_scopes_approved", approval.approval_id, actor, {
        environment: approval.environment,
        approved_export_scopes: approval.approved_export_scopes
      })
    ]),
    ...disabledSources.map((source) =>
      sourceLicenseAuditEvent("source_license.source_denied", source.disabled_source_id, actor, {
        environment: "all",
        denied_reason: source.denied_reason
      })
    ),
    sourceLicenseAuditEvent("source_license.denied_scopes_recorded", `${PILOT_TENANT_ID}:all:denied-export-scopes`, actor, {
      environment: "all",
      denied_export_scopes: DENIED_EXPORT_SCOPES
    })
  ];

  const body = {
    schema_version: PILOT_SOURCE_LICENSE_PACKET_SCHEMA,
    mode,
    tenant_id: PILOT_TENANT_ID,
    release_id: PILOT_RELEASE_ID,
    release_candidate_id: PILOT_RELEASE_CANDIDATE_ID,
    approved_at: approvedAt,
    approved_by: actor,
    environments: PILOT_SOURCE_LICENSE_ENVIRONMENTS.map((environment) => ({
      tenant_id: PILOT_TENANT_ID,
      environment,
      status: environment === "controlled-prod" ? CONTROLLED_PROD_PENDING_STATUS : STAGING_ACTIVE_STATUS,
      promotable: false,
      controlled_prod_resources_created: false
    })),
    approved_export_scopes: COMMON_APPROVED_EXPORT_SCOPES,
    manual_curation_extra_approved_export_scopes: MANUAL_CURATION_EXTRA_APPROVED_EXPORT_SCOPES,
    denied_export_scopes: DENIED_EXPORT_SCOPES,
    approvals,
    disabled_sources: disabledSources,
    controls: {
      no_controlled_prod_promotion: true,
      controlled_prod_status: CONTROLLED_PROD_PENDING_STATUS,
      no_phi_or_pii: true,
      no_faers_openfda: true,
      exact_source_version_pins_required: true,
      manual_curation_cannot_override_underlying_source_licenses: true,
      audit_every_approval_change_denial_preview_and_export: true
    },
    audit_events: auditEvents
  };

  return {
    ...body,
    packet_digest: sha256(body)
  };
}

export function assertPilotSourceLicenseApprovalPacket(packet) {
  assertObject(packet, "source-license approval packet");
  assertEqual(packet.schema_version, PILOT_SOURCE_LICENSE_PACKET_SCHEMA, "schema_version");
  assertEqual(packet.tenant_id, PILOT_TENANT_ID, "tenant_id");
  assertEqual(packet.release_id, PILOT_RELEASE_ID, "release_id");
  assertEqual(packet.release_candidate_id, PILOT_RELEASE_CANDIDATE_ID, "release_candidate_id");
  assertArrayExact(packet.denied_export_scopes, DENIED_EXPORT_SCOPES, "denied export scopes");

  const approvals = arrayOf(packet.approvals);
  assertEqual(approvals.length, 6, "approval count");
  for (const environment of PILOT_SOURCE_LICENSE_ENVIRONMENTS) {
    const envApprovals = approvals.filter((approval) => approval.environment === environment);
    assertEqual(envApprovals.length, 3, `${environment} approval count`);
    assertApprovalFor(envApprovals, "ChEMBL", "CHEMBL_34", environment);
    assertApprovalFor(envApprovals, "UniProt", "2026_02", environment);
    assertApprovalFor(envApprovals, "Manual curation", "2026-06-27", environment);
  }

  const controlledProd = approvals.filter((approval) => approval.environment === "controlled-prod");
  for (const approval of controlledProd) {
    assertEqual(approval.status, CONTROLLED_PROD_PENDING_STATUS, `${approval.approval_id} status`);
    assertEqual(approval.promotable, false, `${approval.approval_id} promotable`);
  }
  const staging = approvals.filter((approval) => approval.environment === "staging");
  for (const approval of staging) {
    assertEqual(approval.status, STAGING_ACTIVE_STATUS, `${approval.approval_id} status`);
    assertEqual(approval.active, true, `${approval.approval_id} active`);
  }

  if (approvals.some((approval) => /faers|openfda/i.test(approval.source_name))) {
    throw new Error("FAERS/openFDA must not have approval records in this packet");
  }
  if (approvals.some((approval) => approval.sensitivity_classification === "phi_pii")) {
    throw new Error("PHI/PII sources must not have approval records in this packet");
  }
  assertEqual(Boolean(arrayOf(packet.disabled_sources).find((source) => source.source_key === "openfda_faers")), true, "FAERS disabled source");
  assertEqual(Boolean(arrayOf(packet.disabled_sources).find((source) => source.source_key === "internal_phi_pii")), true, "PHI/PII disabled source");

  const manualApprovals = approvals.filter((approval) => approval.source_name === "Manual curation");
  for (const approval of manualApprovals) {
    for (const scope of MANUAL_CURATION_EXTRA_APPROVED_EXPORT_SCOPES) {
      if (!approval.approved_export_scopes.includes(scope)) {
        throw new Error(`manual curation approval missing ${scope}`);
      }
    }
    assertEqual(approval.license_conditions.manual_curation_cannot_override_underlying_source_licenses, true, "manual curation license inheritance");
  }

  const chemblApprovals = approvals.filter((approval) => approval.source_name === "ChEMBL");
  for (const approval of chemblApprovals) {
    if (!approval.license_conditions.license_obligations.includes("CC BY-SA 3.0 ShareAlike terms reviewed and accepted by compliance/legal")) {
      throw new Error("ChEMBL approval missing CC BY-SA 3.0 ShareAlike acceptance");
    }
  }

  const uniprotApprovals = approvals.filter((approval) => approval.source_name === "UniProt");
  for (const approval of uniprotApprovals) {
    if (!approval.license_conditions.license_obligations.includes("CC BY 4.0 attribution requirements reviewed and accepted by compliance/legal")) {
      throw new Error("UniProt approval missing CC BY 4.0 attribution requirement");
    }
  }

  if (arrayOf(packet.audit_events).length < approvals.length * 2) {
    throw new Error("approval packet must include audit events for approvals, scope changes, and denials");
  }
  const body = { ...packet };
  delete body.packet_digest;
  assertEqual(packet.packet_digest, sha256(body), "packet_digest");
  return true;
}

export function evaluatePilotSourceLicenseExportRequest({
  packet,
  principal,
  sourceRows = [],
  requestedScopes = [],
  action = "export.preview",
  exportId = "export:source-license-policy-check",
  actor = principal?.user_id ?? principal?.service_account_id ?? DEFAULT_ACTOR
} = {}) {
  assertPilotSourceLicenseApprovalPacket(packet);
  assertObject(principal, "principal");
  const blocks = [];
  const approvals = [];
  const requestedScopeSet = new Set(arrayOf(requestedScopes));
  const deniedScopes = [...requestedScopeSet].filter((scope) => packet.denied_export_scopes.includes(scope));
  if (deniedScopes.length > 0) {
    blocks.push(`denied export scopes requested: ${deniedScopes.join(", ")}`);
  }
  if (principal.tenant_id !== packet.tenant_id) {
    blocks.push("principal tenant does not match approval packet tenant");
  }
  if (!PILOT_SOURCE_LICENSE_ENVIRONMENTS.includes(principal.environment)) {
    blocks.push("principal environment is not covered by approval packet");
  }
  if (action === "export.create" && sourceRows.length === 0) {
    blocks.push("export creation requires at least one approved visible row");
  }

  for (const row of sourceRows) {
    const approval = findApprovalForRow(packet, row, principal.environment);
    if (!approval) {
      blocks.push(`no source-license approval for ${row?.source_name ?? "unknown source"} ${row?.source_version ?? "unknown version"} in ${principal.environment}`);
      continue;
    }
    approvals.push(approval);
    if (approval.tenant_id !== principal.tenant_id || approval.environment !== principal.environment) {
      blocks.push(`${approval.approval_id} is not scoped to principal tenant/environment`);
    }
    if (approval.status !== STAGING_ACTIVE_STATUS) {
      blocks.push(`${approval.approval_id} is ${approval.status} and cannot create export jobs until promotion gates pass`);
    }
    for (const scope of requestedScopeSet) {
      if (!approval.approved_export_scopes.includes(scope)) {
        blocks.push(`${approval.approval_id} does not approve ${scope}`);
      }
    }
    if (/faers|openfda/i.test(row.source_name ?? "") || requestedScopeSet.has("export.faers_openfda")) {
      blocks.push("FAERS/openFDA export remains disabled by this approval packet");
    }
    if (row.contains_phi_or_pii === true || row.sensitivity_classification === "phi_pii") {
      blocks.push("PHI/PII export remains disabled by this approval packet");
    }
    if (row.source_name === "Manual curation") {
      assertManualCurationDoesNotMaskLicenses({ row, packet, environment: principal.environment, blocks });
    }
  }

  const allowed = blocks.length === 0;
  const auditEvent = sourceLicenseAuditEvent(
    action === "export.create"
      ? (allowed ? "source_license_export.creation_allowed" : "source_license_export.creation_denied")
      : (allowed ? "source_license_export.preview_allowed" : "source_license_export.preview_denied"),
    exportId,
    actor,
    {
      environment: principal.environment,
      requested_export_scopes: [...requestedScopeSet],
      approval_ids: unique(approvals.map((approval) => approval.approval_id)),
      blocks
    }
  );
  return {
    allowed,
    export_job_creatable: allowed && action === "export.create",
    denied_scopes: deniedScopes,
    blocks,
    approval_ids: unique(approvals.map((approval) => approval.approval_id)),
    audit_event: auditEvent
  };
}

export async function applyPilotSourceLicenseApprovalPacket({ outputPath = PILOT_SOURCE_LICENSE_PACKET_PATH, actor } = {}) {
  const packet = buildPilotSourceLicenseApprovalPacket({ actor, mode: "apply" });
  assertPilotSourceLicenseApprovalPacket(packet);
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${stableStringify(packet)}\n`, "utf8");
  return { output_path: target, packet };
}

export async function verifyPilotSourceLicenseApprovalPacket({ outputPath = PILOT_SOURCE_LICENSE_PACKET_PATH } = {}) {
  const target = resolve(outputPath);
  const packet = JSON.parse(await readFile(target, "utf8"));
  assertPilotSourceLicenseApprovalPacket(packet);
  return { output_path: target, packet };
}

export async function rollbackPilotSourceLicenseApprovalPacket({ outputPath = PILOT_SOURCE_LICENSE_PACKET_PATH } = {}) {
  const target = resolve(outputPath);
  await rm(target, { force: true });
  return {
    output_path: target,
    rolled_back: true,
    note: "Removed generated source-license approval packet only; no controlled-prod resources are touched."
  };
}

function sourceDefinition(sourceKey, metadata, conditions) {
  return {
    source_key: sourceKey,
    source_name: metadata.source_name,
    source_version: metadata.source_version,
    license_policy_id: licensePolicyId(sourceKey, metadata.source_version),
    license_classification: metadata.license_classification,
    materialization_policy: metadata.materialization_policy,
    sensitivity_classification: metadata.sensitivity_classification,
    permitted_uses: metadata.permitted_uses,
    export_restrictions: metadata.export_restrictions,
    disclaimer_ids: metadata.disclaimer_ids,
    source_terms_uri: metadata.source_terms_uri,
    license_conditions: {
      license_name: conditions.license_name,
      license_obligations: conditions.license_obligations,
      accepted_by_compliance_legal: true,
      no_phi_or_pii: true,
      no_faers_openfda: true
    }
  };
}

function manualCurationDefinition() {
  return {
    source_key: "manual_curation",
    source_name: "Manual curation",
    source_version: "2026-06-27",
    license_policy_id: licensePolicyId("manual_curation", "2026-06-27"),
    license_classification: "internal_confidential",
    materialization_policy: "materialize_with_tenant_controls",
    sensitivity_classification: "tenant_confidential_no_phi_pii",
    permitted_uses: ["curate", "search", "evidence", "export", "release"],
    export_restrictions: ["tenant_scoped", "no_external_bulk_redistribution_without_legal_review"],
    disclaimer_ids: ["source_terms:manual_curation", "source_limit:tenant_confidential"],
    source_terms_uri: "internal://tenant-pilot-antiplatelet/manual-curation/2026-06-27",
    license_conditions: {
      license_name: "Tenant manual curation",
      license_obligations: [
        "tenant_confidentiality_required",
        "approval_trace_required",
        "underlying_source_license_obligations_must_travel"
      ],
      accepted_by_compliance_legal: true,
      no_phi_or_pii: true,
      no_faers_openfda: true,
      manual_curation_cannot_override_underlying_source_licenses: true
    }
  };
}

function approvalRecord({ source, environment, actor, approvedAt }) {
  const manualExtraScopes = source.source_key === "manual_curation"
    ? MANUAL_CURATION_EXTRA_APPROVED_EXPORT_SCOPES
    : [];
  const status = environment === "controlled-prod" ? CONTROLLED_PROD_PENDING_STATUS : STAGING_ACTIVE_STATUS;
  return {
    approval_id: `source-license-approval:${PILOT_TENANT_ID}:${environment}:${source.source_key}:${source.source_version}`,
    tenant_id: PILOT_TENANT_ID,
    environment,
    source_key: source.source_key,
    source_name: source.source_name,
    source_version: source.source_version,
    status,
    active: status === STAGING_ACTIVE_STATUS,
    promotable: false,
    controlled_prod_resources_created: false,
    license_policy_id: source.license_policy_id,
    license_classification: source.license_classification,
    materialization_policy: source.materialization_policy,
    sensitivity_classification: source.sensitivity_classification,
    approved_export_scopes: unique([...COMMON_APPROVED_EXPORT_SCOPES, ...manualExtraScopes]),
    denied_export_scopes: DENIED_EXPORT_SCOPES,
    permitted_uses: source.permitted_uses,
    export_restrictions: source.export_restrictions,
    disclaimer_ids: source.disclaimer_ids,
    source_terms_uri: source.source_terms_uri,
    license_conditions: source.license_conditions,
    provenance: {
      approval_source: "human_decision",
      approved_by: actor,
      approved_at: approvedAt,
      release_id: PILOT_RELEASE_ID,
      release_candidate_id: PILOT_RELEASE_CANDIDATE_ID,
      rationale: environment === "controlled-prod"
        ? "Approved but held pending pilot exit and controlled-prod promotion gates."
        : "Approved for staging pilot dry-run export preview and export jobs."
    },
    record_hash: sha256({
      tenant_id: PILOT_TENANT_ID,
      environment,
      source_key: source.source_key,
      source_version: source.source_version,
      status,
      license_policy_id: source.license_policy_id,
      approved_export_scopes: unique([...COMMON_APPROVED_EXPORT_SCOPES, ...manualExtraScopes]),
      denied_export_scopes: DENIED_EXPORT_SCOPES
    })
  };
}

function disabledSourceRecord(sourceKey, sourceName, reason) {
  return {
    disabled_source_id: `source-license-denial:${PILOT_TENANT_ID}:all:${sourceKey}`,
    tenant_id: PILOT_TENANT_ID,
    environments: PILOT_SOURCE_LICENSE_ENVIRONMENTS,
    source_key: sourceKey,
    source_name: sourceName,
    source_version: null,
    status: "denied",
    approved_export_scopes: [],
    denied_export_scopes: DENIED_EXPORT_SCOPES,
    denied_reason: reason
  };
}

function findApprovalForRow(packet, row, environment) {
  return arrayOf(packet.approvals).find((approval) =>
    approval.environment === environment &&
    approval.source_name === row?.source_name &&
    approval.source_version === row?.source_version
  ) ?? null;
}

function assertManualCurationDoesNotMaskLicenses({ row, packet, environment, blocks }) {
  const underlying = arrayOf(row.underlying_source_refs);
  const underlyingPolicyIds = new Set(arrayOf(row.underlying_license_policy_ids));
  for (const ref of underlying) {
    const approval = findApprovalForRow(packet, ref, environment);
    if (!approval) {
      blocks.push(`manual curation row references unapproved underlying source ${ref?.source_name ?? "unknown"} ${ref?.source_version ?? "unknown"}`);
      continue;
    }
    if (!underlyingPolicyIds.has(approval.license_policy_id)) {
      blocks.push(`manual curation row is missing underlying license policy ${approval.license_policy_id}`);
    }
  }
}

function assertApprovalFor(approvals, sourceName, sourceVersion, environment) {
  const approval = approvals.find((item) => item.source_name === sourceName && item.source_version === sourceVersion);
  if (!approval) {
    throw new Error(`${environment} missing ${sourceName} ${sourceVersion} approval`);
  }
}

function sourceLicenseAuditEvent(eventType, objectId, actor, metadata = {}) {
  const environment = metadata.environment ?? "all";
  const seed = `${eventType}|${objectId}|${environment}|${stableStringify(metadata)}`;
  return {
    audit_event_id: `audit:${sha256(seed).slice("sha256:".length, "sha256:".length + 24)}`,
    event_type: eventType,
    tenant_id: PILOT_TENANT_ID,
    environment,
    actor,
    actor_type: String(actor).startsWith("svc:") ? "service_account" : "human",
    object_id: objectId,
    correlation_id: PILOT_SOURCE_LICENSE_CORRELATION_ID,
    status: eventType.endsWith("_denied") || eventType.includes(".source_denied") ? "denied" : "success",
    metadata
  };
}

function licensePolicyId(sourceKey, sourceVersion) {
  return `license-policy:${PILOT_TENANT_ID}:${sourceKey}:${sourceVersion}`;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required`);
  }
}

function assertArrayExact(actual, expected, label) {
  const left = arrayOf(actual);
  assertEqual(left.length, expected.length, `${label} length`);
  for (const value of expected) {
    if (!left.includes(value)) {
      throw new Error(`${label} missing ${value}`);
    }
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch`);
  }
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values)];
}
