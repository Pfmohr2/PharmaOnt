import { PROPOSAL_ACTIONS } from "./authz.js";
import { sha256 } from "./hash.js";

export const GOVERNED_PROPOSAL_TRANSITION_BY_ACTION = Object.freeze({
  [PROPOSAL_ACTIONS.approve]: "approve",
  [PROPOSAL_ACTIONS.reject]: "reject",
  [PROPOSAL_ACTIONS.stageRelease]: "stage_release"
});

const GOVERNED_TRANSITIONS = Object.freeze({
  approve: Object.freeze({
    action: PROPOSAL_ACTIONS.approve,
    next_state: "approved",
    event_type: "proposal_approved",
    roles: ["domain_approver"]
  }),
  reject: Object.freeze({
    action: PROPOSAL_ACTIONS.reject,
    next_state: "rejected",
    event_type: "proposal_rejected",
    roles: ["domain_approver"]
  }),
  stage_release: Object.freeze({
    action: PROPOSAL_ACTIONS.stageRelease,
    next_state: "staged-for-release",
    event_type: "proposal_staged_for_release",
    roles: ["release_manager"]
  })
});

export class ProposalGovernedTransitionError extends Error {
  constructor(message = "governed proposal transition denied") {
    super(message);
    this.name = "ProposalGovernedTransitionError";
  }
}

export class ProposalGovernedTransitionAdapter {
  constructor({
    proposalStore,
    clock = () => new Date(),
    idFactory,
    governedDecisionSigner = defaultGovernedDecisionSigner,
    decisionTtlMs = 60_000
  }) {
    if (!proposalStore) {
      throw new ProposalGovernedTransitionError("proposal store is required");
    }
    this.proposalStore = proposalStore;
    this.clock = clock;
    this.idFactory = idFactory;
    this.governedDecisionSigner = governedDecisionSigner;
    this.decisionTtlMs = decisionTtlMs;
    this.usedDecisionIds = new Set();
  }

  applyGovernedTransition({
    proposalId,
    proposal = null,
    transition,
    authorizationDecision,
    auditContext = {}
  }) {
    const spec = GOVERNED_TRANSITIONS[transition];
    const persistedBefore = this.proposalStore.get(proposalId);
    const before = proposal ?? persistedBefore;
    if (
      before.proposal_id !== persistedBefore.proposal_id ||
      before.state !== persistedBefore.state ||
      before.tenant_id !== persistedBefore.tenant_id ||
      before.environment !== persistedBefore.environment
    ) {
      throw new ProposalGovernedTransitionError("proposal override does not match persisted proposal");
    }
    assertAuthorizationDecision({ spec, before, authorizationDecision, auditContext, usedDecisionIds: this.usedDecisionIds });
    const governedDecision = mintGovernedDecision({
      before,
      spec,
      transition,
      authorizationDecision,
      auditContext,
      now: this.clock(),
      expiresAt: new Date(this.clock().getTime() + this.decisionTtlMs),
      idFactory: this.idFactory,
      signer: this.governedDecisionSigner
    });
    this.usedDecisionIds.add(governedDecision.decision_id);
    const after = this.proposalStore.applyGovernedTransition({
      proposal: {
      ...before,
      state: spec.next_state,
      release_id: transition === "stage_release" ? auditContext.release_id : before.release_id ?? null,
      decided_by_user_id: transition === "stage_release" ? before.decided_by_user_id ?? null : governedDecision.actor_user_id,
      decided_by_role_key: transition === "stage_release" ? before.decided_by_role_key ?? null : governedDecision.actor_role_key,
      decision_rationale: transition === "stage_release" ? before.decision_rationale ?? null : auditContext.rationale,
      staged_by_user_id: transition === "stage_release" ? governedDecision.actor_user_id : before.staged_by_user_id ?? null,
      staged_by_role_key: transition === "stage_release" ? governedDecision.actor_role_key : before.staged_by_role_key ?? null,
      stage_rationale: transition === "stage_release" ? auditContext.rationale : before.stage_rationale ?? null,
      governed_decision: governedDecision,
      updated_at: this.clock().toISOString()
      },
      governedDecision,
      audit_event_id: governedDecision.audit_event_id
    });
    return Object.freeze({ proposal: after, governed_decision: governedDecision });
  }
}

export function buildProposalGovernedDecisionBinding(decision) {
  return sha256([
    decision.decision_id,
    decision.decision,
    decision.action,
    decision.actor_user_id,
    decision.actor_role_key,
    decision.tenant_id,
    decision.environment,
    decision.proposal_id,
    decision.proposal_type,
    decision.previous_state,
    decision.next_state,
    decision.release_id ?? null,
    decision.rationale_digest,
    decision.payload_digest,
    decision.provenance_id,
    decision.validation_report_id ?? null,
    decision.human_governance_proof_id ?? null,
    decision.human_governance_proof_digest ?? null,
    decision.audit_event_id,
    decision.correlation_id,
    decision.issued_at,
    decision.expires_at
  ]);
}

function mintGovernedDecision({ before, spec, transition, authorizationDecision, auditContext, now, expiresAt, idFactory, signer }) {
  const value = {
    decision_id: `decision:proposal:${idFactory()}`,
    decision: "allow",
    action: authorizationDecision.action,
    actor_user_id: authorizationDecision.actor_user_id,
    actor_role_key: authorizationDecision.actor_role_key,
    tenant_id: authorizationDecision.tenant_id,
    environment: authorizationDecision.environment,
    proposal_id: before.proposal_id,
    proposal_type: before.proposal_type,
    previous_state: before.state,
    next_state: spec.next_state,
    release_id: transition === "stage_release" ? auditContext.release_id ?? null : null,
    rationale_digest: sha256(auditContext.rationale ?? ""),
    payload_digest: sha256(before.payload),
    provenance_id: before.provenance?.provenance_id ?? before.provenance_id,
    validation_report_id: before.validation_result?.validation_report_id ?? null,
    human_governance_proof_id: authorizationDecision.human_governance_proof_id ?? null,
    human_governance_proof_digest: authorizationDecision.human_governance_proof_digest ?? null,
    audit_event_id: auditContext.audit_event_id ?? `audit:proposal:${idFactory()}`,
    correlation_id: auditContext.correlation_id,
    issued_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    audit_event_type: spec.event_type
  };
  value.decision_binding = buildProposalGovernedDecisionBinding(value);
  value.signature = signer({ decision: value, decision_binding: value.decision_binding });
  return value;
}

function assertAuthorizationDecision({ spec, before, authorizationDecision, auditContext, usedDecisionIds }) {
  if (!spec) {
    throw new ProposalGovernedTransitionError("unknown governed proposal transition");
  }
  if (!authorizationDecision || authorizationDecision.allowed !== true) {
    throw new ProposalGovernedTransitionError("allowed authorization decision is required");
  }
  const expected = {
    action: spec.action,
    actor_user_id: auditContext.actor_user_id,
    tenant_id: before.tenant_id,
    environment: before.environment,
    proposal_id: before.proposal_id,
    proposal_type: before.proposal_type
  };
  for (const [field, value] of Object.entries(expected)) {
    if ((authorizationDecision[field] ?? null) !== value) {
      throw new ProposalGovernedTransitionError(`authorization decision mismatch for ${field}`);
    }
  }
  if (!spec.roles.includes(authorizationDecision.actor_role_key)) {
    throw new ProposalGovernedTransitionError("authorization decision role denied");
  }
  if (spec.action === PROPOSAL_ACTIONS.stageRelease && !auditContext.release_id) {
    throw new ProposalGovernedTransitionError("release_id is required for staging");
  }
  if (authorizationDecision.decision_id && usedDecisionIds.has(authorizationDecision.decision_id)) {
    throw new ProposalGovernedTransitionError("authorization decision already used");
  }
  if (isModelSuggestedProposal(before) && [PROPOSAL_ACTIONS.approve, PROPOSAL_ACTIONS.stageRelease].includes(spec.action)) {
    if (authorizationDecision.human_governance_required !== true) {
      throw new ProposalGovernedTransitionError("model_suggested transition requires human governance proof");
    }
    if (!authorizationDecision.human_governance_proof_id || !authorizationDecision.human_governance_proof_digest) {
      throw new ProposalGovernedTransitionError("model_suggested transition missing human governance proof");
    }
    if (
      spec.action === PROPOSAL_ACTIONS.stageRelease &&
      (!before.governed_decision ||
        before.governed_decision.action !== PROPOSAL_ACTIONS.approve ||
        before.governed_decision.next_state !== "approved" ||
        !before.governed_decision.human_governance_proof_id)
    ) {
      throw new ProposalGovernedTransitionError("model_suggested staging requires prior signed approval proof");
    }
  }
}

function defaultGovernedDecisionSigner({ decision_binding }) {
  return decision_binding;
}

function isModelSuggestedProposal(proposal) {
  return proposal.assertion_type === "model_suggested" || proposal.payload?.assertion_type === "model_suggested";
}
