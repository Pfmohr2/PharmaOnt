import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ConnectorBase,
  ConnectorPolicyError,
  ConnectorRetryableError,
  FixtureConnector,
  InMemoryCheckpointStore,
  InMemoryNormalizedRecordStore,
  InMemoryRawArtifactStore,
  nextBackoffMs,
  requireConnectorAction,
  validateExecutionContext,
  validateConnectorMetadata
} from "../src/index.js";

const fixturePath = new URL("../fixtures/fixture-source.json", import.meta.url);

test("fixture connector persists raw artifact, emits normalized records, and checkpoints", async () => {
  const stores = memoryStores();
  const connector = new FixtureConnector({
    fixturePath,
    metadata: validMetadata(),
    ...stores,
    clock: fixedClock
  });

  const result = await connector.run({
    execution_context: validExecutionContext("corr-fixture-1")
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.lifecycle, [
    "configured",
    "scheduled",
    "running",
    "fetched",
    "raw_persisted",
    "parsed",
    "normalized",
    "validated",
    "completed"
  ]);
  assert.equal(result.raw_artifact.created, true);
  assert.match(result.raw_artifact.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(stores.rawArtifactStore.artifacts.size, 1);
  assert.equal(result.records.length, 2);
  assert.equal(result.emitted_count, 2);
  assert.equal(result.duplicate_count, 0);
  assert.equal(result.records[0].source_name, "Fixture Source");
  assert.equal(result.records[0].source_version, "2026-06-27");
  assert.equal(result.records[0].source_version_strategy, "version");
  assert.equal(result.records[0].service_account_id, "svc-fixture-ingestion");
  assert.equal(result.records[0].connector_id, "fixture_reference");
  assert.equal(result.records[0].license_policy_id, "license-policy:fixture");
  assert.equal(result.records[0].license_classification, "open_with_attribution");
  assert.equal(result.records[0].materialization_policy, "materialize");
  assert.equal(result.records[0].sensitivity_classification, "public");
  assert.equal(result.records[0].retention_class, "public_source_snapshot");
  assert.equal(result.records[0].raw_artifact_policy, "persist");
  assert.equal(result.records[0].ai_use_policy, "allowed_with_attribution");
  assert.deepEqual(result.records[0].permitted_uses, ["ingest", "normalize", "curate", "search", "evidence", "release"]);
  assert.deepEqual(result.records[0].export_restrictions, ["attribution_required"]);
  assert.deepEqual(result.records[0].disclaimer_ids, ["fixture_terms:v1"]);
  assert.deepEqual(result.records[0].evidence_flags.disclaimer_ids, ["fixture_terms:v1"]);
  assert.match(result.records[0].raw_artifact_uri, /^memory:\/\/raw-artifacts\//);
  assert.match(result.records[0].record_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.records[0].candidate_entities[0].review_status, undefined);
  assert.equal(result.records[0].provenance.connector_name, "fixture_reference");
  assert.equal(result.records[0].provenance.service_account_id, "svc-fixture-ingestion");
  assert.equal(result.records[0].provenance.source_artifact_digest, result.raw_artifact.digest);
  assert.equal(result.records[0].policy_decision.license_classification, "open_with_attribution");
  assert.equal(result.checkpoint.last_successful_source_record_id, "fixture-target-001");
});

test("fixture connector replay is idempotent for raw artifacts and normalized records", async () => {
  const stores = memoryStores();
  const connector = new FixtureConnector({
    fixturePath,
    metadata: validMetadata(),
    ...stores,
    clock: fixedClock
  });

  const first = await connector.run({ execution_context: validExecutionContext("corr-replay-1") });
  const second = await connector.run({ execution_context: validExecutionContext("corr-replay-2") });

  assert.equal(first.emitted_count, 2);
  assert.equal(second.emitted_count, 0);
  assert.equal(second.duplicate_count, 2);
  assert.equal(second.raw_artifact.created, false);
  assert.equal(stores.rawArtifactStore.artifacts.size, 1);
  assert.equal(stores.normalizedRecordStore.records.size, 2);
  assert.deepEqual(first.records.map((record) => record.idempotency_key), second.records.map((record) => record.idempotency_key));
});

test("connector metadata fails closed for blocked or incomplete source governance", () => {
  assert.throws(
    () => validateConnectorMetadata({
      ...validMetadata(),
      license_classification: "blocked_pending_legal_review"
    }),
    /blocks connector execution/
  );
  assert.throws(
    () => validateConnectorMetadata({
      ...validMetadata(),
      license_classification: "open_with_attribution",
      source_version: ""
    }),
    /source_version/
  );
});

test("execution context requires service-account connector scope and rejects forbidden actions", () => {
  assert.doesNotThrow(() => validateExecutionContext(validExecutionContext("corr-scope"), validMetadata()));
  assert.throws(
    () => validateExecutionContext({ ...validExecutionContext("corr-missing"), service_account_id: null }, validMetadata()),
    /service_account_id/
  );
  assert.throws(
    () => validateExecutionContext({
      ...validExecutionContext("corr-forbidden"),
      allowed_actions: ["connector.run", "graph.write_released"]
    }, validMetadata()),
    /forbidden action/
  );
  assert.throws(
    () => requireConnectorAction(validExecutionContext("corr-deny"), "release.promote"),
    /forbidden/
  );
  assert.throws(
    () => requireConnectorAction({ ...validExecutionContext("corr-not-scoped"), allowed_actions: ["connector.run"] }, "source.read"),
    /not scoped/
  );
});

test("retry policy retries transient fetch failures without advancing stores", async () => {
  const stores = memoryStores();
  const connector = new FlakyConnector({
    metadata: validMetadata(),
    ...stores,
    clock: fixedClock
  });

  const result = await connector.run({ execution_context: validExecutionContext("corr-retry-1") });

  assert.equal(connector.fetchAttempts, 2);
  assert.equal(result.emitted_count, 1);
  assert.equal(stores.rawArtifactStore.artifacts.size, 1);
  assert.equal(stores.normalizedRecordStore.records.size, 1);
  assert.equal(nextBackoffMs(1, { initial_delay_ms: 50, max_delay_ms: 500, multiplier: 3 }), 50);
  assert.equal(nextBackoffMs(3, { initial_delay_ms: 50, max_delay_ms: 500, multiplier: 3 }), 450);
});

test("connector base reports non-retryable policy failures as blocked", async () => {
  class MissingFetchConnector extends ConnectorBase {}
  const connector = new MissingFetchConnector({ metadata: validMetadata() });

  await assert.rejects(
    () => connector.run({ execution_context: validExecutionContext("corr-policy-1") }),
    ConnectorPolicyError
  );
});

test("ConnectorBase final emit path rejects release graph targets before persistence", async () => {
  const stores = memoryStores();
  const connector = new ReleaseTargetConnector({
    metadata: validMetadata(),
    ...stores,
    clock: fixedClock
  });

  await assert.rejects(
    () => connector.run({ execution_context: validExecutionContext("corr-release-target") }),
    /release graphs/
  );
  assert.equal(stores.normalizedRecordStore.records.size, 0);
});

for (const { candidateField, payload } of [
  {
    candidateField: "candidate_entities",
    payload: {
      entity_id: "candidate-entity-001",
      target_graph: "graph:tenant:tenant-a:release:bad:canonical"
    }
  },
  {
    candidateField: "candidate_relationships",
    payload: {
      relationship_id: "candidate-relationship-001",
      evidence: {
        target_graph: "graph:tenant:tenant-a:release:bad:canonical"
      }
    }
  },
  {
    candidateField: "candidate_mappings",
    payload: {
      mapping_id: "candidate-mapping-001",
      mapping_target: {
        target_graph: "graph:tenant:tenant-a:release:bad:canonical"
      }
    }
  }
]) {
  test(`ConnectorBase final emit path rejects release graph targets in ${candidateField} before persistence`, async () => {
    const stores = memoryStores();
    const connector = new CandidateArrayReleaseTargetConnector({
      metadata: validMetadata(),
      candidateField,
      payload,
      ...stores,
      clock: fixedClock
    });

    await assert.rejects(
      () => connector.run({ execution_context: validExecutionContext(`corr-release-target-${candidateField}`) }),
      /release graphs/
    );
    assert.equal(stores.normalizedRecordStore.records.size, 0);
  });
}

test("ConnectorBase final emit path requires final-object policy evaluator to pass", async () => {
  const stores = memoryStores();
  const connector = new FlakyConnector({
    metadata: validMetadata(),
    policyEvaluator() {
      throw new ConnectorPolicyError("final policy evaluator blocked fixture output");
    },
    ...stores,
    clock: fixedClock
  });

  await assert.rejects(
    () => connector.run({ execution_context: validExecutionContext("corr-final-policy") }),
    /final policy evaluator blocked/
  );
  assert.equal(stores.normalizedRecordStore.records.size, 0);
});

class FlakyConnector extends ConnectorBase {
  constructor(options) {
    super(options);
    this.fetchAttempts = 0;
  }

  async fetch() {
    this.fetchAttempts += 1;
    if (this.fetchAttempts === 1) {
      throw new ConnectorRetryableError("temporary fixture source outage");
    }
    return {
      raw: JSON.stringify({
        records: [
          {
            source_record_id: "retry-record-001",
            source_record_uri: "https://example.pharmaops.local/retry/001",
            label: "Retry record"
          }
        ]
      }),
      content_type: "application/json"
    };
  }

  async parse({ raw }) {
    return JSON.parse(raw);
  }

  async normalizeRecord({ sourceRecord }) {
    return {
      normalized_record: { label: sourceRecord.label },
      candidate_entities: [],
      candidate_relationships: [],
      candidate_mappings: [],
      warnings: []
    };
  }
}

class ReleaseTargetConnector extends FlakyConnector {
  async normalizeRecord({ sourceRecord }) {
    return {
      normalized_record: {
        label: sourceRecord.label,
        target_graph: "graph:tenant:tenant-a:release:bad:canonical"
      },
      candidate_entities: [],
      candidate_relationships: [],
      candidate_mappings: [],
      warnings: []
    };
  }
}

class CandidateArrayReleaseTargetConnector extends FlakyConnector {
  constructor(options) {
    super(options);
    this.candidateField = options.candidateField;
    this.payload = options.payload;
  }

  async normalizeRecord({ sourceRecord }) {
    return {
      normalized_record: { label: sourceRecord.label },
      candidate_entities: [],
      candidate_relationships: [],
      candidate_mappings: [],
      [this.candidateField]: [this.payload],
      warnings: []
    };
  }
}

function memoryStores() {
  return {
    rawArtifactStore: new InMemoryRawArtifactStore(),
    checkpointStore: new InMemoryCheckpointStore(),
    normalizedRecordStore: new InMemoryNormalizedRecordStore()
  };
}

function validMetadata() {
  return {
    connector_name: "fixture_reference",
    connector_version: "0.1.0",
    parser_version: "fixture-parser.v1",
    normalization_ruleset_version: "fixture-normalizer.v1",
    source_name: "Fixture Source",
    source_version: "2026-06-27",
    source_version_strategy: "version",
    license_classification: "open_with_attribution",
    materialization_policy: "materialize",
    sensitivity_classification: "public",
    retention_class: "public_source_snapshot",
    raw_artifact_policy: "persist",
    ai_use_policy: "allowed_with_attribution",
    disclaimer_ids: ["fixture_terms:v1"],
    permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "release"],
    export_restrictions: ["attribution_required"],
    source_terms_uri: "https://example.pharmaops.local/fixture/terms"
  };
}

function validExecutionContext(correlation_id) {
  return {
    tenant_id: "tenant-a",
    environment: "test",
    service_account_id: "svc-fixture-ingestion",
    connector_id: "fixture_reference",
    connector_version: "0.1.0",
    source_name: "Fixture Source",
    source_version: "2026-06-27",
    source_version_strategy: "version",
    license_policy_id: "license-policy:fixture",
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
  return new Date("2026-06-27T02:40:00.000Z");
}

assert.ok(readFileSync(fixturePath, "utf8").includes("fixture-compound-001"));
