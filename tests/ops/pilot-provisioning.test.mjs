import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PILOT_ENVIRONMENT,
  PILOT_TENANT_ID,
  applyAntiplateletStagingProvisioningPlan,
  assertAntiplateletStagingProvisioningPlan,
  buildAntiplateletStagingProvisioningPlan,
  rollbackAntiplateletStagingProvisioningPlan,
  verifyAntiplateletStagingProvisioningPlan
} from "../../services/ops/src/pilot-provisioning.js";
import { requireConnectorAction } from "../../packages/connector-sdk/src/security.js";
import { ProposalWorkflowService } from "../../services/proposal-workflow/src/workflow.js";
import { PROPOSAL_ACTIONS, assertCanGovernProposal } from "../../services/proposal-workflow/src/authz.js";

test("pilot provisioning plan is deterministic and idempotent", async () => {
  const first = buildAntiplateletStagingProvisioningPlan({ mode: "apply" });
  const second = buildAntiplateletStagingProvisioningPlan({ mode: "apply" });

  assert.deepEqual(second, first);
  assertAntiplateletStagingProvisioningPlan(first);

  const dir = await mkdtemp(join(tmpdir(), "pharmaops-pilot-provision-"));
  const outputPath = join(dir, "state.json");
  try {
    await applyAntiplateletStagingProvisioningPlan({ outputPath });
    const appliedOnce = await readFile(outputPath, "utf8");
    await applyAntiplateletStagingProvisioningPlan({ outputPath });
    const appliedTwice = await readFile(outputPath, "utf8");
    assert.equal(appliedTwice, appliedOnce);

    const verified = await verifyAntiplateletStagingProvisioningPlan({ outputPath });
    assert.equal(verified.plan.plan_digest, first.plan_digest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pilot provisioning is staging-only and does not create controlled production", () => {
  assert.throws(
    () => buildAntiplateletStagingProvisioningPlan({ environment: "controlled-production" }),
    /staging-only/
  );

  const plan = buildAntiplateletStagingProvisioningPlan();
  assert.equal(plan.environments.length, 1);
  assert.equal(plan.environments[0].tenant_id, PILOT_TENANT_ID);
  assert.equal(plan.environments[0].environment, PILOT_ENVIRONMENT);
  assert.equal(plan.environments[0].graph_scope, "working");
  assert.equal(plan.environments[0].controlled_production_enabled, false);
  assert.equal(plan.environments[0].controlled_production_creatable, false);
});

test("pilot human placeholders have exactly one primary tenant-scoped role and limited source entitlements", () => {
  const plan = buildAntiplateletStagingProvisioningPlan();
  const expectedRoles = [
    "platform_admin",
    "data_engineer",
    "curator",
    "expert_reviewer",
    "domain_approver",
    "release_manager",
    "compliance_reviewer",
    "viewer"
  ];

  assert.deepEqual(plan.human_principals.map((principal) => principal.primary_role_key), expectedRoles);
  for (const principal of plan.human_principals) {
    assert.equal(principal.tenant_id, PILOT_TENANT_ID);
    assert.equal(principal.environment, PILOT_ENVIRONMENT);
    assert.equal(principal.role_keys.length, 1);
    assert.equal(principal.role_keys[0], principal.primary_role_key);
    assert.deepEqual(principal.source_entitlement_ids.sort(), [
      "source-entitlement:tenant-pilot-antiplatelet:staging:chembl:CHEMBL_34",
      "source-entitlement:tenant-pilot-antiplatelet:staging:uniprot:2026_02"
    ]);
  }
});

test("connector service accounts are scoped to allowed actions and explicit denies", () => {
  const plan = buildAntiplateletStagingProvisioningPlan();
  assert.deepEqual(plan.service_accounts.map((account) => account.connector_id), ["chembl", "uniprot"]);

  for (const account of plan.service_accounts) {
    assert.equal(account.tenant_id, PILOT_TENANT_ID);
    assert.equal(account.environment, PILOT_ENVIRONMENT);
    assert.equal(account.role_keys.length, 1);
    assert.equal(account.role_keys[0], "service_account");
    assert.equal(account.execution_context.tenant_id, PILOT_TENANT_ID);
    assert.equal(account.execution_context.environment, PILOT_ENVIRONMENT);
    assert.equal(account.execution_context.connector_id, account.connector_id);
    assert.equal(account.execution_context.connector_version, "0.1.0");
    assert.equal(account.execution_context.source_version, account.source_version);
    assert.ok(account.license_policy_id);
    assert.ok(account.correlation_context);

    for (const allowed of account.allowed_actions) {
      assert.doesNotThrow(() => requireConnectorAction(account.execution_context, allowed));
    }
    for (const denied of [
      "graph.write_released",
      "graph.write_release_candidate",
      "proposal.ai_feedback.record",
      "approval.approve",
      "release.promote",
      "export.release_package",
      "rbac.manage_policy",
      "break_glass.activate"
    ]) {
      assert.ok(account.explicit_denies.includes(denied));
    }
    assert.throws(() => requireConnectorAction(account.execution_context, "release.promote"), /forbidden/);
  }
});

test("source entitlements enable only ChEMBL and UniProt and disable FAERS/internal PHI PII", () => {
  const plan = buildAntiplateletStagingProvisioningPlan();
  const enabled = plan.source_entitlements.filter((entitlement) => entitlement.enabled);
  const disabled = plan.source_entitlements.filter((entitlement) => !entitlement.enabled);

  assert.deepEqual(enabled.map((entitlement) => `${entitlement.source_name}:${entitlement.source_version}`), [
    "ChEMBL:CHEMBL_34",
    "UniProt:2026_02"
  ]);
  assert.ok(disabled.find((entitlement) => entitlement.source_key === "openfda_faers"));
  assert.ok(disabled.find((entitlement) => entitlement.source_key === "internal_phi_pii"));
  assert.equal(plan.controls.no_phi_or_pii, true);
});

test("domain approver self-approval and service-account feedback are denied by existing workflow authz", () => {
  const plan = buildAntiplateletStagingProvisioningPlan();
  const approver = plan.human_principals.find((principal) => principal.primary_role_key === "domain_approver");
  const proposal = {
    proposal_id: "proposal:pilot-self-approval",
    proposal_type: "relationship",
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    state: "approver-decision",
    submitted_by_user_id: approver.principal_id,
    validation_result: { status: "passed" }
  };

  assert.throws(
    () => assertCanGovernProposal({
      actor: {
        user_id: approver.principal_id,
        tenant_id: PILOT_TENANT_ID,
        environment: PILOT_ENVIRONMENT,
        role_keys: approver.role_keys
      },
      proposal,
      action: PROPOSAL_ACTIONS.approve,
      tenant_id: PILOT_TENANT_ID,
      environment: PILOT_ENVIRONMENT,
      rationale: "self approval must fail",
      correlation_id: "corr:self-approval"
    }),
    /denied/
  );

  const workflow = new ProposalWorkflowService();
  const serviceAccount = plan.service_accounts[0];
  const submitted = workflow.submitAiSuggestion({
    suggestion: {
      proposal_id: "proposal:pilot-feedback",
      suggestion_id: "suggestion:pilot-feedback",
      tenant_id: PILOT_TENANT_ID,
      environment: PILOT_ENVIRONMENT,
      proposal_type: "relationship",
      title: "AI suggested antiplatelet relationship",
      payload: {
        assertion_type: "model_suggested",
        relationship_id: "pharmrel:pilot-aspirin-target",
        subject: "chembl:CHEMBL25",
        predicate: "pharm:hasKnownTarget",
        object: "uniprot:P23219",
        evidence_refs: [{ evidence_id: "pharmev:pilot-aspirin-target", evidence_role: "supports" }]
      },
      provenance: {
        provenance_id: "pharmprov:pilot/ai-feedback",
        source: "pilot-ai-ingest",
        source_version: "model-run-2026-06-27",
        evidence_ids: ["pharmev:pilot-aspirin-target"],
        model_name: "curation-ranker",
        model_version: "2026-06-27"
      },
      rationale: "Model suggested relationship from source span.",
      score: 0.88,
      confidence_score: 0.88,
      confidence_source: "model_calibrated_score",
      duplicate_status: "not_duplicate",
      source_spans: [
        {
          evidence_id: "pharmev:pilot-aspirin-target",
          field: "abstract",
          start: 10,
          end: 17,
          text: "aspirin"
        }
      ],
      model_name: "curation-ranker",
      model_version: "2026-06-27"
    },
    actor: {
      service_account_id: serviceAccount.principal_id,
      principal_type: "service_account",
      tenant_id: PILOT_TENANT_ID,
      environment: PILOT_ENVIRONMENT
    },
    rationale: "AI candidate from pilot ingestion handoff.",
    correlation_id: "corr:pilot-feedback-submit"
  });
  assert.throws(
    () => workflow.recordSuggestionFeedback({
      proposalId: submitted.proposal.proposal_id,
      actor: {
        user_id: serviceAccount.principal_id,
        service_account_id: serviceAccount.principal_id,
        principal_type: "service_account",
        tenant_id: PILOT_TENANT_ID,
        environment: PILOT_ENVIRONMENT,
        role_keys: ["service_account"]
      },
      feedback: { decision: "accept" },
      rationale: "service account feedback must fail",
      correlation_id: "corr:service-feedback"
    }),
    /service accounts/
  );
});

test("pilot provisioning emits audit events and rollback only removes generated state", async () => {
  const plan = buildAntiplateletStagingProvisioningPlan();
  assert.ok(plan.audit_events.length >= 1);
  assert.ok(plan.audit_events.every((event) => event.tenant_id === PILOT_TENANT_ID));
  assert.ok(plan.audit_events.every((event) => event.environment === PILOT_ENVIRONMENT));

  const dir = await mkdtemp(join(tmpdir(), "pharmaops-pilot-rollback-"));
  const outputPath = join(dir, "state.json");
  try {
    await applyAntiplateletStagingProvisioningPlan({ outputPath });
    const rollback = await rollbackAntiplateletStagingProvisioningPlan({ outputPath });
    assert.equal(rollback.rolled_back, true);
    await assert.rejects(() => readFile(outputPath, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
