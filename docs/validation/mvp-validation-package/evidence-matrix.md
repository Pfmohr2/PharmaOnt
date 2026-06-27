# MVP Validation Evidence Matrix

## P7-CTRL-001: Provenance and evidence coverage across governed objects

- Status: `pass`
- Failed severity: `P1`
- Objective: Assertions, AI candidates, mappings, and release items carry provenance, evidence refs, source spans, audit links, and integrity metadata before pilot use.
- Result: Governed records without required provenance/evidence fail validation or explainability before release/package use.
- Evidence refs:
  - `services/explanation/src/index.js`
  - `services/ai-curation/src/index.js`
  - `services/validation/src/index.js`
  - `tests/unit/explanation-service.test.mjs`
  - `tests/unit/ai-curation-engine.test.mjs`
  - `tests/unit/validation-preview.test.mjs`
  - `packages/provenance/schemas/assertion-evidence-link.schema.json`
- Tests:
  - search hit explanation returns match reasons, evidence, provenance, assertion type, and source versions
  - AI curation emits schema-valid candidates for all five suggestion types
  - validation preview reports critical missing provenance, evidence, vocabulary version, and confidence

## P7-CTRL-002: Critical validation failures block release

- Status: `pass`
- Failed severity: `P0`
- Objective: Any unresolved CRITICAL validation finding blocks staging, release candidate creation, and immutable validation evidence resolution.
- Result: Release manager and validation evidence resolver fail closed on unresolved critical findings.
- Evidence refs:
  - `services/validation/src/index.js`
  - `services/release-manager/src/index.js`
  - `tests/unit/validation-preview.test.mjs`
  - `tests/release/phase4-release-candidate.test.mjs`
  - `tests/release/release-manager.test.mjs`
- Tests:
  - critical rule export documents the release-blocking contract
  - release validation evidence ignores caller-resolved refs and uses authoritative immutable run
  - Phase 4 exit negative: real release manager blocks critical validation before manifest or ledger persistence
  - P4-RT-002: resolved critical validation records block RC even when caller marks them resolved

## P7-CTRL-003: No AI auto-publication

- Status: `pass`
- Failed severity: `P0`
- Objective: AI suggestions remain model_suggested, proposed, visually distinct candidates and cannot enter released graph or release candidate assembly without human governance and canonical conversion.
- Result: Raw model_suggested records are release-ineligible and blocked at API, workflow, release manager, and semantic-store layers.
- Evidence refs:
  - `services/ai-curation/src/index.js`
  - `services/api/src/ai-curation.js`
  - `services/proposal-workflow/src/workflow.js`
  - `services/release-manager/src/index.js`
  - `services/semantic-store/src/release-snapshot.js`
  - `tests/e2e/phase6-ai-curation-e2e.test.mjs`
  - `tests/release/release-manager.test.mjs`
  - `tests/unit/semantic-store.test.mjs`
  - `tests/unit/ai-curation-frontend.test.mjs`
- Tests:
  - Phase 6 E2E: AI suggestions stay governed through workflow, API, UI, feedback, search, and release gates
  - P6-SEC release candidate assembly rejects and audits model_suggested auto-release attempts
  - P1-RT-006 model_suggested triples cannot reach release graph through public release path
  - Phase 6 frontend refuses unfiltered or approved/released suggestion payloads

## P7-CTRL-004: FAERS/openFDA non-causal enforcement

- Status: `pass`
- Failed severity: `P0`
- Objective: FAERS/openFDA evidence is allowed for non-causal association/safety-signal use only and must preserve non-causal limitations with evidence.
- Result: Causal FAERS/openFDA claims are blocked while required disclaimer/source_limitations fields remain attached to evidence.
- Evidence refs:
  - `packages/licensing/src/index.js`
  - `services/validation/src/index.js`
  - `services/ai-curation/src/index.js`
  - `services/api/src/ai-curation.js`
  - `services/explanation/src/index.js`
  - `tests/e2e/phase6-ai-curation-e2e.test.mjs`
  - `tests/unit/ai-curation-api.test.mjs`
  - `tests/unit/validation-preview.test.mjs`
  - `packages/licensing/test/licensing.test.mjs`
- Tests:
  - P6-P0: non-causal FAERS/openFDA suggestions should pass API/UI with disclaimers intact
  - FAERS claims are blocked when presented as causal or without non-causal limitations
  - openFDA FAERS policy carries mandatory non-causal disclaimer
  - explanation service blocks fabricated confidence and FAERS causal claims

## P7-CTRL-005: Mapping source and target version pinning

- Status: `pass`
- Failed severity: `P1`
- Objective: Mappings carry source and target vocabulary versions before persistence, validation, workflow, release, export, and search use.
- Result: Mappings missing source or target vocabulary versions fail contract, registry, semantic-store, or validation checks.
- Evidence refs:
  - `packages/contracts/src/mapping-object.schema.json`
  - `services/mapping-registry/src/index.js`
  - `services/semantic-store/src/mapping-store.js`
  - `services/validation/src/index.js`
  - `tests/unit/mapping-object.test.mjs`
  - `tests/unit/mapping-registry.test.mjs`
  - `tests/unit/validation-preview.test.mjs`
  - `tests/unit/semantic-store.test.mjs`
- Tests:
  - mapping object contract requires source and target vocabulary versions
  - mapping registry rejects release writes and mappings missing source or target vocabulary versions
  - P1-RT-007 mapping write validates source and target vocabulary versions before persistence
  - validation preview reports critical missing provenance, evidence, vocabulary version, and confidence

## P7-CTRL-006: Strict AI candidate contract reuse

- Status: `pass`
- Failed severity: `P0`
- Objective: All API write/read paths reuse Andy's strict ai-suggestion-candidate.v1 validator to reject masquerade payloads, malformed evidence/spans, fake calibration, and nested release status overrides.
- Result: The API imports and applies the canonical validator before outward shaping; malformed or masquerading candidates fail closed.
- Evidence refs:
  - `services/ai-curation/src/index.js`
  - `services/api/src/ai-curation.js`
  - `tests/unit/ai-curation-engine.test.mjs`
  - `tests/unit/ai-curation-api.test.mjs`
- Tests:
  - strict validator rejects nested masquerade payloads and malformed nested evidence
  - Phase 6 API accepts Andy ai-suggestion-candidate.v1 shape
  - Phase 6 suggestion fetch fails closed on unsafe or incomplete AI candidates

## Residual Risks

- `P7-RISK-001` P2: Live infrastructure tests are skipped in local validation package run. Accepted for pilot gate by signed release-risk waiver `waivers/release-risk-waiver-mvp-2026-06-27-rc1.json` (`sha256:c13b7dc2e0baf671cf52c700d85165d85ad5d614d9f79043f3d5f9203433f7b1`) for `mvp-2026-06-27-rc1` / `rc:mvp-2026-06-27`; staging/live execution evidence remains required before treating this residual as closed.
- `P7-RISK-002` P2: Pilot data and source-license approvals remain environment-specific. Require tenant/environment source-license approvals and export-use scopes before controlled-prod pilot promotion.
