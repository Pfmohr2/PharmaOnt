import assert from "node:assert/strict";
import test from "node:test";

import {
  mappingObjectRequiredFields,
  mappingPredicates,
  validateMappingObjectShape
} from "../../packages/contracts/src/index.js";

const validMapping = {
  mapping_id: "pharmmap:map-phase1-000001",
  source_entity_id: "chembl:CHEMBL25",
  target_entity_id: "pharment:compound-chembl25",
  predicate: "exactMatch",
  source_vocabulary: "ChEMBL",
  source_vocabulary_version: "34",
  target_vocabulary: "PharmaOps internal",
  target_vocabulary_version: "2026.0",
  source_license_classification: "open_with_attribution",
  source_license_policy_id: "license-policy:chembl-34",
  target_license_classification: "open_materializable",
  target_license_policy_id: "license-policy:pharmaops-internal-2026",
  data_sensitivity: "public",
  materialization_policy: "materialize",
  permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
  export_restrictions: ["attribution_required"],
  disclaimer_ids: ["source_terms:chembl"],
  legal_approval_id: null,
  retention_class: "public_source_snapshot",
  license_status: "valid",
  confidence_score: 0.99,
  confidence_band: "high",
  evidence_ids: ["pharmev:evidence-2026-000001"],
  evidence_refs: [
    {
      evidence_id: "pharmev:evidence-2026-000001",
      evidence_role: "source_record",
      source_name: "ChEMBL",
      source_version: "34",
      artifact_uri: "s3://pharmaops-fixtures/chembl/34/CHEMBL25.json",
      record_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      access_policy_id: "access-policy:public-fixture"
    }
  ],
  provenance_id: "pharmprov:mapping/phase1-000001",
  created_by: "service:normalization",
  reviewed_by: "user:curator-1",
  review_status: "approved",
  release_id: null,
  provenance: {
    actor: "service:normalization",
    timestamp: "2026-06-27T01:40:00.000Z",
    source: "ChEMBL",
    source_version: "34",
    audit_event_id: "audit:evt-phase1-1"
  }
};

test("mapping object validator accepts complete Phase 1 mapping fixture", () => {
  assert.deepEqual(validateMappingObjectShape(validMapping), { valid: true, errors: [] });
});

test("mapping object contract requires source and target vocabulary versions", () => {
  assert.ok(mappingObjectRequiredFields.includes("source_vocabulary_version"));
  assert.ok(mappingObjectRequiredFields.includes("target_vocabulary_version"));

  const invalid = { ...validMapping };
  delete invalid.source_vocabulary_version;
  delete invalid.target_vocabulary_version;

  const result = validateMappingObjectShape(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Missing required field: source_vocabulary_version"));
  assert.ok(result.errors.includes("Missing required field: target_vocabulary_version"));
});

test("mapping predicates are locked to the vocabulary policy set", () => {
  assert.deepEqual(mappingPredicates, [
    "exactMatch",
    "closeMatch",
    "broadMatch",
    "narrowMatch",
    "relatedMatch",
    "replacedBy",
    "hasDbXref",
    "notMatch",
    "uncertainMatch",
    "requiresReview"
  ]);

  const invalid = { ...validMapping, predicate: "sameAs" };
  const result = validateMappingObjectShape(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Invalid predicate: sameAs"));
});
