import assert from "node:assert/strict";
import test from "node:test";

import { createPhase5WorkbenchApi } from "../../services/api/src/index.js";
import { buildAuthorizedExport } from "../../services/export/src/index.js";

const releaseContext = Object.freeze({ release_id: "release-2026-01", scope: "release" });
const principal = Object.freeze({
  user_id: "user:release-manager-p5",
  tenant_id: "tenant-a",
  environment: "prod",
  role_keys: ["release_manager"],
  allowed_release_ids: ["release-2026-01"],
  release_id: "release-2026-01"
});

test("P5-RT-001: export fails closed when required provenance fidelity fields are missing", async () => {
  const incomplete = exportRow({
    id: "export:missing-fields",
    provenance_id: undefined,
    source_vocabulary_version: undefined,
    target_vocabulary_version: undefined,
    artifact_hash: undefined,
    license_policy_id: undefined
  });
  const serviceResult = buildAuthorizedExport({
    principal,
    candidateResults: [incomplete],
    export_id: "export:p5-rt-001-service",
    releaseContext,
    format: "json"
  });
  assert.equal(serviceResult.record_count, 0);
  assert.equal(serviceResult.rows.length, 0);

  const api = createPhase5WorkbenchApi({
    async resolveSearchIndex() { return []; },
    async resolveEntityDetail() { return { header: exportRow() }; },
    async resolveExportScope() { return [incomplete]; }
  });
  const apiResult = await api.createExport({
    principal,
    request: {
      export_id: "export:p5-rt-001-api",
      scope: { type: "selected", object_ids: ["export:missing-fields"] },
      format: "json",
      release_id: releaseContext.release_id
    }
  });
  assert.equal(apiResult.record_count, 0);
  assert.equal(apiResult.rows.length, 0);
});

test("P5-RT-002: export manifest digest is bound to governed provenance fields", () => {
  const base = exportRow({ id: "export:aspirin" });
  for (const [field, value] of [
    ["source_vocabulary_version", "35"],
    ["provenance_id", "pharmprov:mutated"],
    ["artifact_hash", "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    ["license_policy_id", "license-policy:mutated"]
  ]) {
    const left = buildAuthorizedExport({
      principal,
      candidateResults: [base],
      export_id: `export:p5-rt-002-${field}`,
      releaseContext,
      format: "json"
    });
    const right = buildAuthorizedExport({
      principal,
      candidateResults: [{ ...base, [field]: value }],
      export_id: `export:p5-rt-002-${field}`,
      releaseContext,
      format: "json"
    });
    assert.notEqual(left.manifest_digest, right.manifest_digest, `${field} mutation did not affect export manifest_digest`);
  }
});

test("P5-RT-003: hidden-only workbench export reveals no hidden count and creates no ready job", async () => {
  const hiddenOnly = exportRow({
    id: "export:hidden-cross-tenant",
    tenant_id: "tenant-b",
    semantic_object_id: "pharment:compound/hidden-aspirin"
  });
  const hiddenResponse = await workbenchExportFor([hiddenOnly], {
    export_id: "export:p5-rt-003-hidden-only",
    scope: { type: "selected", object_ids: ["export:hidden-cross-tenant"] }
  });
  const emptyResponse = await workbenchExportFor([], {
    export_id: "export:p5-rt-003-empty",
    scope: { type: "selected", object_ids: ["export:hidden-cross-tenant"] }
  });

  assert.equal(hiddenResponse.record_count, 0);
  assert.equal(hiddenResponse.invalid_record_count, 0);
  assert.deepEqual(hiddenResponse.rows, []);
  assertNoHiddenExportCountLeak(hiddenResponse);
  assertZeroRowExportJobNotReady(hiddenResponse);
  assert.equal(hiddenResponse.record_count, emptyResponse.record_count);
  assert.equal(hiddenResponse.invalid_record_count, emptyResponse.invalid_record_count);
  assert.deepEqual(hiddenResponse.rows, emptyResponse.rows);
});

test("P5-RT-003: mixed hidden and visible-invalid export exposes only visible invalid count", async () => {
  const hidden = exportRow({
    id: "export:hidden-cross-tenant",
    tenant_id: "tenant-b",
    semantic_object_id: "pharment:compound/hidden-aspirin"
  });
  const visibleInvalid = exportRow({
    id: "export:visible-invalid",
    provenance_id: undefined,
    artifact_hash: undefined
  });

  const response = await workbenchExportFor([hidden, visibleInvalid], {
    export_id: "export:p5-rt-003-mixed-hidden-invalid",
    scope: { type: "selected", object_ids: ["export:hidden-cross-tenant", "export:visible-invalid"] }
  });

  assert.equal(response.record_count, 0);
  assert.equal(response.invalid_record_count, 1);
  assert.deepEqual(response.rows, []);
  assertNoHiddenExportCountLeak(response);
  assertZeroRowExportJobNotReady(response);
});

async function workbenchExportFor(candidateRows, { export_id, scope }) {
  const api = createPhase5WorkbenchApi({
    async resolveSearchIndex() { return []; },
    async resolveEntityDetail() { return { header: exportRow() }; },
    async resolveExportScope() { return candidateRows; }
  });
  return api.createExport({
    principal,
    request: {
      export_id,
      scope,
      format: "json",
      release_id: releaseContext.release_id
    }
  });
}

function assertNoHiddenExportCountLeak(response) {
  for (const field of [
    "filtered_count",
    "hidden_count",
    "hidden_filtered_count",
    "authorization_filtered_count",
    "unauthorized_count"
  ]) {
    assert.equal(Object.hasOwn(response, field), false, `${field} must not be exposed on public workbench export responses`);
  }
}

function assertZeroRowExportJobNotReady(response) {
  assert.notEqual(response.export_job?.status, "ready", "zero-row workbench exports must not create ready export jobs");
}

function exportRow(overrides = {}) {
  return {
    id: "export:aspirin",
    semantic_object_id: "pharment:compound/aspirin",
    tenant_id: "tenant-a",
    environment: "prod",
    release_id: "release-2026-01",
    lifecycle_status: "released",
    assertion_type: "canonical",
    permitted_uses: ["search", "export"],
    license_status: "valid",
    canonical_ids: {
      entity_id: "pharment:compound/aspirin",
      source_entity_id: "chembl:CHEMBL25",
      target_entity_id: "pubchem:CID2244"
    },
    source_vocabulary_version: "34",
    target_vocabulary_version: "2026-06-01",
    source_version: "34",
    evidence_refs: [{ evidence_id: "pharmev:evidence-chembl", evidence_role: "supports" }],
    provenance_id: "pharmprov:aspirin",
    artifact_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    license_classification: "open_with_attribution",
    license_policy_id: "license-policy:chembl-34",
    ...overrides
  };
}
