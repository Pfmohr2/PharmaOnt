import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  InMemoryCheckpointStore,
  InMemoryNormalizedRecordStore,
  InMemoryRawArtifactStore,
  connectorAllowedActions
} from "../../../packages/connector-sdk/src/index.js";
import {
  LocalRawArtifactStore,
  MemoryDeadLetterQueue,
  MemoryJobRunStore,
  MemoryMetricSink,
  runConnectorJob
} from "../../../services/ingestion/src/index.js";
import {
  UNIPROT_LICENSE_CLASSIFICATION,
  UNIPROT_SOURCE_VERSION,
  UniProtConnector,
  uniprotMetadata
} from "../src/index.js";

const fixturePath = new URL("../fixtures/uniprotkb-proteins-2026_02.json", import.meta.url);
const badFixturePath = new URL("../fixtures/uniprotkb-bad-record-2026_02.json", import.meta.url);

test("UniProt SDK path fetches, persists raw fixture, parses, normalizes, and emits proteins", async () => {
  const stores = sdkStores();
  const connector = new UniProtConnector({
    fixturePath,
    ...stores,
    clock: fixedSdkClock
  });

  const result = await connector.run({ execution_context: executionContext("corr-uniprot-sdk") });

  assert.equal(result.status, "completed");
  assert.equal(result.raw_artifact.created, true);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].source_name, "UniProt");
  assert.equal(result.records[0].source_version, UNIPROT_SOURCE_VERSION);
  assert.equal(result.records[0].license_classification, UNIPROT_LICENSE_CLASSIFICATION);
  assert.equal(result.records[0].normalized_record.accession, "P00533");
  assert.equal(result.records[0].normalized_record.recommended_name, "Epidermal growth factor receptor");
  assert.deepEqual(result.records[0].normalized_record.genes, ["EGFR", "ERBB", "ERBB1"]);
  assert.equal(result.records[0].candidate_entities[0].preferred_identifier_hint, "uniprot:P00533");
  assert.equal(result.records[0].provenance.source_artifact_digest, result.raw_artifact.digest);
});

test("UniProt SDK path retries a transient fetch failure before persistence", async () => {
  const stores = sdkStores();
  const connector = new UniProtConnector({
    fixturePath,
    failFetchAttempts: 1,
    retryPolicy: { max_attempts: 3, initial_delay_ms: 0, max_delay_ms: 0, multiplier: 1 },
    ...stores,
    clock: fixedSdkClock
  });

  const result = await connector.run({ execution_context: executionContext("corr-uniprot-retry") });

  assert.equal(connector.fetchAttempts, 2);
  assert.equal(result.emitted_count, 2);
  assert.equal(stores.rawArtifactStore.artifacts.size, 1);
  assert.equal(stores.normalizedRecordStore.records.size, 2);
});

test("UniProt ingestion job stores content-addressed raw artifacts and emits normalized records", async () => {
  const harness = ingestionHarness();
  const connector = new UniProtConnector({ fixturePath });

  const run = await runConnectorJob({
    connector,
    tenantId: "tenant-a",
    environment: "test",
    executionContext: ingestionExecutionContext("corr-uniprot-ingestion"),
    ...harness
  });

  assert.equal(run.status, "completed");
  assert.equal(run.records_seen, 2);
  assert.equal(run.records_persisted, 2);
  assert.equal(run.records_normalized, 2);
  assert.equal(run.records_failed, 0);
  assert.equal(run.normalized_outputs[0].source_record_id, "P00533");
  assert.equal(run.normalized_outputs[0].source_version, UNIPROT_SOURCE_VERSION);
  assert.equal(run.normalized_outputs[0].license_classification, UNIPROT_LICENSE_CLASSIFICATION);
  assert.equal(run.normalized_outputs[0].normalized_record.accession, "P00533");
  assert.equal(run.normalized_outputs[0].policy_decision.license_classification, UNIPROT_LICENSE_CLASSIFICATION);
  assert.match(run.artifact_uris[0], /connectors\/uniprot\/raw\/sources\/UniProt\/versions\/2026_02\/records\/P00533/);
  assert.ok(harness.metrics.events.some((event) => event.name === "ingestion_records_normalized_total"));
});

test("UniProt ingestion replay is idempotent for artifact paths and output keys", async () => {
  const harness = ingestionHarness();
  const connector = new UniProtConnector({ fixturePath });
  const baseOptions = {
    connector,
    tenantId: "tenant-a",
    environment: "test",
    ...harness
  };

  const first = await runConnectorJob({
    ...baseOptions,
    executionContext: ingestionExecutionContext("corr-uniprot-replay-1")
  });
  const second = await runConnectorJob({
    ...baseOptions,
    executionContext: ingestionExecutionContext("corr-uniprot-replay-2")
  });

  assert.deepEqual(first.artifact_uris, second.artifact_uris);
  assert.deepEqual(
    first.normalized_outputs.map((record) => record.idempotency_key),
    second.normalized_outputs.map((record) => record.idempotency_key)
  );
});

test("UniProt connector fails closed when source version is absent", () => {
  assert.throws(
    () => new UniProtConnector({
      fixturePath,
      metadata: uniprotMetadata({ sourceVersion: "" })
    }),
    /source_version/
  );
});

test("UniProt ingestion job dead-letters malformed records without writing released graphs", async () => {
  const harness = ingestionHarness();
  const connector = new UniProtConnector({ fixturePath: badFixturePath });

  const run = await runConnectorJob({
    connector,
    tenantId: "tenant-a",
    environment: "test",
    executionContext: ingestionExecutionContext("corr-uniprot-bad-record"),
    ...harness
  });

  const deadLetters = await harness.errorQueue.readAll();
  assert.equal(run.status, "completed");
  assert.equal(run.records_seen, 1);
  assert.equal(run.records_failed, 1);
  assert.equal(run.records_normalized, 0);
  assert.equal(deadLetters.length, 1);
  assert.match(deadLetters[0].error_message, /source_record_id/);
  assert.equal(deadLetters[0].source_name, "UniProt");
  assert.equal(deadLetters[0].source_version, UNIPROT_SOURCE_VERSION);
});

function sdkStores() {
  return {
    rawArtifactStore: new InMemoryRawArtifactStore(),
    checkpointStore: new InMemoryCheckpointStore(),
    normalizedRecordStore: new InMemoryNormalizedRecordStore()
  };
}

function ingestionHarness() {
  return {
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: mkdtempSync(join(tmpdir(), "pharmaops-uniprot-artifacts-")) }),
    errorQueue: new MemoryDeadLetterQueue(),
    jobRunStore: new MemoryJobRunStore(),
    metrics: new MemoryMetricSink({ clock: fixedIngestionClock })
  };
}

function executionContext(correlation_id) {
  return {
    tenant_id: "tenant-a",
    environment: "test",
    service_account_id: "svc-uniprot-ingestion",
    connector_id: "uniprot",
    connector_version: "0.1.0",
    source_name: "UniProt",
    source_version: UNIPROT_SOURCE_VERSION,
    source_version_strategy: "release",
    license_policy_id: "license-policy:uniprot-2026_02",
    correlation_id,
    allowed_actions: connectorAllowedActions
  };
}

function ingestionExecutionContext(correlation_id) {
  return {
    tenant_id: "tenant-a",
    environment: "test",
    service_account_id: "svc-uniprot-ingestion",
    connector_id: "uniprot",
    connector_version: "0.1.0",
    source_name: "UniProt",
    source_version: UNIPROT_SOURCE_VERSION,
    source_version_strategy: "release",
    license_policy_id: "license-policy:uniprot-2026_02",
    correlation_id
  };
}

function fixedSdkClock() {
  return new Date("2026-06-27T03:00:00.000Z");
}

const fixedIngestionClock = {
  now() {
    return new Date("2026-06-27T03:00:00.000Z");
  }
};
