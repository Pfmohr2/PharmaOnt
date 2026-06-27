# Semantic Store Service

Phase 1 semantic-store backend for PharmaOps.

Scope:

- Apache Jena Fuseki integration through SPARQL and Graph Store HTTP APIs.
- Tenant-scoped named graph policy for working, staging, AI suggestions, source, validation, and immutable release graphs.
- Guarded public write surface; raw Fuseki mutations are internal to service modules and are not exported from `src/index.js`.
- Validated mapping write path backed by `packages/contracts/src/mapping-object.schema.json`.
- SHACL-oriented Phase 1 validation runner wired to `ontologies/shapes/pharmaops-shapes.ttl` and fixtures.
- Canonical entity create/retrieve in the tenant working graph.
- Release snapshot skeleton that validates working graph content, blocks model-suggested publication, reconciles per-assertion source versions and evidence metadata, persists the ADR-0002 release ledger record through a ledger adapter, reconciles ledger digest with stored manifest digest, and only then copies working graph content into an immutable release graph.
- Release snapshots require non-empty source-version pins, approval trace, validation report references, and audit event range before graph copy or manifest creation.

Out of scope for Phase 1:

- Public API facade.
- Frontend workflows.
- Connector ingestion.
- Full workflow approval service.
- Complete SHACL engine replacement. The local runner covers the Phase 1 blocker checks; live Fuseki integration is exercised in CI.

## Environment

Defaults match `infra/docker/docker-compose.yml` and `.github/workflows/ci.yml`:

```text
FUSEKI_BASE_URL=http://localhost:3030
FUSEKI_DATASET=pharmaops_ci
FUSEKI_ADMIN_USER=admin
FUSEKI_ADMIN_PASSWORD=pharmaops_ci_password
```

## Release Package Record

Release snapshots emit a record aligned with ADR-0002:

- `release_id`
- `tenant_id`
- `environment`
- `manifest_digest`
- `manifest_uri`
- `included_graphs`
- `source_version_pins`
- `artifact_hashes`
- `approval_trace`
- `rollback_target_release_id`
- `audit_event_range`
- exactly one creator reference, either `created_by_user_id` or `created_by_service_account_id`

The service writes a local JSON manifest in tests and local development. `manifest_digest` is the SHA-256 digest of the exact stored manifest bytes. The stored manifest does not include `manifest_digest`, avoiding a self-referential digest. Production storage must point this manifest at immutable object storage with retention or object-lock controls.

Phase 1 boundary:

- `release-snapshot.js` persists `release_metadata_record` through a release-ledger adapter. `PostgresReleaseLedger` inserts the canonical `pharmaops.release_metadata` row with the transaction-scoped Postgres client supplied by the release workflow. `JsonFileReleaseLedger` and `NoopReleaseLedger` are test/local adapters only.
- The Postgres adapter writes only through the release-workflow service-account path and inserts columns matching `services/db/migrations/0001_operational_schema.sql`; Oscar owns the DDL, grants, and RLS hardening.
- Release graph exposure is fail-closed for Phase 1: manifest write, ledger persistence, and ledger digest reconciliation happen before `graph:tenant:{tenant}:release:{release_id}:*` receives triples. A ledger mismatch leaves no final release graph triples.
- Every provenance block in the candidate graph must reconcile to `source_version_pins`; unreconciled source names or versions block release before graph exposure.
- It does not yet own the audit-event outbox.
- Treat this as the semantic-store release snapshot skeleton, not the complete release promotion transaction.
