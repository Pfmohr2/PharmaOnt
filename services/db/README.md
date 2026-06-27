# PharmaOps Operational Database

Task:
Define the Phase 1 PostgreSQL operational schema for users, RBAC, workflow state, jobs, comments, release metadata, and append-only audit events.

Assumptions:
- PostgreSQL is the operational store per `ARCHITECTURE.md`.
- RDF remains the semantic system of record. PostgreSQL stores workflow state, identity metadata, job metadata, release indexes, audit records, and references to semantic objects.
- Application services must set tenant and environment session variables before running tenant-scoped queries.
- ADR-0002 makes PostgreSQL the canonical searchable store for audit events and release metadata, backed by immutable object-storage release packages.

Inputs Reviewed:
- `ARCHITECTURE.md`
- `DOMAIN_MODEL.md`
- `VOCABULARY_POLICY.md`
- `SECURITY_MODEL.md`
- `VALIDATION_PLAN.md`
- `pharmaops_multi_agent_exportable_prompt.md` sections 6.1, 7 Agent 20, 10.4, and 16.

Changes Proposed:
- Use `services/db/migrations` for SQL migrations.
- Create schema `pharmaops`.
- Seed the ten required RBAC roles.
- Enforce tenant columns and RLS on tenant-owned operational tables.
- Keep audit events append-only with database triggers and no normal-role update/delete grants.

Artifacts Created or Modified:
- `services/db/migrations/0001_operational_schema.sql`
- `services/db/README.md`

Interfaces Affected:
- API facade authorization.
- Workflow service state transitions.
- Review queue service.
- Job runtime.
- Release manager and export service.
- Audit service.
- Security admin and platform admin tools.

Tests Added or Required:
- Migration dry-run on PostgreSQL 15+.
- RLS tests proving tenant-scoped sessions cannot read or write other tenants.
- RBAC seed tests proving all ten required roles exist.
- Audit immutability tests proving `UPDATE` and `DELETE` on `pharmaops.audit_events` fail.
- Separation-of-duties tests for privileged role grants, RBAC policy changes, service-account export grants, and break-glass sessions.
- Service-account export-grant tests for owner, tenant, release, destination, license policy, expiry, and denial of `release_id = 'working'`.

Security Impact:
- Every data-bearing operational table includes `tenant_id`.
- RLS policies require `app.tenant_id` unless privileged maintenance explicitly sets `app.allow_cross_tenant = true`.
- Audit records are append-only at the database layer.
- Privileged security changes are represented as auditable, second-approval-capable records.
- Service-account export grants are scoped to owning human, tenant, release, destination, license policy, and expiry.

Compliance Impact:
- Audit events include actor, role, tenant, environment, action, rationale, policy result, validation result, provenance reference, release ID, retention class, legal hold, and event payload.
- Release metadata captures manifest digests, source-version pins, validation report refs, changelog, artifact hashes, approval trace, audit event range, and rollback target.
- ADR-0002 must confirm whether this table is the authoritative immutable audit store or an operational index backed by an external/object-lock ledger.

Data and Provenance Impact:
- Proposals, approvals, releases, jobs, and audit events use stable IDs and references to semantic objects, graph names, source versions, artifact digests, validation reports, provenance refs, and release IDs.
- Semantic facts are not duplicated into PostgreSQL as the source of truth.

Risks:
- RLS depends on services setting `app.tenant_id` and `app.environment` correctly at transaction start.
- The audit table has append-only triggers; final retention or object-lock enforcement for release package artifacts remains an object-storage responsibility.
- Cross-store consistency between PostgreSQL, RDF, object storage, search, and audit requires service-level outbox/compensation patterns.

Open Questions:
- Which migration runner will DevOps standardize on: raw `psql`, Flyway, Sqitch, Prisma, Drizzle, or another tool?
- Which PostgreSQL roles will map to runtime services in the first deployed environment?

Handoff To:
- Jim/Solution Architect: align ADR-0002 with `audit_events`, `release_metadata`, retention classes, legal hold, and release-package manifest fields.
- Workflow Backend: bind state transitions and approval commands to these tables and required audit emission.
- API Agent: set tenant/environment session variables and enforce backend authorization before mutation.
- QA: create migration, RLS, RBAC, audit immutability, and service-account export-grant tests.
- DevOps: choose the migration runner and database runtime roles.

Definition of Done Status:
- Complete for Phase 1 schema draft: SQL migrations and README created, roles seeded, tenant scoping present, workflow/job/release/audit tables defined, audit append-only triggers implemented, and ADR-0002 release metadata hardening captured.

## Apply

From a PostgreSQL 15+ database:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/db/migrations/0001_operational_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/db/migrations/0002_release_metadata_hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/db/migrations/0003_ingestion_service_account_scopes.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/db/migrations/0004_curation_mapping_rbac.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/db/migrations/0005_proposal_lifecycle_rbac.sql
```

The migration creates:
- `pharmaops` schema.
- Enum types for environments, principal types, workflow lifecycle, reviews, jobs, releases, audit outcomes, export grants, and break-glass sessions.
- Identity and RBAC tables.
- Workflow proposal, review, approval, queue, comment, job, and release metadata tables.
- `pharmaops.audit_events` as the append-only operational audit table.
- RLS policies for tenant isolation.
- Seed rows for the ten required roles and initial permission mappings.
- `0002_release_metadata_hardening.sql` tightens the ADR-0002 canonical release ledger contract.
- `0003_ingestion_service_account_scopes.sql` seeds connector service-account permissions, connector scope templates, and deny constraints for wildcard, cross-tenant, released-graph, governed publication, export, RBAC, and break-glass actions.
- `0004_curation_mapping_rbac.sql` seeds governed mapping-candidate approve/reject/stage permissions, allowed role policies, a DB lookup helper, and service-account denies for mapping decision actions.
- `0005_proposal_lifecycle_rbac.sql` seeds governed proposal submit/validate/route/approve/reject/stage and release-candidate creation permissions, allowed role policies, a DB lookup helper, and service-account denies for proposal governance actions.

## Runtime Tenant Scoping

Application services must set tenant and environment at the start of each transaction:

```sql
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000000';
SET LOCAL app.environment = 'dev';
SET LOCAL app.allow_cross_tenant = 'false';
```

Privileged maintenance and approved break-glass paths may set:

```sql
SET LOCAL app.allow_cross_tenant = 'true';
```

That setting must only be used by a `security_admin`-controlled, time-limited, separately approved, tenant-scoped, audited support path. It is not a platform-admin shortcut.

## Audit Immutability

`pharmaops.audit_events` is append-only:
- `BEFORE UPDATE` trigger `audit_events_prevent_update` raises an exception.
- `BEFORE DELETE` trigger `audit_events_prevent_delete` raises an exception.
- Corrections must be represented as new compensating audit events.
- Normal runtime roles should receive `INSERT` and role-filtered `SELECT` only; do not grant `UPDATE` or `DELETE`.

Example privilege direction for later DevOps role setup:

```sql
GRANT USAGE ON SCHEMA pharmaops TO pharmaops_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA pharmaops TO pharmaops_app;
REVOKE UPDATE, DELETE ON pharmaops.audit_events FROM pharmaops_app;
GRANT INSERT, SELECT ON pharmaops.audit_events TO pharmaops_app;
```

The trigger is still the hard stop if a future grant is too broad.

## ADR-0002 Alignment

ADR-0002 makes `pharmaops.audit_events` the canonical searchable audit-event system of record, with immutable object-storage evidence packages for regulated release artifacts. Audit rows remain append-only in PostgreSQL; corrections are compensating audit events. Object storage still owns retention or object-lock controls for release package manifests and evidence bundles.

`pharmaops.release_metadata` is the canonical searchable release-package ledger row. Migration `0002_release_metadata_hardening.sql` enforces:
- `manifest_uri` is required.
- `manifest_digest` must match `sha256:[64 lowercase hex characters]`.
- `candidate`, `validated`, `approved`, and `active` rows must include non-empty source version pins, included graphs, validation report references, approval trace, artifact hashes, and `audit_event_range.first` / `audit_event_range.last`.

The release-ledger adapter owned by the semantic-store release workflow should insert this column set:

```sql
tenant_id,
environment,
release_id,
semantic_version,
status,
release_candidate_id,
previous_release_id,
manifest_uri,
manifest_digest,
ontology_digest,
shape_digest,
source_version_pins,
included_graphs,
validation_report_refs,
changelog_uri,
artifact_hashes,
approval_trace,
audit_event_range,
rollback_target_release_id,
created_by_user_id or created_by_service_account_id
```

## Release Metadata Grants

The release metadata ledger is tenant-scoped by RLS and should be written only by the release workflow service account or a release-manager-controlled service path that sets `app.tenant_id`, `app.environment`, and `app.allow_cross_tenant = 'false'` inside the transaction.

Migration `0002_release_metadata_hardening.sql` revokes direct `INSERT`, `UPDATE`, and `DELETE` on `pharmaops.release_metadata` from `PUBLIC`, conditionally narrows a broad `pharmaops_app` role to `SELECT`, conditionally grants `SELECT, INSERT` to `pharmaops_release_workflow`, and conditionally grants read-only access to `pharmaops_release_manager` and `pharmaops_security_audit_export` if those database roles exist.

Break-glass may read, search, or export release ledger records only through the audited `security_admin` flow. It must not receive insert privileges or bypass release-ledger immutability.
