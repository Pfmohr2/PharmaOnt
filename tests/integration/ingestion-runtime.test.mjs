import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  IngestionJobRunner,
  assertExecutionContext,
  LocalDeadLetterQueue,
  LocalJobRunStore,
  LocalRawArtifactStore,
  MemoryMetricSink,
  retryConnectorJob,
  runConnectorJob
} from "../../services/ingestion/src/index.js";

test("ingestion reruns persist the same raw artifact without duplication", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-ingestion-"));
  const runner = new IngestionJobRunner({
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
    errorQueue: new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter.jsonl") }),
    jobRunStore: new LocalJobRunStore({ runLogPath: join(root, "runs.jsonl") }),
    metrics: new MemoryMetricSink()
  });
  const connector = fixtureConnector([
    {
      source_record_id: "CHEMBL25",
      source_record_uri: "https://example.test/chembl/CHEMBL25",
      source_retrieved_at: "2026-06-27T00:00:00.000Z",
      license_classification: "open_with_attribution",
      raw_artifact: { chembl_id: "CHEMBL25", pref_name: "Aspirin" },
      normalized_record: { label: "Aspirin" }
    }
  ]);

  const first = await runner.runConnectorJob({ connector, tenantId: "acme", environment: "test" });
  const second = await runner.runConnectorJob({ connector, tenantId: "acme", environment: "test" });

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.equal(first.artifact_uris[0], second.artifact_uris[0]);
  assert.equal(first.records_normalized, 1);
  assert.equal(second.records_normalized, 0);
  assert.equal(second.skipped_duplicate_count, 1);
  assert.equal(second.normalized_outputs.length, 0);
  assert.match(first.normalized_outputs[0].raw_artifact_uri, /tenants\/acme\/test\/connectors\/chembl\/raw\//);
  assert.equal(artifactFileCount(join(root, "artifacts")), 1);
});

test("failed records go to dead-letter queue and do not block the job", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-ingestion-"));
  const errorQueue = new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter.jsonl") });
  const result = await runConnectorJob({
    connector: fixtureConnector([
      {
        source_record_id: "bad-1",
        raw_artifact: { value: "missing license" },
        normalized_record: {}
      },
      {
        source_record_id: "good-1",
        source_retrieved_at: "2026-06-27T00:01:00.000Z",
        license_classification: "open_materializable",
        raw_artifact: { value: "ok" },
        normalized_record: { value: "ok" }
      }
    ]),
    tenantId: "acme",
    environment: "test",
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
    errorQueue,
    metrics: new MemoryMetricSink()
  });

  const errors = await errorQueue.readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.records_seen, 2);
  assert.equal(result.records_failed, 1);
  assert.equal(result.records_normalized, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].source_record_id, "bad-1");
  assert.match(errors[0].error_message, /license_classification/);
});

test("ingestion emits metrics for counts, duration, and source freshness", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-ingestion-"));
  const metrics = new MemoryMetricSink();

  await runConnectorJob({
    connector: fixtureConnector([
      {
        source_record_id: "rec-1",
        source_retrieved_at: "2026-06-27T00:01:00.000Z",
        license_classification: "open_materializable",
        raw_artifact: { value: "ok" },
        normalized_record: { value: "ok" }
      }
    ]),
    tenantId: "acme",
    environment: "test",
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
    metrics
  });

  assert.ok(metrics.events.some((event) => event.name === "ingestion_records_fetched_total"));
  assert.ok(metrics.events.some((event) => event.name === "ingestion_records_normalized_total"));
  assert.ok(metrics.events.some((event) => event.name === "ingestion_job_duration_ms"));
  assert.ok(metrics.events.some((event) => event.name === "ingestion_source_freshness_ms"));
});

test("released graph targets are routed to the error queue, not normalized output", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-ingestion-"));
  const errorQueue = new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter.jsonl") });
  const result = await runConnectorJob({
    connector: fixtureConnector([
      {
        source_record_id: "release-attempt",
        source_retrieved_at: "2026-06-27T00:02:00.000Z",
        license_classification: "open_materializable",
        target_graph: "graph:tenant:acme:release:2026.0.0:canonical",
        raw_artifact: { value: "bad target" },
        normalized_record: { value: "bad target" }
      }
    ]),
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
  assert.match(errors[0].error_message, /released graphs/);
});

test("licensing policy denials are dead-lettered as blocked, not retryable", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-ingestion-"));
  const errorQueue = new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter.jsonl") });
  const result = await runConnectorJob({
    connector: fixtureConnector([
      {
        source_record_id: "meddra-1",
        source_retrieved_at: "2026-06-27T00:02:00.000Z",
        license_classification: "licensed_federated",
        raw_artifact: { pointer: "meddra://concept/1" },
        normalized_record: { value: "pointer only" }
      }
    ], { sourceName: "MedDRA", sourceVersion: "2026" }),
    tenantId: "acme",
    environment: "test",
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
    errorQueue,
    metrics: new MemoryMetricSink()
  });

  const errors = await errorQueue.readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.records_failed, 1);
  assert.equal(errors[0].error_status, "failed_blocked");
  assert.equal(errors[0].retryable, false);
  assert.ok(errors[0].policy_decision.blocks.includes("federated or pointer-only source cannot be materialized"));
});

test("retry path resumes from checkpoint under the same run lineage", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-ingestion-"));
  const baseOptions = {
    tenantId: "acme",
    environment: "test",
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
    metrics: new MemoryMetricSink()
  };
  const firstAttempt = await runConnectorJob({
    ...baseOptions,
    connector: failingAfterFirstRecordConnector()
  });
  const retry = await retryConnectorJob(firstAttempt, {
    ...baseOptions,
    connector: fixtureConnector([
      {
        source_record_id: "second",
        source_retrieved_at: "2026-06-27T00:03:00.000Z",
        license_classification: "open_materializable",
        raw_artifact: { value: "second" },
        normalized_record: { value: "second" }
      }
    ])
  });

  assert.equal(firstAttempt.status, "failed");
  assert.equal(firstAttempt.checkpoint, "first");
  assert.equal(retry.status, "completed");
  assert.equal(retry.attempt, 2);
  assert.equal(retry.run_lineage_id, firstAttempt.run_lineage_id);
  assert.equal(retry.records_normalized, 1);
});

test("service-account execution context must match job tenant, environment, and requester", () => {
  assert.throws(
    () => assertExecutionContext({
      executionContext: {
        tenant_id: "tenant-a",
        environment: "test",
        service_account_id: "sa-a",
        connector_id: "chembl"
      },
      job: {
        tenant_id: "tenant-b",
        environment: "test",
        requested_by_service_account_id: "sa-a"
      },
      connector: fixtureConnector([]),
      tenantId: "tenant-a",
      environment: "test"
    }),
    /tenant_id does not match/
  );

  assert.throws(
    () => assertExecutionContext({
      executionContext: {
        tenant_id: "tenant-a",
        environment: "test",
        service_account_id: "sa-a",
        connector_id: "chembl"
      },
      job: {
        tenant_id: "tenant-a",
        environment: "test",
        requested_by_service_account_id: "sa-b"
      },
      connector: fixtureConnector([]),
      tenantId: "tenant-a",
      environment: "test"
    }),
    /requested_by_service_account_id/
  );
});

test("matching service-account execution context is recorded in job and dead-letter metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-ingestion-"));
  const errorQueue = new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter.jsonl") });
  const executionContext = {
    tenant_id: "acme",
    environment: "test",
    service_account_id: "sa-connector-acme",
    connector_id: "chembl",
    license_policy_id: "license-policy:chembl-34",
    correlation_id: "corr-123"
  };
  const result = await runConnectorJob({
    connector: fixtureConnector([
      {
        source_record_id: "bad-ctx",
        raw_artifact: { value: "missing license" },
        normalized_record: {}
      }
    ]),
    tenantId: "acme",
    environment: "test",
    executionContext,
    job: {
      job_id: "job-123",
      tenant_id: "acme",
      environment: "test",
      requested_by_service_account_id: "sa-connector-acme"
    },
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
    errorQueue,
    metrics: new MemoryMetricSink()
  });

  const errors = await errorQueue.readAll();

  assert.equal(result.service_account_id, "sa-connector-acme");
  assert.equal(result.connector_id, "chembl");
  assert.equal(result.correlation_id, "corr-123");
  assert.equal(errors[0].tenant_id, "acme");
  assert.equal(errors[0].environment, "test");
  assert.equal(errors[0].service_account_id, "sa-connector-acme");
  assert.equal(errors[0].correlation_id, "corr-123");
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

function failingAfterFirstRecordConnector() {
  return {
    ...fixtureConnector([]),
    async *fetchRecords() {
      yield {
        source_record_id: "first",
        source_retrieved_at: "2026-06-27T00:02:00.000Z",
        license_classification: "open_materializable",
        raw_artifact: { value: "first" },
        normalized_record: { value: "first" }
      };
      throw new Error("upstream source timeout");
    }
  };
}

function artifactFileCount(root) {
  return readdirSync(root, { recursive: true })
    .filter((entry) => String(entry).endsWith(".artifact"))
    .length;
}
