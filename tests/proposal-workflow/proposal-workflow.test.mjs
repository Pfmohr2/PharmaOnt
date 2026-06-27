import assert from "node:assert/strict";
import test from "node:test";

import {
  PROPOSAL_STATES,
  PROPOSAL_TRANSITIONS,
  PROPOSAL_TYPES,
  ProposalAuthorizationError,
  ProposalStoreGovernanceError,
  ProposalWorkflowService
} from "../../services/proposal-workflow/src/index.js";

test("Phase 4 proposal workflow submits, validates, routes, approves, and stages with audit", () => {
  const validationCalls = [];
  const diffCalls = [];
  const workflow = fixtureWorkflow({
    validationPreview({ proposal, phase }) {
      validationCalls.push({ proposal_id: proposal.proposal_id, phase });
      return {
        status: "passed",
        critical_failures: 0,
        warnings: phase === "route" ? 1 : 0,
        validation_report_id: `validation:${phase}:${proposal.proposal_id}`,
        findings: []
      };
    },
    diffPreview({ proposal }) {
      diffCalls.push(proposal.proposal_type);
      return { diff_id: "diff:synonym-aspirin", summary: "adds aspirin synonym" };
    }
  });

  const submitted = workflow.submitProposal({
    proposal: proposalFixture({ proposal_type: "synonym" }),
    actor: actors.contributor,
    rationale: "Add common synonym from curated evidence.",
    correlation_id: "corr-submit"
  });
  const validated = workflow.validateProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Preview semantic validation before routing.",
    correlation_id: "corr-validate"
  });
  const routed = workflow.routeProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Ready for curator review queue.",
    correlation_id: "corr-route"
  });
  const decisionQueue = workflow.routeForDecision({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Evidence and validation are ready for approver.",
    correlation_id: "corr-approver"
  });
  const approved = workflow.approveProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.domainApprover,
    rationale: "Evidence supports the synonym update.",
    correlation_id: "corr-approve"
  });
  const staged = workflow.stageForRelease({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.releaseManager,
    rationale: "Include approved proposal in RC.",
    correlation_id: "corr-stage",
    release_id: "2026.0.0-rc1"
  });

  assert.equal(submitted.proposal.state, "submitted");
  assert.equal(validated.proposal.state, "validation");
  assert.equal(routed.proposal.state, "curator-review");
  assert.equal(decisionQueue.proposal.state, "approver-decision");
  assert.equal(approved.proposal.state, "approved");
  assert.equal(staged.proposal.state, "staged-for-release");
  assert.equal(staged.staging.release_id, "2026.0.0-rc1");
  assert.equal(staged.governed_decision.decision, "allow");
  assert.match(staged.governed_decision.decision_binding, /^sha256:/);
  assert.equal(staged.governed_decision.signature, staged.governed_decision.decision_binding);
  assert.deepEqual(validationCalls.map((call) => call.phase), ["validation", "route", "stage_release"]);
  assert.deepEqual(diffCalls, ["synonym"]);
  assert.deepEqual(workflow.auditStore.list().map((event) => event.event_type), [
    "proposal_submitted",
    "proposal_validated",
    "proposal_routed_curator_review",
    "proposal_routed_approver_decision",
    "proposal_approved",
    "proposal_staged_for_release"
  ]);
  assert.throws(() => {
    workflow.auditStore.list()[0].action = "tampered";
  }, /Cannot assign|read only/);
});

test("review queue is queryable by tenant, type, state, queue, and confidence", () => {
  const workflow = fixtureWorkflow({ validationPreview: passValidationPreview });
  const synonym = runToCuratorReview(workflow, proposalFixture({
    proposal_id: "proposal:synonym",
    proposal_type: "synonym",
    confidence_band: "high"
  }));
  runToCuratorReview(workflow, proposalFixture({
    proposal_id: "proposal:mapping",
    proposal_type: "mapping",
    confidence_band: "low"
  }));
  runToCuratorReview(workflow, proposalFixture({
    proposal_id: "proposal:tenant-b",
    tenant_id: "tenant-b",
    proposal_type: "relationship",
    confidence_band: "high"
  }), { ...actors.contributor, tenant_id: "tenant-b" }, { ...actors.curator, tenant_id: "tenant-b" });

  assert.equal(workflow.queryReviewQueue({ tenant_id: "tenant-a" }).length, 2);
  assert.equal(workflow.queryReviewQueue({ tenant_id: "tenant-b" }).length, 1);
  assert.deepEqual(workflow.queryReviewQueue({
    tenant_id: "tenant-a",
    proposal_type: "synonym",
    state: "curator-review",
    queue: "curator-review",
    confidence_band: "high"
  }).map((item) => item.proposal_id), [synonym.proposal.proposal_id]);
});

test("domain approver cannot approve their own submitted proposal", () => {
  const workflow = fixtureWorkflow();
  const submitted = workflow.submitProposal({
    proposal: proposalFixture({ proposal_id: "proposal:self-approval" }),
    actor: actors.creatorApprover,
    rationale: "Approver submitted the change.",
    correlation_id: "corr-self-submit"
  });
  workflow.validateProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Validation complete.",
    correlation_id: "corr-self-validate"
  });
  workflow.routeProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Route to curator review.",
    correlation_id: "corr-self-route"
  });
  workflow.routeForDecision({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Ready for approver.",
    correlation_id: "corr-self-decision"
  });

  assert.throws(
    () => workflow.approveProposal({
      proposalId: submitted.proposal.proposal_id,
      actor: actors.creatorApprover,
      rationale: "Self approval should fail.",
      correlation_id: "corr-self-approve"
    }),
    ProposalAuthorizationError
  );
  assert.equal(workflow.getProposal(submitted.proposal.proposal_id).state, "approver-decision");
  assert.equal(workflow.auditFor(submitted.proposal.proposal_id).at(-1).decision, "denied");
});

test("P4-04 RBAC keeps domain approvers out of submit and route actions", () => {
  const workflow = fixtureWorkflow({ validationPreview: passValidationPreview });

  assert.throws(
    () => workflow.submitProposal({
      proposal: proposalFixture({ proposal_id: "proposal:approver-submit" }),
      actor: actors.domainApprover,
      rationale: "Approver should not submit under P4-04.",
      correlation_id: "corr-approver-submit"
    }),
    ProposalAuthorizationError
  );

  const submitted = workflow.submitProposal({
    proposal: proposalFixture({ proposal_id: "proposal:curator-route-only" }),
    actor: actors.contributor,
    rationale: "Contributor submits.",
    correlation_id: "corr-route-rbac-submit"
  });
  workflow.validateProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Curator validates.",
    correlation_id: "corr-route-rbac-validate"
  });
  assert.throws(
    () => workflow.routeProposal({
      proposalId: submitted.proposal.proposal_id,
      actor: actors.domainApprover,
      rationale: "Approver should not route.",
      correlation_id: "corr-route-rbac-route"
    }),
    ProposalAuthorizationError
  );
  assert.equal(workflow.getProposal(submitted.proposal.proposal_id).state, "validation");
});

test("critical validation failures block routing and release staging", () => {
  const workflow = fixtureWorkflow({
    validationPreview({ proposal, phase }) {
      if (proposal.proposal_id === "proposal:route-block" && phase === "route") {
        return criticalValidation("validation:route-block");
      }
      if (proposal.proposal_id === "proposal:stage-block" && phase === "stage_release") {
        return criticalValidation("validation:stage-block");
      }
      return {
        status: "passed",
        critical_failures: 0,
        warnings: 0,
        validation_report_id: `validation:${phase}:${proposal.proposal_id}`,
        findings: []
      };
    }
  });

  const routeBlocked = workflow.submitProposal({
    proposal: proposalFixture({ proposal_id: "proposal:route-block" }),
    actor: actors.contributor,
    rationale: "Submit blocked route fixture.",
    correlation_id: "corr-route-block-submit"
  });
  workflow.validateProposal({
    proposalId: routeBlocked.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Initial validation passes.",
    correlation_id: "corr-route-block-validate"
  });
  assert.throws(
    () => workflow.routeProposal({
      proposalId: routeBlocked.proposal.proposal_id,
      actor: actors.curator,
      rationale: "Route should fail on critical validation.",
      correlation_id: "corr-route-block-route"
    }),
    ProposalAuthorizationError
  );

  const stageBlocked = runToApproved(workflow, proposalFixture({ proposal_id: "proposal:stage-block" }));
  assert.throws(
    () => workflow.stageForRelease({
      proposalId: stageBlocked.proposal.proposal_id,
      actor: actors.releaseManager,
      rationale: "Stage should fail on critical validation.",
      correlation_id: "corr-stage-block",
      release_id: "2026.0.0-rc1"
    }),
    ProposalAuthorizationError
  );
  assert.equal(workflow.stagedEntries().length, 0);
  assert.equal(workflow.getProposal(stageBlocked.proposal.proposal_id).state, "approved");
  assert.equal(workflow.auditFor(stageBlocked.proposal.proposal_id).at(-1).decision, "denied");
});

test("proposal store rejects direct governed-state forgery", () => {
  const workflow = fixtureWorkflow({ validationPreview: passValidationPreview });
  const approved = runToApproved(workflow, proposalFixture({ proposal_id: "proposal:store-boundary" }));

  assert.throws(
    () => workflow.proposalStore.put({
      ...approved.proposal,
      state: "staged-for-release",
      release_id: "2026.0.0-rc1",
      governed_decision: {
        decision: "allow",
        proposal_id: approved.proposal.proposal_id,
        next_state: "staged-for-release"
      }
    }),
    ProposalStoreGovernanceError
  );
  assert.equal(workflow.getProposal(approved.proposal.proposal_id).state, "approved");

  const staged = workflow.stageForRelease({
    proposalId: approved.proposal.proposal_id,
    actor: actors.releaseManager,
    rationale: "Stage through signed workflow path.",
    correlation_id: "corr-store-boundary-stage",
    release_id: "2026.0.0-rc1"
  });
  assert.equal(staged.proposal.state, "staged-for-release");
  assert.equal(staged.governed_decision.audit_event_id, staged.audit_event.audit_event_id);
  assert.equal(staged.audit_event.governed_decision_id, staged.governed_decision.decision_id);
});

test("AI suggestions enter governed queues, capture feedback, and cannot auto-release", () => {
  const workflow = fixtureWorkflow({
    validationPreview: passValidationPreview,
    expertReviewPolicy: {
      policy_id: "policy:test-low-confidence",
      low_confidence_threshold: 0.7,
      queue: "expert-review"
    }
  });
  const submitted = workflow.submitAiSuggestion({
    suggestion: aiSuggestionFixture({
      proposal_id: "proposal:ai-low-confidence",
      score: 0.42
    }),
    actor: actors.aiIngest,
    rationale: "AI candidate from ingestion handoff.",
    correlation_id: "corr-ai-submit"
  });

  assert.equal(submitted.proposal.state, "submitted");
  assert.equal(submitted.proposal.assertion_type, "model_suggested");
  assert.equal(submitted.proposal.payload.assertion_type, "model_suggested");
  assert.equal(submitted.proposal.submitted_by_role_key, "ai_suggestion_ingest");

  const validated = workflow.validateProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Validate AI suggestion before review.",
    correlation_id: "corr-ai-validate"
  });
  const routed = workflow.routeProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Route low confidence suggestion to expert.",
    correlation_id: "corr-ai-route"
  });
  assert.equal(validated.proposal.state, "validation");
  assert.equal(routed.proposal.state, "curator-review");
  assert.equal(routed.queue_item.queue, "expert-review");
  assert.equal(routed.queue_item.requires_expert_review, true);
  assert.equal(routed.queue_item.routing_policy_id, "policy:test-low-confidence");

  const feedback = workflow.recordSuggestionFeedback({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.expertReviewer,
    feedback: {
      decision: "revise",
      revision: {
        payload_patch: { value: "ASA" },
        note: "Keep as synonym candidate, but use source span label."
      }
    },
    rationale: "Expert reviewed source span and requested a revision.",
    correlation_id: "corr-ai-feedback"
  });
  assert.equal(feedback.feedback.decision, "revise");
  assert.equal(feedback.audit_event.event_type, "ai_suggestion_feedback_recorded");
  assert.equal(workflow.suggestionFeedbackFor(submitted.proposal.proposal_id).length, 1);
  assert.equal(workflow.getProposal(submitted.proposal.proposal_id).state, "curator-review");
  assert.equal(workflow.stagedEntries().length, 0);

  workflow.routeForDecision({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Expert feedback recorded; route to approver.",
    correlation_id: "corr-ai-decision"
  });
  const approved = workflow.approveProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.domainApprover,
    rationale: "Human approval after expert review.",
    correlation_id: "corr-ai-approve"
  });
  const staged = workflow.stageForRelease({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.releaseManager,
    rationale: "Stage only after governed human approval.",
    correlation_id: "corr-ai-stage",
    release_id: "2026.0.0-rc1"
  });

  assert.equal(approved.proposal.state, "approved");
  assert.equal(staged.proposal.state, "staged-for-release");
  assert.equal(staged.proposal.assertion_type, "model_suggested");
  assert.equal(staged.governed_decision.decision, "allow");
  assert.equal(staged.governed_decision.human_governance_proof_id, feedback.feedback.feedback_id);
  assert.equal(staged.governed_decision.human_governance_proof_digest, approved.governed_decision.human_governance_proof_digest);
});

test("P6-SEC model_suggested approve and stage require audited human feedback proof", () => {
  const workflow = fixtureWorkflow({ validationPreview: passValidationPreview });
  const submitted = runAiSuggestionToApproverDecision(workflow, {
    proposal_id: "proposal:ai-without-proof"
  });

  assert.throws(
    () => workflow.approveProposal({
      proposalId: submitted.proposal.proposal_id,
      actor: actors.domainApprover,
      rationale: "Missing feedback proof must fail.",
      correlation_id: "corr-ai-missing-proof-approve"
    }),
    ProposalAuthorizationError
  );
  assert.equal(workflow.getProposal(submitted.proposal.proposal_id).state, "approver-decision");
  assert.equal(workflow.auditFor(submitted.proposal.proposal_id).at(-1).decision, "denied");

  const feedback = workflow.recordSuggestionFeedback({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    feedback: { decision: "accept" },
    rationale: "Human accepted the suggestion as a candidate for governed approval.",
    correlation_id: "corr-ai-proof-feedback"
  });
  const approved = workflow.approveProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.domainApprover,
    rationale: "Human-governed approval after feedback.",
    correlation_id: "corr-ai-proof-approve"
  });
  const staged = workflow.stageForRelease({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.releaseManager,
    rationale: "Stage with signed human-governance proof.",
    correlation_id: "corr-ai-proof-stage",
    release_id: "2026.0.0-rc1"
  });

  assert.equal(approved.governed_decision.human_governance_proof_id, feedback.feedback.feedback_id);
  assert.match(approved.governed_decision.human_governance_proof_digest, /^sha256:/);
  assert.equal(staged.governed_decision.human_governance_proof_id, feedback.feedback.feedback_id);
});

test("P6-SEC feedback RBAC denies contributors, service accounts, and cross-tenant reviewers", () => {
  const workflow = fixtureWorkflow({ validationPreview: passValidationPreview });
  const submitted = workflow.submitAiSuggestion({
    suggestion: aiSuggestionFixture({ proposal_id: "proposal:ai-feedback-rbac" }),
    actor: actors.aiIngest,
    rationale: "AI candidate.",
    correlation_id: "corr-ai-feedback-rbac-submit"
  });

  for (const actor of [
    actors.contributor,
    actors.aiIngest,
    { ...actors.curator, tenant_id: "tenant-b" }
  ]) {
    assert.throws(
      () => workflow.recordSuggestionFeedback({
        proposalId: submitted.proposal.proposal_id,
        actor,
        feedback: { decision: "accept" },
        rationale: "Unauthorized feedback attempt.",
        correlation_id: `corr-ai-feedback-rbac-${actor.user_id ?? actor.service_account_id ?? "actor"}`
      }),
      /role denied|service accounts|scope mismatch/
    );
  }
  assert.equal(workflow.suggestionFeedbackFor(submitted.proposal.proposal_id).length, 0);
});

test("P6-SEC store rejects forged model_suggested governed writes without proof binding", () => {
  const workflow = fixtureWorkflow({ validationPreview: passValidationPreview });
  const submitted = workflow.submitAiSuggestion({
    suggestion: aiSuggestionFixture({ proposal_id: "proposal:ai-forged-governed-write" }),
    actor: actors.aiIngest,
    rationale: "AI candidate.",
    correlation_id: "corr-ai-forged-submit"
  });
  const forgedDecision = {
    decision_id: "decision:forged",
    decision: "allow",
    action: "proposal.approve",
    actor_user_id: actors.domainApprover.user_id,
    actor_role_key: "domain_approver",
    tenant_id: submitted.proposal.tenant_id,
    environment: submitted.proposal.environment,
    proposal_id: submitted.proposal.proposal_id,
    proposal_type: submitted.proposal.proposal_type,
    previous_state: "approver-decision",
    next_state: "approved",
    release_id: null,
    rationale_digest: "sha256:forged",
    payload_digest: "sha256:forged",
    provenance_id: submitted.proposal.provenance.provenance_id,
    validation_report_id: null,
    audit_event_id: "audit:forged",
    correlation_id: "corr-ai-forged",
    issued_at: "2026-06-27T04:20:00.000Z",
    expires_at: "2026-06-27T04:21:00.000Z"
  };

  forgedDecision.decision_binding = "sha256:forged";
  forgedDecision.signature = "sha256:forged";

  assert.throws(
    () => workflow.proposalStore.applyGovernedTransition({
      proposal: {
        ...submitted.proposal,
        state: "approved",
        governed_decision: forgedDecision
      },
      governedDecision: forgedDecision,
      audit_event_id: forgedDecision.audit_event_id
    }),
    ProposalStoreGovernanceError
  );
});

test("AI suggestion ingest fails closed without evidence, source spans, score, or duplicate flag", () => {
  const workflow = fixtureWorkflow({ validationPreview: passValidationPreview });
  assert.throws(
    () => workflow.submitAiSuggestion({
      suggestion: aiSuggestionFixture({ source_spans: [] }),
      actor: actors.aiIngest,
      rationale: "Missing source spans.",
      correlation_id: "corr-ai-missing-spans"
    }),
    /source_spans/
  );
  assert.throws(
    () => workflow.submitAiSuggestion({
      suggestion: aiSuggestionFixture({
        score: null,
        confidence_score: null
      }),
      actor: actors.aiIngest,
      rationale: "Missing real model score.",
      correlation_id: "corr-ai-missing-score"
    }),
    /confidence_score/
  );
  assert.throws(
    () => workflow.submitAiSuggestion({
      suggestion: aiSuggestionFixture({
        payload: {
          ...payloadForProposalType("synonym"),
          assertion_type: "model_suggested",
          evidence_refs: []
        }
      }),
      actor: actors.aiIngest,
      rationale: "Missing evidence.",
      correlation_id: "corr-ai-missing-evidence"
    }),
    /evidence_refs/
  );
  assert.throws(
    () => workflow.submitAiSuggestion({
      suggestion: aiSuggestionFixture({ duplicate_status: null }),
      actor: actors.aiIngest,
      rationale: "Missing duplicate flag.",
      correlation_id: "corr-ai-missing-duplicate"
    }),
    /duplicate_status/
  );
});

test("proposal workflow documents the Phase 4 state and type surface", () => {
  assert.deepEqual(PROPOSAL_TYPES, ["synonym", "mapping", "relationship", "evidence-link"]);
  assert.deepEqual(PROPOSAL_STATES, [
    "submitted",
    "validation",
    "curator-review",
    "approver-decision",
    "approved",
    "rejected",
    "staged-for-release"
  ]);
  assert.deepEqual(PROPOSAL_TRANSITIONS.map((transition) => `${transition.from ?? "new"}->${transition.to}`), [
    "new->submitted",
    "submitted->validation",
    "validation->curator-review",
    "curator-review->approver-decision",
    "approver-decision->approved",
    "approver-decision->rejected",
    "approved->staged-for-release"
  ]);
});

test("default validation preview uses Phase 4 validator without mutating proposal payload", () => {
  const workflow = fixtureWorkflow();
  const submitted = workflow.submitProposal({
    proposal: proposalFixture({
      proposal_id: "proposal:valid-mapping",
      proposal_type: "mapping",
      payload: {
        mapping_id: "pharmmap:aspirin-chembl-pubchem",
        source_entity_id: "chembl:CHEMBL25",
        target_entity_id: "pubchem:CID2244",
        predicate: "exactMatch",
        source_vocabulary_version: "34",
        target_vocabulary_version: "2026-06-01",
        evidence_refs: [{ evidence_id: "pharmev:evidence-2026-000001", evidence_role: "supports" }],
        confidence_score: 0.94,
        confidence_band: "high",
        confidence_source: "curated_evidence"
      }
    }),
    actor: actors.contributor,
    rationale: "Submit valid mapping payload.",
    correlation_id: "corr-default-validator-submit"
  });

  const validated = workflow.validateProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Use default validator.",
    correlation_id: "corr-default-validator-validate"
  });

  assert.equal(validated.validation_result.status, "passed");
  assert.equal(validated.validation_result.critical_failures, 0);
  assert.equal(workflow.getProposal(submitted.proposal.proposal_id).payload.mapping_id, "pharmmap:aspirin-chembl-pubchem");
});

test("proposal workflow can use mapping registry diffPreview directly", () => {
  const calls = [];
  const workflow = fixtureWorkflow({
    mappingRegistry: {
      diffPreview(args) {
        calls.push(structuredClone(args));
        return {
          diff_id: "diff:registry:aspirin",
          object_type: "mapping",
          object_id: args.proposal.payload.mapping_id,
          tenant_id: args.proposal.tenant_id,
          proposal_id: args.proposal.proposal_id,
          correlation_id: args.correlation_id,
          summary: { total_fields_changed: 1, counts: { added: 0, removed: 0, changed: 1 }, changed_paths: ["predicate"] },
          fields: []
        };
      }
    }
  });

  const submitted = workflow.submitProposal({
    proposal: proposalFixture({
      proposal_id: "proposal:diff-preview",
      proposal_type: "mapping",
      payload: {
        mapping_id: "pharmmap:aspirin-chembl-pubchem",
        predicate: "closeMatch"
      }
    }),
    actor: actors.contributor,
    rationale: "Preview registry diff.",
    correlation_id: "corr-diff-preview"
  });

  assert.equal(submitted.proposal.diff.diff_id, "diff:registry:aspirin");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actor.user_id, actors.contributor.user_id);
  assert.equal(calls[0].correlation_id, "corr-diff-preview");
});

const actors = {
  contributor: {
    user_id: "user:contributor-1",
    role_keys: ["contributor"],
    tenant_id: "tenant-a",
    environment: "test"
  },
  curator: {
    user_id: "user:curator-1",
    role_keys: ["curator"],
    tenant_id: "tenant-a",
    environment: "test"
  },
  domainApprover: {
    user_id: "user:approver-1",
    role_keys: ["domain_approver"],
    tenant_id: "tenant-a",
    environment: "test"
  },
  creatorApprover: {
    user_id: "user:creator-approver",
    role_keys: ["contributor", "domain_approver"],
    tenant_id: "tenant-a",
    environment: "test"
  },
  releaseManager: {
    user_id: "user:release-manager-1",
    role_keys: ["release_manager"],
    tenant_id: "tenant-a",
    environment: "test"
  },
  expertReviewer: {
    user_id: "user:expert-1",
    role_keys: ["expert_reviewer"],
    tenant_id: "tenant-a",
    environment: "test"
  },
  aiIngest: {
    service_account_id: "service:ai-curation",
    principal_type: "service_account",
    tenant_id: "tenant-a",
    environment: "test"
  }
};

function fixtureWorkflow(overrides = {}) {
  return new ProposalWorkflowService({
    clock: () => new Date("2026-06-27T04:20:00.000Z"),
    idFactory: sequenceIds(),
    ...overrides
  });
}

function runToCuratorReview(workflow, proposal, contributor = actors.contributor, curator = actors.curator) {
  const submitted = workflow.submitProposal({
    proposal,
    actor: contributor,
    rationale: "Submit proposal.",
    correlation_id: `corr:${proposal.proposal_id}:submit`
  });
  workflow.validateProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: curator,
    rationale: "Validate proposal.",
    correlation_id: `corr:${proposal.proposal_id}:validate`
  });
  return workflow.routeProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: curator,
    rationale: "Route proposal.",
    correlation_id: `corr:${proposal.proposal_id}:route`
  });
}

function runToApproved(workflow, proposal) {
  const routed = runToCuratorReview(workflow, proposal);
  workflow.routeForDecision({
    proposalId: routed.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Send to approver.",
    correlation_id: `corr:${proposal.proposal_id}:decision`
  });
  return workflow.approveProposal({
    proposalId: routed.proposal.proposal_id,
    actor: actors.domainApprover,
    rationale: "Approve proposal.",
    correlation_id: `corr:${proposal.proposal_id}:approve`
  });
}

function runAiSuggestionToApproverDecision(workflow, overrides = {}) {
  const submitted = workflow.submitAiSuggestion({
    suggestion: aiSuggestionFixture(overrides),
    actor: actors.aiIngest,
    rationale: "AI candidate from ingestion handoff.",
    correlation_id: `corr:${overrides.proposal_id ?? "ai"}:submit`
  });
  workflow.validateProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Validate AI suggestion.",
    correlation_id: `corr:${submitted.proposal.proposal_id}:validate`
  });
  workflow.routeProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Route AI suggestion.",
    correlation_id: `corr:${submitted.proposal.proposal_id}:route`
  });
  workflow.routeForDecision({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Route AI suggestion to approver.",
    correlation_id: `corr:${submitted.proposal.proposal_id}:decision`
  });
  return submitted;
}

function proposalFixture(overrides = {}) {
  const proposalType = overrides.proposal_type ?? "synonym";
  return {
    proposal_id: "proposal:aspirin-synonym",
    tenant_id: "tenant-a",
    environment: "test",
    proposal_type: proposalType,
    title: "Add aspirin synonym",
    payload: payloadForProposalType(proposalType),
    provenance: {
      provenance_id: "pharmprov:proposal/aspirin-synonym",
      source: "curator-entry",
      source_version: "working-2026-06-27",
      evidence_ids: ["pharmev:aspirin-synonym-1"]
    },
    rationale: "Aspirin synonym appears in curated evidence.",
    confidence_score: 0.94,
    confidence_band: "high",
    ...overrides
  };
}

function aiSuggestionFixture(overrides = {}) {
  const proposalType = overrides.proposal_type ?? "synonym";
  const payload = overrides.payload ?? {
    ...payloadForProposalType(proposalType),
    assertion_type: "model_suggested"
  };
  return {
    proposal_id: "proposal:ai-synonym",
    suggestion_id: "suggestion:ai-synonym",
    tenant_id: "tenant-a",
    environment: "test",
    proposal_type: proposalType,
    title: "AI suggested aspirin synonym",
    payload,
    provenance: {
      provenance_id: "pharmprov:ai/synonym-aspirin",
      source: "ai-curation-beta",
      source_version: "model-run-2026-06-27",
      model_name: "curation-ranker",
      model_version: "2026-06-27",
      evidence_ids: ["pharmev:aspirin-synonym-1"]
    },
    rationale: "Model suggested synonym from source span.",
    score: 0.88,
    confidence_score: overrides.score ?? 0.88,
    confidence_source: "model_calibrated_score",
    duplicate_status: "not_duplicate",
    source_spans: [
      {
        evidence_id: "pharmev:aspirin-synonym-1",
        field: "abstract",
        start: 10,
        end: 13,
        text: "ASA"
      }
    ],
    model_name: "curation-ranker",
    model_version: "2026-06-27",
    ...overrides,
    payload
  };
}

function payloadForProposalType(proposalType) {
  if (proposalType === "mapping") {
    return {
      mapping_id: "pharmmap:proposal-aspirin",
      source_entity_id: "chembl:CHEMBL25",
      target_entity_id: "pubchem:CID2244",
      predicate: "exactMatch",
      source_vocabulary_version: "34",
      target_vocabulary_version: "2026-06-01",
      evidence_refs: [{ evidence_id: "pharmev:aspirin-synonym-1", evidence_role: "supports" }]
    };
  }
  if (proposalType === "relationship") {
    return {
      relationship_id: "pharmrel:proposal-aspirin-target",
      subject: "pharment:compound/aspirin",
      predicate: "pharm:hasKnownTarget",
      object: "uniprot:P23219",
      evidence_refs: [{ evidence_id: "pharmev:aspirin-synonym-1", evidence_role: "supports" }]
    };
  }
  if (proposalType === "evidence-link") {
    return {
      evidence_link_id: "pharmevlink:proposal-aspirin",
      evidence_id: "pharmev:aspirin-synonym-1",
      evidence_role: "supports",
      evidence_refs: [{ evidence_id: "pharmev:aspirin-synonym-1", evidence_role: "supports" }]
    };
  }
  return {
    subject_id: "pharment:compound/aspirin",
    predicate: "hasSynonym",
    value: "ASA",
    language: "en",
    evidence_refs: [{ evidence_id: "pharmev:aspirin-synonym-1", evidence_role: "supports" }]
  };
}

function criticalValidation(validationReportId) {
  return {
    status: "failed",
    critical_failures: 1,
    warnings: 0,
    validation_report_id: validationReportId,
    findings: [{ severity: "critical", message: "Missing source-version pin" }]
  };
}

function passValidationPreview({ proposal, phase }) {
  return {
    status: "passed",
    critical_failures: 0,
    warnings: 0,
    validation_report_id: `validation:${phase}:${proposal.proposal_id}`,
    findings: []
  };
}

function sequenceIds() {
  let id = 0;
  return () => `${++id}`;
}
