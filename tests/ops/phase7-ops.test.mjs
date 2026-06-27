import assert from "node:assert/strict";
import test from "node:test";

import {
  BackupRestoreError,
  buildPilotKpiDashboard,
  renderPilotKpiDashboardMarkdown,
  runBackupRestoreDrill
} from "../../services/ops/src/index.js";

test("P7-BACKUP: restore drill proves hashes, release integrity, audit preservation, and clean released scope", () => {
  const drill = runBackupRestoreDrill({
    ...backupFixture(),
    started_at: "2026-06-27T09:00:00.000Z",
    completed_at: "2026-06-27T09:10:00.000Z",
    clean_target: {},
    governance_proof_resolver: canonicalGovernanceProof,
    rpo_target_minutes: 15,
    rto_target_minutes: 60
  });

  assert.equal(drill.verification.status, "pass");
  assert.equal(drill.rpo_target_minutes, 15);
  assert.equal(drill.rto_target_minutes, 60);
  assert.equal(drill.measured_rto_minutes, 10);
  assert.equal(drill.rpo_met, true);
  assert.equal(drill.rto_met, true);
  assert.deepEqual(drill.verification.checks, {
    content_hashes_match: true,
    releases_intact: true,
    audit_preserved: true,
    no_model_suggested_released_leakage: true
  });
  assert.equal(drill.verification.release_count, 1);
  assert.match(drill.backup.manifest_digest, /^sha256:[a-f0-9]{64}$/);
});

test("P7-BACKUP: restore rejects model_suggested leakage in released graph exports", () => {
  const fixture = backupFixture();
  assert.throws(
    () => runBackupRestoreDrill({
      ...fixture,
      governance_proof_resolver: canonicalGovernanceProof,
      graph_exports: fixture.graph_exports.map((graph) => graph.graph_role === "release"
        ? {
            ...graph,
            triples: [
              ...graph.triples,
              {
                subject: "pharment:compound/aspirin",
                predicate: "pharm:assertionType",
                object: "model_suggested"
              }
            ]
          }
        : graph)
    }),
    (error) => error instanceof BackupRestoreError &&
      /model_suggested content found in released backup scope/.test(error.message)
  );
});

test("P7-BACKUP: restore requires a clean target", () => {
  assert.throws(
    () => runBackupRestoreDrill({
      ...backupFixture(),
      governance_proof_resolver: canonicalGovernanceProof,
      clean_target: {
        graph_exports: [{ graph_name: "existing" }]
      }
    }),
    (error) => error instanceof BackupRestoreError &&
      /restore target must be clean/.test(error.message) &&
      error.details.occupied.includes("graph_exports")
  );
});

test("P7-BACKUP: release snapshots require server-side canonical governance proof", () => {
  assert.throws(
    () => runBackupRestoreDrill(backupFixture()),
    (error) => error instanceof BackupRestoreError &&
      /server-side canonical governance proof resolver/.test(error.message)
  );
  assert.throws(
    () => runBackupRestoreDrill({
      ...backupFixture(),
      governance_proof_resolver: () => ({ canonical: false })
    }),
    (error) => error instanceof BackupRestoreError &&
      /canonical governance proof mismatch/.test(error.message)
  );
});

test("P7-BACKUP: inline governed state and caller release targets are rejected", () => {
  const fixture = backupFixture();
  assert.throws(
    () => runBackupRestoreDrill({
      ...fixture,
      governance_proof_resolver: canonicalGovernanceProof,
      release_metadata: [{
        ...fixture.release_metadata[0],
        inline_governance_proof: { decision: "allow" }
      }]
    }),
    (error) => error instanceof BackupRestoreError &&
      /caller-supplied governed state or release target/.test(error.message)
  );
});

test("P7-OBS-KPI: dashboard computes pilot operation metrics from real event streams", () => {
  const dashboard = buildPilotKpiDashboard({
    tenant_id: "tenant-a",
    environment: "validation",
    audit_events: [
      scoped({ audit_event_id: "audit:proposal:1", event_type: "proposal_submitted" }),
      scoped({ audit_event_id: "audit:proposal:2", event_type: "proposal_staged_for_release" }),
      scoped({ audit_event_id: "audit:release:1", event_type: "release_candidate_created" }),
      scoped({ audit_event_id: "audit:release:2", event_type: "release_rollback" }),
      scoped({ audit_event_id: "audit:mapping:1", action: "mapping.approve" }),
      { tenant_id: "tenant-b", environment: "validation", audit_event_id: "audit:hidden:tenant-b", event_type: "proposal_submitted" },
      scoped({ audit_event_id: "audit:hidden:authz", event_type: "proposal_submitted", authz_hidden: true })
    ],
    review_queue_items: [
      scoped({ proposal_id: "proposal:1", queue: "expert-review", status: "open" }),
      scoped({ proposal_id: "proposal:2", requires_expert_review: true, status: "closed" }),
      scoped({ proposal_id: "proposal:3", queue: "curation-review", status: "open" })
    ],
    feedback_records: [
      scoped({ feedback_id: "feedback:1", decision: "accept" }),
      scoped({ feedback_id: "feedback:2", decision: "reject" }),
      scoped({ feedback_id: "feedback:3", decision: "revise" }),
      scoped({ feedback_id: "feedback:4", decision: "revise" })
    ],
    search_events: [
      scoped({ event_id: "search:1", actor_user_id: "user:a", result_count: 4 }),
      scoped({ event_id: "search:2", actor_user_id: "user:b", result_count: 0 }),
      scoped({ event_id: "search:3", actor_user_id: "user:a", result_count: 2 }),
      scoped({ event_id: "search:hidden", actor_user_id: "user:hidden", result_count: 99, authorized: false })
    ],
    error_events: [
      scoped({ event_id: "error:1", service: "search", severity: "warning" }),
      scoped({ event_id: "error:2", service: "api", severity: "critical" }),
      scoped({ event_id: "error:3", service: "api", severity: "error" })
    ]
  });

  assert.deepEqual(dashboard.wired_metrics, [
    "curation_throughput",
    "suggestion_feedback_rates",
    "low_confidence_expert_routing",
    "release_and_rollback_events",
    "search_usage",
    "error_rates"
  ]);
  assert.equal(dashboard.metrics.curation_throughput.proposal_submitted, 1);
  assert.equal(dashboard.metrics.curation_throughput["mapping.approve"], 1);
  assert.equal(dashboard.metrics.suggestion_feedback_rates.accept_rate, 0.25);
  assert.equal(dashboard.metrics.suggestion_feedback_rates.reject_rate, 0.25);
  assert.equal(dashboard.metrics.suggestion_feedback_rates.revise_rate, 0.5);
  assert.equal(dashboard.metrics.low_confidence_expert_routing.expert_review_items, 2);
  assert.equal(dashboard.metrics.low_confidence_expert_routing.open_expert_review_items, 1);
  assert.equal(dashboard.metrics.release_and_rollback_events.release_candidate_created, 1);
  assert.equal(dashboard.metrics.release_and_rollback_events.release_rollback, 1);
  assert.equal(dashboard.metrics.release_and_rollback_events.staged_for_release, 1);
  assert.equal(dashboard.metrics.search_usage.total_searches, 3);
  assert.equal(dashboard.metrics.search_usage.unique_users, 2);
  assert.equal(dashboard.metrics.search_usage.zero_result_searches, 1);
  assert.equal(dashboard.metrics.search_usage.average_result_count, 2);
  assert.equal(dashboard.metrics.error_rates.total_errors, 3);
  assert.equal(dashboard.metrics.error_rates.critical_errors, 1);
  assert.equal(dashboard.metrics.error_rates.service_api, 2);

  const markdown = renderPilotKpiDashboardMarkdown(dashboard);
  assert.match(markdown, /# Phase 7 Pilot Operations/);
  assert.match(markdown, /Suggestion Feedback Rates/);
  assert.match(markdown, /zero_result_searches/);
  assert.match(markdown, /critical_errors/);
  assert.doesNotMatch(markdown, /hidden_count|filtered_count|99|tenant-b/);
});

function backupFixture() {
  const releaseManifest = {
    release_id: "release-2026-06-27",
    release_candidate_id: "rc-2026-06-27",
    manifest_digest: "sha256:manifest-pilot-placeholder",
    included_graphs: [{
      graph_name: "urn:pharmaops:tenant-a:release:release-2026-06-27:canonical",
      graph_role: "release",
      digest: "sha256:graph-pilot-placeholder"
    }],
    audit_event_range: {
      first: "audit:proposal:stage:1",
      last: "audit:release:create:1",
      event_ids: ["audit:proposal:stage:1", "audit:release:create:1"]
    },
    source_version_pins: [{ source_name: "ClinicalTrials.gov", source_version: "2026-06-01" }]
  };
  return {
    tenant_id: "tenant-a",
    environment: "validation",
    snapshot_id: "backup:tenant-a:validation:2026-06-27T09:00:00.000Z",
    graph_exports: [
      {
        graph_name: "urn:pharmaops:tenant-a:working:canonical",
        graph_role: "working",
        triples: [{
          subject: "pharment:compound/aspirin",
          predicate: "rdfs:label",
          object: "Aspirin"
        }]
      },
      {
        graph_name: "urn:pharmaops:tenant-a:release:release-2026-06-27:canonical",
        graph_role: "release",
        triples: [
          {
            subject: "pharment:compound/aspirin",
            predicate: "rdfs:label",
            object: "Aspirin"
          },
          {
            subject: "pharment:compound/aspirin",
            predicate: "pharm:assertionType",
            object: "human_reviewed"
          }
        ]
      }
    ],
    release_manifests: [releaseManifest],
    release_metadata: [{
      release_id: "release-2026-06-27",
      release_candidate_id: "rc-2026-06-27",
      manifest_digest: releaseManifest.manifest_digest,
      status: "candidate",
      included_graphs: releaseManifest.included_graphs,
      audit_event_range: releaseManifest.audit_event_range
    }],
    audit_events: [
      {
        audit_event_id: "audit:proposal:stage:1",
        event_type: "proposal_staged_for_release",
        actor_user_id: "user:release-manager",
        release_id: "release-2026-06-27"
      },
      {
        audit_event_id: "audit:release:create:1",
        event_type: "release_candidate_created",
        actor_user_id: "user:release-manager",
        release_id: "release-2026-06-27"
      }
    ],
    object_artifacts: [{
      object_key: "validation/validation-report-1.json",
      digest: "sha256:validation-pilot-placeholder",
      kind: "validation_report"
    }]
  };
}

function canonicalGovernanceProof({ tenant_id, environment, release_id, manifest_digest }) {
  return {
    canonical: true,
    tenant_id,
    environment,
    release_id,
    manifest_digest,
    approval_trace_digest: "sha256:approval-trace-placeholder"
  };
}

function scoped(record) {
  return {
    tenant_id: "tenant-a",
    environment: "validation",
    ...record
  };
}
