import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  licenseClassifications,
  mappingObjectRequiredFields,
  mappingObjectSchemaContract,
  mappingPredicates,
  relationshipAssertionSchemaContract,
  relationshipAssertionSchemaSource,
  relationshipAssertionValidator,
  validateRelationshipAssertionContract,
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

test("relationship assertion validator is compiled from the canonical docs schema", () => {
  const docsSchema = JSON.parse(readFileSync(relationshipAssertionSchemaSource, "utf8"));
  assert.deepEqual(relationshipAssertionSchemaContract, docsSchema);
  assert.equal(relationshipAssertionSchemaContract.$id, "https://pharmaops.example/schemas/semantic-bridge/relationship-assertion.schema.json");
  assert.equal(typeof relationshipAssertionValidator, "function");
});

test("relationship assertion schema follows Phase B required fields", () => {
  for (const field of ["relationship_assertion_id", "source_entity_id", "target_entity_id", "predicate", "relationship_class", "assertion_type", "confidence", "review_status", "release_context", "data_license", "evidence_refs", "provenance_id", "provenance"]) {
    assert.ok(relationshipAssertionSchemaContract.required.includes(field), `missing ${field}`);
  }
});

test("relationship assertion Ajv validator accepts a valid approved assertion", () => {
  assert.deepEqual(validateRelationshipAssertionContract(validRelationshipAssertion()), { valid: true, errors: [] });
});

test("relationship assertion Ajv validator rejects required field, enum, evidence, and provenance failures", () => {
  const missingRequired = validRelationshipAssertion();
  delete missingRequired.source_entity_id;
  assertValidationFails(missingRequired, "source_entity_id");

  const invalidEnum = validRelationshipAssertion({ relationship_class: "domain_related" });
  assertValidationFails(invalidEnum, "/relationship_class");

  const missingEvidence = validRelationshipAssertion({ evidence_refs: [] });
  assertValidationFails(missingEvidence, "/evidence_refs");

  const missingProvenanceAudit = validRelationshipAssertion();
  delete missingProvenanceAudit.provenance.audit_event_id;
  assertValidationFails(missingProvenanceAudit, "audit_event_id");
});

test("relationship assertion Ajv validator enforces class predicate matrix and safety causal status", () => {
  assertValidationFails(
    validRelationshipAssertion({
      relationship_class: "evidence_support",
      predicate: "pharmrel:exactMatch"
    }),
    "/predicate"
  );

  const safetyWithoutCausalStatus = validRelationshipAssertion({
    relationship_class: "safety",
    predicate: "product_has_adverse_event"
  });
  assertValidationFails(safetyWithoutCausalStatus, "causal_claim_status");

  const safetyWithCausalStatus = validRelationshipAssertion({
    relationship_class: "safety",
    predicate: "product_has_adverse_event",
    causal_claim_status: "not_causal"
  });
  assert.equal(validateRelationshipAssertionContract(safetyWithCausalStatus).valid, true);
});

test("relationship assertion Ajv validator blocks unsafe released state", () => {
  assertValidationFails(
    releasedRelationshipAssertion({ assertion_type: "model_suggested" }),
    "/assertion_type"
  );

  assertValidationFails(
    releasedRelationshipAssertion({ reviewed_by: null }),
    "/reviewed_by"
  );

  assertValidationFails(
    releasedRelationshipAssertion({
      data_license: {
        ...validRelationshipAssertion().data_license,
        license_status: "blocked"
      }
    }),
    "/data_license/license_status"
  );

  assertValidationFails(
    releasedRelationshipAssertion({ validation_report_ids: undefined }),
    "validation_report_ids"
  );
});

test("relationship assertion Ajv validator requires blocked rationale", () => {
  const blocked = validRelationshipAssertion({
    relationship_class: "blocked",
    predicate: "unsupported",
    confidence: {
      ...validRelationshipAssertion().confidence,
      confidence_band: "blocked"
    },
    blocked_rationale: undefined
  });
  assertValidationFails(blocked, "blocked_rationale");
});

function assertValidationFails(value, expectedErrorText) {
  const result = validateRelationshipAssertionContract(value);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes(expectedErrorText)),
    `expected ${JSON.stringify(result.errors)} to include ${expectedErrorText}`
  );
}

function validRelationshipAssertion(overrides = {}) {
  const base = {
    schema_version: "semantic-bridge.relationship-assertion.v1",
    relationship_assertion_id: "ra:test:1",
    tenant_id: "tenant-a",
    environment: "test",
    source_entity_id: "pharment:compound/aspirin",
    target_entity_id: "pharment:target/PTGS1",
    predicate: "compound_has_target",
    relationship_class: "mechanistic",
    assertion_type: "human_curated",
    directionality: "directed",
    polarity: "positive",
    evidence_refs: [
      {
        evidence_id: "pharmev:test:1",
        evidence_role: "supports",
        source_name: "ChEMBL",
        source_version: "34",
        source_record_id: "chembl:CHEMBL25",
        source_span_ids: ["span:1"],
        evidence_type: "source_record",
        required_for_release: true
      }
    ],
    source_record_ids: ["chembl:CHEMBL25"],
    source_names: ["ChEMBL"],
    source_versions: ["34"],
    confidence: {
      confidence_score: 0.91,
      confidence_band: "high",
      confidence_source: "reviewer_decision",
      calibration_id: null,
      fabricated: false,
      confidence_rationale: "Curated source evidence."
    },
    review_status: "approved",
    reviewed_by: "user:reviewer-1",
    reviewed_at: "2026-06-27T12:00:00.000Z",
    release_context: {
      release_id: null,
      scope: "working",
      included_in_release: false,
      release_candidate_id: null
    },
    data_license: {
      license_status: "valid",
      license_classification: "open_with_attribution",
      license_policy_id: "license-policy:chembl-34",
      permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "release"],
      export_restrictions: ["attribution_required"],
      data_sensitivity: "public"
    },
    known_limitations: [],
    warnings: [],
    blocked_rationale: null,
    validation_report_ids: [],
    created_by: "user:curator-1",
    created_at: "2026-06-27T12:00:00.000Z",
    updated_at: "2026-06-27T12:00:00.000Z",
    provenance_id: "pharmprov:relationship/test/1",
    provenance: {
      actor: "user:curator-1",
      activity: "relationship_assertion_created",
      method: "manual_curation",
      source: {
        source_name: "ChEMBL",
        source_version: "34"
      },
      time: "2026-06-27T12:00:00.000Z",
      audit_event_id: "audit:relationship:test:1"
    }
  };

  return dropUndefined(deepMerge(base, overrides));
}

function releasedRelationshipAssertion(overrides = {}) {
  return validRelationshipAssertion(deepMerge({
    review_status: "released",
    release_context: {
      release_id: "release:semantic-bridge:test",
      scope: "release",
      included_in_release: true,
      release_candidate_id: "release-candidate:test"
    },
    validation_report_ids: ["validation:relationship:test:1"]
  }, overrides));
}

function deepMerge(base, overrides) {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === "object" && !Array.isArray(value) && merged[key] && typeof merged[key] === "object" && !Array.isArray(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function dropUndefined(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    } else {
      dropUndefined(value[key]);
    }
  }
  return value;
}
