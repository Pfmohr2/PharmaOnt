import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  IngestionJobRunner,
  LocalDeadLetterQueue,
  LocalJobRunStore,
  LocalRawArtifactStore,
  MemoryMetricSink,
  buildCheckpointBinding,
  retryConnectorJob,
  runConnectorJob
} from "../../services/ingestion/src/index.js";

test("P2-RT-001 post-normalization release targets are dead-lettered and not emitted", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-ingestion-redteam-"));
  const errorQueue = new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter.jsonl") });
  const result = await runConnectorJob({
    connector: fixtureConnector([
      {
        source_record_id: "normalize-release-graph",
        source_retrieved_at: "2026-06-27T00:02:00.000Z",
        license_classification: "open_materializable",
        raw_artifact: { value: "graph injected at normalize" },
        normalized_record: { value: "graph injected at normalize" }
      },
      {
        source_record_id: "normalize-release-id",
        source_retrieved_at: "2026-06-27T00:02:01.000Z",
        license_classification: "open_materializable",
        raw_artifact: { value: "release id injected at normalize" },
        normalized_record: { value: "release id injected at normalize" }
      }
    ], {
      normalizeRecord(record) {
        if (record.source_record_id === "normalize-release-graph") {
          return {
            value: record.normalized_record.value,
            target_graph: "graph:tenant:acme:release:2026.0.0:canonical"
          };
        }
        return {
          value: record.normalized_record.value,
          release_id: "2026.0.0"
        };
      }
    }),
    tenantId: "acme",
    environment: "test",
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
    errorQueue,
    metrics: new MemoryMetricSink()
  });

  const errors = await errorQueue.readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.records_seen, 2);
  assert.equal(result.records_failed, 2);
  assert.equal(result.records_persisted, 0);
  assert.equal(result.records_normalized, 0);
  assert.equal(result.normalized_outputs.length, 0);
  assert.deepEqual(errors.map((error) => error.source_record_id).sort(), ["normalize-release-graph", "normalize-release-id"]);
  assert.ok(errors.every((error) => /released graphs|release_id/.test(error.error_message)));
});

test("P2-RT-002 post-normalization PII flips are blocked and final policy reflects PII", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-ingestion-redteam-"));
  const errorQueue = new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter.jsonl") });
  const result = await runConnectorJob({
    connector: fixtureConnector([
      {
        source_record_id: "normalize-pii",
        source_retrieved_at: "2026-06-27T00:02:30.000Z",
        license_classification: "open_materializable",
        raw_artifact: { value: "pii injected at normalize" },
        normalized_record: { value: "pii injected at normalize" }
      }
    ], {
      normalizeRecord(record) {
        return {
          ...record.normalized_record,
          contains_phi_or_pii: true,
          policy: {
            decisions: {
              ai_eligible: true
            }
          }
        };
      }
    }),
    tenantId: "acme",
    environment: "test",
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
    errorQueue,
    metrics: new MemoryMetricSink()
  });

  const errors = await errorQueue.readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.records_failed, 1);
  assert.equal(result.records_normalized, 0);
  assert.equal(result.normalized_outputs.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error_status, "failed_blocked");
  assert.equal(errors[0].retryable, false);
  assert.equal(errors[0].policy_decision.decisions.contains_phi_or_pii, true);
  assert.equal(errors[0].policy_decision.decisions.ai_eligible, false);
});

test("P2-RT-003 normalized output idempotency skips duplicate reruns and versions changed snapshots", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-ingestion-redteam-"));
  const runner = new IngestionJobRunner({
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
    errorQueue: new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter.jsonl") }),
    jobRunStore: new LocalJobRunStore({ runLogPath: join(root, "runs.jsonl") }),
    metrics: new MemoryMetricSink()
  });
  const records = [
    {
      source_record_id: "CHEMBL25",
      source_record_uri: "https://example.test/chembl/CHEMBL25",
      source_retrieved_at: "2026-06-27T00:00:00.000Z",
      license_classification: "open_materializable",
      raw_artifact: { chembl_id: "CHEMBL25", pref_name: "Aspirin" },
      normalized_record: { label: "Aspirin" }
    }
  ];

  const first = await runner.runConnectorJob({
    connector: fixtureConnector(records),
    tenantId: "acme",
    environment: "test"
  });
  const duplicate = await runner.runConnectorJob({
    connector: fixtureConnector(records),
    tenantId: "acme",
    environment: "test"
  });
  const changedSnapshot = await runner.runConnectorJob({
    connector: fixtureConnector(records, { sourceSnapshotDigest: "sha256:fixture-snapshot-v2" }),
    tenantId: "acme",
    environment: "test"
  });

  assert.equal(first.records_normalized, 1);
  assert.equal(first.normalized_outputs.length, 1);
  assert.equal(duplicate.records_normalized, 0);
  assert.equal(duplicate.normalized_outputs.length, 0);
  assert.equal(duplicate.skipped_duplicate_count, 1);
  assert.equal(changedSnapshot.records_normalized, 1);
  assert.equal(changedSnapshot.normalized_outputs.length, 1);
  assert.notEqual(changedSnapshot.normalized_outputs[0].idempotency_key, first.normalized_outputs[0].idempotency_key);
});

test("P2-RT-004 retry rejects cross-scope lineage before execution or checkpoint replay", async () => {
  const previousRun = {
    run_id: "run-tenant-a",
    run_lineage_id: "lineage-tenant-a",
    attempt: 1,
    tenant_id: "tenant-a",
    environment: "test",
    service_account_id: "sa-tenant-a-chembl",
    connector_id: "chembl",
    connector_name: "fixture-connector",
    connector_version: "1.0.0",
    source_name: "ChEMBL",
    source_version: "34",
    source_snapshot_digest: "sha256:fixture-snapshot",
    license_policy_id: "license-policy:chembl",
    correlation_id: "corr-tenant-a",
    checkpoint: "tenant-a-checkpoint"
  };
  previousRun.checkpoint_binding = buildCheckpointBinding(previousRun, {
    issuedAt: new Date("2026-06-27T00:05:00.000Z"),
    expiresAt: new Date("2026-06-28T00:05:00.000Z")
  });
  const cases = [
    {
      name: "cross-tenant",
      tenantId: "tenant-b",
      environment: "test",
      connector: "chembl",
      sourceName: "ChEMBL",
      sourceVersion: "34",
      serviceAccountId: "sa-tenant-a-chembl"
    },
    {
      name: "cross-environment",
      tenantId: "tenant-a",
      environment: "prod",
      connector: "chembl",
      sourceName: "ChEMBL",
      sourceVersion: "34",
      serviceAccountId: "sa-tenant-a-chembl"
    },
    {
      name: "cross-connector",
      tenantId: "tenant-a",
      environment: "test",
      connector: "uniprot",
      sourceName: "ChEMBL",
      sourceVersion: "34",
      serviceAccountId: "sa-tenant-a-chembl"
    },
    {
      name: "cross-source",
      tenantId: "tenant-a",
      environment: "test",
      connector: "chembl",
      sourceName: "UniProt",
      sourceVersion: "2026_02",
      serviceAccountId: "sa-tenant-a-chembl"
    },
    {
      name: "cross-service-account",
      tenantId: "tenant-a",
      environment: "test",
      connector: "chembl",
      sourceName: "ChEMBL",
      sourceVersion: "34",
      serviceAccountId: "sa-other"
    }
  ];

  for (const scopeCase of cases) {
    const root = mkdtempSync(join(tmpdir(), `pharmaops-retry-${scopeCase.name}-`));
    const seenCheckpoints = [];
    const connector = trackingFixtureConnector({
      id: scopeCase.connector,
      sourceName: scopeCase.sourceName,
      sourceVersion: scopeCase.sourceVersion,
      seenCheckpoints
    });

    await assert.rejects(
      () => retryConnectorJob(previousRun, {
        connector,
        tenantId: scopeCase.tenantId,
        environment: scopeCase.environment,
        executionContext: {
          tenant_id: scopeCase.tenantId,
          environment: scopeCase.environment,
          service_account_id: scopeCase.serviceAccountId,
          connector_id: scopeCase.connector,
          license_policy_id: `license-policy:${scopeCase.connector}`,
          correlation_id: `corr-${scopeCase.name}`
        },
        rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
        metrics: new MemoryMetricSink()
      }),
      /retry.*scope|lineage|tenant|environment|connector|source|service-account|claim denied/
    );
    assert.deepEqual(seenCheckpoints, []);
    assert.equal(artifactFileCount(join(root, "artifacts")), 0);
  }
});

function fixtureConnector(records, overrides = {}) {
  return {
    id: "chembl",
    name: "fixture-connector",
    version: "1.0.0",
    sourceName: "ChEMBL",
    sourceVersion: "34",
    sourceSnapshotDigest: "sha256:fixture-snapshot",
    parserVersion: "parser-1",
    normalizationRulesetVersion: "rules-1",
    ...overrides,
    async *fetchRecords() {
      for (const record of records) {
        yield record;
      }
    }
  };
}

function trackingFixtureConnector({ id, sourceName, sourceVersion, seenCheckpoints }) {
  return {
    id,
    name: "fixture-connector",
    version: "1.0.0",
    sourceName,
    sourceVersion,
    sourceSnapshotDigest: "sha256:fixture-snapshot",
    parserVersion: "parser-1",
    normalizationRulesetVersion: "rules-1",
    async *fetchRecords({ checkpoint }) {
      seenCheckpoints.push(checkpoint);
      yield {
        source_record_id: "retry-scope-record",
        source_retrieved_at: "2026-06-27T00:04:00.000Z",
        license_classification: "open_materializable",
        raw_artifact: { value: "should not fetch on bad retry scope" },
        normalized_record: { value: "should not emit on bad retry scope" }
      };
    }
  };
}

function artifactFileCount(root) {
  if (!existsSync(root)) {
    return 0;
  }
  return readdirSync(root, { recursive: true })
    .filter((entry) => String(entry).endsWith(".artifact"))
    .length;
}
