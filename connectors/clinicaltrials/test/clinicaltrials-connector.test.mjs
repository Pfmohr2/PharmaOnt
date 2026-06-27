import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConnectorRetryableError } from "../../../packages/connector-sdk/src/index.js";
import {
  LocalDeadLetterQueue,
  LocalRawArtifactStore,
  MemoryMetricSink,
  runConnectorJob
} from "../../../services/ingestion/src/index.js";
import {
  CLINICALTRIALS_LICENSE_CLASSIFICATION,
  CLINICALTRIALS_SOURCE_VERSION,
  createClinicalTrialsGovConnector,
  normalizeClinicalTrialRecord,
  parseClinicalTrialsPayload
} from "../src/index.js";

const fixturePath = new URL("../fixtures/clinicaltrials-gov-v2-studies.json", import.meta.url);

test("ClinicalTrials.gov fixture parses NCT-keyed trial records with pinned source version", async () => {
  const payload = await import("../fixtures/clinicaltrials-gov-v2-studies.json", { with: { type: "json" } });
  const parsed = parseClinicalTrialsPayload(payload.default);

  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.records[0].source_record_id, "NCT04280705");
  assert.equal(parsed.records[0].source_version, CLINICALTRIALS_SOURCE_VERSION);
  assert.equal(parsed.records[0].license_classification, CLINICALTRIALS_LICENSE_CLASSIFICATION);
  assert.deepEqual(parsed.records[0].conditions, ["COVID-19"]);
  assert.equal(parsed.records[2].contains_phi_or_pii, true);
  assert.ok(parsed.records[2].warnings.some((warning) => warning.includes("clinicaltrials_contact_pii_detected")));

  const normalizedWithPii = normalizeClinicalTrialRecord({
    ...parsed.records[0],
    contains_phi_or_pii: true,
    pii_flags: ["central_contacts"]
  });
  assert.equal(normalizedWithPii.contains_phi_or_pii, true);
  assert.deepEqual(normalizedWithPii.pii_flags, ["central_contacts"]);
});

test("ClinicalTrials.gov connector runs through ingestion runtime and persists content-addressed raw artifacts", async () => {
  const { connector, root, errorQueue, metrics } = runtimeFixture();
  const result = await runConnectorJob({
    connector,
    tenantId: "acme",
    environment: "test",
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
    errorQueue,
    metrics
  });

  const errors = await errorQueue.readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.records_seen, 3);
  assert.equal(result.records_normalized, 2);
  assert.equal(result.records_failed, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].source_record_id, "");
  assert.match(errors[0].error_message, /source_record_id is required|NCT ID/);
  assert.equal(result.normalized_outputs[0].source_version, CLINICALTRIALS_SOURCE_VERSION);
  assert.equal(result.normalized_outputs[0].license_classification, "open_with_attribution");
  assert.equal(result.normalized_outputs[0].normalized_record.nct_id, "NCT04280705");
  assert.deepEqual(result.normalized_outputs[0].normalized_record.conditions, ["COVID-19"]);
  assert.deepEqual(result.normalized_outputs[0].normalized_record.interventions.map((item) => item.name), ["Remdesivir"]);
  assert.equal(result.normalized_outputs[0].warnings.includes("clinicaltrials_embedded_contact_pii_flagged_for_policy_gate"), false);
  assert.match(result.normalized_outputs[0].raw_artifact_uri, /clinicaltrials_gov\/raw/);
  assert.equal(artifactFileCount(join(root, "artifacts")), 2);
  assert.ok(metrics.events.some((event) => event.name === "ingestion_records_normalized_total"));
});

test("ClinicalTrials.gov replay is idempotent for artifacts and records", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-clinicaltrials-"));
  const rawArtifactStore = new LocalRawArtifactStore({ rootDir: join(root, "artifacts") });
  const connector = createClinicalTrialsGovConnector({ fixturePath });
  const first = await runConnectorJob({
    connector,
    tenantId: "acme",
    environment: "test",
    rawArtifactStore,
    errorQueue: new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter-first.jsonl") }),
    metrics: new MemoryMetricSink()
  });
  const second = await runConnectorJob({
    connector: createClinicalTrialsGovConnector({ fixturePath }),
    tenantId: "acme",
    environment: "test",
    rawArtifactStore,
    errorQueue: new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter-second.jsonl") }),
    metrics: new MemoryMetricSink()
  });

  assert.equal(first.normalized_outputs[0].raw_artifact_uri, second.normalized_outputs[0].raw_artifact_uri);
  assert.equal(first.normalized_outputs[0].idempotency_key, second.normalized_outputs[0].idempotency_key);
  assert.equal(artifactFileCount(join(root, "artifacts")), 2);
});

test("ClinicalTrials.gov transient fixture fetch failure retries through ingestion retry path", async () => {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-clinicaltrials-"));
  const first = await runConnectorJob({
    connector: createClinicalTrialsGovConnector({ fixturePath, failFetchAttempts: 1 }),
    tenantId: "acme",
    environment: "test",
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts") }),
    errorQueue: new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter.jsonl") }),
    metrics: new MemoryMetricSink()
  });
  const retry = await runConnectorJob({
    connector: createClinicalTrialsGovConnector({ fixturePath }),
    tenantId: "acme",
    environment: "test",
    rawArtifactStore: new LocalRawArtifactStore({ rootDir: join(root, "artifacts-retry") }),
    errorQueue: new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter-retry.jsonl") }),
    metrics: new MemoryMetricSink(),
    runLineageId: first.run_lineage_id,
    attempt: 2,
    checkpoint: first.checkpoint
  });

  assert.equal(first.status, "failed");
  assert.match(first.error_summary[0].message, /temporarily unavailable/);
  assert.equal(retry.status, "completed");
  assert.equal(retry.attempt, 2);
  assert.equal(retry.run_lineage_id, first.run_lineage_id);
  assert.equal(retry.records_normalized, 2);
});

test("ClinicalTrials.gov source version fails closed before fetch when absent", () => {
  assert.throws(
    () => createClinicalTrialsGovConnector({
      fixturePath,
      metadata: {
        ...createClinicalTrialsGovConnector({ fixturePath }).metadata,
        source_version: ""
      }
    }),
    /source_version/
  );
});

test("ClinicalTrials.gov ConnectorBase path retries transient fetch and emits normalized records", async () => {
  const connector = createClinicalTrialsGovConnector({
    fixturePath,
    failFetchAttempts: 1,
    includeInvalidRecords: false,
    retryPolicy: { max_attempts: 2, initial_delay_ms: 0, max_delay_ms: 0, multiplier: 1 }
  });
  const result = await connector.run({
    execution_context: {
      tenant_id: "acme",
      environment: "test",
      service_account_id: "svc-clinicaltrials",
      connector_id: "clinicaltrials_gov",
      connector_version: "0.1.0",
      source_name: "ClinicalTrials.gov",
      source_version: CLINICALTRIALS_SOURCE_VERSION,
      source_version_strategy: "retrieval_timestamp",
      license_policy_id: "license-policy:clinicaltrials-gov",
      correlation_id: "corr-clinicaltrials-base",
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
    }
  });

  assert.equal(connector.fetchAttempts, 2);
  assert.equal(result.status, "completed");
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].normalized_record.nct_id, "NCT04280705");
});

function runtimeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pharmaops-clinicaltrials-"));
  return {
    connector: createClinicalTrialsGovConnector({ fixturePath }),
    root,
    errorQueue: new LocalDeadLetterQueue({ queuePath: join(root, "dead-letter.jsonl") }),
    metrics: new MemoryMetricSink()
  };
}

function artifactFileCount(root) {
  return readdirSync(root, { recursive: true })
    .filter((entry) => String(entry).endsWith(".artifact"))
    .length;
}

assert.ok(ConnectorRetryableError);
