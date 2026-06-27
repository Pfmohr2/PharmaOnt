import assert from "node:assert/strict";
import test from "node:test";

import {
  licenseClassifications,
  mappingObjectRequiredFields,
  mappingObjectSchemaContract,
  mappingPredicates,
  relationshipAssertionSchemaContract,
  validateMappingObjectShape
} from "../src/index.js";

const validMapping = {
  mapping_id: "pharmmap:map-2026-000001",
  source_entity_id: "chembl:CHEMBL25",
  target_entity_id: "pubchem:CID2244",
  predicate: "exactMatch",
  source_vocabulary: "ChEMBL",
  source_vocabulary_version: "34",
  target_vocabulary: "PubChem",
  target_vocabulary_version: "2026-06-01",
  source_license_classification: "open_with_attribution",
  source_license_policy_id: "license-policy:chembl-34",
  target_license_classification: "open_with_attribution",
  target_license_policy_id: "license-policy:pubchem-2026-06-01",
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
      evidence_role: "supports",
      required_for_release: true
    }
  ],
  provenance_id: "pharmprov:mapping/000001",
  created_by: "service:normalization",
  reviewed_by: "user:curator-1",
  review_status: "approved",
  release_id: null,
  provenance: {
    actor: "service:normalization",
    timestamp: "2026-06-27T01:20:00.000Z",
    source: "ChEMBL",
    source_version: "34",
    audit_event_id: "audit:evt-1"
  }
};

test("mapping schema carries required predicates from vocabulary policy", () => {
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
  assert.deepEqual(mappingObjectSchemaContract.properties.predicate.enum, mappingPredicates);
});

test("mapping schema requires source and target vocabulary versions", () => {
  assert.ok(mappingObjectRequiredFields.includes("source_vocabulary_version"));
  assert.ok(mappingObjectRequiredFields.includes("target_vocabulary_version"));
});

test("mapping schema requires VP-RT-001 license governance fields", () => {
  for (const field of [
    "source_license_classification",
    "source_license_policy_id",
    "target_license_classification",
    "target_license_policy_id",
    "data_sensitivity",
    "materialization_policy",
    "permitted_uses",
    "export_restrictions",
    "disclaimer_ids",
    "legal_approval_id",
    "retention_class",
    "license_status"
  ]) {
    assert.ok(mappingObjectRequiredFields.includes(field), `missing ${field}`);
  }
});

test("mapping schema aligns to shared provenance and evidence pointer fields", () => {
  for (const field of ["provenance_id", "evidence_refs", "evidence_ids"]) {
    assert.ok(mappingObjectRequiredFields.includes(field), `missing ${field}`);
  }
  assert.equal(mappingObjectSchemaContract.properties.evidence_refs.items.$ref, "#/$defs/evidenceRef");
});

test("license classification enum matches Data License Register classifications", () => {
  assert.deepEqual(licenseClassifications, [
    "open_materializable",
    "open_with_attribution",
    "licensed_federated",
    "licensed_materializable_with_restrictions",
    "internal_confidential",
    "contains_phi_or_pii",
    "blocked_pending_legal_review"
  ]);
});

test("minimal runtime shape validator accepts valid mapping and rejects release blockers", () => {
  assert.deepEqual(validateMappingObjectShape(validMapping), { valid: true, errors: [] });

  const invalid = { ...validMapping };
  delete invalid.target_vocabulary_version;
  invalid.predicate = "sameAs";
  invalid.license_status = "blocked";
  invalid.review_status = "released";

  const result = validateMappingObjectShape(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Missing required field: target_vocabulary_version"));
  assert.ok(result.errors.includes("Invalid predicate: sameAs"));
  assert.ok(result.errors.includes("Released mappings cannot have blocked or pending_review license_status."));
});

test("relationship assertion schema stub follows domain model required fields", () => {
  for (const field of ["relationship_id", "subject", "predicate", "object", "assertion_type", "confidence_score", "provenance_id", "evidence_refs", "provenance", "lifecycle_status", "release_id"]) {
    assert.ok(relationshipAssertionSchemaContract.required.includes(field), `missing ${field}`);
  }
});
