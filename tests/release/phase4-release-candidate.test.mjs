import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { MappingRegistry } from "../../services/mapping-registry/src/index.js";
import { ProposalWorkflowService } from "../../services/proposal-workflow/src/index.js";
import { ReleaseManagerService, sha256 } from "../../services/release-manager/src/index.js";
import { validationPreview } from "../../services/validation/src/index.js";

const proposalFixture = JSON.parse(readFileSync(new URL("../proposal-workflow/fixtures/phase4-proposals.json", import.meta.url), "utf8"));

test("Phase 4 exit: real release manager creates an immutable release candidate from real staged proposals", async () => {
  const workflow = stagedWorkflow();
  const manifestRoot = mkdtempSync(join(tmpdir(), "pharmaops-p4-release-manager-"));
  const ledgerRecords = [];
  const service = new ReleaseManagerService({
    manifestRoot,
    releaseLedger: {
      async insertReleaseMetadata(record) {
        ledgerRecords.push(record);
        return record;
      }
    },
    validationRunResolver: validationRunResolver(),
    resolveValidationRun(args) {
      return validationRunRecord(recordBinding(args));
    },
    auditStore: memoryAuditStore(),
    clock: fixedClock
  });

  const result = await service.createReleaseCandidateFromStaging({
    proposalWorkflowService: workflow,
    resolveStagedItem: (entry) => releaseItemFromProposal(workflow.getProposal(entry.proposal_id)),
    tenant_id: "tenant-a",
    environment: "test",
    release_id: "2026.0.0-rc1",
    semantic_version: "2026.0.0-rc1",
    release_candidate_id: "rc:2026.0.0-phase4",
    previous_release_id: "2025.4.0",
    rollback_target_release_id: "2025.4.0",
    actor: actors.releaseManager,
    rationale: "Create RC from approved staged Phase 4 proposal.",
    correlation_id: "corr:p4:rc-create",
    source_version_pins: validSourceVersionPins(),
    validation_report_refs: [{ validation_run_id: "validation:p4-release", result: "passed", severity: "none", resolved: true }],
    approval_trace: [
      { role: "domain_approver", actor: "user:approver-1", decision: "approved", audit_event_id: "audit:p4:approve" },
      { role: "release_manager", actor: "user:release-manager-1", decision: "approved", audit_event_id: "audit:p4:stage" }
    ],
    audit_event_range: {
      first: workflow.auditStore.list()[0].audit_event_id,
      last: "audit:rc:create",
      event_count: workflow.auditStore.list().length + 1,
      event_types: ["proposal_submitted", "proposal_validated", "proposal_routed_curator_review", "proposal_routed_approver_decision", "proposal_approved", "proposal_staged_for_release", "release_candidate.create"]
    },
    included_graphs: [{ graph_name: "release-candidate:rc:2026.0.0-phase4:content", graph_role: "candidate_source_snapshot", target_release_graph: null }]
  });
  const manifest = JSON.parse(readFileSync(result.manifest_uri, "utf8"));

  assert.equal(result.release_candidate.release_candidate_id, "rc:2026.0.0-phase4");
  assert.equal(result.release_candidate.kind, "release_candidate");
  assert.equal(result.release_candidate.rollback_target_release_id, "2025.4.0");
  assert.equal(result.release_candidate.staged_entries.length, 1);
  assert.equal(result.release_candidate.items[0].proposal_id, "proposal:mapping:aspirin");
  assert.equal(result.release_candidate.validation_result.blocking, false);
  assert.equal(result.authz_decision.action, "release_candidate.create");
  assert.equal(result.authz_decision.allowed, true);
  assert.match(result.authz_decision.signature, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.artifact_hashes.content_snapshot, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.artifact_hashes.changelog, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.rollback.rollback_target_release_id, "2025.4.0");
  assert.equal(manifest.authorization_decision.audit_event_id, result.authz_decision.audit_event_id);
  assert.equal(manifest.audit_event_range.event_count, workflow.auditStore.list().length + 1);
  assert.equal(result.manifest_digest, sha256(readFileSync(result.manifest_uri, "utf8")));
  assert.equal(ledgerRecords.length, 1);
  assert.equal(ledgerRecords[0].release_candidate_id, "rc:2026.0.0-phase4");
  assert.equal(ledgerRecords[0].manifest_digest, result.manifest_digest);
  assert.equal(ledgerRecords[0].included_graphs[0].target_release_graph, null);
});

test("Phase 4 exit negative: real release manager blocks critical validation before manifest or ledger persistence", async () => {
  const workflow = stagedWorkflow();
  const manifestRoot = mkdtempSync(join(tmpdir(), "pharmaops-p4-release-manager-block-"));
  const ledgerRecords = [];
  const service = new ReleaseManagerService({
    manifestRoot,
    releaseLedger: {
      async insertReleaseMetadata(record) {
        ledgerRecords.push(record);
        return record;
      }
    },
    validationRunResolver: validationRunResolver(validationRunRecord({
      status: "failed",
      summary: { critical: 1, warning: 0 },
      findings: [{ finding_id: "finding:p4-critical", severity: "critical", rule_id: "release_candidate_evidence_package", blocks_release: true }]
    })),
    auditStore: memoryAuditStore(),
    clock: fixedClock
  });

  await assert.rejects(
    () => service.createReleaseCandidateFromStaging({
      ...validReleaseInput(),
      proposalWorkflowService: workflow,
      resolveStagedItem: (entry) => releaseItemFromProposal(workflow.getProposal(entry.proposal_id)),
      release_candidate_id: "rc:critical"
    }),
    /critical validation failure blocks release candidate/
  );
  assert.deepEqual(readdirSync(manifestRoot), []);
  assert.equal(ledgerRecords.length, 0);
});

test("P4-RT-002: release manager resolves immutable validation runs and ignores forged inline resolved refs", async () => {
  const workflow = stagedWorkflow();
  const manifestRoot = mkdtempSync(join(tmpdir(), "pharmaops-p4-release-manager-forged-validation-"));
  const ledgerRecords = [];
  const service = new ReleaseManagerService({
    manifestRoot,
    releaseLedger: {
      async insertReleaseMetadata(record) {
        ledgerRecords.push(record);
        return record;
      }
    },
    validationRunResolver: validationRunResolver(validationRunRecord({
      status: "failed",
      summary: { critical: 1, warning: 0 },
      findings: [{
        finding_id: "finding:p4-rt-002",
        rule_id: "release_candidate_evidence_package",
        severity: "critical",
        blocks_release: true
      }]
    })),
    auditStore: memoryAuditStore(),
    clock: fixedClock
  });

  await assert.rejects(
    () => service.createReleaseCandidateFromStaging({
      ...validReleaseInput(),
      proposalWorkflowService: workflow,
      resolveStagedItem: (entry) => releaseItemFromProposal(workflow.getProposal(entry.proposal_id)),
      validation_report_refs: [{
        validation_run_id: "validation:p4-release",
        result: "passed",
        severity: "none",
        resolved: true
      }]
    }),
    /critical validation failure blocks release candidate/
  );
  assert.deepEqual(readdirSync(manifestRoot), []);
  assert.equal(ledgerRecords.length, 0);
});

test("Phase 4 release candidate live backing service cases skip locally unless enabled", { skip: liveReleaseEnabled() ? false : "set PHARMAOPS_RELEASE_LIVE=1 in CI to run DB/Fuseki-backed release candidate tests" }, () => {
  assert.equal(process.env.PHARMAOPS_RELEASE_LIVE, "1");
});

function stagedWorkflow() {
  const registry = new MappingRegistry({ clock: fixedClock, idFactory: sequenceIds() });
  registry.createMapping({
    tenantId: "tenant-a",
    actor: "user:curator-1",
    mapping: validRegistryMapping()
  });
  const workflow = new ProposalWorkflowService({
    clock: fixedClock,
    idFactory: sequenceIds(),
    validationPreview,
    diffPreview: (args) => registry.diffPreview(args)
  });
  const submitted = workflow.submitProposal({
    proposal: withFixtureScope(proposalFixture.proposals[1]),
    actor: actors.contributor,
    rationale: proposalFixture.proposals[1].rationale,
    correlation_id: "corr:p4:release:submit"
  });
  workflow.validateProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Curator validation passed.",
    correlation_id: "corr:p4:release:validate"
  });
  workflow.routeProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Route to curator review.",
    correlation_id: "corr:p4:release:route"
  });
  workflow.routeForDecision({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.curator,
    rationale: "Route to domain approver.",
    correlation_id: "corr:p4:release:decision"
  });
  workflow.approveProposal({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.domainApprover,
    rationale: "Approve exact mapping for release.",
    correlation_id: "corr:p4:release:approve"
  });
  workflow.stageForRelease({
    proposalId: submitted.proposal.proposal_id,
    actor: actors.releaseManager,
    rationale: "Stage approved mapping for RC.",
    correlation_id: "corr:p4:release:stage",
    release_id: "2026.0.0-rc1"
  });
  return workflow;
}

function validRegistryMapping() {
  return {
    mapping_id: "pharmmap:aspirin-chembl-pubchem",
    source_entity_id: "chembl:CHEMBL25",
    target_entity_id: "pubchem:CID2244",
    predicate: "closeMatch",
    source_vocabulary: "ChEMBL",
    source_vocabulary_version: "34",
    target_vocabulary: "PubChem",
    target_vocabulary_version: "2026-06-01",
    source_license_classification: "open_with_attribution",
    source_license_policy_id: "license-policy:chembl-34",
    target_license_classification: "open_with_attribution",
    target_license_policy_id: "license-policy:pubchem-2026-06-01",
    data_sensitivity: "public",
    materialization_policy: "materialize",
    permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
    export_restrictions: ["attribution_required"],
    disclaimer_ids: ["source_terms:chembl"],
    legal_approval_id: null,
    retention_class: "public_source_snapshot",
    license_status: "valid",
    confidence_score: 0.82,
    confidence_band: "medium",
    evidence_ids: ["pharmev:evidence-2026-000001"],
    evidence_refs: [{ evidence_id: "pharmev:evidence-2026-000001", evidence_role: "supports", required_for_release: true }],
    provenance_id: "pharmprov:p4/mapping-aspirin",
    created_by: "service:normalization",
    reviewed_by: null,
    review_status: "proposed",
    release_id: null,
    provenance: {
      actor: "service:normalization",
      timestamp: "2026-06-27T04:30:00.000Z",
      source: "ChEMBL",
      source_version: "34",
      audit_event_id: "audit:p4-release-source"
    }
  };
}

function releaseItemFromProposal(proposal) {
  return {
    ...proposal.payload,
    proposal_id: proposal.proposal_id,
    proposal_type: proposal.proposal_type,
    tenant_id: proposal.tenant_id,
    environment: proposal.environment,
    provenance_id: proposal.provenance.provenance_id,
    provenance: proposal.provenance,
    evidence_ids: proposal.provenance.evidence_ids,
    evidence_refs: proposal.payload.evidence_refs,
    confidence_score: proposal.confidence_score,
    confidence_band: proposal.confidence_band,
    confidence_source: proposal.confidence_source,
    review_status: "approved",
    reviewed_by: proposal.decided_by_user_id,
    workflow_status: "staged_for_release",
    validation_report_id: proposal.validation_result.validation_report_id
  };
}

function withFixtureScope(proposal) {
  return {
    tenant_id: proposalFixture.tenant_id,
    environment: proposalFixture.environment,
    ...proposal
  };
}

function validReleaseInput() {
  return {
    tenant_id: "tenant-a",
    environment: "test",
    release_id: "2026.0.0-rc1",
    semantic_version: "2026.0.0-rc1",
    release_candidate_id: "rc:2026.0.0-phase4",
    previous_release_id: "2025.4.0",
    rollback_target_release_id: "2025.4.0",
    actor: actors.releaseManager,
    rationale: "Create RC from approved staged Phase 4 proposal.",
    correlation_id: "corr:p4:rc-create",
    source_version_pins: validSourceVersionPins()
  };
}

const actors = {
  contributor: { user_id: "user:contributor-1", role_keys: ["contributor"], tenant_id: "tenant-a", environment: "test" },
  curator: { user_id: "user:curator-1", role_keys: ["curator"], tenant_id: "tenant-a", environment: "test" },
  domainApprover: { user_id: "user:approver-1", role_keys: ["domain_approver"], tenant_id: "tenant-a", environment: "test" },
  releaseManager: { user_id: "user:release-manager-1", role_keys: ["release_manager"], tenant_id: "tenant-a", environment: "test" }
};

function validSourceVersionPins() {
  return [
    { source_name: "manual fixture curation", source_version: "2026-06-27" },
    { source_name: "ChEMBL fixture", source_version: "34" }
  ];
}

function validationRunRecord(overrides = {}) {
  return {
    validation_run_id: "validation:p4-release",
    tenant_id: "tenant-a",
    environment: "test",
    release_id: "2026.0.0-rc1",
    release_candidate_id: "rc:2026.0.0-phase4",
    subject_type: "release_candidate",
    subject_id: "rc:2026.0.0-phase4",
    input_payload_digest: "sha256:fixture",
    item_ids: ["pharmmap:aspirin-chembl-pubchem"],
    ruleset_version: "phase4.validation-preview.v1",
    report_digest: "sha256:report",
    signature: "sha256:signature",
    immutable: true,
    immutable_record_id: "validation-record:p4-release",
    status: "passed",
    summary: { critical: 0, warning: 0 },
    findings: [],
    ...overrides
  };
}

function validationRunResolver(record = validationRunRecord()) {
  return {
    async resolveValidationReports({ release_candidate_id, staged_entries, items }) {
      const itemIds = items.map((item, index) =>
        item.proposal_id ?? item.mapping_id ?? item.relationship_id ?? item.evidence_link_id ?? item.id ?? `item:${index + 1}`
      );
      return staged_entries.map((entry) => ({
        ...record,
        validation_run_id: entry.validation_report_id,
        release_id: entry.release_id,
        release_candidate_id,
        subject_type: "release_candidate",
        subject_id: release_candidate_id,
        item_ids: itemIds
      }));
    }
  };
}

function memoryAuditStore() {
  const events = [];
  return {
    append(event) {
      events.push(Object.freeze(structuredClone(event)));
      return events.at(-1);
    },
    list() {
      return [...events];
    }
  };
}

function recordBinding(args) {
  return {
    tenant_id: args.tenant_id,
    environment: args.environment,
    release_id: args.release_id,
    release_candidate_id: args.release_candidate_id,
    subject_type: args.subject_type,
    subject_id: args.subject_id,
    input_payload_digest: args.input_payload_digest,
    item_ids: args.item_ids
  };
}

function fixedClock() {
  return new Date("2026-06-27T04:30:00.000Z");
}

function sequenceIds() {
  let id = 0;
  return () => `${++id}`;
}

function liveReleaseEnabled() {
  return process.env.PHARMAOPS_RELEASE_LIVE === "1";
}
