import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createPhase5WorkbenchApi } from "../../services/api/src/index.js";
import { ExplanationEvidenceService } from "../../services/explanation/src/index.js";
import { createSearchIndexService } from "../../services/search/src/index.js";
import {
  renderEntityPage,
  renderEvidenceViewer,
  renderExplanationPanel,
  renderExportAffordance,
  renderSearchSurface,
  renderWorkbenchShell
} from "../../apps/web/src/workbench/index.js";

const golden = JSON.parse(readFileSync(new URL("./fixtures/phase5-search-golden.json", import.meta.url), "utf8"));
const releaseContext = Object.freeze({ release_id: golden.release_id, scope: "release" });
const releaseManager = Object.freeze({
  user_id: "user:release-manager-p5",
  tenant_id: golden.tenant_id,
  environment: golden.environment,
  role_keys: ["release_manager"],
  allowed_release_ids: [golden.release_id],
  release_id: golden.release_id
});

test("Phase 5 E2E: real search, API authz, explanation, entity detail, export, and FE shaping", async () => {
  const harness = phase5Harness();

  const searchResponse = await harness.api.search({
    principal: releaseManager,
    request: { query: "aspirin", release_id: golden.release_id }
  });
  assert.equal(searchResponse.schema_version, "phase5.workbench-api.v1");
  assert.equal(searchResponse.authorization_filtered, true);
  assert.equal(searchResponse.visible_count, 2);
  assert.deepEqual(searchResponse.results.map((row) => row.object_id), [
    "pharmrel:aspirin-ptgs1",
    "pharment:compound/aspirin"
  ]);
  assert.ok(searchResponse.results.every((row) => row.match_reasons.length > 0));
  assert.ok(searchResponse.results.every((row) => row.badges.length > 0));
  assert.equal("filtered_count" in searchResponse, false);

  const searchSurface = renderSearchSurface(searchResponse);
  assert.equal(searchSurface.unauthorized_hidden_count, null);
  assert.equal(searchSurface.results[0].actions.why, true);
  assert.ok(searchSurface.results[0].assertion_badge.some((badge) => badge.accessible_label));

  const entityDetail = await harness.api.entityDetail({
    principal: releaseManager,
    entityId: "pharment:compound/aspirin",
    request: { release_id: golden.release_id }
  });
  assert.equal(entityDetail.authorization_filtered, true);
  assert.deepEqual(Object.keys(entityDetail.sections), ["mappings", "synonyms", "relationships", "evidence", "history", "impact"]);
  assert.ok(Object.values(entityDetail.sections).every((rows) => rows.length === 1));
  const entityPage = renderEntityPage(entityDetail);
  assert.deepEqual(entityPage.tabs.map((tab) => tab.id), ["mappings", "synonyms", "relationships", "evidence", "history", "impact"]);

  const relationshipHit = searchResponse.results.find((row) => row.object_type === "relationship").source;
  const explanationResponse = await harness.api.explainSearchHit({
    principal: releaseManager,
    hit: relationshipHit,
    request: { release_id: golden.release_id }
  });
  assert.equal(explanationResponse.authorization_filtered, true);
  assert.equal(explanationResponse.explanation.assertion.assertion_type, "human_curated");
  assert.equal(explanationResponse.explanation.evidence[0].evidence_id, "pharmev:evidence-target");
  assert.equal(explanationResponse.explanation.provenance_chain[0].provenance_id, "pharmprov:relationship-aspirin-ptgs1");
  const workbenchExplanation = toWorkbenchExplanationResponse(explanationResponse);
  const explanationPanel = renderExplanationPanel(workbenchExplanation);
  assert.equal(explanationPanel.component, "ExplanationPanel");
  assert.ok(explanationPanel.match_reasons.some((reason) => reason.reason_type === "relationship"));

  const evidenceResponse = await harness.api.evidenceForAssertion({
    principal: releaseManager,
    assertionId: "pharmrel:aspirin-ptgs1",
    request: {
      release_id: golden.release_id,
      assertion: harness.recordsById.get("pharmrel:aspirin-ptgs1")
    }
  });
  assert.equal(evidenceResponse.authorization_filtered, true);
  assert.equal(evidenceResponse.evidence.evidence_objects[0].source_name, "Manual curation");
  assert.equal(evidenceResponse.evidence.integrity_bindings.audit_event_ids[0], "audit:relationship-aspirin-ptgs1");
  const evidenceViewer = renderEvidenceViewer(toWorkbenchEvidenceResponse(evidenceResponse, "pharmrel:aspirin-ptgs1"));
  assert.equal(evidenceViewer.component, "EvidenceViewer");
  assert.equal(evidenceViewer.source_version, "2026-06-27");

  const exportResponse = await harness.api.createExport({
    principal: releaseManager,
    request: {
      export_id: "export:p5-e2e",
      scope: { type: "entity", entity_id: "pharment:compound/aspirin" },
      format: "json",
      release_id: golden.release_id
    }
  });
  assert.equal(exportResponse.authorization_filtered, true);
  assert.equal(exportResponse.record_count, 3);
  assert.equal("filtered_count" in exportResponse, false);
  assertExportFidelity(exportResponse.rows.find((row) => row.semantic_object_id === "pharment:compound/aspirin"));
  const exportView = renderExportAffordance(exportResponse);
  assert.equal(exportView.create_enabled, true);
  assert.match(exportView.manifest_digest, /^sha256:[a-f0-9]{64}$/);

  const shell = renderWorkbenchShell({
    searchResponse,
    entityDetail,
    explanation: workbenchExplanation,
    evidence: toWorkbenchEvidenceResponse(evidenceResponse, "pharmrel:aspirin-ptgs1"),
    exportPreview: exportResponse
  });
  assert.equal(shell.component, "WorkbenchShell");
  assert.equal(shell.search.results.length, 2);
  assert.equal(shell.entity.tabs.length, 6);
  assert.equal(shell.explanation.component, "ExplanationPanel");
  assert.equal(shell.evidence.component, "EvidenceViewer");
  assert.equal(shell.export_affordance.component, "ExportAffordance");
});

test("Phase 5 golden search eval fixtures lock keyword, CURIE, synonym, ranking, facets, and reasons", async () => {
  const harness = phase5Harness();

  for (const queryCase of golden.golden_queries) {
    const response = await harness.api.search({
      principal: releaseManager,
      request: {
        query_id: `query:${queryCase.name}`,
        query: queryCase.query,
        release_id: golden.release_id
      }
    });

    assert.equal(response.authorization_filtered, true);
    assert.deepEqual(
      response.results.slice(0, queryCase.expected_top_ids.length).map((row) => row.object_id),
      queryCase.expected_top_ids,
      `${queryCase.name} ranking drift`
    );
    for (const reasonType of queryCase.expected_reason_types) {
      assert.ok(
        response.results.some((row) => row.match_reasons.some((reason) => reason.reason_type === reasonType)),
        `${queryCase.name} missing reason ${reasonType}`
      );
    }
    for (const [facetName, expectedValues] of Object.entries(queryCase.expected_facets)) {
      for (const expectedValue of expectedValues) {
        assert.ok(
          response.facets[facetName].some((facet) => facet.value === expectedValue && facet.count > 0),
          `${queryCase.name} missing facet ${facetName}:${expectedValue}`
        );
      }
    }
  }
});

test("Phase 5 unauthorized results are absent server-side with no hidden counts or placeholders", async () => {
  const harness = phase5Harness();
  const response = await harness.api.search({
    principal: releaseManager,
    request: { query: "chembl:CHEMBL25-HIDDEN", release_id: golden.release_id }
  });
  const surface = renderSearchSurface(response);

  assert.equal(response.authorization_filtered, true);
  assert.equal(response.visible_count, 0);
  assert.deepEqual(response.results, []);
  assert.equal("filtered_count" in response, false);
  assert.equal(surface.unauthorized_hidden_count, null);
  assert.equal(surface.empty_state, "No visible results in this release context");
  assert.doesNotMatch(JSON.stringify(response), /hidden_count|unauthorized_count|placeholder/i);
});

test("Phase 5 export provenance fidelity preserves regulated fields", async () => {
  const harness = phase5Harness();
  const response = await harness.api.createExport({
    principal: releaseManager,
    request: {
      export_id: "export:p5-fidelity",
      scope: { type: "search", query_id: "query:aspirin" },
      format: "json",
      release_id: golden.release_id
    }
  });

  assert.equal(response.record_count, 3);
  assert.match(response.manifest_digest, /^sha256:[a-f0-9]{64}$/);
  for (const field of [
    "canonical_ids",
    "source_vocabulary_version",
    "target_vocabulary_version",
    "evidence_refs",
    "provenance_id",
    "source_version",
    "release_id",
    "artifact_hash",
    "license_classification",
    "license_policy_id"
  ]) {
    assert.ok(response.preserved_fields.includes(field), `missing preserved field ${field}`);
  }
  for (const row of response.rows) {
    assert.ok(row.semantic_object_id);
    assert.ok(row.canonical_ids);
    assert.ok(row.source_vocabulary_version);
    assert.ok(row.target_vocabulary_version);
    assert.ok(row.release_context.release_id);
    assert.ok(row.provenance_id);
    assert.ok(row.source_version);
    assert.equal(row.release_id, golden.release_id);
    assert.match(row.artifact_hash, /^sha256:[a-f0-9]{64}$/);
    assert.ok(row.license_classification);
  }
});

function phase5Harness() {
  const records = golden.records.map(withAuthzDefaults);
  const recordsById = new Map(records.flatMap((record) => [
    [record.id, record],
    [record.object_id, record],
    [record.assertion_id, record],
    [record.relationship_id, record],
    [record.entity_id, record]
  ].filter(([, value]) => value)));
  const searchService = createSearchIndexService({
    documents: records,
    clock: fixedClock
  });
  const explanationService = new ExplanationEvidenceService({
    clock: fixedClock,
    async resolveAssertion({ assertion_id }) {
      const record = recordsById.get(assertion_id);
      if (!record) return null;
      if (assertion_id === "pharmrel:aspirin-ptgs1") {
        return { ...record, assertion_type: "human_curated" };
      }
      return { ...record, assertion_type: record.assertion_type === "canonical" ? "normalized" : record.assertion_type };
    },
    async resolveEvidence({ evidence_id }) {
      return evidenceFor(evidence_id);
    },
    async resolveProvenance({ provenance_id }) {
      return provenanceFor(provenance_id);
    },
    async resolveMatchReasons({ assertion_id }) {
      if (assertion_id === "pharmrel:aspirin-ptgs1") {
        return [
          {
            match_type: "relationship",
            reason_type: "relationship",
            matched_field: "relationships",
            field: "relationships",
            matched_value: "compound_has_target",
            query_term: "aspirin",
            source: "search_index",
            score_contribution: 0.68
          },
          {
            match_type: "evidence",
            reason_type: "evidence",
            matched_field: "evidence_refs",
            field: "evidence_refs",
            matched_value: "Curated PTGS1 target relationship for aspirin.",
            query_term: "aspirin",
            source: "Manual curation",
            score_contribution: 0.56
          }
        ];
      }
      return [
        {
          match_type: "label",
          reason_type: "label",
          matched_field: "preferred_label",
          field: "preferred_label",
          matched_value: "Aspirin",
          query_term: "aspirin",
          source: "search_index",
          score_contribution: 0.9
        }
      ];
    }
  });
  const api = createPhase5WorkbenchApi({
    clock: fixedClock,
    idFactory: sequenceIds(),
    async resolveSearchIndex({ query, principal, releaseContext }) {
      return searchService.search({ principal, query, releaseContext }).results;
    },
    async resolveEntityDetail() {
      return entityDetail(recordsById);
    },
    async resolveExportScope() {
      return records.map(exportRow);
    },
    explanationService
  });
  return { api, records, recordsById };
}

function withAuthzDefaults(record) {
  return {
    tenant_id: golden.tenant_id,
    environment: golden.environment,
    release_id: golden.release_id,
    lifecycle_status: "released",
    review_status: "approved",
    permitted_uses: ["search", "export"],
    license_status: "valid",
    source_vocabulary_version: "2026-06-27",
    target_vocabulary_version: "2026-06-27",
    source_version: "2026-06-27",
    license_classification: "internal_governed",
    license_policy_id: "license-policy:internal",
    ...record
  };
}

function entityDetail(recordsById) {
  const compound = recordsById.get("pharment:compound/aspirin");
  const relationship = recordsById.get("pharmrel:aspirin-ptgs1");
  const sectionBase = {
    tenant_id: golden.tenant_id,
    environment: golden.environment,
    release_id: golden.release_id,
    lifecycle_status: "released",
    permitted_uses: ["search", "export"],
    license_status: "valid"
  };
  return {
    header: {
      ...sectionBase,
      id: compound.entity_id,
      entity_id: compound.entity_id,
      object_id: compound.entity_id,
      object_type: "compound",
      entity_type: "compound",
      assertion_type: "canonical",
      preferred_label: "Aspirin",
      definition: compound.definition,
      external_ids: compound.identifiers,
      release_membership: [golden.release_id]
    },
    mappings: [{ ...sectionBase, id: "pharmmap:aspirin-chembl-pubchem", mapping_id: "pharmmap:aspirin-chembl-pubchem", assertion_type: "mapping", evidence_refs: compound.evidence_refs, provenance_id: compound.provenance_id }],
    synonyms: [{ ...sectionBase, id: "synonym:asa", assertion_type: "canonical", evidence_refs: [compound.evidence_refs[1]], provenance_id: compound.provenance_id }],
    relationships: [{ ...sectionBase, id: relationship.relationship_id, relationship_id: relationship.relationship_id, assertion_type: "relationship", evidence_refs: relationship.evidence_refs, provenance_id: relationship.provenance_id }],
    evidence: [{ ...sectionBase, id: "pharmev:evidence-chembl", evidence_id: "pharmev:evidence-chembl", assertion_type: "evidence", evidence_refs: [compound.evidence_refs[0]], provenance_id: "pharmprov:evidence-chembl" }],
    history: [{ ...sectionBase, id: "audit:aspirin-release", audit_event_id: "audit:aspirin-release", assertion_type: "canonical", provenance_id: compound.provenance_id }],
    impact: [{ ...sectionBase, id: "impact:aspirin-export", assertion_type: "canonical", provenance_id: compound.provenance_id }]
  };
}

function evidenceFor(evidence_id) {
  const evidence = {
    "pharmev:evidence-target": {
      evidence_id,
      evidence_type: "curation_note",
      evidence_role: "supports",
      source_name: "Manual curation",
      source_version: "2026-06-27",
      source_record_id: "curation:aspirin-ptgs1",
      source_record_uri: "pharmaops://curation/aspirin-ptgs1",
      record_hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      snippet: "Curated PTGS1 target relationship for aspirin.",
      license_classification: "internal_governed",
      materialization_policy: "materialize",
      provenance_id: "pharmprov:evidence-target",
      release_id: golden.release_id
    },
    "pharmev:evidence-chembl": {
      evidence_id,
      evidence_type: "source_record",
      evidence_role: "supports",
      source_name: "ChEMBL",
      source_version: "34",
      source_record_id: "CHEMBL25",
      source_record_uri: "https://example.test/chembl/CHEMBL25",
      record_hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      snippet: "Aspirin source record CHEMBL25.",
      license_classification: "open_with_attribution",
      materialization_policy: "materialize",
      provenance_id: "pharmprov:evidence-chembl",
      release_id: golden.release_id
    }
  }[evidence_id];
  return evidence ? { tenant_id: golden.tenant_id, environment: golden.environment, ...evidence } : null;
}

function provenanceFor(provenance_id) {
  const sourceName = provenance_id.includes("relationship") || provenance_id.includes("target") ? "Manual curation" : "ChEMBL";
  const sourceVersion = sourceName === "Manual curation" ? "2026-06-27" : "34";
  return {
    provenance_id,
    object_id: provenance_id.includes("relationship") ? "pharmrel:aspirin-ptgs1" : "pharment:compound/aspirin",
    object_type: provenance_id.includes("evidence") ? "evidence_object" : "assertion",
    actor: { actor_type: "service_account", actor_id: "service:phase5-fixture" },
    activity: { activity_type: "phase5_e2e_fixture", activity_id: `activity:${provenance_id}` },
    source: { source_name: sourceName, source_version: sourceVersion },
    time: { occurred_at: fixedClock().toISOString() },
    method: { method_type: "fixture", method_id: "phase5-e2e" },
    environment: { tenant_id: golden.tenant_id, environment: golden.environment },
    release: { release_id: golden.release_id, release_status: "released" },
    audit_event_ids: [provenance_id.includes("relationship") ? "audit:relationship-aspirin-ptgs1" : `audit:${provenance_id}`]
  };
}

function exportRow(record) {
  return {
    ...record,
    semantic_object_id: record.entity_id ?? record.relationship_id ?? record.object_id ?? record.id,
    canonical_ids: {
      entity_id: record.entity_id ?? null,
      assertion_id: record.assertion_id ?? record.relationship_id ?? null,
      source_entity_id: record.source_entity_id ?? "chembl:CHEMBL25",
      target_entity_id: record.target_entity_id ?? record.object_id ?? "pubchem:CID2244"
    },
    source_vocabulary_version: record.source_vocabulary_version ?? record.source_version,
    target_vocabulary_version: record.target_vocabulary_version ?? "2026-06-27",
    release_context: releaseContext
  };
}

function toWorkbenchEvidenceResponse(response, assertionId) {
  const evidence = response.evidence.evidence_objects[0];
  return {
    schema_version: response.schema_version,
    tenant_id: response.tenant_id,
    environment: response.environment,
    release_context: response.release_context,
    authorization_filtered: response.authorization_filtered,
    evidence: {
      ...evidence,
      artifact_hash: evidence.record_hash,
      content_mode: "snippet",
      content: evidence.snippet,
      export_restrictions: evidence.license_classification === "open_with_attribution" ? ["attribution_required"] : [],
      supports: [{
        assertion_id: assertionId,
        assertion_type: response.evidence.assertion.assertion_type,
        lifecycle_status: response.evidence.assertion.lifecycle_status,
        release_id: response.evidence.assertion.release_id
      }],
      actions: { can_export: true, can_open_artifact: false, can_view_raw: false }
    }
  };
}

function toWorkbenchExplanationResponse(response) {
  const explanation = response.explanation;
  return {
    ...response,
    explanation: {
      ...explanation,
      object_id: explanation.assertion.assertion_id,
      object_type: explanation.assertion.assertion_kind,
      assertion_type: explanation.assertion.assertion_type,
      lifecycle_status: explanation.assertion.lifecycle_status,
      release_id: explanation.assertion.release_id,
      match_reasons: explanation.why.match_reasons.map((reason) => ({
        reason_type: reason.match_type,
        field: reason.matched_field,
        matched_value: reason.matched_value,
        normalized_value: null,
        source: reason.source,
        evidence_id: reason.evidence_id ?? null
      })),
      evidence_chain: explanation.evidence.map((evidence) => ({
        evidence_id: evidence.evidence_id,
        evidence_role: evidence.evidence_role,
        source_name: evidence.source_name,
        source_version: evidence.source_version
      })),
      provenance: explanation.provenance_chain[0] ?? null,
      governance: explanation.governance_flags
    }
  };
}

function assertExportFidelity(row) {
  assert.equal(row.canonical_ids.entity_id, "pharment:compound/aspirin");
  assert.equal(row.canonical_ids.source_entity_id, "chembl:CHEMBL25");
  assert.equal(row.source_vocabulary_version, "34");
  assert.equal(row.target_vocabulary_version, "2026-06-01");
  assert.equal(row.release_context.release_id, golden.release_id);
  assert.equal(row.provenance_id, "pharmprov:aspirin");
  assert.equal(row.source_version, "34");
  assert.equal(row.release_id, golden.release_id);
  assert.match(row.artifact_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(row.license_classification, "open_with_attribution");
  assert.equal(row.license_policy_id, "license-policy:chembl-34");
}

function fixedClock() {
  return new Date("2026-06-27T07:55:00.000Z");
}

function sequenceIds() {
  let id = 0;
  return () => `fixture-${++id}`;
}
