# VALIDATION_PLAN.md

Task:
Define the PharmaOps Phase 0 validation plan for regulated semantic releases, including SHACL validation, release quality gates, compliance evidence, audit requirements, approval traceability, rollback drills, and hard blocking rules.

Assumptions:
- PharmaOps MVP is a regulated semantic control plane, not a generic ontology editor, graph database, AI search tool, ELN, or LIMS replacement.
- Regulated publication means promotion into an immutable released semantic graph or release package that downstream users, APIs, exports, or search can consume.
- AI, deterministic normalization, and connector outputs may propose assertions, mappings, synonyms, definitions, and relationships, but no regulated change is published without governed validation and human or policy-approved approval.
- Release validation is enforced by backend workflow and release services. Frontend status indicators are informational only.
- Phase 0 defines the control plan. Later phases implement the scripts, service APIs, CI jobs, audit store, and release ledger.

Inputs Reviewed:
- `pharmaops_multi_agent_exportable_prompt.md` sections 1.1-1.3, 2.1-2.2, 3.2, 4.1-4.5, 5, 6.1-6.3, 7 Agent 20, 7 Agent 21, 7 Agent 22, 10.3, 10.4, 10.5, 10.6, 11.2, 12, 15, and 16.
- `hive/board.md` Phase 0 assignment and role map.
- `hive/tasks.json` task P0-06 acceptance criteria.

Changes Proposed:
- Establish 10 mandatory release gates for every regulated semantic release.
- Treat the full blocking failure list from the master prompt as hard promotion blockers.
- Define the release candidate validation sequence and required evidence package.
- Define approval traceability, artifact hash, changelog, source-version pin, audit, and rollback expectations.
- Define handoffs to QA/Test Automation, Security/Identity, Release Management, Workflow Backend, Semantic Store Backend, Provenance/Evidence, DevOps, and Red Team.

Artifacts Created or Modified:
- Created `C:\Projects\Project10\VALIDATION_PLAN.md`.

Interfaces Affected:
- Release candidate workflow.
- SHACL and ontology validation runner.
- Mapping and provenance validation.
- RBAC and audit test suites.
- Release ledger and release package schema.
- Audit search/export APIs.
- Entity, mapping, search, and export APIs that expose release context and provenance.
- Rollback workflow and semantic store named graph activation.

Tests Added or Required:
- Ontology syntax validation.
- SHACL validation.
- Mapping completeness validation.
- Provenance coverage validation.
- RBAC regression tests.
- Audit event tests.
- Export reproducibility tests.
- Rollback tests.
- Search explainability smoke tests.
- Approval traceability checks for regulated modules.

Security Impact:
- Release promotion must fail if unauthorized mutation is possible, if RBAC regression tests fail, if search/API/export leaks unauthorized or cross-tenant data, if service accounts have broader access than necessary, or if privileged actions are not audited.

Compliance Impact:
- Promotion is blocked by critical validation failures, missing evidence, missing approval trace, missing audit records, missing source-version pins, missing artifact hashes, missing changelog, failed rollback, or unresolved P0 Red Team findings.
- Compliance reviewers certify regulated release packages; they do not replace domain approval or release manager approval.

Data and Provenance Impact:
- Every released assertion, mapping, relationship, search result, export row, and AI-derived suggestion must preserve source, source version, evidence, confidence where applicable, assertion type, actor/service account, timestamp, validation result, and release ID.

Risks:
- SHACL can prove structural validity but not scientific truth; domain approval and evidence review remain mandatory.
- Validation jobs can become slow as graphs grow; the MVP needs bounded fixtures and later incremental validation design.
- Licensed vocabularies and source datasets can create materialization restrictions that must be checked before release and export.
- Rollback can restore release graphs while dependent search indexes, caches, and downstream consumers lag unless rollback includes consistency checks.

Open Questions:
- Which implementation will be authoritative for immutable audit storage: append-only database table, object-lock storage, external ledger, or managed audit service?
- Which release manager artifact will own the canonical release package record: `RELEASE_LEDGER.md`, database record, object storage manifest, or all three with one primary source of truth?
- Which regulated modules require explicit human compliance approval in the MVP pilot beyond the default release manager and domain approver approvals?

Handoff To:
- QA/Test Automation: convert gates and acceptance scenarios into automated, CI-runnable suites.
- Security/Identity: align RBAC regression, tenant isolation, audit immutability, service-account attribution, and privileged-action logging.
- Release Manager: convert evidence package and rollback drill into release checklist and `RELEASE_LEDGER.md` structure.
- Workflow Backend: enforce state transitions, approval traceability, failed-promotion tasks, and audit emission.
- Semantic Store Backend: implement named graph release snapshots, validation execution, export generation, and rollback graph activation.
- Provenance/Evidence: define assertion, evidence, and source-version coverage contracts.
- DevOps/Platform: run gates in CI/CD and require backup/restore evidence before production promotion.
- Red Team: review this plan for release bypass, audit bypass, rollback weakness, and data-governance gaps.

Definition of Done Status:
- Draft complete for Phase 0 P0-06. It includes 10 release gates, hard blocking rules, release pipeline validation steps, evidence package, artifact hash/changelog/source-version requirements, approval traceability, audit immutability/search/export requirements, rollback drill, and MVP acceptance scenario mapping.

## Validation Control Objectives

The validation program exists to prove that a PharmaOps release is:

1. Structurally valid: ontology modules parse and conform to approved syntax and namespace rules.
2. Constraint-valid: RDF entities, mappings, relationships, evidence, provenance, and release metadata satisfy SHACL and quality constraints.
3. Governed: every regulated change follows proposal, validation, review, approval, staging, and promotion workflow.
4. Traceable: every released assertion and workflow action links to source, source version, evidence, actor or service account, timestamp, validation result, and release.
5. Secure: RBAC, tenant isolation, export controls, and privileged-action logging prevent unauthorized mutation or disclosure.
6. Reproducible: release package contents can be regenerated from pinned source versions, immutable snapshots, artifact hashes, and documented build parameters.
7. Rollbackable: the platform can restore the previous active release graph and release metadata without ad hoc partial edits.
8. Auditable: regulated actions are immutable, searchable, exportable, and attributable.
9. Explainable: released search and relationship views show why results appear, what evidence supports them, and which release contains them.
10. Bounded: validation enforces MVP scope and prevents unreviewed expansion into unsupported data, workflows, or claims.

## Release Candidate Scope

A release candidate may include:

- Ontology modules and SHACL shapes.
- Canonical entity changes.
- Synonyms, definitions, external identifiers, and lifecycle status changes.
- Mappings and mapping predicate updates.
- Relationship assertions.
- Evidence links and document/source references.
- Source connector outputs that have been normalized and approved.
- Export packages.
- Search index release manifests.
- Audit event ranges and approval records.

A release candidate must not include:

- AI suggestions that remain provisional or unreviewed.
- Assertions without provenance.
- Mappings missing source or target vocabulary version.
- Licensed materialized data without governance approval.
- Cross-tenant or unauthorized data.
- Safety claims presented as causal without appropriate evidence and disclaimers.
- Connector outputs that cannot be reproduced or rerun idempotently.

## Required Release Gates

Each regulated semantic release must pass all 10 gates before promotion. Gate failures must be recorded in the validation report with severity, owner, affected artifact, recommended remediation, and whether promotion is blocked.

| Gate | Name | Required evidence | Blocking rule |
|---|---|---|---|
| 1 | Ontology syntax validation passes | Parser output for OWL/RDF/Turtle/JSON-LD or selected serialization, namespace checks, module list | Critical parse, namespace, or import failure blocks promotion |
| 2 | SHACL validation passes | SHACL report for entities, mappings, relationships, evidence, provenance, release metadata, and named graph membership | Critical SHACL validation failure blocks promotion |
| 3 | Mapping completeness validation passes | Mapping report showing source ID, target ID, predicate, source vocabulary version, target vocabulary version, confidence, evidence, reviewer, status, provenance, and release membership | Any release mapping missing source vocabulary version or target vocabulary version blocks promotion |
| 4 | Provenance coverage validation passes | Coverage report for assertions, mappings, evidence links, source records, AI suggestions, and workflow actions | Any released assertion without provenance blocks promotion |
| 5 | RBAC regression tests pass | Test report for mutating actions, approvals, exports, search/API role filters, tenant isolation, and service-account scopes | Unauthorized mutation or data leak blocks promotion |
| 6 | Audit event tests pass | Test report proving audit events for auth, role changes, connector runs, entity changes, mapping changes, AI suggestions, review decisions, release staging, promotion, rollback, exports, and admin actions | Missing audit event for regulated action blocks promotion |
| 7 | Export reproducibility tests pass | Export manifest with release ID, artifact hashes, source-version pins, provenance, stable IDs, and regeneration result | Export lacking release ID or provenance blocks promotion |
| 8 | Rollback test passes | Rollback drill report showing prior release graph and metadata can be restored, APIs report the restored active release, and search index is consistent | Failed rollback procedure blocks promotion |
| 9 | Search explainability smoke tests pass | Smoke test report for result explanation, assertion type, evidence, confidence, source version, release ID, and role-filtered results | Search leak or missing explanation for governed results blocks promotion |
| 10 | Human approval recorded for regulated modules | Named approver records for domain approval, compliance certification, release manager approval, timestamps, rationale, and service-account attribution where policy-approved automation is used | Missing named approval trace blocks promotion |

## Hard Blocking Failure Conditions

The system must block promotion or release if any of these occur:

- Critical SHACL validation failure.
- Mapping without source vocabulary version or target vocabulary version.
- Assertion without provenance.
- AI suggestion shown as approved fact.
- Unauthorized user can mutate governed data.
- Search leaks unauthorized or cross-tenant data.
- Licensed source is materialized without approval.
- Export lacks release ID or provenance.
- Rollback procedure fails.
- Audit event missing for a regulated action.
- Safety data presented as causal without appropriate evidence and disclaimers.
- Connector cannot be rerun idempotently.
- Production deployment lacks backup/restore evidence.
- Release candidate lacks changelog, artifact hashes, validation evidence, source-version pins, or approval trace.

Additional Phase 0 merge blockers:

- Requirements are not linked.
- Data contracts are not updated where affected.
- APIs are undocumented where affected.
- RBAC behavior is undefined for affected user actions or data access.
- Audit events are missing where needed.
- Provenance is not preserved.
- Required unit, integration, ontology/SHACL, E2E, or relevant security tests fail.
- Observability and documentation are missing for affected release paths.
- Red Team has unresolved P0 blocking findings.
- Release Manager cannot include the change in a release candidate.

## Release Pipeline Validation Steps

The release pipeline must run in this order:

1. Create release candidate from approved changes only.
2. Freeze candidate contents and assign a release candidate ID.
3. Resolve included named graphs: ontology, canonical data, mappings, evidence, source-version graphs, and release metadata.
4. Verify every included change is in an approved workflow state and has required rationale.
5. Run ontology syntax validation.
6. Run SHACL validation.
7. Run mapping completeness validation.
8. Run provenance coverage validation.
9. Run RBAC regression tests.
10. Run audit event tests.
11. Run search explainability smoke tests.
12. Run export generation.
13. Run export reproducibility checks.
14. Generate changelog.
15. Generate artifact hashes.
16. Verify source-version pins and connector reproducibility metadata.
17. Verify compliance evidence package completeness.
18. Execute rollback drill or verify a current successful rollback drill for this candidate class.
19. Store immutable snapshot.
20. Require release manager and compliance approval.
21. Promote release by activating immutable release graph and release metadata.
22. Update release ledger.
23. Publish export package and API/search release context.
24. Preserve rollback target to previous release.

Promotion must not proceed after a critical failure. Non-critical findings may proceed only when explicitly accepted by release manager and compliance reviewer with rationale, owner, and remediation due date.

## Validation Reports

Every validation run must produce a machine-readable and human-readable report containing:

- Validation run ID.
- Release candidate ID.
- Environment.
- Triggering actor or service account.
- Timestamp and duration.
- Tool versions and validation ruleset versions.
- Source graph IDs and source-version pins.
- Artifact inputs and artifact hashes.
- Gate results with pass/fail/warn status.
- Finding severity: P0 blocker, P1 major, P2 minor, informational.
- Affected entity, mapping, source record, graph, export, or workflow object.
- Remediation owner.
- Linked task or review queue item when remediation is needed.
- Audit event range for the validation run.
- Final promotion eligibility decision.

Validation reports must be immutable once attached to a release candidate. Superseding a report requires a new validation run ID and audit event.

## Compliance Evidence Package

Each release package must include:

- Release ID and semantic version.
- Release candidate ID.
- Created timestamp and creating actor or service account.
- Environment and tenant/domain scope.
- Included ontology modules and versions.
- Included SHACL shapes and validation ruleset version.
- Included mapping files or graph manifests.
- Source versions for all connector inputs and external vocabularies.
- Approved change requests and workflow IDs.
- Validation reports for all 10 gates.
- Changelog.
- Artifact hashes.
- Export URIs and export hashes.
- Named graph snapshot IDs.
- Search index release manifest.
- Audit event range.
- Approval records with named users, roles, timestamps, and rationale.
- Service-account approvals only where policy allows, including policy ID and owning human role.
- Rollback target release ID.
- Rollback drill evidence.
- Audit retention class, legal-hold status, and audit export format/version.
- Known issues and accepted non-critical findings.
- Data license/materialization clearance where licensed sources are included.
- Backup/restore evidence for production deployments.

The package must be stored in object storage or equivalent immutable artifact storage and referenced by the release ledger.

## Artifact Hash Requirements

Artifact hashes are mandatory for reproducibility and tamper evidence.

Required hashed artifacts:

- Ontology module files.
- SHACL shape files.
- Mapping files and mapping export package.
- Release graph snapshot manifests.
- Source snapshot manifests.
- Validation reports.
- Changelog.
- Export files.
- Search index release manifest.
- Release package manifest.
- Rollback drill report.

Hash requirements:

- Use SHA-256 unless the platform standard chooses a stronger approved algorithm.
- Record hash algorithm, value, artifact URI, artifact media type, generated timestamp, and generating service account.
- Hashes must be created before promotion and included in the release package.
- Hash mismatch after package creation is a P0 blocker and must trigger incident review.

## Changelog Requirements

Every release candidate must have a changelog that includes:

- Release candidate ID and target release ID.
- Previous release ID.
- Added, changed, deprecated, superseded, and removed semantic assets.
- Entity, mapping, relationship, evidence, and ontology module counts.
- Human-readable summary of material changes.
- Linked approved change requests.
- Validation rule changes.
- Source-version changes.
- Known issues and accepted non-critical findings.
- Rollback target and compatibility notes.

Missing changelog blocks promotion.

## Source-Version Pin Requirements

Every release must pin sources and vocabularies used to create released artifacts.

Minimum required pins:

- Connector source name.
- Source version or retrieval timestamp when the source has no formal version.
- Raw artifact ID and record hash.
- Vocabulary name, vocabulary version, and license/materialization rule.
- Ontology module version.
- SHACL ruleset version.
- Normalization ruleset version.
- AI model version and prompt/policy version for AI suggestions that became governed proposals.
- Export schema version.

Unpinned source versions block promotion.

## Approval Traceability

Approval records must be attributable to named users or policy-approved service accounts.

Minimum approval fields:

- Approval ID.
- Release candidate ID.
- Approved object or module.
- Actor ID.
- Actor display name where available.
- Actor role.
- Tenant/domain scope.
- Approval type: domain approval, compliance certification, release manager approval, data governance approval, security approval, or exception approval.
- Timestamp.
- Rationale.
- Validation report ID reviewed.
- Before and after artifact hashes or graph snapshot IDs.
- Related audit event ID.

Required approval separation:

- Contributors must not approve their own regulated changes.
- Domain approvers approve module-specific semantic correctness.
- Compliance reviewers certify validation evidence and regulated workflow completeness.
- Release managers approve final technical promotion readiness.
- Data governance approval is required before materializing or exporting restricted licensed data.
- Security approval is required for policy exceptions, privileged access changes, or release paths that alter access-control behavior.

Missing approval trace blocks promotion.

## Audit Requirements

Audit logs must be immutable, searchable, and exportable.

Audit events are required for:

- Login, logout, failed authentication, and session elevation.
- Role changes and permission policy changes.
- Source configuration changes.
- Connector runs, retries, failures, and source-version capture.
- Entity changes.
- Mapping changes.
- Relationship changes.
- Evidence link changes.
- AI suggestions and model/prompt/policy version capture.
- Review decisions, approval decisions, rejection decisions, and revision requests.
- Release candidate creation.
- Validation run start, completion, and failure.
- Release staging.
- Failed promotion attempt.
- Release promotion.
- Rollback initiation and completion.
- Exports and export failures.
- Admin actions.

Audit immutability requirements:

- Normal administrators must not be able to edit or delete audit events.
- Corrections must be append-only compensating events.
- Audit event IDs must be stable.
- Audit records must include actor or service account, role, timestamp, tenant/domain scope, source IP or service origin where available, target object, action, rationale where required, before/after hashes where applicable, validation report ID where applicable, and release ID where applicable.
- Audit export must support release-scoped and date-range-scoped evidence exports for compliance review.

Missing audit event for a regulated action blocks promotion.

### Audit Retention, Legal Hold, and Export Format

Audit and release evidence retention must be explicit in each release package and tenant policy.

Minimum retention controls:

- Audit events, validation reports, approval records, release packages, artifact hashes, source-version manifests, rollback drill reports, and audit exports must have a retention class.
- Retention class must identify minimum retention duration, owning tenant or platform policy, and disposition owner.
- Legal hold must prevent deletion, compaction, or lifecycle expiration of audit and release evidence until the hold is lifted by an authorized compliance or legal process.
- Retention and legal-hold changes are privileged regulated actions and must emit immutable audit events.
- Audit exports must include enough metadata to prove retention scope, legal-hold status, export actor, export timestamp, release ID or date range, tenant scope, filter criteria, and export artifact hash.

Minimum audit export formats:

- Machine-readable JSON Lines for event-by-event inspection and downstream validation.
- CSV for compliance review workflows that require spreadsheet-compatible evidence.
- Signed manifest containing export ID, export schema version, filter criteria, event count, artifact hashes, created timestamp, actor or service account, tenant scope, and release/date range.

If the platform cannot prove audit retention policy, legal-hold status, and export manifest integrity for a release candidate, production promotion is blocked until evidence is complete.

## Rollback Drill

Rollback must restore a previous release graph and release metadata, not perform ad hoc partial edits.

Required drill frequency:

- At least once before the first production release.
- For every release candidate class that changes release graph activation, release metadata, export packaging, or search index activation.
- After any P0 release incident or rollback failure.

Required rollback drill steps:

1. Select current release `vCurrent` and previous release `vPrevious`.
2. Promote or simulate promotion of `vCurrent` in a release-candidate environment.
3. Record active release ID, graph snapshot IDs, release metadata, export manifest, API release context, and search index manifest.
4. Initiate rollback to `vPrevious` through the release manager workflow.
5. Require actor, role, rationale, and compliance-visible audit event.
6. Restore `vPrevious` release graph as active.
7. Restore `vPrevious` release metadata as active.
8. Confirm `vCurrent` remains archived and auditable.
9. Repoint API release context to `vPrevious`.
10. Rebuild or reactivate search index consistent with `vPrevious`.
11. Verify exports resolve to the restored release context and preserve provenance.
12. Confirm audit log records rollback actor, rationale, timestamp, before release, after release, and affected artifacts.
13. Confirm no working graph or staging graph was mutated by rollback.
14. Run smoke tests for entity retrieval, mapping retrieval, search explainability, export, and audit search.
15. Generate rollback drill report and artifact hash.

Rollback pass criteria:

- Previous release becomes active again.
- Superseded release remains archived and auditable.
- Rollback event is recorded with actor, role, rationale, timestamp, before release, after release, and release candidate context.
- APIs report correct active release.
- Search index is consistent with restored release.
- Export package and provenance remain available.
- Audit export includes the rollback event.

Rollback failure blocks promotion until fixed and successfully retested.

## MVP Acceptance Scenario Coverage

| Scenario | Validation plan coverage |
|---|---|
| Scenario 1: Canonical entity creation | Required fields validate through SHACL, evidence is linked through provenance coverage, approval is audited, release includes artifact hashes, API retrieval is smoke-tested against release context |
| Scenario 2: Connector to curated mapping | Source versions are pinned, raw records retained, candidate evidence required, relationship cannot auto-publish, approval is auditable, search explanation is smoke-tested |
| Scenario 3: AI suggestion rejection | AI suggestions cannot appear as approved facts, rejection is audited, model version and evidence trace are retained, feedback remains available |
| Scenario 4: Release validation failure | Missing target vocabulary version is a mapping completeness failure and hard blocker; promotion is blocked, failure appears in validation report, curator remediation task is required, failed promotion is audited, candidate remains unreleased |
| Scenario 5: Role-based access | RBAC regression tests block contributor self-approval, unauthorized export, unauthorized admin actions, cross-tenant search/API/log/export leakage, and missing privileged-action audit |
| Scenario 6: Explainable search | Search explainability smoke tests require match rationale, assertion type, evidence, provenance, confidence, release ID, export with provenance, and role-filtered results |
| Scenario 7: Rollback | Rollback drill requires restoration of previous release graph and metadata, archived auditable superseded release, actor/rationale/timestamp audit, correct API active release, and search index consistency |

## Severity Model

| Severity | Meaning | Promotion impact |
|---|---|---|
| P0 blocker | Violation of hard blocking failure condition, regulatory workflow bypass, unauthorized mutation/disclosure, unreproducible release, failed rollback, missing approval/audit/provenance, or critical semantic integrity failure | Blocks promotion |
| P1 major | Material issue that does not currently bypass a hard gate but could compromise release readiness, user trust, maintainability, or downstream safety if unaddressed | Requires release manager and compliance exception or remediation before production |
| P2 minor | Documentation, usability, non-critical coverage, or operational improvement with bounded impact | May proceed with owner and due date |
| Informational | Observation or future improvement | Does not affect promotion |

## Environment Controls

Validation behavior by environment:

- Local: developers may run partial validation, but local pass is never sufficient for release.
- Dev: integration validation may run on non-production fixtures.
- Test: full automated validation runs on representative fixtures and seeded tenants.
- Staging: release workflow validation runs against candidate-like data.
- Release-candidate: all 10 release gates, evidence package generation, approval traceability, rollback drill, and audit export checks run here.
- Production: promotion only activates a candidate already validated and approved; production deployment also requires backup/restore evidence.

Working graphs and released graphs must remain separate in every environment. AI suggestions remain in staging until accepted into governed proposals.

## Ownership Matrix

| Control area | Primary owner | Required reviewers or partners |
|---|---|---|
| Ontology syntax validation | Semantic Store Backend | Ontology Architect, QA |
| SHACL validation | Semantic Store Backend | Compliance, Ontology Architect, QA |
| Mapping completeness | Standards and Mapping | Ontology Architect, Compliance, QA |
| Provenance coverage | Provenance and Evidence | Compliance, Connector, QA |
| RBAC regression | Security and Identity | Compliance, QA |
| Audit event tests | Security and Identity | Workflow Backend, Compliance, QA |
| Export reproducibility | Release Manager | API, Export, Provenance, QA |
| Rollback test | Release Manager | Semantic Store, Workflow, DevOps, Compliance, QA |
| Search explainability smoke | Search and Retrieval | Provenance, Security, QA |
| Human approval trace | Workflow Backend | Compliance, Security, Release Manager |

## Handoff Packet

handoff_from: andy-mqvn41pb / Compliance and Validation Agent

handoff_to:
- kelly-mqvn53uh / QA and Test Automation
- oscar-mqvn2odf / Security and Identity
- creed-mqvn7mtf / Red Team and Critical Reviewer
- god / Program Orchestrator

ticket_id: P0-06

summary: Created Phase 0 validation plan defining release gates, blocking rules, validation reports, compliance evidence package, artifact hashing, changelog, source-version pinning, approval traceability, immutable/searchable/exportable audit, rollback drill, scenario coverage, severity model, environment controls, and ownership handoffs.

artifacts_changed:
- `C:\Projects\Project10\VALIDATION_PLAN.md`

contracts_changed:
- Defines release validation contract and evidence package expectations for future workflow, semantic store, audit, export, QA, security, and release manager work.

assumptions:
- Backend services enforce validation and promotion blocks.
- Release package schema will later be formalized by the Release Manager.
- Security model will define exact RBAC permissions and audit storage implementation.
- QA strategy will translate gates into executable test suites.

test_results:
- Documentation-only Phase 0 artifact. No automated tests run.

known_limitations:
- Does not implement validation scripts.
- Does not define final audit storage technology.
- Does not define final release ledger persistence model.
- Does not enumerate every SHACL shape; `DOMAIN_MODEL.md` owns shape details.

risks:
- Validation controls need tight integration with Security, QA, Workflow, Semantic Store, and Release Management to avoid a paper-only gate.
- Rollback must include search and API release-context consistency, not only RDF graph activation.
- Licensed data controls must be revisited after `DATA_LICENSE_REGISTER.md`.

required_next_action:
- QA should map the 10 gates and Scenario 1-7 coverage into `TEST_STRATEGY.md`.
- Security should confirm audit immutability, RBAC regression, tenant isolation, service-account attribution, and privileged-action logging align with `SECURITY_MODEL.md`.
- Red Team should review for bypass paths and unresolved P0 blockers.

blocking_questions:
- None for Phase 0 draft.
