import assert from "node:assert/strict";
import test from "node:test";

import {
  ExplanationError,
  ExplanationEvidenceService
} from "../../services/explanation/src/index.js";

test("search hit explanation returns match reasons, evidence, provenance, assertion type, and source versions", async () => {
  const service = fixtureService();

  const result = await service.explainSearchHit({
    hit: { hit_id: "hit:aspirin", assertion_id: "assertion:mapping-1", assertion_type: "fabricated-by-caller" },
    tenant_id: "tenant-a",
    environment: "test",
    release_id: "release:2026.0.0"
  });

  assert.equal(result.schema_version, "phase5.explanation.v1");
  assert.equal(result.assertion.assertion_type, "normalized");
  assert.deepEqual(result.why.matched_fields, ["preferred_label", "synonym.normalized", "mapping.source_entity_id"]);
  assert.equal(result.why.matched_synonyms[0].synonym_id, "syn:asa");
  assert.equal(result.why.matched_mappings[0].mapping_id, "mapping:aspirin-exact");
  assert.equal(result.evidence[0].evidence_id, "pharmev:evidence-1");
  assert.equal(result.provenance_chain[0].provenance_id, "pharmprov:assertion-1");
  assert.ok(result.integrity_bindings === undefined);
  assert.ok(result.source_vocabulary_versions.some((entry) =>
    entry.source_name === "ChEMBL" && entry.source_version === "34"
  ));
  assert.equal(result.governance_flags.assertion_type_visible, true);
});

test("evidence viewer returns provenance-bound integrity payload", async () => {
  const service = fixtureService();

  const result = await service.evidenceForAssertion({
    assertion_id: "assertion:mapping-1",
    tenant_id: "tenant-a",
    environment: "test",
    release_id: "release:2026.0.0"
  });

  assert.equal(result.schema_version, "phase5.evidence-viewer.v1");
  assert.equal(result.assertion.assertion_id, "assertion:mapping-1");
  assert.equal(result.assertion.assertion_type, "normalized");
  assert.equal(result.evidence_objects.length, 1);
  assert.equal(result.provenance_chain.length, 2);
  assert.match(result.integrity_bindings.assertion_digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(result.integrity_bindings.audit_event_ids.sort(), ["audit:evidence-1", "audit:normalize-1"]);
});

test("explanation service fails closed on missing assertion type, caller evidence, and cross-tenant evidence", async () => {
  await assert.rejects(
    () => fixtureService({
      assertion: { ...assertionFixture(), assertion_type: undefined }
    }).evidenceForAssertion({ assertion_id: "assertion:mapping-1", tenant_id: "tenant-a", environment: "test" }),
    /assertion_type/
  );

  await assert.rejects(
    () => fixtureService({
      evidence: { ...evidenceFixture(), access_control: { ...evidenceFixture().access_control, tenant_id: "tenant-b" } }
    }).evidenceForAssertion({ assertion_id: "assertion:mapping-1", tenant_id: "tenant-a", environment: "test" }),
    /tenant mismatch/
  );

  await assert.rejects(
    () => fixtureService({
      matchReasons: []
    }).explainSearchHit({ hit: { assertion_id: "assertion:mapping-1" }, tenant_id: "tenant-a", environment: "test" }),
    /match reasons/
  );
});

test("explanation service blocks fabricated confidence and FAERS causal claims", async () => {
  await assert.rejects(
    () => fixtureService({
      assertion: { ...assertionFixture(), confidence_source: "fabricated" }
    }).evidenceForAssertion({ assertion_id: "assertion:mapping-1", tenant_id: "tenant-a", environment: "test" }),
    /fabricated confidence/
  );

  await assert.rejects(
    () => fixtureService({
      assertion: {
        ...assertionFixture(),
        assertion_id: "assertion:faers-causal",
        relationship_id: "relationship:faers-causal",
        assertion_type: "asserted",
        predicate: "causes",
        claim_type: "causal",
        evidence_ids: ["pharmev:faers-1"],
        evidence_refs: [{ evidence_id: "pharmev:faers-1", evidence_role: "supports" }]
      },
      evidence: {
        ...evidenceFixture(),
        evidence_id: "pharmev:faers-1",
        source_name: "openFDA FAERS",
        disclaimer_ids: ["faers-non-causal-limitations"],
        source_limitations: ["FAERS reports are non-causal"]
      }
    }).evidenceForAssertion({ assertion_id: "assertion:faers-causal", tenant_id: "tenant-a", environment: "test" }),
    /FAERS/
  );
});

function fixtureService(overrides = {}) {
  const assertion = overrides.assertion ?? assertionFixture();
  const evidence = overrides.evidence ?? evidenceFixture();
  const assertionProvenance = overrides.assertionProvenance ?? provenanceFixture();
  const evidenceProvenance = overrides.evidenceProvenance ?? provenanceFixture({
    provenance_id: "pharmprov:evidence-1",
    object_id: evidence.evidence_id,
    object_type: "evidence_object",
    audit_event_ids: ["audit:evidence-1"]
  });
  const matchReasons = overrides.matchReasons ?? [
    { match_type: "field", matched_field: "preferred_label", matched_value: "Aspirin", query_term: "aspirin", score_contribution: 0.6 },
    { match_type: "synonym", matched_field: "synonym.normalized", matched_value: "ASA", query_term: "asa", synonym_id: "syn:asa", score_contribution: 0.25 },
    { match_type: "mapping", matched_field: "mapping.source_entity_id", matched_value: "chembl:CHEMBL25", query_term: "CHEMBL25", mapping_id: "mapping:aspirin-exact", score_contribution: 0.15 }
  ];
  return new ExplanationEvidenceService({
    clock: () => new Date("2026-06-27T06:00:00.000Z"),
    async resolveAssertion({ assertion_id }) {
      return assertion_id === (assertion.assertion_id ?? assertion.mapping_id ?? assertion.relationship_id) ? assertion : null;
    },
    async resolveEvidence({ evidence_id }) {
      return evidence_id === evidence.evidence_id ? evidence : null;
    },
    async resolveProvenance({ provenance_id }) {
      return [assertionProvenance, evidenceProvenance].find((item) => item.provenance_id === provenance_id) ?? null;
    },
    async resolveMatchReasons() {
      return matchReasons;
    }
  });
}

function assertionFixture(overrides = {}) {
  return {
    assertion_id: "assertion:mapping-1",
    object_type: "mapping",
    assertion_type: "normalized",
    tenant_id: "tenant-a",
    environment: "test",
    release_id: "release:2026.0.0",
    subject_id: "chembl:CHEMBL25",
    object_id: "pharm:compound/aspirin",
    predicate: "skos:exactMatch",
    source_vocabulary: "ChEMBL",
    source_vocabulary_version: "34",
    target_vocabulary: "PharmaOps",
    target_vocabulary_version: "2026-06-27",
    confidence_score: 0.97,
    confidence_band: "high",
    confidence_source: "deterministic_match",
    lifecycle_status: "released",
    evidence_ids: ["pharmev:evidence-1"],
    evidence_refs: [{ evidence_id: "pharmev:evidence-1", evidence_role: "supports" }],
    provenance_id: "pharmprov:assertion-1",
    ...overrides
  };
}

function evidenceFixture(overrides = {}) {
  return {
    evidence_id: "pharmev:evidence-1",
    evidence_type: "source_record",
    evidence_role: "supports",
    document_id: "doc:chembl-25",
    source_record_id: "CHEMBL25",
    source_record_uri: "https://example.test/chembl/CHEMBL25",
    source_name: "ChEMBL",
    source_version: "34",
    source_retrieved_at: "2026-06-27T00:00:00.000Z",
    raw_artifact_uri: "s3://tenant-a/chembl/CHEMBL25.json",
    record_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    snippet: "Aspirin source record.",
    text_spans: [],
    disclaimer_ids: ["source_terms:chembl"],
    source_limitations: [],
    license_classification: "open_with_attribution",
    materialization_policy: "materialize",
    access_control: {
      tenant_id: "tenant-a",
      visibility: "tenant",
      export_allowed: true
    },
    provenance_id: "pharmprov:evidence-1",
    release_id: "release:2026.0.0",
    ...overrides
  };
}

function provenanceFixture(overrides = {}) {
  return {
    provenance_id: "pharmprov:assertion-1",
    object_id: "assertion:mapping-1",
    object_type: "mapping_assertion",
    actor: { actor_type: "service_account", actor_id: "service:normalization" },
    activity: { activity_type: "normalize", activity_id: "norm:1" },
    source: { source_name: "ChEMBL", source_version: "34", source_version_strategy: "version" },
    time: { occurred_at: "2026-06-27T00:00:00.000Z" },
    method: { method_type: "rule", method_id: "identifier-exact", method_version: "1" },
    confidence: { confidence_type: "rule_score", confidence_score: 0.97, confidence_band: "high" },
    environment: { tenant_id: "tenant-a", environment: "test" },
    release: { release_status: "released", release_id: "release:2026.0.0" },
    audit_event_ids: ["audit:normalize-1"],
    ...overrides
  };
}
