# PharmaOps Provenance Package

Task:
Implement shared provenance and evidence schemas for Phase 1 Semantic Spine.

Assumptions:
- JSON Schema is the first concrete contract format for Phase 1. RDF/SHACL shapes can be generated or aligned from these contracts later.
- These schemas are shared data contracts for connectors, normalization, mapping registry, AI suggestions, workflow, release packages, APIs, search explanations, and validation evidence.
- Schema fields intentionally mirror Phase 0 governance documents instead of re-deciding class, predicate, license, audit, and release policy.

Inputs Reviewed:
- `pharmaops_multi_agent_exportable_prompt.md` Agent 7 and section 16.
- `ARCHITECTURE.md` package layout, named graph, object storage, audit, and release snapshot policy.
- `DOMAIN_MODEL.md` entity, mapping assertion, relationship assertion, assertion type, lifecycle, and SHACL shape catalog.
- `VOCABULARY_POLICY.md` mapping object, evidence IDs, namespace, source/target version pins, license fields, and release blockers.
- `DATA_LICENSE_REGISTER.md` license classification, materialization, sensitivity, retention, AI-use, and disclaimer fields.
- `SECURITY_MODEL.md` audit event list, tenant isolation, authorization dimensions, and audit schema.
- `VALIDATION_PLAN.md` release gates, evidence package, source-version pins, approval traceability, audit requirements, and rollback evidence.

Changes Proposed:
- Use `schemas/provenance.schema.json` as the common PROV-style trace object.
- Use `schemas/evidence.schema.json` as the evidence object model for source records, documents, text spans, snippets, and source limitations.
- Use `schemas/assertion-evidence-link.schema.json` to bind governed assertions to minimum evidence and provenance.
- Use `schemas/audit-event.schema.json` as the audit-event schema stub aligned with security and validation requirements.

Artifacts Created or Modified:
- `packages/provenance/README.md`
- `packages/provenance/schemas/provenance.schema.json`
- `packages/provenance/schemas/evidence.schema.json`
- `packages/provenance/schemas/assertion-evidence-link.schema.json`
- `packages/provenance/schemas/audit-event.schema.json`
- `PROVENANCE.md`

Interfaces Affected:
- Connector universal output.
- Normalization candidate payloads.
- Mapping and relationship assertion contracts.
- Evidence API and search explanation payloads.
- AI suggestion payloads.
- Workflow approval and audit events.
- Release package validation and export contracts.

Tests Added or Required:
- JSON Schema validation tests for all four schemas.
- SHACL alignment tests once Kevin creates provenance/evidence SHACL shapes.
- Connector fixture tests asserting every candidate has `provenance_id` and evidence linkage where required.
- Mapping/relationship release validation tests rejecting assertions without complete provenance and minimum evidence.
- Search/API contract tests proving evidence snippets, disclaimers, confidence, source version, release ID, and access restrictions are preserved.

Security Impact:
- Schemas carry tenant, environment, release, license, sensitivity, disclaimer, and audit references needed for backend authorization and safe search/export filtering.

Compliance Impact:
- Schemas make missing provenance, missing evidence, missing source version, missing audit references, and missing disclaimer metadata testable release blockers.

Data and Provenance Impact:
- Every assertion, mapping, suggestion, workflow action, release artifact, export row, and evidence object can trace to actor, activity, source, time, method, confidence, environment, and release context.

Risks:
- JSON Schema alone does not validate RDF graph semantics; SHACL shapes must enforce graph constraints in Phase 1.
- Some sources may not provide formal versions; the schema permits retrieval timestamp and snapshot hash but validation must require one approved version strategy.

Open Questions:
- Whether these schemas become generated TypeScript/Python types or stay as JSON Schema source-of-truth.
- Which fields Kevin will mirror exactly in provenance SHACL shapes versus derive from RDF predicates.

Handoff To:
- Kevin: create provenance/evidence SHACL shapes matching these required fields.
- Angela: align mapping `provenance` and `evidence_ids` fields with `provenance_id`, `evidence_id`, and license/disclaimer metadata here.
- Security/Workflow: refine `audit-event.schema.json` as audit service design matures.
- QA: add schema validation fixtures and negative tests.

Definition of Done Status:
- Phase 1 provenance/evidence schema draft complete. JSON validity verified locally.

