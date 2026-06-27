import { sha256 } from "./hash.js";

const ORDINARY_PROPOSAL_STATES = new Set([null, undefined, "submitted"]);
const WORKFLOW_PROPOSAL_STATES = new Set(["validation", "curator-review", "approver-decision"]);
const GOVERNED_PROPOSAL_STATES = new Set(["approved", "rejected", "staged-for-release"]);
const ORDINARY_RESTRICTED_FIELDS = [
  "governed_decision",
  "reviewed_by",
  "reviewed_by_user_id",
  "decided_by_user_id",
  "decided_by_role_key",
  "decision_rationale",
  "staged_by_user_id",
  "staged_by_role_key",
  "stage_rationale"
];

export class ProposalStoreGovernanceError extends Error {
  constructor(message = "proposal store write denied") {
    super(message);
    this.name = "ProposalStoreGovernanceError";
  }
}

export class MemoryProposalStore {
  constructor(proposals = [], { governedDecisionVerifier = defaultGovernedDecisionVerifier } = {}) {
    this.proposals = new Map(proposals.map((proposal) => [proposal.proposal_id, structuredClone(proposal)]));
    this.governedDecisionVerifier = governedDecisionVerifier;
  }

  get(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error("proposal not found");
    }
    return structuredClone(proposal);
  }

  put(proposal) {
    assertOrdinaryProposalWrite(proposal);
    this.proposals.set(proposal.proposal_id, structuredClone(proposal));
    return this.get(proposal.proposal_id);
  }

  applyWorkflowTransition({ proposal, audit_event_id, actor_user_id, actor_role_key, action }) {
    assertWorkflowProposalWrite({ proposal, audit_event_id, actor_user_id, actor_role_key, action });
    this.proposals.set(proposal.proposal_id, structuredClone(proposal));
    return this.get(proposal.proposal_id);
  }

  applyGovernedTransition({ proposal, governedDecision, audit_event_id }) {
    assertGovernedProposalWrite({
      proposal,
      governedDecision,
      audit_event_id,
      verifier: this.governedDecisionVerifier
    });
    this.proposals.set(proposal.proposal_id, structuredClone(proposal));
    return this.get(proposal.proposal_id);
  }

  list() {
    return [...this.proposals.values()].map((proposal) => structuredClone(proposal));
  }
}

export class MemoryReviewQueueStore {
  constructor(items = []) {
    this.items = items.map((item) => structuredClone(item));
  }

  upsert(item) {
    const index = this.items.findIndex((existing) => existing.queue_item_id === item.queue_item_id);
    if (index >= 0) {
      this.items[index] = structuredClone(item);
      return this.get(item.queue_item_id);
    }
    this.items.push(structuredClone(item));
    return this.get(item.queue_item_id);
  }

  get(queueItemId) {
    const item = this.items.find((candidate) => candidate.queue_item_id === queueItemId);
    if (!item) {
      throw new Error("review queue item not found");
    }
    return structuredClone(item);
  }

  list(filters = {}) {
    return this.items
      .filter((item) => !filters.tenant_id || item.tenant_id === filters.tenant_id)
      .filter((item) => !filters.environment || item.environment === filters.environment)
      .filter((item) => !filters.proposal_type || item.proposal_type === filters.proposal_type)
      .filter((item) => !filters.state || item.state === filters.state)
      .filter((item) => !filters.queue || item.queue === filters.queue)
      .filter((item) => !filters.status || item.status === filters.status)
      .filter((item) => !filters.confidence_band || item.confidence_band === filters.confidence_band)
      .map((item) => structuredClone(item));
  }
}

export class MemoryAuditEventStore {
  constructor(events = []) {
    this.events = [];
    for (const event of events) {
      this.append(event);
    }
  }

  append(event) {
    const immutable = deepFreeze(structuredClone(event));
    this.events.push(immutable);
    return immutable;
  }

  list() {
    return [...this.events];
  }

  forProposal(proposalId) {
    return this.events.filter((event) => event.proposal_id === proposalId);
  }
}

export class MemorySuggestionFeedbackStore {
  constructor(feedback = []) {
    this.feedback = [];
    for (const item of feedback) {
      this.append(item);
    }
  }

  append(item) {
    const immutable = deepFreeze(structuredClone(item));
    this.feedback.push(immutable);
    return immutable;
  }

  list(filters = {}) {
    return this.feedback
      .filter((item) => !filters.tenant_id || item.tenant_id === filters.tenant_id)
      .filter((item) => !filters.environment || item.environment === filters.environment)
      .filter((item) => !filters.proposal_id || item.proposal_id === filters.proposal_id)
      .filter((item) => !filters.decision || item.decision === filters.decision)
      .map((item) => structuredClone(item));
  }

  forProposal(proposalId) {
    return this.list({ proposal_id: proposalId });
  }
}

export class MemoryProposalReleaseStagingStore {
  constructor(entries = []) {
    this.entries = entries.map((entry) => deepFreeze(structuredClone(entry)));
  }

  stage(entry) {
    const staged = deepFreeze(structuredClone(entry));
    this.entries.push(staged);
    return staged;
  }

  list(filters = {}) {
    return this.entries
      .filter((entry) => !filters.tenant_id || entry.tenant_id === filters.tenant_id)
      .filter((entry) => !filters.environment || entry.environment === filters.environment)
      .filter((entry) => !filters.release_id || entry.release_id === filters.release_id)
      .map((entry) => structuredClone(entry));
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function assertOrdinaryProposalWrite(proposal) {
  assertProposalId(proposal);
  if (!ORDINARY_PROPOSAL_STATES.has(proposal.state)) {
    throw new ProposalStoreGovernanceError(`ordinary proposal writes cannot persist state ${proposal.state}`);
  }
  if (proposal.release_id != null) {
    throw new ProposalStoreGovernanceError("ordinary proposal writes cannot set release_id");
  }
  for (const field of ORDINARY_RESTRICTED_FIELDS) {
    if (proposal[field] != null) {
      throw new ProposalStoreGovernanceError(`ordinary proposal writes cannot set ${field}`);
    }
  }
}

function assertWorkflowProposalWrite({ proposal, audit_event_id, actor_user_id, actor_role_key, action }) {
  assertProposalId(proposal);
  assertNonEmpty(audit_event_id, "audit_event_id");
  assertNonEmpty(actor_user_id, "actor_user_id");
  assertNonEmpty(actor_role_key, "actor_role_key");
  assertNonEmpty(action, "action");
  if (!WORKFLOW_PROPOSAL_STATES.has(proposal.state)) {
    throw new ProposalStoreGovernanceError(`workflow proposal writes cannot persist state ${proposal.state}`);
  }
  if (proposal.release_id != null) {
    throw new ProposalStoreGovernanceError("workflow proposal writes cannot set release_id");
  }
  if (proposal.governed_decision != null) {
    throw new ProposalStoreGovernanceError("workflow proposal writes cannot set governed_decision");
  }
}

function assertGovernedProposalWrite({ proposal, governedDecision, audit_event_id, verifier }) {
  assertProposalId(proposal);
  assertNonEmpty(audit_event_id, "audit_event_id");
  if (!GOVERNED_PROPOSAL_STATES.has(proposal.state)) {
    throw new ProposalStoreGovernanceError(`governed proposal writes cannot persist state ${proposal.state}`);
  }
  if (!governedDecision || typeof governedDecision !== "object" || Array.isArray(governedDecision)) {
    throw new ProposalStoreGovernanceError("signed governed_decision is required");
  }
  if (proposal.governed_decision !== governedDecision && JSON.stringify(proposal.governed_decision) !== JSON.stringify(governedDecision)) {
    throw new ProposalStoreGovernanceError("proposal governed_decision must match signed decision");
  }
  const expected = {
    decision: "allow",
    proposal_id: proposal.proposal_id,
    proposal_type: proposal.proposal_type,
    tenant_id: proposal.tenant_id,
    environment: proposal.environment,
    next_state: proposal.state,
    release_id: proposal.release_id ?? null,
    audit_event_id
  };
  for (const [field, value] of Object.entries(expected)) {
    if ((governedDecision[field] ?? null) !== value) {
      throw new ProposalStoreGovernanceError(`governed_decision mismatch for ${field}`);
    }
  }
  if (governedDecision.decision_binding !== buildStoreGovernedDecisionBinding(governedDecision)) {
    throw new ProposalStoreGovernanceError("governed_decision binding is invalid");
  }
  if (verifier({ decision: governedDecision, decision_binding: governedDecision.decision_binding }) !== true) {
    throw new ProposalStoreGovernanceError("governed_decision signature is invalid");
  }
  if (isModelSuggestedProposal(proposal)) {
    if (!governedDecision.human_governance_proof_id || !governedDecision.human_governance_proof_digest) {
      throw new ProposalStoreGovernanceError("model_suggested governed write requires human governance proof");
    }
    if (proposal.state === "staged-for-release" && governedDecision.previous_state !== "approved") {
      throw new ProposalStoreGovernanceError("model_suggested staging requires prior approved state");
    }
  }
}

function buildStoreGovernedDecisionBinding(decision) {
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

function defaultGovernedDecisionVerifier({ decision, decision_binding }) {
  return decision.signature === decision_binding;
}

function assertProposalId(proposal) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new ProposalStoreGovernanceError("proposal is required");
  }
  assertNonEmpty(proposal.proposal_id, "proposal_id");
}

function isModelSuggestedProposal(proposal) {
  return proposal.assertion_type === "model_suggested" || proposal.payload?.assertion_type === "model_suggested";
}

function assertNonEmpty(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProposalStoreGovernanceError(`${fieldName} is required`);
  }
}
