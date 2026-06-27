import assert from "node:assert/strict";
import test from "node:test";

import {
  CRITICAL_RULES,
  ValidationError,
  assertNoCriticalFailures,
  assertResolvedValidationEvidence,
  resolveValidationEvidence,
  validate,
  validateProposal,
  validateReleaseCandidate,
  validationPreview
} from "../../services/validation/src/index.js";

test("validation preview returns pass status without mutating a governed mapping proposal", () => {
  const proposal = validMappingProposal();
  const before = JSON.stringify(proposal);

  const result = validateProposal(proposal, { expectedTenantId: "tenant-a" });

  assert.equal(result.status, "pass");
  assert.equal(result.blocking, false);
  assert.deepEqual(result.findings, []);
  assert.equal(JSON.stringify(proposal), before);
});

test("validation preview reports critical missing provenance, evidence, vocabulary version, and confidence", () => {
  const proposal = validMappingProposal({
    provenance_id: "",
    provenance: null,
    evidence_ids: [],
    evidence_refs: [],
    target_vocabulary_version: "",
    confidence_score: undefined,
    confidence_band: ""
  });

  const result = validate(proposal, { expectedTenantId: "tenant-a" });

  assert.equal(result.status, "fail");
  assert.equal(result.blocking, true);
  assert.equal(result.summary.critical, 4);
  assertFindings(result, [
    "required_provenance",
    "required_evidence",
    "mapping_source_target_versions",
    "confidence_not_fabricated"
  ]);
});

test("validation preview blocks fabricated confidence even when a score is supplied", () => {
  const result = validateProposal(validMappingProposal({
    confidence_score: 0.91,
    confidence_band: "high",
    confidence_source: "fabricated"
  }));

  assert.equal(result.blocking, true);
  assertFindings(result, ["confidence_not_fabricated"]);
});

test("FAERS claims are blocked when presented as causal or without non-causal limitations", () => {
  const causal = validateProposal(validRelationshipProposal({
    relationship_id: "rel:faers-causal",
    source: "openFDA FAERS",
    claim_type: "causal",
    predicate: "causes",
    disclaimer_ids: []
  }));
  assert.equal(causal.blocking, true);
  assertFindings(causal, ["faers_non_causal"]);

  const descriptive = validateProposal(validRelationshipProposal({
    relationship_id: "rel:faers-descriptive",
    source: "openFDA FAERS",
    claim_type: "descriptive",
    predicate: "reported_with",
    disclaimer_ids: ["faers-non-causal-limitations"],
    evidence_refs: [
      {
        evidence_id: "ev:faers-1",
        source: "openFDA FAERS",
        disclaimer_id: "faers non-causal limitations"
      }
    ]
  }));
  assert.equal(descriptive.blocking, false);
});

test("validation preview blocks cross-tenant references", () => {
  const result = validateProposal(validMappingProposal({
    tenant_id: "tenant-a",
    evidence_refs: [
      {
        evidence_id: "ev:tenant-b",
        evidence_role: "supports",
        tenant_id: "tenant-b"
      }
    ]
  }), { expectedTenantId: "tenant-a" });

  assert.equal(result.status, "fail");
  assert.equal(result.blocking, true);
  assertFindings(result, ["tenant_boundary"]);
});

test("release candidate with unapproved item is blocking and assertion helper throws", () => {
  const releaseCandidate = validReleaseCandidate({
    items: [
      validMappingProposal({
        mapping_id: "map:unapproved",
        review_status: "proposed",
        reviewed_by: null,
        workflow_status: "queued_high_confidence"
      })
    ]
  });

  const result = validateReleaseCandidate(releaseCandidate, { expectedTenantId: "tenant-a" });

  assert.equal(result.status, "fail");
  assert.equal(result.blocking, true);
  assertFindings(result, ["release_approval_state"]);
  assert.throws(
    () => assertNoCriticalFailures(releaseCandidate, { releaseMode: true, expectedTenantId: "tenant-a" }),
    ValidationError
  );
});

test("release candidate requires package evidence and passes with approved governed items", () => {
  const incomplete = validateReleaseCandidate({
    type: "release_candidate",
    release_candidate_id: "rc:missing-package",
    tenant_id: "tenant-a",
    items: [validApprovedMapping()]
  });

  assert.equal(incomplete.blocking, true);
  assertFindings(incomplete, ["release_candidate_evidence_package"]);

  const complete = validateReleaseCandidate(validReleaseCandidate());

  assert.equal(complete.status, "pass");
  assert.equal(complete.blocking, false);
  assert.deepEqual(complete.findings, []);
  assert.doesNotThrow(() => assertNoCriticalFailures(validReleaseCandidate(), { releaseMode: true }));
});

test("critical rule export documents the release-blocking contract", () => {
  assert.deepEqual(CRITICAL_RULES, [
    "required_provenance",
    "required_evidence",
    "mapping_source_target_versions",
    "confidence_not_fabricated",
    "faers_non_causal",
    "tenant_boundary",
    "release_approval_state",
    "release_candidate_evidence_package",
    "validation_evidence_resolved"
  ]);
});

test("release validation evidence fails closed without immutable validation-run resolver", async () => {
  const result = await resolveValidationEvidence(validReleaseCandidate());

  assert.equal(result.status, "fail");
  assert.equal(result.blocking, true);
  assertFindings(result, ["validation_evidence_resolved"]);
  await assert.rejects(
    () => assertResolvedValidationEvidence(validReleaseCandidate()),
    ValidationError
  );
});

test("release validation evidence ignores caller-resolved refs and uses authoritative immutable run", async () => {
  const releaseCandidate = validReleaseCandidate({
    validation_report_refs: [{ validation_run_id: "validation:p4-001", result: "passed", severity: "none", resolved: true }]
  });
  const result = await resolveValidationEvidence(releaseCandidate, {
    resolveValidationRun(args) {
      return validationRunRecord({
        ...recordBinding(args),
        status: "failed",
        summary: { critical: 1, warning: 0 },
        findings: [{
          finding_id: "finding:critical-1",
          rule_id: "required_evidence",
          severity: "critical",
          blocks_release: true
        }]
      });
    }
  });

  assert.equal(result.status, "fail");
  assert.equal(result.blocking, true);
  assertFindings(result, ["validation_evidence_resolved"]);
});

test("release validation evidence accepts immutable passing run or verified audited waiver", async () => {
  const passResult = await assertResolvedValidationEvidence(validReleaseCandidate(), {
    resolveValidationRun(args) {
      return validationRunRecord(recordBinding(args));
    }
  });

  assert.equal(passResult.status, "pass");
  assert.equal(passResult.blocking, false);
  assert.equal(passResult.resolved_validation_runs[0].validation_run_id, "validation:p4-001");

  const waivedResult = await assertResolvedValidationEvidence(validReleaseCandidate(), {
    resolveValidationRun(args) {
      return validationRunRecord({
        ...recordBinding(args),
        status: "failed",
        summary: { critical: 1, warning: 0 },
        findings: [{
          finding_id: "finding:waived-1",
          rule_id: "release_candidate_evidence_package",
          severity: "critical",
          blocks_release: true
        }]
      });
    },
    resolveValidationWaiver({ validation_run_id, finding_id, rule_id, tenant_id, environment, release_id, release_candidate_id }) {
      return {
        waiver_id: "waiver:1",
        validation_run_id,
        finding_id,
        rule_id,
        tenant_id,
        environment,
        release_id,
        release_candidate_id,
        approved: true,
        audited: true,
        audit_event_id: "audit:waiver:1"
      };
    }
  });

  assert.equal(waivedResult.status, "pass");
  assert.equal(waivedResult.blocking, false);
});

test("release validation evidence blocks immutable record scope and item mismatches", async () => {
  const result = await resolveValidationEvidence(validReleaseCandidate(), {
    resolveValidationRun(args) {
      return validationRunRecord({
        ...recordBinding(args),
        tenant_id: "tenant-b",
        item_ids: ["map:other"]
      });
    }
  });

  assert.equal(result.status, "fail");
  assert.equal(result.blocking, true);
  assert.ok(result.summary.critical >= 2);
  assertFindings(result, ["validation_evidence_resolved"]);
});

test("proposal workflow validationPreview adapter returns Phyllis hook shape", () => {
  const proposal = proposalEnvelopeFixture();
  const before = JSON.stringify(proposal);

  const result = validationPreview({
    proposal,
    actor: { user_id: "user:curator-1", tenant_id: "tenant-a" },
    correlation_id: "corr:validate",
    phase: "route"
  });

  assert.equal(result.status, "passed");
  assert.equal(result.critical_failures, 0);
  assert.equal(result.warnings, 0);
  assert.equal(result.validation_report_id, "validation:route:proposal:aspirin-synonym");
  assert.deepEqual(result.findings, []);
  assert.equal(JSON.stringify(proposal), before);
});

test("proposal workflow validationPreview adapter reports critical failures for route and stage gates", () => {
  const routeBlocked = validationPreview({
    proposal: proposalEnvelopeFixture({
      provenance: { source: "curator-entry", source_version: "working-2026-06-27" }
    }),
    actor: { user_id: "user:curator-1", tenant_id: "tenant-a" },
    phase: "route"
  });

  assert.equal(routeBlocked.status, "failed");
  assert.equal(routeBlocked.critical_failures, 2);
  assertFindings(routeBlocked, ["required_provenance", "required_evidence"]);

  const stageBlocked = validationPreview({
    proposal: proposalEnvelopeFixture({
      state: "curator-review",
      decided_by_user_id: null
    }),
    actor: { user_id: "user:release-manager-1", tenant_id: "tenant-a" },
    phase: "stage_release"
  });

  assert.equal(stageBlocked.status, "failed");
  assert.ok(stageBlocked.critical_failures > 0);
  assertFindings(stageBlocked, ["release_approval_state"]);
});

function assertFindings(result, ruleIds) {
  for (const ruleId of ruleIds) {
    assert.ok(
      result.findings.some((finding) => finding.rule_id === ruleId && finding.severity === "critical"),
      `expected critical finding ${ruleId}`
    );
  }
}

function proposalEnvelopeFixture(overrides = {}) {
  return {
    proposal_id: "proposal:aspirin-synonym",
    tenant_id: "tenant-a",
    environment: "test",
    proposal_type: "synonym",
    state: "approved",
    payload: {
      subject_id: "pharment:compound/aspirin",
      predicate: "hasSynonym",
      value: "ASA",
      language: "en"
    },
    provenance: {
      provenance_id: "pharmprov:proposal/aspirin-synonym",
      source: "curator-entry",
      source_version: "working-2026-06-27",
      evidence_ids: ["pharmev:aspirin-synonym-1"]
    },
    rationale: "Aspirin synonym appears in curated evidence.",
    confidence_score: 0.94,
    confidence_band: "high",
    decided_by_user_id: "user:domain-approver-1",
    ...overrides
  };
}

function validReleaseCandidate(overrides = {}) {
  return {
    type: "release_candidate",
    release_candidate_id: "rc:2026-06-27-001",
    tenant_id: "tenant-a",
    changelog: [{ change_id: "chg:1", summary: "Approve aspirin mapping." }],
    artifact_hashes: [{ artifact: "mappings.json", sha256: "abc123" }],
    validation_evidence: [{ validation_run_id: "validation:p4-001", result: "passed" }],
    source_version_pins: {
      ChEMBL: "34",
      PharmaOps: "working-2026-06-27"
    },
    approval_trace: [{ actor: "user:domain-approver", decision: "approved" }],
    items: [validApprovedMapping()],
    ...overrides
  };
}

function validationRunRecord(overrides = {}) {
  return {
    validation_run_id: "validation:p4-001",
    tenant_id: "tenant-a",
    environment: "test",
    release_id: null,
    release_candidate_id: "rc:2026-06-27-001",
    subject_type: "release_candidate",
    subject_id: "rc:2026-06-27-001",
    input_payload_digest: "sha256:fixture",
    item_ids: ["map:approved"],
    ruleset_version: "phase4.validation-preview.v1",
    report_digest: "sha256:report",
    signature: "sha256:signature",
    immutable: true,
    immutable_record_id: "validation-record:p4-001",
    status: "passed",
    summary: { critical: 0, warning: 0 },
    findings: [],
    ...overrides
  };
}

function recordBinding(args) {
  return {
    tenant_id: args.tenant_id,
    environment: args.environment,
    release_id: args.release_id,
    release_candidate_id: args.release_candidate_id,
    subject_type: args.subject_type,
    subject_id: args.subject_id,
    input_payload_digest: args.input_payload_digest,
    item_ids: args.item_ids
  };
}

function validApprovedMapping(overrides = {}) {
  return validMappingProposal({
    mapping_id: "map:approved",
    review_status: "approved",
    reviewed_by: "user:domain-approver",
    workflow_status: "staged_for_release",
    ...overrides
  });
}

function validMappingProposal(overrides = {}) {
  return {
    object_type: "mapping",
    mapping_id: "map:aspirin-chembl-pubchem",
    tenant_id: "tenant-a",
    source_entity_id: "chembl:CHEMBL25",
    target_entity_id: "pubchem:CID2244",
    predicate: "exactMatch",
    source_vocabulary: "ChEMBL",
    source_vocabulary_version: "34",
    target_vocabulary: "PubChem",
    target_vocabulary_version: "2026-06-01",
    confidence_score: 0.98,
    confidence_band: "high",
    confidence_source: "deterministic_identifier_match",
    evidence_ids: ["ev:aspirin-1"],
    evidence_refs: [{ evidence_id: "ev:aspirin-1", evidence_role: "supports", tenant_id: "tenant-a" }],
    provenance_id: "prov:mapping-1",
    provenance: {
      actor: "service:normalization",
      timestamp: "2026-06-27T04:00:00.000Z",
      source: "ChEMBL",
      source_version: "34"
    },
    review_status: "proposed",
    reviewed_by: null,
    workflow_status: "queued_high_confidence",
    release_id: null,
    ...overrides
  };
}

function validRelationshipProposal(overrides = {}) {
  return {
    object_type: "relationship",
    relationship_id: "rel:faers-descriptive",
    tenant_id: "tenant-a",
    subject_id: "drug:aspirin",
    object_id: "event:bleeding",
    predicate: "reported_with",
    source: "openFDA FAERS",
    claim_type: "descriptive",
    confidence_score: 0.74,
    confidence_band: "medium",
    evidence_ids: ["ev:faers-1"],
    evidence_refs: [
      {
        evidence_id: "ev:faers-1",
        source: "openFDA FAERS",
        disclaimer_id: "faers non-causal limitations",
        tenant_id: "tenant-a"
      }
    ],
    disclaimer_ids: ["faers-non-causal-limitations"],
    provenance_id: "prov:faers-rel-1",
    provenance: {
      actor: "service:connector-openfda",
      timestamp: "2026-06-27T04:00:00.000Z",
      source: "openFDA FAERS",
      source_version: "2026q2"
    },
    review_status: "proposed",
    ...overrides
  };
}
