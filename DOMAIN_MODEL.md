# DOMAIN_MODEL.md

## Task

Define the initial PharmaOps governed domain model for Phase 0. This document covers the MVP semantic classes, lifecycle states, assertion types, core predicates, validation shape catalog, provenance expectations, release implications, and downstream API contract implications for the regulated semantic control plane.

## Assumptions

- This is a Phase 0 governance artifact, not the final OWL/SHACL implementation.
- The MVP prioritizes compounds, targets, diseases/conditions, trials, products/drugs, adverse events, documents/evidence, vocabulary terms, mappings, relationships, and release artifacts.
- Biomarker, endpoint, and organization/sponsor are modeled now because they are listed in the master prompt, but are marked P1 unless needed as references from required MVP entities.
- God ratified Red Team follow-up DM-RT-001: the master prompt's Agent 5 table is source of truth with 14 rows. `Mapping assertion`, `Relationship assertion`, and `Release artifact` are governed objects, not canonical biomedical entity classes like `Compound` or `Disease / condition`.
- All regulated semantic assertions require provenance, source/version context, lifecycle status, evidence where applicable, and release membership before publication.

## Inputs Reviewed

- `pharmaops_multi_agent_exportable_prompt.md` sections 1, 2, 4, 6.1, 6.2, 6.3, Agent 5, 9 Phase 0, 10.1, 10.2, 10.3, 11.2, and acceptance scenarios 4, 6, and 7.
- `hive/board.md` Phase 0 assignment for P0-03.
- `hive/tasks.json` P0-03 acceptance criteria.

## Changes Proposed

- Establish the initial domain model as the Phase 0 contract for later OWL/RDF modules, SHACL shapes, API payloads, workflow states, and release validation.
- Treat mappings and relationships as governed assertion objects rather than simple edges.
- Keep P1 entity classes visible but constrained to prevent MVP scope expansion.

## Artifacts Created or Modified

- Created `DOMAIN_MODEL.md`.

## Interfaces Affected

- RDF/OWL ontology modules under future `ontologies/core/`.
- SHACL shape modules under future `ontologies/shapes/`.
- Entity profile API.
- Mapping registry API.
- Relationship explanation payloads.
- Validation and release pipeline.
- Search index documents and explainability payloads.
- Workflow service state transitions.
- Audit and provenance contracts.

## Tests Added or Required

- No executable tests were added in Phase 0.
- Required in Phase 1:
  - Ontology syntax validation for class and predicate modules.
  - SHACL validation fixtures for each required shape listed here.
  - State transition tests for lifecycle rules.
  - Mapping completeness validation, including source and target vocabulary versions.
  - Provenance coverage validation for every assertion.
  - API contract tests for entity profile, mapping, relationship, and release payloads.

## Security Impact

- This model requires backend-enforced lifecycle transitions and release membership.
- Mutating actions on entities, mappings, relationships, and releases must be role-gated by the Security Model.
- Search/API responses must include only records visible to the caller's tenant, source entitlements, release scope, and role permissions.
- AI suggestions must remain separate from approved facts in storage, API responses, and UI.

## Compliance Impact

- Release promotion must be blocked by critical SHACL failures, missing provenance, incomplete mapping versions, missing audit events, or missing release evidence.
- Safety-related adverse event relationships must not imply causality or incidence without approved evidence and appropriate disclaimers.
- Released artifacts must retain changelog, artifact hashes, validation evidence, source-version pins, approval records, and rollback target.

## Data and Provenance Impact

- Every entity, mapping assertion, relationship assertion, evidence link, lifecycle transition, and release artifact needs provenance.
- Provenance must identify source system or user/service actor, source artifact or record, source version, timestamp, evidence reference, transformation or curation method, validation result, and release context.
- Assertions without provenance are invalid for release.

## Risks

- The entity-class count mismatch between task acceptance and master prompt can confuse reviewers. This artifact includes all master-prompt rows and flags the mismatch as an open question.
- P1 classes can create MVP bloat if used as full workspaces too early. This model allows references only until Phase 1/2 scope explicitly expands.
- Predicate names are intentionally pragmatic and product-facing; later OWL/RDF implementation must align them with namespace and CURIE policy from `VOCABULARY_POLICY.md`.

## Open Questions

- Should `Target / gene / protein` remain one polymorphic class in MVP, or split into `Target`, `Gene`, and `Protein` subclasses in Phase 1 ontology modules?
- Which controlled vocabularies are mandatory in MVP per entity type after Standards & Mapping finishes `VOCABULARY_POLICY.md`?

## Handoff To

- Standards & Mapping Agent: align class IDs, predicate names, namespaces, CURIE/IRI rules, and mapping predicates.
- QA Agent: turn the SHACL catalog into ontology and API contract tests.
- Compliance & Validation Agent: align lifecycle and release blocking rules with validation gates.
- Security & Identity Agent: align lifecycle transitions with RBAC permissions and audit events.
- Red Team: review for scope bloat, unsafe semantic claims, provenance gaps, and release-gate bypasses.

## Definition of Done Status

P0-03 draft complete for Phase 0 review. The document enumerates all master-prompt entity classes with MVP/P1 status, all 12 lifecycle states, all 6 assertion types, all 12 core predicates, and the required SHACL shape catalog with constraints.

---

# 1. Modeling Scope

PharmaOps models governed scientific meaning, not every operational record. The semantic core should represent canonical entities, controlled terms, evidence, mappings, relationships, provenance, and release state. Operational workflow details, comments, queues, jobs, and permissions belong primarily in PostgreSQL-backed services, but must link to semantic objects through stable IDs and audit events.

The model has three layers:

| Layer | Purpose | Examples |
|---|---|---|
| Canonical entity layer | Stable governed concepts users search, curate, and release | Compound, disease, trial, product, adverse event |
| Assertion layer | Reviewable claims about identity, mapping, relationship, evidence, or lifecycle | Mapping assertion, relationship assertion, synonym assertion |
| Release layer | Immutable published semantic state and rollback target | Release artifact, release membership, validation report reference |

MVP implementation should avoid broad ontology editing features. Users should work with product concepts: search, compare, propose, approve, validate, release, export, and audit.

# 2. Entity Classes

Common required fields for canonical entity-like objects:

- `canonical_id`: stable PharmaOps CURIE or IRI.
- `entity_type`: controlled class value.
- `preferred_label`: human-readable label.
- `synonyms`: zero or more synonym assertion references.
- `definition`: optional for MVP, required before release when a class-specific policy requires it.
- `external_ids`: identifiers with vocabulary, value, vocabulary version where applicable, and provenance.
- `mappings`: mapping assertion references.
- `relationships`: relationship assertion references.
- `evidence`: evidence references supporting claims.
- `provenance`: source, actor/service, method, timestamp, source version, and audit references.
- `lifecycle_status`: one of the states in section 3.
- `release_membership`: working graph, staged release candidate, or released artifact references.

Acceptance reporting note: per DM-RT-001, the table below keeps all 14 required Agent 5 rows. The first 11 rows are canonical semantic objects or reference terms; the final 3 rows, `Mapping assertion`, `Relationship assertion`, and `Release artifact`, are governed objects that carry semantic claims, validation state, release state, and audit/provenance obligations.

| Class | MVP status | Purpose | Minimum required fields | Provenance expectation | Downstream API implications |
|---|---|---|---|---|---|
| Compound | Required | Canonical chemical or biological compound relevant to R&D, trials, products, or evidence. | `canonical_id`, `preferred_label`, `external_ids`, `lifecycle_status`, `provenance` | Source identifiers from ChEMBL/internal sources; curation provenance for preferred label and mappings. | Entity profile must support identifier lookup, target relationships, product links, evidence links, and released export. |
| Target / gene / protein | Required | Canonical biological target, gene, or protein used in compound, disease, biomarker, and evidence relationships. | `canonical_id`, `preferred_label`, `target_kind`, `external_ids`, `lifecycle_status`, `provenance` | UniProt/gene-source version, imported or curated target-kind provenance. | API must expose target lookup, disease associations, compound links, and synonym-expanded search. |
| Disease / condition | Required | Canonical disease, indication, condition, or clinical condition concept. | `canonical_id`, `preferred_label`, `external_ids`, `lifecycle_status`, `provenance` | Source vocabulary and version for disease identifiers and labels. | Search and entity profile must support trial, target, biomarker, and evidence pivots. |
| Trial | Required | Canonical clinical trial or study record. | `canonical_id`, `preferred_label`, `trial_identifier`, `external_ids`, `lifecycle_status`, `provenance` | ClinicalTrials.gov snapshot/version and import run provenance. | API must expose studied conditions, interventions, endpoints, sponsors if available, evidence links, and source record trace. |
| Product / drug | Required | Canonical product, approved drug, marketed product, or regulated product label concept. | `canonical_id`, `preferred_label`, `external_ids`, `lifecycle_status`, `provenance` | Product source/version and label/source evidence provenance. | Safety and search APIs must support adverse event relationships with disclaimers and source limitations. |
| Adverse event | Required | Canonical safety event or adverse reaction term. | `canonical_id`, `preferred_label`, `external_ids`, `lifecycle_status`, `provenance` | MedDRA or source-term version where licensed use is approved; otherwise source-aware restricted metadata. | API/search must avoid causal language unless relationship assertion has approved evidence type and disclaimer metadata. |
| Biomarker | P1 | Biomarker concept used in disease, trial, endpoint, and evidence contexts. | `canonical_id`, `preferred_label`, `external_ids`, `lifecycle_status`, `provenance` | Source and evidence provenance for biomarker use context. | MVP may reference biomarkers from evidence; full workspace is P1. |
| Endpoint | P1 | Clinical or study endpoint term. | `canonical_id`, `preferred_label`, `endpoint_kind`, `external_ids`, `lifecycle_status`, `provenance` | Trial/source version and curation provenance. | MVP may show endpoint labels on trials; full endpoint governance is P1. |
| Organization / sponsor | P1 | Sponsor, institution, manufacturer, or source organization. | `canonical_id`, `preferred_label`, `organization_kind`, `external_ids`, `lifecycle_status`, `provenance` | Source record and normalization provenance. | MVP may expose sponsor fields from trial/product records; full organization dedupe is P1. |
| Document / evidence source | Required | Evidence-bearing document, source record, article, label, trial record, dataset row, or raw artifact reference. | `canonical_id`, `preferred_label`, `source_name`, `source_version`, `artifact_uri`, `lifecycle_status`, `provenance` | Raw artifact persistence, checksum, source version, ingestion job, and parser method. | Evidence APIs must return source citation, evidence spans or record fields, source version, access restrictions, and release context. |
| Vocabulary term | Required | Controlled term from internal or external vocabulary. | `canonical_id`, `preferred_label`, `vocabulary`, `vocabulary_version`, `term_id`, `lifecycle_status`, `provenance` | Vocabulary source, version pin, import or curation method. | Identifier and mapping APIs must filter by vocabulary, version, term status, and release. |
| Mapping assertion | Required | Governed claim that a source term/entity maps to a target term/entity under a predicate. | `mapping_id`, `source`, `target`, `predicate`, `source_vocabulary_version`, `target_vocabulary_version`, `confidence`, `evidence`, `review_status`, `lifecycle_status`, `provenance` | Mapping creator/importer, evidence, source and target versions, reviewer when approved. | Mapping API must query by source, target, predicate, vocabulary, version, status, and release. |
| Relationship assertion | Required | Governed claim connecting two semantic objects with evidence, confidence, assertion type, and release context. | `relationship_id`, `subject`, `predicate`, `object`, `assertion_type`, `confidence`, `evidence`, `lifecycle_status`, `provenance` | Source/evidence provenance and actor/service provenance for generated or curated claims. | Entity profile and search explainability must show relationship status, confidence, evidence, provenance, and release ID. |
| Release artifact | Required | Immutable package representing a versioned semantic release or rollback target. | `release_id`, `version`, `included_graphs`, `source_version_pins`, `validation_report`, `changelog`, `artifact_hashes`, `approval_records`, `created_at`, `lifecycle_status`, `provenance` | Release manager/compliance approvals, validation execution, artifact checksums, rollback metadata. | Export/API must identify active release, release contents, validation status, hashes, and rollback lineage. |

## 2.1 Entity Examples

These examples are illustrative and intentionally non-authoritative. They show object shape, not approved biomedical claims.

| Class | Example |
|---|---|
| Compound | `PHARM:compound/chembl-CHEMBL25` with preferred label "Aspirin" and external ID `ChEMBL:CHEMBL25`. |
| Target / gene / protein | `PHARM:target/uniprot-P12345` with target kind `protein` and UniProt source-version provenance. |
| Disease / condition | `PHARM:disease/mesh-D012345` with preferred label from a pinned disease vocabulary version. |
| Trial | `PHARM:trial/NCT00000000` imported from a ClinicalTrials.gov snapshot. |
| Product / drug | `PHARM:product/openfda-application-ANDA000000` with product label evidence. |
| Adverse event | `PHARM:adverse-event/source-term-headache` with source-aware MedDRA mapping status where licensed use permits. |
| Biomarker | `PHARM:biomarker/example-biomarker` as P1/reference-only in MVP unless explicitly scoped. |
| Endpoint | `PHARM:endpoint/example-primary-endpoint` as P1/reference-only in MVP unless explicitly scoped. |
| Organization / sponsor | `PHARM:organization/example-sponsor` as P1/reference-only in MVP unless explicitly scoped. |
| Document / evidence source | `PHARM:evidence/pubmed-00000000` with artifact URI, checksum, source name, and source version. |
| Vocabulary term | `MESH:D012345` represented as a vocabulary term with vocabulary and version. |
| Mapping assertion | `PHARM:mapping/000001` mapping a source term to a target standard term with predicate, confidence, versions, and reviewer status. |
| Relationship assertion | `PHARM:relationship/000001` connecting a compound and target with assertion type, evidence, confidence, and provenance. |
| Release artifact | `PHARM:release/v0.1.0-rc1` with included graph IDs, validation report, hashes, approvals, and rollback target. |

# 3. Lifecycle States

Lifecycle states apply to entities, mappings, relationship assertions, and release artifacts unless a narrower object-specific policy overrides them.

| State | Meaning | Allowed next states | Release eligibility |
|---|---|---|---|
| `draft` | Work-in-progress object not ready for validation. | `proposed`, `rejected` | Not eligible |
| `proposed` | Submitted for validation or review. | `validated`, `revision_requested`, `rejected` | Not eligible |
| `validated` | Automated validation passed. | `in_review`, `revision_requested`, `rejected` | Not eligible |
| `in_review` | Human or policy review is active. | `approved`, `revision_requested`, `rejected` | Not eligible |
| `revision_requested` | Reviewer requested changes. | `draft`, `proposed`, `rejected` | Not eligible |
| `approved` | Required review has approved the object. | `staged`, `deprecated`, `superseded` | Eligible for staging |
| `staged` | Included in a release candidate. | `released`, `revision_requested`, `rolled_back` | Candidate only |
| `released` | Published in immutable release artifact. | `deprecated`, `superseded`, `rolled_back` | Active/released |
| `deprecated` | Still resolvable but discouraged. | `superseded` | Released only with deprecation metadata |
| `superseded` | Replaced by a specified successor. | None, except administrative correction | Released only with successor link |
| `rejected` | Not accepted for governance. | None, except clone to new `draft` | Not eligible |
| `rolled_back` | Removed from active release by rollback while retained in audit history. | None, except new proposal | Not active |

Transition constraints:

- `released` objects are immutable in-place. Changes require a new proposal and a new release.
- `deprecated` requires deprecation reason, effective release, actor, timestamp, and evidence or policy rationale.
- `superseded` requires one or more successor entity or assertion references.
- `rolled_back` requires rollback event, actor, rationale, source release, target release, timestamp, and audit event.
- AI-created objects can enter `draft` or `proposed` only as `model_suggested`; they cannot become `approved`, `staged`, or `released` without one of the review routes defined in section 7.1.

# 4. Assertion Types

| Assertion type | Meaning | Typical producer | Minimum evidence/provenance | UI/API handling |
|---|---|---|---|---|
| `asserted` | Direct claim from an authoritative or curated source. | Connector import or curator | Source record/artifact, source version, timestamp, import or curation method. | Can be shown as source-backed; still not approved unless lifecycle allows. |
| `inferred` | Derived by deterministic rules, reasoning, or graph logic. | Reasoner or normalization service | Rule/version, input assertions, execution timestamp, validation result. | Must show derivation path and not blur with direct source claims. |
| `imported` | Loaded from an external source without local semantic endorsement. | Connector import | Source name, source record, source version, ingestion run, checksum if artifact-backed. | Must show source context and may require review before release. |
| `human_curated` | Created or edited by an approved user. | Curator, reviewer, ontology manager | Actor, role, timestamp, rationale, evidence, review decision. | Eligible for approval/release if validation passes. |
| `model_suggested` | Proposed by AI or ML and awaiting review. | AI curation service | Model name/version, prompt/config or pipeline version, evidence spans, confidence, rationale. | Must be visually/API-distinct from approved facts; cannot publish directly. |
| `deprecated` | Historical assertion retained for traceability but no longer recommended. | Curator, release manager, policy process | Deprecation reason, replaced-by link if applicable, actor, release, timestamp. | Search should warn; exports must preserve deprecation metadata. |

# 5. Core Relationship Predicates

Each predicate is represented as a relationship assertion with subject, predicate, object, assertion type, evidence, confidence, lifecycle status, provenance, and release membership.

| Predicate | Subject class | Object class | Purpose | Constraints | Example |
|---|---|---|---|---|---|
| `compound_has_target` | Compound | Target / gene / protein | Links a compound to a biological target. | Requires evidence; confidence required; source must not imply clinical effect by itself. | Compound X `compound_has_target` Target Y |
| `target_associated_with_disease` | Target / gene / protein | Disease / condition | Connects biological target to disease context. | Requires evidence and assertion type; inferred paths must show derivation. | Target Y `target_associated_with_disease` Disease Z |
| `trial_studies_condition` | Trial | Disease / condition | States the condition studied by a trial. | Imported trial source/version required. | Trial NCT00000000 `trial_studies_condition` Disease Z |
| `trial_uses_intervention` | Trial | Compound or Product / drug | Captures trial intervention. | Source trial record required; intervention class must be typed. | Trial A `trial_uses_intervention` Product B |
| `product_has_adverse_event` | Product / drug | Adverse event | Links product to safety event context. | Must include evidence/source and disclaimer metadata; must not imply causality or incidence without approved evidence. | Product B `product_has_adverse_event` Event C |
| `disease_has_biomarker` | Disease / condition | Biomarker | Links disease to biomarker context. | P1 full governance; MVP references require evidence and status. | Disease Z `disease_has_biomarker` Biomarker Q |
| `trial_has_endpoint` | Trial | Endpoint | Links trial to endpoint. | P1 full governance; MVP imported endpoint label requires trial source/version. | Trial A `trial_has_endpoint` Endpoint E |
| `entity_supported_by_evidence` | Any governed entity/assertion | Document / evidence source | Connects semantic object to evidence. | Required for release when class or assertion policy demands evidence. | Relationship R `entity_supported_by_evidence` PubMed Article P |
| `term_maps_to_standard` | Vocabulary term or source term | Vocabulary term or canonical entity | Captures term-to-standard mapping. | Prefer mapping assertion object for governed mappings; requires source/target versions. | Source term S `term_maps_to_standard` Standard term T |
| `entity_supersedes_entity` | Any canonical entity | Same or compatible canonical entity | Captures replacement relationship. | Required when lifecycle is `superseded`; must include rationale and release. | Entity New `entity_supersedes_entity` Entity Old |
| `entity_has_synonym` | Canonical entity | Vocabulary term or literal synonym object | Captures synonym. | Synonym provenance and language/source required when released. | Disease Z `entity_has_synonym` "Example syndrome" |
| `entity_has_external_identifier` | Canonical entity | Identifier object or vocabulary term | Captures external ID. | Identifier format and vocabulary/version validation required. | Compound X `entity_has_external_identifier` ChEMBL:CHEMBL123 |

# 6. Mapping Assertion Contract

Mapping assertions are first-class governed assets. A mapping is valid only when it contains:

- `mapping_id`
- `source_entity_or_term`
- `target_entity_or_term`
- `predicate`
- `source_vocabulary`
- `source_vocabulary_version`
- `target_vocabulary`
- `target_vocabulary_version`
- `confidence`
- `evidence`
- `assertion_type`
- `review_status` or lifecycle status
- `reviewer` when approved
- `provenance`
- `release_membership`

Release blockers:

- Missing source vocabulary version.
- Missing target vocabulary version.
- Missing provenance.
- Missing evidence where policy requires evidence.
- `model_suggested` mapping treated as approved.
- Lifecycle status other than `approved` or `staged` when attempting release inclusion.
- AI confidence, model rationale, or automated normalization confidence used as the only basis for approval.

# 7. Relationship Assertion Contract

Relationship assertions are valid only when they contain:

- `relationship_id`
- `subject`
- `predicate`
- `object`
- `assertion_type`
- `confidence`
- `evidence` or evidence-policy exception
- `provenance`
- `lifecycle_status`
- `release_membership`
- `created_by` or service account
- `created_at`
- `validation_status`

Relationship assertions are not just graph edges. The API and UI must expose evidence, confidence, assertion type, lifecycle status, and provenance. Relationship explanation payloads must distinguish imported, inferred, asserted, human-curated, and model-suggested assertions.

## 7.1 Policy-Approved Review Routes and Evidence Exceptions

This section resolves DM-RT-002. "Policy-approved review" and "evidence-policy exception" are narrow governed routes, not informal discretion. They must be implemented by the future Workflow service and validated by Compliance-owned release gates.

Allowed review routes for regulated publication:

| Route | Allowed for release? | Required controls |
|---|---|---|
| Human domain approval | Yes | Named accountable human approver, role authorization, evidence review, rationale, timestamp, and immutable audit event ID. |
| Human compliance approval | Yes, for regulated release certification and exceptions | Compliance-owned policy ID, named compliance approver, validation evidence reference, rationale, timestamp, and immutable audit event ID. |
| Human release-manager approval | Yes, for staging and promotion after required reviews | Named release manager, release candidate ID, validation report, changelog/hash/source-pin checks, rollback target, timestamp, and audit event ID. |
| Policy-approved service account execution | Only for mechanical workflow actions after human-approved policy allows it | Compliance-owned policy ID, named accountable human policy owner, service account ID, allowed action scope, validation report reference, and audit event ID. Service accounts cannot provide domain judgment. |
| AI/model suggestion | No, not by itself | May create `model_suggested` proposals only. AI confidence, model rationale, embedding similarity, or extraction score alone must never approve, stage, or release a regulated assertion. |
| Deterministic inference or normalization | No, not by itself | May create `inferred` or `imported` candidates with rule/source provenance. Release requires an allowed human or policy-approved service route above. |

Allowed evidence exceptions:

| Exception | Allowed cases | Required controls | Prohibited use |
|---|---|---|---|
| Structural assertion exception | Technical assertions such as release membership, validation report links, artifact hashes, or graph membership where the evidence is the release package or validation artifact itself. | Compliance-owned policy ID, artifact reference, validation report ID, named accountable human owner, and audit event ID. | Cannot justify scientific, clinical, safety, efficacy, or mapping claims. |
| Administrative lifecycle exception | Deprecation, rollback, supersession, or rejection where rationale and audit evidence replace source evidence. | Named human owner, rationale, affected object IDs, before/after lifecycle state, release context if applicable, and audit event ID. | Cannot create a positive biomedical relationship or mapping without evidence. |
| Licensed-source access exception | Evidence exists in restricted licensed material that cannot be materialized or exported. | Data-governance/compliance policy ID, source reference, license classification, reviewer entitlement check, redacted evidence pointer, and audit event ID. | Cannot expose restricted content or downgrade provenance requirements. |

Prohibited exceptions:

- AI-confidence-only approval.
- Model-suggested assertion promoted without named human or compliance-owned policy route.
- Inferred assertion promoted only because its rule executed successfully.
- Evidence omitted because the source is inconvenient to parse.
- Safety product/adverse-event relationship released as causal or incidence-bearing without approved evidence classification, disclaimer metadata, and compliance review.

# 8. SHACL Shape Catalog

This catalog defines the Phase 1 SHACL implementation scope. Shape names are stable placeholders for future `ontologies/shapes/` modules.

| Shape | Applies to | Constraint intent | Provenance expectation | Downstream API implication | Severity |
|---|---|---|---|---|---|
| `EntityRequiredLabelShape` | Canonical entities, vocabulary terms, evidence sources | `preferred_label` exactly 1; non-empty string; language tag where multilingual policy later applies. | Label source or curator must be traceable before release. | Entity profile and search result labels can be treated as display-ready only after validation. | Violation |
| `EntityTypeRequiredShape` | All governed objects | `entity_type` or object type exactly 1; value must be in approved class set. | Type assignment source, inference rule, or curator must be recorded. | API filters, RBAC scopes, workflow routing, and search facets can rely on controlled type values. | Violation |
| `IdentifierFormatShape` | Canonical entities, external identifiers, vocabulary terms | Canonical ID must match PharmaOps CURIE/IRI policy; external IDs must include vocabulary and value; vocabulary version required where applicable. | Identifier source, vocabulary, and vocabulary version must be recorded for source-backed IDs. | Identifier lookup APIs can reject malformed IDs and expose version-pinned external identifiers. | Violation |
| `SourceProvenanceShape` | Entities, mappings, relationships, evidence, releases | Provenance must include actor or service, timestamp, source or method, and source version for imported/source-backed data. | Full provenance object is mandatory; missing provenance blocks release. | Entity, mapping, relationship, export, and search explanation payloads must include provenance references. | Violation |
| `MappingCompletenessShape` | Mapping assertion | Requires source, target, predicate, source vocabulary version, target vocabulary version, confidence, evidence, lifecycle status, provenance, and release membership before release. | Mapping creator/importer, source and target versions, evidence, and reviewer when approved. | Mapping API can query by source, target, predicate, vocabulary, version, status, release, and confidence. | Violation |
| `RelationshipCompletenessShape` | Relationship assertion | Requires subject, predicate, object, assertion type, confidence, lifecycle status, provenance, and evidence or documented exception. | Relationship source, actor/service, evidence references, and generation/curation method. | Entity profile and graph APIs can show relationship explanation, evidence, confidence, assertion type, and release ID. | Violation |
| `LifecycleTransitionShape` | Governed objects | Current and next states must follow section 3 transition table; released objects immutable in-place. | Transition actor/service, role, timestamp, rationale, and audit event. | Workflow APIs can reject illegal transitions and expose current/next allowed actions. | Violation |
| `ReleaseInclusionShape` | Release artifact and included objects | Included objects must be approved/staged, validation-passing, provenance-complete, source-version-pinned, and audit-linked. | Release manager/compliance approvals, validation execution, artifact hashes, changelog, and source pins. | Release/export APIs can expose immutable release contents, validation status, hashes, and rollback target. | Violation |
| `DeprecationSupersessionShape` | Deprecated or superseded entities/assertions | Deprecated requires reason and effective release; superseded requires successor reference and rationale. | Deprecating actor, rationale, effective release, successor link, and audit event. | Search/API can show warnings, redirect users to successors, and preserve historical exports. | Violation |
| `AiSuggestionMetadataShape` | `model_suggested` assertions | Requires model name/version, pipeline or prompt/config version, evidence spans or source fields, confidence, rationale, and review status. | Model/service identity, model version, evidence span, confidence, and review decision trace. | UI/API must distinguish suggestions from approved facts and block direct publication. | Violation |
| `MinimumEvidenceByAssertionTypeShape` | Mapping and relationship assertions | Applies class/type-specific evidence minima: imported needs source record; inferred needs rule and inputs; human curated needs reviewer/rationale; model suggested needs model metadata and evidence span. | Evidence must match assertion type and remain traceable to source, rule, reviewer, or model. | Explanation payloads can show evidence completeness and validation warnings by assertion type. | Violation |
| `SafetyRelationshipDisclaimerShape` | Product/adverse-event relationships | Requires source context and safety disclaimer metadata; blocks causal/incidence labeling unless approved evidence type is present. | Safety source, source limitations, evidence type, reviewer/policy approval when stronger claim language is used. | Safety search/API responses can include warnings and prevent misleading causal or incidence claims. | Violation |

Recommended non-blocking warning shapes:

- `DefinitionRecommendedShape`: warns when released entities lack a definition for classes where definitions are not yet mandatory.
- `SynonymProvenanceWarningShape`: warns when synonyms have weak or missing source quality metadata before release.
- `P1WorkspaceScopeWarningShape`: warns when P1 classes are promoted beyond reference use without approved scope expansion.

# 9. Release and Named-Graph Implications

Future RDF implementation should separate at least these logical graph contexts:

- Working graph: editable draft/proposed/validated/in-review objects.
- AI suggestion graph: `model_suggested` objects separated from approved semantic state.
- Source graph: imported source assertions and source metadata.
- Staged release graph: approved objects included in a release candidate.
- Released graph: immutable published release snapshot.
- Deprecated/supersession graph or metadata: historical resolution and replacement links.

Release artifact requirements:

- Immutable `release_id` and semantic version.
- Included graph IDs and object IDs.
- Source-version pins for all source-backed data.
- Validation report reference.
- Changelog.
- Artifact hashes.
- Approval records.
- Rollback target.
- Audit event references.

# 10. Downstream API Contract Implications

Entity profile APIs should expose:

- Canonical ID, type, preferred label, synonyms, definitions, external IDs.
- Mappings and relationship assertions with evidence, confidence, assertion type, lifecycle status, provenance, and release ID.
- Released vs working state.
- AI suggestions separately from approved or released data.
- Validation preview results for proposed edits.
- Audit/history links.

Mapping APIs should support:

- Query by source, target, predicate, vocabulary, version, status, release, and confidence.
- Diff by release or proposal.
- Export with provenance and vocabulary version pins.

Relationship APIs should support:

- Query by subject, object, predicate, class, evidence source, assertion type, confidence, lifecycle status, and release.
- Explanation payloads containing evidence references, provenance, mapping path where applicable, validation status, and warnings.

Release APIs should support:

- Active release lookup.
- Release artifact metadata.
- Validation evidence.
- Changelog and artifact hashes.
- Rollback lineage.
- Export package generation with release ID and provenance.

# 11. MVP-Narrow Guardrails

- Do not create a broad ontology editor in MVP.
- Do not create full P1 workspaces for biomarker, endpoint, and organization until approved.
- Do not publish AI suggestions without review.
- Do not allow mappings without source and target vocabulary versions.
- Do not release assertions without provenance.
- Do not model safety relationships as causal unless explicitly approved by evidence policy and compliance review.
- Do not allow mutable edits to released objects; use proposal and release workflow.

# 12. Initial Review Checklist

- Are all required entity classes represented with MVP/P1 status?
- Are lifecycle states exactly aligned to the master prompt?
- Are assertion types distinct in storage, API, and UI?
- Are all 12 required predicates represented?
- Are mapping and relationship assertions modeled as governed objects?
- Do SHACL shapes cover required labels, type, identifier format, provenance, mapping completeness, relationship completeness, lifecycle transitions, release inclusion, deprecation/supersession, AI metadata, and evidence minima?
- Are release blockers aligned with prompt section 6.3?
- Is MVP scope narrow enough for Phase 0?
