# ADR-0002: Audit Storage Immutability and Canonical Release Package Record

## Status

Proposed

## Context

PharmaOps needs one authoritative answer for two regulated records:

- The append-only audit log for regulated and privileged actions.
- The canonical release package record for immutable semantic releases, including snapshot identity, changelog, content hashes, approvers, source-version pins, validation evidence, and rollback pointer.

Red Team findings ARCH-RT-002 and VAL-RT-002 require the immutability mechanism and source-of-truth boundary to be explicit. The decision must align with `services/db/migrations/0001_operational_schema.sql`, which defines `pharmaops.audit_events` as append-only with database triggers, and with provenance/audit schemas in `packages/provenance`.

## Decision

Use PostgreSQL as the authoritative operational system of record for audit events and release metadata, backed by immutable object-storage evidence packages for regulated retention and export.

Authoritative records:

- `pharmaops.audit_events` is the canonical searchable audit-event system of record for Phase 1. It is append-only at the database layer: `BEFORE UPDATE` and `BEFORE DELETE` triggers reject mutation, and normal roles do not receive update/delete grants.
- `pharmaops.release_metadata` is the canonical release-package ledger record. It stores release ID, status, previous release, rollback target, manifest URI, manifest digest, ontology and shape digests, source-version pins, included graphs, validation report references, changelog URI, artifact hashes, approval trace, and audit-event range.
- Object storage holds immutable release packages and audit/release evidence exports. These packages are content-addressed by SHA-256 manifest digest and must use bucket/object-lock, retention, legal-hold, or equivalent WORM controls in regulated environments.

Release package identity is the pair:

```text
release_id + manifest_digest
```

The manifest referenced by `release_metadata.manifest_uri` is the canonical immutable release package artifact. `release_metadata` is the authoritative searchable ledger row; the object manifest is the authoritative immutable package content. A mismatch between ledger digest and object digest is a release blocker.

`manifest_digest` is the SHA-256 digest of the exact stored manifest bytes. The stored manifest MUST NOT include `manifest_digest`, avoiding a self-referential hash. The digest is stored in `pharmaops.release_metadata.manifest_digest` and may also be carried in API responses or detached evidence records.

Release graph exposure is fail-closed. The release workflow MUST validate semantic content, reconcile source-version provenance, write the immutable object manifest, persist the canonical `pharmaops.release_metadata` row, and reconcile the persisted ledger digest with the object manifest digest before exposing or promoting any `graph:tenant:{tenant_id}:release:{release_id}:*` named graph. If any post-validation release-package or ledger check fails, there MUST be zero triples in the final release graph.

Implemented-now release package contract:

- The Phase 1 semantic-store release path reconciles every provenance block in the candidate graph against `source_version_pins` before release graph exposure. Each released provenance block must carry `sourceName`, `sourceVersion`, `auditEventId`, `actor`, and `methodType`; the source name/version pair must be present in the release package pins.
- The Phase 1 semantic-store release path checks evidence-source coverage available in RDF fixtures: evidence source name/version, source record ID, license classification, and disclaimer ID. Evidence source name/version must also reconcile to package pins.
- The Phase 1 semantic-store release path persists the release metadata row through a ledger adapter and blocks release when the persisted ledger `manifest_digest` differs from the exact stored manifest digest. `PostgresReleaseLedger` inserts the canonical `pharmaops.release_metadata` row using a transaction-scoped release-workflow service-account client; JSON/no-op adapters are test/local only.

Phase-5 Release-Manager forward references:

- Audit retention/export evidence on the release package manifest MUST include `retention_class`, legal-hold status, tenant retention policy ID, audit export format and version, export manifest URI/hash, exported event count, export hash/signature, export actor, export timestamp, release/date range, tenant scope, and export filter criteria. These fields map the Validation Plan audit retention, legal hold, and export-format gates. Phase 1 records the ledger and manifest boundary; the full audit export bundle is owned by the Release Manager and audit export service.
- `audit_event_range` completeness MUST include first and last event IDs, first and last event timestamps, event count, tenant filter, environment filter, release filter, correlation IDs, and the included event types. Required event types are `validation_run`, `release_staging`, `release_promotion` or `failed_promotion`, approval/review decisions, `audit_export`, rollback where applicable, and `retention_or_legal_hold_change` where applicable. Phase 1 requires an audit-event range before snapshot; Phase 5 must verify the complete exported event set against `packages/provenance/schemas/audit-event.schema.json`.
- Per-assertion provenance reconciliation MUST expand beyond the Phase 1 RDF fields to include source name/version or retrieval strategy, record hash or raw source pointer, license classification, disclaimer IDs, actor, method, release context, and audit event IDs for every released assertion. Unreconciled provenance MUST block release. This maps PROVENANCE.md release blockers and Validation Gate 4.

## Alternatives considered

- PostgreSQL-only audit and release storage. This gives transactional queryability but does not provide independent WORM retention evidence for release packages and audit exports.
- Object-storage-only audit ledger. This gives strong retention controls but makes policy queries, audit search, tenant filtering, correlation lookup, and release joins unnecessarily difficult.
- External blockchain or managed ledger as primary audit source. This adds complexity and vendor dependency before the MVP needs it.
- Markdown or repository release ledger. This is inspectable but not an authoritative runtime record and cannot safely own regulated release state.

## Consequences

Positive consequences:

- Audit events are immutable at the database layer, not only by application convention.
- Release package records are searchable in PostgreSQL and independently verifiable against immutable object manifests.
- Release graph exposure happens only after manifest and ledger digest reconciliation, preventing orphan immutable release graphs when ledger persistence fails.
- Release rollback can use `release_metadata.rollback_target_release_id` and active release status without mutating released semantic graphs or packages.
- CI and local development can validate ledger/manifest behavior without requiring a managed ledger product.

Costs and tradeoffs:

- Full WORM retention depends on object-storage configuration in non-local environments.
- Cross-store consistency must be explicitly checked: release metadata, RDF release graph, object manifest, validation reports, approvals, and audit-event range must agree.
- The Release Manager must own the later full audit export completeness check and object-lock evidence packaging; the semantic store only enforces the Phase 1 release graph gate.
- Later migration to a managed audit ledger would require exporting existing audit events and release manifests with digests.

## Security impact

- Normal application principals must not receive `UPDATE` or `DELETE` on `pharmaops.audit_events`.
- Regulated audit corrections are compensating events, not edits.
- Release package object prefixes must be tenant-scoped, encrypted, access-controlled, and protected by retention/legal-hold policy.
- Privileged downloads and audit exports must create audit events.
- Service accounts that create release package records need narrowly scoped insert permissions, object-prefix access, and no ability to overwrite released objects.

## Compliance impact

- This decision satisfies the requirement for immutable, searchable, exportable, attributable audit records.
- Each release package has an addressable manifest digest and a ledger row with source-version pins, artifact hashes, approver trace, validation reports, changelog, and rollback target.
- Release promotion must fail closed when any required audit event, approval, validation report, source-version pin, content hash, release graph, or manifest digest is missing or mismatched.
- Release promotion must fail closed when any released assertion has unreconciled provenance or evidence source/version data.
- Retention and legal-hold policy can be applied to release packages and audit export bundles at the object-storage layer.

## Data/provenance impact

- Audit events keep provenance references and artifact hashes in PostgreSQL for query and inspection.
- Release manifests preserve content hashes for RDF snapshots, validation reports, changelog, source-version manifests, approval trace, and rollback metadata.
- RDF release graphs remain immutable semantic snapshots; release metadata and object manifests describe and address those snapshots.
- Search indexes and exports remain derived and rebuildable from RDF release graphs, PostgreSQL release metadata, audit events, and object manifests.

## Rollback plan

If this decision is superseded by an external immutable ledger or managed audit store:

1. Freeze regulated promotions.
2. Export `pharmaops.audit_events` and `pharmaops.release_metadata` with stable ordering and SHA-256 digests.
3. Export all referenced release manifests and object package digests.
4. Load records into the replacement ledger.
5. Reconcile event counts, release IDs, manifest digests, audit-event ranges, and rollback pointers.
6. Re-run release package integrity checks.
7. Switch write paths to the replacement ledger while preserving PostgreSQL as a searchable index if needed.

Existing release manifests remain immutable and addressable by `release_id + manifest_digest`.

## Reviewers

- Solution Architect Agent: Jim
- Security and Identity Agent: Oscar
- Provenance/Compliance Agent: Andy
