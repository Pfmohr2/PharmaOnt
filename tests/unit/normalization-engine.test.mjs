import assert from "node:assert/strict";
import test from "node:test";

import { validateMappingObjectShape } from "../../packages/contracts/src/index.js";
import canonicalIndex from "../../services/normalization/fixtures/canonical-index.json" with { type: "json" };
import aspirinRecord from "../../services/normalization/fixtures/chembl-aspirin-normalized-record.json" with { type: "json" };
import duplicateIndex from "../../services/normalization/fixtures/duplicate-canonical-index.json" with { type: "json" };
import synonymOnlyRecord from "../../services/normalization/fixtures/synonym-only-record.json" with { type: "json" };
import { NORMALIZATION_STAGES, NormalizationEngine, normalizeSourceRecord } from "../../services/normalization/src/index.js";

test("normalization engine emits reviewable high-confidence ChEMBL mapping candidate with versions, evidence, and provenance", () => {
  const engine = new NormalizationEngine({ canonicalIndex, clock: fixedClock });
  const result = engine.normalize(aspirinRecord);
  const proposal = result.proposals[0];
  const mapping = proposal.mapping_proposals[0];

  assert.equal(result.auto_publish, false);
  assert.equal(proposal.entity_proposal.review_status, "proposed");
  assert.equal(mapping.review_status, "proposed");
  assert.equal(mapping.release_id, null);
  assert.equal(mapping.source_vocabulary, "chembl");
  assert.equal(mapping.source_vocabulary_version, "CHEMBL_34");
  assert.equal(mapping.target_vocabulary_version, "working-2026-06-27");
  assert.equal(mapping.predicate, "exactMatch");
  assert.equal(mapping.confidence_band, "high");
  assert.ok(mapping.confidence_score >= 0.85);
  assert.equal(mapping.scoring_signals.identifier.fired, true);
  assert.equal(mapping.scoring_signals.lexical.fired, true);
  assert.equal(mapping.scoring_signals.model_probability.score, null);
  assert.equal(validateMappingObjectShape(mapping).valid, true);
  assert.deepEqual([...new Set(result.stage_trace.map((entry) => entry.stage))], NORMALIZATION_STAGES);
});

test("normalization engine performs real synonym matching without fabricating identifier confidence", () => {
  const result = normalizeSourceRecord(synonymOnlyRecord, { canonicalIndex, clock: fixedClock });
  const mapping = result.proposals[0].mapping_proposals[0];

  assert.equal(mapping.target_entity_id, "pharment:compound/aspirin");
  assert.equal(mapping.scoring_signals.lexical.fired, true);
  assert.equal(mapping.scoring_signals.identifier.fired, false);
  assert.equal(mapping.scoring_signals.identifier.score, 0);
  assert.equal(mapping.review_status, "proposed");
  assert.ok(["closeMatch", "uncertainMatch"].includes(mapping.predicate));
});

test("normalization engine flags duplicate canonical candidates and does not merge them", () => {
  const result = normalizeSourceRecord(aspirinRecord, { canonicalIndex: duplicateIndex, clock: fixedClock });
  const proposal = result.proposals[0];

  assert.equal(proposal.mapping_proposals.length, 2);
  assert.equal(proposal.duplicate_candidate_flags.length, 1);
  assert.equal(proposal.duplicate_candidate_flags[0].action, "flag_only_do_not_merge");
  assert.equal(proposal.review_route, "duplicate_resolution_review");
  assert.deepEqual(
    proposal.mapping_proposals.map((mapping) => mapping.target_entity_id),
    ["pharment:compound/aspirin-a", "pharment:compound/aspirin-b"]
  );
});

test("normalization engine fails closed when connector record lacks source_version", () => {
  const badRecord = structuredClone(aspirinRecord);
  delete badRecord.source_version;

  assert.throws(
    () => normalizeSourceRecord(badRecord, { canonicalIndex, clock: fixedClock }),
    /source_version/
  );
});

test("normalization engine creates low-confidence new entity proposals for unresolved records", () => {
  const unresolved = {
    ...aspirinRecord,
    source_record_id: "CHEMBL-UNKNOWN",
    normalized_record: {
      source_id: "CHEMBL-UNKNOWN",
      label: "Unindexed fixture compound",
      entity_class: "compound",
      identifiers: ["chembl.compound:CHEMBL-UNKNOWN"],
      synonyms: [],
      source_version: "CHEMBL_34"
    }
  };
  const result = normalizeSourceRecord(unresolved, { canonicalIndex, clock: fixedClock });
  const proposal = result.proposals[0].entity_proposal;
  const mapping = result.proposals[0].mapping_proposals[0];

  assert.equal(proposal.proposal_type, "new_canonical_entity_candidate");
  assert.equal(proposal.review_status, "proposed");
  assert.equal(mapping.predicate, "requiresReview");
  assert.equal(mapping.confidence_band, "low");
  assert.equal(mapping.scoring_signals.model_probability.score, null);
});

function fixedClock() {
  return new Date("2026-06-27T03:30:00.000Z");
}
