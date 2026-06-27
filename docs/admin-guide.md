# PharmaOps Pilot Admin Guide

Audience: pilot administrators, tenant operators, release managers, security administrators, and support engineers.

This guide explains how to administer a pilot PharmaOps environment: RBAC and roles, release and rollback operations, audit expectations, API and export controls, and source/connector configuration. It is docs-only operational guidance and points to the real OpenAPI contracts and runbooks used by the pilot.

## Admin Responsibilities

Pilot admins are responsible for:

- Tenant and environment setup.
- Role assignment and separation-of-duties enforcement.
- Source and connector configuration.
- License, sensitivity, and export policy review.
- Release-candidate operations and rollback coordination.
- Audit review and evidence preservation.
- API integration support for workbench, curation, evidence, and export workflows.
- Incident triage for authorization, connector, release, export, and restore failures.

Do not bypass server-side authorization, workflow, release, audit, or connector policy boundaries. Frontend controls are not an enforcement boundary.

## Role Model

| Role | Typical permissions | Explicit limits |
|---|---|---|
| `viewer` | Search, open entity pages, view authorized evidence, inspect explanations. | Cannot curate, approve, stage, release, rollback, manage RBAC, or export restricted scopes. |
| `curator` | Review candidates, submit AI suggestion feedback, accept/reject/revise workflow candidates where permitted. | Cannot approve own submissions, stage releases, promote releases, or bypass evidence requirements. |
| `domain_approver` | Approve or reject governed candidates after evidence and provenance review. | Cannot approve own work, stage releases, or bypass validation/license gates. |
| `release_manager` | Stage approved candidates, create release candidates, run rollback procedure, coordinate release evidence. | Cannot approve their own candidate work unless separately authorized by policy; cannot accept inline caller-supplied release proof. |
| `admin` | Manage tenant configuration, roles, connector setup, and operational settings. | Should not perform governed review decisions unless explicitly assigned an operational role. |
| `service_account` | Run connector, ingestion, normalization, metrics, and job tasks within scoped grants. | Cannot approve, reject, stage, promote, rollback, export release packages, write released graphs, manage RBAC, or activate break-glass. |

## RBAC Operating Rules

Apply these rules for pilot access:

1. Assign the minimum role needed for the user's job.
2. Keep human review roles separate from connector service accounts.
3. Do not give service accounts approval, release, rollback, export-package, RBAC, or break-glass scopes.
4. Enforce tenant and environment matching for every role grant.
5. Require rationale for governed decisions.
6. Require source version, evidence, provenance, confidence, license, and duplicate status before approval or staging.
7. Deny self-approval and service-account-owner approval.
8. Review audit events after role or source entitlement changes.

Reference: `docs/curation-rbac.md`.

## User Provisioning Checklist

For each pilot user:

1. Confirm the user's tenant and environment.
2. Assign role keys for the user's pilot duties.
3. Grant source entitlements only for permitted sources.
4. Confirm whether export is needed and for which release or working scope.
5. Confirm whether the user may access restricted evidence content or metadata only.
6. Document separation-of-duties constraints.
7. Ask the user to confirm they can search, open an entity page, inspect evidence, and see only expected actions.

For each service account:

1. Bind it to exactly one tenant and environment.
2. Bind connector ID, connector version, source name, source version or approved source-version strategy, license policy ID, and correlation context.
3. Grant only required connector scope families.
4. Confirm explicit denies for released graph writes, release-candidate graph writes, approvals, releases, export packages, RBAC, and break-glass.
5. Verify job logs and metrics are tenant-filtered and redacted.

Reference: `docs/ingestion-security.md`.

## Source And Connector Configuration

Connectors ingest source data as governed candidates and normalized records. They do not publish facts.

Required connector configuration:

- `tenant_id`
- `environment`
- `service_account_id`
- `connector_id`
- `connector_version`
- `source_name`
- `source_version` or approved version strategy
- `license_policy_id`
- `correlation_id`
- raw artifact prefix scoped to tenant and environment
- checkpoint and run-lineage binding

Before enabling a connector:

1. Review the source license and materialization policy.
2. Confirm permitted uses: ingestion, normalization, AI processing, export, and release.
3. Confirm PII/PHI sensitivity handling.
4. Configure raw artifact retention and pointer policy.
5. Run connector contract tests or source-specific fixtures where available.
6. Confirm dead-letter queue behavior for policy denials.
7. Confirm checkpoint replay is tenant-, connector-, source-, version-, and service-account-bound.

Connector references:

- `connectors/README.md`
- `connectors/chembl/README.md`
- `connectors/clinicaltrials/README.md`
- `connectors/openfda_faers/README.md`
- `connectors/pubmed_europepmc/README.md`
- `connectors/uniprot/README.md`
- `packages/connector-sdk/README.md`

## Workbench API Administration

The Phase 5 workbench API is the pilot contract for search, entity detail, explanations, evidence, and exports.

| Capability | Endpoint | Admin notes |
|---|---|---|
| Search | `POST /api/workbench/search` | Server filters by tenant, environment, role, release, assertion type, license, and export policy. |
| Entity detail | `GET /api/workbench/entities/{entityId}` | Returns header, mappings, synonyms, relationships, evidence, history, and impact after authorization filtering. |
| Explanation | `GET /api/workbench/explanations/search-hit/{hitId}` | Authorizes the hit before resolving match reasons, evidence, provenance, and governance flags. |
| Evidence | `GET /api/workbench/evidence/by-assertion/{assertionId}` | Authorizes the assertion before returning full, snippet, pointer, or metadata-only evidence. |
| Export preview | `POST /api/workbench/export/preview` | Dry-run export; use before creating jobs. |
| Export job | `POST /api/workbench/export` | Creates authorized export jobs with regulated fields preserved. |

Contract: `docs/api/phase5-workbench.openapi.json`.

Admin checks:

- No endpoint should expose hidden unauthorized counts.
- Export output must preserve IDs, vocabulary versions, release context, provenance, license metadata, source versions, and hashes.
- Hidden-only export scopes must not create ready jobs.
- Search and entity responses must preserve assertion badges and release context.
- Restricted evidence must be server-redacted or metadata-only before the client sees it.

## AI Curation API Administration

The Phase 6 curation API is the pilot contract for AI-assisted suggestions and human feedback.

| Capability | Endpoint | Admin notes |
|---|---|---|
| Fetch suggestions | `POST /api/curation/suggestions` | Returns authorized `model_suggested` candidates only. |
| Submit feedback | `POST /api/curation/suggestions/{suggestionId}/feedback` | Accept, reject, or revise feedback routed to governed workflow. |

Contract: `docs/api/phase6-curation.openapi.json`.

Required invariants:

- Suggestions must use `assertion_type = model_suggested`.
- Suggestions must use `lifecycle_status = proposed` and `review_status = proposed`.
- Suggestions must use `release_id = null`.
- Suggestions must include model version, prompt version, calibrated score, confidence source, evidence refs, source spans, provenance ID, and duplicate status.
- Feedback is authorized and no-auto-release gated.
- Feedback is workflow input only. It is not approval, release, or export authorization.
- Duplicate suggestions remain flag-only and never auto-merge.
- Low-confidence suggestions route to expert review.
- FAERS/openFDA suggestions must preserve non-causal limitations and must not assert causal claims from FAERS context.

## Approval Administration

Approvals must be human, role-authorized, evidence-backed, provenance-backed, and audited.

Before approving or allowing an approval:

1. Confirm actor role is `curator` or `domain_approver`.
2. Confirm actor is not the candidate creator or service-account owner.
3. Confirm candidate tenant and environment match actor context.
4. Confirm candidate is `proposed`.
5. Confirm required source and target identifiers.
6. Confirm source and target vocabulary versions.
7. Confirm predicate is allowed.
8. Confirm license status permits curation.
9. Confirm confidence is not fabricated.
10. Confirm provenance and evidence refs are present.
11. Confirm duplicate status is not unresolved.
12. Confirm rationale is present.
13. Confirm the audit event is written with correlation ID.

The registry must reject direct writes that try to set governed review state without a verified server-minted decision.

## Release Candidate Operations

Release candidate creation is backend-only and must use canonical staged entries.

Before creating a release candidate:

1. Freeze the intended release scope.
2. Confirm every item is approved and staged through governed workflow.
3. Resolve staged entries server-side. Do not accept inline caller-supplied governed items.
4. Resolve immutable validation reports server-side.
5. Confirm no critical validation failures.
6. Confirm source version pins.
7. Confirm license status and permitted uses include release.
8. Confirm audit event range.
9. Confirm release manager authorization decision.
10. Create immutable manifest bytes and reconcile the manifest digest with release metadata.

Release candidate package contents include release ID, semantic version, staged entries, item payloads, source version pins, validation report refs, approval trace, audit event range, artifact hashes, content snapshot, rollback target, and authorization decision.

Reference: `services/release-manager/README.md`.

## Rollback Procedure

Use rollback when a release must return to a prior immutable snapshot.

1. Freeze new promotion attempts for the tenant and release domain.
2. Load the prior immutable release manifest by `rollback_target_release_id`.
3. Verify manifest digest, snapshot ref, source-version pins, validation evidence, approval trace, and audit event range.
4. Ignore caller-supplied snapshot refs or inline release proof.
5. Move the active release pointer back through the release workflow service account.
6. Rebuild derived search, vector, and API caches from the restored immutable snapshot.
7. Emit an immutable `release.rollback` audit event with actor, rationale, before/after release IDs, and correlation ID.
8. Do not mutate existing released graphs or release candidate manifests.

Reference: `services/release-manager/README.md`.

## Backup And Restore

Pilot restore uses clean targets only.

Restore order:

1. Freeze writes.
2. Select a completed backup within the RPO window.
3. Provision a clean target.
4. Restore graph exports.
5. Restore release manifests.
6. Restore release metadata.
7. Restore audit events.
8. Restore object artifacts.
9. Recompute section digests.
10. Verify release metadata, manifests, included graphs, and audit ranges.
11. Scan released scope for `model_suggested`.
12. Resolve canonical governance proof server-side.
13. Re-enable reads, then writes after admin signoff.

Reference: `docs/runbooks/phase7-backup-restore.md`.

## Audit Administration

Audit events are required for:

- role and entitlement changes;
- connector configuration changes;
- connector job start, retry, policy block, dead-letter, and completion;
- raw artifact or pointer persistence;
- normalization handoff;
- AI suggestion feedback;
- approval, rejection, revision, and staging decisions;
- release-candidate creation;
- rollback;
- export preview and export creation;
- authorization denials and attempted forbidden actions.

Audit payloads should include tenant, environment, actor, role, action, object IDs, candidate IDs, evidence/provenance refs, source versions, release IDs, rationale digest, correlation ID, and audit event ID. They must not expose secrets, raw restricted payloads, raw PHI/PII, or cross-tenant counts.

## Export Administration

Exports must be governed and reproducible.

Admin checks:

1. Confirm export actor has the required role and source entitlements.
2. Confirm export scope is an authorized release or working scope.
3. Run preview before creating the export job.
4. Review invalid visible row count and policy notices.
5. Confirm output includes IDs, vocabulary versions, release context, provenance, source versions, license metadata, and hashes.
6. Confirm hidden-only scopes do not create ready jobs.
7. Store export job ID, manifest digest, and audit event ID.
8. Revoke or rotate destination credentials after pilot use if applicable.

## Operational Monitoring

Monitor:

- connector success, retry, policy block, dead-letter, and freshness metrics;
- search and API error rates;
- authorization denial rates;
- export preview vs export job counts;
- release-candidate validation status;
- rollback drill RTO and RPO;
- audit append failures;
- evidence metadata-only rates for restricted sources;
- AI suggestion feedback volume, low-confidence routing, and rejection reasons.

Related docs:

- `docs/observability/phase7-kpi-dashboards.md`
- `docs/runbooks/pilot-readiness/success-criteria-kpis.md`

## Incident Response

| Incident | Immediate action | Escalation |
|---|---|---|
| Cross-tenant visibility suspected | Freeze affected tenant reads, preserve logs, review authz boundary and audit events. | Escalate to security and god. |
| Released scope contains `model_suggested` | Freeze release promotion and exports, identify manifest and graph, roll back if active. | Escalate to release manager and god. |
| Connector writes forbidden target | Stop connector job, revoke service-account scope, inspect dead-letter and raw artifacts. | Escalate to ingestion owner. |
| Audit append failure | Block governed transition or release action, preserve correlation ID. | Escalate to platform owner. |
| Export includes missing provenance/license fields | Invalidate export job, block downstream delivery, inspect manifest digest and source rows. | Escalate to export owner. |
| Restore integrity check fails | Keep writes frozen, retry prior completed snapshot. | Escalate to god only after two consecutive completed snapshots fail the same check. |

## Pilot Admin Runbook

Use this sequence for pilot readiness:

1. Confirm tenant and environment are configured.
2. Confirm role grants and service-account scopes.
3. Confirm connector source policies and source versions.
4. Run connector fixture or contract checks.
5. Confirm search, entity detail, explanation, evidence, and export preview APIs.
6. Confirm AI suggestion fetch and feedback APIs.
7. Confirm approval and staging workflows with audit events.
8. Create a release candidate from staged entries.
9. Verify release manifest digest and release metadata.
10. Run backup/restore drill.
11. Review KPI dashboard and success criteria.
12. File product bugs for any missing operational capability; do not patch around governance gates.

## MVP Coverage Checklist

| MVP capability | Admin guide section |
|---|---|
| RBAC and role boundaries | Role Model; RBAC Operating Rules; User Provisioning Checklist |
| Service-account safety | Source And Connector Configuration; User Provisioning Checklist |
| Source and connector config | Source And Connector Configuration |
| Search and entity APIs | Workbench API Administration |
| Explainability and evidence APIs | Workbench API Administration |
| AI suggestion and feedback APIs | AI Curation API Administration |
| Low-confidence and duplicate policy | AI Curation API Administration |
| Human approvals | Approval Administration |
| Release candidate creation | Release Candidate Operations |
| Rollback | Rollback Procedure |
| Backup and restore | Backup And Restore |
| Audit | Audit Administration |
| APIs and exports | Workbench API Administration; AI Curation API Administration; Export Administration |
| Monitoring and pilot KPIs | Operational Monitoring |
| Incident response | Incident Response |
