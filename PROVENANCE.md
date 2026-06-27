# PROVENANCE.md

Task:
Define Phase 1 assertion-to-evidence linkage and minimum evidence rules for PharmaOps semantic spine.

Assumptions:
- `packages/provenance/schemas/` is the concrete Phase 1 contract source for provenance, evidence, assertion-evidence links, and audit-event stubs.
- RDF/SHACL implementation must preserve the same required fields even if predicate names differ in RDF.
- Evidence can be direct source evidence, validation evidence, approval evidence, or administrative lifecycle evidence, but every released assertion must have traceable provenance.

Inputs Reviewed:
- `ARCHITECTURE.md`
- `DOMAIN_MODEL.md`
- `VOCABULARY_POLICY.md`
- `DATA_LICENSE_REGISTER.md`
- `SECURITY_MODEL.md`
- `VALIDATION_PLAN.md`
- `pharmaops_multi_agent_exportable_prompt.md` Agent 7 and section 16.

Changes Proposed:
- Treat provenance as a mandatory object linked from every governed semantic object.
- Treat evidence as a separate addressable object with source, version, artifact, span/snippet, confidence, license, disclaimer, and access-control metadata.
- Define assertion-to-evidence minimums by assertion type.

Artifacts Created or Modified:
- `PROVENANCE.md`
- `packages/provenance/`

Interfaces Affected:
- Connector output, normalization candidates, mapping registry, relationship assertions, AI suggestions, workflow approvals, release packages, search explanations, APIs, exports, validation, and audit.

Tests Added or Required:
- Schema validation tests for the JSON Schemas.
- Negative tests that reject released mappings and relationships missing provenance, evidence, source version, confidence, or required disclaimer metadata.
- SHACL tests mirroring minimum evidence rules.

Security Impact:
- Provenance and evidence objects carry tenant, environment, source license, sensitivity, access-control, and disclaimer metadata required for safe API, search, and export filtering.

Compliance Impact:
- Assertions without provenance are release blockers. Evidence exceptions must use policy IDs, accountable owners, rationale, and audit events.

Data and Provenance Impact:
- Every released assertion must answer: who/what created it, what activity created it, what source/version supports it, when it happened, what method was used, what confidence applies, what environment produced it, and what release contains it.

Risks:
- Minimum evidence rules must not become a loophole for model-suggested claims; AI confidence is never approval.

Open Questions:
- Whether validation report and approval record evidence should become RDF evidence objects or remain operational records linked by ID in Phase 1.

Handoff To:
- Kevin for provenance/evidence SHACL shapes.
- Angela for mapping provenance and evidence field alignment.
- QA for schema and negative validation tests.
- Security/Workflow for audit event refinement.

Definition of Done Status:
- Phase 1 provenance note complete.

## Assertion-To-Evidence Linkage

Every governed assertion stores:

- `assertion_id`
- `assertion_kind`
- `assertion_type`
- `subject_id`
- `predicate`
- `object_id` where applicable
- `evidence_refs[]`
- `provenance_id`
- `confidence`
- `validation_status`
- `release_id` when released

`evidence_refs[]` points to addressable evidence objects by `evidence_id`. Evidence objects preserve source name, source version, source record ID, raw artifact or pointer URI, text spans, snippet, confidence, license classification, disclaimer IDs, tenant access controls, and provenance.

`provenance_id` points to a PROV-style object containing actor, activity, source, time, method, confidence, environment, release, and audit references.

## Minimum Evidence By Assertion Type

| Assertion type | Minimum evidence | Release rule |
|---|---|---|
| `asserted` | Source record or document evidence with source name, source version, source record ID, artifact/pointer, timestamp, and provenance | Release eligible only after validation and review gates pass |
| `imported` | Connector source record evidence, connector run provenance, raw artifact or approved pointer, source-version pin, record hash, and license classification | Not local endorsement until reviewed; release requires approval where policy requires |
| `inferred` | Inference rule ID/version, input assertion IDs, input provenance IDs, execution timestamp, and validation result | Must show derivation path and cannot hide source evidence of inputs |
| `human_curated` | Reviewer or curator actor, role, rationale, timestamp, supporting evidence, review decision, and audit event ID | Release eligible only with required approval trace |
| `model_suggested` | Model name/version, prompt or policy version, source spans or fields, confidence score, rationale, and suggestion provenance | Never release directly; must become a governed proposal and pass human or approved policy review |
| `deprecated` | Deprecation reason, actor, timestamp, affected release, successor link where applicable, and audit event ID | Retained for traceability; not active released fact unless release context is historical |

## Special Rules

- Mapping assertions require source vocabulary version, target vocabulary version, source/target license policy status, evidence, confidence, and provenance.
- Relationship assertions require subject, predicate, object, assertion type, confidence, evidence or a documented evidence-policy exception, provenance, lifecycle status, and release membership.
- Product/adverse-event relationships require source limitations and non-causal safety disclaimers when based on FAERS/openFDA-like sources.
- Licensed-source evidence may use pointer-only evidence when materialization is not permitted, but the pointer must preserve source, version, reviewer entitlement, policy ID, and audit event.
- Structural release assertions may use validation reports, artifact hashes, release manifests, and approval records as evidence.
- No evidence exception may justify a scientific, clinical, safety, efficacy, or mapping claim without source-backed or review-backed evidence.

## Release Blocking Conditions

Block release when:

- `provenance_id` is missing.
- `evidence_refs` are missing for an assertion type that requires evidence.
- Source name or source version is missing.
- Method or actor is missing.
- Confidence metadata is missing where required.
- License classification or disclaimer metadata is missing for restricted or disclaimer-bound evidence.
- AI/model output is shown as approved fact.
- Safety data is presented as causal without approved evidence and disclaimers.
- Required audit event IDs are missing for regulated workflow actions.

