import assert from "node:assert/strict";
import test from "node:test";

import { createPhase5WorkbenchApi } from "../../services/api/src/index.js";
import {
  SourceLicenseExportPolicyError,
  buildAuthorizedExport,
  buildExportRowContentHash
} from "../../services/export/src/index.js";
import {
  COMMON_APPROVED_EXPORT_SCOPES,
  PILOT_SOURCE_LICENSE_PACKET_PATH,
  buildPilotSourceLicenseApprovalPacket
} from "../../services/ops/src/source-license-export-approval.js";

const releaseContext = Object.freeze({ release_id: "mvp-2026-06-27-rc1", scope: "release" });
const releaseManager = Object.freeze({
  user_id: "user:tenant-pilot-antiplatelet:staging:release-manager",
  tenant_id: "tenant-pilot-antiplatelet",
  environment: "staging",
  role_keys: ["release_manager"],
  allowed_release_ids: ["mvp-2026-06-27-rc1"],
  release_id: "mvp-2026-06-27-rc1"
});

test("B8 relationship release items export through the existing workbench source-license gate", async () => {
  const row = relationshipReleaseItem();
  const api = workbenchApiFor([row]);

  const response = await api.createExport({
    principal: releaseManager,
    request: {
      export_id: "export:b8-relationship-release-item",
      scope: { type: "release", requested_export_scopes: COMMON_APPROVED_EXPORT_SCOPES },
      release_id: releaseContext.release_id,
      source_license_approval_packet_path: PILOT_SOURCE_LICENSE_PACKET_PATH
    }
  });

  assert.equal(response.authorization_filtered, true);
  assert.equal(response.record_count, 1);
  assert.equal(response.invalid_record_count, 0);
  assert.equal(response.source_license_policy.allowed, true);
  assert.equal(response.export_job.status, "ready");
  assert.equal(response.export_job.audit_event_id, response.source_license_policy.audit_event.audit_event_id);
  assert.equal(response.rows[0].relationship_assertion_id, row.relationship_assertion_id);
  assert.equal(response.rows[0].assertion_type, "relationship");
  assert.equal(response.rows[0].source_name, "Manual curation");
  assert.equal(response.rows[0].source_version, "2026-06-27");
  assert.equal(response.rows[0].source_vocabulary_version, "2026-06-27");
  assert.equal(response.rows[0].target_vocabulary_version, "2026-06-27");
  assert.deepEqual(response.rows[0].evidence_refs, row.evidence_refs);
  assert.deepEqual(response.rows[0].audit_event_ids, row.audit_event_ids);
  assert.match(response.rows[0].artifact_hash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(response.row_content_hashes, [buildExportRowContentHash(response.rows[0])]);
});

test("B8 relationship exports remain regulated and fail closed without a source-license packet", () => {
  assert.throws(
    () => buildAuthorizedExport({
      principal: releaseManager,
      candidateResults: [relationshipReleaseItem()],
      export_id: "export:b8-missing-packet",
      releaseContext,
      requestedScopes: COMMON_APPROVED_EXPORT_SCOPES,
      action: "export.create"
    }),
    (error) => {
      assert.equal(error instanceof SourceLicenseExportPolicyError, true);
      assert.equal(error.details.export_id, "export:b8-missing-packet");
      assert.ok(error.details.blocks.some((block) => block.includes("missing source-license approval packet")));
      return true;
    }
  );
});

test("B8 relationship export filters model-suggested, blocked, pending, PHI/PII, and unauthorized rows", () => {
  const exported = buildAuthorizedExport({
    principal: releaseManager,
    candidateResults: [
      relationshipReleaseItem({ relationship_assertion_id: "rel:b8:allowed", id: "rel:b8:allowed" }),
      relationshipReleaseItem({
        relationship_assertion_id: "rel:b8:model",
        id: "rel:b8:model",
        assertion_type: "model_suggested",
        relationship_assertion_type: "model_suggested"
      }),
      relationshipReleaseItem({
        relationship_assertion_id: "rel:b8:blocked",
        id: "rel:b8:blocked",
        license_status: "blocked"
      }),
      relationshipReleaseItem({
        relationship_assertion_id: "rel:b8:pending",
        id: "rel:b8:pending",
        license_status: "pending_review"
      }),
      relationshipReleaseItem({
        relationship_assertion_id: "rel:b8:phi",
        id: "rel:b8:phi",
        export_restrictions: ["contains_phi_or_pii"]
      }),
      relationshipReleaseItem({
        relationship_assertion_id: "rel:b8:wrong-release",
        id: "rel:b8:wrong-release",
        release_id: "mvp-2026-06-20-rc1"
      })
    ],
    export_id: "export:b8-filtered-relationship-rows",
    releaseContext,
    sourceLicenseApprovalPacket: buildPilotSourceLicenseApprovalPacket(),
    requestedScopes: COMMON_APPROVED_EXPORT_SCOPES,
    action: "export.create"
  });

  assert.equal(exported.authorization_filtered, true);
  assert.deepEqual(exported.rows.map((row) => row.relationship_assertion_id), ["rel:b8:allowed"]);
  assert.equal(exported.invalid_record_count, 0);
  assert.equal(exported.source_license_policy.allowed, true);
});

test("B8 relationship row content hash is bound to canonical evidence and audit fields", () => {
  const base = relationshipReleaseItem();
  const evidenceMutated = relationshipReleaseItem({
    evidence_refs: [
      {
        evidence_id: "pharmev:manual-curation:mutated",
        evidence_role: "supports",
        source_name: "Manual curation",
        source_version: "2026-06-27",
        source_record_id: "curation:manual:mutated"
      }
    ]
  });
  const auditMutated = relationshipReleaseItem({
    audit_event_ids: ["audit:relationship-release-mutated"]
  });

  assert.notEqual(buildExportRowContentHash(base), buildExportRowContentHash(evidenceMutated));
  assert.notEqual(buildExportRowContentHash(base), buildExportRowContentHash(auditMutated));
});

function workbenchApiFor(candidateRows) {
  return createPhase5WorkbenchApi({
    async resolveSearchIndex() { return []; },
    async resolveEntityDetail() { return { header: relationshipReleaseItem() }; },
    async resolveExportScope() { return candidateRows; }
  });
}

function relationshipReleaseItem(overrides = {}) {
  const relationshipAssertionId = overrides.relationship_assertion_id ?? "rel:b8:aspirin-ptgs1";
  return {
    id: relationshipAssertionId,
    object_id: relationshipAssertionId,
    object_type: "relationship",
    result_type: "relationship",
    relationship_id: relationshipAssertionId,
    relationship_assertion_id: relationshipAssertionId,
    assertion_type: "relationship",
    relationship_assertion_type: "human_curated",
    tenant_id: "tenant-pilot-antiplatelet",
    environment: "staging",
    graph_name: "graph:tenant:tenant-pilot-antiplatelet:release:mvp-2026-06-27-rc1:relationships",
    release_id: "mvp-2026-06-27-rc1",
    release_candidate_id: "rc:mvp-2026-06-27",
    release_context: {
      release_id: "mvp-2026-06-27-rc1",
      scope: "release",
      included_in_release: true,
      release_candidate_id: "rc:mvp-2026-06-27"
    },
    lifecycle_status: "released",
    review_status: "released",
    relationship_class: "compound_target",
    predicate: "pharmrel:hasTarget",
    source_entity_id: "pharment:compound/aspirin",
    target_entity_id: "pharment:protein/PTGS1",
    directionality: "directed",
    polarity: "positive",
    evidence_refs: [
      {
        evidence_id: "pharmev:manual-curation:aspirin-ptgs1",
        evidence_role: "supports",
        source_name: "Manual curation",
        source_version: "2026-06-27",
        source_record_id: "curation:manual:aspirin-ptgs1"
      }
    ],
    source_record_ids: ["curation:manual:aspirin-ptgs1"],
    source_names: ["Manual curation"],
    source_versions: ["2026-06-27"],
    source_vocabulary_version: "2026-06-27",
    target_vocabulary_version: "2026-06-27",
    validation_report_ids: ["validation:relationship:release:1"],
    validation_report_id: "validation:relationship:release:1",
    provenance_id: "pharmprov:relationship:aspirin-ptgs1",
    artifact_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    payload_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    license_status: "valid",
    license_classification: "internal_confidential",
    license_policy_id: "license-policy:tenant-pilot-antiplatelet:manual_curation:2026-06-27",
    permitted_uses: ["search", "export", "release"],
    export_restrictions: ["tenant_scoped"],
    export_authorization_status: "authorized",
    audit_event_ids: ["audit:relationship-release-allowed"],
    row_hashes: ["sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    ...overrides
  };
}
