import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  WorkbenchApiError,
  createPhase5WorkbenchApi
} from "../../services/api/src/index.js";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const releaseManager = Object.freeze({
  user_id: "user:release-manager-a",
  tenant_id: "tenant-a",
  environment: "prod",
  role_keys: ["release_manager"],
  allowed_release_ids: ["release-2026-01"],
  release_id: "release-2026-01"
});

const viewer = Object.freeze({
  user_id: "user:viewer-a",
  tenant_id: "tenant-a",
  environment: "prod",
  role_keys: ["viewer"],
  allowed_release_ids: ["release-2026-01"],
  release_id: "release-2026-01"
});

test("Phase 5 workbench OpenAPI contract is published for search, entity detail, explanation, evidence, and export", () => {
  const contract = JSON.parse(readFileSync(resolve(repoRoot, "docs/api/phase5-workbench.openapi.json"), "utf8"));

  assert.equal(contract.openapi, "3.1.0");
  assert.equal(contract.info.version, "phase5.workbench-api.v1");
  for (const path of [
    "/api/workbench/search",
    "/api/workbench/entities/{entityId}",
    "/api/workbench/explanations/search-hit/{hitId}",
    "/api/workbench/evidence/by-assertion/{assertionId}",
    "/api/workbench/export/preview",
    "/api/workbench/export"
  ]) {
    assert.ok(contract.paths[path], `${path} must be in published contract`);
  }
  assert.ok(contract.components.schemas.SearchResponse.required.includes("authorization_filtered"));
  assert.ok(contract.components.schemas.ExportResponse.required.includes("manifest_digest"));
  assert.ok(contract.components.schemas.ExportResponse.required.includes("invalid_record_count"));
  assert.ok(contract.components.schemas.ExportResponse.required.includes("row_content_hashes"));
});

test("Phase 5 workbench search routes through search and API boundaries before shaping results", async () => {
  const api = fixtureApi({
    searchResults: [
      searchHit({ id: "hit:allowed", object_id: "pharment:compound/aspirin", rank: 1 }),
      searchHit({ id: "hit:cross-tenant", tenant_id: "tenant-b", rank: 2 }),
      searchHit({ id: "hit:wrong-release", release_id: "release-2025-12", rank: 3 }),
      searchHit({ id: "hit:blocked-license", license_status: "blocked", rank: 4 })
    ]
  });

  const response = await api.search({
    principal: releaseManager,
    request: {
      query: "aspirin",
      filters: { object_type: ["compound"] },
      release_id: "release-2026-01"
    }
  });

  assert.equal(response.schema_version, "phase5.workbench-api.v1");
  assert.equal(response.authorization_filtered, true);
  assert.equal(response.visible_count, 1);
  assert.equal(response.results[0].object_id, "pharment:compound/aspirin");
  assert.equal(response.results[0].assertion_type, "canonical");
  assert.deepEqual(response.results[0].match_reasons.map((reason) => reason.reason_type), ["label", "synonym"]);
  assert.equal(response.actions.can_export, false);
  assert.ok(response.facets.object_type.some((facet) => facet.value === "compound" && facet.count === 1));
});

test("Phase 5 entity detail filters header and every section through the API boundary", async () => {
  const api = fixtureApi({
    entityDetail: {
      header: entityHeader(),
      mappings: [
        sectionRow({ id: "mapping:allowed", mapping_id: "mapping:allowed", assertion_type: "mapping" }),
        sectionRow({ id: "mapping:cross-tenant", tenant_id: "tenant-b", assertion_type: "mapping" })
      ],
      synonyms: [
        sectionRow({ id: "synonym:allowed", assertion_type: "synonym" }),
        sectionRow({ id: "synonym:hidden-role", assertion_type: "model_suggested" })
      ],
      relationships: [sectionRow({ id: "relationship:allowed", relationship_id: "relationship:allowed", assertion_type: "relationship" })],
      evidence: [sectionRow({ id: "evidence:allowed", evidence_id: "evidence:allowed", assertion_type: "evidence" })],
      history: [sectionRow({ id: "audit:allowed", assertion_type: "canonical" })],
      impact: [sectionRow({ id: "impact:allowed", assertion_type: "canonical" })]
    }
  });

  const response = await api.entityDetail({
    principal: viewer,
    entityId: "pharment:compound/aspirin",
    request: { release_id: "release-2026-01" }
  });

  assert.equal(response.authorization_filtered, true);
  assert.equal(response.header.entity_id, "pharment:compound/aspirin");
  assert.deepEqual(response.sections.mappings.map((row) => row.id), ["mapping:allowed"]);
  assert.deepEqual(response.sections.synonyms.map((row) => row.id), ["synonym:allowed"]);
  assert.deepEqual(response.sections.relationships.map((row) => row.id), ["relationship:allowed"]);
  assert.equal(response.sections.evidence[0].provenance_id, "pharmprov:fixture");
  assert.equal(response.sections.history.length, 1);
  assert.equal(response.sections.impact.length, 1);
});

test("Phase 5 explanation endpoint authorizes the hit before calling Andy explanation service", async () => {
  let explanationCalls = 0;
  const api = fixtureApi({
    resolveSearchHit: async ({ hitId }) => searchHit({ id: hitId, hit_id: hitId, assertion_id: "assertion:allowed" }),
    explanationService: {
      async explainSearchHit({ hit, tenant_id, environment, release_id }) {
        explanationCalls += 1;
        return {
          assertion: { assertion_id: hit.assertion_id, assertion_type: "normalized" },
          why: { match_reasons: hit.match_reasons },
          tenant_id,
          environment,
          release_id
        };
      }
    }
  });

  const response = await api.explainSearchHit({
    principal: viewer,
    hitId: "hit:allowed",
    request: { release_id: "release-2026-01" }
  });

  assert.equal(response.authorization_filtered, true);
  assert.equal(response.explanation.assertion.assertion_id, "assertion:allowed");
  assert.equal(explanationCalls, 1);

  await assert.rejects(
    () => fixtureApi({
      resolveSearchHit: async ({ hitId }) => searchHit({ id: hitId, hit_id: hitId, tenant_id: "tenant-b" }),
      explanationService: {
        async explainSearchHit() {
          throw new Error("must not call explanation for unauthorized hit");
        }
      }
    }).explainSearchHit({ principal: viewer, hitId: "hit:blocked", request: { release_id: "release-2026-01" } }),
    WorkbenchApiError
  );
});

test("Phase 5 export endpoint uses authorized export boundary and preserves regulated fields", async () => {
  const api = fixtureApi({
    exportRows: [
      exportRow({ id: "export:allowed", semantic_object_id: "pharment:compound/aspirin" }),
      exportRow({ id: "export:cross-tenant", tenant_id: "tenant-b" }),
      exportRow({ id: "export:not-permitted", permitted_uses: ["search"] }),
      exportRow({ id: "export:working", release_id: null, lifecycle_status: "draft" }),
      exportRow({ id: "export:invalid-authorized", provenance_id: undefined, artifact_hash: undefined })
    ]
  });

  const response = await api.createExport({
    principal: releaseManager,
    request: {
      export_id: "export:p5-api-test",
      scope: { type: "entity", entity_id: "pharment:compound/aspirin" },
      format: "json",
      release_id: "release-2026-01"
    }
  });

  assert.equal(response.authorization_filtered, true);
  assert.equal(response.record_count, 1);
  assert.equal("filtered_count" in response, false);
  assert.equal(response.invalid_record_count, 1);
  assert.equal(response.rows[0].canonical_ids.entity_id, "pharment:compound/aspirin");
  assert.equal(response.rows[0].provenance_id, "pharmprov:internal:export");
  assert.equal(response.rows[0].release_id, "release-2026-01");
  assert.equal(response.rows[0].artifact_hash, "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.ok(response.preserved_fields.includes("provenance_id"));
  assert.equal(response.row_content_hashes.length, 1);
  assert.match(response.row_content_hashes[0], /^sha256:[a-f0-9]{64}$/);
  assert.match(response.manifest_digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(response.export_job.artifact_hash, response.manifest_digest);
});

test("P5-RT-003 workbench export does not leak hidden counts or create ready jobs for zero-row scopes", async () => {
  const hiddenOnlyApi = fixtureApi({
    exportRows: [
      exportRow({ id: "export:hidden-cross-tenant", tenant_id: "tenant-b" })
    ]
  });

  const hiddenOnly = await hiddenOnlyApi.createExport({
    principal: releaseManager,
    request: {
      export_id: "export:p5-rt-003-hidden",
      scope: { type: "selected", object_ids: ["secret:tenant-b"] },
      format: "json",
      release_id: "release-2026-01"
    }
  });

  assert.equal(hiddenOnly.authorization_filtered, true);
  assert.equal(hiddenOnly.record_count, 0);
  assert.equal(hiddenOnly.invalid_record_count, 0);
  assert.equal("filtered_count" in hiddenOnly, false);
  assert.deepEqual(hiddenOnly.rows, []);
  assert.deepEqual(hiddenOnly.row_content_hashes, []);
  assert.equal(hiddenOnly.export_job, null);

  const mixedApi = fixtureApi({
    exportRows: [
      exportRow({ id: "export:hidden-cross-tenant", tenant_id: "tenant-b" }),
      exportRow({ id: "export:visible-invalid", artifact_hash: undefined })
    ]
  });

  const mixed = await mixedApi.createExport({
    principal: releaseManager,
    request: {
      export_id: "export:p5-rt-003-mixed",
      scope: { type: "selected", object_ids: ["secret:tenant-b", "visible-invalid"] },
      format: "json",
      release_id: "release-2026-01"
    }
  });

  assert.equal(mixed.record_count, 0);
  assert.equal(mixed.invalid_record_count, 1);
  assert.equal("filtered_count" in mixed, false);
  assert.equal(mixed.export_job, null);
});

function fixtureApi({
  searchResults = [],
  entityDetail = null,
  exportRows = [],
  explanationService = null,
  resolveSearchHit = null
} = {}) {
  return createPhase5WorkbenchApi({
    clock: () => new Date("2026-06-27T06:45:00.000Z"),
    idFactory: (() => {
      let id = 0;
      return () => `fixture-${++id}`;
    })(),
    async resolveSearchIndex() {
      return searchResults;
    },
    async resolveEntityDetail() {
      return entityDetail ?? { header: entityHeader() };
    },
    async resolveExportScope() {
      return exportRows;
    },
    explanationService,
    resolveSearchHit
  });
}

function searchHit(overrides = {}) {
  return authzRow({
    id: "hit:aspirin",
    hit_id: "hit:aspirin",
    object_id: "pharment:compound/aspirin",
    object_type: "compound",
    display_label: "Aspirin",
    preferred_label: "Aspirin",
    snippet: "Aspirin matched by label and synonym ASA.",
    rank: 1,
    score: 0.98,
    assertion_id: "assertion:aspirin",
    assertion_type: "canonical",
    lifecycle_status: "released",
    match_reasons: [
      { reason_type: "label", field: "preferred_label", matched_value: "Aspirin", normalized_value: "aspirin", source: "search_index", highlight_ranges: [] },
      { reason_type: "synonym", field: "synonyms", matched_value: "ASA", normalized_value: "asa", source: "search_index", evidence_id: "pharmev:evidence-1", highlight_ranges: [] }
    ],
    evidence_refs: [{ evidence_id: "pharmev:evidence-1", evidence_role: "supports" }],
    ...overrides
  });
}

function entityHeader(overrides = {}) {
  return authzRow({
    id: "pharment:compound/aspirin",
    entity_id: "pharment:compound/aspirin",
    object_id: "pharment:compound/aspirin",
    object_type: "compound",
    entity_type: "compound",
    preferred_label: "Aspirin",
    definition: "Acetylsalicylic acid.",
    external_ids: ["chembl:CHEMBL25", "pubchem:CID2244"],
    assertion_type: "canonical",
    lifecycle_status: "released",
    release_membership: ["release-2026-01"],
    ...overrides
  });
}

function sectionRow(overrides = {}) {
  return authzRow({
    id: "section:row",
    assertion_type: "canonical",
    lifecycle_status: "released",
    evidence_refs: [{ evidence_id: "pharmev:evidence-1", evidence_role: "supports" }],
    provenance_id: "pharmprov:fixture",
    ...overrides
  });
}

function exportRow(overrides = {}) {
  return authzRow({
    id: "export:row",
    semantic_object_id: "pharment:compound/aspirin",
    assertion_type: "evidence",
    lifecycle_status: "released",
    permitted_uses: ["search", "export"],
    canonical_ids: {
      entity_id: "pharment:compound/aspirin",
      source_entity_id: null,
      target_entity_id: null
    },
    source_vocabulary: undefined,
    source_vocabulary_version: undefined,
    target_vocabulary: undefined,
    target_vocabulary_version: undefined,
    source_version: undefined,
    source_terms_uri: undefined,
    evidence_refs: undefined,
    provenance_id: "pharmprov:internal:export",
    artifact_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    license_classification: "internal",
    license_policy_id: "license-policy:internal:workbench-export-fixture",
    ...overrides
  });
}

function authzRow(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    environment: "prod",
    release_id: "release-2026-01",
    permitted_uses: ["search", "export"],
    license_status: "valid",
    provenance_id: "pharmprov:fixture",
    source_vocabulary_version: "34",
    target_vocabulary_version: "2026-06-01",
    artifact_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    license_classification: "open_with_attribution",
    license_policy_id: "license-policy:chembl-34",
    ...overrides
  };
}
