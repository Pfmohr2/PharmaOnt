# PharmaOps Test Strategy

Task:

Author the Phase 0 test strategy for PharmaOps as a regulated semantic control plane. The strategy defines how QA proves ontology validity, provenance coverage, connector reproducibility, RBAC, auditability, release rollback, search explainability, and end-to-end product behavior.

Assumptions:

- PharmaOps MVP scope is the scope in the master prompt, not a generic ontology editor, graph database, AI search tool, ELN, or LIMS.
- Automated tests must become CI gates before release-candidate promotion.
- Human review remains mandatory for regulated semantic publication; tests must prove AI and connector outputs cannot bypass review.
- The initial implementation may use fixtures and local services, but every test fixture must preserve source version, raw artifact identity, provenance, release context, and expected governance state.
- Compliance and Validation owns release-gate policy; QA owns test coverage and evidence generation against those gates.

Inputs Reviewed:

- `pharmaops_multi_agent_exportable_prompt.md`
- Section 6.1 required output structure.
- Section 6.2 merge rule.
- Section 6.3 blocking failure conditions.
- Section 7 Agent 21 Compliance and Validation release gates.
- Section 7 Agent 22 QA and Test Automation responsibilities and required test categories.
- Section 7 Agent 24 DevOps and Platform CI gates.
- Section 8 collaboration and required reviewer map.
- Section 9 per-phase exit criteria.
- Section 10 subsystem definitions of done.
- Section 12 MVP acceptance test scenarios.
- Section 16 specialist agent base prompt.

Changes Proposed:

- Establish a test pyramid for code, semantic data, workflows, regulated controls, and end-to-end acceptance.
- Treat semantic assertions, mappings, release packages, provenance, audit events, and search explanations as testable product contracts.
- Make Phase 0 deliverables testable through traceability matrices, fixture conventions, and CI gate definitions before implementation begins.
- Align QA output with Compliance release gates and DevOps CI gates so validation evidence is generated continuously, not only at release time.

Artifacts Created or Modified:

- `TEST_STRATEGY.md`

Interfaces Affected:

- CI/CD gate definitions owned by DevOps and Platform.
- Validation evidence package owned by Compliance and Validation.
- Connector fixture contracts owned by Connector Architect and Public Connector Implementation.
- API, export, search, workflow, security, ontology, audit, and release contracts owned by their respective implementation agents.
- Test fixture directories under future `tests/`, `ontologies/fixtures/`, `connectors/*/fixtures/`, and service-specific test folders.

Tests Added or Required:

## 1. Test Strategy Principles

PharmaOps testing must prove three things at once:

1. Durable semantics: canonical IDs, source versions, mappings, ontology constraints, provenance, evidence, and release snapshots are complete and reproducible.
2. Operational semantics: users and APIs can search, inspect, explain, approve, release, export, and roll back governed semantic assets.
3. Governable semantics: regulated changes are RBAC-protected, auditable, validated, approved, and blocked when critical evidence is missing.

No test suite is complete if it only proves service code paths. The suite must also prove that a scientific assertion can be traced from source artifact to normalized candidate, governed proposal, approval, release package, search explanation, API response, export, audit event, and rollback target.

## 2. Required Test Categories

| Test category | Required examples | Control-plane evidence produced |
|---|---|---|
| Unit tests | Identifier parsing, mapping predicate validation, workflow transitions | Fast proof that local rules are deterministic and reject malformed semantic inputs |
| Ontology tests | OWL syntax, SHACL shape validation, required fields, relationship constraints | Validation reports showing ontology and semantic fixtures satisfy formal constraints |
| Connector tests | Fixture parse, retry, checkpoint, raw artifact persistence, source-version capture | Reproducible connector run logs, raw artifact hashes, source-version pins, and normalized output snapshots |
| Normalization tests | Candidate ranking, synonym matching, duplicate detection, confidence bands | Golden-set metrics and review routing evidence for candidate canonicalization |
| API tests | Auth, RBAC, schema, release context, error handling | Contract reports proving released and working-state APIs preserve policy, versions, and provenance |
| Search tests | Synonym match, facet filtering, provenance display, role-filtered results | Explainability payload snapshots proving match reason, assertion type, source evidence, confidence, release ID, and RBAC filtering |
| Workflow tests | Submit, validate, approve, reject, stage, release, rollback | State-machine traces proving no governed change publishes without required validation and approval |
| Security tests | Unauthorized action blocked, tenant isolation, privileged export logging | Negative-test evidence for blocked actions, data isolation, and mandatory audit events |
| Performance tests | P95 search latency, batch ingestion duration, validation window | Benchmark reports with thresholds for pilot-scale fixtures and release-candidate gates |
| E2E tests | Disease to target to compound to trial to evidence to proposal to approval to release to API export | Full traceability package proving the MVP semantic-control-plane thesis |

## 3. Coverage Expectations By Layer

### Unit

- Identifier helpers parse and format CURIEs, IRIs, stable canonical IDs, source IDs, release IDs, and artifact IDs.
- Mapping predicates accept only approved vocabulary policy values.
- Workflow transitions reject invalid moves such as `draft` to `released`, `ai_suggested` to `released`, and contributor self-approval.
- Provenance builders require source, source version, raw artifact reference, extraction method, actor or service account, timestamp, and release context where applicable.
- Audit event builders require actor, action, object type, object ID, before/after references when applicable, timestamp, environment, and correlation ID.

### Ontology and SHACL

- OWL/RDF syntax validation runs against every ontology module and fixture graph.
- SHACL validates required entity, mapping, relationship, evidence, release, and provenance fields.
- Relationship constraints prevent unsupported entity pairs and unsafe safety claims.
- Mapping shapes require source vocabulary version, target vocabulary version, predicate, evidence, confidence, lifecycle status, reviewer where approved, and release membership where published.
- Release shapes require changelog, validation evidence, artifact hashes, source-version pins, approver records, rollback target, and immutable named-graph references.

### Connector

- Each connector fixture has raw input, expected parsed record, expected normalized candidate output, source-version metadata, and expected provenance.
- Retry tests prove transient failures resume from checkpoints without duplicate governed assertions.
- Checkpoint tests prove reruns are idempotent and record source-version changes explicitly.
- Raw artifact tests prove source payloads are retained by content hash and linked to normalized records.
- Source-license tests prove restricted or licensed data follows the materialization or federation policy and cannot be exported without allowed policy.

### Normalization

- Golden sets cover compounds, targets, genes/proteins, diseases, trials, products, adverse events, endpoints, biomarkers, organizations, and documents.
- Candidate-ranking tests include exact identifier matches, synonym matches, ambiguous synonyms, deprecated terms, and homonyms.
- Duplicate-detection tests flag likely duplicate canonical entities but do not auto-merge them.
- Confidence-band tests route high, medium, and low confidence candidates to the correct review path.
- Regression metrics track precision, recall, F1, false-positive rate, reviewer acceptance rate, and calibration drift.

### API

- Contract tests validate OpenAPI or GraphQL schemas for entities, mappings, evidence, search, workflows, releases, audit, and exports.
- API tests verify working-state reads differ from release-state reads and require explicit release context where needed.
- RBAC tests prove unauthorized create, update, approve, release, rollback, audit, and export actions are blocked server-side.
- Error tests return actionable validation failures without leaking restricted records or internal secrets.
- Export API tests require stable IDs, release ID, source IDs, source versions, provenance, artifact hashes where applicable, and license/export policy metadata.

### Search

- Synonym expansion tests prove preferred labels, synonyms, external IDs, and mappings produce expected matches.
- Facet tests cover entity type, source, evidence type, release, confidence, assertion type, and lifecycle status.
- Explanation tests require match reason, assertion type, source evidence, confidence, source version, release ID, and provenance.
- Role-filtered result tests prove unauthorized or cross-tenant data is not returned in results, facets, counts, explanation payloads, or exports.
- Search index consistency tests prove rollback changes active-release results and explanations back to the restored release.

### Workflow

- Proposal tests cover creating entity, synonym, mapping, relationship, definition, and evidence-link proposals.
- Validation-preview tests show blocking and non-blocking findings before submission.
- Review tests cover approve, reject, request revision, escalate, and rationale capture.
- Release tests cover stage, validate, generate package, approve, promote, archive, and rollback.
- Audit tests verify every regulated workflow transition emits immutable audit events.

### Security

- Negative tests cover contributor self-approval, viewer restricted export, non-admin source configuration change, broad service-account mutation, and unscoped search access.
- Tenant isolation tests cover API, search, export, audit search, workflow queues, connector status, and object-storage references.
- Privileged export tests require role permission, audit event, release ID, source policy, requester, timestamp, and exported artifact hash.
- Secrets tests verify connector secrets never appear in logs, audit payloads, search indexes, error responses, or exports.
- Security scan gates cover dependencies, containers, infrastructure, and secrets.

### Performance

- Search latency benchmarks measure P50, P95, and P99 for keyword, synonym-expanded, faceted, graph-neighborhood, and explanation-panel queries.
- Ingestion benchmarks measure fixture and pilot-sized batch duration, retry overhead, checkpoint overhead, and normalized output throughput.
- Validation benchmarks measure ontology syntax validation, SHACL validation, mapping completeness validation, provenance coverage validation, export generation, and artifact hash generation windows.
- Workflow benchmarks measure review-queue listing, validation preview, release-candidate generation, and rollback activation.
- Preliminary pilot-scale thresholds are: P95 search and explanation queries at or below 2 seconds on the bounded pilot fixture; connector fixture reruns at or below 10 minutes per public connector on CI runners; release validation, export generation, and artifact hashing at or below 15 minutes for the pilot release candidate; rollback activation smoke at or below 5 minutes.
- DevOps and QA must revise these thresholds in Phase 2 after connector fixture sizes are known and again in Phase 5 after search index shape and pilot data volume are known.

### End-to-End

- E2E tests must follow user-visible workflows across connectors, normalization, AI suggestions, review, validation, release, search, API export, audit, and rollback.
- The canonical E2E path is disease to target to compound to trial to evidence to proposal to approval to release to API export.
- E2E evidence must include screenshots or UI traces where a UI exists, API response snapshots, validation reports, audit-event assertions, release package metadata, and export artifacts.

## 4. MVP Acceptance Scenario Mapping

| MVP scenario | Concrete automated tests | Required evidence |
|---|---|---|
| 1. Canonical entity creation | E2E creates disease entity with preferred label, synonyms, definition, external IDs, evidence, validation, approval, staging, release, and API retrieval | Stable entity ID, SHACL pass report, evidence link, approval audit event, release artifact hash, released API response |
| 2. Connector to curated mapping | ChEMBL and UniProt fixtures ingest compound and target records, normalization proposes relationship, reviewer approves, release publishes, search explains relationship | Source-version pins, raw artifact hashes, normalized candidate, confidence score, evidence trace, approval audit event, released relationship, search explanation |
| 3. AI suggestion rejection | PubMed or Europe PMC fixture creates target-disease suggestion, reviewer rejects weak evidence, feedback is stored | Suggestion object with model version and evidence span, rejection audit event, feedback record, absence from approved facts and released graph |
| 4. Release validation failure | Release candidate includes mapping missing target vocabulary version and promotion is attempted | Blocked promotion result, SHACL or mapping-completeness failure report, curator task or finding, failed-promotion audit event, unreleased candidate state |
| 5. Role-based access | Contributor attempts self-approval, viewer attempts restricted export, platform admin attempts source config change without proper role, security admin reviews audit | Blocked actions, no data leakage, required role checks, immutable audit events for all attempts, audit search visibility for authorized security admin |
| 6. Explainable search | User searches disease, pivots to targets, compounds, trials, adverse events, and documents, then opens relationship explanation | Match reason, assertion type, source evidence, provenance, confidence, release ID, role-filtered results, export with provenance |
| 7. Rollback | Promote v1.1, discover critical mapping error, roll back to v1.0, verify active release, APIs, search index, and audit | Active release returns to v1.0, v1.1 archived and auditable, rollback audit event with actor/rationale/timestamp, API active-release response, search consistency report |

## 5. Regulated Control Coverage

### Ontology Validity

- Required in local validation, pull request checks, release-candidate checks, and rollback drills.
- Blocks promotion on OWL syntax failures, critical SHACL failures, missing required fields, unsupported relationship constraints, and release package shape failures.

### Provenance Coverage

- Every assertion, mapping, evidence link, search explanation, export row, AI suggestion, normalized candidate, and release package item must have provenance.
- CI must fail on any released fixture assertion without source, source version, raw artifact reference or evidence reference, creation method, actor/service account, timestamp, and release context where applicable.

### Connector Reproducibility

- Connector tests must prove reruns from the same source-version fixture produce identical normalized outputs and artifact hashes.
- Connector tests must prove source-version changes are visible in job metadata and do not overwrite prior provenance.
- Connector output must never write directly to released graphs.

### RBAC

- RBAC tests are required at service boundaries and cannot rely on frontend controls.
- Role coverage must include viewer, contributor, curator, domain approver, release manager, compliance reviewer, security admin, platform admin, service account, and tenant-scoped user.

### Auditability

- Audit tests must cover login/logout, failed auth, role changes, source configuration changes, connector runs, entity changes, mapping changes, AI suggestions, review decisions, release staging, release promotion, rollback, exports, and admin actions.
- Audit logs must be immutable, searchable by authorized users, exportable, and linked to correlation IDs.

### Release Rollback

- Rollback tests must prove previous release graphs and release metadata are restored as the active state.
- Search indexes, API release context, export packages, and audit browser views must align with the restored active release.
- Rollback does not delete the superseded release; it archives and preserves it for audit.

### Search Explainability

- Search tests must fail if an explanation omits match reason, assertion type, confidence, evidence, provenance, source version, release ID, or role-filter status.
- Search and export tests must prove no unauthorized or restricted-source data appears through result rows, facets, counts, explanations, graph pivots, or downloads.

## 6. Fixture Strategy

### Fixture Principles

- Fixtures are small, deterministic, versioned, and reviewable.
- Every fixture has raw source data, parsed output, normalized output, expected semantic assertions, expected provenance, expected validation results, and expected audit events where workflows are involved.
- Golden fixtures must be designed around product journeys, not isolated code paths.
- Fixture names include source, source version, entity class, and scenario purpose.

### Core Fixture Sets

| Fixture set | Purpose | Minimum contents |
|---|---|---|
| Ontology fixtures | Validate classes, predicates, mappings, relationships, evidence, releases, and invalid counterexamples | Valid and invalid RDF graphs, SHACL expected results, required-field edge cases |
| Connector fixtures | Prove reproducible ingestion and source-version pinning | Raw ClinicalTrials.gov, PubMed/Europe PMC, ChEMBL, UniProt, openFDA FAERS, and internal-template payloads; expected normalized records |
| Normalization fixtures | Evaluate candidate ranking and duplicate detection | Gold labels for identifier matches, synonym matches, ambiguous cases, deprecated terms, confidence bands |
| Workflow fixtures | Prove governed transitions | Proposal records, validation findings, approval/rejection decisions, staged changes, rollback targets |
| Security fixtures | Prove RBAC and tenancy boundaries | Users, roles, tenants, restricted sources, policy cases, expected allow/deny matrix |
| Search fixtures | Prove explainability and filtering | Indexed entities, synonyms, relationships, documents, evidence, release IDs, role-filter cases |
| Release fixtures | Prove release package reproducibility | Release candidate graphs, validation reports, changelog entries, artifact hashes, approval records, rollback metadata |
| E2E fixtures | Prove MVP scenarios | Bounded therapeutic-area data slice linking disease, target, compound, trial, adverse event, document, mapping, and release |

### Fixture Storage Conventions

- `ontologies/fixtures/valid/` and `ontologies/fixtures/invalid/` for RDF and SHACL cases.
- `connectors/<source>/fixtures/raw/` for source payloads.
- `connectors/<source>/fixtures/expected/` for parsed and normalized outputs.
- `tests/fixtures/golden/normalization/` for labeled candidate-ranking sets.
- `tests/fixtures/security/` for role, tenant, source-policy, and export-policy cases.
- `tests/fixtures/search/` for query and explanation snapshots.
- `tests/fixtures/release/` for release packages, rollback targets, changelogs, validation reports, and hashes.

### Fixture Review Rules

- Connector Architect reviews connector fixtures.
- Data Governance reviews source-license and materialization fixtures.
- Ontology Architect and Standards Agent review ontology, mapping, and identifier fixtures.
- Security and Identity reviews RBAC and tenancy fixtures.
- Compliance and Validation reviews release gate, audit, and validation evidence fixtures.
- QA owns fixture test execution and regression baselines.

## 7. CI Gate Alignment

| CI gate | QA test suite | Release relevance |
|---|---|---|
| Lint | Code style and repository hygiene checks | Required before merge |
| Type check | Static typing for contracts, services, and test harnesses | Required before merge |
| Unit tests | Identifier, mapping predicate, workflow transition, provenance, and audit helpers | Required before merge and release candidate |
| Ontology validation | OWL/RDF syntax and ontology module validation | Blocks release on critical failures |
| SHACL validation on fixtures | Entity, mapping, relationship, evidence, release, and provenance shapes | Blocks release on critical failures |
| API contract tests | REST/GraphQL/SPARQL/export schema and behavior tests | Required before API-impacting merge and release candidate |
| Security scan | Dependency, container, secrets, and static security checks | Blocks release on unresolved P0 findings |
| Container scan | Image vulnerability and base image policy checks | Blocks deployment promotion on critical findings |
| Migration dry run | PostgreSQL, RDF store, search index, and object-storage metadata migration checks | Required before environment promotion |
| Connector fixture tests | Parse, retry, checkpoint, raw artifact, source-version, idempotency tests | Required before connector merge and release candidate |
| E2E smoke tests for release branches | Canonical MVP path, release promotion, search explanation, API export, rollback smoke | Required before release-candidate promotion |

## 8. Compliance Release Gate Alignment

| Compliance release gate | Required QA evidence |
|---|---|
| 1. Ontology syntax validation passes | Ontology validation report for all release graphs and ontology modules |
| 2. SHACL validation passes | SHACL report for entity, mapping, relationship, evidence, release, and provenance shapes |
| 3. Mapping completeness validation passes | Mapping report proving source, target, predicate, vocabulary versions, confidence, evidence, status, reviewer, and release membership where applicable |
| 4. Provenance coverage validation passes | Coverage report proving every released assertion and export row has complete provenance |
| 5. RBAC regression tests pass | Allow/deny matrix execution report for roles, tenants, workflows, search, API, audit, admin, and export paths |
| 6. Audit event tests pass | Audit assertion report for regulated actions, failed attempts, release events, rollback, and privileged exports |
| 7. Export reproducibility tests pass | Export artifact comparison report with release ID, provenance, source versions, and artifact hashes |
| 8. Rollback test passes | Rollback drill report proving active release, APIs, search index, metadata, and audit after rollback |
| 9. Search explainability smoke tests pass | Search explanation snapshots for entity, relationship, evidence, source version, release ID, confidence, assertion type, and role filtering |
| 10. Human approval recorded for regulated modules | Approval trace report linking named approvers, roles, timestamps, rationale, release candidate, audit events, and policy-approved service-account attribution with accountable owner when automation participates |

## 9. Per-Phase Exit Criteria Alignment

| Phase | QA exit evidence |
|---|---|
| Phase 0: Product charter and architecture lock | This strategy exists; validation gates are mapped; Red Team has no unresolved P0 findings; test ownership and fixtures are defined |
| Phase 1: Semantic spine | Entity creation, mapping validation, provenance validation, RDF export, and SHACL-blocked release tests pass on fixtures |
| Phase 2: Connector and ingestion foundation | At least three connector fixture suites pass; jobs are idempotent; source versions are pinned; raw artifacts are stored; connectors do not write to released graphs |
| Phase 3: Entity normalization and mapping registry | Candidate generation, confidence routing, mapping review, mapping export, rejected mapping audit, and duplicate flagging tests pass |
| Phase 4: Workflow, governance, and audit | Proposal, validation preview, review, staging, release candidate, critical-failure block, audit trail, and rollback metadata tests pass |
| Phase 5: Search, explainability, and workbench UI | Search, facets, explanation payload, evidence access, assertion type, RBAC filtering, entity page, and provenance export tests pass |
| Phase 6: AI-assisted curation beta | AI suggestion review queue, evidence span, model/prompt version, feedback capture, low-confidence routing, visual distinction, and no-auto-release tests pass |
| Phase 7: MVP hardening and pilot readiness | Full regression suite, security review, validation package, backup/restore drill, release/rollback drill, KPI dashboard checks, and no unresolved P0/P1 findings |

## 10. Test Evidence And Reporting

Every release-candidate test run must produce:

- Test run ID, commit or artifact version, environment, timestamp, and runner identity.
- CI gate summary with pass/fail status and links to reports.
- Ontology and SHACL validation reports.
- Connector reproducibility reports with source versions and raw artifact hashes.
- Normalization evaluation report with precision, recall, F1, false-positive rate, reviewer acceptance rate, and confidence calibration.
- RBAC and tenant isolation allow/deny matrix report.
- Audit event coverage report.
- Export reproducibility report with artifact hashes.
- Search explainability smoke snapshots.
- E2E traceability report mapping scenario steps to evidence.
- Release rollback drill report.

Evidence artifacts explicitly depend on the forthcoming Validation/Release audit-storage ADR, expected as ADR-0002. QA and DevOps must not finalize the CI evidence harness or report persistence conventions before that ADR defines the regulated evidence store.

Minimum requirements for that ADR are:

- Immutability: release-candidate evidence must be append-only or content-addressed, protected from normal admin edits, and linked to audit events and release IDs.
- Retention: evidence must have a documented retention period, environment scope, access policy, and deletion/legal-hold behavior suitable for regulated validation evidence.
- Format: reports must use machine-readable formats for gating plus human-readable summaries for compliance review, with stable schemas for validation, RBAC, audit, export reproducibility, rollback, search explainability, and E2E traceability.

## 11. Test Automation Roadmap

1. Establish fixture repository layout and naming conventions.
2. Add unit and ontology validation runners.
3. Add connector fixture harness and reproducibility snapshots.
4. Add normalization golden-set evaluator.
5. Add API contract test harness.
6. Add workflow state-machine and audit assertion harness.
7. Add RBAC and tenancy negative-test matrix.
8. Add search explainability snapshot tests.
9. Add release package and rollback drill tests.
10. Add full E2E smoke suite for the seven MVP acceptance scenarios.
11. Wire suites to CI gates and release-candidate evidence packaging.
12. In Phase 1, QA and DevOps must standardize test runners, report formats, report schemas, and CI artifact conventions before broad suite implementation.

## 12. Blocking Conditions For QA Sign-Off

QA must block merge, release candidate, or production promotion when applicable if any of the following are true:

- Critical ontology or SHACL validation failure exists.
- Mapping lacks source vocabulary version, target vocabulary version, evidence, confidence, or lifecycle status.
- Released assertion lacks provenance.
- AI suggestion appears as approved fact or bypasses review.
- Unauthorized user can mutate governed data, approve regulated changes, view restricted data, or export restricted data.
- Search leaks unauthorized or cross-tenant data in rows, counts, facets, explanations, graph pivots, or exports.
- Licensed source data is materialized or exported against policy.
- Export lacks release ID, stable IDs, source IDs, source versions, or provenance.
- Rollback fails to restore active release graph, metadata, API behavior, or search index consistency.
- Audit event is missing for a regulated or privileged action.
- Safety data is presented as causal without evidence and disclaimers.
- Connector rerun is not idempotent or cannot reproduce pinned-source output.
- Release candidate lacks changelog, artifact hashes, validation evidence, source-version pins, approvals, or rollback target.
- Red Team has unresolved P0 findings.

Security Impact:

- Security testing is required across auth, RBAC, tenancy, privileged exports, secrets handling, audit access, service accounts, search filtering, API filtering, and connector source configuration.
- QA will not accept frontend-only security checks; all authorization behavior must be tested at service/API boundaries.
- Security evidence must be included in CI reports and release-candidate packages.

Compliance Impact:

- This strategy maps QA evidence to the ten Compliance and Validation release gates.
- Release promotion must remain blocked until validation, RBAC, audit, export reproducibility, rollback, search explainability, and human approval evidence pass.
- QA evidence must be retained as part of the computerized-system validation and release certification package.

Data and Provenance Impact:

- Every test fixture and expected result must model source, source version, raw artifact reference, evidence, confidence, assertion type, lifecycle status, actor/service account, timestamp, and release context where relevant.
- Provenance coverage is a first-class test gate, not an optional data-quality metric.
- Connector and export tests must preserve raw artifacts, source-version pins, artifact hashes, license policy, and reproducible output.

Risks:

- Test fixtures may become too synthetic and fail to represent real pharma ambiguity; mitigate by adding curated edge cases from each connector and domain.
- Broad E2E scope may slow CI; mitigate by splitting fast PR gates from release-branch smoke and full release-candidate suites.
- Search explainability can regress silently if snapshots only check visible text; mitigate by asserting structured explanation payloads.
- RBAC can be bypassed through secondary paths such as facets, counts, exports, audit search, object references, and graph pivots; mitigate with negative tests on every retrieval path.
- Validation gates can drift from Compliance expectations; mitigate by reviewing this strategy with the Compliance and Validation Agent before Phase 0 exit.

Open Questions:

- What exact pilot therapeutic area will seed the bounded E2E fixture?
- Which exact test runner stack will DevOps and QA standardize in Phase 1 for TypeScript, Python, RDF/SHACL, browser E2E, and performance tests?
- Which Phase 2 and Phase 5 pilot data volumes will replace the preliminary performance thresholds?
- What artifact store, retention policy, and report format will ADR-0002 define for compliance evidence retention?
- What source-license classes and export policies will Data Governance define for internal and licensed data fixtures?

Handoff To:

- Compliance and Validation Agent: review release-gate alignment, evidence retention, and validation package requirements.
- DevOps and Platform Agent: wire the listed suites into CI gates and release-branch gates.
- Ontology Architect and Standards Agent: provide ontology, mapping, identifier, and SHACL fixtures.
- Connector Architect and Public Connector Implementation Agent: provide source fixtures and reproducibility expectations.
- Security and Identity Agent: provide RBAC matrix, tenant model, privileged action list, and service-account policies.
- Workflow and Governance Backend Agent: provide state machine and audit event contract.
- Search and Retrieval Agent: provide explanation payload contract and search fixture schema.
- API Agent: provide API schemas and export contracts for contract tests.
- Release Manager Agent: provide release package, changelog, artifact hash, and rollback metadata contract.
- Red Team Agent: review for P0 gaps before Phase 0 exit.

Definition of Done Status:

- Done for Phase 0 draft: includes the 10 required Agent 22 test categories and examples, maps all 7 MVP acceptance scenarios to concrete tests, covers ontology validity, provenance coverage, connector reproducibility, RBAC, auditability, release rollback, and search explainability, aligns QA evidence to Agent 24 CI gates and Agent 21 release gates, maps tests to Phase 9 exit criteria, and defines a fixture strategy.
- Pending downstream review: ADR-0002 for Validation/Release audit storage, DevOps CI implementation review, Phase 1 QA/DevOps test-runner standardization, and Red Team follow-up closure.
