# services/release-manager

Backend-only Phase 4 release candidate packaging and rollback orchestration.

## Boundary

`ReleaseManagerService` assembles immutable release candidate packages from approved, staged workflow items. It does not publish to released RDF graphs and does not implement workflow, validation, RBAC, or audit internals. Those are injected as gates:

- `proposalWorkflowService.stagedEntries`: canonical staged-entry resolver. RC creation rejects inline caller-supplied governed items and requires `staged_entry_ids`.
- `resolveStagedItem`: adapter that resolves each staged entry to its persisted governed item payload.
- `validationRunResolver.resolveValidationReports`: canonical immutable validation-run resolver. Caller-supplied validation refs are not accepted as proof.
- `assertCanCreateReleaseCandidate`: release-manager authorization hook for `release_candidate.create`, defaulting to a fail-closed human `release_manager` actor check with digest-bound decision fields.
- `validationGate`: Andy's release validation gate; default is `assertNoCriticalFailures(releaseCandidate, { releaseMode: true, expectedTenantId })`.
- `auditStore.append`: append-only audit writer. RC creation and rollback fail closed if audit append fails or returns a mismatched audit ID.
- `releaseLedger`: Phase 1 release metadata ledger adapter.

## RC Package Schema

The manifest schema is `release-candidate-package.v1` and includes:

- `release_id`, `semantic_version`, `release_candidate_id`
- `tenant_id`, `environment`, `created_at`, `created_by`
- `previous_release_id`, `rollback_target_release_id`
- `snapshot_ref`, `content_snapshot`
- `changelog`, `changelog_uri`
- `artifact_hashes`
- `approval_trace`
- `source_version_pins`
- `validation_report_refs`, `validation_result`
- `audit_event_range`
- `included_graphs` with `target_release_graph: null`
- `staged_entries`, `items`
- `rollback`
- `authorization_decision`

Manifest bytes are written immutably and addressed by SHA-256 digest. The digest is reconciled with the inserted release metadata ledger row.

`createReleaseCandidateFromStaging` consumes `ProposalWorkflowService.stagedEntries({ tenant_id, environment, release_id })`, scopes the entries to one tenant/environment/release, and requires governed item payloads either in the staged entry or from a `resolveStagedItem` adapter.

Phase 6 no-auto-release gate: release candidate assembly rejects any resolved item that still carries `assertion_type: "model_suggested"`, nested `payload.assertion_type: "model_suggested"`, or AI governance flags such as `release_eligible: false`. The denial is appended as `release_candidate_promotion_denied` before manifest, ledger, or graph writes. Human feedback proof can move a suggestion through review, but it does not make raw model output release-package eligible.

`loadReleaseCandidate` verifies the stored manifest bytes against `release_metadata.manifest_digest` before downstream use. Rollback resolves the target release from canonical release metadata by `rollback_target_release_id`, verifies the target manifest evidence, ignores caller-supplied snapshot refs, appends rollback audit, and activates the canonical snapshot ref.

## Rollback Procedure

Rollback metadata is embedded in each RC package:

1. Freeze new promotion attempts for the tenant and release domain.
2. Load the prior immutable release manifest identified by `rollback_target_release_id`.
3. Verify the prior manifest digest, snapshot reference, source-version pins, validation evidence, and approval trace.
4. Move the active release pointer back to `rollback_target_release_id` through the release workflow service account.
5. Invalidate and rebuild derived search, vector, and API caches from the restored immutable snapshot.
6. Emit an immutable `release.rollback` audit event with actor, rationale, before/after release IDs, and correlation ID.
7. Do not mutate existing released graphs or release candidate manifests.
