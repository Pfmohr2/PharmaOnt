import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import { ReleaseManagerService, sha256 } from "../../services/release-manager/src/index.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXED_NOW = "2026-06-27T09:56:00.000Z";
const MVP_RELEASE_ID = "mvp-2026-06-27-rc1";
const MVP_RC_ID = "rc:mvp-2026-06-27";

const GOVERNANCE_ARTIFACTS = Object.freeze({
  validation_package_manifest: "docs/validation/mvp-validation-package/manifest.json",
  validation_report: "docs/validation/mvp-validation-package/validation-report.json",
  validation_evidence_matrix: "docs/validation/mvp-validation-package/evidence-matrix.md",
  security_review: "docs/security/phase7-security-review.md",
  backup_restore_runbook: "docs/runbooks/phase7-backup-restore.md",
  pilot_readiness_readme: "docs/runbooks/pilot-readiness/README.md",
  pilot_plan: "docs/runbooks/pilot-readiness/antiplatelet-aspirin-pilot-plan.md",
  pilot_dataset_checklist: "docs/runbooks/pilot-readiness/dataset-checklist.md",
  pilot_success_kpis: "docs/runbooks/pilot-readiness/success-criteria-kpis.md"
});

test("P7 MVP release candidate binds governance artifacts and remains deployment-gated", async () => {
  const context = mvpReleaseContext();
  const result = await context.service.createReleaseCandidate(mvpReleaseInput());
  const manifest = manifestFor(result);
  const hashes = governanceArtifactHashes();
  const validationPackageManifest = governanceJson("validation_package_manifest");
  const validationReport = governanceJson("validation_report");

  assert.equal(manifest.schema_version, "release-candidate-package.v1");
  assert.equal(manifest.kind, "release_candidate");
  assert.equal(manifest.release_id, MVP_RELEASE_ID);
  assert.equal(manifest.release_candidate_id, MVP_RC_ID);
  assert.equal(manifest.tenant_id, "tenant-pilot-antiplatelet");
  assert.equal(manifest.environment, "staging");
  assert.equal(manifest.manifest_digest, undefined);
  assert.equal(result.manifest_digest, sha256(readFileSync(result.manifest_uri, "utf8")));
  assert.equal(result.release_metadata_record.manifest_digest, result.manifest_digest);
  assert.equal(manifest.content_snapshot.snapshot_digest, result.artifact_hashes.content_snapshot);
  assert.equal(manifest.artifact_hashes.changelog, sha256(manifest.changelog));
  assert.equal(manifest.artifact_hashes.source_version_pins, sha256(manifest.source_version_pins));
  assert.equal(manifest.artifact_hashes.validation_report_refs, sha256(manifest.validation_report_refs));

  for (const [key, digest] of Object.entries(hashes)) {
    assert.equal(manifest.artifact_hashes[key], digest, `${key} digest is bound in release manifest`);
  }
  assert.equal(manifest.artifact_hashes.validation_package_signed_report_digest, validationPackageManifest.report_digest);
  assert.equal(manifest.artifact_hashes.validation_report_signed_digest, validationReport.report_digest);
  assert.equal(manifest.artifact_hashes.security_signoff_decision, "GO");
  assert.equal(manifest.artifact_hashes.backup_restore_rpo_minutes, 15);
  assert.equal(manifest.artifact_hashes.backup_restore_rto_minutes, 60);

  assert.deepEqual(manifest.source_version_pins, [
    { source_name: "ChEMBL", source_version: "CHEMBL_34", approval_required_before_controlled_prod: true },
    { source_name: "UniProt", source_version: "2026_02", approval_required_before_controlled_prod: true },
    { source_name: "Manual curation", source_version: "2026-06-27", approval_required_before_controlled_prod: false },
    { source_name: "PharmaOps validation package", source_version: validationPackageManifest.package_id, digest: validationPackageManifest.report_digest }
  ]);
  assert.deepEqual(manifest.included_graphs, [{
    graph_name: "graph:tenant:tenant-pilot-antiplatelet:staging:release-candidate:mvp-2026-06-27",
    graph_role: "candidate_source_snapshot",
    target_release_graph: null
  }]);
  assert.ok(manifest.validation_report_refs.some((ref) =>
    ref.package_id === "pharmaops-mvp-validation-package-2026-06-27" &&
    ref.report_digest === validationReport.report_digest &&
    ref.immutable === true &&
    ref.signature?.signature === validationReport.signature.signature
  ));
  assert.equal(manifest.validation_result.blocking, false);
  assert.equal(manifest.validation_result.summary.critical, 0);
  assert.equal(manifest.validation_result.summary.warning, 0);
  assert.equal(manifest.changelog.summary, "PharmaOps MVP release candidate assembled for pilot exit review.");
  assert.ok(manifest.changelog.entries.some((entry) => entry.action === "bind_governance_artifacts"));
  assert.ok(manifest.changelog.entries.some((entry) => entry.action === "human_gated_deploy"));
  assert.ok(manifest.approval_trace.some((entry) => entry.decision === "staged_for_release"));
  assert.ok(manifest.approval_trace.some((entry) => entry.decision === "release_candidate_created"));
  assert.equal(manifest.rollback.rollback_target_release_id, "2026.1.0");
  assert.match(manifest.rollback.candidate_snapshot_ref, /^release-candidate:\/\/tenant-pilot-antiplatelet\/rc:mvp-2026-06-27\/snapshot\/sha256:/);

  const [item] = manifest.items;
  assert.equal(item.assertion_type, "human_curated");
  assert.equal(item.governance.release_eligible, true);
  assert.equal(item.governance.disposition, "human_approved_release_candidate");
  assert.equal(item.governance.released_graph_target, "pending_human_infra_deploy");
  assert.equal(item.readiness.software_complete.release_candidate_assembled, true);
  assert.equal(item.readiness.software_complete.validation_p0_p1_gate, "pass");
  assert.equal(item.readiness.software_complete.security_signoff, "GO");
  assert.deepEqual(item.readiness.human_or_infra_required, [
    "staging deploy execution and environment smoke evidence",
    "controlled-prod deploy approval after final EXIT Red Team",
    "per-tenant and per-environment source-license approvals",
    "pilot user access provisioning and training acknowledgment"
  ]);
  assert.equal(JSON.stringify(manifest).includes("model_suggested"), false);
});

test("P7 MVP release candidate still fails closed on critical validation", async () => {
  const blocked = mvpReleaseContext({
    validationReports: [validationReport({
      validation_run_id: "validation:p7:mvp:critical",
      result: "failed",
      severity: "critical",
      summary: { critical: 1, warning: 0 }
    })]
  });

  await assert.rejects(
    () => blocked.service.createReleaseCandidate(mvpReleaseInput({
      staged_entry_ids: ["stage:mvp-critical"],
      correlation_id: "corr:p7:mvp-critical"
    })),
    /critical validation failure blocks release candidate/
  );
  assert.deepEqual(readdirSync(blocked.manifestRoot), []);
  assert.equal(blocked.ledger.records.length, 0);
  assert.equal(blocked.auditStore.events.length, 0);
});

test("P7 MVP release candidate blocks raw model_suggested content before manifest or ledger persistence", async () => {
  const blocked = mvpReleaseContext({
    resolveStagedItem(entry) {
      return mvpGovernedItem({
        proposal_id: entry.proposal_id,
        assertion_type: "model_suggested",
        governance: {
          release_eligible: false,
          auto_publish: false,
          released_graph_target: null,
          disposition: "candidate_only"
        }
      });
    }
  });

  await assert.rejects(
    () => blocked.service.createReleaseCandidate(mvpReleaseInput({
      release_id: "mvp-2026-06-27-model-suggested-denied",
      semantic_version: "2026.06.27-mvp-ms-denied",
      release_candidate_id: "rc:mvp-2026-06-27-ms-denied",
      staged_entry_ids: ["stage:mvp"],
      correlation_id: "corr:p7:mvp-model-suggested"
    })),
    /model_suggested items cannot enter release candidate assembly/
  );
  assert.deepEqual(readdirSync(blocked.manifestRoot), []);
  assert.equal(blocked.ledger.records.length, 0);
  assert.equal(blocked.auditStore.events.length, 1);
  assert.equal(blocked.auditStore.events[0].denial_reason, "model_suggested_release_blocked");
});

function mvpReleaseContext(overrides = {}) {
  const manifestRoot = overrides.manifestRoot
    ?? process.env.PHARMAOPS_MVP_RELEASE_MANIFEST_ROOT
    ?? mkdtempSync(join(tmpdir(), "pharmaops-p7-mvp-release-"));
  const ledger = new MemoryReleaseLedger();
  const auditStore = new MemoryAuditStore();
  const stagedEntries = overrides.stagedEntries ?? [
    stagedEntry({ staging_id: "stage:mvp", validation_report_id: "validation:p7:mvp" }),
    stagedEntry({ staging_id: "stage:mvp-critical", validation_report_id: "validation:p7:mvp:critical" })
  ];
  const validationReports = overrides.validationReports ?? [
    validationReport({ validation_run_id: "validation:p7:mvp" }),
    validationReport({ validation_run_id: "validation:p7:mvp:critical" })
  ];
  const proposalWorkflowService = {
    async stagedEntries({ tenant_id, environment, release_id }) {
      return stagedEntries
        .filter((entry) => entry.tenant_id === tenant_id && entry.environment === environment)
        .map((entry) => ({ ...entry, release_id }));
    },
    auditFor(proposal_id) {
      return [{ audit_event_id: `audit:${proposal_id}:approved`, event_type: "proposal_approved" }];
    }
  };
  const validationRunResolver = {
    async resolveValidationReports({ release_id, release_candidate_id, staged_entries, items }) {
      return staged_entries.map((entry) => ({
        ...validationReports.find((report) => report.validation_run_id === entry.validation_report_id),
        release_id,
        release_candidate_id,
        subject_id: release_candidate_id,
        item_ids: items.map((item) => item.mapping_id)
      }));
    }
  };
  const service = new ReleaseManagerService({
    manifestRoot,
    releaseLedger: ledger,
    proposalWorkflowService,
    validationRunResolver,
    assertCanCreateReleaseCandidate: deterministicReleaseDecision,
    resolveStagedItem: overrides.resolveStagedItem ?? ((entry) => mvpGovernedItem({ proposal_id: entry.proposal_id })),
    auditStore,
    clock: () => new Date(FIXED_NOW)
  });
  return { service, manifestRoot, ledger, auditStore };
}

function mvpReleaseInput(overrides = {}) {
  const validationPackageManifest = governanceJson("validation_package_manifest");
  const validationReport = governanceJson("validation_report");
  return {
    tenant_id: "tenant-pilot-antiplatelet",
    environment: "staging",
    release_id: MVP_RELEASE_ID,
    semantic_version: "2026.06.27-mvp-rc1",
    release_candidate_id: MVP_RC_ID,
    previous_release_id: "2026.1.0",
    rollback_target_release_id: "2026.1.0",
    actor: releaseManagerActor(),
    working_graph: "graph:tenant:tenant-pilot-antiplatelet:staging:working",
    staged_entry_ids: ["stage:mvp"],
    source_version_pins: [
      { source_name: "ChEMBL", source_version: "CHEMBL_34", approval_required_before_controlled_prod: true },
      { source_name: "UniProt", source_version: "2026_02", approval_required_before_controlled_prod: true },
      { source_name: "Manual curation", source_version: "2026-06-27", approval_required_before_controlled_prod: false },
      { source_name: "PharmaOps validation package", source_version: validationPackageManifest.package_id, digest: validationPackageManifest.report_digest }
    ],
    included_graphs: [{
      graph_name: "graph:tenant:tenant-pilot-antiplatelet:staging:release-candidate:mvp-2026-06-27",
      graph_role: "candidate_source_snapshot",
      target_release_graph: null
    }],
    ontology_modules: [
      "packages/ontology/core.ttl",
      "packages/ontology/pharmaops-control-plane.ttl"
    ],
    mapping_files: [
      "pilot-fixtures/antiplatelet-aspirin/mappings.ttl"
    ],
    export_uris: [
      "release-candidate://tenant-pilot-antiplatelet/rc:mvp-2026-06-27/export/manifest"
    ],
    changelog: {
      summary: "PharmaOps MVP release candidate assembled for pilot exit review.",
      entries: [
        {
          ordinal: 1,
          object_type: "release_candidate",
          object_id: MVP_RC_ID,
          action: "assemble_immutable_candidate",
          title: "Cut immutable MVP candidate snapshot from approved staged governance package"
        },
        {
          ordinal: 2,
          object_type: "governance_artifacts",
          object_id: validationPackageManifest.package_id,
          action: "bind_governance_artifacts",
          title: "Bind validation package, security sign-off, backup/restore RPO/RTO, and pilot-readiness docs"
        },
        {
          ordinal: 3,
          object_type: "deployment_gate",
          object_id: "human-infra-live-deploy",
          action: "human_gated_deploy",
          title: "Live staging and controlled-prod promotion remain human/infra actions"
        }
      ]
    },
    artifact_hashes: {
      ...governanceArtifactHashes(),
      validation_package_signed_report_digest: validationPackageManifest.report_digest,
      validation_report_signed_digest: validationReport.report_digest,
      validation_report_signature: validationReport.signature.signature,
      security_signoff_decision: "GO",
      backup_restore_rpo_minutes: 15,
      backup_restore_rto_minutes: 60,
      readiness_gate: "software_complete_human_infra_gated"
    },
    known_issues: [
      {
        issue_id: "P7-P2-001",
        severity: "P2",
        status: "accepted_for_pilot_gate",
        summary: "Live DB/Fuseki tests require staging CI evidence or approved waiver."
      },
      {
        issue_id: "P7-P2-003",
        severity: "P2",
        status: "human_gated",
        summary: "Per-tenant/environment source-license approvals are required before controlled-prod promotion."
      }
    ],
    ontology_digest: sha256("pharmaops-mvp-ontology-modules-2026-06-27"),
    shape_digest: sha256("pharmaops-mvp-shacl-shapes-2026-06-27"),
    rationale: "Assemble PharmaOps MVP release candidate after Wave A green prerequisites.",
    correlation_id: "corr:p7:mvp-release",
    ...overrides
  };
}

function mvpGovernedItem(overrides = {}) {
  const validationPackageManifest = governanceJson("validation_package_manifest");
  const validationReport = governanceJson("validation_report");
  return {
    object_type: "release_candidate_bundle",
    release_item_id: "release-item:p7:mvp-antiplatelet-aspirin",
    mapping_id: "mapping:p7:mvp-antiplatelet-aspirin",
    proposal_id: "proposal:p7:mvp",
    tenant_id: "tenant-pilot-antiplatelet",
    environment: "staging",
    title: "Antiplatelet aspirin MVP semantic control-plane pilot candidate",
    assertion_type: "human_curated",
    source_entity_id: "chembl:CHEMBL25",
    target_entity_id: "pharm:compound/aspirin",
    predicate: "skos:exactMatch",
    source_vocabulary_version: "CHEMBL_34",
    target_vocabulary_version: "2026-06-27",
    provenance_id: "pharmprov:p7-mvp-release",
    evidence_refs: [
      { evidence_id: "evidence:p7:mvp-validation", evidence_role: "supports", required_for_release: true },
      { evidence_id: "evidence:p7:security-review", evidence_role: "supports", required_for_release: true },
      { evidence_id: "evidence:p7:backup-restore", evidence_role: "supports", required_for_release: true },
      { evidence_id: "evidence:p7:pilot-readiness", evidence_role: "supports", required_for_release: true }
    ],
    confidence_score: 0.98,
    confidence_band: "high",
    confidence_source: "human_governed_release_readiness",
    review_status: "approved",
    reviewed_by: "user:release-manager-p7",
    workflow_status: "staged_for_release",
    validation_package: {
      package_id: validationPackageManifest.package_id,
      report_digest: validationPackageManifest.report_digest,
      report_signature: validationReport.signature.signature,
      gate: validationReport.summary.release_gate,
      unresolved_p0_p1_count: validationReport.summary.unresolved_p0_p1_count
    },
    governance_artifacts: artifactReferences(),
    governance: {
      release_eligible: true,
      released_graph_target: "pending_human_infra_deploy",
      disposition: "human_approved_release_candidate"
    },
    readiness: {
      software_complete: {
        release_candidate_assembled: true,
        validation_p0_p1_gate: validationReport.summary.p0_p1_gate,
        security_signoff: "GO",
        backup_restore_rpo_minutes: 15,
        backup_restore_rto_minutes: 60,
        rollback_plan_bound: true,
        immutable_snapshot_created: true
      },
      human_or_infra_required: [
        "staging deploy execution and environment smoke evidence",
        "controlled-prod deploy approval after final EXIT Red Team",
        "per-tenant and per-environment source-license approvals",
        "pilot user access provisioning and training acknowledgment"
      ]
    },
    ...overrides
  };
}

function stagedEntry(overrides = {}) {
  const proposal_id = overrides.proposal_id ?? "proposal:p7:mvp";
  return {
    staging_id: "stage:mvp",
    proposal_id,
    proposal_type: "mvp_release_candidate_bundle",
    tenant_id: "tenant-pilot-antiplatelet",
    environment: "staging",
    release_id: MVP_RELEASE_ID,
    staged_by_user_id: "user:release-manager-p7",
    staged_by_role_key: "release_manager",
    staged_at: FIXED_NOW,
    audit_event_id: `audit:${proposal_id}:staged`,
    payload_hash: sha256(mvpGovernedItem({ proposal_id })),
    validation_report_id: "validation:p7:mvp",
    ...overrides
  };
}

function validationReport(overrides = {}) {
  const validationPackageManifest = governanceJson("validation_package_manifest");
  const validationReport = governanceJson("validation_report");
  return {
    validation_run_id: "validation:p7:mvp",
    tenant_id: "tenant-pilot-antiplatelet",
    environment: "staging",
    release_id: MVP_RELEASE_ID,
    release_candidate_id: MVP_RC_ID,
    package_id: validationPackageManifest.package_id,
    package_path: "docs/validation/mvp-validation-package",
    subject_type: "release_candidate",
    subject_id: MVP_RC_ID,
    input_payload_digest: sha256(validationPackageManifest),
    report_digest: validationReport.report_digest,
    immutable_storage_digest: validationReport.report_digest,
    immutable_record_id: "validation-record:p7:mvp-validation-package",
    ruleset_version: validationReport.schema_version,
    signature: validationReport.signature,
    result: "passed",
    severity: "none",
    immutable: true,
    persisted: true,
    summary: { critical: 0, warning: 0 },
    release_gate: validationReport.summary.release_gate,
    ...overrides
  };
}

function deterministicReleaseDecision(input) {
  const issued_at = FIXED_NOW;
  const expires_at = "2026-06-27T10:01:00.000Z";
  const decision_binding = sha256({
    action: "release_candidate.create",
    release_id: input.release_id,
    release_candidate_id: input.release_candidate_id,
    correlation_id: input.correlation_id
  });
  return {
    decision_id: `decision:${input.release_candidate_id}`,
    decision: "allow",
    allowed: true,
    action: "release_candidate.create",
    actor_user_id: input.actor.user_id,
    actor_role_key: "release_manager",
    tenant_id: input.tenant_id,
    environment: input.environment,
    release_id: input.release_id,
    release_candidate_id: input.release_candidate_id,
    included_proposal_ids_digest: sha256(input.included_proposals.map((proposal) => proposal.proposal_id ?? proposal.id)),
    all_approved: true,
    validation_passed: true,
    validation_summary_digest: sha256(input.validation_summary),
    source_version_pins_digest: sha256(input.source_version_pins),
    validation_report_refs_digest: sha256(input.validation_report_refs),
    changelog_digest: input.changelog_digest,
    content_hashes_digest: input.content_hashes_digest,
    approval_trace_digest: input.approval_trace_digest,
    audit_event_range_digest: sha256(input.audit_event_range),
    rationale_digest: sha256(input.rationale),
    audit_event_id: input.audit_event_range.last,
    correlation_id: input.correlation_id,
    issued_at,
    expires_at,
    decision_binding,
    signature: sha256({ decision_binding, purpose: "release_candidate.create" })
  };
}

function governanceArtifactHashes() {
  return Object.fromEntries(
    Object.entries(GOVERNANCE_ARTIFACTS).map(([key, relativePath]) => [
      key,
      sha256(readFileSync(join(PROJECT_ROOT, relativePath), "utf8"))
    ])
  );
}

function artifactReferences() {
  const hashes = governanceArtifactHashes();
  return Object.entries(GOVERNANCE_ARTIFACTS).map(([key, path]) => ({
    artifact_key: key,
    path,
    digest: hashes[key]
  }));
}

function governanceJson(key) {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, GOVERNANCE_ARTIFACTS[key]), "utf8"));
}

function manifestFor(result) {
  return JSON.parse(readFileSync(result.manifest_uri, "utf8"));
}

function releaseManagerActor() {
  return {
    user_id: "user:release-manager-p7",
    role_keys: ["release_manager"],
    tenant_id: "tenant-pilot-antiplatelet",
    environment: "staging"
  };
}

class MemoryReleaseLedger {
  constructor() {
    this.records = [];
  }

  async insertReleaseMetadata(record) {
    this.records.push(structuredClone(record));
    return structuredClone(record);
  }

  async getReleaseMetadata({ tenant_id, environment, release_id }) {
    const record = this.records.find((item) =>
      item.tenant_id === tenant_id &&
      item.environment === environment &&
      item.release_id === release_id
    );
    return record ? structuredClone(record) : null;
  }
}

class MemoryAuditStore {
  constructor() {
    this.events = [];
  }

  async append(event) {
    const persisted = Object.freeze(structuredClone(event));
    this.events.push(persisted);
    return persisted;
  }
}
