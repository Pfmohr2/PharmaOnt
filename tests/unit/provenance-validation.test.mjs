import assert from "node:assert/strict";
import provenanceSchema from "../../packages/provenance/schemas/provenance.schema.json" with { type: "json" };
import test from "node:test";

const validProvenance = {
  provenance_id: "pharmprov:phase1/prov-000001",
  object_id: "pharmmap:map-phase1-000001",
  object_type: "mapping_assertion",
  actor: {
    actor_type: "service_account",
    actor_id: "service:normalization",
    actor_role: "normalization_service",
    display_name: null,
    service_account_owner: "user:qa-policy-owner",
    connector_run_id: null,
    model_name: null,
    model_version: null
  },
  activity: {
    activity_type: "normalize",
    activity_id: "activity:normalize-phase1-000001",
    workflow_state_before: "draft",
    workflow_state_after: "proposed",
    rationale: "Phase 1 fixture normalization candidate.",
    policy_id: "policy:phase1-fixture",
    validation_report_id: null
  },
  source: {
    source_name: "ChEMBL",
    source_type: "public_bulk",
    source_version: "34",
    source_version_strategy: "release",
    source_record_id: "CHEMBL25",
    source_record_uri: "https://www.ebi.ac.uk/chembl/compound_report_card/CHEMBL25",
    raw_artifact_uri: "s3://pharmaops-fixtures/chembl/34/CHEMBL25.json",
    record_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    license_classification: "open_with_attribution",
    license_policy_id: "license-policy:chembl-34",
    data_sensitivity: "public",
    disclaimer_ids: ["source_terms:chembl"]
  },
  time: {
    occurred_at: "2026-06-27T01:45:00.000Z",
    ingested_at: "2026-06-27T01:44:00.000Z",
    reviewed_at: null,
    released_at: null
  },
  method: {
    method_type: "connector_transform",
    method_id: "method:chembl-normalizer",
    method_version: "0.1.0",
    rule_id: null,
    prompt_or_policy_version: null,
    input_provenance_ids: []
  },
  confidence: {
    confidence_type: "rule_score",
    confidence_score: 0.99,
    confidence_band: "high",
    corroboration_count: null,
    reviewer_decision: "not_applicable"
  },
  environment: {
    environment: "test",
    tenant_id: "tenant-acme",
    graph_id: "graph:tenant:acme:mappings:working"
  },
  release: {
    release_status: "not_released",
    release_id: null,
    release_candidate_id: null,
    snapshot_hash: null,
    artifact_uri: null,
    rollback_target_release_id: null
  },
  audit_event_ids: ["audit:evt-phase1-1"]
};

test("provenance schema requires the dimensions needed for regulated assertions", () => {
  for (const field of [
    "provenance_id",
    "object_id",
    "object_type",
    "actor",
    "activity",
    "source",
    "time",
    "method",
    "confidence",
    "environment",
    "release",
    "audit_event_ids"
  ]) {
    assert.ok(provenanceSchema.required.includes(field), `missing ${field}`);
  }
});

test("Phase 1 provenance fixture carries source version, actor, method, environment, release, and audit event", () => {
  const errors = validateProvenanceFixture(validProvenance);
  assert.deepEqual(errors, []);
});

test("assertion provenance fixture fails loudly when source version and audit evidence are missing", () => {
  const invalid = structuredClone(validProvenance);
  invalid.source.source_version = null;
  invalid.audit_event_ids = [];

  const errors = validateProvenanceFixture(invalid);
  assert.ok(errors.includes("source.source_version is required for release-blocking provenance coverage."));
  assert.ok(errors.includes("audit_event_ids must include at least one audit event ID."));
});

function validateProvenanceFixture(value) {
  const errors = [];

  for (const field of provenanceSchema.required) {
    if (!(field in value)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (!value.source?.source_version) {
    errors.push("source.source_version is required for release-blocking provenance coverage.");
  }
  if (!value.actor?.actor_id) {
    errors.push("actor.actor_id is required.");
  }
  if (!value.method?.method_type) {
    errors.push("method.method_type is required.");
  }
  if (!value.environment?.tenant_id || !value.environment?.graph_id) {
    errors.push("environment.tenant_id and environment.graph_id are required.");
  }
  if (!value.release?.release_status) {
    errors.push("release.release_status is required.");
  }
  if (!Array.isArray(value.audit_event_ids) || value.audit_event_ids.length === 0) {
    errors.push("audit_event_ids must include at least one audit event ID.");
  }

  return errors;
}
