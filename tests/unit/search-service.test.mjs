import assert from "node:assert/strict";
import test from "node:test";

import {
  SEARCH_INDEX_SCHEMA_VERSION,
  SEARCHABLE_OBJECT_TYPES,
  buildSearchFacets,
  createSearchIndexService,
  indexGovernedRecords,
  querySearchIndex,
  searchIndexedDocuments
} from "../../services/search/src/index.js";

const viewer = Object.freeze({
  user_id: "user:viewer-a",
  tenant_id: "tenant-a",
  environment: "prod",
  role_keys: ["viewer"],
  allowed_release_ids: ["release-2026-01"],
  release_id: "release-2026-01"
});

const curator = Object.freeze({
  user_id: "user:curator-a",
  tenant_id: "tenant-a",
  environment: "prod",
  role_keys: ["curator"]
});

test("P5 search index covers governed canonical entities, mappings, relationships, evidence, and documents", () => {
  const documents = indexGovernedRecords(governedStoreState());

  assert.ok(SEARCHABLE_OBJECT_TYPES.includes("adverse_event"));
  assert.equal(documents.every((document) => document.schema_version === SEARCH_INDEX_SCHEMA_VERSION), true);
  assert.deepEqual(
    documents.map((document) => document.object_type).sort(),
    ["compound", "document", "evidence", "mapping", "relationship"].sort()
  );
  assert.ok(documents.every((document) => document.indexed_for_tenant === "tenant-a"));
  assert.ok(documents.every((document) => document.release_context.release_id === "release-2026-01"));
});

test("P5 search returns keyword hits with facets through the Oscar authz chokepoint", () => {
  const service = createSearchIndexService({
    documents: [
      ...indexGovernedRecords(governedStoreState()),
      compoundRecord({ id: "compound:cross-tenant", tenant_id: "tenant-b" }),
      compoundRecord({ id: "compound:wrong-release", release_id: "release-2025-12" }),
      compoundRecord({ id: "compound:blocked", license_status: "blocked" })
    ],
    clock: () => new Date("2026-06-27T07:00:00.000Z")
  });

  const response = service.search({
    principal: viewer,
    query: { q: "aspirin", filters: { object_type: ["compound"] } },
    releaseContext: { release_id: "release-2026-01" }
  });

  assert.equal(response.authorization_filtered, true);
  assert.equal(response.total, 1);
  assert.equal("filtered_count" in response, false);
  assert.equal(response.results[0].object_id, "pharment:compound/aspirin");
  assert.equal(response.results[0].match_reasons[0].reason_type, "label");
  assert.equal(response.results[0].match_reasons[0].match_type, "label");
  assert.ok(response.facets.object_type.some((facet) => facet.value === "compound" && facet.count === 1));
  assert.ok(response.facets.source.some((facet) => facet.value === "ChEMBL" && facet.count === 1));
  assert.ok(response.facets.release_context.some((facet) => facet.value === "release-2026-01" && facet.count === 1));
});

test("P5 search supports identifier and CURIE lookup with stable match reasons", () => {
  const candidates = searchIndexedDocuments({
    documents: indexGovernedRecords(governedStoreState()),
    query: { q: "chembl:CHEMBL25", filters: { object_type: ["compound"] } }
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].object_id, "pharment:compound/aspirin");
  assert.ok(reasonSummary(candidates[0]).some((reason) => deepEqual(reason, {
    reason_type: "identifier",
    match_type: "identifier",
    field: "identifiers",
    matched_field: "identifiers",
    matched_value: "chembl:CHEMBL25",
    query_term: "chembl:CHEMBL25"
  })));
});

test("P5 search expands synonyms and emits Andy-compatible authoritative match reasons", () => {
  const [hit] = searchIndexedDocuments({
    documents: indexGovernedRecords(governedStoreState()),
    query: { q: "ASA" }
  });

  assert.equal(hit.object_id, "pharment:compound/aspirin");
  assert.equal(hit.match_reasons[0].reason_type, "synonym");
  assert.equal(hit.match_reasons[0].match_type, "synonym");
  assert.equal(hit.match_reasons[0].field, "synonyms");
  assert.equal(hit.match_reasons[0].matched_field, "synonyms");
  assert.equal(hit.match_reasons[0].matched_value, "ASA");
  assert.equal(hit.match_reasons[0].synonym_id, "synonym:asa");
  assert.equal(hit.match_reasons[0].evidence_id, "evidence:asa-label");
});

test("P5 search can facet by entity type, source, assertion type, and release context", () => {
  const hits = searchIndexedDocuments({
    documents: indexGovernedRecords(governedStoreState()),
    query: { q: "aspirin", filters: { object_type: ["compound"] } }
  });
  const facets = buildSearchFacets(hits);

  assert.ok(facets.entity_type.some((facet) => facet.value === "compound" && facet.count === 1));
  assert.ok(facets.source.some((facet) => facet.value === "ChEMBL" && facet.count === 1));
  assert.ok(facets.assertion_type.some((facet) => facet.value === "canonical" && facet.count === 1));
  assert.ok(facets.release_context.some((facet) => facet.value === "release-2026-01" && facet.count === 1));
});

test("P5 querySearchIndex remains the required authz chokepoint for precomputed candidates", () => {
  const response = querySearchIndex({
    principal: viewer,
    query: { q: "aspirin" },
    indexResults: [
      compoundRecord({ id: "allowed" }),
      compoundRecord({ id: "cross-tenant", tenant_id: "tenant-b" }),
      compoundRecord({ id: "not-searchable", permitted_uses: ["export"] })
    ],
    releaseContext: { release_id: "release-2026-01" }
  });

  assert.equal(response.authorization_filtered, true);
  assert.deepEqual(response.results.map((result) => result.id), ["allowed"]);
  assert.equal("filtered_count" in response, false);
});

test("P6 AI suggestions index as working model_suggested candidates with payload, spans, and safety context", () => {
  const service = createSearchIndexService({
    documents: [aiSuggestionRecord()],
    clock: () => new Date("2026-06-27T08:40:00.000Z")
  });

  const response = service.search({
    principal: curator,
    query: { q: "PTGS1" }
  });

  assert.equal(response.authorization_filtered, true);
  assert.equal(response.total, 1);
  const [hit] = response.results;
  assert.equal(hit.object_id, "aisug:aspirin-ptgs1");
  assert.equal(hit.object_type, "ai_suggestion");
  assert.equal(hit.assertion_type, "model_suggested");
  assert.equal(hit.release_id, null);
  assert.equal(hit.release_context.scope, "working");
  assert.equal(hit.governance.release_eligible, false);
  assert.equal(hit.governance.visual_state, "ai_suggestion_distinct");
  assert.equal(hit.duplicate_status, "not_duplicate");
  assert.ok(hit.identifiers.includes("aisug:aspirin-ptgs1"));
  assert.ok(hit.identifiers.includes("pharmprov:ai-suggestion/ptgs1"));
  assert.ok(hit.match_reasons.some((reason) => reason.reason_type === "document" && reason.matched_value.includes("PTGS1")));
  assert.deepEqual(hit.evidence_refs[0].disclaimer_ids, ["source_limit:faers_non_causal"]);
  assert.ok(hit.evidence_refs[0].source_limitations[0].includes("non-causal"));
});

test("P6 AI suggestions are filterable and faceted by assertion_type=model_suggested", () => {
  const service = createSearchIndexService({
    documents: [compoundRecord(), aiSuggestionRecord()],
    clock: () => new Date("2026-06-27T08:40:00.000Z")
  });

  const response = service.search({
    principal: curator,
    query: { q: "aspirin", filters: { assertion_type: ["model_suggested"] } }
  });

  assert.equal(response.authorization_filtered, true);
  assert.equal(response.total, 1);
  assert.equal(response.results[0].assertion_type, "model_suggested");
  assert.equal(response.results[0].object_type, "ai_suggestion");
  assert.ok(response.facets.assertion_type.some((facet) => facet.value === "model_suggested" && facet.count === 1));
  assert.equal("filtered_count" in response, false);
});

test("P6 AI suggestions are not returned inside a release context", () => {
  const service = createSearchIndexService({
    documents: [aiSuggestionRecord()],
    clock: () => new Date("2026-06-27T08:40:00.000Z")
  });

  const response = service.search({
    principal: curator,
    query: { q: "PTGS1", release_context: { release_id: "release-2026-01", scope: "release" } },
    releaseContext: { release_id: "release-2026-01", scope: "release" }
  });

  assert.equal(response.authorization_filtered, true);
  assert.equal(response.total, 0);
  assert.deepEqual(response.results, []);
});

function governedStoreState() {
  return {
    compounds: [compoundRecord()],
    mappings: [mappingRecord()],
    relationships: [relationshipRecord()],
    evidence: [evidenceRecord()],
    documents: [documentRecord()]
  };
}

function compoundRecord(overrides = {}) {
  return authzRecord({
    id: "pharment:compound/aspirin",
    object_id: "pharment:compound/aspirin",
    object_type: "compound",
    entity_type: "compound",
    assertion_id: "assertion:compound-aspirin",
    assertion_type: "canonical",
    preferred_label: "Aspirin",
    display_label: "Aspirin",
    definition: "Acetylsalicylic acid.",
    identifiers: ["chembl:CHEMBL25", "pubchem:CID2244"],
    synonyms: [
      {
        synonym_id: "synonym:asa",
        value: "ASA",
        source: "RxNorm",
        evidence_id: "evidence:asa-label"
      }
    ],
    mappings: [
      {
        mapping_id: "mapping:chembl25-pubchem2244",
        source_id: "chembl:CHEMBL25",
        target_id: "pubchem:CID2244",
        mapping_type: "exactMatch",
        source: "ChEMBL"
      }
    ],
    evidence_refs: [
      {
        evidence_id: "evidence:asa-label",
        source_name: "ChEMBL",
        snippet: "Aspirin has synonym ASA."
      }
    ],
    source_name: "ChEMBL",
    ...overrides
  });
}

function mappingRecord(overrides = {}) {
  return authzRecord({
    id: "mapping:chembl25-pubchem2244",
    mapping_id: "mapping:chembl25-pubchem2244",
    object_type: "mapping",
    assertion_type: "mapping",
    display_label: "ChEMBL25 exact match PubChem CID2244",
    source_entity_id: "chembl:CHEMBL25",
    target_entity_id: "pubchem:CID2244",
    mapping_type: "exactMatch",
    source_name: "ChEMBL",
    ...overrides
  });
}

function relationshipRecord(overrides = {}) {
  return authzRecord({
    id: "relationship:aspirin-treats-pain",
    relationship_id: "relationship:aspirin-treats-pain",
    object_type: "relationship",
    assertion_type: "relationship",
    display_label: "Aspirin treats pain",
    subject_id: "pharment:compound/aspirin",
    predicate: "treats",
    object_id: "pharment:disease/pain",
    source_name: "Manual curation",
    ...overrides
  });
}

function evidenceRecord(overrides = {}) {
  return authzRecord({
    id: "evidence:asa-label",
    evidence_id: "evidence:asa-label",
    object_type: "evidence",
    assertion_type: "evidence",
    display_label: "Aspirin synonym evidence",
    snippet: "Aspirin has synonym ASA.",
    source_name: "ChEMBL",
    ...overrides
  });
}

function documentRecord(overrides = {}) {
  return authzRecord({
    id: "document:aspirin-monograph",
    document_id: "document:aspirin-monograph",
    object_type: "document",
    assertion_type: "canonical",
    title: "Aspirin product monograph",
    snippet: "Aspirin safety and product information.",
    source_name: "Internal Docs",
    ...overrides
  });
}

function authzRecord(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    environment: "prod",
    release_id: "release-2026-01",
    lifecycle_status: "released",
    permitted_uses: ["search", "export"],
    license_status: "valid",
    ...overrides
  };
}

function aiSuggestionRecord(overrides = {}) {
  return {
    schema_version: "ai-suggestion-candidate.v1",
    candidate_id: "aisug:aspirin-ptgs1",
    suggestion_id: "aisug:aspirin-ptgs1",
    tenant_id: "tenant-a",
    environment: "prod",
    release_id: null,
    suggestion_type: "relationship",
    proposal_type: "relationship",
    assertion_type: "model_suggested",
    lifecycle_status: "proposed",
    review_status: "proposed",
    candidate_payload: {
      subject_id: "pharment:compound/aspirin",
      predicate: "associated_with",
      object_id: "pharment:target/PTGS1",
      relationship_type: "association",
      claim_type: "association"
    },
    payload: {
      assertion_type: "model_suggested",
      evidence_refs: [{ evidence_id: "pharmev:faers-ptgs1" }],
      source_spans: [{ span_id: "span:ptgs1" }]
    },
    score: 0.74,
    confidence_score: 0.74,
    confidence_band: "medium",
    confidence_source: "model_calibrated_score",
    confidence: {
      score: 0.74,
      band: "medium",
      source: "calibrated_model_score",
      fabricated: false
    },
    model_name: "model:biomed-curation",
    model_version: "2026-06-27",
    prompt_version: "prompt:relationship-v1",
    evidence_refs: [{
      evidence_id: "pharmev:faers-ptgs1",
      evidence_role: "supports",
      source_name: "openFDA FAERS",
      source_version: "2026-Q2",
      source_record_id: "FAERS:123",
      source_span_ids: ["span:ptgs1"],
      disclaimer_ids: ["source_limit:faers_non_causal"],
      source_limitations: ["FAERS/openFDA reports are non-causal safety reports."]
    }],
    source_spans: [{
      span_id: "span:ptgs1",
      source_record_id: "FAERS:123",
      field_path: "reaction.target",
      start_offset: 12,
      end_offset: 17,
      text: "PTGS1",
      evidence_id: "pharmev:faers-ptgs1",
      source_id: "openfda:faers",
      document_id: "document:faers-123"
    }],
    provenance_id: "pharmprov:ai-suggestion/ptgs1",
    governance: {
      auto_publish: false,
      requires_human_review: true,
      release_eligible: false,
      released_graph_target: null,
      visual_state: "ai_suggestion_distinct",
      approval_state: "unapproved",
      duplicate_policy: "not_applicable"
    },
    safety: {
      faers_context: true,
      causality_allowed: false,
      faers_causal_blocked: true
    },
    duplicate_status: "not_duplicate",
    rationale: "AI-generated relationship candidate requires governed human review before use.",
    permitted_uses: ["search"],
    license_status: "valid",
    ...overrides
  };
}

function reasonSummary(hit) {
  return hit.match_reasons.map((reason) => ({
    reason_type: reason.reason_type,
    match_type: reason.match_type,
    field: reason.field,
    matched_field: reason.matched_field,
    matched_value: reason.matched_value,
    query_term: reason.query_term
  }));
}

function deepEqual(left, right) {
  try {
    assert.deepEqual(left, right);
    return true;
  } catch {
    return false;
  }
}
