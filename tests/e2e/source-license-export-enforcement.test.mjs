import assert from "node:assert/strict";
import test from "node:test";

import { createPhase5WorkbenchApi } from "../../services/api/src/index.js";
import {
  SourceLicenseExportPolicyError,
  buildAuthorizedExport
} from "../../services/export/src/index.js";
import {
  COMMON_APPROVED_EXPORT_SCOPES,
  PILOT_SOURCE_LICENSE_PACKET_PATH,
  buildPilotSourceLicenseApprovalPacket
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

test("source-license denied scopes are unbuildable at the export boundary", () => {
  const packet = buildPilotSourceLicenseApprovalPacket();

  assert.throws(
    () => buildAuthorizedExport({
      principal: stagingPrincipal,
      candidateResults: [exportRow()],
      export_id: "export:denied-hidden-only",
      releaseContext,
      sourceLicenseApprovalPacket: packet,
      requestedScopes: ["export.hidden_only_scope"],
      action: "export.create"
    }),
    (error) => {
      assert.equal(error instanceof SourceLicenseExportPolicyError, true);
      assert.deepEqual(error.details.denied_scopes, ["export.hidden_only_scope"]);
      assert.ok(error.details.blocks.some((block) => block.includes("denied export scopes")));
      assert.match(error.details.audit_event.event_type, /creation_denied/);
      return true;
    }
  );
});

test("governed source-license exports fail closed when approval packet is missing", async () => {
  assert.throws(
    () => buildAuthorizedExport({
      principal: stagingPrincipal,
      candidateResults: [exportRow()],
      export_id: "export:missing-packet-direct",
      releaseContext,
      requestedScopes: COMMON_APPROVED_EXPORT_SCOPES,
      action: "export.create"
    }),
    (error) => {
      assert.equal(error instanceof SourceLicenseExportPolicyError, true);
      assert.equal(error.details.export_id, "export:missing-packet-direct");
      assert.deepEqual(error.details.denied_scopes, []);
      assert.ok(error.details.blocks.some((block) => block.includes("missing source-license approval packet")));
      assert.match(error.details.audit_event.event_type, /creation_denied/);
      return true;
    }
  );

  const api = workbenchApiFor([exportRow()]);
  await assert.rejects(
    () => api.createExport({
      principal: stagingPrincipal,
      request: {
        export_id: "export:missing-packet-workbench",
        scope: { type: "release", requested_export_scopes: COMMON_APPROVED_EXPORT_SCOPES },
        release_id: releaseContext.release_id
      }
    }),
    (error) => {
      assert.equal(error instanceof SourceLicenseExportPolicyError, true);
      assert.equal(error.details.export_id, "export:missing-packet-workbench");
      assert.ok(error.details.blocks.some((block) => block.includes("missing source-license approval packet")));
      assert.match(error.details.audit_event.event_type, /creation_denied/);
      return true;
    }
  );
});

test("source-derived exports without source version still require approval packet", async () => {
  const incompleteLineage = exportRow({
    source_version: undefined,
    license_policy_id: "not-a-tenant-policy",
    source_vocabulary_version: "CHEMBL_34",
    target_vocabulary_version: "OMOP v5.4",
    license_conditions: {
      license_name: "CC BY-SA 3.0",
      license_obligations: ["attribution_required", "sharealike_review_required"]
    }
  });

  const api = workbenchApiFor([incompleteLineage]);
  await assert.rejects(
    () => api.createExport({
      principal: stagingPrincipal,
      request: {
        export_id: "export:missing-packet-source-name-only",
        scope: { type: "release", requested_export_scopes: COMMON_APPROVED_EXPORT_SCOPES },
        release_id: releaseContext.release_id
      }
    }),
    (error) => {
      assert.equal(error instanceof SourceLicenseExportPolicyError, true);
      assert.equal(error.details.export_id, "export:missing-packet-source-name-only");
      assert.ok(error.details.blocks.some((block) => block.includes("missing source-license approval packet")));
      return true;
    }
  );
});

test("explicitly ungoverned zero-lineage exports can proceed without approval packet", () => {
  const exported = buildAuthorizedExport({
    principal: stagingPrincipal,
    candidateResults: [ungovernedRow()],
    export_id: "export:internal-zero-lineage",
    releaseContext,
    requestedScopes: ["export.internal_report"],
    action: "export.create"
  });

  assert.equal(exported.record_count, 1);
  assert.equal(exported.source_license_policy, null);
  assert.deepEqual(exported.rows.map((row) => row.id), ["export:internal-zero-lineage"]);
});

test("workbench export reads the approval packet path and blocks controlled-prod pending approvals", async () => {
  const api = workbenchApiFor([exportRow({ environment: "controlled-prod" })]);

  await assert.rejects(
    () => api.createExport({
      principal: { ...stagingPrincipal, environment: "controlled-prod" },
      request: {
        export_id: "export:controlled-prod-pending",
        scope: { type: "release", requested_export_scopes: ["export.released_curated_assertions"] },
        release_id: releaseContext.release_id,
        source_license_approval_packet_path: PILOT_SOURCE_LICENSE_PACKET_PATH
      }
    }),
    (error) => {
      assert.equal(error instanceof SourceLicenseExportPolicyError, true);
      assert.equal(error.details.denied_scopes.length, 0);
      assert.ok(error.details.blocks.some((block) => block.includes("approved_pending_promotion_gates")));
      assert.match(error.details.audit_event.event_type, /creation_denied/);
      return true;
    }
  );
});

test("approved staging exports preserve approval proof and create ready jobs", async () => {
  const row = exportRow();
  const api = workbenchApiFor([row]);

  const response = await api.createExport({
    principal: stagingPrincipal,
    request: {
      export_id: "export:staging-approved-source-license",
      scope: { type: "release", requested_export_scopes: COMMON_APPROVED_EXPORT_SCOPES },
      release_id: releaseContext.release_id,
      source_license_approval_packet_path: PILOT_SOURCE_LICENSE_PACKET_PATH
    }
  });

  assert.equal(response.record_count, 1);
  assert.equal(response.source_license_policy.allowed, true);
  assert.equal(response.source_license_policy.export_job_creatable, true);
  assert.deepEqual(response.source_license_policy.requested_scopes, COMMON_APPROVED_EXPORT_SCOPES);
  assert.equal(response.export_job.status, "ready");
  assert.equal(response.export_job.audit_event_id, response.source_license_policy.audit_event.audit_event_id);
  assert.equal(response.rows[0].source_name, row.source_name);
  assert.equal(response.rows[0].source_version, row.source_version);
  assert.equal(response.rows[0].license_policy_id, row.license_policy_id);
  assert.equal(response.rows[0].provenance_id, row.provenance_id);
  assert.equal(response.rows[0].artifact_hash, row.artifact_hash);
  assert.deepEqual(response.rows[0].audit_event_ids, row.audit_event_ids);
  assert.deepEqual(response.rows[0].row_hashes, row.row_hashes);
});

function workbenchApiFor(candidateRows) {
  return createPhase5WorkbenchApi({
    async resolveSearchIndex() { return []; },
    async resolveEntityDetail() { return { header: exportRow() }; },
    async resolveExportScope() { return candidateRows; }
  });
}

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

function ungovernedRow(overrides = {}) {
  return {
    id: "export:internal-zero-lineage",
    semantic_object_id: "pharment:internal/report/source-license-ops",
    tenant_id: "tenant-pilot-antiplatelet",
    environment: "staging",
    release_id: "mvp-2026-06-27-rc1",
    lifecycle_status: "released",
    assertion_type: "evidence",
    permitted_uses: ["export"],
    license_status: "valid",
    provenance_id: "pharmprov:internal:source-license-ops-report",
    artifact_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    license_classification: "internal",
    license_policy_id: "license-policy:internal:source-license-ops-report",
    ...overrides
  };
}
