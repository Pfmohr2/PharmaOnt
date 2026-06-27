import { MAPPING_ACTIONS } from "./authz.js";
import {
  buildGovernedDecisionBinding,
  digestValue,
  mappingEvidenceDigest
} from "../../mapping-registry/src/index.js";

export const GOVERNED_TRANSITION_BY_ACTION = Object.freeze({
  [MAPPING_ACTIONS.approve]: "approve",
  [MAPPING_ACTIONS.reject]: "reject",
  [MAPPING_ACTIONS.stageRelease]: "stage_release"
});

const TRANSITION_STATE = Object.freeze({
  approve: Object.freeze({
    action: MAPPING_ACTIONS.approve,
    review_status: "approved",
    workflow_status: "approved",
    event_action: "mapping.governed.approve"
  }),
  reject: Object.freeze({
    action: MAPPING_ACTIONS.reject,
    review_status: "rejected",
    workflow_status: "rejected",
    event_action: "mapping.governed.reject"
  }),
  stage_release: Object.freeze({
    action: MAPPING_ACTIONS.stageRelease,
    review_status: "approved",
    workflow_status: "staged_for_release",
    event_action: "mapping.governed.stage_release"
  })
});

export class GovernedTransitionEntrypointError extends Error {
  constructor(message = "governed mapping transition entrypoint is required") {
    super(message);
    this.name = "GovernedTransitionEntrypointError";
  }
}

export class WorkflowGovernedTransitionAdapter {
  constructor({
    mappingRegistry = null,
    candidateStore,
    clock = () => new Date(),
    idFactory,
    governedDecisionSigner = defaultGovernedDecisionSigner,
    decisionTtlMs = 60_000
  }) {
    if (!candidateStore) {
      throw new GovernedTransitionEntrypointError("candidate store is required for governed transition adapter");
    }
    if (mappingRegistry && typeof mappingRegistry.applyGovernedTransition !== "function") {
      throw new GovernedTransitionEntrypointError("mapping registry must expose applyGovernedTransition");
    }
    this.mappingRegistry = mappingRegistry;
    this.candidateStore = candidateStore;
    this.clock = clock;
    this.idFactory = idFactory;
    this.governedDecisionSigner = governedDecisionSigner;
    this.decisionTtlMs = decisionTtlMs;
  }

  applyGovernedTransition({
    tenantId,
    mappingId,
    transition,
    authorizationDecision,
    auditContext = {}
  }) {
    const spec = TRANSITION_STATE[transition];
    assertDecision({ spec, tenantId, mappingId, authorizationDecision });
    const before = this.candidateStore.get(authorizationDecision.candidate_id);
    const registryRecordBefore = this.mappingRegistry?.getMapping?.({ tenantId, mappingId }) ?? null;
    const governedDecision = mintGovernedDecision({
      before,
      record: registryRecordBefore,
      spec,
      transition,
      authorizationDecision,
      auditContext,
      now: this.clock(),
      expiresAt: new Date(this.clock().getTime() + this.decisionTtlMs),
      idFactory: this.idFactory,
      signer: this.governedDecisionSigner
    });

    const registryRecord = this.mappingRegistry?.applyGovernedTransition({
      tenantId,
      mappingId,
      transition,
      authorizationContext: { governedDecision },
      auditContext: {
        ...auditContext,
        actor_user_id: governedDecision.actor_user_id
      }
    }) ?? null;

    const candidate = this.candidateStore.put(candidateProjection({
      before,
      registryRecord,
      spec,
      transition,
      authorizationDecision,
      rationale: auditContext.rationale ?? null,
      releaseId: auditContext.release_id ?? null,
      now: this.clock().toISOString()
    }));

    return Object.freeze({
      candidate,
      registry_record: registryRecord,
      governed_decision: governedDecision,
      registry_audit_event: registryAuditEvent({
        registryRecord,
        transition,
        governedDecision,
        idFactory: this.idFactory,
        now: this.clock().toISOString()
      })
    });
  }
}

function candidateProjection({
  before,
  registryRecord,
  spec,
  transition,
  authorizationDecision,
  rationale,
  releaseId,
  now
}) {
  const mapping = registryRecord?.mapping ?? {};
  const metadata = registryRecord?.registry_metadata ?? {};
  const nextReviewStatus = mapping.review_status ?? spec.review_status;
  const nextWorkflowStatus = metadata.workflow_status ?? spec.workflow_status;
  const stageRelease = transition === "stage_release";

  return {
    ...before,
    review_status: nextReviewStatus,
    workflow_status: nextWorkflowStatus,
    release_id: mapping.release_id ?? before.release_id ?? null,
    reviewed_by_user_id: stageRelease
      ? before.reviewed_by_user_id ?? null
      : mapping.reviewed_by ?? authorizationDecision.actor_user_id,
    reviewed_by_role_key: stageRelease
      ? before.reviewed_by_role_key ?? null
      : authorizationDecision.actor_role_key,
    review_rationale: stageRelease
      ? before.review_rationale ?? null
      : releaseSafeString(rationale) ?? before.review_rationale ?? null,
    staged_by_user_id: stageRelease ? authorizationDecision.actor_user_id : before.staged_by_user_id ?? null,
    staged_by_role_key: stageRelease ? authorizationDecision.actor_role_key : before.staged_by_role_key ?? null,
    stage_rationale: stageRelease
      ? releaseSafeString(rationale) ?? before.stage_rationale ?? null
      : before.stage_rationale ?? null,
    staged_release_id: stageRelease
      ? metadata.release_staging?.release_id ?? releaseId
      : before.staged_release_id ?? null,
    updated_at: metadata.updated_at ?? now
  };
}

function mintGovernedDecision({
  before,
  record,
  spec,
  transition,
  authorizationDecision,
  auditContext,
  now,
  expiresAt,
  idFactory,
  signer
}) {
  const value = {
    decision_id: `decision:mapping:${idFactory()}`,
    decision: "allow",
    action: authorizationDecision.action,
    actor_user_id: authorizationDecision.actor_user_id,
    actor_role_key: authorizationDecision.actor_role_key,
    tenant_id: authorizationDecision.tenant_id,
    environment: authorizationDecision.environment,
    candidate_id: authorizationDecision.candidate_id,
    mapping_id: before.mapping_id,
    previous_review_status: before.review_status,
    next_review_status: spec.review_status,
    release_id: transition === "stage_release" ? auditContext.release_id ?? null : null,
    rationale_digest: digestValue(auditContext.rationale ?? ""),
    evidence_digest: record ? mappingEvidenceDigest(record) : candidateEvidenceDigest(before),
    provenance_id: before.provenance_id,
    source_vocabulary_version: before.source_vocabulary_version,
    target_vocabulary_version: before.target_vocabulary_version,
    duplicate_status: before.duplicate_status ?? null,
    audit_event_id: `audit:mapping:${idFactory()}`,
    correlation_id: auditContext.correlation_id,
    issued_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    audit_event_type: authorizationDecision.audit_event_type
  };
  value.decision_binding = buildGovernedDecisionBinding(value);
  value.signature = signer({ decision: value, decision_binding: value.decision_binding });
  return value;
}

function candidateEvidenceDigest(candidate) {
  return digestValue({
    evidence_ids: candidate.evidence_ids ?? [],
    evidence_refs: candidate.evidence_refs ?? [],
    release_evidence_refs: candidate.release_evidence_refs ?? [],
    validation_report_refs: candidate.validation_report_refs ?? []
  });
}

function registryAuditEvent({ registryRecord, transition, governedDecision, idFactory, now }) {
  const auditIds = registryRecord?.registry_metadata?.governed_audit_event_ids ?? [];
  return Object.freeze({
    audit_event_id: auditIds.at(-1) ?? governedDecision.audit_event_id ?? `registry:mapping:${idFactory()}`,
    action: TRANSITION_STATE[transition].event_action,
    actor_user_id: governedDecision.actor_user_id,
    actor_role_key: governedDecision.actor_role_key,
    occurred_at: registryRecord?.registry_metadata?.updated_at ?? now
  });
}

function assertDecision({ spec, tenantId, mappingId, authorizationDecision }) {
  if (!spec) {
    throw new GovernedTransitionEntrypointError("unknown governed mapping transition");
  }
  if (!authorizationDecision || authorizationDecision.allowed !== true) {
    throw new GovernedTransitionEntrypointError("allowed authorization decision is required");
  }
  if (authorizationDecision.action !== spec.action) {
    throw new GovernedTransitionEntrypointError("authorization decision action mismatch");
  }
  if (authorizationDecision.tenant_id !== tenantId) {
    throw new GovernedTransitionEntrypointError("authorization decision tenant mismatch");
  }
  if (!authorizationDecision.candidate_id || !mappingId) {
    throw new GovernedTransitionEntrypointError("candidate and mapping identifiers are required");
  }
}

function releaseSafeString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function defaultGovernedDecisionSigner({ decision_binding }) {
  return decision_binding;
}
