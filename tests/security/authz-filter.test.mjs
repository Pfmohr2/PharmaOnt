import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { executeAuthorizedQuery } from "../../services/api/src/index.js";
import { assertResultFilterApplied, filterAuthorizedResults } from "../../services/authz-filter/src/index.js";
import { buildAuthorizedExport, buildExportRowContentHash, missingExportFields } from "../../services/export/src/index.js";
import { querySearchIndex } from "../../services/search/src/index.js";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const viewer = Object.freeze({
  user_id: "user:viewer-a",
  tenant_id: "tenant-a",
  environment: "prod",
  role_keys: ["viewer"],
  allowed_release_ids: ["release-2026-01"]
});

const releaseManager = Object.freeze({
  user_id: "user:release-manager-a",
  tenant_id: "tenant-a",
  environment: "prod",
  role_keys: ["release_manager"],
  allowed_release_ids: ["release-2026-01"]
});

test("P5 authz filter drops unauthorized and cross-tenant results before API response leaves server", async () => {
  const response = await executeAuthorizedQuery({
    principal: viewer,
    query: { q: "aspirin" },
    candidateResults: [
      releasedResult({ id: "allowed-a", tenant_id: "tenant-a" }),
      releasedResult({ id: "cross-tenant", tenant_id: "tenant-b" }),
      releasedResult({ id: "wrong-env", environment: "validation" }),
      releasedResult({ id: "working-draft", release_id: null, lifecycle_status: "draft" }),
      releasedResult({ id: "model-suggestion", assertion_type: "model_suggested" })
    ],
    releaseContext: { release_id: "release-2026-01" }
  });

  assertResultFilterApplied(response);
  assert.deepEqual(response.results.map((result) => result.id), ["allowed-a"]);
  assert.equal("filtered_count" in response, false);
});

test("P5 search boundary applies same server-side filter for Dwight index queries", () => {
  const response = querySearchIndex({
    principal: viewer,
    query: { q: "trial" },
    indexResults: [
      releasedResult({ id: "search-allowed", tenant_id: "tenant-a" }),
      releasedResult({ id: "search-cross-tenant", tenant_id: "tenant-b" }),
      releasedResult({ id: "search-hidden-role", visibility_roles: ["curator"] }),
      releasedResult({ id: "search-wrong-release", release_id: "release-2025-12" }),
      releasedResult({ id: "search-license-block", license_status: "blocked" })
    ],
    releaseContext: { release_id: "release-2026-01" }
  });

  assertResultFilterApplied(response);
  assert.deepEqual(response.results.map((result) => result.id), ["search-allowed"]);
  assert.equal("filtered_count" in response, false);
});

test("P5 export boundary enforces tenant, release, role, license, and export-use scope", () => {
  const exported = buildAuthorizedExport({
    principal: releaseManager,
    export_id: "export:p5-sec",
    releaseContext: { release_id: "release-2026-01" },
    candidateResults: [
      releasedResult({ id: "export-allowed", tenant_id: "tenant-a", permitted_uses: ["search", "export"] }),
      releasedResult({ id: "export-cross-tenant", tenant_id: "tenant-b", permitted_uses: ["search", "export"] }),
      releasedResult({ id: "export-working", release_id: null, permitted_uses: ["search", "export"] }),
      releasedResult({ id: "export-not-permitted", permitted_uses: ["search"] }),
      releasedResult({ id: "export-phi", permitted_uses: ["search", "export"], export_restrictions: ["contains_phi_or_pii"] })
    ]
  });

  assertResultFilterApplied(exported);
  assert.deepEqual(exported.rows.map((result) => result.id), ["export-allowed"]);
  assert.equal("filtered_count" in exported, false);
  assert.equal(exported.invalid_record_count, 0);
  assert.match(exported.manifest_digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(exported.row_content_hashes, [buildExportRowContentHash(exported.rows[0])]);
});

test("P5-RT-003 authz chokepoints do not expose hidden filtered counts", async () => {
  const apiResponse = await executeAuthorizedQuery({
    principal: viewer,
    query: { q: "hidden" },
    candidateResults: [releasedResult({ id: "hidden-api", tenant_id: "tenant-b" })],
    releaseContext: { release_id: "release-2026-01" }
  });
  const searchResponse = querySearchIndex({
    principal: viewer,
    query: { q: "hidden" },
    indexResults: [releasedResult({ id: "hidden-search", tenant_id: "tenant-b" })],
    releaseContext: { release_id: "release-2026-01" }
  });
  const exportResponse = buildAuthorizedExport({
    principal: releaseManager,
    export_id: "export:p5-rt-003-hidden",
    releaseContext: { release_id: "release-2026-01" },
    candidateResults: [releasedResult({ id: "hidden-export", tenant_id: "tenant-b" })]
  });

  for (const response of [apiResponse, searchResponse, exportResponse]) {
    assert.equal("filtered_count" in response, false);
    assert.equal("hidden_count" in response, false);
    assert.equal("authorization_filtered_count" in response, false);
    assert.equal(response.authorization_filtered, true);
  }
});

test("P5-RT-001 export drops rows missing regulated provenance, vocabulary, artifact, and license fields", () => {
  const exported = buildAuthorizedExport({
    principal: releaseManager,
    export_id: "export:p5-rt-001",
    releaseContext: { release_id: "release-2026-01" },
    candidateResults: [
      releasedResult({
        id: "missing-regulated-fields",
        provenance_id: undefined,
        source_vocabulary_version: undefined,
        target_vocabulary_version: undefined,
        artifact_hash: undefined,
        license_policy_id: undefined
      }),
      releasedResult({ id: "complete-row" })
    ]
  });

  assertResultFilterApplied(exported);
  assert.deepEqual(exported.rows.map((result) => result.id), ["complete-row"]);
  assert.equal(exported.invalid_record_count, 1);
  assert.deepEqual(missingExportFields(releasedResult({
    provenance_id: undefined,
    artifact_hash: undefined,
    license_policy_id: undefined
  })), [
    "provenance_id",
    "artifact_hash",
    "license_policy_id"
  ]);
});

test("P5-RT-002 export manifest digest changes when regulated row content changes", () => {
  const base = {
    principal: releaseManager,
    export_id: "export:p5-rt-002",
    releaseContext: { release_id: "release-2026-01" }
  };
  const first = buildAuthorizedExport({
    ...base,
    candidateResults: [releasedResult({
      id: "same-id",
      provenance_id: "pharmprov:internal:first",
      artifact_hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      license_policy_id: "license-policy:internal:first"
    })]
  });
  const second = buildAuthorizedExport({
    ...base,
    candidateResults: [releasedResult({
      id: "same-id",
      provenance_id: "pharmprov:internal:second",
      artifact_hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      license_policy_id: "license-policy:internal:second"
    })]
  });

  assert.equal(first.record_count, 1);
  assert.equal(second.record_count, 1);
  assert.notEqual(first.row_content_hashes[0], second.row_content_hashes[0]);
  assert.notEqual(first.manifest_digest, second.manifest_digest);
});

test("P5 direct authz filter fails closed on missing scope and preserves curator access to model suggestions", () => {
  const curator = {
    user_id: "user:curator-a",
    tenant_id: "tenant-a",
    environment: "prod",
    role_keys: ["curator"]
  };
  const results = filterAuthorizedResults({
    principal: curator,
    results: [
      releasedResult({ id: "missing-tenant", tenant_id: undefined }),
      releasedResult({ id: "missing-env", environment: undefined }),
      releasedResult({ id: "model-ok", assertion_type: "model_suggested", release_id: null, lifecycle_status: "draft" }),
      releasedResult({ id: "restricted-ok", assertion_type: "restricted_evidence", release_id: "release-2026-01" })
    ]
  });

  assert.deepEqual(results.map((result) => result.id), ["model-ok", "restricted-ok"]);
});

test("P5 server modules expose and call the central authz filter chokepoint", () => {
  for (const relativePath of [
    "services/api/src/query-boundary.js",
    "services/search/src/index.js",
    "services/export/src/index.js"
  ]) {
    const source = readFileSync(resolve(repoRoot, relativePath), "utf8");
    assert.match(source, /filterAuthorizedResults|filterAuthorizedResponse/, `${relativePath} must call authz filter`);
  }
});

function releasedResult(overrides = {}) {
  return {
    id: "result",
    tenant_id: "tenant-a",
    environment: "prod",
    assertion_type: "evidence",
    release_id: "release-2026-01",
    lifecycle_status: "released",
    permitted_uses: ["search", "export"],
    license_status: "valid",
    provenance_id: "pharmprov:internal:export",
    artifact_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    license_classification: "internal",
    license_policy_id: "license-policy:internal:authz-fixture",
    ...overrides
  };
}
