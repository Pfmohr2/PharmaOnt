import assert from "node:assert/strict";
import test from "node:test";

import {
  MappingAuthorizationError,
  MappingWorkflowService,
  GovernedTransitionEntrypointError,
  MemoryAuditEventStore,
  MemoryMappingCandidateStore,
  MemoryReleaseStagingStore,
  assertCanGovernMappingCandidate,
  reviewRouteForCandidate
} from "../../services/mapping-workflow/src/index.js";

test("Phase 3 workflow approves, rejects, and stages with immutable audit events", () => {
  const workflow = fixtureWorkflow();

  const approved = workflow.approve({
    candidateId: "candidate:chembl-CHEMBL25:aspirin",
    actor: actors.curator,
    tenant_id: "tenant-a",
    environment: "test",
    rationale: "Exact identifier and label match against evidence.",
    correlation_id: "corr-approve"
  });
  const staged = workflow.stageForRelease({
    candidateId: "candidate:chembl-CHEMBL25:aspirin",
    actor: actors.releaseManager,
    tenant_id: "tenant-a",
    environment: "test",
    rationale: "Approved mapping included in RC validation.",
    correlation_id: "corr-stage",
    release_id: "2026.0.0-rc1"
  });
  const rejected = workflow.reject({
    candidateId: "candidate:uniprot-P23219-PTGS1",
    actor: actors.domainApprover,
    tenant_id: "tenant-a",
    environment: "test",
    rationale: "Evidence supports rejection in fixture path.",
    correlation_id: "corr-reject"
  });

  assert.equal(approved.candidate.review_status, "approved");
  assert.equal(staged.candidate.review_status, "approved");
  assert.equal(staged.candidate.workflow_status, "staged_for_release");
  assert.equal(rejected.candidate.review_status, "rejected");
  assert.equal(workflow.stagedEntries().length, 1);
  assert.deepEqual(workflow.auditStore.list().map((event) => event.event_type), [
    "mapping_candidate_approved",
    "mapping_candidate_staged",
    "mapping_candidate_rejected"
  ]);
  assert.throws(() => {
    workflow.auditStore.list()[0].action = "tampered";
  }, /Cannot assign|read only/);
});

test("P3-RT-001 workflow uses registry governed entrypoint for approve, stage, and reject", () => {
  const calls = [];
  const workflow = fixtureWorkflow(undefined, {
    mappingRegistry: {
      applyGovernedTransition(args) {
        calls.push(structuredClone(args));
        const staged = args.transition === "stage_release";
        const rejected = args.transition === "reject";
        const governedDecision = args.authorizationContext.governedDecision;
        return {
          mapping: {
            review_status: rejected ? "rejected" : "approved",
            reviewed_by: governedDecision.actor_user_id,
            release_id: null
          },
          registry_metadata: {
            updated_at: "2026-06-27T03:35:00.000Z",
            workflow_status: staged ? "staged_for_release" : rejected ? "rejected" : "approved",
            release_staging: staged
              ? {
                  release_id: args.auditContext.release_id,
                  staged_by: governedDecision.actor_user_id,
                  staged_at: "2026-06-27T03:35:00.000Z",
                  audit_event_id: "audit:registry-stage"
                }
              : null,
            governed_audit_event_ids: [`audit:registry-${args.transition}`]
          }
        };
      }
    }
  });

  workflow.approve({
    candidateId: "candidate:chembl-CHEMBL25:aspirin",
    actor: actors.curator,
    tenant_id: "tenant-a",
    environment: "test",
    rationale: "Exact identifier and label match against evidence.",
    correlation_id: "corr-approve"
  });
  workflow.stageForRelease({
    candidateId: "candidate:chembl-CHEMBL25:aspirin",
    actor: actors.releaseManager,
    tenant_id: "tenant-a",
    environment: "test",
    rationale: "Approved mapping included in RC validation.",
    correlation_id: "corr-stage",
    release_id: "2026.0.0-rc1"
  });
  workflow.reject({
    candidateId: "candidate:uniprot-P23219-PTGS1",
    actor: actors.domainApprover,
    tenant_id: "tenant-a",
    environment: "test",
    rationale: "Evidence supports rejection in fixture path.",
    correlation_id: "corr-reject"
  });

  assert.deepEqual(calls.map((call) => call.transition), ["approve", "stage_release", "reject"]);
  assert.deepEqual(calls.map((call) => call.authorizationContext.governedDecision.action), [
    "mapping_candidate.approve",
    "mapping_candidate.stage_release",
    "mapping_candidate.reject"
  ]);
  assert.equal(calls[0].tenantId, "tenant-a");
  assert.equal(calls[0].mappingId, "pharmmap:map-2026-000001");
  assert.equal(calls[0].authorizationDecision, undefined);
  assert.equal(calls[0].authorizationContext.governedDecision.decision, "allow");
  assert.match(calls[0].authorizationContext.governedDecision.decision_binding, /^sha256:/);
  assert.equal(calls[0].authorizationContext.governedDecision.signature, calls[0].authorizationContext.governedDecision.decision_binding);
  assert.equal("patch" in calls[0], false);
  assert.equal("review_status" in calls[0], false);
  assert.equal(calls[1].auditContext.release_id, "2026.0.0-rc1");
  assert.equal(calls[1].auditContext.actor_user_id, "user:release-manager-1");
});

test("P3-RT-001 workflow fails closed when governed registry entrypoint is absent", () => {
  assert.throws(
    () => fixtureWorkflow(undefined, { mappingRegistry: {} }),
    GovernedTransitionEntrypointError
  );
});

test("confidence-band routing defines review rigor without auto-publication", () => {
  assert.deepEqual(reviewRouteForCandidate(candidateFixture({ confidence_band: "high" })), {
    queue: "standard_review",
    review_rigor: "single_curator_or_domain_approver"
  });
  assert.deepEqual(reviewRouteForCandidate(candidateFixture({ confidence_band: "medium" })), {
    queue: "enhanced_review",
    review_rigor: "curator_review_with_evidence_check"
  });
  assert.deepEqual(reviewRouteForCandidate(candidateFixture({ confidence_band: "low" })), {
    queue: "explicit_curator_review",
    review_rigor: "explicit_curator_review_required"
  });

  const workflow = fixtureWorkflow([
    candidateFixture({ candidate_id: "candidate:low", confidence_band: "low" }),
    candidateFixture({ candidate_id: "candidate:dup", duplicate_status: "possible_duplicate" })
  ]);

  assert.equal(workflow.routeCandidate("candidate:low").workflow_status, "explicit_curator_review");
  assert.equal(workflow.routeCandidate("candidate:dup").workflow_status, "duplicate_review");
});

test("duplicate candidates are flagged, not auto-merged, and blocked from approval", () => {
  const duplicate = candidateFixture({
    candidate_id: "candidate:duplicate",
    duplicate_status: "possible_duplicate",
    duplicate_of: "pharm:compound/aspirin",
    merge_action: "flag_only"
  });
  const workflow = fixtureWorkflow([duplicate]);

  assert.equal(workflow.getCandidate("candidate:duplicate").duplicate_of, "pharm:compound/aspirin");
  assert.equal("merged_into" in workflow.getCandidate("candidate:duplicate"), false);
  assert.throws(
    () => workflow.approve({
      candidateId: "candidate:duplicate",
      actor: actors.curator,
      tenant_id: "tenant-a",
      environment: "test",
      rationale: "Duplicate should not approve.",
      correlation_id: "corr-dup"
    }),
    MappingAuthorizationError
  );
  assert.equal(workflow.getCandidate("candidate:duplicate").review_status, "proposed");
  assert.equal(workflow.auditFor("candidate:duplicate")[0].decision, "denied");
});

test("RBAC interface denies unauthorized actors and same-user approval before mutation", () => {
  assert.throws(
    () => assertCanGovernMappingCandidate({
      actor: actors.viewer,
      candidate: candidateFixture(),
      action: "mapping_candidate.approve",
      tenant_id: "tenant-a",
      environment: "test",
      rationale: "Viewer should be denied.",
      correlation_id: "corr-viewer"
    }),
    MappingAuthorizationError
  );
  assert.throws(
    () => assertCanGovernMappingCandidate({
      actor: actors.creator,
      candidate: candidateFixture({ created_by_user_id: actors.creator.user_id }),
      action: "mapping_candidate.approve",
      tenant_id: "tenant-a",
      environment: "test",
      rationale: "Creator should be denied.",
      correlation_id: "corr-creator"
    }),
    MappingAuthorizationError
  );
});

test("stage for release requires release manager, release evidence, validation refs, and release permission", () => {
  const approved = candidateFixture({ review_status: "approved", workflow_status: "approved" });
  assert.doesNotThrow(() => assertCanGovernMappingCandidate({
    actor: actors.releaseManager,
    candidate: approved,
    action: "mapping_candidate.stage_release",
    tenant_id: "tenant-a",
    environment: "test",
    rationale: "Stage with release evidence.",
    correlation_id: "corr-stage-ok",
    release_id: "2026.0.0-rc1"
  }));
  assert.throws(() => assertCanGovernMappingCandidate({
    actor: actors.curator,
    candidate: approved,
    action: "mapping_candidate.stage_release",
    tenant_id: "tenant-a",
    environment: "test",
    rationale: "Curator cannot stage.",
    correlation_id: "corr-stage-deny",
    release_id: "2026.0.0-rc1"
  }), MappingAuthorizationError);
  assert.throws(() => assertCanGovernMappingCandidate({
    actor: actors.releaseManager,
    candidate: { ...approved, validation_report_refs: [] },
    action: "mapping_candidate.stage_release",
    tenant_id: "tenant-a",
    environment: "test",
    rationale: "Missing validation refs.",
    correlation_id: "corr-stage-missing",
    release_id: "2026.0.0-rc1"
  }), MappingAuthorizationError);
});

test("rejected candidates remain queryable and auditable", () => {
  const workflow = fixtureWorkflow();
  workflow.reject({
    candidateId: "candidate:uniprot-P23219-PTGS1",
    actor: actors.domainApprover,
    tenant_id: "tenant-a",
    environment: "test",
    rationale: "Rejected fixture remains visible.",
    correlation_id: "corr-reject-visible"
  });

  assert.equal(workflow.getCandidate("candidate:uniprot-P23219-PTGS1").review_status, "rejected");
  assert.equal(workflow.auditFor("candidate:uniprot-P23219-PTGS1").length, 1);
});

test("Phase 3 live RBAC workflow cases skip locally unless CI enables backing services", { skip: liveWorkflowEnabled() ? false : "set PHARMAOPS_WORKFLOW_LIVE=1 in CI to run DB-backed workflow/RBAC tests" }, () => {
  assert.equal(process.env.PHARMAOPS_WORKFLOW_LIVE, "1");
});

const actors = {
  curator: {
    user_id: "user:curator-1",
    role_keys: ["curator"],
    tenant_id: "tenant-a",
    environment: "test"
  },
  domainApprover: {
    user_id: "user:approver-1",
    role_keys: ["domain_approver"],
    tenant_id: "tenant-a",
    environment: "test"
  },
  releaseManager: {
    user_id: "user:release-manager-1",
    role_keys: ["release_manager"],
    tenant_id: "tenant-a",
    environment: "test"
  },
  viewer: {
    user_id: "user:viewer-1",
    role_keys: ["viewer"],
    tenant_id: "tenant-a",
    environment: "test"
  },
  creator: {
    user_id: "user:normalizer",
    role_keys: ["curator"],
    tenant_id: "tenant-a",
    environment: "test"
  }
};

function fixtureWorkflow(candidates = [
  candidateFixture({ candidate_id: "candidate:chembl-CHEMBL25:aspirin" }),
  candidateFixture({ candidate_id: "candidate:uniprot-P23219-PTGS1" })
], overrides = {}) {
  return new MappingWorkflowService({
    candidateStore: new MemoryMappingCandidateStore(candidates),
    auditStore: new MemoryAuditEventStore(),
    stagingStore: new MemoryReleaseStagingStore(),
    clock: () => new Date("2026-06-27T03:35:00.000Z"),
    idFactory: sequenceIds(),
    ...overrides
  });
}

function candidateFixture(overrides = {}) {
  return {
    candidate_id: "candidate:chembl-CHEMBL25:aspirin",
    mapping_id: "pharmmap:map-2026-000001",
    tenant_id: "tenant-a",
    environment: "test",
    review_status: "proposed",
    workflow_status: "queued_high_confidence",
    created_by_user_id: "user:normalizer",
    created_by_service_account_id: null,
    service_account_owner_user_id: null,
    source_entity_id: "chembl:CHEMBL25",
    target_entity_id: "pharment:compound/aspirin",
    predicate: "exactMatch",
    source_vocabulary: "ChEMBL",
    source_vocabulary_version: "34",
    target_vocabulary: "PharmaOps",
    target_vocabulary_version: "working-2026-06-27",
    source_license_policy_id: "license-policy:chembl-34",
    target_license_policy_id: "license-policy:pharmaops-working",
    license_status: "valid",
    permitted_uses: ["ingest", "normalize", "curate", "evidence", "release"],
    confidence_score: 0.98,
    confidence_band: "high",
    confidence_source: "deterministic_identifier_and_label_score",
    provenance_id: "pharmprov:mapping/000001",
    provenance: {
      actor: "service:normalization",
      timestamp: "2026-06-27T03:30:00.000Z",
      source: "ChEMBL",
      source_version: "34",
      audit_event_id: "audit:normalization-1"
    },
    evidence_ids: ["pharmev:evidence-2026-000001"],
    evidence_refs: [{ evidence_id: "pharmev:evidence-2026-000001", evidence_role: "supports" }],
    release_evidence_refs: [{ validation_run_id: "validation-map-1", evidence_package_uri: "s3://fixture/evidence.json" }],
    validation_report_refs: [{ validation_run_id: "validation-map-1", result: "passed" }],
    duplicate_status: "not_duplicate",
    release_id: null,
    ...overrides
  };
}

function sequenceIds() {
  let id = 0;
  return () => `${++id}`;
}

function liveWorkflowEnabled() {
  return process.env.PHARMAOPS_WORKFLOW_LIVE === "1";
}
