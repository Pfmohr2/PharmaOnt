import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PILOT_DAY1_SEARCHES,
  PILOT_TRAINING_SESSIONS,
  applyPilotOnboarding,
  buildPilotOnboardingPlan,
  dryRunPilotOnboarding,
  verifyPilotOnboarding
} from "../../services/ops/src/pilot-onboarding.js";
import {
  PILOT_ENVIRONMENT,
  PILOT_TENANT_ID,
  applyAntiplateletStagingProvisioningPlan,
  buildAntiplateletStagingProvisioningPlan
} from "../../services/ops/src/pilot-provisioning.js";

test("pilot onboarding dry-run validates roster without mutating staging state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pharmaops-pilot-onboarding-dry-"));
  const statePath = join(dir, "state.json");
  const rosterPath = join(dir, "roster.json");
  try {
    await applyAntiplateletStagingProvisioningPlan({ outputPath: statePath });
    const before = await readFile(statePath, "utf8");
    await writeFile(rosterPath, JSON.stringify(validRoster(), null, 2), "utf8");

    const result = await dryRunPilotOnboarding({ rosterPath, statePath });
    const after = await readFile(statePath, "utf8");

    assert.equal(after, before);
    assert.equal(result.mode, "dry-run");
    assert.equal(result.summary.would_activate_count, 2);
    assert.deepEqual(result.errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pilot onboarding apply is idempotent and activates mapped placeholders only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pharmaops-pilot-onboarding-apply-"));
  const statePath = join(dir, "state.json");
  const rosterPath = join(dir, "roster.json");
  try {
    await applyAntiplateletStagingProvisioningPlan({ outputPath: statePath });
    await writeFile(rosterPath, JSON.stringify(validRoster(), null, 2), "utf8");

    const first = await applyPilotOnboarding({ rosterPath, statePath });
    const appliedOnce = await readFile(statePath, "utf8");
    const second = await applyPilotOnboarding({ rosterPath, statePath });
    const appliedTwice = await readFile(statePath, "utf8");

    assert.equal(appliedTwice, appliedOnce);
    assert.equal(first.verification.ok, true);
    assert.equal(second.verification.ok, true);
    assert.equal(first.verification.mapped_user_count, 2);

    const state = JSON.parse(appliedTwice);
    const curator = state.human_principals.find((principal) => principal.principal_id.endsWith(":curator"));
    const approver = state.human_principals.find((principal) => principal.principal_id.endsWith(":domain-approver"));
    const releaseManager = state.human_principals.find((principal) => principal.principal_id.endsWith(":release-manager"));
    assert.equal(curator.status, "active");
    assert.equal(approver.status, "active");
    assert.equal(releaseManager.status, "placeholder_pending_sso_mapping");
    assert.equal(state.sso_mappings.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pilot onboarding rejects service-account SSO, duplicate principal mapping, and missing acknowledgments", () => {
  const state = provisioningState();
  const roster = validRoster({
    users: [
      {
        ...validUser("curator", "sub-curator"),
        training_acknowledgments: PILOT_TRAINING_SESSIONS.slice(0, 2).map((session_id) => ({ session_id, status: "acknowledged" }))
      },
      validUser("curator", "sub-duplicate-principal"),
      validUser("svc:tenant-pilot-antiplatelet:staging:chembl-ingestion", "sub-service")
    ]
  });

  const result = buildPilotOnboardingPlan({ roster, state });

  assert.ok(result.errors.some((error) => error.includes("missing training acknowledgments")));
  assert.ok(result.errors.some((error) => error.includes("duplicates a placeholder principal")));
  assert.ok(result.errors.some((error) => error.includes("service accounts cannot use SSO")));
  assert.equal(result.summary.unmapped_users.length, 3);
  assert.equal(result.summary.missing_acknowledgments.length, 1);
});

test("pilot onboarding verify proves tenant/env scope, role cardinality, entitlements, audit events, and Day-1 confirmations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pharmaops-pilot-onboarding-verify-"));
  const statePath = join(dir, "state.json");
  const rosterPath = join(dir, "roster.json");
  try {
    await applyAntiplateletStagingProvisioningPlan({ outputPath: statePath });
    await writeFile(rosterPath, JSON.stringify(validRoster(), null, 2), "utf8");
    await applyPilotOnboarding({ rosterPath, statePath });

    const verified = await verifyPilotOnboarding({ statePath });

    assert.equal(verified.verification.ok, true);
    assert.equal(verified.verification.tenant_id, PILOT_TENANT_ID);
    assert.equal(verified.verification.environment, PILOT_ENVIRONMENT);
    assert.deepEqual(verified.verification.missing_acknowledgments, []);
    assert.deepEqual(verified.verification.missing_day1_confirmations, []);
    assert.equal(verified.verification.controls.staging_only, true);
    assert.equal(verified.verification.controls.no_controlled_prod, true);
    assert.equal(verified.verification.controls.sso_authentication_only, true);
    assert.equal(verified.verification.controls.no_rbac_model_change, true);
    assert.equal(verified.verification.controls.no_service_account_sso, true);
    assert.equal(verified.verification.audit_event_count, 8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function validRoster(overrides = {}) {
  return {
    schema_version: "pilot-antiplatelet-onboarding-roster.v1",
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    users: [
      validUser("curator", "sub-curator"),
      validUser("domain-approver", "sub-approver")
    ],
    ...overrides
  };
}

function validUser(principalSlug, subject) {
  const principal_id = principalSlug.startsWith("svc:")
    ? principalSlug
    : `principal:tenant-pilot-antiplatelet:staging:${principalSlug}`;
  return {
    issuer: "https://idp.example.com/",
    subject,
    email: `${subject}@example.com`,
    display_name: `Pilot ${subject}`,
    principal_id,
    training_acknowledgments: PILOT_TRAINING_SESSIONS.map((session_id) => ({ session_id, status: "acknowledged" })),
    day1_access_confirmation: {
      searches: [...PILOT_DAY1_SEARCHES],
      entity_page_opened: true,
      evidence_inspected: true,
      expected_role_actions_only: true,
      no_hidden_unauthorized_counts: true,
      no_out_of_scope_sources_or_actions: true
    }
  };
}

function provisioningState() {
  return buildAntiplateletStagingProvisioningPlan({ mode: "apply" });
}
