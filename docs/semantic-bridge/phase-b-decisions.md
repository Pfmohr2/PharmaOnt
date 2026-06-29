# Semantic Bridge Phase B — God Decisions on Open Design Questions

Status: orchestrator rulings on the 10 open questions in `phase-b-plan.md`. These are binding for Phase B implementation. They follow the Phase A precedent (adopt vetted tooling; fail-safe defaults; no bypass of server-side authz/audit/release/export gates).

1. **Validator: adopt Ajv (JSON Schema), not a new hand-written validator.**
   The relationship-assertion JSON Schema is the single source of truth; compile it with Ajv to avoid the hand-rolled-validator drift class (same reasoning that drove the Phase A N3.js adoption). Service-level invariants not expressible in JSON Schema (tenant graph, graph family, workflow transitions, actor role) stay in code. Schema and validator must not diverge — a test asserts the exported validator is compiled from `docs/semantic-bridge/contracts/relationship-assertion.schema.json`.

2. **Graph family: dedicated `tenantWorkingGraph(tenantId, "relationships")`.**
   Do NOT co-locate with mappings. A dedicated relationship graph family keeps authz-filter/export scoping clean and prevents cross-object contamination.
   Relationship graph write authority is not a token, singleton, getter, or register function. It is minted only inside the named-graph policy module closure and captured in a `RelationshipAssertionStore` instance created by `createGovernedRelationshipAssertionStore`.

3. **Persistence: RDF is canonical; derive an API read model from it.**
   The governed RDF assertion (which must pass `validateSemanticTurtle`) is the source of truth. The API read model is DERIVED from the RDF/persistence, never an independent write path. No JSON sidecar that can drift from the validated graph.
   Direct construction of relationship persistence must use `createGovernedRelationshipAssertionStore`; direct `FusekiClient` writes and caller-supplied relationship graph capabilities remain rejected by the central graph policy before persistence.

4. **Evidence-free assertions: NOT allowed in Phase B.**
   Fail-safe default — every evidence-free attempt fails validation. An exception requires an explicit, separately god-approved policy entry; until then, no class is evidence-free.

5. **Role matrix (uses EXISTING role classes — no new broad roles; step-up required on sensitive actions):**
   - create / submit: relationship curator/editor role (tenant + environment scoped).
   - approve / reject: reviewer role; safety or `causal_sensitive` assertions require the causal-safety approver class (andy's domain) — a general reviewer may NOT approve causal/safety assertions.
   - deprecate: reviewer or steward role.
   - release-include: release manager role only.
   - export: export-authorized role only, gated by the existing source-license export packet (gate #3).
   - **Step-up auth required** for approve, release-include, and export. No SSO-claim/group→role grant. No service-account performs approve/release/export. All create/approve/reject/deprecate/release/export/denial events auditable.

6. **Evidence change after approval: demote to `in_review` (re-review required).**
   No silent post-approval evidence swap. Changing `evidence_refs` on an approved/released-eligible assertion demotes it to `in_review` and clears reviewer identity/timestamp until re-approved. (Full superseding-version model is deferred to a later slice.)

7. **Failed validation: emit audit events.**
   Yes — failed-validation and denied-transition attempts emit audit events, consistent with "all denial/step-up events auditable." Bypass attempts must be visible.

8. **Artifact-hash: reuse the existing export-row canonicalization.**
   Do NOT invent a new hashing scheme. Relationship export rows hash via the same canonicalization the existing export pipeline (gate #3) uses, so hashes are consistent across the export surface.

9. **`GET /entities/{id}/relationships` default scope: authorized released rows only.**
   Working/unreleased rows require BOTH an explicit working-scope flag AND the caller's authorization to see them. Default is fail-safe: no working rows unless explicitly requested by an authorized internal role.

10. **Release inclusion: implement now as an adapter into the EXISTING release manager.**
   Not a parallel release path. Minimal eligibility gate + adapter that re-runs `validateSemanticTurtle` on the release-bound materialization (never trusting a prior working-graph validation) and admits only released-eligible assertions. Wire into the existing release manager rather than duplicating release logic.
   Release-bound relationship graph writes use the same closure-captured store authority; no exported registration or stack/name-based gate may grant relationship graph write authority.

## Cross-cutting rule (restates Phase A)
Every create/mutate path materializes the COMPLETE candidate Turtle and calls `validateSemanticTurtle` before commit. Partial validation, schema-only validation, and direct graph writes are not acceptable Phase B write paths. No API/workflow/import/release/export bypass around the Phase A SHACL runner.
