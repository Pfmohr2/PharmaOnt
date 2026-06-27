export const PROPOSAL_ACTIONS = Object.freeze({
  submit: "proposal.submit",
  validate: "proposal.validate",
  routeToCurator: "proposal.route_curator_review",
  routeToApprover: "proposal.route_approver_decision",
  approve: "proposal.approve",
  reject: "proposal.reject",
  stageRelease: "proposal.stage_release"
});

const ACTION_ROLES = Object.freeze({
  [PROPOSAL_ACTIONS.submit]: ["contributor", "curator"],
  [PROPOSAL_ACTIONS.validate]: ["curator"],
  [PROPOSAL_ACTIONS.routeToCurator]: ["curator"],
  [PROPOSAL_ACTIONS.routeToApprover]: ["curator"],
  [PROPOSAL_ACTIONS.approve]: ["domain_approver"],
  [PROPOSAL_ACTIONS.reject]: ["domain_approver"],
  [PROPOSAL_ACTIONS.stageRelease]: ["release_manager"]
});

const ACTION_AUDIT_EVENT_TYPES = Object.freeze({
  [PROPOSAL_ACTIONS.submit]: "proposal_submitted",
  [PROPOSAL_ACTIONS.validate]: "proposal_validated",
  [PROPOSAL_ACTIONS.routeToCurator]: "proposal_routed_curator_review",
  [PROPOSAL_ACTIONS.routeToApprover]: "proposal_routed_approver_decision",
  [PROPOSAL_ACTIONS.approve]: "proposal_approved",
  [PROPOSAL_ACTIONS.reject]: "proposal_rejected",
  [PROPOSAL_ACTIONS.stageRelease]: "proposal_staged_for_release"
});

export class ProposalAuthorizationError extends Error {
  constructor(message = "proposal workflow action denied") {
    super(message);
    this.name = "ProposalAuthorizationError";
  }
}

export function assertCanGovernProposal({
  actor,
  proposal = null,
  action,
  tenant_id,
  environment,
  rationale,
  correlation_id,
  release_id = null
}) {
  try {
    assertNonEmpty(correlation_id, "correlation_id");
    assertNonEmpty(rationale, "rationale");
    assertActor(actor, tenant_id, environment);
    const actorRole = firstMatchingRole(actor, ACTION_ROLES[action] ?? []);

    if (proposal) {
      assertProposalTenant(proposal, tenant_id, environment);
    }

    if (action === PROPOSAL_ACTIONS.submit) {
      return allowedDecision({ action, actor, actorRole, proposal, tenant_id, environment });
    }

    assertProposalExists(proposal);

    if (action === PROPOSAL_ACTIONS.validate) {
      assertState(proposal, "submitted");
    } else if (action === PROPOSAL_ACTIONS.routeToCurator) {
      assertState(proposal, "validation");
      assertNoCriticalValidation(proposal);
    } else if (action === PROPOSAL_ACTIONS.routeToApprover) {
      assertState(proposal, "curator-review");
      assertNoCriticalValidation(proposal);
    } else if (action === PROPOSAL_ACTIONS.approve) {
      assertState(proposal, "approver-decision");
      assertNoCriticalValidation(proposal);
      assertNonCreator(actor, proposal);
    } else if (action === PROPOSAL_ACTIONS.reject) {
      assertState(proposal, "approver-decision");
      assertNonCreator(actor, proposal);
    } else if (action === PROPOSAL_ACTIONS.stageRelease) {
      assertState(proposal, "approved");
      assertNonEmpty(release_id, "release_id");
      assertNoCriticalValidation(proposal);
      assertNonCreator(actor, proposal);
    } else {
      throw new Error("unknown proposal action");
    }

    return allowedDecision({ action, actor, actorRole, proposal, tenant_id, environment });
  } catch (error) {
    if (error instanceof ProposalAuthorizationError) {
      throw error;
    }
    throw new ProposalAuthorizationError();
  }
}

function allowedDecision({ action, actor, actorRole, proposal, tenant_id, environment }) {
  return {
    allowed: true,
    action,
    actor_user_id: actor.user_id,
    actor_role_key: actorRole,
    tenant_id,
    environment,
    proposal_id: proposal?.proposal_id ?? null,
    proposal_type: proposal?.proposal_type ?? null,
    audit_event_type: ACTION_AUDIT_EVENT_TYPES[action]
  };
}

function assertActor(actor, tenantId, environment) {
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
    throw new Error("actor required");
  }
  assertNonEmpty(actor.user_id, "actor.user_id");
  if (actor.principal_type === "service_account" || actor.service_account_id) {
    throw new Error("service accounts cannot govern proposals");
  }
  if (actor.tenant_id !== tenantId || actor.environment !== environment) {
    throw new Error("actor scope mismatch");
  }
  if (!Array.isArray(actor.role_keys)) {
    throw new Error("actor role_keys required");
  }
}

function assertProposalExists(proposal) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new Error("proposal required");
  }
}

function assertProposalTenant(proposal, tenantId, environment) {
  if (proposal.tenant_id !== tenantId || proposal.environment !== environment) {
    throw new Error("proposal scope mismatch");
  }
}

function assertState(proposal, expected) {
  if (proposal.state !== expected) {
    throw new Error("proposal state denied");
  }
}

function assertNoCriticalValidation(proposal) {
  if (
    proposal.validation_result?.status === "failed" ||
    proposal.validation_result?.status === "fail" ||
    proposal.validation_result?.blocking === true ||
    proposal.validation_result?.critical_failures > 0
  ) {
    throw new Error("critical validation blocks transition");
  }
}

function assertNonCreator(actor, proposal) {
  if (proposal.submitted_by_user_id === actor.user_id) {
    throw new Error("actor cannot govern own proposal");
  }
}

function firstMatchingRole(actor, allowedRoles) {
  const role = actor.role_keys.find((roleKey) => allowedRoles.includes(roleKey));
  if (!role) {
    throw new Error("role denied");
  }
  return role;
}

function assertNonEmpty(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} required`);
  }
}
