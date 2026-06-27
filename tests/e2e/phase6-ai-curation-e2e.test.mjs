import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderAiSuggestionWorkspace, renderSuggestionCard } from "../../apps/web/src/curation/index.js";
import { AiCurationEngine, validateSuggestionCandidate } from "../../services/ai-curation/src/index.js";
import { createPhase6AiCurationApi } from "../../services/api/src/index.js";
import { ProposalWorkflowService } from "../../services/proposal-workflow/src/index.js";
import { ReleaseManagerService } from "../../services/release-manager/src/index.js";
import { createSearchIndexService } from "../../services/search/src/index.js";

const calibrationFixture = JSON.parse(readFileSync(new URL("./fixtures/phase6-calibration-eval.json", import.meta.url), "utf8"));

const principal = Object.freeze({
  user_id: "user:curator-p6",
  tenant_id: "tenant-a",
  environment: "validation",
  role_keys: ["curator"]
});

const actors = Object.freeze({
  aiService: {
    service_account_id: "service:ai-curation",
    principal_type: "service_account",
    tenant_id: "tenant-a",
    environment: "validation"
  },
  curator: principal,
  expert: {
    user_id: "user:expert-p6",
    tenant_id: "tenant-a",
    environment: "validation",
    role_keys: ["expert_reviewer"]
  },
  approver: {
    user_id: "user:domain-approver-p6",
    tenant_id: "tenant-a",
    environment: "validation",
    role_keys: ["domain_approver"]
  },
  releaseManager: {
    user_id: "user:release-manager-p6",
    tenant_id: "tenant-a",
    environment: "validation",
    role_keys: ["release_manager"]
  }
});

test("Phase 6 E2E: AI suggestions stay governed through workflow, API, UI, feedback, search, and release gates", async () => {
  const engine = new AiCurationEngine({
    model: model(),
    calibration: calibrationFixture,
    clock: fixedClock
  });
  const candidates = buildCandidates(engine);
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every((candidate) => validateSuggestionCandidate(candidate).valid));

  const workflow = new ProposalWorkflowService({
    clock: fixedClock,
    idFactory: sequenceIds("p6"),
    validationPreview: passValidationPreview,
    expertReviewPolicy: {
      policy_id: "policy:ai-suggestion-low-confidence-v1",
      low_confidence_threshold: 0.6,
      queue: "expert-review"
    }
  });
  const submitted = candidates.map((suggestion, index) => workflow.submitAiSuggestion({
    suggestion,
    actor: actors.aiService,
    rationale: `Ingest AI suggestion ${index + 1} for governed review.`,
    correlation_id: `corr:p6:e2e:submit:${index + 1}`
  }).proposal);
  const lowConfidenceProposal = submitted.find((proposal) => proposal.confidence_score < 0.6);
  const duplicateProposal = submitted.find((proposal) => proposal.ai_suggestion.duplicate_status === "possible_duplicate");
  const faersProposal = submitted.find((proposal) =>
    proposal.payload?.evidence_refs?.some((ref) => ref.source_name === "openFDA FAERS")
  );

  for (const proposal of submitted) {
    workflow.validateProposal({
      proposalId: proposal.proposal_id,
      actor: actors.curator,
      rationale: "Validate AI suggestion before routing.",
      correlation_id: `corr:p6:e2e:validate:${proposal.proposal_id}`
    });
    workflow.routeProposal({
      proposalId: proposal.proposal_id,
      actor: actors.curator,
      rationale: "Route AI suggestion for governed human review.",
      correlation_id: `corr:p6:e2e:route:${proposal.proposal_id}`
    });
  }

  assert.equal(workflow.getProposal(lowConfidenceProposal.proposal_id).review_queue, "expert-review");
  assert.equal(workflow.getProposal(lowConfidenceProposal.proposal_id).requires_expert_review, true);
  assert.equal(workflow.getProposal(duplicateProposal.proposal_id).ai_suggestion.duplicate_status, "possible_duplicate");
  assert.equal(workflow.getProposal(duplicateProposal.proposal_id).payload.merge_allowed, false);
  assert.ok(faersProposal.payload.evidence_refs[0].disclaimer_ids.includes("source_limit:faers_non_causal"));
  assert.ok(faersProposal.payload.evidence_refs[0].source_limitations.some((value) => value.includes("non-causal")));

  workflow.routeForDecision({
    proposalId: lowConfidenceProposal.proposal_id,
    actor: actors.curator,
    rationale: "Move low-confidence suggestion to approver queue after expert routing.",
    correlation_id: "corr:p6:e2e:approver-route"
  });
  assert.throws(
    () => workflow.approveProposal({
      proposalId: lowConfidenceProposal.proposal_id,
      actor: actors.approver,
      rationale: "Attempt approval without human feedback proof.",
      correlation_id: "corr:p6:e2e:approve:no-proof"
    }),
    /human governance feedback proof/
  );
  assert.equal(workflow.getProposal(lowConfidenceProposal.proposal_id).state, "approver-decision");

  const bySuggestionId = new Map(submitted.map((proposal) => [proposal.ai_suggestion.suggestion_id, proposal]));
  const api = createPhase6AiCurationApi({
    clock: fixedClock,
    idFactory: sequenceIds("api"),
    async resolveSuggestions() {
      return submitted.map((proposal) => ({
        ...candidates.find((candidate) => candidate.suggestion_id === proposal.ai_suggestion.suggestion_id),
        workflow_state: workflow.getProposal(proposal.proposal_id).state
      })).filter((suggestion) => suggestion.safety?.faers_context !== true);
    },
    async authorizeFeedback({ principal: actor, feedback }) {
      return actor.role_keys?.some((role) => ["curator", "expert_reviewer", "domain_approver"].includes(role))
        ? { decision: "allow", decision_id: `decision:${feedback.suggestion_id}` }
        : { decision: "deny" };
    },
    async enforceNoAutoRelease({ feedback }) {
      return feedback.candidate.assertion_type === "model_suggested" && feedback.candidate.release_id === null
        ? { allowed: true, gate_id: "gate:no-auto-release" }
        : { allowed: false };
    },
    async recordSuggestionFeedback({ principal: actor, feedback }) {
      const proposal = bySuggestionId.get(feedback.suggestion_id);
      const result = workflow.recordSuggestionFeedback({
        proposalId: proposal.proposal_id,
        actor,
        feedback: {
          decision: feedback.action,
          revision: feedback.revision
        },
        rationale: feedback.rationale,
        correlation_id: feedback.feedback_id
      });
      return {
        workflow_event_id: result.audit_event.audit_event_id,
        feedback_id: result.feedback.feedback_id,
        queue: workflow.getProposal(proposal.proposal_id).review_queue,
        state: workflow.getProposal(proposal.proposal_id).state
      };
    }
  });

  const suggestionsResponse = await api.fetchSuggestions({
    principal,
    request: { scope: { type: "queue", queue_id: "expert-review" } }
  });
  assert.equal(suggestionsResponse.authorization_filtered, true);
  assert.equal("filtered_count" in suggestionsResponse, false);
  assert.equal(suggestionsResponse.visible_count, 2);
  assertRequiredSuggestionFields(suggestionsResponse.suggestions);

  const workspace = renderAiSuggestionWorkspace({ suggestionsResponse });
  assert.equal(workspace.suggestions.hidden_count, null);
  assert.equal("filtered_count" in workspace.suggestions, false);
  assert.ok(workspace.suggestions.cards.every((card) => card.semantic_state.visual_state === "ai_suggestion_distinct"));
  assert.ok(workspace.suggestions.cards.every((card) => card.semantic_state.approved === false && card.semantic_state.released === false));
  const lowCard = renderSuggestionCard(suggestionsResponse.suggestions.find((suggestion) => suggestion.suggestion_id === lowConfidenceProposal.ai_suggestion.suggestion_id));
  assert.equal(lowCard.routing.display_queue, "expert-review");
  assert.equal(lowCard.routing.requires_expert_review, true);
  assert.equal(lowCard.model.calibration.metrics_source, "phase6-calibration-eval-fixture");
  assert.equal(lowCard.model.calibration.sample_size, 240);
  const duplicateCard = renderSuggestionCard(suggestionsResponse.suggestions.find((suggestion) => suggestion.suggestion_id === duplicateProposal.ai_suggestion.suggestion_id));
  assert.equal(duplicateCard.duplicate.flagged, true);
  assert.equal(duplicateCard.duplicate.merged, false);

  const feedbackResponse = await api.submitFeedback({
    principal: actors.expert,
    request: {
      suggestion_id: lowConfidenceProposal.ai_suggestion.suggestion_id,
      action: "revise",
      rationale: "Expert review accepts the evidence but revises the target wording before approval.",
      candidate: suggestionsResponse.suggestions.find((suggestion) => suggestion.suggestion_id === lowConfidenceProposal.ai_suggestion.suggestion_id),
      revision: { candidate_label: "Aspirin mention maps to CHEMBL aspirin with reviewed wording." }
    }
  });
  const workspaceWithFeedback = renderAiSuggestionWorkspace({ suggestionsResponse, feedbackResponse });
  assert.equal(workspaceWithFeedback.feedback.approval_state.approved, false);
  assert.equal(workspaceWithFeedback.feedback.approval_state.released, false);
  assert.equal(workflow.suggestionFeedbackFor(lowConfidenceProposal.proposal_id).length, 1);
  assert.equal(workflow.getProposal(lowConfidenceProposal.proposal_id).state, "approver-decision");

  const approved = workflow.approveProposal({
    proposalId: lowConfidenceProposal.proposal_id,
    actor: actors.approver,
    rationale: "Human governance approval after expert feedback proof.",
    correlation_id: "corr:p6:e2e:approve:with-proof"
  }).proposal;
  assert.equal(approved.state, "approved");
  assert.match(approved.governed_decision.human_governance_proof_id, /^feedback:ai-suggestion:/);
  assert.match(approved.governed_decision.human_governance_proof_digest, /^sha256:/);

  const staged = workflow.stageForRelease({
    proposalId: lowConfidenceProposal.proposal_id,
    actor: actors.releaseManager,
    rationale: "Attempt staging only after human proof; release manager must still block RC assembly.",
    correlation_id: "corr:p6:e2e:stage:with-proof",
    release_id: "release-p6-e2e"
  });
  assert.equal(staged.proposal.state, "staged-for-release");
  assert.equal(staged.proposal.assertion_type, "model_suggested");

  const releaseManager = new ReleaseManagerService({
    manifestRoot: mkdtempSync(join(tmpdir(), "pharmaops-p6-release-block-")),
    auditStore: memoryReleaseAuditStore(),
    clock: fixedClock
  });
  await assert.rejects(
    () => releaseManager.createReleaseCandidateFromStaging({
      proposalWorkflowService: workflow,
      resolveStagedItem: (entry) => workflow.getProposal(entry.proposal_id),
      tenant_id: "tenant-a",
      environment: "validation",
      release_id: "release-p6-e2e",
      release_candidate_id: "rc:p6-e2e",
      previous_release_id: "release-p6-prev",
      rollback_target_release_id: "release-p6-prev",
      actor: actors.releaseManager,
      rationale: "Release candidate must reject model_suggested items.",
      correlation_id: "corr:p6:e2e:release-block",
      source_version_pins: [{ source_name: "ClinicalTrials.gov", source_version: "2026-06-01" }]
    }),
    /model_suggested items cannot enter release candidate/
  );
  assert.deepEqual(readdirSync(releaseManager.manifestRoot), []);

  const search = createSearchIndexService({ documents: suggestionsResponse.suggestions, clock: fixedClock });
  const workingSearch = search.search({
    principal,
    query: { q: "aspirin", filters: { assertion_type: ["model_suggested"] } }
  });
  assert.equal(workingSearch.authorization_filtered, true);
  assert.equal("filtered_count" in workingSearch, false);
  assert.ok(workingSearch.results.length >= 1);
  assert.ok(workingSearch.results.every((result) => result.assertion_type === "model_suggested"));
  assert.equal(workingSearch.facets.assertion_type[0].value, "model_suggested");

  const releasedSearch = search.search({
    principal: { ...principal, allowed_release_ids: ["release-p6-e2e"], release_id: "release-p6-e2e" },
    query: { q: "aspirin", release_context: { release_id: "release-p6-e2e", scope: "release" } }
  });
  assert.equal(releasedSearch.total, 0);
  assert.deepEqual(releasedSearch.results, []);
  assert.equal("filtered_count" in releasedSearch, false);
});

test("P6-P0: non-causal FAERS/openFDA suggestions should pass API/UI with disclaimers intact", async () => {
  const engine = new AiCurationEngine({
    model: model(),
    calibration: calibrationFixture,
    clock: fixedClock
  });
  const faersSuggestion = buildCandidates(engine).find((candidate) => candidate.safety.faers_context === true);
  assert.equal(faersSuggestion.safety.causality_allowed, false);
  assert.ok(faersSuggestion.evidence_refs[0].disclaimer_ids.includes("source_limit:faers_non_causal"));
  assert.ok(faersSuggestion.evidence_refs[0].source_limitations.some((value) => value.includes("non-causal")));

  const api = createPhase6AiCurationApi({
    clock: fixedClock,
    idFactory: sequenceIds("api-faers"),
    async resolveSuggestions() {
      return [faersSuggestion];
    },
    async authorizeFeedback() {
      return { decision: "allow", decision_id: "decision:faers" };
    },
    async enforceNoAutoRelease() {
      return { allowed: true, gate_id: "gate:no-auto-release" };
    },
    async recordSuggestionFeedback() {
      return { workflow_event_id: "workflow:faers", queue: "curation_review", state: "feedback_captured" };
    }
  });

  const response = await api.fetchSuggestions({
    principal,
    request: { scope: { type: "queue", queue_id: "curation_review" } }
  });
  assert.equal(response.visible_count, 1);
  const card = renderSuggestionCard(response.suggestions[0]);
  assert.equal(card.safety.faers_context, true);
  assert.equal(card.safety.causality_allowed, false);
  assert.match(card.safety.causal_claim_warning, /non-causal/);
});

function buildCandidates(engine) {
  const entityLink = engine.suggestEntityLinks({
    tenant_id: "tenant-a",
    environment: "validation",
    mention: {
      ...ctgovSource(),
      mention_id: "mention:aspirin-low-confidence",
      text: "Aspirin",
      entity_class: "compound",
      start_offset: 10,
      end_offset: 17,
      evidence_refs: [ctgovEvidence()]
    },
    candidates: [{
      canonical_id: "pharment:compound/aspirin",
      label: "Aspirin",
      score: 0.52,
      evidence_refs: [ctgovEvidence()]
    }]
  })[0];
  const faersRelationship = engine.suggestRelationships({
    tenant_id: "tenant-a",
    environment: "validation",
    relationships: [{
      ...faersSource(),
      subject_id: "pharment:compound/aspirin",
      predicate: "pharm:associatedWithAdverseEvent",
      object_id: "pharment:adverse-event/bleeding",
      relationship_type: "safety_signal_association",
      claim_type: "association",
      text: "FAERS reports include aspirin and bleeding co-reports.",
      start_offset: 4,
      end_offset: 57,
      score: 0.81,
      evidence_refs: [faersEvidence()]
    }]
  })[0];
  const duplicate = engine.suggestDuplicates({
    tenant_id: "tenant-a",
    environment: "validation",
    duplicate_pairs: [{
      ...ctgovSource(),
      entity_id: "pharment:compound/asa",
      duplicate_entity_id: "pharment:compound/aspirin",
      text: "ASA and Aspirin labels refer to the same compound in the source.",
      start_offset: 22,
      end_offset: 85,
      score: 0.73,
      evidence_refs: [ctgovEvidence()]
    }]
  })[0];
  return [entityLink, faersRelationship, duplicate];
}

function assertRequiredSuggestionFields(suggestions) {
  assert.ok(suggestions.length > 0);
  for (const suggestion of suggestions) {
    assert.equal(suggestion.assertion_type, "model_suggested");
    assert.equal(suggestion.release_id, null);
    for (const field of ["model_version", "score", "provenance_id", "duplicate_status"]) {
      assert.ok(suggestion[field] !== undefined && suggestion[field] !== null, `${field} missing`);
    }
    assert.ok("prompt_version" in suggestion);
    assert.ok(Array.isArray(suggestion.evidence_refs) && suggestion.evidence_refs.length > 0);
    assert.ok(Array.isArray(suggestion.source_spans) && suggestion.source_spans.length > 0);
    assert.equal(suggestion.calibration.metrics_source, "phase6-calibration-eval-fixture");
    assert.equal(suggestion.confidence.calibration.observed_accuracy, 0.81);
    assert.notEqual(suggestion.confidence_source, "fabricated");
  }
}

function model() {
  return {
    model_id: "p6-curation-baseline",
    model_version: "2026-06-27",
    prompt_version: "p6-ai-curation-v1",
    prompt_id: "prompt:p6-ai-curation",
    provider: "internal"
  };
}

function ctgovSource() {
  return {
    source_name: "ClinicalTrials.gov",
    source_version: "2026-06-01",
    source_record_id: "NCT-P6-E2E",
    source_record_uri: "https://clinicaltrials.gov/study/NCT-P6-E2E"
  };
}

function faersSource() {
  return {
    source_name: "openFDA FAERS",
    source_version: "2026Q1",
    source_record_id: "FAERS-P6-E2E",
    source_record_uri: "https://api.fda.gov/drug/event.json?search=FAERS-P6-E2E"
  };
}

function ctgovEvidence() {
  return {
    evidence_id: "pharmev:p6-ctgov-aspirin",
    evidence_role: "supports",
    source_name: "ClinicalTrials.gov",
    source_version: "2026-06-01",
    source_record_id: "NCT-P6-E2E"
  };
}

function faersEvidence() {
  return {
    evidence_id: "pharmev:p6-faers-bleeding",
    evidence_role: "supports",
    source_name: "openFDA FAERS",
    source_version: "2026Q1",
    source_record_id: "FAERS-P6-E2E"
  };
}

function fixedClock() {
  return new Date("2026-06-27T08:50:00.000Z");
}

function sequenceIds(prefix) {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

function passValidationPreview({ proposal }) {
  return {
    validation_report_id: `validation:${proposal.proposal_id}`,
    status: "passed",
    blocking: false,
    critical_failures: 0,
    findings: []
  };
}

function memoryReleaseAuditStore() {
  const events = [];
  return {
    async append(event) {
      events.push(Object.freeze({ ...event }));
      return events.at(-1);
    },
    list() {
      return [...events];
    }
  };
}
