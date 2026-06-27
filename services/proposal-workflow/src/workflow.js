import { randomUUID } from "node:crypto";

import { validationPreview as runValidationPreview } from "../../validation/src/index.js";
import { PROPOSAL_ACTIONS, ProposalAuthorizationError, assertCanGovernProposal } from "./authz.js";
import { GOVERNED_PROPOSAL_TRANSITION_BY_ACTION, ProposalGovernedTransitionAdapter } from "./governed-decisions.js";
import { sha256 } from "./hash.js";
import {
  MemoryAuditEventStore,
  MemoryProposalReleaseStagingStore,
  MemoryProposalStore,
  MemoryReviewQueueStore,
  MemorySuggestionFeedbackStore
} from "./stores.js";

export const PROPOSAL_TYPES = Object.freeze(["synonym", "mapping", "relationship", "evidence-link"]);

export const PROPOSAL_STATES = Object.freeze([
  "submitted",
  "validation",
  "curator-review",
  "approver-decision",
  "approved",
  "rejected",
  "staged-for-release"
]);

export const PROPOSAL_TRANSITIONS = Object.freeze([
  Object.freeze({ from: null, to: "submitted", action: PROPOSAL_ACTIONS.submit, roles: ["contributor", "curator"] }),
  Object.freeze({ from: "submitted", to: "validation", action: PROPOSAL_ACTIONS.validate, roles: ["curator"] }),
  Object.freeze({ from: "validation", to: "curator-review", action: PROPOSAL_ACTIONS.routeToCurator, roles: ["curator"] }),
  Object.freeze({ from: "curator-review", to: "approver-decision", action: PROPOSAL_ACTIONS.routeToApprover, roles: ["curator"] }),
  Object.freeze({ from: "approver-decision", to: "approved", action: PROPOSAL_ACTIONS.approve, roles: ["domain_approver"] }),
  Object.freeze({ from: "approver-decision", to: "rejected", action: PROPOSAL_ACTIONS.reject, roles: ["domain_approver"] }),
  Object.freeze({ from: "approved", to: "staged-for-release", action: PROPOSAL_ACTIONS.stageRelease, roles: ["release_manager"] })
]);

const QUEUE_BY_STATE = Object.freeze({
  "curator-review": "curator-review",
  "approver-decision": "approver-decision",
  approved: "release-staging"
});

export const AI_SUGGESTION_FEEDBACK_DECISIONS = Object.freeze(["accept", "reject", "revise"]);

const DEFAULT_EXPERT_REVIEW_POLICY = Object.freeze({
  policy_id: "policy:ai-suggestion-low-confidence-v1",
  low_confidence_threshold: 0.6,
  queue: "expert-review"
});

export class ProposalWorkflowService {
  constructor({
    proposalStore = new MemoryProposalStore(),
    queueStore = new MemoryReviewQueueStore(),
    auditStore = new MemoryAuditEventStore(),
    feedbackStore = new MemorySuggestionFeedbackStore(),
    stagingStore = new MemoryProposalReleaseStagingStore(),
    authorizer = assertCanGovernProposal,
    governedTransitions = null,
    validationPreview = defaultValidationPreview,
    diffPreview = null,
    mappingRegistry = null,
    governedDecisionSigner = undefined,
    decisionTtlMs = undefined,
    expertReviewPolicy = DEFAULT_EXPERT_REVIEW_POLICY,
    clock = () => new Date(),
    idFactory = randomUUID
  } = {}) {
    this.proposalStore = proposalStore;
    this.queueStore = queueStore;
    this.auditStore = auditStore;
    this.feedbackStore = feedbackStore;
    this.stagingStore = stagingStore;
    this.authorizer = authorizer;
    this.validationPreview = validationPreview;
    this.diffPreview = diffPreview ?? mappingRegistry?.diffPreview?.bind(mappingRegistry) ?? defaultDiffPreview;
    this.expertReviewPolicy = normalizeExpertReviewPolicy(expertReviewPolicy);
    this.clock = clock;
    this.idFactory = idFactory;
    this.governedTransitions = governedTransitions ?? new ProposalGovernedTransitionAdapter({
      proposalStore,
      clock,
      idFactory,
      governedDecisionSigner,
      decisionTtlMs
    });
  }

  submitProposal({ proposal, actor, rationale, correlation_id }) {
    assertProposalShape(proposal);
    const tenant_id = proposal.tenant_id;
    const environment = proposal.environment;
    const decision = this.authorizer({
      actor,
      proposal: null,
      action: PROPOSAL_ACTIONS.submit,
      tenant_id,
      environment,
      rationale,
      correlation_id
    });
    const now = this.clock().toISOString();
    const submitted = this.proposalStore.put({
      ...proposal,
      proposal_id: proposal.proposal_id ?? `proposal:${this.idFactory()}`,
      proposal_key: proposal.proposal_key ?? null,
      state: "submitted",
      submitted_by_user_id: actor.user_id,
      submitted_by_role_key: decision.actor_role_key,
      submitted_at: now,
      validation_result: proposal.validation_result ?? null,
      diff: this.diffPreview({ proposal, actor, correlation_id }),
      release_id: null,
      created_at: proposal.created_at ?? now,
      updated_at: now
    });
    const auditEvent = this.auditStore.append(this.auditEvent({
      proposal: submitted,
      actor,
      action: PROPOSAL_ACTIONS.submit,
      rationale,
      correlation_id,
      before: null,
      after: submitted,
      decision: "allowed",
      actorRoleKey: decision.actor_role_key,
      auditEventType: decision.audit_event_type
    }));
    return { proposal: submitted, audit_event: auditEvent, decision };
  }

  submitAiSuggestion({ suggestion, actor, rationale, correlation_id }) {
    const proposal = normalizeAiSuggestion(suggestion, rationale);
    assertAiSuggestionProposal(proposal);
    const auditActor = normalizeSuggestionActor(actor, proposal.tenant_id, proposal.environment);
    const now = this.clock().toISOString();
    const submitted = this.proposalStore.put({
      ...proposal,
      proposal_id: proposal.proposal_id ?? `proposal:${this.idFactory()}`,
      proposal_key: proposal.proposal_key ?? proposal.ai_suggestion.suggestion_id ?? null,
      assertion_type: "model_suggested",
      state: "submitted",
      submitted_by_user_id: auditActor.user_id,
      submitted_by_role_key: auditActor.role_keys[0],
      submitted_at: now,
      validation_result: proposal.validation_result ?? null,
      diff: this.diffPreview({ proposal, actor: auditActor, correlation_id }),
      release_id: null,
      created_at: proposal.created_at ?? now,
      updated_at: now
    });
    const auditEvent = this.auditStore.append(this.auditEvent({
      proposal: submitted,
      actor: auditActor,
      action: "proposal.ai_suggestion.submit",
      rationale,
      correlation_id,
      before: null,
      after: submitted,
      decision: "allowed",
      actorRoleKey: auditActor.role_keys[0],
      auditEventType: "ai_suggestion_submitted",
      eventPayload: {
        suggestion_id: submitted.ai_suggestion.suggestion_id,
        model_name: submitted.ai_suggestion.model_name,
        model_version: submitted.ai_suggestion.model_version,
        confidence_score: submitted.confidence_score,
        confidence_band: submitted.confidence_band,
        duplicate_status: submitted.ai_suggestion.duplicate_status
      }
    }));
    return {
      proposal: submitted,
      audit_event: auditEvent,
      decision: {
        allowed: true,
        action: "proposal.ai_suggestion.submit",
        actor_user_id: auditActor.user_id,
        actor_role_key: auditActor.role_keys[0],
        tenant_id: submitted.tenant_id,
        environment: submitted.environment,
        proposal_id: submitted.proposal_id,
        proposal_type: submitted.proposal_type,
        audit_event_type: "ai_suggestion_submitted"
      }
    };
  }

  ingestAiSuggestion(args) {
    return this.submitAiSuggestion(args);
  }

  validateProposal({ proposalId, actor, rationale, correlation_id }) {
    const before = this.proposalStore.get(proposalId);
    const decision = this.authorizeOrAuditDenied({
      proposal: before,
      actor,
      action: PROPOSAL_ACTIONS.validate,
      rationale,
      correlation_id
    });
    const validationResult = this.validationPreview({ proposal: before, actor, correlation_id, phase: "validation" });
    const auditEventId = this.nextAuditEventId();
    const after = this.proposalStore.applyWorkflowTransition({
      proposal: {
      ...before,
      state: "validation",
      validation_result: normalizedValidationResult(validationResult),
      updated_at: this.clock().toISOString()
      },
      audit_event_id: auditEventId,
      actor_user_id: decision.actor_user_id,
      actor_role_key: decision.actor_role_key,
      action: PROPOSAL_ACTIONS.validate
    });
    const auditEvent = this.auditStore.append(this.auditEvent({
      auditEventId,
      proposal: after,
      actor,
      action: PROPOSAL_ACTIONS.validate,
      rationale,
      correlation_id,
      before,
      after,
      decision: "allowed",
      actorRoleKey: decision.actor_role_key,
      auditEventType: decision.audit_event_type,
      validationResult: after.validation_result
    }));
    return { proposal: after, validation_result: after.validation_result, audit_event: auditEvent, decision };
  }

  routeProposal({ proposalId, actor, rationale, correlation_id }) {
    const validatedBefore = this.refreshValidation({
      proposalId,
      actor,
      correlation_id,
      phase: "route"
    });
    const decision = this.authorizeOrAuditDenied({
      proposal: validatedBefore,
      actor,
      action: PROPOSAL_ACTIONS.routeToCurator,
      rationale,
      correlation_id
    });
    const auditEventId = this.nextAuditEventId();
    const reviewRouting = reviewRoutingForProposal(validatedBefore, this.expertReviewPolicy);
    const after = this.proposalStore.applyWorkflowTransition({
      proposal: {
      ...validatedBefore,
      state: "curator-review",
      review_queue: reviewRouting.queue,
      review_routing_policy_id: reviewRouting.policy_id,
      review_routing_reason: reviewRouting.reason,
      requires_expert_review: reviewRouting.requires_expert_review,
      updated_at: this.clock().toISOString()
      },
      audit_event_id: auditEventId,
      actor_user_id: decision.actor_user_id,
      actor_role_key: decision.actor_role_key,
      action: PROPOSAL_ACTIONS.routeToCurator
    });
    const queue_item = this.openQueueItem({
      proposal: after,
      queue: reviewRouting.queue,
      actor,
      correlation_id,
      routing: reviewRouting
    });
    const auditEvent = this.auditStore.append(this.auditEvent({
      auditEventId,
      proposal: after,
      actor,
      action: PROPOSAL_ACTIONS.routeToCurator,
      rationale,
      correlation_id,
      before: validatedBefore,
      after,
      decision: "allowed",
      actorRoleKey: decision.actor_role_key,
      auditEventType: reviewRouting.requires_expert_review ? "proposal_routed_expert_review" : decision.audit_event_type,
      validationResult: after.validation_result
    }));
    return { proposal: after, queue_item, audit_event: auditEvent, decision };
  }

  routeForDecision({ proposalId, actor, rationale, correlation_id }) {
    const before = this.proposalStore.get(proposalId);
    const decision = this.authorizeOrAuditDenied({
      proposal: before,
      actor,
      action: PROPOSAL_ACTIONS.routeToApprover,
      rationale,
      correlation_id
    });
    const auditEventId = this.nextAuditEventId();
    const after = this.proposalStore.applyWorkflowTransition({
      proposal: {
      ...before,
      state: "approver-decision",
      review_queue: "approver-decision",
      updated_at: this.clock().toISOString()
      },
      audit_event_id: auditEventId,
      actor_user_id: decision.actor_user_id,
      actor_role_key: decision.actor_role_key,
      action: PROPOSAL_ACTIONS.routeToApprover
    });
    const queue_item = this.openQueueItem({ proposal: after, queue: "approver-decision", actor, correlation_id });
    const auditEvent = this.auditStore.append(this.auditEvent({
      auditEventId,
      proposal: after,
      actor,
      action: PROPOSAL_ACTIONS.routeToApprover,
      rationale,
      correlation_id,
      before,
      after,
      decision: "allowed",
      actorRoleKey: decision.actor_role_key,
      auditEventType: decision.audit_event_type
    }));
    return { proposal: after, queue_item, audit_event: auditEvent, decision };
  }

  approveProposal({ proposalId, actor, rationale, correlation_id }) {
    return this.governedTransition({
      proposalId,
      actor,
      action: PROPOSAL_ACTIONS.approve,
      rationale,
      correlation_id,
      transition: GOVERNED_PROPOSAL_TRANSITION_BY_ACTION[PROPOSAL_ACTIONS.approve]
    });
  }

  rejectProposal({ proposalId, actor, rationale, correlation_id }) {
    return this.governedTransition({
      proposalId,
      actor,
      action: PROPOSAL_ACTIONS.reject,
      rationale,
      correlation_id,
      transition: GOVERNED_PROPOSAL_TRANSITION_BY_ACTION[PROPOSAL_ACTIONS.reject]
    });
  }

  stageForRelease({ proposalId, actor, rationale, correlation_id, release_id }) {
    const refreshedBefore = this.refreshValidation({
      proposalId,
      actor,
      correlation_id,
      phase: "stage_release"
    });
    const result = this.governedTransition({
      proposalId: refreshedBefore.proposal_id,
      proposal: refreshedBefore,
      actor,
      action: PROPOSAL_ACTIONS.stageRelease,
      rationale,
      correlation_id,
      release_id,
      transition: GOVERNED_PROPOSAL_TRANSITION_BY_ACTION[PROPOSAL_ACTIONS.stageRelease]
    });
    const staging = this.stagingStore.stage({
      staging_id: `proposal-stage:${this.idFactory()}`,
      proposal_id: result.proposal.proposal_id,
      proposal_type: result.proposal.proposal_type,
      tenant_id: result.proposal.tenant_id,
      environment: result.proposal.environment,
      release_id,
      staged_by_user_id: result.decision.actor_user_id,
      staged_by_role_key: result.decision.actor_role_key,
      staged_at: result.audit_event.occurred_at,
      audit_event_id: result.audit_event.audit_event_id,
      payload_hash: sha256(result.proposal.payload),
      validation_report_id: result.proposal.validation_result?.validation_report_id ?? null
    });
    return { ...result, staging };
  }

  governedTransition({ proposalId, proposal = null, actor, action, rationale, correlation_id, transition, release_id = null }) {
    const before = proposal ?? this.proposalStore.get(proposalId);
    const decision = this.authorizeOrAuditDenied({
      proposal: before,
      actor,
      action,
      rationale,
      correlation_id,
      release_id
    });
    const auditEventId = this.nextAuditEventId();
    const governed = this.governedTransitions.applyGovernedTransition({
      proposalId,
      proposal: before,
      transition,
      authorizationDecision: decision,
      auditContext: {
        actor_user_id: decision.actor_user_id,
        rationale,
        correlation_id,
        release_id,
        audit_event_id: auditEventId
      }
    });
    const after = governed.proposal;
    const auditEvent = this.auditStore.append(this.auditEvent({
      auditEventId,
      proposal: after,
      actor,
      action,
      rationale,
      correlation_id,
      before,
      after,
      decision: "allowed",
      actorRoleKey: decision.actor_role_key,
      release_id,
      auditEventType: decision.audit_event_type,
      governedDecision: governed.governed_decision
    }));
    return { proposal: after, audit_event: auditEvent, decision, governed_decision: governed.governed_decision };
  }

  queryReviewQueue(filters = {}) {
    return this.queueStore.list(filters);
  }

  getProposal(proposalId) {
    return this.proposalStore.get(proposalId);
  }

  auditFor(proposalId) {
    return this.auditStore.forProposal(proposalId);
  }

  stagedEntries(filters = {}) {
    return this.stagingStore.list(filters);
  }

  suggestionFeedbackFor(proposalId) {
    return this.feedbackStore.forProposal(proposalId);
  }

  recordSuggestionFeedback({ proposalId, actor, feedback, rationale, correlation_id }) {
    const before = this.proposalStore.get(proposalId);
    assertModelSuggestedProposal(before);
    const reviewer = normalizeFeedbackActor(actor, before.tenant_id, before.environment);
    const normalizedFeedback = normalizeSuggestionFeedback(feedback);
    const auditEventId = this.nextAuditEventId();
    const now = this.clock().toISOString();
    const feedbackRecord = this.feedbackStore.append({
      feedback_id: `feedback:ai-suggestion:${this.idFactory()}`,
      proposal_id: before.proposal_id,
      proposal_type: before.proposal_type,
      tenant_id: before.tenant_id,
      environment: before.environment,
      suggestion_id: before.ai_suggestion?.suggestion_id ?? null,
      assertion_type: "model_suggested",
      reviewer_user_id: reviewer.user_id,
      reviewer_role_key: reviewer.role_keys[0],
      decision: normalizedFeedback.decision,
      revision: normalizedFeedback.revision,
      rationale,
      correlation_id,
      audit_event_id: auditEventId,
      occurred_at: now,
      proposal_payload_hash: sha256(before.payload),
      revision_hash: normalizedFeedback.revision ? sha256(normalizedFeedback.revision) : null
    });
    const auditEvent = this.auditStore.append(this.auditEvent({
      auditEventId,
      proposal: before,
      actor: reviewer,
      action: "proposal.ai_feedback.record",
      rationale,
      correlation_id,
      before,
      after: before,
      decision: "allowed",
      actorRoleKey: reviewer.role_keys[0],
      auditEventType: "ai_suggestion_feedback_recorded",
      eventPayload: {
        feedback_id: feedbackRecord.feedback_id,
        feedback_decision: feedbackRecord.decision,
        has_revision: Boolean(feedbackRecord.revision),
        revision_hash: feedbackRecord.revision_hash
      }
    }));
    return { feedback: feedbackRecord, audit_event: auditEvent, proposal: before };
  }

  refreshValidation({ proposalId, actor, correlation_id, phase }) {
    const before = this.proposalStore.get(proposalId);
    const validationResult = normalizedValidationResult(this.validationPreview({ proposal: before, actor, correlation_id, phase }));
    return {
      ...before,
      validation_result: validationResult,
      updated_at: this.clock().toISOString()
    };
  }

  openQueueItem({ proposal, queue, actor, correlation_id, routing = null }) {
    const priority = priorityForProposal(proposal);
    return this.queueStore.upsert({
      queue_item_id: `queue:${queue}:${proposal.proposal_id}`,
      tenant_id: proposal.tenant_id,
      environment: proposal.environment,
      queue,
      proposal_id: proposal.proposal_id,
      proposal_type: proposal.proposal_type,
      state: proposal.state,
      confidence_band: proposal.confidence_band ?? "unknown",
      priority,
      risk_level: riskForProposal(proposal),
      requires_expert_review: routing?.requires_expert_review ?? false,
      routing_reason: routing?.reason ?? null,
      routing_policy_id: routing?.policy_id ?? null,
      status: "open",
      assigned_to_user_id: null,
      created_by_user_id: actor.user_id,
      correlation_id,
      created_at: this.clock().toISOString(),
      updated_at: this.clock().toISOString()
    });
  }

  authorizeOrAuditDenied({ proposal, actor, action, rationale, correlation_id, release_id = null }) {
    try {
      const decision = this.authorizer({
        actor,
        proposal,
        action,
        tenant_id: proposal.tenant_id,
        environment: proposal.environment,
        rationale,
        correlation_id,
        release_id
      });
      return this.attachModelSuggestionGovernanceProof({ proposal, action, decision });
    } catch (error) {
      this.auditStore.append(this.auditEvent({
        proposal,
        actor,
        action,
        rationale,
        correlation_id,
        before: proposal,
        after: proposal,
        decision: "denied",
        actorRoleKey: actor?.role_keys?.[0] ?? null,
        release_id,
        auditEventType: "proposal_action_denied"
      }));
      throw error;
    }
  }

  attachModelSuggestionGovernanceProof({ proposal, action, decision }) {
    if (!isModelSuggestedProposal(proposal) || ![PROPOSAL_ACTIONS.approve, PROPOSAL_ACTIONS.stageRelease].includes(action)) {
      return decision;
    }
    if (action === PROPOSAL_ACTIONS.stageRelease) {
      assertPriorModelSuggestionApproval(proposal);
    }
    const proof = this.humanGovernanceProofForModelSuggestion(proposal);
    return {
      ...decision,
      human_governance_required: true,
      human_governance_proof_id: proof.feedback_id,
      human_governance_proof_digest: sha256(proof),
      human_governance_proof: proof
    };
  }

  humanGovernanceProofForModelSuggestion(proposal) {
    const payloadHash = sha256(proposal.payload);
    const proof = this.feedbackStore.forProposal(proposal.proposal_id)
      .filter((feedback) => feedback.tenant_id === proposal.tenant_id)
      .filter((feedback) => feedback.environment === proposal.environment)
      .filter((feedback) => feedback.assertion_type === "model_suggested")
      .filter((feedback) => ["accept", "revise"].includes(feedback.decision))
      .find((feedback) =>
        feedback.audit_event_id &&
        feedback.proposal_payload_hash === payloadHash &&
        ["curator", "domain_approver", "expert_reviewer"].includes(feedback.reviewer_role_key)
      );
    if (!proof) {
      throw new ProposalAuthorizationError("model_suggested approval or staging requires human governance feedback proof");
    }
    return {
      feedback_id: proof.feedback_id,
      audit_event_id: proof.audit_event_id,
      decision: proof.decision,
      reviewer_user_id: proof.reviewer_user_id,
      reviewer_role_key: proof.reviewer_role_key,
      tenant_id: proof.tenant_id,
      environment: proof.environment,
      proposal_id: proof.proposal_id,
      suggestion_id: proof.suggestion_id,
      proposal_payload_hash: proof.proposal_payload_hash,
      revision_hash: proof.revision_hash ?? null,
      occurred_at: proof.occurred_at
    };
  }

  auditEvent({
    auditEventId = null,
    proposal,
    actor,
    action,
    rationale,
    correlation_id,
    before,
    after,
    decision,
    actorRoleKey,
    release_id = null,
    auditEventType,
    validationResult = null,
    governedDecision = null,
    eventPayload = null
  }) {
    return {
      audit_event_id: auditEventId ?? this.nextAuditEventId(),
      event_type: auditEventType,
      tenant_id: proposal.tenant_id,
      environment: proposal.environment,
      actor_user_id: actor?.user_id ?? null,
      actor_role_key: actorRoleKey,
      action,
      proposal_id: proposal.proposal_id,
      proposal_type: proposal.proposal_type,
      previous_state: before?.state ?? null,
      next_state: after?.state ?? null,
      rationale,
      release_id,
      correlation_id,
      decision,
      validation_result: validationResult,
      governed_decision_id: governedDecision?.decision_id ?? null,
      event_payload: eventPayload,
      payload_hash: sha256(proposal.payload),
      before_hash: sha256(before),
      after_hash: sha256(after),
      occurred_at: this.clock().toISOString()
    };
  }

  nextAuditEventId() {
    return `audit:proposal:${this.idFactory()}`;
  }
}

function assertProposalShape(proposal) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new Error("proposal is required");
  }
  for (const field of ["tenant_id", "environment", "proposal_type", "payload", "provenance", "rationale"]) {
    if (!(field in proposal)) {
      throw new Error(`proposal.${field} is required`);
    }
  }
  if (!PROPOSAL_TYPES.includes(proposal.proposal_type)) {
    throw new Error(`unsupported proposal_type: ${proposal.proposal_type}`);
  }
  if (!proposal.payload || typeof proposal.payload !== "object" || Array.isArray(proposal.payload)) {
    throw new Error("proposal.payload must be an object");
  }
  if (!proposal.provenance || typeof proposal.provenance !== "object" || Array.isArray(proposal.provenance)) {
    throw new Error("proposal.provenance must be an object");
  }
}

function normalizeAiSuggestion(suggestion, rationale) {
  if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) {
    throw new Error("suggestion is required");
  }
  const ai = {
    suggestion_id: suggestion.suggestion_id ?? suggestion.ai_suggestion?.suggestion_id ?? null,
    model_name: suggestion.model_name ?? suggestion.ai_suggestion?.model_name ?? suggestion.provenance?.model_name ?? null,
    model_version: suggestion.model_version ?? suggestion.ai_suggestion?.model_version ?? suggestion.provenance?.model_version ?? null,
    source_spans: suggestion.source_spans ?? suggestion.ai_suggestion?.source_spans ?? suggestion.provenance?.source_spans ?? null,
    duplicate_status: suggestion.duplicate_status ?? suggestion.ai_suggestion?.duplicate_status ?? null,
    score: suggestion.score ?? suggestion.confidence_score ?? suggestion.ai_suggestion?.score ?? null,
    calibration_id: suggestion.calibration_id ?? suggestion.ai_suggestion?.calibration_id ?? null
  };
  return {
    ...suggestion,
    rationale: suggestion.rationale ?? rationale,
    assertion_type: "model_suggested",
    payload: {
      ...suggestion.payload,
      assertion_type: "model_suggested"
    },
    confidence_score: suggestion.confidence_score ?? suggestion.score ?? suggestion.ai_suggestion?.score,
    confidence_band: suggestion.confidence_band ?? confidenceBandForScore(suggestion.confidence_score ?? suggestion.score ?? suggestion.ai_suggestion?.score),
    confidence_source: suggestion.confidence_source ?? "model_calibrated_score",
    ai_suggestion: ai
  };
}

function assertAiSuggestionProposal(proposal) {
  assertProposalShape(proposal);
  assertModelSuggestedProposal(proposal);
  assertNumberInRange(proposal.confidence_score, "confidence_score");
  assertNonEmpty(proposal.confidence_source, "confidence_source");
  assertEvidenceRefs(proposal);
  assertSourceSpans(proposal.ai_suggestion?.source_spans);
  assertNonEmpty(proposal.ai_suggestion?.suggestion_id, "ai_suggestion.suggestion_id");
  assertNonEmpty(proposal.ai_suggestion?.model_name, "ai_suggestion.model_name");
  assertNonEmpty(proposal.ai_suggestion?.model_version, "ai_suggestion.model_version");
  assertNonEmpty(proposal.ai_suggestion?.duplicate_status, "ai_suggestion.duplicate_status");
  if (!["not_duplicate", "possible_duplicate", "duplicate", "not_evaluated"].includes(proposal.ai_suggestion.duplicate_status)) {
    throw new Error("ai_suggestion.duplicate_status is unsupported");
  }
}

function assertModelSuggestedProposal(proposal) {
  if (proposal.assertion_type !== "model_suggested" || proposal.payload?.assertion_type !== "model_suggested") {
    throw new Error("AI suggestion must remain assertion_type=model_suggested");
  }
}

function assertEvidenceRefs(proposal) {
  const evidenceRefs = proposal.payload?.evidence_refs ?? proposal.evidence_refs ?? proposal.provenance?.evidence_refs;
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    throw new Error("AI suggestion evidence_refs are required");
  }
  for (const ref of evidenceRefs) {
    assertNonEmpty(ref?.evidence_id, "evidence_ref.evidence_id");
  }
}

function assertSourceSpans(sourceSpans) {
  if (!Array.isArray(sourceSpans) || sourceSpans.length === 0) {
    throw new Error("AI suggestion source_spans are required");
  }
  for (const span of sourceSpans) {
    assertNonEmpty(span?.evidence_id, "source_span.evidence_id");
    if (typeof span.text !== "string" || span.text.length === 0) {
      throw new Error("source_span.text is required");
    }
  }
}

function normalizeSuggestionActor(actor, tenantId, environment) {
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
    throw new Error("actor required");
  }
  const userId = actor.user_id ?? actor.service_account_id;
  assertNonEmpty(userId, "actor.user_id");
  if (actor.tenant_id !== tenantId || actor.environment !== environment) {
    throw new Error("actor scope mismatch");
  }
  if (actor.principal_type === "service_account" || actor.service_account_id) {
    return {
      ...actor,
      user_id: userId,
      role_keys: ["ai_suggestion_ingest"]
    };
  }
  if (!Array.isArray(actor.role_keys) || !actor.role_keys.some((role) => ["contributor", "curator", "ai_suggestion_ingest"].includes(role))) {
    throw new Error("actor role denied for AI suggestion ingest");
  }
  return actor;
}

function normalizeFeedbackActor(actor, tenantId, environment) {
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
    throw new Error("actor required");
  }
  if (actor.principal_type === "service_account" || actor.service_account_id) {
    throw new Error("service accounts cannot record human suggestion feedback");
  }
  assertNonEmpty(actor.user_id, "actor.user_id");
  if (actor.tenant_id !== tenantId || actor.environment !== environment) {
    throw new Error("actor scope mismatch");
  }
  if (!Array.isArray(actor.role_keys) || !actor.role_keys.some((role) => ["curator", "domain_approver", "expert_reviewer"].includes(role))) {
    throw new Error("actor role denied for suggestion feedback");
  }
  return {
    ...actor,
    role_keys: [actor.role_keys.find((role) => ["expert_reviewer", "curator", "domain_approver"].includes(role))]
  };
}

function normalizeSuggestionFeedback(feedback) {
  if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)) {
    throw new Error("feedback is required");
  }
  if (!AI_SUGGESTION_FEEDBACK_DECISIONS.includes(feedback.decision)) {
    throw new Error("unsupported AI suggestion feedback decision");
  }
  if (feedback.decision === "revise" && (!feedback.revision || typeof feedback.revision !== "object" || Array.isArray(feedback.revision))) {
    throw new Error("revision is required for revise feedback");
  }
  return {
    decision: feedback.decision,
    revision: feedback.revision ?? null
  };
}

function normalizeExpertReviewPolicy(policy) {
  const value = policy && typeof policy === "object" && !Array.isArray(policy) ? policy : DEFAULT_EXPERT_REVIEW_POLICY;
  assertNumberInRange(value.low_confidence_threshold, "expertReviewPolicy.low_confidence_threshold");
  assertNonEmpty(value.policy_id, "expertReviewPolicy.policy_id");
  assertNonEmpty(value.queue, "expertReviewPolicy.queue");
  return {
    policy_id: value.policy_id,
    low_confidence_threshold: value.low_confidence_threshold,
    queue: value.queue
  };
}

function reviewRoutingForProposal(proposal, policy) {
  if (isModelSuggestedProposal(proposal) && proposal.confidence_score < policy.low_confidence_threshold) {
    return {
      queue: policy.queue,
      policy_id: policy.policy_id,
      reason: "model_suggested_low_confidence",
      requires_expert_review: true
    };
  }
  return {
    queue: "curator-review",
    policy_id: null,
    reason: null,
    requires_expert_review: false
  };
}

function isModelSuggestedProposal(proposal) {
  return proposal.assertion_type === "model_suggested" || proposal.payload?.assertion_type === "model_suggested";
}

function assertPriorModelSuggestionApproval(proposal) {
  const decision = proposal.governed_decision;
  if (
    !decision ||
    decision.action !== PROPOSAL_ACTIONS.approve ||
    decision.next_state !== "approved" ||
    !decision.human_governance_proof_id ||
    !decision.human_governance_proof_digest
  ) {
    throw new ProposalAuthorizationError("model_suggested staging requires prior signed human approval proof");
  }
}

function confidenceBandForScore(score) {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return "unknown";
  }
  if (score < 0.6) {
    return "low";
  }
  if (score < 0.85) {
    return "medium";
  }
  return "high";
}

function assertNumberInRange(value, fieldName) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`${fieldName} must be a real score from 0 to 1`);
  }
}

function assertNonEmpty(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
}

function normalizedValidationResult(result) {
  const normalized = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  const criticalFailures = normalized.critical_failures
    ?? normalized.summary?.critical
    ?? (normalized.blocking ? 1 : 0)
    ?? 0;
  return {
    status: normalizeValidationStatus(normalized.status, criticalFailures),
    critical_failures: criticalFailures,
    warnings: normalized.warnings ?? normalized.summary?.warning ?? 0,
    blocking: normalized.blocking ?? criticalFailures > 0,
    validation_report_id: normalized.validation_report_id ?? normalized.report_id ?? null,
    ruleset_version: normalized.ruleset_version ?? null,
    findings: normalized.findings ?? []
  };
}

function priorityForProposal(proposal) {
  if (proposal.validation_result?.critical_failures > 0) {
    return 10;
  }
  if (proposal.confidence_band === "low") {
    return 50;
  }
  return 100;
}

function riskForProposal(proposal) {
  if (proposal.validation_result?.critical_failures > 0) {
    return "critical";
  }
  if (proposal.proposal_type === "relationship" || proposal.confidence_band === "low") {
    return "high";
  }
  return "standard";
}

function defaultValidationPreview({ proposal, actor, correlation_id, phase }) {
  return runValidationPreview({ proposal, actor, correlation_id, phase });
}

function defaultDiffPreview({ proposal }) {
  return {
    diff_id: `diff:${proposal.proposal_id ?? sha256(proposal.payload).slice(7, 19)}`,
    before_hash: null,
    after_hash: sha256(proposal.payload),
    summary: "proposal payload captured for semantic diff computation"
  };
}

function normalizeValidationStatus(status, criticalFailures) {
  if (criticalFailures > 0) {
    return "failed";
  }
  if (status === "pass") {
    return "passed";
  }
  if (status === "fail") {
    return "failed";
  }
  return status ?? "passed";
}
