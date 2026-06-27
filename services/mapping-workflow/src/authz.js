import { mappingPredicates } from "../../../packages/contracts/src/index.js";

export const MAPPING_ACTIONS = Object.freeze({
  approve: "mapping_candidate.approve",
  reject: "mapping_candidate.reject",
  stageRelease: "mapping_candidate.stage_release"
});

const APPROVE_REJECT_ROLES = Object.freeze(["curator", "domain_approver"]);
const STAGE_ROLES = Object.freeze(["release_manager"]);
const BLOCKED_LICENSE_STATUSES = Object.freeze(["blocked", "pending_review"]);

export class MappingAuthorizationError extends Error {
  constructor(message = "mapping candidate action denied") {
    super(message);
    this.name = "MappingAuthorizationError";
  }
}

export function assertCanGovernMappingCandidate({
  actor,
  candidate,
  action,
  tenant_id,
  environment,
  rationale,
  correlation_id,
  release_id
}) {
  try {
    assertNonEmpty(correlation_id, "correlation_id");
    assertNonEmpty(rationale, "rationale");
    assertActor(actor, tenant_id, environment);
    assertCandidateTenant(candidate, tenant_id, environment);
    assertNonCreator(actor, candidate);

    if (action === MAPPING_ACTIONS.approve) {
      const actorRole = firstMatchingRole(actor, APPROVE_REJECT_ROLES);
      assertReviewStatus(candidate, "proposed");
      assertGovernedCandidateShape(candidate);
      assertNoUnresolvedDuplicate(candidate);
      return allowedDecision({ action, actor, actorRole, candidate, tenant_id, environment, auditEventType: "mapping_candidate_approved" });
    }

    if (action === MAPPING_ACTIONS.reject) {
      const actorRole = firstMatchingRole(actor, APPROVE_REJECT_ROLES);
      assertReviewStatus(candidate, "proposed");
      return allowedDecision({ action, actor, actorRole, candidate, tenant_id, environment, auditEventType: "mapping_candidate_rejected" });
    }

    if (action === MAPPING_ACTIONS.stageRelease) {
      const actorRole = firstMatchingRole(actor, STAGE_ROLES);
      assertNonEmpty(release_id, "release_id");
      assertReviewStatus(candidate, "approved");
      assertGovernedCandidateShape(candidate);
      assertNoUnresolvedDuplicate(candidate);
      if (!Array.isArray(candidate.permitted_uses) || !candidate.permitted_uses.includes("release")) {
        throw new Error("candidate is not release permitted");
      }
      if (BLOCKED_LICENSE_STATUSES.includes(candidate.license_status)) {
        throw new Error("candidate license blocks release");
      }
      if (!Array.isArray(candidate.release_evidence_refs) || candidate.release_evidence_refs.length === 0) {
        throw new Error("release evidence refs are required");
      }
      if (!Array.isArray(candidate.validation_report_refs) || candidate.validation_report_refs.length === 0) {
        throw new Error("validation report refs are required");
      }
      return allowedDecision({ action, actor, actorRole, candidate, tenant_id, environment, auditEventType: "mapping_candidate_staged" });
    }

    throw new Error("unknown mapping candidate action");
  } catch (error) {
    if (error instanceof MappingAuthorizationError) {
      throw error;
    }
    throw new MappingAuthorizationError();
  }
}

function allowedDecision({ action, actor, actorRole, candidate, tenant_id, environment, auditEventType }) {
  return {
    allowed: true,
    action,
    actor_user_id: actor.user_id,
    actor_role_key: actorRole,
    tenant_id,
    environment,
    candidate_id: candidate.candidate_id,
    audit_event_type: auditEventType
  };
}

function assertActor(actor, tenantId, environment) {
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
    throw new Error("actor required");
  }
  assertNonEmpty(actor.user_id, "actor.user_id");
  if (actor.principal_type === "service_account" || actor.service_account_id) {
    throw new Error("service accounts cannot govern mapping candidates");
  }
  if (actor.tenant_id !== tenantId || actor.environment !== environment) {
    throw new Error("actor scope mismatch");
  }
  if (!Array.isArray(actor.role_keys)) {
    throw new Error("actor role_keys required");
  }
}

function assertCandidateTenant(candidate, tenantId, environment) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("candidate required");
  }
  if (candidate.tenant_id !== tenantId || candidate.environment !== environment) {
    throw new Error("candidate scope mismatch");
  }
}

function assertNonCreator(actor, candidate) {
  if (candidate.created_by_user_id && candidate.created_by_user_id === actor.user_id) {
    throw new Error("actor cannot govern own candidate");
  }
  if (candidate.service_account_owner_user_id && candidate.service_account_owner_user_id === actor.user_id) {
    throw new Error("actor cannot govern candidate emitted by owned service account");
  }
}

function firstMatchingRole(actor, allowedRoles) {
  const role = actor.role_keys.find((roleKey) => allowedRoles.includes(roleKey));
  if (!role) {
    throw new Error("role denied");
  }
  return role;
}

function assertReviewStatus(candidate, expected) {
  if (candidate.review_status !== expected) {
    throw new Error("candidate state denied");
  }
}

function assertGovernedCandidateShape(candidate) {
  for (const field of [
    "candidate_id",
    "mapping_id",
    "source_entity_id",
    "target_entity_id",
    "source_vocabulary",
    "source_vocabulary_version",
    "target_vocabulary",
    "target_vocabulary_version",
    "source_license_policy_id",
    "target_license_policy_id",
    "license_status",
    "confidence_band",
    "provenance_id"
  ]) {
    assertNonEmpty(candidate[field], field);
  }
  if (!mappingPredicates.includes(candidate.predicate)) {
    throw new Error("predicate denied");
  }
  if (typeof candidate.confidence_score !== "number" || candidate.confidence_score < 0 || candidate.confidence_score > 1) {
    throw new Error("confidence score denied");
  }
  if (!candidate.confidence_source) {
    throw new Error("confidence source required");
  }
  if (!candidate.provenance || typeof candidate.provenance !== "object") {
    throw new Error("provenance required");
  }
  if (!Array.isArray(candidate.evidence_ids) || candidate.evidence_ids.length === 0) {
    throw new Error("evidence ids required");
  }
  if (!Array.isArray(candidate.evidence_refs) || candidate.evidence_refs.length === 0) {
    throw new Error("evidence refs required");
  }
  if (BLOCKED_LICENSE_STATUSES.includes(candidate.license_status)) {
    throw new Error("license status denied");
  }
}

function assertNoUnresolvedDuplicate(candidate) {
  if (candidate.duplicate_status !== "not_duplicate") {
    throw new Error("duplicate status blocks governance");
  }
}

function assertNonEmpty(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} required`);
  }
}
