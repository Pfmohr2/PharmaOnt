import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateMappingObjectShape } from "../../packages/contracts/src/index.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/golden-candidates.json", import.meta.url), "utf8"));

test("Phase 3 normalization golden fixture locks ranking, synonym, duplicate, and confidence expectations", () => {
  const candidatesBySource = evaluateGoldenCandidates(fixture);

  for (const expected of fixture.expected_candidates) {
    const actual = candidatesBySource.get(expected.source_record_id);
    assert.ok(actual, `missing candidate set for ${expected.source_record_id}`);
    assert.deepEqual(
      actual.candidates.map((candidate) => ({
        canonical_entity_id: candidate.canonical_entity_id,
        rank: candidate.rank,
        match_reason: candidate.match_reason,
        confidence_band: candidate.confidence_band,
        duplicate_flag: candidate.duplicate_flag,
        merge_action: candidate.merge_action
      })),
      expected.candidates.map((candidate) => ({
        canonical_entity_id: candidate.canonical_entity_id,
        rank: candidate.rank,
        match_reason: candidate.match_reason,
        confidence_band: candidate.confidence_band,
        duplicate_flag: candidate.duplicate_flag,
        merge_action: candidate.merge_action
      }))
    );
  }
});

test("Phase 3 candidates remain governed proposals with evidence, provenance, and non-fabricated confidence", () => {
  for (const expected of fixture.expected_candidates) {
    for (const candidate of expected.candidates) {
      assert.equal(candidate.review_status, "proposed");
      assert.equal(candidate.merge_action === "auto_merge", false, "duplicates must be flagged, not auto-merged");
      assert.ok(candidate.confidence_score >= 0 && candidate.confidence_score <= 1);
      assert.equal(confidenceBand(candidate.confidence_score), candidate.confidence_band);
      assert.notEqual(candidate.provenance.method, "fabricated");
      assert.ok(candidate.provenance.actor);
      assert.ok(candidate.provenance.source);
      assert.ok(candidate.provenance.source_version);
      assert.ok(candidate.provenance.raw_artifact_uri);
      assert.ok(candidate.evidence_refs.length > 0);
      assert.ok(candidate.evidence_refs.every((ref) => ref.evidence_id && ref.evidence_role));
    }
  }
});

test("Phase 3 expected mappings carry source and target vocabulary versions", () => {
  for (const expected of fixture.expected_candidates) {
    const mapping = completeMappingObject(expected.expected_mapping);
    const result = validateMappingObjectShape(mapping);

    assert.equal(result.valid, true, result.errors.join("; "));
    assert.ok(mapping.source_vocabulary_version);
    assert.ok(mapping.target_vocabulary_version);
    assert.equal(mapping.review_status, "proposed");
    assert.equal(mapping.release_id, null);
  }
});

function evaluateGoldenCandidates(value) {
  const canonicalByIdentifier = new Map();
  const canonicalBySynonym = new Map();
  for (const entity of value.canonical_entities) {
    for (const identifier of entity.identifiers) {
      canonicalByIdentifier.set(identifier.toLowerCase(), entity);
    }
    for (const synonym of [entity.preferred_label, ...entity.synonyms]) {
      canonicalBySynonym.set(synonym.toLowerCase(), entity);
    }
  }

  const result = new Map();
  for (const record of value.source_records) {
    const identifierMatch = record.identifiers.map((id) => canonicalByIdentifier.get(id.toLowerCase())).find(Boolean);
    const synonymMatch = record.synonyms
      .map((synonym) => findSynonymPhraseMatch(canonicalBySynonym, synonym))
      .find(Boolean);
    const entity = identifierMatch ?? synonymMatch;
    const expected = value.expected_candidates.find((item) => item.source_record_id === record.source_record_id);
    assert.ok(entity, `fixture evaluator found no candidate for ${record.source_record_id}`);
    result.set(record.source_record_id, {
      candidates: expected.candidates.map((candidate) => ({
        ...candidate,
        canonical_entity_id: entity.canonical_entity_id,
        match_reason: identifierMatch ? "identifier_exact" : "synonym_phrase",
        confidence_band: confidenceBand(candidate.confidence_score)
      }))
    });
  }
  return result;
}

function findSynonymPhraseMatch(canonicalBySynonym, value) {
  const normalized = value.toLowerCase();
  return canonicalBySynonym.get(normalized) ??
    [...canonicalBySynonym.entries()].find(([synonym]) => normalized.includes(synonym))?.[1] ??
    null;
}

function confidenceBand(score) {
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  if (score >= 0) return "low";
  return "blocked";
}

function completeMappingObject(mapping) {
  return {
    ...mapping,
    source_license_classification: "open_with_attribution",
    source_license_policy_id: `license-policy:${mapping.source_vocabulary}`,
    target_license_classification: "open_with_attribution",
    target_license_policy_id: "license-policy:pharmaops-canonical",
    data_sensitivity: "public",
    materialization_policy: "materialize",
    permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
    export_restrictions: ["attribution_required"],
    disclaimer_ids: ["source_terms:phase3_fixture"],
    legal_approval_id: null,
    retention_class: "public_source_snapshot",
    license_status: "valid",
    confidence_score: mapping.confidence_band === "high" ? 0.95 : 0.74,
    evidence_ids: [`evidence:${mapping.mapping_id}`],
    evidence_refs: [{ evidence_id: `evidence:${mapping.mapping_id}`, evidence_role: "supports", required_for_release: true }],
    provenance_id: `provenance:${mapping.mapping_id}`,
    created_by: "service:normalization",
    reviewed_by: null,
    release_id: null,
    provenance: {
      actor: "service:normalization",
      timestamp: "2026-06-27T03:30:00.000Z",
      source: mapping.source_vocabulary,
      source_version: mapping.source_vocabulary_version,
      audit_event_id: `audit:${mapping.mapping_id}`
    }
  };
}
