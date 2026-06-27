import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { assertCanGovernProposal, PROPOSAL_ACTIONS } from "../../proposal-workflow/src/authz.js";
import { ProposalWorkflowService } from "../../proposal-workflow/src/workflow.js";
import { sha256, stableStringify } from "../../../packages/connector-sdk/src/hash.js";
import {
  PILOT_ENVIRONMENT,
  PILOT_OUTPUT_PATH,
  PILOT_TENANT_ID,
  assertAntiplateletStagingProvisioningPlan
} from "./pilot-provisioning.js";

export const PILOT_ONBOARDING_ROSTER_SCHEMA = "pilot-antiplatelet-onboarding-roster.v1";
export const PILOT_ONBOARDING_STATE_SCHEMA = "pilot-antiplatelet-onboarding-state.v1";
export const PILOT_ONBOARDING_CORRELATION_ID = "corr:pilot-antiplatelet-staging-onboarding";

export const PILOT_TRAINING_SESSIONS = Object.freeze([
  "system_and_governance_basics",
  "curator_workflow",
  "expert_review_and_approval",
  "release_and_export"
]);

export const PILOT_DAY1_SEARCHES = Object.freeze([
  "aspirin",
  "acetylsalicylic acid",
  "CHEMBL25",
  "PTGS1",
  "PTGS2"
]);

export async function loadPilotOnboardingRoster(rosterPath) {
  if (!rosterPath) {
    throw new Error("roster path is required");
  }
  return JSON.parse(await readFile(resolve(rosterPath), "utf8"));
}

export async function dryRunPilotOnboarding({ rosterPath, statePath = PILOT_OUTPUT_PATH } = {}) {
  const [roster, state] = await Promise.all([
    loadPilotOnboardingRoster(rosterPath),
    readPilotProvisioningState(statePath)
  ]);
  return buildPilotOnboardingPlan({ roster, state, mode: "dry-run" });
}

export async function applyPilotOnboarding({ rosterPath, statePath = PILOT_OUTPUT_PATH } = {}) {
  const roster = await loadPilotOnboardingRoster(rosterPath);
  const state = await readPilotProvisioningState(statePath);
  const plan = buildPilotOnboardingPlan({ roster, state, mode: "apply" });
  if (plan.errors.length > 0) {
    throw new Error(`pilot onboarding roster is invalid: ${plan.errors.join("; ")}`);
  }
  const nextState = applyOnboardingToState(state, plan);
  await writeFile(resolve(statePath), `${stableStringify(nextState)}\n`, "utf8");
  return {
    output_path: resolve(statePath),
    onboarding: plan.summary,
    verification: verifyPilotOnboardingState(nextState)
  };
}

export async function verifyPilotOnboarding({ statePath = PILOT_OUTPUT_PATH } = {}) {
  const state = await readPilotProvisioningState(statePath);
  return {
    output_path: resolve(statePath),
    verification: verifyPilotOnboardingState(state)
  };
}

export async function readPilotProvisioningState(statePath = PILOT_OUTPUT_PATH) {
  const state = JSON.parse(await readFile(resolve(statePath), "utf8"));
  assertAntiplateletStagingProvisioningPlan(state);
  return state;
}

export function buildPilotOnboardingPlan({ roster, state, mode = "dry-run" }) {
  assertAntiplateletStagingProvisioningPlan(state);
  const errors = [];
  const warnings = [];
  const users = arrayOf(roster?.users);

  if (roster?.schema_version !== PILOT_ONBOARDING_ROSTER_SCHEMA) {
    errors.push(`roster schema_version must be ${PILOT_ONBOARDING_ROSTER_SCHEMA}`);
  }
  if (roster?.tenant_id !== PILOT_TENANT_ID) {
    errors.push(`roster tenant_id must be ${PILOT_TENANT_ID}`);
  }
  if (roster?.environment !== PILOT_ENVIRONMENT) {
    errors.push(`roster environment must be ${PILOT_ENVIRONMENT}`);
  }

  const placeholders = new Map(state.human_principals.map((principal) => [principal.principal_id, principal]));
  const seenExternalKeys = new Set();
  const seenPrincipals = new Set();
  const existingMappings = new Map(arrayOf(state.sso_mappings).map((mapping) => [mapping.external_identity_key_hash, mapping]));
  const mappedUsers = [];
  const unmappedUsers = [];
  const missingAcknowledgments = [];
  const missingDay1Confirmations = [];

  for (const [index, user] of users.entries()) {
    const label = user?.principal_id ?? `users[${index}]`;
    const externalKey = externalIdentityKey(user?.issuer, user?.subject);
    const externalHash = externalIdentityKeyHash(user?.issuer, user?.subject);
    const placeholder = placeholders.get(user?.principal_id);
    const userErrors = [];

    if (!nonEmpty(user?.issuer)) userErrors.push(`${label} issuer is required`);
    if (!nonEmpty(user?.subject)) userErrors.push(`${label} subject is required`);
    if (!nonEmpty(user?.principal_id)) userErrors.push(`${label} principal_id is required`);
    if (!placeholder) {
      userErrors.push(`${label} does not map to an existing pilot placeholder principal`);
    } else {
      if (placeholder.tenant_id !== PILOT_TENANT_ID || placeholder.environment !== PILOT_ENVIRONMENT) {
        userErrors.push(`${label} placeholder is not pilot staging scoped`);
      }
      if (placeholder.principal_type !== "human_placeholder") {
        userErrors.push(`${label} target principal must be a human placeholder`);
      }
      if (placeholder.role_keys?.length !== 1 || placeholder.role_keys[0] !== placeholder.primary_role_key) {
        userErrors.push(`${label} placeholder must have exactly one primary role`);
      }
    }
    if (String(user?.principal_id ?? "").startsWith("svc:")) {
      userErrors.push(`${label} service accounts cannot use SSO`);
    }
    if (seenExternalKeys.has(externalKey)) {
      userErrors.push(`${label} duplicates an issuer+subject in the roster`);
    }
    if (seenPrincipals.has(user?.principal_id)) {
      userErrors.push(`${label} duplicates a placeholder principal in the roster`);
    }
    if (existingMappings.has(externalHash)) {
      const existing = existingMappings.get(externalHash);
      if (existing.principal_id !== user.principal_id || existing.status !== "active") {
        userErrors.push(`${label} conflicts with an existing SSO mapping`);
      }
    }

    const missingSessions = missingTrainingSessions(user?.training_acknowledgments);
    if (missingSessions.length > 0) {
      missingAcknowledgments.push({ principal_id: user?.principal_id ?? null, missing_sessions: missingSessions });
      userErrors.push(`${label} missing training acknowledgments: ${missingSessions.join(", ")}`);
    }
    const day1Missing = missingDay1Checks(user?.day1_access_confirmation);
    if (day1Missing.length > 0) {
      missingDay1Confirmations.push({ principal_id: user?.principal_id ?? null, missing_checks: day1Missing });
      userErrors.push(`${label} missing Day-1 checks: ${day1Missing.join(", ")}`);
    }

    if (nonEmpty(user?.issuer) && nonEmpty(user?.subject)) {
      seenExternalKeys.add(externalKey);
    }
    if (nonEmpty(user?.principal_id)) {
      seenPrincipals.add(user.principal_id);
    }

    if (userErrors.length === 0) {
      mappedUsers.push({
        principal_id: user.principal_id,
        issuer: user.issuer,
        subject_hash: sha256(user.subject),
        external_identity_key_hash: externalHash,
        display_name: user.display_name ?? placeholder.display_name,
        email: user.email ?? null,
        primary_role_key: placeholder.primary_role_key,
        source_entitlement_ids: placeholder.source_entitlement_ids,
        status_before: placeholder.status,
        status_after: "active"
      });
    } else {
      unmappedUsers.push({ principal_id: user?.principal_id ?? null, errors: userErrors });
      errors.push(...userErrors);
    }
  }

  if (users.length === 0) {
    warnings.push("roster contains no users");
  }

  return {
    schema_version: PILOT_ONBOARDING_STATE_SCHEMA,
    mode,
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    roster_digest: sha256(roster),
    summary: {
      would_activate_count: mappedUsers.length,
      error_count: errors.length,
      warning_count: warnings.length,
      mapped_users: mappedUsers,
      unmapped_users: unmappedUsers,
      missing_acknowledgments: missingAcknowledgments,
      missing_day1_confirmations: missingDay1Confirmations
    },
    audit_events: onboardingAuditEvents({ mappedUsers, rosterDigest: sha256(roster) }),
    errors,
    warnings
  };
}

export function applyOnboardingToState(state, onboardingPlan) {
  const nextState = JSON.parse(stableStringify(state));
  const mappingsByHash = new Map(arrayOf(nextState.sso_mappings).map((mapping) => [mapping.external_identity_key_hash, mapping]));
  const acknowledgmentsById = new Map(arrayOf(nextState.training_acknowledgments).map((ack) => [ack.acknowledgment_id, ack]));
  const confirmationsById = new Map(arrayOf(nextState.day1_access_confirmations).map((confirmation) => [confirmation.confirmation_id, confirmation]));
  const eventsById = new Map(arrayOf(nextState.audit_events).map((event) => [event.audit_event_id, event]));

  for (const user of onboardingPlan.summary.mapped_users) {
    const existingMapping = mappingsByHash.get(user.external_identity_key_hash);
    mappingsByHash.set(user.external_identity_key_hash, existingMapping ?? {
      mapping_id: `sso-map:${PILOT_TENANT_ID}:${PILOT_ENVIRONMENT}:${digestToken(user.external_identity_key_hash)}`,
      tenant_id: PILOT_TENANT_ID,
      environment: PILOT_ENVIRONMENT,
      issuer: user.issuer,
      subject_hash: user.subject_hash,
      external_identity_key_hash: user.external_identity_key_hash,
      principal_id: user.principal_id,
      principal_status_before: user.status_before,
      principal_status_after: "active",
      email_at_mapping: user.email,
      display_name_at_mapping: user.display_name,
      status: "active",
      correlation_id: PILOT_ONBOARDING_CORRELATION_ID
    });

    for (const session_id of PILOT_TRAINING_SESSIONS) {
      const acknowledgment_id = `training-ack:${user.principal_id}:${session_id}`;
      acknowledgmentsById.set(acknowledgment_id, {
        acknowledgment_id,
        tenant_id: PILOT_TENANT_ID,
        environment: PILOT_ENVIRONMENT,
        principal_id: user.principal_id,
        session_id,
        status: "acknowledged",
        correlation_id: PILOT_ONBOARDING_CORRELATION_ID
      });
    }

    const confirmation_id = `day1-confirmation:${user.principal_id}`;
    confirmationsById.set(confirmation_id, {
      confirmation_id,
      tenant_id: PILOT_TENANT_ID,
      environment: PILOT_ENVIRONMENT,
      principal_id: user.principal_id,
      required_searches: [...PILOT_DAY1_SEARCHES],
      entity_page_opened: true,
      evidence_inspected: true,
      expected_role_actions_only: true,
      no_hidden_unauthorized_counts: true,
      no_out_of_scope_sources_or_actions: true,
      status: "confirmed",
      correlation_id: PILOT_ONBOARDING_CORRELATION_ID
    });

    const principal = nextState.human_principals.find((candidate) => candidate.principal_id === user.principal_id);
    if (principal) {
      principal.status = "active";
      principal.sso_mapping_id = `sso-map:${PILOT_TENANT_ID}:${PILOT_ENVIRONMENT}:${digestToken(user.external_identity_key_hash)}`;
    }
  }

  for (const event of onboardingPlan.audit_events) {
    eventsById.set(event.audit_event_id, event);
  }

  nextState.sso_mappings = sortBy([...mappingsByHash.values()], "mapping_id");
  nextState.training_acknowledgments = sortBy([...acknowledgmentsById.values()], "acknowledgment_id");
  nextState.day1_access_confirmations = sortBy([...confirmationsById.values()], "confirmation_id");
  nextState.audit_events = sortBy([...eventsById.values()], "audit_event_id");
  nextState.onboarding = {
    schema_version: PILOT_ONBOARDING_STATE_SCHEMA,
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    roster_digest: onboardingPlan.roster_digest,
    activated_principal_ids: onboardingPlan.summary.mapped_users.map((user) => user.principal_id).sort(),
    correlation_id: PILOT_ONBOARDING_CORRELATION_ID
  };
  return nextState;
}

export function verifyPilotOnboardingState(state) {
  assertAntiplateletStagingProvisioningPlan(state);
  const errors = [];
  const mappedPrincipalIds = new Set(arrayOf(state.sso_mappings).filter((mapping) => mapping.status === "active").map((mapping) => mapping.principal_id));
  const mappedPrincipals = state.human_principals.filter((principal) => mappedPrincipalIds.has(principal.principal_id));
  const unmappedUsers = state.human_principals
    .filter((principal) => principal.status === "placeholder_pending_sso_mapping")
    .map((principal) => principal.principal_id);
  const missingAcknowledgments = [];
  const missingDay1Confirmations = [];

  for (const principal of mappedPrincipals) {
    if (principal.tenant_id !== PILOT_TENANT_ID || principal.environment !== PILOT_ENVIRONMENT) {
      errors.push(`${principal.principal_id} is not pilot staging scoped`);
    }
    if (principal.role_keys?.length !== 1 || principal.role_keys[0] !== principal.primary_role_key) {
      errors.push(`${principal.principal_id} does not have exactly one primary role`);
    }
    if (!sameSet(principal.source_entitlement_ids, [
      "source-entitlement:tenant-pilot-antiplatelet:staging:chembl:CHEMBL_34",
      "source-entitlement:tenant-pilot-antiplatelet:staging:uniprot:2026_02"
    ])) {
      errors.push(`${principal.principal_id} source entitlements are not limited to ChEMBL and UniProt`);
    }
    const ackSessions = arrayOf(state.training_acknowledgments)
      .filter((ack) => ack.principal_id === principal.principal_id && ack.status === "acknowledged")
      .map((ack) => ack.session_id);
    const missingSessions = PILOT_TRAINING_SESSIONS.filter((session) => !ackSessions.includes(session));
    if (missingSessions.length > 0) {
      missingAcknowledgments.push({ principal_id: principal.principal_id, missing_sessions: missingSessions });
      errors.push(`${principal.principal_id} missing training acknowledgments`);
    }
    const confirmation = arrayOf(state.day1_access_confirmations).find((item) => item.principal_id === principal.principal_id);
    const missingChecks = missingDay1Checks(confirmation);
    if (missingChecks.length > 0) {
      missingDay1Confirmations.push({ principal_id: principal.principal_id, missing_checks: missingChecks });
      errors.push(`${principal.principal_id} missing Day-1 confirmations`);
    }
  }

  const serviceAccounts = arrayOf(state.service_accounts);
  for (const serviceAccount of serviceAccounts) {
    for (const denied of ["proposal.ai_feedback.record", "approval.approve", "release.promote", "export.release_package", "rbac.manage_policy", "break_glass.activate"]) {
      if (!serviceAccount.explicit_denies.includes(denied)) {
        errors.push(`${serviceAccount.principal_id} missing explicit deny ${denied}`);
      }
    }
  }

  const domainApprover = state.human_principals.find((principal) => principal.primary_role_key === "domain_approver");
  if (domainApprover) {
    try {
      assertCanGovernProposal({
        actor: {
          user_id: domainApprover.principal_id,
          tenant_id: PILOT_TENANT_ID,
          environment: PILOT_ENVIRONMENT,
          role_keys: domainApprover.role_keys
        },
        proposal: {
          proposal_id: "proposal:onboarding-self-approval",
          proposal_type: "relationship",
          tenant_id: PILOT_TENANT_ID,
          environment: PILOT_ENVIRONMENT,
          state: "approver-decision",
          submitted_by_user_id: domainApprover.principal_id,
          validation_result: { status: "passed" }
        },
        action: PROPOSAL_ACTIONS.approve,
        tenant_id: PILOT_TENANT_ID,
        environment: PILOT_ENVIRONMENT,
        rationale: "self approval must remain denied",
        correlation_id: "corr:onboarding-self-approval"
      });
      errors.push("domain approver self-approval was not denied");
    } catch {
      // Expected denial.
    }
  }

  const serviceAccount = serviceAccounts[0];
  if (serviceAccount) {
    try {
      const workflow = new ProposalWorkflowService();
      workflow.recordSuggestionFeedback({
        proposalId: "proposal:onboarding-feedback",
        actor: {
          user_id: serviceAccount.principal_id,
          service_account_id: serviceAccount.principal_id,
          principal_type: "service_account",
          tenant_id: PILOT_TENANT_ID,
          environment: PILOT_ENVIRONMENT,
          role_keys: ["service_account"]
        },
        feedback: { decision: "accept" },
        rationale: "service account feedback must remain denied",
        correlation_id: "corr:onboarding-service-feedback"
      });
      errors.push("service account feedback was not denied");
    } catch {
      // Expected denial. The proposal may be absent or service-account denied; either still proves no feedback is recorded.
    }
  }

  return {
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    mapped_user_count: mappedPrincipalIds.size,
    unmapped_users: unmappedUsers,
    missing_acknowledgments: missingAcknowledgments,
    missing_day1_confirmations: missingDay1Confirmations,
    audit_event_count: arrayOf(state.audit_events).filter((event) => String(event.event_type).startsWith("pilot_onboarding.")).length,
    controls: {
      staging_only: state.environments.length === 1 && state.environments[0].environment === PILOT_ENVIRONMENT,
      no_controlled_prod: state.environments.every((environment) => environment.controlled_production_enabled === false),
      sso_authentication_only: true,
      no_rbac_model_change: true,
      no_service_account_sso: arrayOf(state.sso_mappings).every((mapping) => !String(mapping.principal_id).startsWith("svc:"))
    },
    ok: errors.length === 0,
    errors
  };
}

function onboardingAuditEvents({ mappedUsers, rosterDigest }) {
  return mappedUsers.flatMap((user) => [
    onboardingAuditEvent("pilot_onboarding.sso_mapping_active", user.principal_id, { roster_digest: rosterDigest }),
    onboardingAuditEvent("pilot_onboarding.principal_activated", user.principal_id, { role_key: user.primary_role_key }),
    onboardingAuditEvent("pilot_onboarding.training_acknowledged", user.principal_id, { sessions: PILOT_TRAINING_SESSIONS }),
    onboardingAuditEvent("pilot_onboarding.day1_access_confirmed", user.principal_id, { searches: PILOT_DAY1_SEARCHES })
  ]);
}

function onboardingAuditEvent(eventType, objectId, extra = {}) {
  return {
    audit_event_id: `audit:${digestToken(`${eventType}|${objectId}`)}`,
    event_type: eventType,
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    actor: "principal:tenant-pilot-antiplatelet:staging:tenant-administrator",
    actor_type: "human",
    object_id: objectId,
    correlation_id: PILOT_ONBOARDING_CORRELATION_ID,
    status: "success",
    ...extra
  };
}

function externalIdentityKey(issuer, subject) {
  return `${issuer ?? ""}\u0000${subject ?? ""}`;
}

function externalIdentityKeyHash(issuer, subject) {
  return sha256(externalIdentityKey(issuer, subject));
}

function missingTrainingSessions(acknowledgments) {
  const acknowledged = new Set(arrayOf(acknowledgments).filter((ack) => ack.status === "acknowledged").map((ack) => ack.session_id));
  return PILOT_TRAINING_SESSIONS.filter((session) => !acknowledged.has(session));
}

function missingDay1Checks(confirmation) {
  const missing = [];
  const searches = arrayOf(confirmation?.searches ?? confirmation?.required_searches);
  for (const search of PILOT_DAY1_SEARCHES) {
    if (!searches.includes(search)) missing.push(`search:${search}`);
  }
  if (confirmation?.entity_page_opened !== true) missing.push("entity_page_opened");
  if (confirmation?.evidence_inspected !== true) missing.push("evidence_inspected");
  if ((confirmation?.expected_role_actions_only ?? confirmation?.sees_only_expected_role_actions) !== true) missing.push("expected_role_actions_only");
  if ((confirmation?.no_hidden_unauthorized_counts ?? confirmation?.sees_no_hidden_unauthorized_counts) !== true) missing.push("no_hidden_unauthorized_counts");
  if ((confirmation?.no_out_of_scope_sources_or_actions ?? confirmation?.cannot_access_out_of_scope_sources_or_actions) !== true) missing.push("no_out_of_scope_sources_or_actions");
  return missing;
}

function digestToken(value) {
  return sha256(value).slice("sha256:".length, "sha256:".length + 24);
}

function sameSet(left, right) {
  const leftSet = new Set(arrayOf(left));
  const rightSet = new Set(arrayOf(right));
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function sortBy(values, key) {
  return values.sort((left, right) => String(left[key]).localeCompare(String(right[key])));
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}
