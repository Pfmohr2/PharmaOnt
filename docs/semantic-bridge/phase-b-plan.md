# Semantic Bridge Phase B Plan

Status: design plan for Addendum Phase B relationship-assertion backend. No implementation in this document.

Sources:
- `pharmaops_semantic_bridge_addendum_prompt.md` section 14, Addendum Phase B.
- `docs/semantic-bridge/phase-a-alignment.md`.
- `docs/semantic-bridge/contracts/relationship-assertion.schema.json`.
- `services/semantic-store/src/shacl-runner.js`.
- Existing `services/semantic-store`, `services/api`, `services/authz-filter`, search, export, and workflow patterns.

## Scope Summary

Phase B turns the Phase A RelationshipAssertion contract and SHACL enforcement into a governed backend capability. A relationship assertion must be persisted as a first-class object, not as an opaque graph edge, and must carry source/target entities, predicate, relationship class, assertion type, evidence, source lineage, confidence, review state, release context, license state, warnings, limitations, provenance, and audit linkage.

The Phase B backend must support creation, validation, retrieval, entity relationship listing, review transitions, blocked/deprecated handling, evidence attachment, release inclusion, and export. Every write path must run the Phase A causal-safety gates through `validateSemanticTurtle`; there must be no API, workflow, import, release, or export bypass around the Phase A SHACL runner.

Out of scope for this phase:
- RelationshipPath/pathfinding implementation beyond fields needed to avoid blocking future path work.
- Frontend UX buildout beyond contract coordination and API readiness.
- New relationship taxonomy, predicate matrix, or causal policy changes unless god approves them as separate design changes.
- Any weakening of Phase A released/license/review/export/model_suggested controls.

## Concrete Deliverables

1. `RelationshipAssertionStore` in semantic-store, modeled after `MappingStore`, with contract validation, tenant graph checks, Turtle materialization, `validateSemanticTurtle`, and persistence.
2. RelationshipAssertion JSON contract validator exported from `packages/contracts/src/index.js` with tests aligned to `docs/semantic-bridge/contracts/relationship-assertion.schema.json`.
3. Turtle materializer for RelationshipAssertion that preserves the Phase A node-kind split: entity/evidence/predicate relationship fields as IRIs and governance status fields as literals.
4. API service surface for:
   - `POST /relationship-assertions`
   - `GET /relationship-assertions/{id}`
   - `PATCH /relationship-assertions/{id}`
   - `GET /entities/{id}/relationships`
   - `POST /relationship-assertions/{id}/submit`
   - `POST /relationship-assertions/{id}/approve`
   - `POST /relationship-assertions/{id}/reject`
   - `POST /relationship-assertions/{id}/deprecate`
5. Review workflow transitions that prevent direct release of `model_suggested` assertions and route safety, causal-sensitive, restricted-evidence, and patient-impacting assertions to the correct approver class.
6. Audit events for create, update, evidence attachment, submit, approve, reject, deprecate, release inclusion, export preview, and export creation.
7. Release inclusion hook that admits only approved/released eligible RelationshipAssertions and records validation report IDs.
8. Export support that treats relationship rows as regulated export rows with required tenant, environment, release, provenance, artifact hash, license, source-version, and audit fields.
9. Fixtures and tests for valid persistence plus Phase A gate failures: class/predicate matrix, literal-vs-IRI term shape, released review/license/export gates, causal/safety metadata, model_suggested release block, blocked rationale, and evidence absence.

## Proposed Task Breakdown

### B1. Contract Validator

Owner role: API contract.

Objective: Export a reusable RelationshipAssertion validator from `packages/contracts/src/index.js`, including required-field, enum, conditional, released-state, blocked-state, model_suggested, safety/causal, evidence, license, and provenance checks.

Dependencies: Phase A contracts are committed. This should precede storage and API work.

Notes: The existing package currently exports the schema contract but only has a hand-written mapping validator. Phase B needs either a JSON Schema validator path or a local validator that covers the full relationship schema behavior without drifting from `docs/semantic-bridge/contracts/relationship-assertion.schema.json`.

### B2. Semantic Store Model And Turtle Materializer

Owner role: backend/semantic-store.

Objective: Add `RelationshipAssertionStore` and `relationshipAssertionTurtle` following the `MappingStore` pattern: assert writable tenant graph, validate JSON contract, enforce any service-level invariants, materialize Turtle, run `validateSemanticTurtle`, then persist.

Dependencies: B1.

Implementation surface:
- New semantic-store module and export from `services/semantic-store/src/index.js`.
- Use tenant working relationship graph naming through `tenantWorkingGraph(tenantId, "relationships")` unless graph-family naming needs god approval.
- IRI fields must materialize as IRIs: `pharm:relationshipSubject`, `pharm:relationshipPredicate`, `pharm:relationshipObject`, `pharm:hasEvidence`, and warning/reference fields already guarded by Phase A.
- Literal fields must materialize as literals: class, assertion type, review status, directionality, polarity, confidence, release/license/provenance metadata.

Phase A dependency: The store must call `this.shaclRunner.validateTurtle(...)` before `insertTurtle`. Failed validation is a hard stop.

### B3. Persistence And Read Resolvers

Owner role: backend/semantic-store.

Objective: Define semantic-store read methods for relationship assertion by ID and relationships by entity ID that return API-ready rows with authorization/export fields intact.

Dependencies: B2.

Notes: Reads must return fields needed by `services/authz-filter`: `tenant_id`, `environment`, `assertion_type` or object type, `review_status`/`release_id`, `license_status`, `license_classification`, `license_policy_id`, `permitted_uses`, `export_restrictions`, and role/source visibility metadata where present.

### B4. Relationship Assertion API

Owner role: API contract.

Objective: Add API service methods and route adapters for creation, read, patch, entity relationship listing, and workflow actions.

Dependencies: B1, B2, B3.

Behavior requirements:
- Enforce principal tenant/environment and RBAC before write.
- Call semantic-store write methods; do not insert raw Turtle or JSON through an alternate path.
- Pass all read responses through the existing server-side authorization boundary.
- Return validation errors without exposing internal stack traces.
- Preserve provenance and audit IDs in responses.

Endpoint mapping:
- `POST /relationship-assertions` creates draft/proposed/imported/human-curated/system-generated assertions only when Phase A gates pass.
- `GET /relationship-assertions/{id}` returns one visible assertion.
- `PATCH /relationship-assertions/{id}` updates mutable fields and re-runs full contract plus SHACL validation.
- `GET /entities/{id}/relationships` uses the entity detail relationship section pattern but sources rows from RelationshipAssertion read resolvers.

### B5. Review Workflow

Owner role: backend/semantic-store plus API contract.

Objective: Implement submit, approve, reject, and deprecate transitions with explicit allowed state changes and audit events.

Dependencies: B4.

Rules:
- `model_suggested` can move to proposed/in_review/rejected/deprecated/superseded only; it cannot move straight to released.
- Approval requires reviewer identity, timestamp, non-empty evidence, valid source versions, and policy-compatible license status.
- Safety or `causal_sensitive` assertions require `causal_claim_status` and limitation/warning metadata before approval.
- Blocked assertions require `blocked_rationale`.
- Deprecation must preserve provenance and must not erase previous release/audit history.

### B6. Evidence Attachment

Owner role: backend/semantic-store.

Objective: Support attachment and replacement of `evidence_refs` while preserving source names, source versions, source record IDs, source span IDs, evidence roles, limitations, disclaimer IDs, and release-required markers.

Dependencies: B2, B5.

Rules:
- Empty evidence shells are invalid.
- Evidence-free assertions require an explicit god-approved policy exception; otherwise fail validation.
- Evidence changes after approval should demote status or require re-review unless god approves a narrower workflow.

### B7. Release Inclusion

Owner role: backend/semantic-store plus release manager.

Objective: Include eligible relationship assertions in release candidates and release packages while preserving Phase A gates.

Dependencies: B5.

Rules:
- A released assertion must have `review_status=released`, non-`model_suggested` assertion type, reviewer identity/timestamp, release scope, non-empty release ID, included-in-release flag, valid license status/classification, release permitted use, validation report IDs, source-version lineage, and non-blocked export authorization.
- Release inclusion must re-run `validateSemanticTurtle` on the release-bound materialization, not trust a prior working-graph validation alone.

### B8. Export Support

Owner role: API contract plus backend/semantic-store.

Objective: Add relationship assertion export rows to existing export preview/create flows with regulated export completeness.

Dependencies: B7.

Rules:
- Export is read-only over released/authorized rows.
- Rows must include `id`, `tenant_id`, `environment`, `release_id`, `provenance_id`, `artifact_hash`, `license_status`, `license_classification`, `license_policy_id`, source/target source-version fields, evidence refs, audit event IDs, and content hashes.
- `model_suggested`, blocked-license, pending-review, PHI/PII-prohibited, and unauthorized release rows must be filtered or rejected by the existing authorization/export boundary.

### B9. Search And Workbench Integration

Owner role: frontend plus API contract.

Objective: Surface relationship assertions through existing search/entity-detail patterns without building full Phase C path UX.

Dependencies: B3, B4.

Deliverables:
- Relationship rows indexed with object type `relationship`.
- Entity detail `relationships` section populated from authorized RelationshipAssertion rows.
- Evidence and explanation hooks use assertion IDs and provenance IDs consistently.

### B10. Fixtures And Unit Tests

Owner role: QA.

Objective: Add targeted fixtures and tests that verify Phase B write/read/workflow behavior and preserve all Phase A gates.

Dependencies: B1 through B8 as each lands.

Minimum fixture set:
- Valid draft RelationshipAssertion.
- Valid approved/released RelationshipAssertion.
- `model_suggested` direct release attempt.
- Safety assertion missing causal/limitation metadata.
- Relationship class/predicate matrix violation.
- Literal `relationshipPredicate`, blank-node `relationshipPredicate`, and collection `relationshipPredicate`.
- Missing evidence.
- Blocked assertion without rationale.
- Released assertion with blocked/pending license.
- Released assertion missing reviewer, release ID, validation report ID, source version, or export authorization.

### B11. Red-Team Pass

Owner role: red-team.

Objective: Attempt bypasses across API, workflow, release, export, and search to prove Phase A enforcement cannot be avoided.

Dependencies: B4 through B10.

Scenarios:
- Raw API patch changes released state after validation.
- Workflow approval with `model_suggested`.
- Import path inserts Turtle directly.
- Relationship predicate uses a literal/blank/collection object.
- Safety assertion uses causal language without required warnings.
- License status changes after approval but before export.
- Entity relationships endpoint leaks restricted/unreleased rows.
- Export includes working graph or unauthorized release rows.

## Data Model Sketch

RelationshipAssertion persists as both a contract-shaped JSON object at the API boundary and a governed RDF assertion in the tenant working relationship graph.

Canonical JSON fields:
- Identity and scope: `schema_version`, `relationship_assertion_id`, `tenant_id`, `environment`.
- Edge: `source_entity_id`, `target_entity_id`, `predicate`, `relationship_class`, `secondary_relationship_tags`, `directionality`, `polarity`.
- Governance: `assertion_type`, `review_status`, `reviewed_by`, `reviewed_at`, `causal_claim_status`, `blocked_rationale`.
- Evidence and lineage: `evidence_refs`, `source_record_ids`, `source_names`, `source_versions`, `known_limitations`, `warnings`.
- Confidence: `confidence.confidence_score`, `confidence.confidence_band`, `confidence.confidence_source`, `calibration_id`, `fabricated=false`, rationale.
- Release and license: `release_context`, `data_license`, `validation_report_ids`.
- Provenance: `created_by`, timestamps, `provenance_id`, `provenance.audit_event_id`.

RDF/Turtle shape:
- Subject IRI: tenant-scoped relationship assertion IRI, for example `/tenant/{tenantId}/relationship/{relationship_assertion_id}`.
- Type: `pharm:RelationshipAssertion`.
- IRI objects: source entity, target entity, relationship predicate, evidence refs, relationship warnings where the ontology expects IRI nodes.
- Literal objects: canonical IDs, class, assertion type, directionality, polarity, review status, confidence, license, release, source-version, and provenance fields.
- Provenance as either a nested `pharm:ProvenanceRecord` blank node or a tenant-scoped provenance IRI, but either choice must still pass Phase A term-shape guards.

Storage sequence:
1. Validate JSON contract.
2. Enforce service invariants that are easier to express outside SHACL, such as graph tenant, graph family, workflow transition, and actor role.
3. Materialize Turtle.
4. Run `validateSemanticTurtle` through `ShaclRunner.validateTurtle`.
5. Persist only after validation succeeds.
6. Emit audit event after persistence succeeds, or emit a rejected validation event if the audit design requires failure audit.

## API Surface Sketch

The service-level API should be dependency-injected like `Phase5WorkbenchApi`, with resolvers/stores supplied by composition rather than hidden globals.

Proposed methods:
- `createRelationshipAssertion({ principal, assertion })`
- `getRelationshipAssertion({ principal, relationshipAssertionId, request })`
- `patchRelationshipAssertion({ principal, relationshipAssertionId, patch })`
- `listEntityRelationships({ principal, entityId, request })`
- `submitRelationshipAssertion({ principal, relationshipAssertionId })`
- `approveRelationshipAssertion({ principal, relationshipAssertionId, decision })`
- `rejectRelationshipAssertion({ principal, relationshipAssertionId, decision })`
- `deprecateRelationshipAssertion({ principal, relationshipAssertionId, decision })`

Each mutating method must:
- Assert principal tenant/environment.
- Enforce role/action permission.
- Load current state for transition-sensitive operations.
- Build the next full assertion object.
- Re-run contract validation and `validateSemanticTurtle`.
- Persist through `RelationshipAssertionStore`.
- Emit audit metadata.

Each read method must:
- Resolve candidate rows.
- Use `executeAuthorizedQuery` or the lower-level `filterAuthorizedResults` boundary.
- Return `authorization_filtered: true`.
- Preserve evidence/provenance references so explanation and export services do not need unsafe secondary lookups.

## Phase A Enforcement Dependency

Phase B must preserve every Phase A gate:
- Relationship class enum and class-to-predicate matrix.
- Causal claim status requirements and blocked overclaim handling.
- Safety relationship warnings and limitation metadata.
- Literal governance field node-kind checks.
- IRI governance field node-kind checks, including `pharm:relationshipPredicate`.
- Released assertion requirements for review, release context, validation reports, license, and export authorization.
- Direct release block for `assertion_type=model_suggested`.
- No mapping assertion/relationship assertion collapse.

Implementation rule: any code path that creates or mutates a RelationshipAssertion must materialize the complete candidate Turtle and call `validateSemanticTurtle` before commit. Partial validation, schema-only validation, and direct graph writes are not acceptable Phase B write paths.

## Test And Red-Team Strategy

Test layers:
- Contract unit tests for valid/invalid RelationshipAssertion JSON.
- Semantic-store unit tests using fake Fuseki clients to assert no insert happens on validation failure.
- SHACL fixture tests for every Phase A gate that Phase B depends on.
- API tests for RBAC, tenant/environment mismatch, authorization-filter application, and response shape.
- Workflow tests for allowed and disallowed review transitions.
- Release/export tests for regulated completeness and filtered unauthorized rows.
- Search/workbench integration tests for entity relationship listing and evidence/provenance passthrough.

Required regression assertions:
- A genuine IRI `evidence_support + pharmrel:exactMatch` still fails the class/predicate matrix.
- Non-IRI `relationshipPredicate` fails before it can evade the matrix.
- Released `model_suggested` fails through contract validation and SHACL-backed write validation.
- Released assertions with blocked license, missing reviewer, missing release ID, missing validation report, or missing source versions fail closed.
- Safety/causal-sensitive assertions without causal status or limitations fail.
- API reads and exports show `authorization_filtered: true`.

Red-team exit criteria:
- No direct raw Turtle or direct JSON persistence path can create or mutate a relationship assertion without Phase A validation.
- No workflow transition can move unsafe, model-suggested, unreviewed, unlicensed, or evidence-empty assertions into released/exportable state.
- No read/export endpoint leaks restricted, unreleased, wrong-tenant, wrong-environment, or unauthorized-release relationship rows.

## Open Design Questions For God

1. Should Phase B implement JSON Schema validation with a dependency such as Ajv, or continue the current package style with hand-written validators?
2. What tenant graph family should be canonical for relationship assertions: `tenantWorkingGraph(tenantId, "relationships")`, a new graph family, or co-location with mappings?
3. Should RelationshipAssertion persistence store JSON sidecars, RDF only, or both RDF plus an API read model?
4. Are any relationship classes allowed to be evidence-free in Phase B, or should all evidence-free attempts fail until a policy exception is explicitly added?
5. Which roles can create, submit, approve, reject, deprecate, release-include, and export relationship assertions?
6. Should evidence attachment after approval automatically demote the assertion to `in_review`, or should it create a new version/superseding assertion?
7. Should failed validation attempts emit audit events in Phase B, or only successful state changes?
8. What is the canonical artifact-hash calculation for relationship assertion export rows: JSON canonicalization, Turtle canonicalization, or existing export row canonicalization?
9. Should `GET /entities/{id}/relationships` include working assertions for authorized internal roles by default, or require an explicit working-scope flag?
10. Should Phase B include a minimal release-inclusion implementation now, or define release inclusion as an adapter consumed by the existing release manager in the next implementation slice?
