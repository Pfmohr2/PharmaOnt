import assert from "node:assert/strict";
import test from "node:test";

import { buildAuthorizedExport } from "../../services/export/src/index.js";
import {
  COMMON_APPROVED_EXPORT_SCOPES,
  CONTROLLED_PROD_PENDING_STATUS,
  DENIED_EXPORT_SCOPES,
  MANUAL_CURATION_EXTRA_APPROVED_EXPORT_SCOPES,
  STAGING_ACTIVE_STATUS,
  assertPilotSourceLicenseApprovalPacket,
  buildPilotSourceLicenseApprovalPacket,
  evaluatePilotSourceLicenseExportRequest
} from "../../services/ops/src/source-license-export-approval.js";

const releaseContext = Object.freeze({ release_id: "mvp-2026-06-27-rc1", scope: "release" });
const stagingPrincipal = Object.freeze({
  user_id: "user:tenant-pilot-antiplatelet:staging:release-manager",
  tenant_id: "tenant-pilot-antiplatelet",
  environment: "staging",
  role_keys: ["release_manager"],
  allowed_release_ids: ["mvp-2026-06-27-rc1"],
  release_id: "mvp-2026-06-27-rc1"
});

test("pilot source-license approval packet records exact tenant, environment, source-version, and license obligations", () => {
  const packet = buildPilotSourceLicenseApprovalPacket();
  assert.equal(assertPilotSourceLicenseApprovalPacket(packet), true);
  assert.equal(packet.approvals.length, 6);
  assert.deepEqual(packet.denied_export_scopes, DENIED_EXPORT_SCOPES);

  const staging = packet.approvals.filter((approval) => approval.environment === "staging");
  assert.equal(staging.every((approval) => approval.status === STAGING_ACTIVE_STATUS), true);
  assert.ok(staging.find((approval) => approval.source_name === "ChEMBL" && approval.source_version === "CHEMBL_34"));
  assert.ok(staging.find((approval) => approval.source_name === "UniProt" && approval.source_version === "2026_02"));
  assert.ok(staging.find((approval) => approval.source_name === "Manual curation" && approval.source_version === "2026-06-27"));

  const chembl = staging.find((approval) => approval.source_name === "ChEMBL");
  assert.ok(chembl.license_conditions.license_obligations.some((value) => value.includes("CC BY-SA 3.0")));
  const uniprot = staging.find((approval) => approval.source_name === "UniProt");
  assert.ok(uniprot.license_conditions.license_obligations.some((value) => value.includes("CC BY 4.0 attribution")));
});

test("controlled-prod approval records are gated and not promotable", () => {
  const packet = buildPilotSourceLicenseApprovalPacket();
  const controlledProd = packet.approvals.filter((approval) => approval.environment === "controlled-prod");
  assert.equal(controlledProd.length, 3);
  assert.equal(controlledProd.every((approval) => approval.status === CONTROLLED_PROD_PENDING_STATUS), true);
  assert.equal(controlledProd.every((approval) => approval.promotable === false), true);
  assert.equal(controlledProd.every((approval) => approval.controlled_prod_resources_created === false), true);

  const result = evaluatePilotSourceLicenseExportRequest({
    packet,
    principal: { ...stagingPrincipal, environment: "controlled-prod" },
    requestedScopes: ["export.preview"],
    sourceRows: [exportRow({ environment: "controlled-prod" })],
    action: "export.create"
  });
  assert.equal(result.allowed, false);
  assert.equal(result.export_job_creatable, false);
  assert.ok(result.blocks.some((block) => block.includes(CONTROLLED_PROD_PENDING_STATUS)));
});

test("denied export scopes and hidden-only scopes cannot create export jobs", () => {
  const packet = buildPilotSourceLicenseApprovalPacket();
  for (const deniedScope of ["export.model_suggested_unapproved", "export.hidden_only_scope", "export.faers_openfda", "export.phi", "export.pii"]) {
    const result = evaluatePilotSourceLicenseExportRequest({
      packet,
      principal: stagingPrincipal,
      requestedScopes: [deniedScope],
      sourceRows: [exportRow()],
      action: "export.create"
    });
    assert.equal(result.allowed, false, deniedScope);
    assert.equal(result.export_job_creatable, false, deniedScope);
    assert.ok(result.denied_scopes.includes(deniedScope), deniedScope);
    assert.match(result.audit_event.event_type, /creation_denied/);
  }
});

test("approved released exports preserve license, source, provenance, artifact, audit, and row hashes", () => {
  const packet = buildPilotSourceLicenseApprovalPacket();
  const row = exportRow();
  const policy = evaluatePilotSourceLicenseExportRequest({
    packet,
    principal: stagingPrincipal,
    requestedScopes: COMMON_APPROVED_EXPORT_SCOPES,
    sourceRows: [row],
    action: "export.create",
    exportId: "export:approved-source-license"
  });
  assert.equal(policy.allowed, true);
  assert.equal(policy.export_job_creatable, true);

  const exported = buildAuthorizedExport({
    principal: stagingPrincipal,
    candidateResults: [row],
    export_id: "export:approved-source-license",
    releaseContext,
    sourceLicenseApprovalPacket: packet,
    requestedScopes: COMMON_APPROVED_EXPORT_SCOPES,
    action: "export.create"
  });
  assert.equal(exported.record_count, 1);
  assert.equal(exported.rows[0].source_name, "ChEMBL");
  assert.equal(exported.rows[0].source_version, "CHEMBL_34");
  assert.equal(exported.rows[0].license_policy_id, row.license_policy_id);
  assert.equal(exported.rows[0].provenance_id, row.provenance_id);
  assert.equal(exported.rows[0].artifact_hash, row.artifact_hash);
  assert.deepEqual(exported.rows[0].audit_event_ids, row.audit_event_ids);
  assert.deepEqual(exported.rows[0].row_hashes, row.row_hashes);
});

test("manual curation cannot mask underlying source licenses", () => {
  const packet = buildPilotSourceLicenseApprovalPacket();
  const manual = exportRow({
    id: "export:manual-curated-relationship",
    source_name: "Manual curation",
    source_version: "2026-06-27",
    source_vocabulary_version: "2026-06-27",
    target_vocabulary_version: "2026-06-27",
    license_classification: "internal_confidential",
    license_policy_id: "license-policy:tenant-pilot-antiplatelet:manual_curation:2026-06-27",
    underlying_source_refs: [
      { source_name: "ChEMBL", source_version: "CHEMBL_34" },
      { source_name: "UniProt", source_version: "2026_02" }
    ],
    underlying_license_policy_ids: [
      "license-policy:tenant-pilot-antiplatelet:manual_curation:2026-06-27"
    ]
  });
  const blocked = evaluatePilotSourceLicenseExportRequest({
    packet,
    principal: stagingPrincipal,
    requestedScopes: [...COMMON_APPROVED_EXPORT_SCOPES, ...MANUAL_CURATION_EXTRA_APPROVED_EXPORT_SCOPES],
    sourceRows: [manual],
    action: "export.create"
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.blocks.some((block) => block.includes("underlying license policy")));

  const allowed = evaluatePilotSourceLicenseExportRequest({
    packet,
    principal: stagingPrincipal,
    requestedScopes: [...COMMON_APPROVED_EXPORT_SCOPES, ...MANUAL_CURATION_EXTRA_APPROVED_EXPORT_SCOPES],
    sourceRows: [{
      ...manual,
      underlying_license_policy_ids: [
        "license-policy:tenant-pilot-antiplatelet:chembl:CHEMBL_34",
        "license-policy:tenant-pilot-antiplatelet:uniprot:2026_02"
      ]
    }],
    action: "export.create"
  });
  assert.equal(allowed.allowed, true);
});

test("FAERS/openFDA and PHI/PII remain disabled", () => {
  const packet = buildPilotSourceLicenseApprovalPacket();
  assert.equal(packet.approvals.some((approval) => /faers|openfda/i.test(approval.source_name)), false);
  assert.ok(packet.disabled_sources.find((source) => source.source_key === "openfda_faers"));
  assert.ok(packet.disabled_sources.find((source) => source.source_key === "internal_phi_pii"));

  const faers = evaluatePilotSourceLicenseExportRequest({
    packet,
    principal: stagingPrincipal,
    requestedScopes: ["export.faers_openfda"],
    sourceRows: [exportRow({ source_name: "openFDA FAERS", source_version: "2026Q1" })],
    action: "export.create"
  });
  assert.equal(faers.allowed, false);
  assert.equal(faers.export_job_creatable, false);

  const pii = evaluatePilotSourceLicenseExportRequest({
    packet,
    principal: stagingPrincipal,
    requestedScopes: ["export.preview"],
    sourceRows: [exportRow({ source_name: "Internal PHI/PII", source_version: "2026-06-27", contains_phi_or_pii: true })],
    action: "export.create"
  });
  assert.equal(pii.allowed, false);
  assert.equal(pii.export_job_creatable, false);
});

function exportRow(overrides = {}) {
  return {
    id: "export:chembl-aspirin",
    semantic_object_id: "pharment:compound/aspirin",
    tenant_id: "tenant-pilot-antiplatelet",
    environment: "staging",
    release_id: "mvp-2026-06-27-rc1",
    lifecycle_status: "released",
    assertion_type: "canonical",
    permitted_uses: ["search", "export"],
    license_status: "valid",
    source_name: "ChEMBL",
    source_version: "CHEMBL_34",
    source_vocabulary_version: "CHEMBL_34",
    target_vocabulary_version: "2026-06-27",
    provenance_id: "pharmprov:chembl-aspirin",
    artifact_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    license_classification: "open_with_attribution",
    license_policy_id: "license-policy:tenant-pilot-antiplatelet:chembl:CHEMBL_34",
    audit_event_ids: ["audit:source-license-approval"],
    row_hashes: ["sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    evidence_refs: [{ evidence_id: "pharmev:chembl-aspirin", evidence_role: "supports" }],
    ...overrides
  };
}
