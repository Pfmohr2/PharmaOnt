import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  InMemoryCheckpointStore,
  InMemoryNormalizedRecordStore,
  InMemoryRawArtifactStore
} from "../../../packages/connector-sdk/src/index.js";
import {
  IngestionJobRunner,
  LocalRawArtifactStore,
  MemoryDeadLetterQueue,
  MemoryMetricSink,
  MemoryNormalizedOutputStore,
  retryConnectorJob,
  runConnectorJob
} from "../../../services/ingestion/src/index.js";
import { CHEMBL_SOURCE_VERSION, ChemblConnector } from "../src/index.js";

const fixturePath = new URL("../fixtures/chembl-molecule-activities-CHEMBL_34.json", import.meta.url);

test("ChEMBL ConnectorBase run fetches, persists raw, parses, normalizes, and emits candidates", async () => {
  const stores = {
    rawArtifactStore: new InMemoryRawArtifactStore(),
    checkpointStore: new InMemoryCheckpointStore(),
    normalizedRecordStore: new InMemoryNormalizedRecordStore()
  };
  const connector = new ChemblConnector({
    fixturePath,
    ...stores,
    clock: fixedClock
  });

  const result = await connector.run({ execution_context: sdkExecutionContext("sdk-run") });

  assert.equal(result.status, "completed");
  assert.equal(result.raw_artifact.created, true);
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map((record) => record.source_record_id), ["CHEMBL25", "CHEMBL1201585"]);
  assert.equal(result.records.every((record) => record.source_version === CHEMBL_SOURCE_VERSION), true);
  assert.equal(result.records.every((record) => record.license_classification === "open_with_attribution"), true);
  assert.equal(result.records[0].normalized_record.structures.standard_inchi_key, "BSYNRYMUTXBXSQ-UHFFFAOYSA-N");
  assert.equal(result.records[0].candidate_relationships[0].object_identifier, "chembl.target:CHEMBL221");
});

test("ChEMBL ingestion job persists content-addressed raw records and emits pinned normalized records", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-chembl-"));
  const rawArtifactStore = new LocalRawArtifactStore({ rootDir: join(root, "artifacts") });
  const normalizedOutputStore = new MemoryNormalizedOutputStore();
  const metrics = new MemoryMetricSink({ clock: ingestionClock });
  const runner = new IngestionJobRunner({
    rawArtifactStore,
    normalizedOutputStore,
    metrics,
    clock: ingestionClock
  });

  const first = await runner.runConnectorJob({
    connector: new ChemblConnector({ fixturePath, clock: fixedClock }),
    tenantId: "acme",
    environment: "test"
  });
  const second = await runner.runConnectorJob({
    connector: new ChemblConnector({ fixturePath, clock: fixedClock }),
    tenantId: "acme",
    environment: "test"
  });
  const persistedOutputs = await normalizedOutputStore.readAll();

  assert.equal(first.status, "completed");
  assert.equal(first.records_seen, 2);
  assert.equal(first.records_normalized, 2);
  assert.equal(first.records_failed, 0);
  assert.equal(first.normalized_outputs.every((record) => record.source_version === CHEMBL_SOURCE_VERSION), true);
  assert.equal(first.normalized_outputs.every((record) => record.license_classification === "open_with_attribution"), true);
  assert.equal(first.normalized_outputs.every((record) => record.normalized_record.license_classification === "open_with_attribution"), true);
  assert.equal(first.normalized_outputs.every((record) => record.normalized_record.contains_phi_or_pii === false), true);
  assert.equal(first.normalized_outputs[0].candidate_entities[0].source_identifiers[0], "chembl.compound:CHEMBL25");
  assert.equal(first.normalized_outputs[0].candidate_relationships[0].predicate, "has_activity_against");
  assert.equal(second.status, "completed");
  assert.equal(second.records_normalized, 0);
  assert.equal(second.skipped_duplicate_count, 2);
  assert.equal(second.normalized_outputs.length, 0);
  assert.deepEqual(persistedOutputs.map((record) => record.idempotency_key), first.normalized_outputs.map((record) => record.idempotency_key));
  assert.equal(artifactFileCount(join(root, "artifacts")), 2);
  assert.ok(metrics.events.some((event) => event.name === "ingestion_records_normalized_total"));
  assert.ok(metrics.events.some((event) => event.name === "ingestion_records_duplicate_skipped_total"));
});

test("ChEMBL connector fails closed when source_version is not pinned", () => {
  assert.throws(
    () => new ChemblConnector({ fixturePath, sourceVersion: "" }),
    /source_version must be pinned/
  );
});

test("ChEMBL transient fetch failure is retryable through ingestion job lineage", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-chembl-retry-"));
  const rawArtifactStore = new LocalRawArtifactStore({ rootDir: join(root, "artifacts") });
  const errorQueue = new MemoryDeadLetterQueue();
  const firstAttempt = await runConnectorJob({
    connector: new ChemblConnector({ fixturePath, failFetchAttempts: 1, clock: fixedClock }),
    tenantId: "acme",
    environment: "test",
    rawArtifactStore,
    errorQueue,
    metrics: new MemoryMetricSink({ clock: ingestionClock })
  });

  const retry = await retryConnectorJob(firstAttempt, {
    connector: new ChemblConnector({ fixturePath, clock: fixedClock }),
    tenantId: "acme",
    environment: "test",
    rawArtifactStore,
    errorQueue,
    metrics: new MemoryMetricSink({ clock: ingestionClock })
  });

  assert.equal(firstAttempt.status, "failed");
  assert.equal(retry.status, "completed");
  assert.equal(retry.attempt, 2);
  assert.equal(retry.run_lineage_id, firstAttempt.run_lineage_id);
  assert.equal(retry.records_normalized, 2);
});

test("ChEMBL malformed source record is dead-lettered while valid records continue", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-chembl-bad-"));
  const errorQueue = new MemoryDeadLetterQueue();
  const payload = malformedPayload();
  const result = await runConnectorJob({
    connector: new ChemblConnector({ fixturePayload: payload, clock: fixedClock }),
    tenantId: "acme",
    environment: "test",
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
    errorQueue,
    metrics: new MemoryMetricSink({ clock: ingestionClock })
  });
  const errors = await errorQueue.readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.records_seen, 2);
  assert.equal(result.records_normalized, 1);
  assert.equal(result.records_failed, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0].error_message, /source_record_id/);
  assert.deepEqual(result.normalized_outputs.map((record) => record.source_record_id), ["CHEMBL25"]);
});

function malformedPayload() {
  return {
    molecule_response: {
      page_meta: { limit: 2, next: null, offset: 0, previous: null, total_count: 2 },
      molecules: [
        {
          molecule_chembl_id: "",
          pref_name: "MISSING CHEMBL ID",
          molecule_structures: {}
        },
        {
          molecule_chembl_id: "CHEMBL25",
          pref_name: "ASPIRIN",
          molecule_structures: {
            canonical_smiles: "CC(=O)Oc1ccccc1C(=O)O",
            standard_inchi_key: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N"
          },
          molecule_synonyms: []
        }
      ]
    },
    activity_response: { page_meta: { total_count: 0 }, activities: [] }
  };
}

function sdkExecutionContext(correlation_id) {
  return {
    tenant_id: "acme",
    environment: "test",
    service_account_id: "sa-chembl",
    connector_id: "chembl",
    connector_version: "0.1.0",
    source_name: "ChEMBL",
    source_version: CHEMBL_SOURCE_VERSION,
    license_policy_id: "license-policy:chembl-34",
    correlation_id,
    allowed_actions: [
      "connector.run",
      "source.read",
      "license.evaluate",
      "artifact.write_raw",
      "record.write_normalized",
      "candidate.emit",
      "job.claim",
      "job.emit_event",
      "metric.write_tenant",
      "log.write_redacted"
    ]
  };
}

function fixedClock() {
  return new Date("2026-06-27T02:55:00.000Z");
}

const ingestionClock = {
  now() {
    return new Date("2026-06-27T02:55:00.000Z");
  }
};

function artifactFileCount(root) {
  return readdirSync(root, { recursive: true })
    .filter((entry) => String(entry).endsWith(".artifact"))
    .length;
}
