import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ReleaseManagerService, sha256 } from "../../services/release-manager/src/index.js";

test("P7 release drill cuts release, verifies immutable integrity, rolls back, and blocks critical failures", async () => {
  const drill = releaseDrillContext();

  const prior = await drill.service.createReleaseCandidate(releaseInput({
    release_id: "2026.0.0",
    semantic_version: "2026.0.0",
    release_candidate_id: "rc:2026.0.0",
    previous_release_id: "2025.4.0",
    rollback_target_release_id: "2025.4.0",
    staged_entry_ids: ["stage:prior"],
    rationale: "P7 drill prior baseline release.",
    correlation_id: "corr:p7:prior"
  }));
  const priorManifest = manifestFor(prior);
  assertManifestIntegrity({ result: prior, manifest: priorManifest, release_id: "2026.0.0" });

  const next = await drill.service.createReleaseCandidate(releaseInput({
    release_id: "2026.1.0",
    semantic_version: "2026.1.0",
    release_candidate_id: "rc:2026.1.0",
    previous_release_id: "2026.0.0",
    rollback_target_release_id: "2026.0.0",
    staged_entry_ids: ["stage:next"],
    rationale: "P7 drill MVP candidate release.",
    correlation_id: "corr:p7:next"
  }));
  const nextManifest = manifestFor(next);
  assertManifestIntegrity({ result: next, manifest: nextManifest, release_id: "2026.1.0" });
  assert.notEqual(next.release_candidate.content_snapshot.snapshot_digest, prior.release_candidate.content_snapshot.snapshot_digest);
  assert.equal(next.rollback.rollback_target_release_id, "2026.0.0");

  const activePointers = [];
  const releasePointerStore = {
    async activate(pointer) {
      activePointers.push(structuredClone(pointer));
      return { ...pointer, status: "active" };
    }
  };

  const rollback = await drill.service.restoreRollback({
    rollbackMetadata: {
      tenant_id: "tenant-a",
      environment: "staging",
      release_id: "2026.1.0",
      rollback_target_release_id: "2026.0.0",
      snapshot_ref: "caller-supplied://must-not-win"
    },
    releasePointerStore,
    actor: releaseManagerActor(),
    rationale: "P7 rollback drill.",
    correlation_id: "corr:p7:rollback"
  });

  assert.equal(rollback.active_release_id, "2026.0.0");
  assert.equal(rollback.snapshot_ref, priorManifest.snapshot_ref);
  assert.notEqual(rollback.snapshot_ref, "caller-supplied://must-not-win");
  assert.deepEqual(rollback.source_version_pins, priorManifest.source_version_pins);
  assert.equal(rollback.audit_event_type, "release.rollback");
  assert.equal(activePointers.length, 1);
  assert.deepEqual(activePointers[0].source_version_pins, priorManifest.source_version_pins);
  assert.equal(drill.auditStore.events.at(-1).event_type, "release_rollback");

  const blocked = releaseDrillContext({
    validationReports: [validationReport({
      validation_run_id: "validation:p7:critical",
      result: "failed",
      severity: "critical",
      summary: { critical: 1, warning: 0 }
    })]
  });
  await assert.rejects(
    () => blocked.service.createReleaseCandidate(releaseInput({
      release_id: "2026.2.0",
      semantic_version: "2026.2.0",
      release_candidate_id: "rc:2026.2.0",
      previous_release_id: "2026.1.0",
      rollback_target_release_id: "2026.1.0",
      staged_entry_ids: ["stage:critical"],
      rationale: "P7 drill critical validation blocker.",
      correlation_id: "corr:p7:critical"
    })),
    /critical validation failure blocks release candidate/
  );
  assert.deepEqual(readdirSync(blocked.manifestRoot), []);
  assert.equal(blocked.ledger.records.length, 0);
  assert.equal(blocked.auditStore.events.length, 0);
});

function releaseDrillContext(overrides = {}) {
  const manifestRoot = mkdtempSync(join(tmpdir(), "pharmaops-p7-release-drill-"));
  const ledger = new MemoryReleaseLedger();
  const auditStore = new MemoryAuditStore();
  const stagedEntries = overrides.stagedEntries ?? [
    stagedEntry({ staging_id: "stage:prior", proposal_id: "proposal:p7-baseline", validation_report_id: "validation:p7:prior" }),
    stagedEntry({ staging_id: "stage:next", proposal_id: "proposal:p7-next", validation_report_id: "validation:p7:next" }),
    stagedEntry({ staging_id: "stage:critical", proposal_id: "proposal:p7-critical", validation_report_id: "validation:p7:critical" })
  ];
  const validationReports = overrides.validationReports ?? [
    validationReport({ validation_run_id: "validation:p7:prior" }),
    validationReport({ validation_run_id: "validation:p7:next" }),
    validationReport({ validation_run_id: "validation:p7:critical" })
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
    resolveStagedItem(entry) {
      return mappingItem({
        proposal_id: entry.proposal_id,
        mapping_id: `mapping:${entry.proposal_id.split(":").at(-1)}`
      });
    },
    auditStore,
    clock: () => new Date("2026-06-27T09:32:00.000Z")
  });
  return { service, manifestRoot, ledger, auditStore };
}

function deterministicReleaseDecision(input) {
  const issued_at = "2026-06-27T09:32:00.000Z";
  const expires_at = "2026-06-27T09:37:00.000Z";
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

function releaseInput(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    environment: "staging",
    actor: releaseManagerActor(),
    working_graph: "graph:tenant:tenant-a:staging:working",
    source_version_pins: [
      { source_name: "ChEMBL", source_version: "34" },
      { source_name: "Manual curation", source_version: "2026-06-27" }
    ],
    included_graphs: [{
      graph_name: `release-candidate:${overrides.release_candidate_id}:content`,
      graph_role: "candidate_source_snapshot",
      target_release_graph: null
    }],
    ...overrides
  };
}

function stagedEntry(overrides = {}) {
  return {
    staging_id: "stage:p7",
    proposal_id: "proposal:p7",
    proposal_type: "mapping",
    tenant_id: "tenant-a",
    environment: "staging",
    release_id: "pending",
    staged_by_user_id: "user:release-manager-p7",
    staged_by_role_key: "release_manager",
    staged_at: "2026-06-27T09:32:00.000Z",
    audit_event_id: `audit:${overrides.proposal_id ?? "proposal:p7"}:staged`,
    payload_hash: `sha256:${"1".repeat(64)}`,
    validation_report_id: "validation:p7",
    ...overrides
  };
}

function validationReport(overrides = {}) {
  return {
    validation_run_id: "validation:p7",
    tenant_id: "tenant-a",
    environment: "staging",
    release_id: "pending",
    release_candidate_id: "pending",
    subject_type: "release_candidate",
    subject_id: "pending",
    input_payload_digest: `sha256:${"a".repeat(64)}`,
    report_digest: `sha256:${"b".repeat(64)}`,
    immutable_record_id: "validation-record:p7",
    ruleset_version: "phase7.release-drill.v1",
    signature: `sha256:${"c".repeat(64)}`,
    result: "passed",
    severity: "none",
    immutable: true,
    persisted: true,
    summary: { critical: 0, warning: 0 },
    ...overrides
  };
}

function mappingItem(overrides = {}) {
  return {
    object_type: "mapping",
    mapping_id: "mapping:p7",
    tenant_id: "tenant-a",
    environment: "staging",
    source_entity_id: "chembl:CHEMBL25",
    target_entity_id: "pharm:compound/aspirin",
    predicate: "skos:exactMatch",
    source_vocabulary_version: "34",
    target_vocabulary_version: "2026-06-27",
    provenance_id: "pharmprov:p7-release-drill",
    evidence_refs: [{ evidence_id: "evidence:p7", evidence_role: "supports", required_for_release: true }],
    confidence_score: 0.97,
    confidence_band: "high",
    confidence_source: "deterministic_match",
    review_status: "approved",
    reviewed_by: "user:domain-approver-p7",
    workflow_status: "staged_for_release",
    ...overrides
  };
}

function assertManifestIntegrity({ result, manifest, release_id }) {
  assert.equal(manifest.release_id, release_id);
  assert.equal(result.release_metadata_record.manifest_digest, result.manifest_digest);
  assert.equal(result.manifest_digest, sha256(readFileSync(result.manifest_uri, "utf8")));
  assert.equal(manifest.content_snapshot.snapshot_digest, result.artifact_hashes.content_snapshot);
  assert.equal(manifest.artifact_hashes.source_version_pins, sha256(manifest.source_version_pins));
  assert.equal(manifest.artifact_hashes.validation_report_refs, sha256(manifest.validation_report_refs));
  assert.equal(manifest.validation_result.blocking, false);
  assert.equal(manifest.validation_report_refs[0].immutable, true);
  assert.ok(manifest.approval_trace.some((entry) => entry.decision === "staged_for_release"));
  assert.ok(manifest.approval_trace.some((entry) => entry.decision === "release_candidate_created"));
  assert.ok(manifest.audit_event_range.first);
  assert.ok(manifest.audit_event_range.last);
  assert.ok(manifest.rollback.rollback_target_release_id);
  assert.match(manifest.content_snapshot.snapshot_ref, /^release-candidate:\/\/tenant-a\/rc:/);
}

function manifestFor(result) {
  return JSON.parse(readFileSync(result.manifest_uri, "utf8"));
}

function releaseManagerActor() {
  return {
    user_id: "user:release-manager-p7",
    role_keys: ["release_manager"],
    tenant_id: "tenant-a",
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
