# PharmaOps Product Charter

Task:
Create the authoritative MVP product charter for PharmaOps: product thesis, MVP scope, explicit non-goals, personas, primary journeys, testable requirements, product KPIs, pilot thesis, and downstream handoff packet.

Assumptions:
- This charter is the Phase 0 source of truth for MVP product scope until superseded by the Program Orchestrator.
- PharmaOps is a regulated pharma semantic control plane, not a generic ontology editor, graph database, AI search tool, ELN, LIMS, data catalog, data fabric, clinical platform, or broad analytics suite.
- The MVP proves one bounded therapeutic area or domain module before expanding coverage.
- AI can propose curation actions, but no regulated semantic publication bypasses policy-approved human review.

Inputs Reviewed:
- `pharmaops_multi_agent_exportable_prompt.md`, sections 1.1-1.3 for mission, product thesis, and non-negotiable principles.
- `pharmaops_multi_agent_exportable_prompt.md`, sections 2.1-2.2 for MVP scope and MVP non-goals.
- `pharmaops_multi_agent_exportable_prompt.md`, sections 3.1-3.2 for primary users and primary user journeys.
- `pharmaops_multi_agent_exportable_prompt.md`, section 6.1 for required artifact structure.
- `pharmaops_multi_agent_exportable_prompt.md`, section 7, Agent 2 for Product Requirements Agent responsibilities.
- `pharmaops_multi_agent_exportable_prompt.md`, section 11.2 for handoff packet structure.
- `pharmaops_multi_agent_exportable_prompt.md`, section 13 for KPI framework.
- `pharmaops_multi_agent_exportable_prompt.md`, section 14 for final MVP definition.
- `DATA_LICENSE_REGISTER.md` for source classifications, materialization defaults, fail-closed behavior, PHI/PII and licensed-source restrictions, and source disclaimer propagation.

Changes Proposed:
- Establish MVP requirements as concrete, testable product requirements.
- Mark scope boundaries and scope creep conditions explicitly.
- Provide acceptance criteria and requirement metadata for downstream architecture, UX, engineering, validation, and QA work.
- Add fail-closed pilot source and licensed-source posture until implemented source registry controls exist.
- Add preliminary pilot KPI targets, baseline plan, owners, and due phase.

Artifacts Created or Modified:
- Created and updated `PRODUCT_CHARTER.md`.

Interfaces Affected:
- Product requirements inform `ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `VOCABULARY_POLICY.md`, `CONNECTOR_CONTRACT.md`, `SECURITY_MODEL.md`, `VALIDATION_PLAN.md`, `API_CONTRACTS/`, `UX_FLOWS.md`, `TEST_STRATEGY.md`, and `RELEASE_LEDGER.md`.
- No runtime APIs, schemas, source code, tasks ledger, or board files are modified by this charter.

Tests Added or Required:
- No automated tests added; this is a documentation artifact.
- Required downstream tests: requirements traceability checks, acceptance scenario coverage, SHACL/release gate tests, RBAC/audit tests, provenance/export tests, and E2E tests for the three primary journeys.

Security Impact:
- RBAC, environment separation, privileged-action logging, export controls, and immutable audit logs are MVP requirements from day one.
- Search, APIs, exports, and licensed-source access must enforce authorization server-side.

Compliance Impact:
- Release validation, approval trace, immutable release snapshots, changelog, artifact hashes, source-version pins, rollback, and auditability are required for regulated semantic changes.
- Safety data must not be presented as causal or incidence-proving without appropriate evidence and disclaimers.

Data and Provenance Impact:
- Canonical entities, mappings, relationships, assertions, AI suggestions, evidence, source records, releases, and exports must preserve source, source version, confidence where applicable, assertion type, release context, and provenance.
- Open and stable data may be materialized; sensitive or licensed data must follow source-aware federation/materialization rules.

Risks:
- Scope creep into broad ontology coverage, generic data cataloging, dashboards, RWE analytics, or ELN/LIMS workflows would dilute the MVP thesis.
- Weak provenance, missing source-version pins, or AI suggestions appearing as approved facts would create release-blocking compliance risk.
- Under-specified personas or journeys would cause UX and architecture to drift toward generic graph tooling.

Open Questions:
- Which bounded therapeutic area or domain module is selected for the first pilot?
- Which internal source template will be used for the pilot?
- Which tenant-specific licensed source approvals exist for the first pilot beyond the fail-closed defaults in `DATA_LICENSE_REGISTER.md`?

Handoff To:
- Solution Architect Agent: convert the charter into service boundaries, storage strategy, release pipeline architecture, and ADRs.
- UX and Product Design Agent: convert personas, journeys, and requirements into `UX_FLOWS.md`, screen contracts, workflow states, and acceptance-ready interaction models.

Definition of Done Status:
- Done for Phase 0 Product Requirements Agent scope: MVP scope documented, 11 non-goals explicit, 8 personas covered, primary journeys defined, per-requirement fields included, product KPIs listed with preliminary targets/ownership, pilot source posture fail-closed against `DATA_LICENSE_REGISTER.md`, and handoff packet provided.

## 1. Product Thesis

PharmaOps exists because regulated life-sciences organizations have many biomedical, clinical, safety, regulatory, commercial, and internal data sources but lack shared, computable meaning across functions. The product must solve three layers together:

1. Durable semantics: canonical entities, identifiers, synonyms, mappings, provenance, lineage, and versions.
2. Operational semantics: search, APIs, forms, analytics, AI retrieval, exports, and downstream application use.
3. Governable semantics: reviewable, auditable, testable, releasable, rollbackable, and compliant workflows.

The MVP thesis is that a narrow but complete semantic control plane is more valuable than a broad but ungoverned ontology tool. PharmaOps should let a pilot team ingest source data, normalize entities, review AI and deterministic suggestions, validate changes, approve and release governed semantic assets, search with explanation, export with provenance, audit every regulated action, and roll back releases.

Non-negotiable principles from the master prompt:

- Build a pharma semantic control plane, not a generic ontology editor.
- Govern meaning, not just data.
- Use RDF, OWL, SHACL, SPARQL, PROV-style provenance, CURIEs/IRIs, and open mapping exports as semantic-core contracts.
- Keep the application pragmatic with search indexes, denormalized evidence, embeddings, and scores where useful.
- Treat mappings as first-class governed assets.
- Never auto-publish AI output in regulated flows.
- Make every assertion explainable.
- Make every release reproducible.
- Treat security and audit as product features.
- Keep data access source-aware.
- Design business-user workflows around search, compare, approve, explain, release, and export.
- Use scope as a control.

## 2. MVP Scope and Non-Goals

### 2.1 MVP Scope

The MVP includes exactly these scope pillars:

1. Canonical entity and terminology workspace for compounds, targets, diseases/conditions, trials, products/drugs, adverse events, and documents/evidence.
2. Connector set for ClinicalTrials.gov, PubMed/Europe PMC, ChEMBL, UniProt, openFDA FAERS, and one internal source template.
3. Ontology and mapping release workflow with staging, validation, approval, release snapshots, changelogs, artifact hashes, and rollback.
4. Search and explainability UI with entity pages, evidence links, provenance, confidence, and assertion type.
5. AI-assisted extraction and normalization for documents and source records, always moderated.
6. Developer API layer with REST or GraphQL, controlled SPARQL access for power users, and export endpoints.
7. Auditability and RBAC from day one.
8. Validation framework using SHACL and release quality gates.
9. Source-version pinning and provenance for all imported data.
10. Pilot-ready workflow for one bounded therapeutic area or domain module.

### 2.2 MVP Non-Goals

These 11 items are out of scope unless explicitly approved by the Program Orchestrator and Product Requirements Agent:

1. Full ELN/LIMS replacement.
2. Fully autonomous curation.
3. Broad multilingual terminology management.
4. Broad commercial dashboards.
5. Every ontology and every therapeutic area.
6. A generic graph database product.
7. A generic data catalog.
8. A generic enterprise data fabric.
9. A broad clinical data platform.
10. A broad real-world evidence analytics suite.
11. Any user-facing claim that safety data proves causation or incidence without appropriate evidence and disclaimers.

### 2.3 Scope Creep Flags

Flag for Product Requirements and Program Orchestrator review if a proposed change:

- Adds a new domain beyond the selected pilot area before the three primary journeys pass.
- Adds user-facing analytics dashboards that are not required for semantic governance, explanation, release, or export.
- Adds autonomous publication of mappings, entities, relationships, definitions, or synonyms.
- Treats mappings as raw lookup rows instead of governed assets.
- Materializes licensed or sensitive data without an approved data licensing policy.
- Prioritizes graph visualization breadth over workflow adoption and evidence-backed decisions.

## 3. Users, Jobs, and Journeys

### 3.1 Personas

| Persona | Main jobs | MVP product requirements |
|---|---|---|
| Knowledge managers / ontologists | Govern terms, mappings, versions, releases, definitions, synonyms, and lifecycle states. | Ontology workspace, mapping registry, validation previews, diffs, approval workflow, release snapshots, rollback, audit trail. |
| Data scientists / ML engineers | Normalize entities, reuse curated semantics, power retrieval, analytics, features, and model evaluation. | Stable IDs, APIs, exports, confidence scores, source provenance, release IDs, model-ready entity/mapping packages. |
| R&D / translational scientists | Search targets, diseases, biomarkers, compounds, trials, evidence, and relationship context. | Semantic search, evidence graph, entity pivots, source-linked explanations, confidence, assertion type, provenance exports. |
| Clinical operations teams | Normalize protocols, endpoints, trial records, eligibility, sponsors, sites, and interventions. | Trial ontology coverage, endpoint terms, ClinicalTrials.gov connector, trial landscape search, source label preservation. |
| Regulatory affairs teams | Govern controlled terminology, submission consistency, impact analysis, and release evidence. | CDISC-aware governance hooks, release certification, impact analysis, audit exports, reproducible release packages. |
| Safety / pharmacovigilance teams | Govern adverse-event and product semantics and support signal-context review. | MedDRA-aware mapping support, FAERS/openFDA limitations, provenance and disclaimers, product/event review workflows. |
| Commercial / HEOR / medical affairs teams | Align indication, product, population, outcome, and dataset semantics for authorized downstream use. | Licensed-data federation posture, controlled exports, outcome/cohort vocabularies, role-aware search and API access. |
| Platform administrators | Configure sources, users, roles, environments, releases, monitoring, and operational controls. | Admin UI, RBAC, audit browser, connector status, secrets/config controls, environment separation, operational monitoring. |

### 3.2 Primary User Journeys

Journey A: Curate and release a mapping

1. User searches for a source term.
2. User sees candidate canonical entities and mappings.
3. User opens evidence, source version, and confidence details.
4. User proposes or edits a mapping.
5. System validates mapping completeness and constraints.
6. User submits to review.
7. Domain approver approves or rejects with rationale.
8. Release manager stages approved mapping.
9. System validates release candidate.
10. Release is promoted with immutable snapshot and artifact hash.

Journey B: Search and explain evidence

1. User searches for a disease, target, compound, trial, product, or adverse event.
2. System expands synonyms and mappings.
3. User sees canonical entity results and related entities.
4. User pivots from disease to targets, compounds, trials, and documents.
5. User opens explanation panel.
6. System shows whether each relationship is asserted, inferred, imported, human-curated, or model-suggested.
7. System shows evidence documents, source records, confidence, source version, and release ID.
8. User exports results with provenance.

Journey C: AI-assisted curation

1. New literature or document source is ingested.
2. AI extracts entity mentions and candidate relationships.
3. AI generates suggestions with source spans, evidence, model version, confidence, and rationale.
4. Suggestions route to a review queue by entity type, confidence, and domain.
5. Reviewer accepts, rejects, revises, or escalates suggestions.
6. Accepted suggestions become governed proposals.
7. Feedback is stored for evaluation and calibration.

## 4. Product Requirements

Each requirement includes user, job, workflow, acceptance, priority, dependencies, and non-goals as required by Agent 2 instructions.

### REQ-001: Canonical Entity Workspace

- User: Knowledge managers / ontologists, R&D / translational scientists, clinical operations, safety, regulatory.
- Job: View and govern canonical entities for compounds, targets, diseases/conditions, trials, products/drugs, adverse events, and documents/evidence.
- Workflow: Search or open an entity; inspect preferred label, synonyms, definitions, external IDs, mappings, relationships, evidence, provenance, lifecycle status, and release membership; propose edits into governed review.
- Acceptance: Entity page shows canonical ID, type, labels, synonyms, definitions, external IDs, mappings, relationships, evidence, provenance, lifecycle state, working vs released status, and audit history; unauthorized users cannot mutate governed data; edits become proposals rather than direct publication.
- Priority: P0.
- Dependencies: Domain model, vocabulary policy, RDF semantic store, search index, workflow service, RBAC, audit, validation shapes.
- Non-goals: Broad ontology editing, arbitrary graph modeling, ELN/LIMS notebook workflows.

### REQ-002: First-Class Mapping Registry

- User: Knowledge managers / ontologists, regulatory, safety, data scientists.
- Job: Govern source-to-canonical mappings with evidence, status, confidence, reviewer, source/target versions, lifecycle, and release history.
- Workflow: Search mappings by entity, vocabulary, status, source, target, confidence, or release; inspect details; create or edit mapping proposals; validate completeness; send to approval; include approved mappings in release candidates.
- Acceptance: Every mapping has source, target, predicate, confidence, reviewer where reviewed, evidence, source vocabulary version, target vocabulary version, lifecycle status, and release history; mapping changes are audited; mappings missing required provenance or vocabulary versions cannot be released.
- Priority: P0.
- Dependencies: Vocabulary policy, domain model, SHACL shapes, workflow service, audit service, release pipeline, export contract.
- Non-goals: Raw lookup tables without governance; bulk auto-publication of AI-created mappings.

### REQ-003: Source Connectors and Raw Artifact Preservation

- User: Platform administrators, data scientists, knowledge managers.
- Job: Ingest and replay source data from public and internal sources while preserving source versions and raw artifacts.
- Workflow: Configure connector; run ingestion; persist raw artifacts and source metadata; parse source records; emit normalized candidate assertions; expose connector status and run history.
- Acceptance: MVP connectors exist for ClinicalTrials.gov, PubMed/Europe PMC, ChEMBL, UniProt, openFDA FAERS, and one internal source template; every import stores raw artifact references, source name, source version, run ID, timestamp, parser version, and idempotency/checkpoint metadata.
- Priority: P0.
- Dependencies: Connector contract, object storage, ingestion service, normalization service, provenance schema, audit, data license register.
- Non-goals: Broad connector marketplace, every source family, unrestricted licensed-source materialization.

### REQ-004: AI-Assisted Curation with Mandatory Human Review

- User: Knowledge managers / ontologists, domain reviewers, safety reviewers, R&D scientists.
- Job: Use AI to speed extraction, normalization, relationship discovery, duplicate detection, and definition/synonym suggestions while preserving regulated review.
- Workflow: Ingest source; AI creates suggestions with evidence spans, model version, prompt/rule version where applicable, confidence, and rationale; suggestions route to review; reviewer accepts, rejects, revises, or escalates; accepted suggestions become governed proposals.
- Acceptance: AI suggestions are visually and structurally distinct from approved assertions; no AI suggestion can become released fact without review; model version, evidence, confidence, and reviewer feedback are retained; rejected suggestions remain auditable and excluded from approved facts.
- Priority: P0.
- Dependencies: AI curation service, provenance model, workflow service, review queues, audit, UX distinction rules, evaluation metrics.
- Non-goals: Fully autonomous curation; user-facing claims that model output is authoritative before approval.

### REQ-005: Search and Explainability

- User: R&D / translational scientists, clinical operations, safety, regulatory, commercial/HEOR/medical affairs, data scientists.
- Job: Find canonical entities and relationships across sources and understand why results appear.
- Workflow: Search disease, target, compound, trial, product, adverse event, or evidence document; system expands synonyms and mappings; user filters by type, source, evidence type, release, confidence, and assertion type; user opens explanation panel and exports with provenance.
- Acceptance: Search result explains match reason; relationship views distinguish asserted, imported, inferred, human-curated, and model-suggested assertions; evidence, confidence, source version, release ID, and provenance are visible; unauthorized results are filtered; exports include release and provenance metadata.
- Priority: P0.
- Dependencies: Search/vector index, canonical entity model, mapping registry, evidence model, RBAC, API facade, export service.
- Non-goals: Generic AI search without governed semantics; analytics dashboards beyond search/explanation/export.

### REQ-006: Release Workflow and Rollback

- User: Release managers, knowledge managers, regulatory, compliance, platform administrators.
- Job: Promote approved semantic changes through validation, approval, immutable release, export, and rollback.
- Workflow: Create release candidate from approved changes; run syntax, SHACL, mapping completeness, provenance coverage, and export validation; generate changelog and artifact hashes; require release and compliance approval; promote immutable snapshot; support rollback to prior release.
- Acceptance: Critical validation failures block promotion; release package contains immutable snapshot, validation reports, changelog, artifact hashes, source-version pins, approval records, and rollback target; rollback restores previous release graph and metadata; release actions are audited.
- Priority: P0.
- Dependencies: Workflow service, RDF named graphs, validation framework, audit, object storage, release ledger, export service.
- Non-goals: Ad hoc partial release, mutable released graphs, release without approval trace.

### REQ-007: RBAC, Audit, and Environment Separation

- User: Platform administrators, security admins, compliance, all governed workflow users.
- Job: Protect governed actions, source access, exports, and regulated release events with auditable controls.
- Workflow: Admin configures users, roles, environments, connectors, and source access; users attempt actions; system authorizes server-side; audit records regulated and privileged actions; authorized users inspect/export audit trails.
- Acceptance: RBAC covers view, propose, review, approve, release, rollback, export, source configuration, role changes, connector runs, and admin actions; audit logs are immutable and searchable; local/dev/test/staging/release-candidate/production environments are separated; failed authorization attempts are audited.
- Priority: P0.
- Dependencies: Security model, identity provider integration, workflow service, audit service, API facade, admin UI.
- Non-goals: Frontend-only access control; unaudited admin bypasses.

### REQ-008: Validation Framework and Quality Gates

- User: Knowledge managers, release managers, compliance, QA, domain reviewers.
- Job: Validate semantic assets before review, approval, export, and release.
- Workflow: User previews validation on a proposal; release candidate runs full validation; failures route to responsible owner; promotion blocked when critical gates fail.
- Acceptance: SHACL and release quality gates check required entity fields, mapping completeness, provenance coverage, source-version pins, assertion status, AI suggestion separation, export metadata, and rollback readiness; validation reports are stored and linked to proposals/releases.
- Priority: P0.
- Dependencies: SHACL shapes, validation service, workflow service, release pipeline, provenance model, QA strategy.
- Non-goals: Manual-only validation; release promotion with critical validation failure.

### REQ-009: Developer APIs, SPARQL, and Governed Exports

- User: Data scientists / ML engineers, platform administrators, downstream application owners, power users.
- Job: Consume governed semantic assets through stable interfaces with provenance and release context.
- Workflow: Developer queries REST or GraphQL APIs, controlled SPARQL endpoint, or export endpoints; selects release/context; receives canonical IDs, mappings, relationships, evidence, provenance, and authorization-filtered data.
- Acceptance: APIs and exports include stable IDs, release ID, source IDs, source versions, provenance, assertion type, and confidence where applicable; unauthorized or restricted data is filtered; export actions are audited; power-user SPARQL is controlled and scoped.
- Priority: P0.
- Dependencies: API contracts, semantic store, search service, export service, RBAC, data license register, audit.
- Non-goals: Unbounded database access; exports without release/provenance metadata.

### REQ-010: Pilot-Ready Bounded Domain Module

- User: Pilot customer/internal pharma team, Product, Solution Architect, UX, all primary personas.
- Job: Demonstrate the full semantic-control-plane flow in one bounded therapeutic area or domain module.
- Workflow: Configure sources; ingest public and internal data; normalize candidate entities; review mappings and AI suggestions; validate; approve; release; search; explain; export; audit; rollback.
- Acceptance: Pilot can complete the final MVP flow from source ingestion through rollback; all seven MVP acceptance scenario themes are demonstrable; pilot users can complete the three primary journeys without semantic-web jargon as a prerequisite.
- Priority: P0.
- Dependencies: All P0 requirements, pilot domain decision, source selection, UX flows, architecture, validation, QA, release plan.
- Non-goals: Every therapeutic area, every ontology, every workflow, broad enterprise rollout.

## 5. User Stories and Acceptance Criteria

| Story ID | User story | Acceptance criteria | Priority | Requirement link |
|---|---|---|---|---|
| US-001 | As a curator, I can create or edit a canonical disease, target, compound, product, trial, adverse event, or evidence entity as a proposal. | Required fields validate; evidence is linked; proposal is audited; released data is not mutated directly. | P0 | REQ-001, REQ-008 |
| US-002 | As a domain reviewer, I can approve or reject a mapping with rationale. | Review decision captures actor, timestamp, rationale, validation state, and audit event. | P0 | REQ-002, REQ-006, REQ-007 |
| US-003 | As an R&D scientist, I can search a disease and pivot to targets, compounds, trials, documents, and adverse events. | Results show canonical entities, relationship type, confidence, evidence, source version, release ID, and explanation. | P0 | REQ-005 |
| US-004 | As a safety user, I can inspect product/adverse-event semantics with clear source limitations. | FAERS/openFDA limitations and non-causality disclaimers appear where relevant; provenance is visible; exports preserve context. | P0 | REQ-005, REQ-009 |
| US-005 | As a data scientist, I can export released entities and mappings with stable IDs and provenance. | Export includes release ID, source IDs, source versions, assertion type, provenance, and authorization filtering. | P0 | REQ-009 |
| US-006 | As a platform admin, I can configure and monitor MVP connectors. | Connector status, run history, raw artifact references, source versions, retry/checkpoint state, and audit events are visible. | P0 | REQ-003, REQ-007 |
| US-007 | As a release manager, I can stage approved changes and promote only passing release candidates. | Failed critical gates block promotion; passing release has immutable snapshot, changelog, artifact hashes, validation evidence, approvals, source-version pins, and rollback target. | P0 | REQ-006, REQ-008 |
| US-008 | As a reviewer, I can reject an AI suggestion and preserve feedback. | Rejected suggestion never appears as approved fact; rejection, evidence, model version, confidence, and feedback are retained and auditable. | P0 | REQ-004 |
| US-009 | As a regulatory user, I can inspect impact and release evidence for controlled terminology changes. | Release package and audit export show affected assets, approvals, validation results, artifact hashes, and provenance. | P1 | REQ-006, REQ-007, REQ-008 |
| US-010 | As a commercial/HEOR user, I can access authorized controlled exports without exposing restricted source data. | Data license policy and RBAC are enforced; export is audited; restricted materialization is blocked. | P1 | REQ-007, REQ-009 |

## 6. Pilot Thesis

The pilot should prove that a regulated pharma team can use PharmaOps to govern scientific meaning across source systems faster and with better traceability than spreadsheet reconciliation or one-off graph tooling.

Pilot success requires one bounded therapeutic area or domain module where users can:

1. Ingest selected public sources and one internal source template.
2. Preserve raw source artifacts and source versions.
3. Normalize source records into canonical entity candidates.
4. Create reviewable mappings and relationships.
5. Route AI and deterministic suggestions through governed curation.
6. Validate with SHACL and quality rules.
7. Approve and stage governed changes.
8. Publish immutable semantic release.
9. Search and explain released entities and relationships.
10. Export through UI/API with provenance.
11. Audit every governed action.
12. Roll back if needed.

Recommended pilot thesis statement:

> For one bounded therapeutic area or domain module, PharmaOps will reduce manual reconciliation effort and increase trust in semantic assets by giving cross-functional users a governed workbench to search, curate, approve, release, explain, export, audit, and roll back canonical pharma semantics.

## 7. Product KPIs

### 7.1 Semantic Quality KPIs

- Canonicalization rate for prioritized entity classes.
- Precision/recall on moderated entity-linking tasks.
- Percentage of graph assertions with source provenance.
- Mapping coverage to required standards.
- Validation pass rate per release.
- Ontology change lead time from request to release.
- Duplicate canonical entity rate after release.
- Deprecated term resolution coverage.

### 7.2 Adoption and Workflow KPIs

- Weekly active users by role.
- Search success rate.
- Time to first relevant answer.
- Curator throughput.
- Median review time.
- Ratio of accepted AI suggestions to total reviewed suggestions.
- Number of downstream systems consuming released semantics.
- Release cadence.

### 7.3 Business Impact KPIs

- Time to onboard a new data source.
- Time to answer cross-source scientific or operational questions.
- Reduction in duplicate terminology or manual reconciliation effort.
- Trial planning or safety review cycle-time reduction for targeted workflows.
- Percentage of regulated releases with zero critical semantic findings.
- Number of APIs or exports consumed by downstream systems.

### 7.4 Preliminary Pilot KPI Targets and Ownership

These are preliminary pilot targets for planning only. The Customer Pilot and Implementation Agent owns final target calibration in the pilot plan during Phase 7, with Product Requirements, QA, Observability/SRE, and Compliance review before pilot onboarding.

| KPI | Baseline plan | Preliminary pilot target range | Owner | Due phase |
|---|---|---|---|---|
| Canonicalization rate for prioritized entity classes | Measure against selected pilot source records before first release candidate. | 70-85% of in-scope source records linked to canonical entities for prioritized entity classes. | Product Requirements with Ontology Architect and Data Governance | Phase 7 pilot plan |
| Precision/recall on moderated entity-linking tasks | Build a small gold set from pilot domain records and reviewer decisions. | Precision 0.85-0.95; recall 0.70-0.85 for moderated MVP entity-linking tasks. | QA and Test Automation with Entity Resolution | Phase 7 pilot plan |
| Percentage of graph assertions with source provenance | Baseline is zero accepted release assertions without required provenance. | 100% of released assertions have source, source version, evidence/provenance reference, assertion type, and release context. | Compliance and Validation | Phase 0 validation plan; enforced by Phase 7 |
| Mapping coverage to required standards | Establish required standards after pilot domain and source set are selected. | 80-90% coverage for pilot-critical mappings where required source standards are available and licensed. | Standards and Mapping | Phase 7 pilot plan |
| Validation pass rate per release | Track every release candidate validation run. | 100% of promoted releases pass critical gates; failed candidates are acceptable only before promotion. | Release Manager with Compliance and Validation | Phase 7 release candidate |
| Duplicate canonical entity rate after release | Baseline via curator review of pilot entity classes after initial import. | Less than 3-5% duplicate canonical entity rate in pilot-prioritized classes after release. | Knowledge Managers / Ontology Architect | Phase 7 pilot readiness |
| Search success rate | Baseline from scripted pilot search tasks and user observation. | 75-85% of pilot search tasks produce a user-confirmed relevant result in first results page. | UX and Product Design with Search and Retrieval | Phase 7 pilot plan |
| Time to first relevant answer | Capture timestamp from search submission to user-confirmed relevant entity/evidence. | Median under 2 minutes for scripted pilot search tasks. | UX and Product Design with Observability/SRE | Phase 7 pilot plan |
| Curator throughput | Baseline during first moderated curation batch. | 20-40 reviewed mapping/entity/suggestion items per curator-day for MVP pilot workflows. | Product Requirements with Workflow Backend and QA | Phase 7 pilot plan |
| Median review time | Baseline from review queue timestamps in first curation batch. | Median under 2 business days for P0 pilot-domain proposals. | Workflow Backend with Product Requirements | Phase 7 pilot plan |
| Accepted AI suggestions ratio | Baseline from first AI-assisted curation batch. | 30-60% accepted or revised-and-accepted among reviewed AI suggestions; lower values trigger model/routing review, not auto-publication. | AI Curation with Product Requirements and QA | Phase 7 pilot plan |
| Time to onboard a new data source | Baseline from first connector setup in pilot environment. | Public source fixture or connector configured in 1-3 business days; internal source template configured in 3-5 business days after data governance approval. | Connector Architect with Data Governance | Phase 7 pilot plan |
| Regulated releases with zero critical semantic findings | Baseline from release candidate review. | 100% of promoted pilot releases have zero unresolved critical semantic, provenance, licensing, security, or validation findings. | Release Manager with Compliance and Red Team | Phase 7 release candidate |

Targets must be revised if the selected pilot domain, data volume, source license posture, or staffing model changes. Any KPI using licensed, internal, PHI/PII, or safety data must respect `DATA_LICENSE_REGISTER.md`, source disclaimers, RBAC, and export restrictions.

## 8. Appendix A: Pilot Source and Licensed-Source Posture

This appendix closes the Phase 0 product gap identified as PC-RT-001. It is intentionally narrow and defers detailed data-governance mechanics to `DATA_LICENSE_REGISTER.md`, which is the controlling policy artifact for source classifications, materialization/federation rules, retention, disclaimers, PHI/PII handling, and export controls.

### 8.1 Pilot Source Classes

The MVP pilot may use only these source classes until Data Governance approves more:

| Source class | Pilot posture | Product requirement |
|---|---|---|
| ClinicalTrials.gov | Public/open with attribution; materialize with source URL, retrieval time, source labels, trial status, and registry context. | Allowed for trial/entity evidence only when source-version and disclaimer metadata are captured. |
| PubMed / Europe PMC | Public/open with attribution; materialize bibliographic metadata and permitted snippets; federate or block full text by article license. | Allowed for evidence only when citation, document ID, source context, snippet/span policy, and article license status are captured. |
| ChEMBL | Public/open with attribution; materialize with version pinning. | Allowed for compound/target evidence only with ChEMBL version, source record IDs, attribution, and release manifest linkage. |
| UniProt | Public/open with attribution; materialize with version pinning. | Allowed for target/protein evidence only with UniProt release/version, accession, reviewed/unreviewed status, and attribution. |
| openFDA FAERS | Public/open with attribution; materialize with mandatory safety limitations. | Allowed for safety context only; UI, APIs, exports, and release packages must preserve non-causal warnings. |
| Internal source template | Internal confidential by default; may elevate to contains PHI/PII. | Federate or stream by default; redact-then-materialize only with customer approval; block when sensitivity, license, retention, or AI-use policy is unknown. |

### 8.2 Licensed-Source Defaults

Licensed or commercially restricted sources are not implicitly in pilot scope. Defaults:

- MedDRA: `licensed_federated` until tenant license, permitted use, display rights, export rights, and release-package rights are recorded in `DATA_LICENSE_REGISTER.md` or its implemented source registry.
- SNOMED CT: `licensed_federated` until tenant license, jurisdiction, affiliate rights, permitted use, display rights, export rights, and release-package rights are recorded.
- Licensed publications, commercial real-world data, claims, EHR, proprietary ontologies, proprietary drug/product datasets, and vendor vocabularies: `blocked_pending_legal_review` until Data Governance records explicit approval.
- Licensed identifiers may be referenced only when the relevant license permits identifier reference; labels, synonyms, hierarchies, definitions, descriptions, snippets, or source content remain blocked unless rights are recorded.
- No licensed source may be materialized, indexed, embedded, sent to AI, displayed, exported, or included in a release package without explicit approval and a `legal_approval_id` where required.

### 8.3 Fail-Closed Product Behavior

Until `DATA_LICENSE_REGISTER.md` is implemented as an enforceable source registry and validation control, PharmaOps must fail closed:

- Block ingestion when source license classification, sensitivity classification, retention class, source-version strategy, raw artifact policy, disclaimer policy, or materialization policy is missing or unknown.
- Block local materialization when a source is licensed, internal confidential, contains PHI/PII, or is pending legal review unless the register grants explicit approval.
- Block search indexing, vector embedding, AI processing, export, and release inclusion when source permissions do not explicitly allow the requested use.
- Block release promotion when any included source lacks data-license/materialization clearance, required disclaimers, source-version pins, provenance, or export restrictions.
- Block safety claims that imply FAERS/openFDA causation, incidence, prevalence, comparative risk, or product fault by themselves.
- Treat unknown or expired source approvals as `blocked_pending_legal_review`.

These blocks are product requirements, not implementation suggestions. Architecture, connectors, validation, APIs, search, AI curation, release, export, and UX must preserve this fail-closed behavior.

## 9. MVP Acceptance Criteria Summary

The MVP is acceptable when a pilot customer or internal pharma team can:

1. Search a disease, target, compound, trial, product, adverse event, or evidence document.
2. See canonical metadata, synonyms, mappings, relationships, source evidence, confidence, and provenance.
3. Understand why a result or relationship appears.
4. Propose a new synonym, mapping, relationship, definition, or evidence link.
5. Validate the proposed change.
6. Route the change through review and approval.
7. Promote approved changes into a versioned release.
8. Roll back to a previous release.
9. Export released entities and mappings through UI and API.
10. Trace every assertion and workflow action to source, version, user/service account, timestamp, validation result, and release.

## 10. Handoff Packet

```yaml
handoff_from: Product Requirements Agent
handoff_to:
  - Solution Architect Agent
  - UX and Product Design Agent
ticket_id: "Phase0-Product-Charter"
summary: "PRODUCT_CHARTER.md defines PharmaOps MVP thesis, scope, 11 non-goals, 8 personas, 3 primary journeys, P0/P1 requirements, user stories, acceptance criteria, KPIs, pilot thesis, and scope creep flags."
artifacts_changed:
  - "PRODUCT_CHARTER.md"
contracts_changed:
  - "No runtime contracts changed. Product requirements now constrain architecture, UX flows, API contracts, validation gates, security model, connector contract, source-license enforcement, and release planning."
assumptions:
  - "MVP remains bounded to one therapeutic area or domain module."
  - "AI suggestions require human review before regulated publication."
  - "Every assertion, mapping, export, and release must preserve source/version/provenance context."
  - "DATA_LICENSE_REGISTER.md is the controlling policy artifact for source classification and materialization/federation rules."
test_results:
  - "Documentation-only artifact; no automated tests executed."
known_limitations:
  - "Pilot therapeutic area/domain module is not yet selected."
  - "Internal source template is not yet specified."
  - "Licensed source approvals are not yet confirmed and default to federated or blocked per DATA_LICENSE_REGISTER.md."
risks:
  - "Scope creep into generic ontology editing, broad analytics, autonomous curation, or unrestricted source materialization would undermine MVP focus."
  - "Architecture and UX must preserve governance without forcing business users into semantic-web jargon."
  - "Until implemented source registry controls exist, teams must treat unknown source posture as blocked."
required_next_action:
  - "Solution Architect: derive service boundaries, storage strategy, named graph/release architecture, integration contracts, and ADRs from this charter."
  - "UX and Product Design: derive UX_FLOWS.md, screen contracts, workflow states, review queues, explanation panels, and role-specific interaction flows from this charter."
  - "Data Governance, Connector Architect, Security, and Validation: enforce Appendix A fail-closed source posture in source onboarding, connector output, search, AI, export, validation, and release gates."
blocking_questions:
  - "Which bounded therapeutic area or domain module is the pilot?"
  - "Which internal source template is in scope?"
  - "Which tenant-specific licensed source approvals, if any, are recorded for MVP pilot use?"
```
