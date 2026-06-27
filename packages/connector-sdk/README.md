# PharmaOps Connector SDK

Phase 2 connector mechanics for fixture-backed and future source connectors.

The SDK codifies `CONNECTOR_CONTRACT.md` as runnable JavaScript interfaces:

- `ConnectorBase` orchestrates `fetch -> persist raw -> parse -> normalize -> emit`.
- `FixtureConnector` is a no-network reference connector backed by `fixtures/fixture-source.json`.
- `InMemoryRawArtifactStore`, `FileSystemRawArtifactStore`, `InMemoryCheckpointStore`, and `InMemoryNormalizedRecordStore` provide the persistence contracts that the ingestion service can replace with PostgreSQL, object storage, and queues.
- Retry helpers implement bounded retry/backoff for transient fetch failures.
- Metadata validation fails closed for missing source version, invalid license class, blocked legal review, or `materialization_policy: block`.

## Authoring A Connector

Create a subclass of `ConnectorBase` and implement three methods:

```js
class MyConnector extends ConnectorBase {
  async fetch(context) {
    return { raw, content_type: "application/json", source_uri };
  }

  async parse({ raw, rawArtifact }) {
    return { records, next_cursor };
  }

  async normalizeRecord({ sourceRecord, rawArtifact, run_id }) {
    return {
      normalized_record: {},
      candidate_entities: [],
      candidate_relationships: [],
      candidate_mappings: [],
      warnings: []
    };
  }
}
```

Connectors may emit candidate entities, relationships, mappings, evidence, and warnings. They must not approve governed facts, bypass review, or write released graphs. Downstream ingestion may write only through guarded working-graph adapters.

## Required Metadata

Every connector instance must provide:

```json
{
  "connector_name": "fixture_reference",
  "connector_version": "0.1.0",
  "parser_version": "fixture-parser.v1",
  "normalization_ruleset_version": "fixture-normalizer.v1",
  "source_name": "Fixture Source",
  "source_version": "2026-06-27",
  "source_version_strategy": "version",
  "license_classification": "open_with_attribution",
  "materialization_policy": "materialize",
  "sensitivity_classification": "public",
  "retention_class": "public_source_snapshot",
  "raw_artifact_policy": "persist",
  "ai_use_policy": "allowed_with_attribution",
  "disclaimer_ids": ["fixture_terms:v1"],
  "permitted_uses": ["ingest", "normalize", "curate"],
  "export_restrictions": ["attribution_required"]
}
```

`license_classification` follows `DATA_LICENSE_REGISTER.md` exactly. `blocked_pending_legal_review` and `materialization_policy: block` stop execution before fetch.

## Execution Context And Service Accounts

Every SDK run requires an execution context from the ingestion job claim:

```json
{
  "tenant_id": "tenant-a",
  "environment": "test",
  "service_account_id": "svc-fixture-ingestion",
  "connector_id": "fixture_reference",
  "connector_version": "0.1.0",
  "source_name": "Fixture Source",
  "source_version": "2026-06-27",
  "source_version_strategy": "version",
  "license_policy_id": "license-policy:fixture",
  "correlation_id": "corr-123",
  "allowed_actions": [
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
```

The SDK checks this context before source read, license evaluation, raw artifact persistence, normalized record writes, candidate emission, job events, metrics, and redacted logs. It rejects forbidden actions such as `graph.write_released`, `graph.write_release_candidate`, `governed.publish`, `approval.approve`, `release.*`, `export.release_package`, `audit.export`, `rbac.manage_policy`, `break_glass.activate`, and wildcards. A license pass does not grant RBAC power; service-account scope cannot override a license block.

`ConnectorBase.run()` also evaluates the final emitted object before persistence. By default it calls `assertIngestionPolicy` on the normalized output; tests may inject a stricter `policyEvaluator` through the connector constructor. The final emit path applies a defense-in-depth release-target guard and fails closed if output sets `release_id`, `graph:tenant:*:release:*`, or a release target graph inside `normalization_handoff` or `normalized_record`.

## Source-Version Pinning

The run identity includes tenant, environment, connector name/version, source name/version, source snapshot digest, parser version, and normalization ruleset version. Each emitted record also includes source name, source version, source record ID, retrieval time, raw artifact URI, record hash, license classification, downstream license metadata, warnings, and provenance.

The output preserves the licensing package fields required by downstream services:

- `license_classification`
- `materialization_policy`
- `sensitivity_classification`
- `retention_class`
- `raw_artifact_policy`
- `ai_use_policy`
- `permitted_uses`
- `export_restrictions`
- `disclaimer_ids`
- `legal_approval_id`
- `decisions`
- `evidence_flags`
- `blocks`

Source-specific evidence flags and disclaimers should pass through from the source policy evaluator. For openFDA FAERS, preserve `evidence_flags.non_causal_warning_required` and `source_limit:faers_non_causal`.

When a source lacks a formal version, use the approved `source_version_strategy` from the source register: retrieval timestamp, snapshot hash, release, or customer schema version.

## Raw Artifact Persistence

Raw artifacts are persisted before parsing. The default in-memory store and filesystem store both use content-addressed SHA-256 identities, so replaying the same fixture or source snapshot does not create duplicate raw artifacts.

Production ingestion should replace these stores with object storage and PostgreSQL metadata using the same contract:

- tenant/environment/source-scoped object prefix
- immutable artifact or pointer manifest
- digest, size, content type, source URI, fetched time, connector version, parser version, retention class
- no credentials or secrets

## Idempotency

Record idempotency keys are derived from:

```text
tenant_id
environment
connector_name
connector_version
source_name
source_version
source_snapshot_digest
parser_version
normalization_ruleset_version
source_record_id
```

The normalized record store upserts by this key. A duplicate replay returns the existing record, increments `duplicate_count`, and does not create duplicate normalized output.

## Checkpoint And Resume

The SDK persists checkpoints after each emitted record. Checkpoints include:

- run ID and attempt ID
- source cursor
- last raw artifact URI
- last successful source record ID
- parsed/emitted/duplicate/skipped counts
- last failure reason placeholder

The ingestion framework should back this interface with PostgreSQL job metadata so retries resume without advancing past records whose raw artifact was not persisted.

## Retry And Error Queue Handoff

`ConnectorRetryableError` enters bounded retry/backoff. Policy, license, validation, credential, source schema, or provenance failures should use `ConnectorPolicyError` and be routed to a blocked/error queue by the ingestion service.

Retries must not overwrite immutable artifacts, duplicate normalized records, or hide failed attempts from audit.

## Reference Fixture

`FixtureConnector` reads `fixtures/fixture-source.json`, persists the raw fixture, parses two source records, and emits candidate entity proposals. It performs no network calls and is safe for unit and CI tests.
