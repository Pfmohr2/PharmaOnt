import { randomUUID } from "node:crypto";

import { MemoryAuditEventStore } from "./audit-store.js";
import { MAPPING_ACTIONS, assertCanGovernMappingCandidate } from "./authz.js";
import { GOVERNED_TRANSITION_BY_ACTION, WorkflowGovernedTransitionAdapter } from "./governed-transitions.js";
import { sha256 } from "./hash.js";
import { MemoryMappingCandidateStore, MemoryReleaseStagingStore } from "./stores.js";

export const REVIEW_STATUSES = Object.freeze(["proposed", "approved", "rejected"]);
export const WORKFLOW_STATUSES = Object.freeze(["queued_high_confidence", "explicit_curator_review", "duplicate_review", "approved", "rejected", "staged_for_release"]);

export const CONFIDENCE_REVIEW_POLICY = Object.freeze({
  high: Object.freeze({ queue: "standard_review", review_rigor: "single_curator_or_domain_approver" }),
  medium: Object.freeze({ queue: "enhanced_review", review_rigor: "curator_review_with_evidence_check" }),
  low: Object.freeze({ queue: "explicit_curator_review", review_rigor: "explicit_curator_review_required" }),
  blocked: Object.freeze({ queue: "blocked_governance_review", review_rigor: "cannot_approve_until_remediated" })
});

export class MappingWorkflowService {
  constructor({
    candidateStore = new MemoryMappingCandidateStore(),
    auditStore = new MemoryAuditEventStore(),
    stagingStore = new MemoryReleaseStagingStore(),
    authorizer = assertCanGovernMappingCandidate,
    mappingRegistry = null,
    governedTransitions = null,
    governedDecisionSigner = undefined,
    decisionTtlMs = undefined,
    clock = () => new Date(),
    idFactory = randomUUID
  } = {}) {
    this.candidateStore = candidateStore;
    this.auditStore = auditStore;
    this.stagingStore = stagingStore;
    this.authorizer = authorizer;
    this.governedTransitions = governedTransitions ?? new WorkflowGovernedTransitionAdapter({
      mappingRegistry,
      candidateStore,
      clock,
      idFactory,
      governedDecisionSigner,
      decisionTtlMs
    });
    this.clock = clock;
    this.idFactory = idFactory;
  }

  routeCandidate(candidateId) {
    const candidate = this.candidateStore.get(candidateId);
    const route = reviewRouteForCandidate(candidate);
    const updated = {
      ...candidate,
      review_queue: route.queue,
      review_rigor: route.review_rigor,
      workflow_status: candidate.duplicate_status && candidate.duplicate_status !== "not_duplicate"
        ? "duplicate_review"
        : route.queue === "explicit_curator_review" ? "explicit_curator_review" : "queued_high_confidence"
    };
    this.candidateStore.put(updated);
    return updated;
  }

  approve({ candidateId, actor, tenant_id, environment, rationale, correlation_id }) {
    return this.transition({
      candidateId,
      actor,
      action: MAPPING_ACTIONS.approve,
      tenant_id,
      environment,
      rationale,
      correlation_id,
      transition: GOVERNED_TRANSITION_BY_ACTION[MAPPING_ACTIONS.approve]
    });
  }

  reject({ candidateId, actor, tenant_id, environment, rationale, correlation_id }) {
    return this.transition({
      candidateId,
      actor,
      action: MAPPING_ACTIONS.reject,
      tenant_id,
      environment,
      rationale,
      correlation_id,
      transition: GOVERNED_TRANSITION_BY_ACTION[MAPPING_ACTIONS.reject]
    });
  }

  stageForRelease({ candidateId, actor, tenant_id, environment, rationale, correlation_id, release_id }) {
    const result = this.transition({
      candidateId,
      actor,
      action: MAPPING_ACTIONS.stageRelease,
      tenant_id,
      environment,
      rationale,
      correlation_id,
      release_id,
      transition: GOVERNED_TRANSITION_BY_ACTION[MAPPING_ACTIONS.stageRelease]
    });
    const staging = this.stagingStore.stage({
      staging_id: `mapping-stage:${this.idFactory()}`,
      candidate_id: result.candidate.candidate_id,
      mapping_id: result.candidate.mapping_id,
      tenant_id,
      environment,
      release_id,
      staged_by_user_id: result.decision.actor_user_id,
      staged_by_role_key: result.decision.actor_role_key,
      staged_at: result.audit_event.occurred_at,
      audit_event_id: result.audit_event.audit_event_id
    });
    return { ...result, staging };
  }

  transition({
    candidateId,
    actor,
    action,
    tenant_id,
    environment,
    rationale,
    correlation_id,
    release_id = null,
    transition
  }) {
    const before = this.candidateStore.get(candidateId);
    let decision;
    try {
      decision = this.authorizer({
        actor,
        candidate: before,
        action,
        tenant_id,
        environment,
        rationale,
        correlation_id,
        release_id
      });
    } catch (error) {
      this.auditStore.append(this.auditEvent({
        candidate: before,
        actor,
        action,
        rationale,
        correlation_id,
        before,
        after: before,
        decision: "denied",
        actorRoleKey: actor?.role_keys?.[0] ?? null,
        release_id,
        auditEventType: "mapping_candidate_denied"
      }));
      throw error;
    }

    const governedResult = this.governedTransitions.applyGovernedTransition({
      tenantId: tenant_id,
      mappingId: before.mapping_id,
      transition,
      authorizationDecision: decision,
      auditContext: {
        correlation_id,
        rationale,
        release_id
      }
    });
    const after = governedResult.candidate;
    const auditEvent = this.auditStore.append(this.auditEvent({
      candidate: after,
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
      registryAuditEvent: governedResult.registry_audit_event
    }));
    return {
      candidate: this.candidateStore.get(candidateId),
      audit_event: auditEvent,
      decision,
      registry_audit_event: governedResult.registry_audit_event,
      registry_record: governedResult.registry_record
    };
  }

  getCandidate(candidateId) {
    return this.candidateStore.get(candidateId);
  }

  auditFor(candidateId) {
    return this.auditStore.forCandidate(candidateId);
  }

  stagedEntries() {
    return this.stagingStore.list();
  }

  auditEvent({ candidate, actor, action, rationale, correlation_id, before, after, decision, actorRoleKey, release_id, auditEventType, registryAuditEvent = null }) {
    return {
      audit_event_id: `audit:mapping:${this.idFactory()}`,
      event_type: auditEventType,
      tenant_id: candidate.tenant_id,
      environment: candidate.environment,
      actor_user_id: actor?.user_id ?? null,
      actor_role_key: actorRoleKey,
      action,
      candidate_id: candidate.candidate_id,
      mapping_id: candidate.mapping_id,
      previous_review_status: before.review_status,
      next_review_status: after.review_status,
      previous_workflow_status: before.workflow_status ?? null,
      next_workflow_status: after.workflow_status ?? null,
      source_vocabulary_version: candidate.source_vocabulary_version,
      target_vocabulary_version: candidate.target_vocabulary_version,
      provenance_id: candidate.provenance_id,
      evidence_ids: [...(candidate.evidence_ids ?? [])],
      source_license_policy_id: candidate.source_license_policy_id,
      target_license_policy_id: candidate.target_license_policy_id,
      license_status: candidate.license_status,
      duplicate_status: candidate.duplicate_status ?? "unresolved",
      rationale,
      release_id,
      correlation_id,
      decision,
      registry_audit_event: registryAuditEvent,
      before_hash: sha256(before),
      after_hash: sha256(after),
      occurred_at: this.clock().toISOString()
    };
  }
}

export function reviewRouteForCandidate(candidate) {
  if (candidate.duplicate_status && candidate.duplicate_status !== "not_duplicate") {
    return { queue: "duplicate_review", review_rigor: "duplicate_resolution_required" };
  }
  return CONFIDENCE_REVIEW_POLICY[candidate.confidence_band] ?? CONFIDENCE_REVIEW_POLICY.blocked;
}
