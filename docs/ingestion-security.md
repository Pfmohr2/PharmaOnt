# Ingestion Security Model

Phase 2 connector ingestion uses a deny-by-default service-account model. The licensing gate decides whether a source record may be ingested, materialized, normalized, AI-processed, exported, or released. The security model decides which service account may act on that gate result and where the resulting artifacts, records, candidates, logs, and metrics may land.

## Service-Account Model

Each connector job runs as a tenant-owned `service_account` principal, not as the human who configured or scheduled the connector. The job payload and service token must carry:

- `tenant_id`
- `environment`
- `service_account_id`
- `connector_id`
- `connector_version`
- `source_name`
- `source_version` or approved source-version strategy
- `license_policy_id`
- `correlation_id`

The connector service account must have only the following scope families, represented by `pharmaops.service_account_scopes` and the templates seeded in `services/db/migrations/0003_ingestion_service_account_scopes.sql`:

| Scope template | Resource type | Allowed actions |
|---|---|---|
| `connector_source_read` | `connector` | `connector.run`, `source.read`, `license.evaluate` |
| `connector_raw_artifact_write` | `object_prefix` | `artifact.write_raw`, `artifact.write_pointer` |
| `connector_normalized_candidate_write` | `database_schema` | `record.write_normalized`, `candidate.emit`, `job.emit_event` |
| `connector_working_graph_candidate_write` | `graph_family` | `graph.write_working_candidate` |
| `connector_checkpoint_replay` | `connector` | `checkpoint.read`, `checkpoint.write`, `checkpoint.replay` |
| `connector_runtime_observability` | `queue` | `job.claim`, `job.emit_event`, `metric.write_tenant`, `log.write_redacted` |

The migration also seeds service-account permissions for the same capability groups:

- `connector.read_source`
- `connector.write_raw_artifact`
- `connector.write_normalized_candidate`
- `connector.write_working_graph_candidate`
- `connector.replay_checkpoint`
- `connector.emit_runtime_observability`

These role permissions are necessary but not sufficient. Runtime authorization must also require an active, unexpired `service_account_scopes` row for the same tenant, environment, source or resource pattern, and license policy.

## Explicit Denies

Connector service accounts must never receive these actions through `service_account_scopes`:

- `cross_tenant.read`
- `cross_tenant.write`
- `graph.write_released`
- `graph.write_release_candidate`
- `governed.publish`
- `approval.approve`
- `release.stage`
- `release.promote`
- `release.rollback`
- `export.release_package`
- `audit.export`
- `rbac.manage_policy`
- `break_glass.activate`
- wildcard actions such as `*`, `all`, or `admin`

Connectors may emit candidate proposals and working-graph candidate assertions only. They must not publish governed assets, approve mappings, write release-candidate graphs, write released graphs, export packages, or perform break-glass operations.

The released-graph and release-candidate denial is enforced on the write attempt itself. It applies even when a forbidden `target_graph`, `release_id`, or graph-family field is introduced after fetch during normalization or candidate generation. A connector service account has no scope that can authorize `graph.write_released` or `graph.write_release_candidate`; app-layer prefetch and post-normalization guards are defense in depth, not the authority for this denial.

## Checkpoint And Run-Lineage Binding

Connector checkpoints and `run_lineage_id` values are tenant-scoped security data. They must not be treated as caller-provided retry hints. A connector service account may read, write, or replay a checkpoint only when all of these fields match the retry request, previous run record, current job row, service-account context, and scope template:

- `tenant_id`
- `environment`
- `service_account_id`
- `connector_id`
- `connector_version`
- `source_name`
- `source_version` or approved source-version strategy
- `source_snapshot_digest` when materialized or snapshotted
- `license_policy_id`
- `run_lineage_id`
- `checkpoint_id`
- `checkpoint_sequence` or monotonic attempt number
- `idempotency_key`
- raw artifact or pointer prefix

Checkpoints must be signed or MAC-bound by the ingestion runtime after tenant-scoped persistence, using a server-side signing key unavailable to connector code. The signed payload must include the binding fields above plus `issued_at`, `expires_at`, `checkpoint_digest`, and `correlation_id`. Connector code receives the checkpoint as an opaque token or server-managed handle; it must not mint, edit, or transplant checkpoint payloads.

On retry, the job runner must verify the signature, expiry, digest, and every binding field before any source read, artifact access, normalization, or checkpoint replay. A mismatch in tenant, environment, service account, connector, source, source version, license policy, run lineage, idempotency key, or object prefix is an authorization denial. Cross-tenant, cross-connector, cross-source, and cross-service-account checkpoint replay is denied at the service-account enforcement layer even if application retry validation is missed.

## Tenant Isolation

Every connector job must be claimed and executed inside one tenant and environment:

```sql
SET LOCAL app.tenant_id = '<tenant uuid>';
SET LOCAL app.environment = '<environment>';
SET LOCAL app.allow_cross_tenant = 'false';
```

The worker must verify that the job row, service account, connector configuration, source policy, object prefix, graph family, queue, normalized record target, and audit context all carry the same `tenant_id` and `environment`. A mismatch is a policy denial and must not reveal whether the other tenant resource exists.

Raw artifacts and pointer manifests must use tenant-scoped object prefixes:

```text
tenants/{tenant_id}/{environment}/connectors/{connector_id}/raw/
```

Normalized records and candidate proposals must include `tenant_id`, `environment`, `connector_id`, source identifiers, source version, artifact digest, license classification, sensitivity, retention class, and provenance. Job metadata and job events already carry tenant columns in the operational schema; Phyllis's persistence layer must keep any new raw-artifact or normalized-record tables tenant-owned and RLS-protected.

Logs, metrics, traces, warnings, and dead-letter payloads must include tenant/environment tags for filtering but must not include secrets, raw PHI/PII, raw restricted payloads, connector credentials, or cross-tenant counts that identify another customer. Cross-tenant aggregate metrics must be anonymized and thresholded.

## License Gate Intersection

The `@pharmaops/licensing` gate is the policy decision point for source eligibility. Connector code must call `assertIngestionPolicy` before raw persistence, materialization, normalization, AI processing, export routing, or release routing.

Security enforcement is separate:

1. The license gate returns allowed uses, blocks, warnings, disclaimer IDs, retention class, materialization policy, and sensitivity.
2. The ingestion security layer verifies the connector service account is authorized for the tenant, environment, source, license policy, object prefix, graph family, queue, and requested action.
3. The persistence layer writes only to tenant-scoped raw artifact storage, normalized candidate persistence, job metadata, and working graph candidate destinations allowed by the service-account scope.

No license pass can grant a connector service account additional RBAC power. No service-account scope can override a license block. Both must pass before a connector writes anything.

## SDK Requirements For Jim

The connector SDK must require an execution context object with tenant, environment, service account, connector, source, license policy, and correlation fields. It must:

- fail closed if any execution-context field is missing;
- call the licensing gate before persistence or normalization;
- request only the action names listed above;
- reject any request for forbidden actions;
- attach tenant/environment/license/provenance metadata to every output record;
- emit audit/job events for start, retry, policy block, raw persistence, normalization handoff, and completion.

## Persistence Requirements For Phyllis

The ingestion framework must:

- claim jobs only where `jobs.tenant_id`, `jobs.environment`, and `requested_by_service_account_id` match the service-account context;
- set PostgreSQL RLS session variables before reading or writing tenant-owned tables;
- persist raw artifact manifests and normalized records with tenant and environment columns;
- enforce tenant-scoped object prefixes and working graph families;
- keep logs, metrics, traces, and dead-letter data redacted and tenant-filtered;
- deny cross-tenant job claims, artifact reads, normalized-record writes, and metrics/log reads.

## Audit Requirements

Audit events are required for connector configuration changes, job start, source credential binding, policy denial, raw artifact or pointer persistence, normalization handoff, retry, blocked failure, completion, and any attempted forbidden action. Denials should include action, resource type, tenant, environment, connector ID, service account ID, source name, license policy ID, and correlation ID without exposing restricted payload content.
