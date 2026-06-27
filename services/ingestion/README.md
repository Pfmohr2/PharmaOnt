# services/ingestion

Connector runtime and ingestion jobs.

Ingestion must persist raw artifacts before parsing and must be idempotent and replayable.

## Phase 2 Runtime

The Phase 2 runtime is implemented in `src/` as a connector-job framework with local development sinks that can be swapped for object storage, durable queueing, and production metrics.

Artifacts:

- `src/job-runner.js`: runs connector jobs, records queued/running/completed/failed snapshots, tracks counts, duration, checkpoint, source version, artifact URIs, and retry lineage.
- `src/raw-artifact-store.js`: local object-store abstraction. It persists content-addressed artifacts under `tenants/{tenant_id}/{environment}/connectors/{connector_id}/raw/` prefixes and writes sidecar metadata.
- `src/error-queue.js`: dead-letter queue abstraction. Failed records are captured for replay and do not block the rest of the job.
- `src/metrics.js`: metric sink abstraction with memory and JSONL implementations.
- `src/normalized-output-store.js`: normalized output outbox abstraction with `putIfAbsent(idempotency_key)` to suppress duplicate downstream emissions.
- `src/index.js`: public exports for the ingestion service module.

Job output metadata includes `run_id`, `run_lineage_id`, `attempt`, `service_account_id`, `correlation_id`, connector/source/parser/normalization versions, status, record counts, `skipped_duplicate_count`, checkpoint, error summary, artifact URIs, duration, and newly emitted normalized connector outputs.

When an execution context is supplied, `assertExecutionContext` fails closed unless `tenant_id`, `environment`, `service_account_id`, and `connector_id` are present and match the run. The connector SDK additionally requires connector version, source name, source version or strategy, license policy ID, correlation ID, and scoped connector service-account actions before it fetches, persists, normalizes, or emits candidates. If a job row is supplied, its `tenant_id`, `environment`, and `requested_by_service_account_id` must match the service-account context before the job can be claimed.

Allowed connector service-account actions are limited to source read, license evaluation, raw/pointer artifact writes, normalized record writes, candidate emission, working-graph candidate writes, job events, tenant metrics, and redacted logs. Forbidden actions such as released graph writes, release-candidate graph writes, governed publish, approval, release, export, audit export, RBAC management, break-glass, and wildcards must fail closed. A license pass does not grant RBAC power, and service-account scope cannot override a license block.

Before raw artifact persistence, each record passes `assertIngestionPolicy` from `packages/licensing`. The default requested uses are `ingest`, `persist_raw`, `materialize`, and `normalize`; connectors can override requested uses when they are running pointer-only or preflight paths. Policy violations are dead-lettered with `error_status: "failed_blocked"`, `retryable: false`, and the full policy decision.

After normalization, the runtime re-runs both guards over the final emitted object:

- `assertNoReleasedGraphWrite` recursively scans normalized records, normalization handoffs, candidate entities, relationships, mappings, and nested graph/release fields. Release graph targets or release identifiers are dead-lettered as non-retryable blocked failures.
- `assertIngestionPolicy` re-evaluates the final object so post-normalization PII, restricted license state, missing legal approval, or other material governance changes replace the emitted `policy_decision` or block emission.

Idempotency is deterministic across reruns for the same tenant, environment, connector name/version, source name/version, source snapshot digest, parser version, normalization ruleset version, and source record ID. Raw artifacts are content-addressed, so identical reruns reuse the same artifact path instead of duplicating content.

Normalized outputs are separately idempotent. The normalized output store/outbox writes only when `putIfAbsent(idempotency_key)` creates a new record. Same-key reruns emit zero normalized outputs and increment `skipped_duplicate_count`; changed source snapshot digests create a new idempotency key and an explicit new versioned output.

Failed records are appended to the dead-letter queue with run lineage, attempt, connector/source identity, source record ID, error class/message, retryability, and a redacted replay payload. A job with record-level failures completes with `records_failed > 0`; source-level failures mark the run `failed` and can be retried with `retryConnectorJob`.

Retries are scoped before any fetch, checkpoint replay, or artifact write. `retryConnectorJob` rejects previous run lineage when tenant, environment, connector identity/version, source identity/version, source snapshot digest, license policy, or service account do not match the retry request and execution context. Completed runs include `checkpoint_scope_digest` and `checkpoint_binding`, which bind the checkpoint to tenant, environment, service account, connector, source, snapshot, license policy, run lineage, attempt, idempotency key, artifact prefix, issue/expiry timestamps, checkpoint digest, and correlation ID. Retry verifies the binding signature, expiry, digest, and field equality before replay.

Metrics emitted by the local sink:

- `ingestion_job_queued_total`
- `ingestion_job_started_total`
- `ingestion_records_fetched_total`
- `ingestion_records_persisted_total`
- `ingestion_records_normalized_total`
- `ingestion_records_failed_total`
- `ingestion_records_policy_blocked_total`
- `ingestion_records_duplicate_skipped_total`
- `ingestion_jobs_failed_total`
- `ingestion_job_duration_ms`
- `ingestion_source_freshness_ms`

The runtime does not write to semantic graphs. Connector records that attempt to target a released graph or set `release_id` are routed to the dead-letter queue.
