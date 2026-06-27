import assert from "node:assert/strict";
import test from "node:test";

import {
  FAERS_NON_CAUSAL_DISCLAIMER_ID,
  PolicyViolation,
  assertIngestionPolicy,
  evaluateLicensePolicy
} from "../src/index.js";

test("federated licensed source is blocked from materialization", () => {
  assert.throws(
    () => assertIngestionPolicy({
      source: "MedDRA",
      record: { source_record_id: "llt:10000001" },
      requestedUses: ["ingest", "persist_raw", "materialize", "normalize"]
    }),
    (error) => error instanceof PolicyViolation &&
      error.details.blocks.includes("federated or pointer-only source cannot be materialized")
  );
});

test("PII record is flagged and blocked from AI use by default", () => {
  const result = evaluateLicensePolicy({
    source: "ClinicalTrials.gov",
    record: {
      source_record_id: "NCT-PII-FIXTURE",
      contains_phi_or_pii: true
    },
    requestedUses: ["ingest", "normalize", "ai"]
  });

  assert.equal(result.sensitivity_classification, "phi_pii");
  assert.equal(result.decisions.contains_phi_or_pii, true);
  assert.equal(result.decisions.ai_eligible, false);
  assert.ok(result.blocks.includes("source is not eligible for requested AI processing"));
});

test("approved restricted licensed source passes with downstream flags", () => {
  const result = assertIngestionPolicy({
    source: {
      source_name: "Tenant licensed vocabulary",
      license_classification: "licensed_materializable_with_restrictions",
      materialization_policy: "materialize",
      sensitivity_classification: "licensed",
      retention_class: "restricted_source_snapshot",
      raw_artifact_policy: "persist",
      source_version_strategy: "version",
      ai_use_policy: "prohibited",
      permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
      export_restrictions: ["tenant_only", "approval_required"],
      disclaimer_ids: ["source_terms:tenant_license"],
      legal_approval_id: "legal-approval:tenant-vocab-2026"
    },
    record: { source_record_id: "licensed:123" },
    requestedUses: ["ingest", "persist_raw", "materialize", "normalize", "export"]
  });

  assert.equal(result.license_classification, "licensed_materializable_with_restrictions");
  assert.equal(result.retention_class, "restricted_source_snapshot");
  assert.equal(result.decisions.materialize, true);
  assert.equal(result.decisions.export_eligible, true);
  assert.equal(result.decisions.ai_eligible, false);
  assert.deepEqual(result.export_restrictions, ["tenant_only", "approval_required"]);
});

test("openFDA FAERS policy carries mandatory non-causal disclaimer", () => {
  const result = assertIngestionPolicy({
    source: "openFDA FAERS",
    record: { source_record_id: "faers:case-1" },
    requestedUses: ["ingest", "persist_raw", "materialize", "normalize"]
  });

  assert.ok(result.disclaimer_ids.includes(FAERS_NON_CAUSAL_DISCLAIMER_ID));
  assert.equal(result.evidence_flags.non_causal_warning_required, true);
  assert.equal(result.evidence_flags.supports_causal_claims, false);
  assert.equal(result.decisions.requires_non_causal_disclaimer, true);
});

test("unknown source fails closed", () => {
  assert.throws(
    () => assertIngestionPolicy({
      source: "Unreviewed commercial dataset",
      record: { source_record_id: "vendor:1" },
      requestedUses: ["ingest", "normalize"]
    }),
    /blocked pending legal review|policy block/
  );
});

test("final normalized object recheck is idempotent and returns stampable decision", () => {
  const input = {
    source: "ChEMBL",
    record: {
      source_record_id: "CHEMBL25",
      normalized_record: { label: "Aspirin" },
      disclaimer_ids: ["source_terms:chembl"]
    },
    requestedUses: ["ingest", "persist_raw", "materialize", "normalize"],
    finalObject: true
  };

  const first = assertIngestionPolicy(input);
  const second = assertIngestionPolicy(input);

  assert.deepEqual(second, first);
  assert.equal(first.final_object_evaluated, true);
  assert.equal(first.blocks.length, 0);
  assert.equal(first.license_classification, "open_with_attribution");
});

test("final normalized object recheck blocks when PII appears during normalization", () => {
  assert.throws(
    () => assertIngestionPolicy({
      source: "ChEMBL",
      record: {
        source_record_id: "CHEMBL25",
        normalized_record: {
          label: "Aspirin from patient note",
          contains_phi_or_pii: true
        },
        disclaimer_ids: ["source_terms:chembl"]
      },
      requestedUses: ["ingest", "persist_raw", "materialize", "normalize", "ai"],
      finalObject: true
    }),
    (error) => error instanceof PolicyViolation &&
      error.details.decisions.contains_phi_or_pii === true &&
      error.details.blocks.includes("source is not eligible for requested AI processing")
  );
});

test("final normalized object recheck blocks when license downgrades during normalization", () => {
  assert.throws(
    () => assertIngestionPolicy({
      source: "ChEMBL",
      record: {
        source_record_id: "CHEMBL25",
        license_classification: "licensed_federated",
        materialization_policy: "federate",
        raw_artifact_policy: "pointer_only",
        normalized_record: { label: "restricted term" },
        disclaimer_ids: ["source_terms:restricted"]
      },
      requestedUses: ["ingest", "persist_raw", "materialize", "normalize"],
      finalObject: true
    }),
    (error) => error instanceof PolicyViolation &&
      error.details.license_classification === "licensed_federated" &&
      error.details.blocks.includes("federated or pointer-only source cannot be materialized")
  );
});

test("final FAERS object recheck blocks when non-causal disclaimer is missing", () => {
  assert.throws(
    () => assertIngestionPolicy({
      source: "openFDA FAERS",
      record: {
        source_record_id: "faers:case-1",
        normalized_record: { label: "FAERS case" },
        disclaimer_ids: []
      },
      requestedUses: ["ingest", "persist_raw", "materialize", "normalize"],
      finalObject: true
    }),
    (error) => error instanceof PolicyViolation &&
      error.details.blocks.includes("final FAERS/openFDA object is missing required non-causal disclaimer")
  );
});

test("final FAERS object recheck passes when non-causal disclaimer is preserved", () => {
  const result = assertIngestionPolicy({
    source: "openFDA FAERS",
    record: {
      source_record_id: "faers:case-1",
      normalized_record: { label: "FAERS case" },
      disclaimer_ids: [FAERS_NON_CAUSAL_DISCLAIMER_ID]
    },
    requestedUses: ["ingest", "persist_raw", "materialize", "normalize"],
    finalObject: true
  });

  assert.equal(result.final_object_evaluated, true);
  assert.equal(result.evidence_flags.non_causal_warning_required, true);
  assert.deepEqual(result.blocks, []);
});
