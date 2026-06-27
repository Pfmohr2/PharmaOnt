import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ConnectorBase,
  ConnectorPolicyError,
  ConnectorRetryableError,
  InMemoryCheckpointStore,
  InMemoryNormalizedRecordStore,
  InMemoryRawArtifactStore,
  connectorAllowedActions,
  sha256
} from "../../packages/connector-sdk/src/index.js";
import { PolicyViolation, assertIngestionPolicy } from "../../packages/licensing/src/index.js";

const fixturePath = new URL("./fixtures/round-b-reference-source.json", import.meta.url);
const expectedRecordIds = ["qa-compound-001", "qa-target-001", "qa-trial-001"];
const expectedLabels = [
  "Acetylsalicylic acid",
  "Prostaglandin G/H synthase 1",
  "Aspirin pharmacodynamic fixture trial"
];

defineConnectorContractSuite({
  suiteName: "Round B reference connector contract",
  fixturePath,
  expectedRecordIds,
  expectedLabels,
  metadata: validRoundBMetadata()
});

test("connector contract live cases skip locally unless explicitly enabled", { skip: liveConnectorTestsEnabled() ? false : "set PHARMAOPS_CONNECTOR_LIVE=1 in CI to run source-backed connector contract suites" }, () => {
  assert.equal(process.env.PHARMAOPS_CONNECTOR_LIVE, "1");
});

export function defineConnectorContractSuite({
  suiteName,
  fixturePath: sourceFixturePath,
  expectedRecordIds: sourceExpectedRecordIds,
  expectedLabels: sourceExpectedLabels,
  metadata
}) {
  test(`${suiteName}: fixture parse emits expected normalized records`, async () => {
    const stores = memoryStores();
    const connector = new ContractFixtureConnector({
      fixturePath: sourceFixturePath,
      metadata,
      ...stores,
      clock: fixedClock
    });

    const result = await connector.run(runScope("contract-parse"));

    assert.equal(result.status, "completed");
    assert.deepEqual(result.records.map((record) => record.source_record_id), sourceExpectedRecordIds);
    assert.deepEqual(result.records.map((record) => record.normalized_record.label), sourceExpectedLabels);
    assert.deepEqual(result.records.map((record) => record.candidate_entities[0].source_label), sourceExpectedLabels);
    assert.equal(result.records.every((record) => record.provenance.source_artifact_digest === result.raw_artifact.digest), true);
  });

  test(`${suiteName}: retry/backoff retries transient fetch failures without partial persistence`, async () => {
    const stores = memoryStores();
    const connector = new TransientFetchConnector({
      fixturePath: sourceFixturePath,
      metadata,
      failFetchAttempts: 1,
      ...stores,
      retryPolicy: { max_attempts: 3, initial_delay_ms: 0, max_delay_ms: 0, multiplier: 1 },
      clock: fixedClock
    });

    const result = await connector.run(runScope("contract-retry"));

    assert.equal(connector.fetchAttempts, 2);
    assert.equal(result.emitted_count, sourceExpectedRecordIds.length);
    assert.equal(stores.rawArtifactStore.artifacts.size, 1);
    assert.equal(stores.normalizedRecordStore.records.size, sourceExpectedRecordIds.length);
  });

  test(`${suiteName}: checkpoint resume produces no duplicate raw artifacts or records`, async () => {
    const stores = memoryStores();
    const firstAttempt = new ContractFixtureConnector({
      fixturePath: sourceFixturePath,
      metadata,
      failOnNormalizeRecordId: sourceExpectedRecordIds[1],
      ...stores,
      clock: fixedClock
    });

    await assert.rejects(
      () => firstAttempt.run(runScope("contract-resume-1")),
      /fixture transient normalize failure/
    );
    assert.equal(stores.rawArtifactStore.artifacts.size, 1);
    assert.equal(stores.normalizedRecordStore.records.size, 1);

    const retry = new ContractFixtureConnector({
      fixturePath: sourceFixturePath,
      metadata,
      ...stores,
      clock: fixedClock
    });
    const result = await retry.run(runScope("contract-resume-2"));

    assert.equal(result.raw_artifact.created, false);
    assert.equal(result.skipped_count, 1);
    assert.equal(result.emitted_count, sourceExpectedRecordIds.length - 1);
    assert.equal(result.duplicate_count, 0);
    assert.equal(stores.rawArtifactStore.artifacts.size, 1);
    assert.equal(stores.normalizedRecordStore.records.size, sourceExpectedRecordIds.length);
    assert.deepEqual(
      [...stores.normalizedRecordStore.records.values()].map((record) => record.source_record_id).sort(),
      [...sourceExpectedRecordIds].sort()
    );
  });

  test(`${suiteName}: raw artifacts are content-addressed and stable across replay`, async () => {
    const stores = memoryStores();
    const connector = new ContractFixtureConnector({
      fixturePath: sourceFixturePath,
      metadata,
      ...stores,
      clock: fixedClock
    });
    const rawFixture = readFileSync(sourceFixturePath, "utf8");

    const first = await connector.run(runScope("contract-raw-1"));
    const second = await connector.run(runScope("contract-raw-2"));

    assert.equal(first.raw_artifact.digest, sha256(rawFixture));
    assert.equal(second.raw_artifact.digest, first.raw_artifact.digest);
    assert.equal(second.raw_artifact.uri, first.raw_artifact.uri);
    assert.equal(second.raw_artifact.created, false);
    assert.ok(first.raw_artifact.uri.endsWith(first.raw_artifact.digest.replace("sha256:", "")));
    assert.equal(stores.rawArtifactStore.artifacts.size, 1);
  });

  test(`${suiteName}: source version is captured and invalid version metadata fails before fetch`, async () => {
    const stores = memoryStores();
    const connector = new ContractFixtureConnector({
      fixturePath: sourceFixturePath,
      metadata,
      ...stores,
      clock: fixedClock
    });
    const result = await connector.run(runScope("contract-source-version"));

    assert.equal(result.records.every((record) => record.source_version === metadata.source_version), true);
    assert.equal(result.records.every((record) => record.provenance.connector_version === metadata.connector_version), true);
    assert.throws(
      () => new ContractFixtureConnector({
        fixturePath: sourceFixturePath,
        metadata: { ...metadata, source_version: "" },
        ...memoryStores(),
        clock: fixedClock
      }),
      /source_version/
    );
    assert.throws(
      () => new ContractFixtureConnector({
        fixturePath: sourceFixturePath,
        metadata: { ...metadata, source_version_strategy: "unapproved_guess" },
        ...memoryStores(),
        clock: fixedClock
      }),
      /source_version_strategy/
    );
  });

  test(`${suiteName}: licensing and PII gate blocks pre-persist`, async () => {
    const stores = memoryStores();
    const connector = new ContractFixtureConnector({
      fixturePath: sourceFixturePath,
      metadata,
      prefetchPolicyInput: blockedPiiPolicyInput(),
      ...stores,
      clock: fixedClock
    });

    await assert.rejects(
      () => connector.run(runScope("contract-policy-block")),
      PolicyViolation
    );
    assert.equal(connector.fetchAttempts, 1);
    assert.equal(stores.rawArtifactStore.artifacts.size, 0);
    assert.equal(stores.normalizedRecordStore.records.size, 0);
  });

  test(`${suiteName}: P2-RT-002 ConnectorBase direct run without policy context fails closed`, async () => {
    const stores = memoryStores();
    const connector = new ContractFixtureConnector({
      fixturePath: sourceFixturePath,
      metadata,
      ...stores,
      clock: fixedClock
    });

    await assert.rejects(
      () => connector.run({ source_config: {} }),
      /execution_context|required|policy|license/
    );
    assert.equal(stores.rawArtifactStore.artifacts.size, 0);
    assert.equal(stores.normalizedRecordStore.records.size, 0);
  });

  test(`${suiteName}: P2-RT-001 SDK blocks release targets nested in candidate arrays`, async () => {
    for (const variant of ["candidate_entities", "candidate_relationships", "candidate_mappings"]) {
      const stores = memoryStores();
      const connector = new CandidateReleaseTargetConnector({
        fixturePath: sourceFixturePath,
        metadata,
        releaseTargetVariant: variant,
        ...stores,
        clock: fixedClock
      });

      await assert.rejects(
        () => connector.run(runScope(`contract-candidate-release-${variant}`)),
        /release graphs|release_id/
      );
      assert.equal(stores.normalizedRecordStore.records.size, 0);
      assert.equal(connector.fetchAttempts, 1);
    }
  });
}

class ContractFixtureConnector extends ConnectorBase {
  constructor({ fixturePath: sourceFixturePath, failOnNormalizeRecordId = null, prefetchPolicyInput = null, ...options }) {
    super(options);
    this.fixturePath = sourceFixturePath;
    this.failOnNormalizeRecordId = failOnNormalizeRecordId;
    this.prefetchPolicyInput = prefetchPolicyInput;
    this.fetchAttempts = 0;
  }

  async fetch() {
    this.fetchAttempts += 1;
    if (this.prefetchPolicyInput) {
      assertIngestionPolicy(this.prefetchPolicyInput);
    }
    return {
      raw: readFileSync(this.fixturePath, "utf8"),
      content_type: "application/json",
      source_uri: this.fixturePath.href
    };
  }

  async parse({ raw }) {
    const payload = JSON.parse(raw);
    return {
      records: payload.records.map((record) => ({
        ...record,
        source_record_uri: record.source_record_uri ?? null,
        warnings: record.warnings ?? []
      })),
      next_cursor: payload.next_cursor ?? null
    };
  }

  async normalizeRecord({ sourceRecord }) {
    if (sourceRecord.source_record_id === this.failOnNormalizeRecordId) {
      throw new Error("fixture transient normalize failure");
    }
    return {
      normalized_record: {
        source_id: sourceRecord.source_record_id,
        label: sourceRecord.label,
        entity_class: sourceRecord.entity_class,
        identifiers: sourceRecord.identifiers ?? []
      },
      candidate_entities: [
        {
          candidate_id: `candidate:${sourceRecord.source_record_id}`,
          entity_class: sourceRecord.entity_class,
          source_label: sourceRecord.label,
          source_identifiers: sourceRecord.identifiers ?? [],
          synonyms: sourceRecord.synonyms ?? [],
          confidence_score: 0.99,
          evidence_ids: [`evidence:${sourceRecord.source_record_id}`],
          provenance_id: `provenance:${sourceRecord.source_record_id}`
        }
      ],
      candidate_relationships: [],
      candidate_mappings: [],
      warnings: sourceRecord.warnings ?? [],
      disclaimer_ids: sourceRecord.disclaimer_ids ?? []
    };
  }
}

class TransientFetchConnector extends ContractFixtureConnector {
  constructor({ failFetchAttempts, ...options }) {
    super(options);
    this.failFetchAttempts = failFetchAttempts;
  }

  async fetch() {
    this.fetchAttempts += 1;
    if (this.fetchAttempts <= this.failFetchAttempts) {
      throw new ConnectorRetryableError("fixture source timed out");
    }
    return {
      raw: readFileSync(this.fixturePath, "utf8"),
      content_type: "application/json",
      source_uri: this.fixturePath.href
    };
  }
}

class CandidateReleaseTargetConnector extends ContractFixtureConnector {
  constructor({ releaseTargetVariant, ...options }) {
    super(options);
    this.releaseTargetVariant = releaseTargetVariant;
  }

  async parse() {
    return {
      records: [
        {
          source_record_id: `release-target-${this.releaseTargetVariant}`,
          source_record_uri: `https://fixtures.pharmaops.local/${this.releaseTargetVariant}`,
          label: `Release target ${this.releaseTargetVariant}`,
          entity_class: "compound"
        }
      ],
      next_cursor: null
    };
  }

  async normalizeRecord({ sourceRecord }) {
    const releaseTarget = {
      target_graph: "graph:tenant:tenant-a:release:2026.0.0:canonical"
    };
    return {
      normalized_record: {
        source_id: sourceRecord.source_record_id,
        label: sourceRecord.label
      },
      candidate_entities: this.releaseTargetVariant === "candidate_entities" ? [releaseTarget] : [],
      candidate_relationships: this.releaseTargetVariant === "candidate_relationships" ? [releaseTarget] : [],
      candidate_mappings: this.releaseTargetVariant === "candidate_mappings" ? [releaseTarget] : [],
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

function runScope(correlation_id) {
  return {
    execution_context: {
      tenant_id: "tenant-a",
      environment: "test",
      service_account_id: "00000000-0000-0000-0000-00000000c001",
      connector_id: "round_b_reference_contract",
      connector_version: "0.1.0",
      source_name: "ChEMBL",
      source_version: "34",
      source_version_strategy: "release",
      license_policy_id: "license-policy:chembl-34",
      correlation_id,
      allowed_actions: connectorAllowedActions
    }
  };
}

function validRoundBMetadata() {
  return {
    connector_name: "round_b_reference_contract",
    connector_version: "0.1.0",
    parser_version: "contract-parser.v1",
    normalization_ruleset_version: "contract-normalizer.v1",
    source_name: "ChEMBL",
    source_version: "34",
    source_version_strategy: "release",
    license_classification: "open_with_attribution",
    materialization_policy: "materialize",
    sensitivity_classification: "public",
    retention_class: "public_source_snapshot",
    raw_artifact_policy: "persist",
    ai_use_policy: "allowed_with_attribution",
    disclaimer_ids: ["source_terms:chembl"],
    permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
    export_restrictions: ["attribution_required"],
    source_terms_uri: "https://chembl.gitbook.io/chembl-interface-documentation/downloads"
  };
}

function blockedPiiPolicyInput() {
  return {
    source: {
      source_name: "QA PII source",
      license_classification: "contains_phi_or_pii",
      materialization_policy: "materialize",
      sensitivity_classification: "phi_pii",
      retention_class: "blocked_no_retention",
      raw_artifact_policy: "no_persist",
      source_version_strategy: "version",
      ai_use_policy: "prohibited",
      permitted_uses: ["ingest"],
      export_restrictions: ["contains_phi_or_pii"],
      disclaimer_ids: ["source_limit:contains_phi_or_pii"]
    },
    record: {
      source_record_id: "blocked-pii-001",
      contains_phi_or_pii: true
    },
    requestedUses: ["ingest", "persist_raw", "materialize", "normalize"]
  };
}

function fixedClock() {
  return new Date("2026-06-27T02:50:00.000Z");
}

function liveConnectorTestsEnabled() {
  return process.env.PHARMAOPS_CONNECTOR_LIVE === "1";
}

assert.ok(readFileSync(fixturePath, "utf8").includes("qa-compound-001"));
assert.ok(ConnectorPolicyError);
