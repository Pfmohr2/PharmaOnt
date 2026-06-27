# Phase 7 Backup And Restore Runbook

## Scope

This runbook covers pilot restore of the governed semantic graph exports, release manifests, release ledger metadata, append-only audit events, and object artifacts. It is intended for a pilot admin restoring into a clean validation or disaster-recovery target.

## Targets

- RPO target: 15 minutes.
- RTO target: 60 minutes.
- Restore target requirement: clean target only. Do not restore over existing graph exports, release manifests, release metadata, audit events, or object artifacts.

## Backup Contents

Each snapshot includes:

- `graph_exports`: governed graph exports, including release graph exports.
- `release_manifests`: immutable release candidate or release package manifests.
- `release_metadata`: release ledger records.
- `audit_events`: append-only workflow, release, rollback, and authorization audit events.
- `object_artifacts`: exported validation reports, changelogs, or other release-adjacent objects.
- `section_digests`: SHA-256 digests for each section.
- `manifest_digest`: SHA-256 digest binding snapshot identity, target scope, RPO/RTO, and section digests.

## Restore Procedure

1. Freeze writes for the tenant and environment being restored.
2. Select the latest completed backup snapshot within the 15-minute RPO window.
3. Provision or verify a clean restore target. The target must have empty graph, release manifest, release metadata, audit, and object artifact stores.
4. Restore sections in this order: graph exports, release manifests, release metadata, audit events, object artifacts.
5. Recompute section digests from restored content and compare them with the backup snapshot.
6. Verify each release metadata record has a matching release manifest, included graphs, and an audit event range.
7. Verify all backup audit event IDs are present after restore, including every event referenced by release audit ranges.
8. Scan released scope for `model_suggested`. Released scope includes release manifests, release metadata, and graph exports marked `graph_role: "release"` or named with `:release:`.
9. Resolve release governance proof from the canonical release ledger or governance store. Do not accept inline `governed_state`, inline governance proof, caller release targets, or caller released graph targets from the snapshot payload.
10. Re-enable read traffic after all verification checks pass. Re-enable writes only after the pilot admin records the restore drill result.

## Integrity Checks

The Phase 7 restore drill must pass these checks:

- `content_hashes_match`: restored section digests match the backup section digests.
- `releases_intact`: release metadata, manifests, included graphs, and audit ranges remain coherent.
- `audit_preserved`: all backup audit events and release audit range events are present after restore.
- `no_model_suggested_released_leakage`: no released artifact contains `model_suggested`.
- `canonical_governance_proof`: release proof is resolved server-side and matches tenant, environment, release ID, manifest digest, and approval/audit proof digest.

## Failure Handling

If any check fails, keep writes frozen and do not promote the restored target. Capture the failed snapshot ID, mismatched section names, release ID if present, and first missing audit event if present. Restore again from the prior completed snapshot. Escalate to god only if two consecutive completed snapshots fail the same integrity check.

## Drill Result

The local Phase 7 test drill restores `tenant-a` / `validation` from a clean target and verifies all required checks. The measured test RTO is 10 minutes against a 60-minute target, with the 15-minute RPO target encoded in the snapshot manifest.
