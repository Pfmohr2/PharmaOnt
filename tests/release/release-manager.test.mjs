import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ReleaseManagerService, sha256 } from "../../services/release-manager/src/index.js";

test("release manager creates RC only from verified staged entries, resolved validation records, audit, and ledger digest", async () => {
  const context = releaseManagerContext();

  const result = await context.service.createReleaseCandidate(validReleaseCandidateInput());
  const manifest = JSON.parse(readFileSync(result.manifest_uri, "utf8"));

  assert.equal(manifest.schema_version, "release-candidate-package.v1");
  assert.equal(manifest.release_id, "2026.0.0-rc1");
  assert.equal(manifest.staged_entries[0].staging_id, "stage:proposal-1");
  assert.equal(manifest.validation_report_refs[0].immutable, true);
  assert.equal(manifest.audit_event_range.last, "audit:release-candidate:rc:2026.0.0-rc1:create");
  assert.equal(manifest.authorization_decision.action, "release_candidate.create");
  assert.equal(manifest.authorization_decision.validation_passed, true);
  assert.match(manifest.authorization_decision.signature, /^sha256:[a-f0-9]{64}$/);
  assert.equal(context.auditStore.events.length, 1);
  assert.equal(context.auditStore.events[0].audit_event_id, manifest.audit_event_range.last);
  assert.equal(result.manifest_digest, sha256(readFileSync(result.manifest_uri, "utf8")));
  assert.equal(context.ledger.records[0].manifest_digest, result.manifest_digest);
  assert.equal(context.ledger.records[0].audit_event_range.last, manifest.audit_event_range.last);
  assert.equal(context.proposalWorkflowService.calls.length, 1);
  assert.equal(context.validationRunResolver.calls.length, 1);
});

test("P4-RT-001: release manager rejects forged raw caller-supplied approved items", async () => {
  const context = releaseManagerContext();

  await assert.rejects(
    () => context.service.createReleaseCandidate({
      ...validReleaseCandidateInput(),
      release_candidate_id: "rc:p4-probe",
      items: [validMappingItem()]
    }),
    /not caller-supplied staged data/
  );
  assert.deepEqual(readdirSync(context.manifestRoot), []);
  assert.equal(context.auditStore.events.length, 0);
});

test("P4-RT-002: resolved critical validation records block RC even when caller marks them resolved", async () => {
  const context = releaseManagerContext({
    validationReports: [{
      ...validValidationReport(),
      result: "failed",
      severity: "critical",
      resolved: true,
      summary: { critical: 1, warning: 0 }
    }]
  });

  await assert.rejects(
    () => context.service.createReleaseCandidate({
      ...validReleaseCandidateInput(),
      validation_report_refs: [{ validation_run_id: "validation:p4-release", result: "failed", severity: "critical", resolved: true }]
    }),
    /critical validation failure blocks release candidate/
  );
  assert.deepEqual(readdirSync(context.manifestRoot), []);
  assert.equal(context.auditStore.events.length, 0);
});

test("P4-RT-003: downstream manifest load verifies ledger digest and detects mutation after create", async () => {
  const context = releaseManagerContext();
  const result = await context.service.createReleaseCandidate(validReleaseCandidateInput());
  const tampered = JSON.parse(readFileSync(result.manifest_uri, "utf8"));
  tampered.schema_version = "tampered";
  writeFileSync(result.manifest_uri, `${JSON.stringify(tampered, null, 2)}\n`);

  await assert.rejects(
    () => context.service.loadReleaseCandidate({
      tenant_id: "tenant-a",
      environment: "test",
      release_id: "2026.0.0-rc1"
    }),
    /manifest digest mismatch/
  );
});

test("P4-RT-004 and P4-RT-005: rollback resolves canonical metadata, ignores caller snapshot, and audits", async () => {
  const context = releaseManagerContext({
    stagedEntry: { ...validStagedEntry(), release_id: "2025.4.0" }
  });
  await context.service.createReleaseCandidate({
    ...validReleaseCandidateInput(),
    release_id: "2025.4.0",
    semantic_version: "2025.4.0",
    release_candidate_id: "rc:2025.4.0",
    previous_release_id: "2025.3.0",
    rollback_target_release_id: "2025.3.0"
  });
  const activations = [];
  const releasePointerStore = {
    async activate(pointer) {
      activations.push(pointer);
      return { ...pointer, status: "active" };
    }
  };

  const result = await context.service.restoreRollback({
    rollbackMetadata: {
      tenant_id: "tenant-a",
      environment: "test",
      release_id: "2026.0.0",
      rollback_target_release_id: "2025.4.0",
      prior_snapshot_ref: "tampered://caller-supplied"
    },
    releasePointerStore,
    actor: validReleaseManager(),
    rationale: "Rollback drill for Phase 4.",
    correlation_id: "corr-rollback-1"
  });

  assert.equal(result.active_release_id, "2025.4.0");
  assert.notEqual(result.snapshot_ref, "tampered://caller-supplied");
  assert.match(result.snapshot_ref, /^release-candidate:\/\/tenant-a\/rc:2025\.4\.0\/snapshot\/sha256:/);
  assert.equal(result.audit_event_id, "audit:release:2026.0.0:rollback:2025.4.0");
  assert.equal(activations.length, 1);
  assert.equal(context.auditStore.events.at(-1).event_type, "release_rollback");
});

test("P4-RT-005: release candidate creation fails closed when audit writer is missing", async () => {
  const context = releaseManagerContext({ auditStore: null });

  await assert.rejects(
    () => context.service.createReleaseCandidate(validReleaseCandidateInput()),
    /auditStore\.append/
  );
});

test("P6-SEC release candidate assembly rejects and audits model_suggested auto-release attempts", async () => {
  const context = releaseManagerContext({
    resolveStagedItem: () => ({
      ...validMappingItem(),
      proposal_id: "proposal:ai-model-suggested",
      assertion_type: "model_suggested",
      payload: {
        assertion_type: "model_suggested"
      },
      governance: {
        auto_publish: false,
        release_eligible: false,
        released_graph_target: null
      }
    })
  });

  await assert.rejects(
    () => context.service.createReleaseCandidate({
      ...validReleaseCandidateInput(),
      release_candidate_id: "rc:p6-model-suggested"
    }),
    /model_suggested items cannot enter release candidate/
  );
  assert.deepEqual(readdirSync(context.manifestRoot), []);
  assert.equal(context.ledger.records.length, 0);
  assert.equal(context.auditStore.events.length, 1);
  assert.equal(context.auditStore.events[0].event_type, "release_candidate_promotion_denied");
  assert.equal(context.auditStore.events[0].decision, "denied");
  assert.equal(context.auditStore.events[0].event_payload.first_blocked_id, "proposal:ai-model-suggested");
});

function releaseManagerContext(overrides = {}) {
  const manifestRoot = mkdtempSync(join(tmpdir(), "pharmaops-release-manager-"));
  const ledger = new MemoryReleaseLedger();
  const auditStore = overrides.auditStore === undefined ? new MemoryAuditStore() : overrides.auditStore;
  const stagedEntry = overrides.stagedEntry ?? validStagedEntry();
  const proposalWorkflowService = overrides.proposalWorkflowService ?? {
    calls: [],
    async stagedEntries(filters) {
      this.calls.push(filters);
      return [{ ...stagedEntry, release_id: filters.release_id }];
    }
  };
  const validationReports = overrides.validationReports ?? [validValidationReport()];
  const validationRunResolver = overrides.validationRunResolver ?? {
    calls: [],
    async resolveValidationReports(input) {
      this.calls.push(input);
      return validationReports.map((record) => ({
        ...record,
        release_id: input.release_id,
        release_candidate_id: input.release_candidate_id,
        subject_id: input.release_candidate_id ?? record.subject_id
      }));
    }
  };
  const service = new ReleaseManagerService({
    manifestRoot,
    releaseLedger: ledger,
    proposalWorkflowService,
    resolveStagedItem: overrides.resolveStagedItem ?? (() => validMappingItem()),
    validationRunResolver,
    auditStore,
    clock: fixedClock
  });
  return { service, manifestRoot, ledger, auditStore, proposalWorkflowService, validationRunResolver };
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

function validReleaseCandidateInput() {
  return {
    tenant_id: "tenant-a",
    environment: "test",
    release_id: "2026.0.0-rc1",
    semantic_version: "2026.0.0-rc1",
    release_candidate_id: "rc:2026.0.0-rc1",
    previous_release_id: "2025.4.0",
    rollback_target_release_id: "2025.4.0",
    actor: validReleaseManager(),
    rationale: "Assemble approved staged Phase 4 changes.",
    correlation_id: "corr-rc-1",
    working_graph: "graph:tenant:tenant-a:working:data:canonical",
    source_version_pins: validSourceVersionPins(),
    staged_entry_ids: ["stage:proposal-1"]
  };
}

function validStagedEntry() {
  return {
    staging_id: "stage:proposal-1",
    proposal_id: "proposal:mapping-1",
    proposal_type: "mapping",
    tenant_id: "tenant-a",
    environment: "test",
    release_id: "2026.0.0-rc1",
    staged_by_user_id: "user:release-manager-1",
    staged_by_role_key: "release_manager",
    staged_at: "2026-06-27T04:20:00.000Z",
    audit_event_id: "audit:p4:stage",
    payload_hash: "sha256:stage",
    validation_report_id: "validation:p4-release"
  };
}

function validValidationReport() {
  return {
    validation_run_id: "validation:p4-release",
    tenant_id: "tenant-a",
    environment: "test",
    release_id: "2026.0.0-rc1",
    subject_type: "release_candidate",
    subject_id: "rc:2026.0.0-rc1",
    item_ids: ["mapping:aspirin-exact"],
    input_payload_digest: `sha256:${"a".repeat(64)}`,
    report_digest: `sha256:${"b".repeat(64)}`,
    immutable_record_id: "validation-record:p4-release",
    ruleset_version: "phase4.validation-evidence.v1",
    signature: `sha256:${"c".repeat(64)}`,
    result: "passed",
    severity: "none",
    immutable: true,
    persisted: true,
    summary: { critical: 0, warning: 0 }
  };
}

function validMappingItem() {
  return {
    object_type: "mapping",
    mapping_id: "mapping:aspirin-exact",
    tenant_id: "tenant-a",
    source_entity_id: "chembl:CHEMBL25",
    target_entity_id: "pharm:compound/aspirin",
    predicate: "skos:exactMatch",
    source_vocabulary_version: "34",
    target_vocabulary_version: "2026-06-27",
    provenance_id: "prov:mapping-1",
    evidence_refs: [{ evidence_id: "evidence:1", tenant_id: "tenant-a" }],
    confidence_score: 0.97,
    confidence_band: "high",
    confidence_source: "deterministic_match",
    review_status: "approved",
    reviewed_by: "user:approver-1",
    workflow_status: "staged_for_release"
  };
}

function validSourceVersionPins() {
  return [
    { source_name: "manual fixture curation", source_version: "2026-06-27" },
    { source_name: "ChEMBL fixture", source_version: "34" }
  ];
}

function validReleaseManager() {
  return {
    user_id: "user:release-manager-1",
    role_keys: ["release_manager"],
    tenant_id: "tenant-a",
    environment: "test"
  };
}

function fixedClock() {
  return new Date("2026-06-27T04:20:00.000Z");
}

assert.equal(existsSync(new URL("../../services/release-manager/src/index.js", import.meta.url)), true);
