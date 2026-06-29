#!/usr/bin/env node
/*
  Staging-only pilot RBAC demonstration harness.

  Usage:
    node scripts/demo-pilot-rbac.mjs

  The script prints an allow/deny matrix for the 8 antiplatelet-pilot
  placeholder principals. It uses existing server-side authorization code paths
  and current DB migration permission seeds. It does not persist releases,
  exports, graph writes, break-glass sessions, or RBAC changes.
*/

import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PILOT_ENVIRONMENT,
  PILOT_TENANT_ID,
  buildAntiplateletStagingProvisioningPlan
} from "../services/ops/src/pilot-provisioning.js";
import {
  COMMON_APPROVED_EXPORT_SCOPES,
  buildPilotSourceLicenseApprovalPacket
} from "../services/ops/src/source-license-export-approval.js";
import { filterAuthorizedResults } from "../services/authz-filter/src/index.js";
import { buildAuthorizedExport } from "../services/export/src/index.js";
import { defaultAssertCanCreateRelease } from "../services/release-manager/src/index.js";
import { PROPOSAL_ACTIONS, assertCanGovernProposal } from "../services/proposal-workflow/src/authz.js";
import { requireConnectorAction } from "../packages/connector-sdk/src/security.js";
import { sha256 } from "../packages/connector-sdk/src/hash.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RELEASE_ID = "mvp-2026-06-27-rc1";
const RELEASE_CANDIDATE_ID = "rc:pilot-rbac-demo";
const CORRELATION_ID = "corr:pilot-rbac-demo";

class DemoDeniedError extends Error {
  constructor(message) {
    super(message);
    this.name = "DemoDeniedError";
  }
}

const plan = buildAntiplateletStagingProvisioningPlan({ mode: "dry-run" });
const sourceLicenseApprovalPacket = buildPilotSourceLicenseApprovalPacket();
const seededPermissions = loadSeededPermissions();

const principals = plan.human_principals.map((principal) => ({
  label: principal.principal_id.split(":").at(-1),
  display: principal.display_name,
  role: principal.primary_role_key,
  principal_id: principal.principal_id,
  actor: {
    user_id: principal.principal_id,
    principal_type: "human_placeholder",
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    role_keys: principal.role_keys,
    allowed_release_ids: [RELEASE_ID]
  }
}));

const operations = [
  {
    key: "read_released",
    label: "read released entity",
    run: ({ actor }) => {
      const rows = filterAuthorizedResults({
        principal: actor,
        action: "read",
        releaseContext: { release_id: RELEASE_ID },
        results: [releasedEntity()]
      });
      if (rows.length !== 1) {
        throw new DemoDeniedError("authz filter removed released entity");
      }
    }
  },
  {
    key: "submit_mapping",
    label: "submit mapping proposal",
    run: ({ actor }) => assertCanGovernProposal({
      actor,
      proposal: null,
      action: PROPOSAL_ACTIONS.submit,
      tenant_id: PILOT_TENANT_ID,
      environment: PILOT_ENVIRONMENT,
      rationale: "RBAC demo mapping proposal submission",
      correlation_id: `${CORRELATION_ID}:submit`
    })
  },
  {
    key: "approve_proposal",
    label: "approve proposal",
    run: ({ actor }) => assertCanGovernProposal({
      actor,
      proposal: proposalForDecision({ submittedBy: "principal:tenant-pilot-antiplatelet:staging:other-curator" }),
      action: PROPOSAL_ACTIONS.approve,
      tenant_id: PILOT_TENANT_ID,
      environment: PILOT_ENVIRONMENT,
      rationale: "RBAC demo non-self approval",
      correlation_id: `${CORRELATION_ID}:approve`
    })
  },
  {
    key: "self_approve",
    label: "self-approval attempt",
    run: ({ actor }) => assertCanGovernProposal({
      actor,
      proposal: proposalForDecision({ submittedBy: actor.user_id }),
      action: PROPOSAL_ACTIONS.approve,
      tenant_id: PILOT_TENANT_ID,
      environment: PILOT_ENVIRONMENT,
      rationale: "RBAC demo self-approval attempt",
      correlation_id: `${CORRELATION_ID}:self-approve`
    })
  },
  {
    key: "stage_release",
    label: "stage approved proposal",
    run: ({ actor }) => assertCanGovernProposal({
      actor,
      proposal: approvedProposal({ submittedBy: "principal:tenant-pilot-antiplatelet:staging:other-curator" }),
      action: PROPOSAL_ACTIONS.stageRelease,
      tenant_id: PILOT_TENANT_ID,
      environment: PILOT_ENVIRONMENT,
      release_id: RELEASE_ID,
      rationale: "RBAC demo staging attempt",
      correlation_id: `${CORRELATION_ID}:stage`
    })
  },
  {
    key: "create_release_candidate",
    label: "create release candidate",
    run: ({ actor }) => defaultAssertCanCreateRelease({
      actor,
      release_id: RELEASE_ID,
      release_candidate_id: RELEASE_CANDIDATE_ID,
      tenant_id: PILOT_TENANT_ID,
      environment: PILOT_ENVIRONMENT,
      included_proposals: [releaseProposalEvidence()],
      validation_summary: { status: "pass", critical: 0, warning: 0 },
      source_version_pins: [
        { source_name: "ChEMBL", source_version: "CHEMBL_34" },
        { source_name: "UniProt", source_version: "2026_02" }
      ],
      validation_report_refs: [
        {
          validation_run_id: "validation:pilot-rbac-demo",
          tenant_id: PILOT_TENANT_ID,
          environment: PILOT_ENVIRONMENT,
          release_id: RELEASE_ID,
          status: "passed",
          immutable: true,
          summary: { critical: 0 }
        }
      ],
      changelog_digest: sha256({ demo: "changelog" }),
      content_hashes_digest: sha256({ demo: "content" }),
      approval_trace_digest: sha256({ demo: "approval" }),
      audit_event_range: {
        first: "audit:proposal:stage:pilot-rbac-demo",
        last: "audit:release-candidate:pilot-rbac-demo:create",
        event_count: 2
      },
      rationale: "RBAC demo release-candidate authorization",
      correlation_id: `${CORRELATION_ID}:release-candidate`
    })
  },
  {
    key: "create_export",
    label: "create export package",
    run: ({ actor }) => {
      const exported = buildAuthorizedExport({
        principal: actor,
        export_id: "export:pilot-rbac-demo",
        releaseContext: { release_id: RELEASE_ID },
        candidateResults: [releasedEntity()],
        sourceLicenseApprovalPacket,
        requestedScopes: COMMON_APPROVED_EXPORT_SCOPES.slice(0, 3),
        action: "export.create"
      });
      if (exported.record_count !== 1) {
        throw new DemoDeniedError("export authz filtered all governed rows");
      }
    }
  },
  {
    key: "manage_rbac",
    label: "assign non-privileged role",
    run: ({ role }) => assertSeededPermission(role, "role.assign_non_privileged")
  },
  {
    key: "activate_break_glass",
    label: "activate break-glass",
    run: ({ role }) => assertSeededPermission(role, "break_glass.activate")
  },
  {
    key: "connector_job",
    label: "run connector job",
    run: ({ role }) => {
      assertSeededPermission(role, "job.run_connector");
      requireConnectorAction(plan.service_accounts[0].execution_context, "connector.run");
    }
  }
];

const matrix = principals.map((principal) => {
  const row = {
    principal: principal.label,
    role: principal.role,
    results: {}
  };
  for (const operation of operations) {
    row.results[operation.key] = runOperation(operation, principal);
  }
  return row;
});

const violations = dangerousAllows(matrix);
printMatrix(matrix, violations);

if (violations.length > 0) {
  process.exitCode = 1;
}

function runOperation(operation, principal) {
  try {
    operation.run(principal);
    return { allowed: true, reason: "allowed by guard" };
  } catch (error) {
    return { allowed: false, reason: denialReason(error) };
  }
}

function printMatrix(rows, violations) {
  const headers = ["principal", "role", ...operations.map((operation) => operation.key)];
  const tableRows = rows.map((row) => [
    row.principal,
    row.role,
    ...operations.map((operation) => formatCell(row.results[operation.key]))
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...tableRows.map((row) => row[index].length))
  );

  console.log("Pilot RBAC demo matrix");
  console.log(`tenant=${PILOT_TENANT_ID} environment=${PILOT_ENVIRONMENT}`);
  console.log("");
  console.log(formatRow(headers, widths));
  console.log(formatRow(widths.map((width) => "-".repeat(width)), widths));
  for (const row of tableRows) {
    console.log(formatRow(row, widths));
  }
  console.log("");
  console.log("Denial reasons");
  for (const row of rows) {
    for (const operation of operations) {
      const result = row.results[operation.key];
      if (!result.allowed) {
        console.log(`- ${row.principal} / ${operation.key}: ${result.reason}`);
      }
    }
  }
  console.log("");
  if (violations.length > 0) {
    console.log("P0 findings");
    for (const violation of violations) {
      console.log(`- ${violation}`);
    }
  } else {
    console.log("P0 findings: none");
  }
}

function formatCell(result) {
  return result.allowed ? "ALLOW" : "DENY";
}

function formatRow(values, widths) {
  return values.map((value, index) => String(value).padEnd(widths[index])).join(" | ");
}

function dangerousAllows(rows) {
  const findings = [];
  const selfApprovalAllows = rows
    .filter((row) => row.results.self_approve.allowed)
    .map((row) => `${row.principal} (${row.role})`);
  if (selfApprovalAllows.length > 0) {
    findings.push(`self-approval succeeded for ${selfApprovalAllows.join(", ")}`);
  }

  const viewer = rows.find((row) => row.role === "viewer");
  if (viewer) {
    for (const key of [
      "approve_proposal",
      "stage_release",
      "create_release_candidate",
      "create_export",
      "manage_rbac",
      "activate_break_glass",
      "connector_job"
    ]) {
      if (viewer.results[key].allowed) {
        findings.push(`viewer was allowed to ${key}`);
      }
    }
  }
  return findings;
}

function releasedEntity(overrides = {}) {
  return {
    id: "relationship:aspirin-cox",
    object_type: "relationship",
    relationship_assertion_id: "relationship:aspirin-cox",
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    assertion_type: "relationship",
    lifecycle_status: "released",
    review_status: "released",
    release_id: RELEASE_ID,
    source_name: "ChEMBL",
    source_version: "CHEMBL_34",
    source_vocabulary_version: "CHEMBL_34",
    target_vocabulary_version: "2026_02",
    provenance_id: "pharmprov:pilot-rbac-demo",
    artifact_hash: sha256({ artifact: "pilot-rbac-demo" }),
    license_status: "valid",
    license_classification: "open_with_attribution",
    license_policy_id: `license-policy:${PILOT_TENANT_ID}:chembl:CHEMBL_34`,
    permitted_uses: ["search", "export", "release"],
    export_restrictions: ["attribution_required"],
    ...overrides
  };
}

function proposalForDecision({ submittedBy }) {
  return {
    proposal_id: "proposal:pilot-rbac-demo",
    proposal_type: "mapping",
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    state: "approver-decision",
    submitted_by_user_id: submittedBy,
    validation_result: { status: "passed", critical_failures: 0, blocking: false },
    payload: {
      mapping_id: "pharmmap:pilot-rbac-demo",
      source_entity_id: "chembl:CHEMBL25",
      target_entity_id: "uniprot:P23219"
    }
  };
}

function approvedProposal({ submittedBy }) {
  return {
    ...proposalForDecision({ submittedBy }),
    state: "approved",
    review_status: "approved",
    reviewed_by: "principal:tenant-pilot-antiplatelet:staging:domain-approver",
    validation_report_id: "validation:pilot-rbac-demo"
  };
}

function releaseProposalEvidence() {
  return {
    proposal_id: "proposal:pilot-rbac-demo",
    proposal_type: "mapping",
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    release_id: RELEASE_ID,
    state: "staged-for-release",
    review_status: "approved",
    reviewed_by: "principal:tenant-pilot-antiplatelet:staging:domain-approver",
    staged_by_role_key: "release_manager",
    validation_report_id: "validation:pilot-rbac-demo"
  };
}

function assertSeededPermission(role, permission) {
  const permissions = seededPermissions.get(role) ?? new Set();
  if (!permissions.has(permission)) {
    throw new DemoDeniedError(`permission ${permission} is not seeded for role ${role}`);
  }
}

function loadSeededPermissions() {
  const migrationDir = resolve(repoRoot, "services/db/migrations");
  const files = readdirSync(migrationDir)
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort();
  const permissionsByRole = new Map();
  for (const file of files) {
    const sql = readFileSync(resolve(migrationDir, file), "utf8");
    const pattern = /JOIN\s+pharmaops\.permissions\s+p\s+ON\s+p\.permission_key\s+IN\s*\(([\s\S]*?)\)\s*WHERE\s+r\.role_key\s*=\s*'([^']+)'/gi;
    for (const match of sql.matchAll(pattern)) {
      const permissions = match[1].match(/'([^']+)'/g)?.map((value) => value.slice(1, -1)) ?? [];
      const role = match[2];
      if (!permissionsByRole.has(role)) {
        permissionsByRole.set(role, new Set());
      }
      for (const permission of permissions) {
        permissionsByRole.get(role).add(permission);
      }
    }
  }
  return permissionsByRole;
}

function denialReason(error) {
  if (error instanceof DemoDeniedError) {
    return error.message;
  }
  if (error?.name && error?.message && error.message !== error.name) {
    return `${error.name}: ${error.message}`;
  }
  return error?.name ?? error?.message ?? "denied by guard";
}
