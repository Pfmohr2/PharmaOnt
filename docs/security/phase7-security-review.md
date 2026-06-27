# Phase 7 Security Review

Date: 2026-06-27

Owner: Oscar (`oscar-mqvn2odf`)

Scope: Phase 7 Wave A MVP hardening and pilot-readiness security review. Reviewed server-side RBAC/authz filtering, tenant isolation, hidden-count discipline, no-auto-release write-path enforcement, governed decision integrity, release/rollback/backup proof resolution, audit completeness and immutability, AI-curation masquerade defenses, KPI/observability serialization, validation package output, and pilot/admin documentation boundaries.

## Summary

Sign-off: GO for Phase 7 Wave A security review. No unresolved P0 or P1 security findings were identified in the reviewed server-side controls.

Creed adversarial support concurred on the current shipped controls: no P0/P1 found in the support pass, with Phase 7 watch items retained for final exit around new P7 surfaces, backup/restore, service-account scope, MASQ regressions, and frontend placeholder terminology.

## Controls Verified

- Server-side authz chokepoints: `services/authz-filter/src/index.js`, `services/api/src/query-boundary.js`, `services/search/src/index.js`, `services/export/src/index.js`, and `services/api/src/workbench.js` route result-returning paths through tenant, environment, role, release, license, and assertion-type filtering.
- Hidden-count discipline: public service responses do not serialize `filtered_count`, `hidden_count`, or `authorization_filtered_count`. Remaining references are docs/tests asserting absence and frontend null placeholders, not server response counts.
- No-auto-release write path: `services/proposal-workflow/src/workflow.js`, `services/proposal-workflow/src/governed-decisions.js`, `services/proposal-workflow/src/stores.js`, `services/release-manager/src/index.js`, and `services/semantic-store/src/release-snapshot.js` reject raw `model_suggested` publication paths and require human-governance proof before model-suggested review movement.
- AI-curation masquerade defenses: `services/api/src/ai-curation.js` uses the strict AI suggestion validator, rejects nested governed-state masquerade fields, fabricated or loose confidence/evidence/spans, unsafe governance flags, duplicate auto-merge, and causal FAERS/openFDA claims while preserving non-causal disclaimers.
- Release and rollback integrity: release candidate creation resolves staged entries and validation records server-side, rejects inline governed items, signs/binds authorization decisions, emits required audit, persists immutable manifest digests, and rollback resolves canonical release metadata instead of caller snapshot refs.
- Phase 7 backup/restore: `services/ops/src/backup-restore.js` requires canonical governance proof resolution, clean restore targets, digest reconciliation, audit preservation, release manifest integrity, and released-scope `model_suggested` rejection.
- Phase 7 observability/KPI dashboards: `services/ops/src/observability.js` scopes event streams by tenant/environment and excludes unauthorized/hidden records before metric computation; output does not include hidden-count fields or cross-tenant/global totals.
- Validation package: `services/validation/src/package-generator.js` produces a signed MVP validation package with no unresolved P0/P1 residuals; residuals are P2 only.
- Service accounts and privileged admin posture: connector/service-account permissions remain scoped; release/export/audit/break-glass authority stays bound to human owner, tenant/environment/release scope, destination/license policy, expiry, and audit/dual-control requirements in DB/security docs and tests.

## Findings

P0: none.

P1: none.

P2 residuals:

- P7-P2-001: Live DB/Fuseki-backed tests are skipped in this local shell because Docker/Fuseki/Postgres are unavailable. Pilot gate should rely on staging CI or an approved waiver for those live infrastructure checks.
- P7-P2-002: Frontend placeholder names still include null-only `hidden_count` / `unauthorized_hidden_count` fields. Current server responses remain allowlisted and tests assert hidden counts are absent; keep this on the final exit watch list so new dashboards do not copy these names into server payloads.
- P7-P2-003: Pilot source-license approvals are environment-specific. Controlled-prod pilot promotion should require tenant/environment source approval and export-use scopes.

## Verification

- Creed support baseline: `node --test tests/security/authz-filter.test.mjs tests/security/operational-schema-security.test.mjs tests/proposal-workflow/proposal-workflow.test.mjs tests/release/release-manager.test.mjs tests/unit/search-service.test.mjs tests/unit/ai-curation-api.test.mjs tests/unit/ai-curation-engine.test.mjs tests/unit/semantic-store.test.mjs tests/unit/workbench-api.test.mjs tests/e2e/phase6-ai-curation-e2e.test.mjs` = 88 total, 82 pass, 0 fail, 6 Docker-backed skips.
- Oscar targeted Phase 7/security stack: `node --test tests/security/authz-filter.test.mjs tests/security/operational-schema-security.test.mjs tests/proposal-workflow/proposal-workflow.test.mjs tests/release/release-manager.test.mjs tests/release/phase7-release-drill.test.mjs tests/ops/phase7-ops.test.mjs tests/unit/mvp-validation-package.test.mjs tests/unit/search-service.test.mjs tests/unit/ai-curation-api.test.mjs tests/unit/ai-curation-engine.test.mjs tests/unit/semantic-store.test.mjs tests/unit/workbench-api.test.mjs tests/e2e/phase6-ai-curation-e2e.test.mjs` = 96 total, 90 pass, 0 fail, 6 Docker-backed skips.
- Full suite: `npm test` = 245 total, 234 pass, 0 fail, 11 expected local skips.
- Static checks: `rg` over services/apps/docs/tests for hidden-count fields confirms implementation references are limited to frontend null placeholders and tests/docs asserting absence; no server serializer returns hidden authorization counts.

## Sign-Off

No unresolved P0/P1 security findings remain for Phase 7 Wave A based on current code and available local verification. Final Phase 7 exit should rerun the same stack plus live staging DB/Fuseki/Postgres-backed tests and hidden-only probes for any newly added P7 endpoints.
