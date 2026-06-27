import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AiCurationEngine,
  SUGGESTION_SCHEMA_VERSION,
  assertSuggestionCandidate,
  suggestionCandidateSchema,
  validateSuggestionCandidate
} from "../../services/ai-curation/src/index.js";

const fixedClock = () => new Date("2026-06-27T12:00:00.000Z");

test("AI curation emits schema-valid candidates for all five suggestion types", () => {
  const engine = testEngine();
  const candidates = [
    ...engine.extractDocumentEntities({
      tenant_id: "tenant-a",
      document: sourceDocument(),
      entities: [{
        text: "Aspirin",
        entity_class: "compound",
        start_offset: 10,
        end_offset: 17,
        score: 0.91,
        evidence_refs: [evidenceRef()]
      }]
    }),
    ...engine.suggestEntityLinks({
      tenant_id: "tenant-a",
      mention: mention(),
      candidates: [{
        canonical_id: "pharment:compound/aspirin",
        label: "Aspirin",
        score: 0.88,
        match_features: ["exact_label"],
        evidence_refs: [evidenceRef()]
      }]
    }),
    ...engine.suggestSynonyms({
      tenant_id: "tenant-a",
      entity: { ...sourceDocument(), entity_id: "pharment:compound/aspirin", label: "Aspirin", text: "acetylsalicylic acid", start_offset: 24, end_offset: 44 },
      synonyms: [{
        text: "acetylsalicylic acid",
        score: 0.83,
        evidence_refs: [evidenceRef()]
      }]
    }),
    ...engine.suggestRelationships({
      tenant_id: "tenant-a",
      relationships: [{
        ...sourceDocument(),
        subject_id: "pharment:compound/aspirin",
        predicate: "targets",
        object_id: "pharment:target/PTGS1",
        claim_type: "association",
        text: "Aspirin inhibits PTGS1.",
        start_offset: 50,
        end_offset: 72,
        score: 0.79,
        evidence_refs: [evidenceRef()]
      }]
    }),
    ...engine.suggestDuplicates({
      tenant_id: "tenant-a",
      duplicate_pairs: [{
        ...sourceDocument(),
        entity_id: "pharment:compound/aspirin",
        duplicate_entity_id: "pharment:compound/acetylsalicylic-acid",
        text: "Aspirin and acetylsalicylic acid labels match.",
        start_offset: 80,
        end_offset: 126,
        score: 0.86,
        evidence_refs: [evidenceRef()]
      }]
    })
  ];

  assert.deepEqual(candidates.map((candidate) => candidate.suggestion_type), [
    "document_entity_extraction",
    "entity_linking",
    "synonym",
    "relationship",
    "duplicate"
  ]);

  for (const candidate of candidates) {
    assertSuggestionCandidate(candidate);
    const result = validateSuggestionCandidate(candidate);
    assert.equal(result.valid, true, result.errors.join("; "));
    assert.equal(candidate.schema_version, SUGGESTION_SCHEMA_VERSION);
    assert.equal(candidate.suggestion_id, candidate.candidate_id);
    assert.equal(candidate.assertion_type, "model_suggested");
    assert.ok(["mapping", "synonym", "relationship", "evidence-link"].includes(candidate.proposal_type));
    assert.equal(candidate.payload.assertion_type, "model_suggested");
    assert.equal(candidate.model.model_id, "p6-curation-baseline");
    assert.equal(candidate.model.model_version, "2026-06-27");
    assert.equal(candidate.model.prompt_version, "p6-ai-curation-v1");
    assert.equal(candidate.model_name, candidate.model.model_id);
    assert.equal(candidate.model_version, candidate.model.model_version);
    assert.equal(candidate.prompt_version, candidate.model.prompt_version);
    assert.equal(candidate.confidence_score, candidate.score);
    assert.equal(candidate.confidence_source, "model_calibrated_score");
    assert.equal(candidate.confidence.source, "calibrated_model_score");
    assert.equal(candidate.confidence.fabricated, false);
    assert.equal(candidate.confidence.calibration.calibration_id, "cal:p6-curation-baseline");
    assert.ok(candidate.evidence_refs.length > 0);
    assert.ok(candidate.source_spans.length > 0);
    assert.equal(candidate.source_spans[0].evidence_id, candidate.evidence_refs[0].evidence_id);
    assert.ok(candidate.rationale.includes("human review"));
    assert.equal(candidate.governance.auto_publish, false);
    assert.equal(candidate.governance.requires_human_review, true);
    assert.equal(candidate.governance.release_eligible, false);
    assert.equal(candidate.release_id, null);
  }
});

test("duplicate suggestions are flag-only and never merge", () => {
  const [candidate] = testEngine().suggestDuplicates({
    tenant_id: "tenant-a",
    duplicate_pairs: [{
      ...sourceDocument(),
      entity_id: "pharment:compound/a",
      duplicate_entity_id: "pharment:compound/b",
      text: "A and B are the same label.",
      score: 0.74,
      evidence_refs: [evidenceRef()]
    }]
  });

  assert.equal(candidate.suggestion_type, "duplicate");
  assert.equal(candidate.governance.duplicate_policy, "flag_only_never_merge");
  assert.equal(candidate.candidate_payload.duplicate_action, "flag_only");
  assert.equal(candidate.duplicate_status, "possible_duplicate");
  assert.equal(candidate.candidate_payload.merge_allowed, false);
});

test("AI curation fails closed on missing score, evidence, spans, model, or calibration", () => {
  assert.throws(() => new AiCurationEngine({ calibration: calibration(), clock: fixedClock }), /model metadata/);
  assert.throws(() => new AiCurationEngine({ model: model(), clock: fixedClock }), /calibration metadata/);
  assert.throws(() => testEngine().suggestEntityLinks({
    tenant_id: "tenant-a",
    mention: mention(),
    candidates: [{
      canonical_id: "pharment:compound/aspirin",
      label: "Aspirin",
      evidence_refs: [evidenceRef()]
    }]
  }), /score/);
  assert.throws(() => testEngine().suggestEntityLinks({
    tenant_id: "tenant-a",
    mention: { ...mention(), evidence_refs: [] },
    candidates: [{
      canonical_id: "pharment:compound/aspirin",
      label: "Aspirin",
      score: 0.8
    }]
  }), /evidence_refs/);
  assert.throws(() => testEngine().suggestEntityLinks({
    tenant_id: "tenant-a",
    mention: { ...mention(), text: "" },
    candidates: [{
      canonical_id: "pharment:compound/aspirin",
      label: "Aspirin",
      score: 0.8,
      evidence_refs: [evidenceRef()]
    }]
  }), /source span text/);
});

test("validator rejects fabricated confidence and release membership", () => {
  const [candidate] = testEngine().extractDocumentEntities({
    tenant_id: "tenant-a",
    document: sourceDocument(),
    entities: [{
      text: "Aspirin",
      entity_class: "compound",
      score: 0.9,
      evidence_refs: [evidenceRef()]
    }]
  });
  const invalid = {
    ...candidate,
    release_id: "release-2026-01",
    confidence: {
      ...candidate.confidence,
      source: "fabricated",
      fabricated: true
    }
  };

  const result = validateSuggestionCandidate(invalid);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("release_id")));
  assert.ok(result.errors.some((error) => error.includes("confidence.source")));
  assert.ok(result.errors.some((error) => error.includes("confidence.fabricated")));
});

test("strict validator rejects nested masquerade payloads and malformed nested evidence", () => {
  const [candidate] = testEngine().suggestRelationships({
    tenant_id: "tenant-a",
    relationships: [{
      ...sourceDocument(),
      subject_id: "pharment:compound/aspirin",
      predicate: "reported_with",
      object_id: "event:headache",
      claim_type: "association",
      text: "Aspirin was reported with headache.",
      score: 0.72,
      evidence_refs: [evidenceRef()]
    }]
  });
  const invalid = {
    ...candidate,
    model_name: "masquerade-model",
    confidence: {
      ...candidate.confidence,
      calibration: null
    },
    payload: {
      ...candidate.payload,
      assertion_type: "approved",
      lifecycle_status: "released",
      release_id: "release-2026-01",
      evidence_refs: [{}],
      source_spans: [{ text: "fake span" }]
    },
    provenance: {
      ...candidate.provenance,
      evidence_refs: [{}],
      source_spans: [{}]
    }
  };

  const result = validateSuggestionCandidate(invalid);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("payload.assertion_type")));
  assert.ok(result.errors.some((error) => error.includes("payload.lifecycle_status")));
  assert.ok(result.errors.some((error) => error.includes("payload.release_id")));
  assert.ok(result.errors.some((error) => error.includes("payload.evidence_refs[0].evidence_id")));
  assert.ok(result.errors.some((error) => error.includes("payload.source_spans[0].span_id")));
  assert.ok(result.errors.some((error) => error.includes("provenance.evidence_refs[0].evidence_id")));
  assert.ok(result.errors.some((error) => error.includes("provenance.source_spans[0].span_id")));
  assert.ok(result.errors.some((error) => error.includes("confidence.calibration")));
  assert.ok(result.errors.some((error) => error.includes("model_name")));
});

test("FAERS/openFDA relationship suggestions cannot be causal and carry non-causal limits", () => {
  assert.throws(() => testEngine().suggestRelationships({
    tenant_id: "tenant-a",
    relationships: [{
      source_name: "openFDA FAERS",
      source_version: "2026Q1",
      source_record_id: "faers:case-1",
      subject_id: "drug:aspirin",
      predicate: "causes",
      object_id: "event:bleeding",
      claim_type: "causal",
      text: "Report mentions aspirin and bleeding.",
      score: 0.7,
      evidence_refs: [faersEvidenceRef()]
    }]
  }), /FAERS/);

  const [candidate] = testEngine().suggestRelationships({
    tenant_id: "tenant-a",
    relationships: [{
      source_name: "openFDA FAERS",
      source_version: "2026Q1",
      source_record_id: "faers:case-2",
      subject_id: "drug:aspirin",
      predicate: "reported_with",
      object_id: "event:bleeding",
      claim_type: "association",
      text: "Report mentions aspirin and bleeding.",
      score: 0.7,
      evidence_refs: [faersEvidenceRef()]
    }]
  });

  assert.equal(candidate.safety.faers_context, true);
  assert.equal(candidate.safety.causality_allowed, false);
  assert.equal(candidate.safety.faers_causal_blocked, true);
  assert.ok(candidate.evidence_refs[0].disclaimer_ids.includes("source_limit:faers_non_causal"));
  assert.ok(candidate.evidence_refs[0].source_limitations.some((value) => value.includes("non-causal")));
});

test("published suggestion schema is parseable and names the candidate version", () => {
  const schema = JSON.parse(readFileSync("services/ai-curation/schemas/suggestion-candidate.schema.json", "utf8"));

  assert.equal(schema.properties.schema_version.const, SUGGESTION_SCHEMA_VERSION);
  assert.equal(suggestionCandidateSchema.properties.assertion_type.const, "model_suggested");
  assert.ok(schema.properties.suggestion_type.enum.includes("duplicate"));
});

function testEngine() {
  return new AiCurationEngine({
    model: model(),
    calibration: calibration(),
    clock: fixedClock
  });
}

function model() {
  return {
    model_id: "p6-curation-baseline",
    model_version: "2026-06-27",
    prompt_version: "p6-ai-curation-v1",
    prompt_id: "prompt:p6-ai-curation",
    provider: "internal"
  };
}

function calibration() {
  return {
    calibration_id: "cal:p6-curation-baseline",
    calibration_version: "2026-06-27",
    calibration_method: "heldout-review-set",
    sample_size: 120,
    expected_accuracy: 0.82,
    observed_accuracy: 0.79,
    confidence_interval: [0.73, 0.87],
    metrics_source: "phase6-calibration-report"
  };
}

function sourceDocument() {
  return {
    document_id: "doc:ctgov:NCT00000001",
    source_name: "ClinicalTrials.gov",
    source_version: "2026-06-01",
    source_record_id: "NCT00000001",
    source_record_uri: "https://clinicaltrials.gov/study/NCT00000001"
  };
}

function mention() {
  return {
    ...sourceDocument(),
    mention_id: "mention:aspirin",
    text: "Aspirin",
    entity_class: "compound",
    start_offset: 10,
    end_offset: 17,
    evidence_refs: [evidenceRef()]
  };
}

function evidenceRef() {
  return {
    evidence_id: "pharmev:ctgov-aspirin",
    evidence_role: "supports",
    source_name: "ClinicalTrials.gov",
    source_version: "2026-06-01",
    source_record_id: "NCT00000001",
    source_span_ids: ["span:source"]
  };
}

function faersEvidenceRef() {
  return {
    evidence_id: "pharmev:faers-case",
    evidence_role: "supports",
    source_name: "openFDA FAERS",
    source_version: "2026Q1",
    source_record_id: "faers:case",
    source_span_ids: ["span:faers"]
  };
}
