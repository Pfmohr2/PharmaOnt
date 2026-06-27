import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MappingRegistry,
  MappingRegistryError,
  buildGovernedDecisionBinding,
  digestValue,
  mappingEvidenceDigest
} from "../../services/mapping-registry/src/index.js";
import { ProposalWorkflowService } from "../../services/proposal-workflow/src/index.js";
import { validationPreview } from "../../services/validation/src/index.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/phase4-proposals.json", import.meta.url), "utf8"));

test("Phase 4 exit: real proposal workflow handles propose, validate, route, approve/reject, stage, diff/export, and audit", () => {
  const registry = testRegistry();
  registry.createMapping({
    tenantId: "tenant-a",
    actor: "user:curator-1",
    mapping: validRegistryMapping({ predicate: "closeMatch", confidence_score: 0.82, confidence_band: "medium" })
  });
  const workflow = testWorkflow({
    diffPreview: (args) => registry.diffPreview(args)
  });

  const submitted = new Map();
  for (const proposal of fixture.proposals.map(withFixtureScope)) {
    const result = workflow.submitProposal({
      proposal,
      actor: actors.contributor,
      rationale: proposal.rationale,
      correlation_id: `corr:${proposal.proposal_id}:submit`
    });
    submitted.set(proposal.proposal_type, result.proposal);
    assert.equal(result.proposal.state, "submitted");
    assert.match(result.proposal.diff.diff_id, /^diff:/);
  }

  for (const proposal of submitted.values()) {
    const validated = workflow.validateProposal({
      proposalId: proposal.proposal_id,
      actor: actors.curator,
      rationale: "Curator validation passed required shape and evidence checks.",
      correlation_id: `corr:${proposal.proposal_id}:validate`
    });
    assert.equal(validated.proposal.state, "validation");
    assert.equal(validated.validation_result.critical_failures, 0);

    const routed = workflow.routeProposal({
      proposalId: proposal.proposal_id,
      actor: actors.curator,
      rationale: "Curator routed proposal to review queue.",
      correlation_id: `corr:${proposal.proposal_id}:route`
    });
    assert.equal(routed.proposal.state, "curator-review");

    const decisionQueue = workflow.routeForDecision({
      proposalId: proposal.proposal_id,
      actor: actors.curator,
      rationale: "Curator sent proposal to domain approver.",
      correlation_id: `corr:${proposal.proposal_id}:decision`
    });
    assert.equal(decisionQueue.proposal.state, "approver-decision");
  }

  const synonym = workflow.approveProposal({
    proposalId: submitted.get("synonym").proposal_id,
    actor: actors.domainApprover,
    rationale: "Synonym is supported by source evidence.",
    correlation_id: "corr:p4:synonym:approve"
  });
  const mapping = workflow.approveProposal({
    proposalId: submitted.get("mapping").proposal_id,
    actor: actors.domainApprover,
    rationale: "Mapping is exact and evidence-backed.",
    correlation_id: "corr:p4:mapping:approve"
  });
  const evidence = workflow.approveProposal({
    proposalId: submitted.get("evidence-link").proposal_id,
    actor: actors.domainApprover,
    rationale: "Evidence link is valid.",
    correlation_id: "corr:p4:evidence:approve"
  });
  const rejected = workflow.rejectProposal({
    proposalId: submitted.get("relationship").proposal_id,
    actor: actors.domainApprover,
    rationale: "Relationship needs additional domain evidence.",
    correlation_id: "corr:p4:relationship:reject"
  });
  const staged = workflow.stageForRelease({
    proposalId: mapping.proposal.proposal_id,
    actor: actors.releaseManager,
    rationale: "Approved mapping is ready for release candidate assembly.",
    correlation_id: "corr:p4:mapping:stage",
    release_id: "2026.0.0-rc1"
  });

  assert.equal(synonym.proposal.state, "approved");
  assert.equal(mapping.proposal.state, "approved");
  assert.equal(evidence.proposal.state, "approved");
  assert.equal(rejected.proposal.state, "rejected");
  assert.equal(staged.proposal.state, "staged-for-release");
  assert.equal(staged.staging.release_id, "2026.0.0-rc1");
  assert.equal(staged.governed_decision.decision, "allow");
  assert.match(staged.governed_decision.signature, /^sha256:/);

  const queue = workflow.queryReviewQueue({ tenant_id: "tenant-a", state: "approver-decision" });
  assert.equal(queue.length, 4);
  assert.ok(queue.every((item) => item.status === "open"));

  const mappingDiff = submitted.get("mapping").diff;
  assert.equal(mappingDiff.object_type, "mapping");
  assert.equal(mappingDiff.object_id, "pharmmap:aspirin-chembl-pubchem");
  assert.ok(mappingDiff.fields.some((field) => field.path === "predicate"));

  const exported = registry.exportMappings({ tenantId: "tenant-a", exportId: "export:p4-qa" });
  assert.equal(exported.record_count, 1);
  assert.equal(exported.mappings[0].mapping.provenance_id, "pharmprov:p4/mapping-aspirin");
  assert.match(exported.manifest_digest, /^sha256:/);

  const eventTypes = workflow.auditStore.list().map((event) => event.event_type);
  assert.deepEqual(eventTypes, [
    "proposal_submitted",
    "proposal_submitted",
    "proposal_submitted",
    "proposal_submitted",
    "proposal_validated",
    "proposal_routed_curator_review",
    "proposal_routed_approver_decision",
    "proposal_validated",
    "proposal_routed_curator_review",
    "proposal_routed_approver_decision",
    "proposal_validated",
    "proposal_routed_curator_review",
    "proposal_routed_approver_decision",
    "proposal_validated",
    "proposal_routed_curator_review",
    "proposal_routed_approver_decision",
    "proposal_approved",
    "proposal_approved",
    "proposal_approved",
    "proposal_rejected",
    "proposal_staged_for_release"
  ]);
  for (const event of workflow.auditStore.list()) {
    assert.equal(event.tenant_id, "tenant-a");
    assert.equal(event.environment, "test");
    assert.ok(event.actor_user_id);
    assert.ok(event.proposal_id);
    assert.ok(event.occurred_at);
    assert.ok(event.rationale);
    assert.ok("previous_state" in event);
    assert.ok("next_state" in event);
    assert.match(event.before_hash, /^sha256:/);
    assert.match(event.after_hash, /^sha256:/);
  }
  assert.throws(() => {
    workflow.auditStore.list()[0].event_type = "tampered";
  }, /Cannot assign|read only/);
});

test("Phase 4 negatives: real proposal workflow denies wrong-role and cross-tenant actions before mutation", () => {
  const workflow = testWorkflow();
  const submitted = workflow.submitProposal({
    proposal: withFixtureScope(fixture.proposals[1]),
    actor: actors.contributor,
    rationale: fixture.proposals[1].rationale,
    correlation_id: "corr:p4-negative:submit"
  });

  assert.throws(
    () => workflow.approveProposal({
      proposalId: submitted.proposal.proposal_id,
      actor: actors.viewer,
      rationale: "Viewer cannot approve.",
      correlation_id: "corr:p4-negative:viewer"
    }),
    /proposal workflow action denied/
  );
  assert.throws(
    () => workflow.validateProposal({
      proposalId: submitted.proposal.proposal_id,
      actor: actors.otherTenantCurator,
      rationale: "Cross-tenant curator cannot validate.",
      correlation_id: "corr:p4-negative:cross-tenant"
    }),
    /proposal workflow action denied/
  );
  assert.equal(workflow.getProposal(submitted.proposal.proposal_id).state, "submitted");
  assert.equal(workflow.auditFor(submitted.proposal.proposal_id).at(-1).decision, "denied");
});

test("P3-RT-001 class stays green: real registry denies missing, forged, and replayed signed decisions", () => {
  const registry = testRegistry({
    governedDecisionVerifier: ({ decision, decision_binding }) => decision.signature === testDecisionSignature(decision_binding)
  });
  registry.createMapping({
    tenantId: "tenant-a",
    actor: "service:normalization",
    mapping: validRegistryMapping(),
    registryMetadata: {
      candidate_metadata: {
        candidate_id: "candidate:p4-regression",
        environment: "test",
        duplicate_status: "not_duplicate"
      }
    }
  });
  const record = registry.getMapping({ tenantId: "tenant-a", mappingId: "pharmmap:aspirin-chembl-pubchem" });
  const decision = signedGovernedDecision({
    record,
    rationale: "Approve governed mapping.",
    correlationId: "corr:p4-regression:approve"
  });

  assert.throws(
    () => registry.applyGovernedTransition({
      tenantId: "tenant-a",
      mappingId: record.mapping.mapping_id,
      transition: "approve",
      authorizationContext: { governedDecision: null },
      auditContext: { actor_user_id: "user:approver-1", rationale: "Missing decision", correlation_id: "corr:p4-missing" }
    }),
    MappingRegistryError
  );
  assert.throws(
    () => registry.applyGovernedTransition({
      tenantId: "tenant-a",
      mappingId: record.mapping.mapping_id,
      transition: "approve",
      authorizationContext: { governedDecision: { ...decision, signature: "" } },
      auditContext: { actor_user_id: "user:approver-1", rationale: "Approve governed mapping.", correlation_id: "corr:p4-regression:approve" }
    }),
    MappingRegistryError
  );

  const approved = registry.applyGovernedTransition({
    tenantId: "tenant-a",
    mappingId: record.mapping.mapping_id,
    transition: "approve",
    authorizationContext: { governedDecision: decision },
    auditContext: { actor_user_id: "user:approver-1", rationale: "Approve governed mapping.", correlation_id: "corr:p4-regression:approve" }
  });
  assert.equal(approved.mapping.review_status, "approved");
  assert.throws(
    () => registry.applyGovernedTransition({
      tenantId: "tenant-a",
      mappingId: record.mapping.mapping_id,
      transition: "approve",
      authorizationContext: { governedDecision: decision },
      auditContext: { actor_user_id: "user:approver-1", rationale: "Approve governed mapping.", correlation_id: "corr:p4-regression:approve" }
    }),
    MappingRegistryError
  );
});

const actors = {
  contributor: { user_id: "user:contributor-1", role_keys: ["contributor"], tenant_id: "tenant-a", environment: "test" },
  curator: { user_id: "user:curator-1", role_keys: ["curator"], tenant_id: "tenant-a", environment: "test" },
  domainApprover: { user_id: "user:approver-1", role_keys: ["domain_approver"], tenant_id: "tenant-a", environment: "test" },
  releaseManager: { user_id: "user:release-manager-1", role_keys: ["release_manager"], tenant_id: "tenant-a", environment: "test" },
  viewer: { user_id: "user:viewer-1", role_keys: ["viewer"], tenant_id: "tenant-a", environment: "test" },
  otherTenantCurator: { user_id: "user:curator-b", role_keys: ["curator"], tenant_id: "tenant-b", environment: "test" }
};

function testWorkflow(overrides = {}) {
  return new ProposalWorkflowService({
    clock: fixedClock,
    idFactory: sequenceIds(),
    validationPreview,
    ...overrides
  });
}

function withFixtureScope(proposal) {
  return {
    tenant_id: fixture.tenant_id,
    environment: fixture.environment,
    ...proposal
  };
}

function testRegistry(overrides = {}) {
  return new MappingRegistry({
    clock: fixedClock,
    idFactory: sequenceIds(),
    ...overrides
  });
}

function fixedClock() {
  return new Date("2026-06-27T04:30:00.000Z");
}

function sequenceIds() {
  let id = 0;
  return () => `${++id}`;
}

function validRegistryMapping(overrides = {}) {
  return {
    mapping_id: "pharmmap:aspirin-chembl-pubchem",
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
    confidence_score: 0.97,
    confidence_band: "high",
    evidence_ids: ["pharmev:evidence-2026-000001"],
    evidence_refs: [{ evidence_id: "pharmev:evidence-2026-000001", evidence_role: "supports", required_for_release: true }],
    provenance_id: "pharmprov:p4/mapping-aspirin",
    created_by: "service:normalization",
    reviewed_by: null,
    review_status: "proposed",
    release_id: null,
    provenance: {
      actor: "service:normalization",
      timestamp: "2026-06-27T04:30:00.000Z",
      source: "ChEMBL",
      source_version: "34",
      audit_event_id: "audit:p4-regression-source"
    },
    ...overrides
  };
}

function signedGovernedDecision({
  record,
  rationale,
  correlationId,
  issuedAt = "2026-06-27T04:29:00.000Z",
  expiresAt = "2026-06-27T04:31:00.000Z"
}) {
  const value = {
    decision_id: `decision:mapping:${record.mapping.mapping_id}:${correlationId}`,
    decision: "allow",
    action: "mapping_candidate.approve",
    actor_user_id: "user:approver-1",
    actor_role_key: "domain_approver",
    tenant_id: record.tenant_id,
    environment: record.registry_metadata.candidate_metadata.environment,
    candidate_id: record.registry_metadata.candidate_metadata.candidate_id,
    mapping_id: record.mapping.mapping_id,
    previous_review_status: "proposed",
    next_review_status: "approved",
    release_id: null,
    rationale_digest: digestValue(rationale),
    evidence_digest: mappingEvidenceDigest(record),
    provenance_id: record.mapping.provenance_id,
    source_vocabulary_version: record.mapping.source_vocabulary_version,
    target_vocabulary_version: record.mapping.target_vocabulary_version,
    duplicate_status: record.registry_metadata.candidate_metadata.duplicate_status,
    audit_event_id: `audit:${record.mapping.mapping_id}:approve`,
    correlation_id: correlationId,
    issued_at: issuedAt,
    expires_at: expiresAt,
    audit_event_type: "mapping_candidate_approved"
  };
  value.decision_binding = buildGovernedDecisionBinding(value);
  value.signature = testDecisionSignature(value.decision_binding);
  return value;
}

function testDecisionSignature(decisionBinding) {
  return digestValue(`test-governed-decision-signature:${decisionBinding}`);
}
