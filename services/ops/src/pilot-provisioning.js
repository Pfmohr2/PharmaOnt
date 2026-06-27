import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chemblMetadata } from "../../../connectors/chembl/src/index.js";
import { uniprotMetadata } from "../../../connectors/uniprot/src/index.js";
import {
  connectorAllowedActions,
  connectorForbiddenActions,
  validateExecutionContext
} from "../../../packages/connector-sdk/src/index.js";
import { sha256, stableStringify } from "../../../packages/connector-sdk/src/hash.js";

export const PILOT_TENANT_ID = "tenant-pilot-antiplatelet";
export const PILOT_TENANT_DISPLAY_NAME = "Aspirin Antiplatelet Pilot";
export const PILOT_ENVIRONMENT = "staging";
export const PILOT_OUTPUT_PATH = ".generated/pilot-provisioning/tenant-pilot-antiplatelet.staging.json";

const SPEC_VERSION = "pilot-antiplatelet-staging-provisioning.v1";
const CORRELATION_ID = "corr:pilot-antiplatelet-staging-provisioning";

const HUMAN_PLACEHOLDERS = Object.freeze([
  ["tenant-administrator", "Tenant Administrator", "platform_admin"],
  ["connector-operator", "Connector Operator", "data_engineer"],
  ["curator", "Curator", "curator"],
  ["domain-expert-reviewer", "Domain Expert Reviewer", "expert_reviewer"],
  ["domain-approver", "Domain Approver", "domain_approver"],
  ["release-manager", "Release Manager", "release_manager"],
  ["compliance-security-reviewer", "Compliance/Security Reviewer", "compliance_reviewer"],
  ["pilot-support", "Pilot Support", "viewer"]
]);

const SERVICE_ACCOUNT_DENIES = Object.freeze([
  ...connectorForbiddenActions,
  "proposal.ai_feedback.record",
  "proposal.approve",
  "proposal.reject",
  "proposal.stage_release",
  "release_candidate.create",
  "export.preview",
  "rbac.assign_role",
  "rbac.manage_users",
  "break_glass.request"
]);

export function buildAntiplateletStagingProvisioningPlan({
  environment = PILOT_ENVIRONMENT,
  actor = "user:platform-admin:pilot-provisioner",
  mode = "dry-run"
} = {}) {
  assertStagingOnly(environment);

  const chembl = chemblMetadata({ sourceVersion: "CHEMBL_34" });
  const uniprot = uniprotMetadata({ sourceVersion: "2026_02" });
  const enabledSourceEntitlements = [
    sourceEntitlement("chembl", chembl, true),
    sourceEntitlement("uniprot", uniprot, true)
  ];
  const disabledSourceEntitlements = [
    disabledSourceEntitlement("openfda_faers", "openFDA FAERS", "disabled_by_default_pending_pilot_decision"),
    disabledSourceEntitlement("internal_phi_pii", "Internal PHI/PII", "prohibited_for_pilot")
  ];

  const humanPrincipals = HUMAN_PLACEHOLDERS.map(([slug, displayName, roleKey]) =>
    humanPlaceholder({ slug, displayName, roleKey, sourceEntitlements: enabledSourceEntitlements })
  );
  const serviceAccounts = [
    connectorServiceAccount({
      connectorId: "chembl",
      metadata: chembl,
      sourceEntitlement: enabledSourceEntitlements[0]
    }),
    connectorServiceAccount({
      connectorId: "uniprot",
      metadata: uniprot,
      sourceEntitlement: enabledSourceEntitlements[1]
    })
  ];

  const body = {
    schema_version: SPEC_VERSION,
    mode,
    tenant: {
      tenant_id: PILOT_TENANT_ID,
      display_name: PILOT_TENANT_DISPLAY_NAME,
      active: true
    },
    environments: [
      {
        tenant_id: PILOT_TENANT_ID,
        environment: PILOT_ENVIRONMENT,
        active: true,
        graph_scope: "working",
        release_context: "working",
        controlled_production_enabled: false,
        controlled_production_creatable: false
      }
    ],
    human_principals: humanPrincipals,
    service_accounts: serviceAccounts,
    source_entitlements: [...enabledSourceEntitlements, ...disabledSourceEntitlements],
    controls: {
      staging_only: true,
      controlled_production_disabled: true,
      controlled_production_creatable: false,
      no_phi_or_pii: true,
      domain_approver_cannot_approve_own_submissions: true,
      service_accounts_cannot_feedback_approve_release_export_rbac_or_break_glass: true,
      no_authz_bypass: true,
      no_fake_approvals_or_release_proof: true
    },
    audit_events: auditEvents({
      actor,
      humanPrincipals,
      serviceAccounts,
      sourceEntitlements: [...enabledSourceEntitlements, ...disabledSourceEntitlements]
    })
  };

  return {
    ...body,
    plan_digest: sha256(body)
  };
}

export function assertAntiplateletStagingProvisioningPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("pilot provisioning plan is required");
  }
  assertEqual(plan.tenant?.tenant_id, PILOT_TENANT_ID, "tenant_id");
  assertEqual(plan.tenant?.display_name, PILOT_TENANT_DISPLAY_NAME, "tenant display name");
  assertEqual(plan.tenant?.active, true, "tenant active");

  const environments = arrayOf(plan.environments);
  assertEqual(environments.length, 1, "environment count");
  const environment = environments[0];
  assertEqual(environment.environment, PILOT_ENVIRONMENT, "environment");
  assertEqual(environment.graph_scope, "working", "graph_scope");
  assertEqual(environment.controlled_production_enabled, false, "controlled production enabled");
  assertEqual(environment.controlled_production_creatable, false, "controlled production creatable");

  assertHumanPrincipals(arrayOf(plan.human_principals));
  assertServiceAccounts(arrayOf(plan.service_accounts));
  assertSourceEntitlements(arrayOf(plan.source_entitlements));

  if (!Array.isArray(plan.audit_events) || plan.audit_events.length < 1) {
    throw new Error("audit events must be emitted");
  }
  if (!plan.onboarding) {
    const body = { ...plan };
    delete body.plan_digest;
    assertEqual(plan.plan_digest, sha256(body), "plan digest");
  }
  return true;
}

export async function applyAntiplateletStagingProvisioningPlan({ outputPath = PILOT_OUTPUT_PATH, actor } = {}) {
  const plan = buildAntiplateletStagingProvisioningPlan({ mode: "apply", actor });
  assertAntiplateletStagingProvisioningPlan(plan);
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${stableStringify(plan)}\n`, "utf8");
  return { output_path: target, plan };
}

export async function verifyAntiplateletStagingProvisioningPlan({ outputPath = PILOT_OUTPUT_PATH } = {}) {
  const target = resolve(outputPath);
  const plan = JSON.parse(await readFile(target, "utf8"));
  assertAntiplateletStagingProvisioningPlan(plan);
  return { output_path: target, plan };
}

export async function rollbackAntiplateletStagingProvisioningPlan({ outputPath = PILOT_OUTPUT_PATH } = {}) {
  const target = resolve(outputPath);
  await rm(target, { force: true });
  return {
    output_path: target,
    rolled_back: true,
    note: "Removed generated pilot provisioning state only; no production resources are touched."
  };
}

function humanPlaceholder({ slug, displayName, roleKey, sourceEntitlements }) {
  return {
    principal_id: `principal:${PILOT_TENANT_ID}:${PILOT_ENVIRONMENT}:${slug}`,
    principal_type: "human_placeholder",
    display_name: displayName,
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    primary_role_key: roleKey,
    role_keys: [roleKey],
    source_entitlement_ids: sourceEntitlements.map((entitlement) => entitlement.entitlement_id),
    mfa_required: privilegedRole(roleKey),
    service_account: false,
    status: "placeholder_pending_sso_mapping",
    constraints: roleKey === "domain_approver"
      ? { cannot_approve_own_submissions: true }
      : {}
  };
}

function connectorServiceAccount({ connectorId, metadata, sourceEntitlement }) {
  const serviceAccountId = `svc:${PILOT_TENANT_ID}:${PILOT_ENVIRONMENT}:${connectorId}-ingestion`;
  const executionContext = {
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    service_account_id: serviceAccountId,
    connector_id: connectorId,
    connector_version: metadata.connector_version,
    source_name: metadata.source_name,
    source_version: metadata.source_version,
    source_version_strategy: metadata.source_version_strategy,
    license_policy_id: licensePolicyId(metadata),
    correlation_id: `${CORRELATION_ID}:${connectorId}`,
    allowed_actions: connectorAllowedActions
  };
  validateExecutionContext(executionContext, metadata);
  return {
    principal_id: serviceAccountId,
    principal_type: "service_account",
    display_name: `${metadata.source_name} staging ingestion service account`,
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    role_keys: ["service_account"],
    connector_id: connectorId,
    connector_version: metadata.connector_version,
    source_name: metadata.source_name,
    source_version: metadata.source_version,
    source_entitlement_id: sourceEntitlement.entitlement_id,
    license_policy_id: executionContext.license_policy_id,
    correlation_context: executionContext.correlation_id,
    allowed_actions: connectorAllowedActions,
    explicit_denies: SERVICE_ACCOUNT_DENIES,
    execution_context: executionContext
  };
}

function sourceEntitlement(sourceKey, metadata, enabled) {
  return {
    entitlement_id: `source-entitlement:${PILOT_TENANT_ID}:${PILOT_ENVIRONMENT}:${sourceKey}:${metadata.source_version}`,
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    source_key: sourceKey,
    source_name: metadata.source_name,
    source_version: metadata.source_version,
    license_policy_id: licensePolicyId(metadata),
    license_classification: metadata.license_classification,
    sensitivity_classification: metadata.sensitivity_classification,
    permitted_uses: metadata.permitted_uses,
    export_restrictions: metadata.export_restrictions,
    enabled
  };
}

function disabledSourceEntitlement(sourceKey, sourceName, reason) {
  return {
    entitlement_id: `source-entitlement:${PILOT_TENANT_ID}:${PILOT_ENVIRONMENT}:${sourceKey}:disabled`,
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    source_key: sourceKey,
    source_name: sourceName,
    source_version: null,
    license_policy_id: null,
    license_classification: sourceKey === "internal_phi_pii" ? "contains_phi_or_pii" : "open_with_attribution",
    sensitivity_classification: sourceKey === "internal_phi_pii" ? "phi_pii" : "public",
    permitted_uses: [],
    export_restrictions: ["disabled"],
    enabled: false,
    disabled_reason: reason
  };
}

function auditEvents({ actor, humanPrincipals, serviceAccounts, sourceEntitlements }) {
  const rows = [
    auditEvent("pilot_provision.tenant_upsert", PILOT_TENANT_ID, actor),
    auditEvent("pilot_provision.environment_upsert", `${PILOT_TENANT_ID}:${PILOT_ENVIRONMENT}`, actor),
    ...humanPrincipals.map((principal) =>
      auditEvent("pilot_provision.human_placeholder_upsert", principal.principal_id, actor)
    ),
    ...serviceAccounts.map((serviceAccount) =>
      auditEvent("pilot_provision.service_account_upsert", serviceAccount.principal_id, actor)
    ),
    ...sourceEntitlements.map((entitlement) =>
      auditEvent(
        entitlement.enabled ? "pilot_provision.source_entitlement_enable" : "pilot_provision.source_entitlement_disable",
        entitlement.entitlement_id,
        actor
      )
    )
  ];
  return rows;
}

function auditEvent(action, objectId, actor) {
  return {
    audit_event_id: `audit:${sha256(`${action}|${objectId}`).slice("sha256:".length, "sha256:".length + 24)}`,
    event_type: action,
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    actor,
    actor_type: "human",
    object_id: objectId,
    correlation_id: CORRELATION_ID,
    status: "success"
  };
}

function assertStagingOnly(environment) {
  if (environment !== PILOT_ENVIRONMENT) {
    throw new Error("antiplatelet pilot provisioning is staging-only");
  }
}

function assertHumanPrincipals(principals) {
  assertEqual(principals.length, HUMAN_PLACEHOLDERS.length, "human principal count");
  for (const principal of principals) {
    assertEqual(principal.principal_type, "human_placeholder", `${principal.principal_id} principal_type`);
    assertEqual(principal.tenant_id, PILOT_TENANT_ID, `${principal.principal_id} tenant`);
    assertEqual(principal.environment, PILOT_ENVIRONMENT, `${principal.principal_id} environment`);
    assertEqual(principal.role_keys?.length, 1, `${principal.principal_id} role count`);
    assertEqual(principal.role_keys?.[0], principal.primary_role_key, `${principal.principal_id} primary role`);
  }
  const domainApprover = principals.find((principal) => principal.primary_role_key === "domain_approver");
  assertEqual(domainApprover?.constraints?.cannot_approve_own_submissions, true, "domain approver self-approval");
}

function assertServiceAccounts(serviceAccounts) {
  assertEqual(serviceAccounts.length, 2, "service account count");
  for (const serviceAccount of serviceAccounts) {
    assertEqual(serviceAccount.principal_type, "service_account", `${serviceAccount.principal_id} principal_type`);
    assertEqual(serviceAccount.tenant_id, PILOT_TENANT_ID, `${serviceAccount.principal_id} tenant`);
    assertEqual(serviceAccount.environment, PILOT_ENVIRONMENT, `${serviceAccount.principal_id} environment`);
    validateExecutionContext(serviceAccount.execution_context, {
      connector_name: serviceAccount.connector_id,
      connector_version: serviceAccount.connector_version,
      source_name: serviceAccount.source_name,
      source_version: serviceAccount.source_version
    });
    for (const denied of [
      "graph.write_released",
      "graph.write_release_candidate",
      "approval.approve",
      "proposal.ai_feedback.record",
      "release.promote",
      "export.release_package",
      "rbac.manage_policy",
      "break_glass.activate"
    ]) {
      if (!serviceAccount.explicit_denies.includes(denied)) {
        throw new Error(`${serviceAccount.principal_id} missing explicit deny ${denied}`);
      }
    }
  }
}

function assertSourceEntitlements(entitlements) {
  const enabled = entitlements.filter((entitlement) => entitlement.enabled);
  assertEqual(enabled.length, 2, "enabled source entitlement count");
  assertEqual(Boolean(enabled.find((entitlement) => entitlement.source_name === "ChEMBL" && entitlement.source_version === "CHEMBL_34")), true, "ChEMBL source entitlement");
  assertEqual(Boolean(enabled.find((entitlement) => entitlement.source_name === "UniProt" && entitlement.source_version === "2026_02")), true, "UniProt source entitlement");
  assertEqual(Boolean(entitlements.find((entitlement) => entitlement.source_key === "openfda_faers" && entitlement.enabled === false)), true, "FAERS disabled");
  assertEqual(Boolean(entitlements.find((entitlement) => entitlement.source_key === "internal_phi_pii" && entitlement.enabled === false)), true, "internal PHI/PII disabled");
}

function licensePolicyId(metadata) {
  return `license-policy:${PILOT_TENANT_ID}:${PILOT_ENVIRONMENT}:${metadata.connector_name}:${metadata.source_version}`;
}

function privilegedRole(roleKey) {
  return [
    "domain_approver",
    "compliance_reviewer",
    "release_manager",
    "data_engineer",
    "platform_admin",
    "security_admin"
  ].includes(roleKey);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch`);
  }
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}
