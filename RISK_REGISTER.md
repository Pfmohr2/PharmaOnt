# PharmaOps Risk Register

## Phase 0 Exit Memo

Date: 2026-06-27

Red Team recommendation: GO for Phase 1, Semantic Spine.

All Phase 0 exit criteria from the master prompt section 9 are met:

| Exit criterion | Evidence | Status |
|---|---|---|
| MVP scope documented | `PRODUCT_CHARTER.md` defines MVP scope, product thesis, requirements, personas, journeys, pilot thesis, and KPIs. | Met |
| Non-goals explicit | `PRODUCT_CHARTER.md` lists 11 MVP non-goals and scope-creep flags. | Met |
| Architecture has service boundaries | `ARCHITECTURE.md` defines major service boundaries, storage-by-type, deployment topology, named-graph policy, and ADR-0001. | Met |
| Entity model has initial classes | `DOMAIN_MODEL.md` defines the initial entity model. DM-RT-001 is accepted/resolved: god ratified 14 entity rows, including Release artifact. | Met |
| Release workflow has defined states | `DOMAIN_MODEL.md`, `ARCHITECTURE.md`, and `VALIDATION_PLAN.md` define lifecycle/release states, release snapshots, rollback, and release validation flow. | Met |
| Security model has roles | `SECURITY_MODEL.md` defines 10 required roles, role-to-permission matrix, backend enforcement, tenant isolation, service accounts, and audit controls. | Met |
| Validation gates defined | `VALIDATION_PLAN.md` defines 10 mandatory release gates, hard blocking rules, evidence package, rollback drill, and approval traceability. | Met |
| Red Team has zero unresolved P0 findings | Red Team review across all seven Phase 0 docs found 0 P0 blockers. | Met |

Open fix-before-implementation P1 items:

| Finding ID | Consuming phase | Required before |
|---|---|---|
| VP-RT-001 | Phase 1 Semantic Spine / Phase 3 Mapping Registry | Mapping schema, SHACL shapes, and release validation for restricted vocabularies. |
| VP-RT-002 | Phase 1 Semantic Spine / Phase 4 Workflow | Any policy-approved mapping approval route or release eligibility implementation. |
| PC-RT-001 | Phase 2 Connector Foundation / Phase 0b Data License Register | Connector source selection, materialization, safety-source use, and export implementation. |
| ARCH-RT-001 | Phase 1 Semantic Spine / Phase 4 Workflow | Graph access policy, break-glass workflow, semantic store permissions, and production support paths. |
| ARCH-RT-002 | Phase 4 Workflow and Audit / Phase 7 Hardening | Audit service implementation, compliance evidence retention, and release certification. |
| DM-RT-002 | Phase 1 Semantic Spine / Phase 4 Workflow | Assertion approval rules, evidence exceptions, and model-suggested assertion handling. |
| SM-RT-001 | Phase 4 Workflow and Governance | Privileged RBAC administration, self-escalation prevention, and production access controls. |
| SM-RT-002 | Phase 5 Search/Export / Phase 7 Pilot Readiness | Automated release-package exports and restricted-source export paths. |
| VAL-RT-001 | Phase 4 Workflow and Governance | Policy-approved automation and approval trace implementation. |
| VAL-RT-002 | Phase 4 Workflow and Audit / Phase 7 Hardening | Release ledger, audit evidence store, and certification package implementation. |
| QA-RT-001 | Phase 1 CI Foundations / Phase 7 Hardening | Test evidence retention, immutable report packaging, and validation evidence handoff. |

Resolved or non-blocking:
- DM-RT-001: accepted/resolved by god ratifying 14 entity rows.
- P2 and suggestion findings remain tracked but do not block Phase 1 entry.

GO/NO-GO:
GO for Phase 1, with the P1 items above treated as fix-before-implementation constraints for the phases that consume them. Do not treat Phase 0 exit as permission to implement any policy-approved automation, restricted-source export, break-glass access, or audit/release evidence path until the routed P1 controls are resolved by the owning agents.

Task:
Seed the Phase 0 Red Team risk register and review rubric for PharmaOps.

Assumptions:
- Phase 0 draft documents will arrive at the repository root for review: `PRODUCT_CHARTER.md`, `ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `VOCABULARY_POLICY.md`, `SECURITY_MODEL.md`, `VALIDATION_PLAN.md`, and `TEST_STRATEGY.md`.
- Red Team does not implement features; it produces findings and blocks Phase 0 exit when unresolved P0 findings remain.

Inputs Reviewed:
- `pharmaops_multi_agent_exportable_prompt.md` section 6.1 required output structure.
- `pharmaops_multi_agent_exportable_prompt.md` section 6.2 merge rule.
- `pharmaops_multi_agent_exportable_prompt.md` section 6.3 blocking failure conditions.
- `pharmaops_multi_agent_exportable_prompt.md` section 7 Agent 23 Red Team and Critical Reviewer Agent.
- `pharmaops_multi_agent_exportable_prompt.md` section 9 Phase 0 exit criteria.
- `pharmaops_multi_agent_exportable_prompt.md` section 17 reviewer agent base prompt.

Changes Proposed:
- Use this register as the standing Phase 0 risk ledger.
- Use the checklist below for each Phase 0 governance document review.
- Report per-document findings to `god` using P0/P1/P2/Suggestion severity and explicit release-blocking status.

Artifacts Created or Modified:
- `RISK_REGISTER.md`

Interfaces Affected:
- None. This is a governance artifact only.

Tests Added or Required:
- No automated tests added.
- Required manual review: each Phase 0 document must be checked against the rubric before Phase 0 exit.

Security Impact:
- Seeds risks covering RBAC bypass, tenant leakage through search, audit gaps, and unsafe release promotion.

Compliance Impact:
- Seeds risks covering provenance, validation gates, licensed data use, rollback evidence, and regulated-action auditability.

Data and Provenance Impact:
- Seeds risks covering missing source-version pins, mappings without evidence, exports without provenance, and AI suggestions being treated as facts.

Risks:
- Phase 0 cannot exit with unresolved P0 findings.
- Draft documents may diverge unless each artifact names owners, gates, evidence, and rollback expectations consistently.

Open Questions:
- None at scaffold time. Per-document questions will be raised as draft artifacts land.

Handoff To:
- `god` for tracking and Phase 0 gate decisions.
- Phase 0 document owners for remediation of findings.

Definition of Done Status:
- Seed register created.
- Review checklist ready.
- Per-document review pending draft arrival.

## Severity Definitions

| Severity | Meaning | Phase 0 effect |
|---|---|---|
| P0 blocker | Must fix before merge or Phase 0 exit. Creates unacceptable safety, compliance, security, provenance, validation, or release risk. | Blocks Phase 0 exit |
| P1 major | Should fix before release candidate. Significant ambiguity or missing control that can become a blocker later. | Track and remediate before RC |
| P2 minor | Can be tracked. Limited scope, clarity, or completeness issue. | Does not block Phase 0 exit |
| Suggestion | Optional improvement. | Does not block |

## Seeded Risk Register

| ID | Risk | Severity | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| R-001 | AI suggestions are mistaken for approved governed facts. | P0 | AI Curation, Workflow, Compliance | Require human approval before assertion promotion; label suggestions distinctly; audit accept/reject decisions; block release when suggestion provenance is absent. | Open |
| R-002 | FAERS, openFDA, or similar safety data is presented as causal evidence. | P0 | Product, Domain, Compliance | Require explicit disclaimers and evidence-grade labels; prohibit causal wording without appropriate evidence; include safety-data review gate. | Open |
| R-003 | Source vocabulary or target vocabulary version pins are missing. | P0 | Standards and Mapping | Require source and target vocabulary versions on mappings and release artifacts; block promotion on missing pins. | Open |
| R-004 | Mappings are created without evidence or source traceability. | P0 | Standards and Mapping, Provenance | Make mappings first-class governed objects with evidence references, confidence, reviewer, and provenance; block mappings lacking required evidence. | Open |
| R-005 | Search leaks unauthorized, cross-tenant, or unreleased data. | P0 | Security, Search, API | Enforce backend authorization filters; test tenant and role isolation; block search responses not scoped by permission and release graph. | Open |
| R-006 | Ontology grows beyond MVP scope and blocks delivery. | P1 | Ontology, Product | Mark MVP vs later entity classes; require scope review for new classes/predicates; document non-goals and defer expansions. | Open |
| R-007 | Release promotion occurs without required review or validation. | P0 | Release Manager, Compliance, QA | Enforce release gate workflow; require validation evidence, approvals, changelog, hashes, and Red Team clearance before promotion. | Open |
| R-008 | Licensed data is materialized without approval. | P0 | Data Governance, Compliance | Classify sources by license; require materialization/federation policy and approval; block unapproved licensed source storage. | Open |
| R-009 | Exports lack release ID, provenance, or evidence traceability. | P0 | API, Provenance, Release Manager | Require release ID, source graph, artifact hash, and provenance metadata on all exports; test export contract. | Open |
| R-010 | Rollback exists only as documentation and has no proven drill. | P0 | DevOps, Release Manager, Compliance | Define rollback drill, evidence capture, restore criteria, and failure handling; require successful drill evidence before release. | Open |
| R-011 | Audit events are missing for regulated actions. | P0 | Security, Workflow, Compliance | Define regulated action list; require append-only audit records for create, mutate, approve, reject, promote, export, and rollback events. | Open |
| R-012 | Connector reruns are not idempotent and corrupt governed data. | P1 | Connector Architecture, Data Pipeline | Require connector job IDs, raw artifact retention, checkpoints, deterministic normalized output, and rerun tests. | Open |
| R-013 | Production deployment lacks backup and restore evidence. | P0 | DevOps, Compliance | Require backup schedule, restore drill evidence, RPO/RTO targets, and release gate checks. | Open |
| R-014 | Release candidates omit changelog, artifact hashes, validation evidence, source-version pins, or approval trace. | P0 | Release Manager, Compliance, QA | Define release candidate manifest schema; block promotion unless all evidence fields are present. | Open |

## Phase 0 Review Checklist

Apply this checklist to each Phase 0 governance document.

| Check | Review question | Blocking threshold |
|---|---|---|
| Scope | Is MVP scope explicit, narrow, and protected by non-goals? | P1 if vague; P0 if scope permits unsafe or ungoverned release behavior. |
| Ownership | Are owners and downstream handoffs named for controls, artifacts, and remediation? | P1 if missing; P0 if no owner exists for a release-blocking control. |
| Requirements traceability | Are claims linked to the master prompt, acceptance criteria, or named governance need? | P1 if weak; P0 if a regulated requirement is contradicted or omitted. |
| Data contracts | Are governed entities, mappings, evidence, releases, and exports described with required fields? | P1 if incomplete; P0 if provenance, version pins, or release IDs are omitted. |
| RBAC | Are backend-enforced permissions defined for read and mutating actions? | P0 if frontend-only control or unauthorized mutation risk remains. |
| Tenant isolation | Are tenant boundaries enforced for storage, search, exports, and workflow actions? | P0 if cross-tenant leakage is plausible. |
| Auditability | Are regulated actions mapped to immutable audit events? | P0 if required audit events are missing. |
| Provenance | Does every assertion, mapping, export, AI suggestion, and release artifact preserve source evidence? | P0 if assertions or mappings can exist without provenance. |
| Validation gates | Are SHACL, release, compliance, rollback, and approval gates defined with block conditions? | P0 if critical failures do not block promotion. |
| AI safety | Are AI suggestions clearly non-authoritative until human approval? | P0 if suggestions can be shown or exported as approved facts. |
| Safety evidence | Are adverse-event and safety datasets prevented from being described causally without evidence? | P0 if causal claims are allowed from passive reporting data. |
| Licensing | Are source license constraints, materialization rules, and restricted vocabularies handled? | P0 if licensed materialization can occur without approval. |
| Release reproducibility | Are changelog, hashes, source-version pins, graph snapshots, and approval traces required? | P0 if release candidates can be promoted without them. |
| Rollback | Is rollback testable with drill evidence and clear success/failure criteria? | P0 if rollback is only aspirational. |
| Testability | Are acceptance criteria concrete enough for QA, security, ontology, and compliance tests? | P1 if hard to test; P0 if a required gate has no verification path. |
| Observability | Are logs, metrics, and operational evidence named for regulated workflows and releases? | P1 if omitted; P0 if production readiness relies on unobservable controls. |
| Documentation | Are constraints and decisions documented for future implementers and reviewers? | P2/P1 depending on ambiguity; P0 only if omission hides a required control. |

## Finding Format

Use this format for per-document findings sent to `god`:

```text
Finding ID:
Severity:
Issue:
Affected artifact:
Risk:
Expected fix:
Owner:
Blocks merge/release:
Evidence:
```

## Phase 0 Red Team Findings

Consolidated verdict:
- P0 blockers: 0
- P1 major findings: 12
- P2 minor findings: 6
- Suggestions: 1
- Phase 0 Red Team P0 gate: pass, assuming P1/P2 findings are tracked to owners and no new P0 appears during remediation review.

| Finding ID | Severity | Risk | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| VP-RT-001 | P1 | License controls depend on mapping/export checks, but the core mapping object lacks explicit license status or a normative license-register link. Restricted-vocabulary use may be hard to validate consistently. | Standards and Mapping; Data Governance; Compliance | Add required license fields or deterministic tenant+vocabulary+version join to the license register; make missing license assessment release-blocking for restricted vocabularies. | routed-to-owner |
| VP-RT-002 | P1 | Undefined policy-approved route could allow approval without accountable human review, weakening no-AI-auto-publication controls. | Standards and Mapping; Workflow; Compliance | Define allowed policy-approved routes; exclude AI/ML confidence-only approval; require audit evidence and accountable owner. | routed-to-owner |
| VP-RT-003 | P2 | Tenant export namespace strategy and namespace base URLs remain unresolved, creating export consistency and tenant-boundary ambiguity. | Standards and Mapping; Architecture; Security | Create ADR before namespace library implementation. | Open |
| VP-RT-004 | Suggestion | JSON Schema vs SHACL validation split is unresolved and may create duplicated validation rules. | Standards and Mapping; Ontology; QA | State JSON Schema validates API/import payloads while SHACL validates RDF/release graph constraints, unless Architecture decides otherwise. | Open |
| PC-RT-001 | P1 | Pilot source and licensed-source posture remain open while MVP scope includes ingestion, safety workflows, and exports. | Product Requirements; Data Governance; Compliance | Add Phase 0/0b decision naming pilot source classes, licensed-source defaults, and fail-closed behavior until `DATA_LICENSE_REGISTER.md` exists. | routed-to-owner |
| PC-RT-002 | P2 | KPIs lack target ranges, baseline collection plan, and owner, weakening pilot success measurement. | Product Requirements; Pilot | Add preliminary targets or explicitly defer targets to pilot plan with owner and due phase. | Open |
| ARCH-RT-001 | P1 | Architecture's platform-admin break-glass wording conflicts with stricter security-admin controlled privileged access. | Solution Architecture; Security | Align break-glass authority with `SECURITY_MODEL.md`: time-limited, justified, separately approved, tenant-scoped, audited, and not platform-admin alone. | routed-to-owner |
| ARCH-RT-002 | P1 | Audit immutability mechanism and retention boundary are not chosen. | Solution Architecture; Security; Compliance | Create audit-storage ADR or architecture subsection defining source of truth, immutability/tamper evidence, retention owner, and export evidence contract. | routed-to-owner |
| ARCH-RT-003 | P2 | RDF graph migration and cross-store consistency risks lack a migration/cutover playbook. | Solution Architecture; DevOps | Add backlog ADR/playbook for dual-read/dual-write, validation, index rebuild, and rollback during graph-store migration. | Open |
| DM-RT-001 | P1 | Domain model includes 14 entity rows while P0-03 acceptance says 13, risking acceptance and implementation drift. | Ontology; god | God ratified 14 entity rows, including Release artifact, for Phase 0 acceptance. | accepted |
| DM-RT-002 | P1 | Undefined policy-approved review and evidence-policy exceptions can weaken no-auto-publication and evidence requirements. | Ontology; Workflow; Compliance | Define exception types, exclude AI confidence-only approval, require compliance-owned policy IDs, audit events, and accountable owner. | routed-to-owner |
| SM-RT-001 | P1 | Privileged role assignment and RBAC policy changes lack explicit dual approval or self-escalation guardrails. | Security and Identity | Add separation-of-duties controls: no self-approval, second approver, expiry where applicable, and audit review. | routed-to-owner |
| SM-RT-002 | P1 | Service-account release export permissions need stronger human-owner, purpose, expiry, and license/export constraints. | Security; API/Export; Data Governance | Bind export grants to owning human role, tenant, release scope, destination, license policy, expiry/rotation, and audit review. | routed-to-owner |
| VAL-RT-001 | P1 | Policy-approved/service-account approvals are mentioned without defining constraints. | Compliance and Validation; Workflow | Define automation limits, require named accountable owner and policy ID, and require human review for AI/ML-generated semantic changes. | routed-to-owner |
| VAL-RT-002 | P1 | Audit storage and canonical release package record source of truth are open. | Compliance and Validation; Architecture; Release Manager | Decide authoritative release package and audit evidence store, or create ADR assigning source of truth and reconciliation rules. | routed-to-owner |
| VAL-RT-003 | P2 | Rollback drill reuse lacks maximum evidence staleness or invalidating-change rules. | Compliance and Validation; Release Manager | Add recency and invalidating-change rules for rollback drill evidence. | Open |
| QA-RT-001 | P1 | Compliance evidence retention store and report format are unresolved. | QA; Compliance; DevOps | Add evidence artifact requirements or depend explicitly on a Validation/Release ADR before test harness implementation. | routed-to-owner |
| QA-RT-002 | P2 | Performance gates lack pilot-scale thresholds. | QA; Product; DevOps | Add preliminary thresholds or due phase/owner for setting them after pilot data volume is known. | Open |
| QA-RT-003 | P2 | Test runner stack and report output conventions are open. | QA; DevOps | Add Phase 1 DevOps/QA decision to standardize test runners and report outputs. | Open |

## Phase 1 Red Team Findings

| Finding ID | Severity | Risk | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| P1-RT-001 | P0 | SHACL previously allowed `model_suggested` assertions to have `lifecycleStatus` `released` and release graph membership when model metadata/evidence was present. Red Team re-verified Kevin's fix: `ModelSuggestedPublicationBlockerShape` now blocks `model_suggested` or `methodType "model"` mapping/relationship assertions from approved/staged/released states and release named-graph membership. | Ontology; QA; Workflow | Constraint and negative fixtures added; `npm run test:ontology` passes and release validation fails loudly for model-suggested release membership. | accepted |
| P1-RT-002 | P1 | Mapping SHACL validates required fields but does not yet block release membership for `requiresReview`/`uncertainMatch` predicates or `draft`/`proposed`/`rejected`/`deprecated` review states. | Ontology; Standards and Mapping; QA | Add release-eligibility SHACL or validation rules for mapping assertions: release graph membership requires eligible predicate, approved/released review state, evidence, provenance, and source/target versions. | Open |
| P1-RT-003 | P1 | Relationship assertion JSON Schema enum diverges from `DOMAIN_MODEL.md`: it omits `asserted` and adds `administrative`. | Standards and Mapping; Provenance; QA | Align the relationship schema enum with the domain model or document a formal replacement. Add tests proving direct source-backed `asserted` relationships are accepted and unsupported assertion types are rejected. | Open |
| P1-RT-004 | P1 | The executable ontology harness previously lacked negative coverage for model-suggested release and release-ineligible mapping state. | QA; Ontology; DevOps | Negative fixtures/tests now cover model-suggested approved/release-membered assertions and release-ineligible mapping state; `npm run test:ontology` passes. | accepted |
| P1-RT-005 | P2 | Root aggregate npm test command was previously missing. | DevOps; QA | Root `package.json` now provides aggregate `npm test`; verified current aggregate test baseline passes. | accepted |
| P1-RT-006 | P0 | `FusekiClient` was exported and exposed raw `putGraph`, `insertTurtle`, `copyGraph`, `clearGraph`, and `update` methods with no tenant, graph-family, provenance, lifecycle, or SHACL guard. This bypassed `ReleaseSnapshotService` and could write `model_suggested` or unvalidated triples directly into `graph:tenant:*:release:*`. | Semantic Store; Security; QA | Public semantic-store exports no longer expose `FusekiClient`; public writes go through `SemanticGraphWriter`, `MappingStore`, or `ReleaseSnapshotService`. Negative tests cover missing export, direct release-graph write rejection, cross-tenant write rejection, and model-suggested release rejection. | accepted |
| P1-RT-007 | P1 | Phase 1 mapping validation was present in contracts/fixtures and release-time validation, but the semantic store had no mapping write API that validated source/target vocabulary versions at write time. | Semantic Store; Standards and Mapping; QA | `MappingStore.createMapping` now validates the mapping contract, source/target vocabulary versions, predicate enum, license status, provenance, tenant graph policy, and SHACL before persistence. Unit coverage passes. | accepted |
| P1-RT-008 | P1 | `ReleaseSnapshotService` returned a `release_metadata_record` and wrote a local JSON manifest, but it did not persist the ADR-0002 canonical release metadata ledger row or verify ledger/object digest agreement. | Semantic Store; DB; Release Manager; QA | Ledger persistence and digest reconciliation were added, but Red Team found a residual fail-closed ordering bug tracked as P1-RT-009. | superseded |
| P1-RT-009 | P0 | `ReleaseSnapshotService` previously copied the validated working graph into the release graph before ledger insert and digest reconciliation. If `releaseLedger.insertReleaseMetadata` returned a mismatched manifest digest, the method threw after creating an orphan immutable release graph without a valid ADR-0002 package record. | Semantic Store; DB; Release Manager; QA | Snapshot creation now performs source-version reconciliation, manifest write/digest check, ledger insert, and ledger digest reconciliation before copying into the final release graph. Negative tests prove ledger mismatch and unreconciled source versions leave zero release graph triples. Local unit/ontology/full suites pass; live Fuseki/Postgres controls remain CI/Docker evidence. | accepted |

## Phase 2 Red Team Findings

| Finding ID | Severity | Risk | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| P2-RT-001 | P0 | The service runtime previously allowed post-normalization release graph and `release_id` injection, and the SDK defense-in-depth guard was bypassable through release targets inside candidate arrays. | Ingestion; Connector SDK; Security; QA | Runtime and SDK now recursively scan final emitted outputs, including `normalized_record`, normalization handoff, `candidate_entities`, `candidate_relationships`, `candidate_mappings`, nested graph fields, and release fields. Negative tests and Red Team probes verify candidate-array release target injection fails before normalized persistence. | Closed/verified in `services/ingestion/src/job-runner.js` and `packages/connector-sdk/src/security.js`; regressions pass |
| P2-RT-002 | P0 | The license and PII gate runs before normalization. A connector can add `contains_phi_or_pii: true` or other governed flags during normalization while the emitted `policy_decision` remains `contains_phi_or_pii: false` and `ai_eligible: true`. Direct `ConnectorBase.run()` also emits without invoking `assertIngestionPolicy`. | Ingestion; Licensing/Data Governance; Connector SDK; Security; QA | Evaluate `assertIngestionPolicy` both before raw persistence and after normalization on the final emitted object. Force emitted policy decisions to reflect final normalized state and dead-letter outputs that introduce PII, restricted license state, missing disclaimer, or other material governance changes. Consider making `ConnectorBase.run()` non-emitting unless a policy evaluator is supplied. | Closed/verified in `services/ingestion/src/job-runner.js`, `packages/licensing/src/index.js`, and `packages/connector-sdk/src/base-connector.js`; regressions pass |
| P2-RT-003 | P1 | Ingestion replay preserves the same raw artifact URI and idempotency key, but `runConnectorJob` returns normalized output and increments normalization metrics again on each rerun. The service path lacks a persistent normalized-output idempotency store or outbox guard. | Ingestion; Connector SDK; QA | Add a normalized-output store or outbox with `putIfAbsent(idempotency_key)`, return skipped duplicate counts, and prove rerun emits zero new downstream records while changed snapshot digests create explicit new versioned records rather than overwriting. | Closed/verified in `services/ingestion/src/normalized-output-store.js` and `services/ingestion/src/job-runner.js`; regression passes |
| P2-RT-004 | P0 | `retryConnectorJob(previousRun, options)` accepts an arbitrary previous run and carries its `run_lineage_id` and `checkpoint` into whatever tenant, environment, connector, or execution context is supplied in the retry options. A tenant B retry can expose tenant A lineage/checkpoint to a different connector. | Ingestion; Security; Connector SDK; QA | Fail closed unless `previousRun.tenant_id`, `environment`, connector identity, source identity/version, service account, and job ownership match the retry request and execution context. Treat checkpoint as scoped data, sign or bind it to tenant+connector+source, and add cross-tenant/cross-connector retry denial tests. | Closed/verified in `services/ingestion/src/job-runner.js`; regression passes |

## Phase 3 Red Team Surface

Standing assignment:
Adversarially verify Phase 3 Entity Normalization and Mapping Registry artifacts as they land. Phase 3 must emit governed, reviewable candidates only. Normalization, mapping registry, workflow, and RBAC paths must not create approved facts, stage release content, or write release graphs without authorized human review.

Initial watch list:

| Finding ID | Severity | Risk | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| P3-RT-WATCH-001 | P0 watch | Normalization or mapping candidates auto-publish, auto-approve, stage, or reach release graphs without curator/reviewer approval. | Normalization; Mapping Registry; Workflow; Security; QA | Verify every write path stays `draft`/`proposed`, `release_id: null`, working graph only, and cannot call release/stage APIs directly. Add negative tests for direct release graph, `approved`, `staged`, `released`, and `auto_publish` injection. | Verified closed via P3-RT-001 recheck |
| P3-RT-WATCH-002 | P0 watch | Mapping candidates drop source vocabulary version, target vocabulary version, evidence, provenance, or confidence. | Mapping Registry; Normalization; Provenance; QA | Require both vocabulary versions, evidence refs/IDs, provenance, confidence score, confidence band, and scoring signals at creation and registry ingest. Fail closed on missing or fabricated values. | Verified closed for landed paths |
| P3-RT-WATCH-003 | P1 watch | Duplicate candidates are auto-merged instead of flagged for review. | Normalization; Mapping Registry; Workflow | Verify duplicate detection produces flags and references only; no canonical merge, overwrite, supersession, or deletion occurs without workflow approval and audit. | Verified closed for candidate ingest/workflow paths |
| P3-RT-WATCH-004 | P0 watch | Rejected candidates are deleted or lose audit/provenance trail. | Workflow; Mapping Registry; Audit; Compliance | Verify rejected state is immutable/auditable, retained with provenance and decision actor, and any resubmission clones to a new draft rather than mutating history. | Verified closed for workflow rejected candidates |
| P3-RT-WATCH-005 | P0 watch | Unauthorized or cross-tenant actor approves, rejects, stages, or edits candidates by bypassing RBAC or calling workflow APIs directly. | Security; Workflow; API; QA | Verify backend-enforced RBAC and tenant scoping on every workflow transition and registry write; add direct API/service negative tests. | Verified closed via P3-RT-001 recheck |
| P3-RT-WATCH-006 | P1 watch | Confidence is fabricated or defaulted high when scoring inputs are absent. | Normalization; AI Curation; QA | Require explicit scoring signals for confidence; fail closed or mark low/unknown when inputs are missing; never infer high confidence from missing data. | Verified closed for deterministic MVP scoring |

## Phase 3 Red Team Findings

| Finding ID | Severity | Risk | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| P3-RT-001 | P0 | Direct registry self-approval bypass and stale workflow governed-transition gap. Recheck on current HEAD confirms ordinary registry CRUD cannot create/update/deprecate/supersede governed states, workflow now mints a signed governedDecision for approve/reject/stage, and registry verifies decision binding/signature plus tenant/candidate field bindings. | Mapping Registry; Workflow; Security; QA | Landed: registry gates governed states behind `applyGovernedTransition`; workflow mints full signed governedDecision after RBAC authorization; tests and custom probes cover direct CRUD bypass, valid workflow approve/reject/stage, forged signature, cross-tenant, cross-candidate, and replay fail-closed paths. | Closed - verified on current HEAD |

## Phase 4 Red Team Surface

Standing assignment:
Adversarially verify Phase 4 Workflow, Governance, Release, and Audit artifacts as they land. Phase 4 must make semantic changes reviewable, approvable, releasable, and auditable without UI dependency. Backend APIs, proposal/review queues, diff computation, validation gates, release candidate packages, rollback, RBAC, and audit storage must enforce server-side controls only.

Baseline checked 2026-06-27: current tree has Phase 1 release snapshot/ledger foundations, Phase 3 mapping workflow/registry/RBAC foundations, operational DB schema for review queues/release metadata/audit events, and README placeholders for `services/workflow` and `services/audit`. Targeted baseline `node --test tests/unit/semantic-store.test.mjs tests/security/operational-schema-security.test.mjs tests/mapping-workflow/mapping-workflow.test.mjs tests/unit/mapping-registry.test.mjs` passed 38/45 with 7 live DB-backed skips.

Initial watch list:

| Finding ID | Severity | Risk | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| P4-RT-WATCH-001 | P0 watch | A proposal, queue item, diff, release candidate, or rollback path reaches approved/staged/released state without the Phase 3 signed governed-decision path or an equivalent server-side authorization contract. | Workflow; Mapping Registry; Release Manager; Security; QA | Verify every new write boundary rejects raw status/release mutations and accepts only bound, non-replayable, audited authorization decisions. Add direct service/API negative tests for proposal store, queue mutations, RC builder, rollback, and staging. | Verified closed via P4-RT-001 recheck |
| P4-RT-WATCH-002 | P0 watch | Release candidate creation or promotion succeeds while any unresolved CRITICAL validation failure exists, or validation results can be omitted, downgraded, or forged. | Validation; Release Manager; Workflow; QA | Gate RC/package/promotion on immutable validation run records; fail closed on critical findings, missing reports, mismatched tenant/environment/release IDs, or unsigned/untrusted validation evidence. | Verified closed via P4-RT-002 recheck |
| P4-RT-WATCH-003 | P0 watch | Release candidate package omits or allows mutation of immutable snapshot, changelog, content hashes, approval record, source-version pins, audit event range, or rollback pointer. | Release Manager; Semantic Store; DB; Compliance; QA | Require complete ADR-0002 package fields, digest reconciliation, append-only ledger writes, object immutability, and negative tests for omitted/forged/mutated package components. | Verified closed via P4-RT-003 recheck |
| P4-RT-WATCH-004 | P0 watch | Rollback can restore a tampered/non-immutable snapshot, bypass validation, or repoint active release metadata without an audited rollback contract. | Release Manager; Semantic Store; DevOps; Compliance; QA | Bind rollback to existing immutable release metadata and manifest digests; require validation/rollback drill evidence, signed authorization, and append-only audit events. | Verified closed via P4-RT-004 recheck |
| P4-RT-WATCH-005 | P0 watch | Contributors, creators, wrong-role actors, service accounts without owner/scope, or cross-tenant users can approve, route, stage, create release candidates, promote, or rollback. | Security; Workflow; API; Release Manager; QA | Enforce RBAC and tenant/environment binding server-side on every Phase 4 action. Add negative tests for contributor self-approval, wrong-role approval, cross-tenant queue access, and service-account scope abuse. | Verified closed via direct service RBAC and P4-RT-001 recheck |
| P4-RT-WATCH-006 | P0 watch | Regulated actions occur without immutable audit events, or audit events can be updated/deleted after write. | Audit; Workflow; DB; Compliance; QA | Require audit event creation in the same service transaction/contract as every proposal, review, route, validation, RC, promotion, rollback, export, and privileged action; prove DB/storage immutability and compensating-event behavior. | Verified closed via P4-RT-005 recheck |
| P4-RT-WATCH-007 | P0 watch | Staging or release-candidate paths can publish to `graph:tenant:*:release:*` without the full release contract. | Semantic Store; Release Manager; Workflow; QA | Keep release graph writes behind `ReleaseSnapshotService`/promotion contract only; block direct graph writes, staging-to-release copies, and RC package shortcuts unless manifest, ledger, validation, approval, source pins, hashes, and audit checks pass. | Verified closed for RC builder and release snapshot paths tested; no release graph publish without snapshot service observed |

## Phase 4 Red Team Findings

| Finding ID | Severity | Risk | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| P4-RT-001 | P0 | Phase 4 governed state could previously be forged outside the signed workflow. Recheck confirms ordinary `MemoryProposalStore.put()` rejects `staged-for-release`, `release_id`, and forged `governed_decision`; `ReleaseManagerService.createReleaseCandidate()` rejects caller-supplied raw `items` and requires verified staged entries. | Proposal Workflow; Release Manager; Security; QA | Landed: proposal store split ordinary/workflow/governed writes; governed writes require signed decision verification; RC creation resolves items from `ProposalWorkflowService.stagedEntries` and rejects inline governed items. Regression and custom bypass probes pass closed. | Closed - verified on current HEAD |
| P4-RT-002 | P0 | Release candidate validation evidence was caller-forgeable. Recheck confirms release validation evidence now resolves immutable validation-run records and ignores forged inline resolved refs; resolved critical records block RC creation even when caller marks them resolved. | Validation; Release Manager; Compliance; QA | Landed: `resolveValidationEvidence`/`assertResolvedValidationEvidence` require immutable scoped validation runs or verified audited waivers; release manager requires `validationRunResolver.resolveValidationReports`. Forged/downgraded/resolved-critical probes fail closed. | Closed - verified on current HEAD |
| P4-RT-003 | P0 | Release candidate manifests could be mutated after creation. Recheck confirms `loadReleaseCandidate` verifies stored manifest bytes against the canonical ledger `manifest_digest`; post-create manifest mutation is detected and fails closed. | Release Manager; Storage; Compliance; QA | Landed: manifest digest persisted in ledger and verified before downstream use. Mutation-after-create probe fails closed with manifest digest mismatch. | Closed - verified on current HEAD |
| P4-RT-004 | P0 | Rollback trusted caller-supplied rollback metadata. Recheck confirms `restoreRollback` resolves rollback target from canonical release metadata via `loadReleaseCandidate`, ignores caller `prior_snapshot_ref`, verifies manifest digest, and activates the canonical snapshot ref. | Release Manager; Semantic Store; DevOps; Compliance; QA | Landed: rollback target loaded from canonical ledger/manifest and audited before pointer activation. Tampered snapshot-ref probe is ignored and canonical snapshot is used. | Closed - verified on current HEAD |
| P4-RT-005 | P0 | Release candidate creation and rollback previously did not emit immutable audit events in the release manager boundary. Recheck confirms RC creation fails closed without `auditStore.append`; RC creation and rollback append server-side audit events and bind audit IDs into manifest/ledger/pointer outputs. | Release Manager; Audit; DB; Compliance; QA | Landed: required append-only audit writer, persisted audit ID checks, RC audit range binding, and rollback audit append. No-audit probe fails closed; rollback emits `release_rollback` audit event. | Closed - verified on current HEAD |

## Phase 5 Red Team Exit Review (2026-06-27)

GO/NO-GO: GO for Phase 5 on final 2026-06-27 re-review. The original export provenance P0s and the later hidden-count leak now fail closed on current HEAD. Search/API result filtering, explanation integrity, export missing-field validation, export digest binding, export hidden-only behavior, and search/API-query hidden-count behavior all passed adversarial probes.

Verification run:
- Targeted Phase 5 suite: `node --test tests/security/authz-filter.test.mjs tests/unit/search-service.test.mjs tests/unit/explanation-service.test.mjs tests/unit/workbench-api.test.mjs tests/unit/workbench-frontend.test.mjs` = 27 pass, 0 fail.
- Full suite: `npm test` = 192 tests, 181 pass, 0 fail, 11 skip.
- Re-review after export hardening: `node --test tests/security/authz-filter.test.mjs tests/unit/search-service.test.mjs tests/unit/explanation-service.test.mjs tests/unit/workbench-api.test.mjs tests/unit/workbench-frontend.test.mjs tests/e2e/phase5-workbench-e2e.test.mjs tests/e2e/phase5-export-regressions.test.mjs` = 35 pass, 0 fail.
- Re-review full suite: `npm test` = 200 tests, 189 pass, 0 fail, 11 skip.
- Final new-bypass probe: hidden cross-tenant-only workbench export returned `record_count: 0`, `filtered_count: 1`, `invalid_record_count: 0`, `rows: 0`, and `export_job.status: ready`.
- Final re-review after hidden-count fix: `node --test tests/security/authz-filter.test.mjs tests/unit/search-service.test.mjs tests/unit/explanation-service.test.mjs tests/unit/workbench-api.test.mjs tests/unit/workbench-frontend.test.mjs tests/e2e/phase5-workbench-e2e.test.mjs tests/e2e/phase5-export-regressions.test.mjs` = 39 pass, 0 fail.
- Final re-review full suite: `npm test` = 204 tests, 193 pass, 0 fail, 11 skip.
- Final custom probes: hidden-only export and truly empty export have identical public counts (`record_count: 0`, `invalid_record_count: 0`, `rows: 0`, `export_job: null`) and no hidden-count fields; mixed hidden + visible-invalid export exposes only visible invalid count (`invalid_record_count: 1`); hidden-only search/API-query responses return zero visible results with no hidden-count fields; hidden entity detail returns non-enumerating `WorkbenchApiError`.

Probe summary:
- Unauthorized result leak: PASS-CLOSED for `querySearchIndex`, `executeAuthorizedQuery`, and `buildAuthorizedExport`; custom mixed candidates returned only `ok` and filtered cross-tenant, wrong-environment, wrong-release, blocked-license, and working rows.
- Match-explanation integrity: PASS-CLOSED; caller-supplied hit match reasons were ignored and `ExplanationEvidenceService` returned resolver-backed `SERVER` match reason.
- Cross-tenant search isolation: PASS-CLOSED for results and facets on tested search/API paths because facets were built only from authorized rows.
- Export provenance fidelity: PASS-CLOSED on re-review; incomplete regulated export rows are dropped with `invalid_record_count`, and manifest digests change when governed provenance/license/source-version fields change. See closed P5-RT-001 and P5-RT-002.
- Export/search/query count leakage: PASS-CLOSED on final re-review; public responses no longer expose `filtered_count`, `hidden_count`, `authorization_filtered_count`, or equivalent fields. See closed P5-RT-003.

| Finding ID | Severity | Risk | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| P5-RT-001 | P0 | Export previously accepted a release row with missing provenance, source vocabulary version, target vocabulary version, artifact hash, and license policy. Recheck confirms `buildAuthorizedExport()` now drops the same incomplete row: `record_count: 0`, `invalid_record_count: 1`, `rows: 0`. Required export fields are enforced by `isExportRegulatedResultComplete()` / `missingExportRegulatedFields()` and export rows are filtered before response construction. | Export; Authz Filter; Compliance; QA | Landed: server-side export row completeness validation for release ID, provenance, artifact hash, license status/policy/classification, and source/target vocabulary versions where required. Regression tests and custom bypass probe pass closed. | Closed - verified on current HEAD |
| P5-RT-002 | P0 | Export manifest digest previously did not bind regulated export content. Recheck confirms mutating governed fields now changes the digest: baseline `sha256:a4a93820f1b1450e1f4c930c123bea11b59a353a35a0f8f5b4ddccf549dd3796`; mutated provenance/license/source fields `sha256:0e111c3eaa915ee6e3432bb194f15e366ca43edc17680b8d7b64b224f7e8d46c`. | Export; Release Evidence; Compliance; QA | Landed: manifest digest hashes canonical exported row content and per-row content hashes are returned. Regression tests prove changes to governed export fields affect the digest. | Closed - verified on current HEAD |
| P5-RT-003 | P0 | Public workbench export previously leaked hidden result counts. Recheck confirms the fix removes hidden-count fields from export/search/API-query responses and prevents ready jobs for zero-row hidden-only exports. Hidden-only export is indistinguishable from no match on public counts; mixed hidden + visible-invalid export exposes only the visible invalid count; hidden-only search/API-query responses expose only zero visible results; hidden entity detail returns `WorkbenchApiError: entity is not visible in the requested scope`. | Export; API Query Boundary; Search; Security; QA | Landed: removed authorization-hidden count serialization from export, authz-filter/API query boundary, and search wrappers; workbench export now allowlists response fields and sets `export_job: null` when `record_count` is zero. Regression tests cover hidden-only and mixed hidden+invalid export scopes plus hidden-count absence in search/API wrappers. | Closed - verified on current HEAD |

## Phase 6 Red Team Exit Review (2026-06-27)

GO/NO-GO: GO on final 2026-06-27 re-review. The AI curation API now rejects the original MASQ resolver-output bypass before shaping, safe non-causal FAERS/openFDA suggestions pass API/UI with disclaimers intact, genuinely causal FAERS/openFDA claims still reject, and prior no-auto-release/search/export/release/hidden-count controls remain green.

Verification run:
- Targeted Phase 6/security suite: `node --test tests/unit/ai-curation-engine.test.mjs tests/unit/ai-curation-api.test.mjs tests/unit/ai-curation-frontend.test.mjs tests/proposal-workflow/proposal-workflow.test.mjs tests/release/release-manager.test.mjs tests/unit/search-service.test.mjs tests/security/authz-filter.test.mjs` = 57 pass, 0 fail.
- Custom adversarial probe: API returned `visible_count: 1` for a resolver candidate with `evidence_refs: [{}]`, source spans containing only `evidence_id/start_offset/end_offset`, `calibration: null`, and nested `payload.assertion_type: "approved"`. Search release-context probe returned only canonical `canonical-ok`; export returned only canonical `export-ok`; release-manager denied `model_suggested` assembly with `release_candidate_promotion_denied` and wrote no manifest.
- Full suite: `npm test` = 234 tests, 222 pass, 1 fail, 11 skip. Failing test: `P6-P0: non-causal FAERS/openFDA suggestions should pass API/UI with disclaimers intact`, thrown from `services/api/src/ai-curation.js:243`.
- Interim FAERS recheck after Angela's fix: `node --test tests/unit/ai-curation-api.test.mjs tests/e2e/phase6-ai-curation-e2e.test.mjs tests/unit/ai-curation-engine.test.mjs tests/unit/ai-curation-frontend.test.mjs` = 22 pass, 0 fail. This verifies non-causal FAERS/openFDA passes API/UI with disclaimers intact and causal FAERS claims are still rejected in the targeted stack.
- Interim current-HEAD broader check while P6-RT-001 was still in progress: `node --test tests/unit/ai-curation-engine.test.mjs tests/unit/ai-curation-api.test.mjs tests/unit/ai-curation-frontend.test.mjs tests/proposal-workflow/proposal-workflow.test.mjs tests/release/release-manager.test.mjs tests/unit/search-service.test.mjs tests/security/authz-filter.test.mjs` = 58 tests, 53 pass, 5 fail. `npm test` = 235 tests, 219 pass, 5 fail, 11 skip. Superseded by final combined pass below.
- Final exact MASQ repro: resolver output with nested `payload.assertion_type: "approved"`, `evidence_refs: [{}]`, weak `source_spans`, manual confidence, and `calibration: null` now rejects before API shaping with `AI suggestion nested payload cannot masquerade as approved or released` on `payload.assertion_type`.
- Final MASQ variant probes: nested `payload.release_id`, `payload.lifecycle_status`, `candidate_payload.assertion_type`, `candidate_payload.review_status`, top-level `release_id`, and top-level approved lifecycle variants all reject before visible API output.
- Final combined Phase 6/security suite: `node --test tests/unit/ai-curation-api.test.mjs tests/e2e/phase6-ai-curation-e2e.test.mjs tests/unit/ai-curation-engine.test.mjs tests/unit/ai-curation-frontend.test.mjs tests/proposal-workflow/proposal-workflow.test.mjs tests/release/release-manager.test.mjs tests/unit/search-service.test.mjs tests/security/authz-filter.test.mjs` = 62 pass, 0 fail.
- Final full suite: `npm test` = 237 tests, 226 pass, 0 fail, 11 skip.

Probe summary:
- Hallucination/evidence/confidence boundary: FAIL-OPEN at the API resolver boundary. `normalizeSuggestion()` / `validateSuggestion()` require only non-empty evidence/source-span arrays and a numeric score; they do not require a real evidence ref shape, source span text/source identity beyond one ID, calibrated model confidence, or calibration metadata.
- Suggestion masquerade: FAIL-OPEN at the same API boundary. Top-level `assertion_type` is overwritten to `model_suggested`, but nested `payload.assertion_type: "approved"` survives and is returned to clients.
- FAERS/openFDA safe path: FAIL-CLOSED incorrectly. Valid non-causal suggestions with mandatory non-causal limitations are rejected because the causal regex scans disclaimer text containing `causal`, `risk`, or `incidence`.
- No-auto-release, direct governed-store writes, release candidate assembly, release-context search/export, and hidden-count regression: PASS-CLOSED in targeted probes and current tests.

| Finding ID | Severity | Risk | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| P6-RT-001 | P0 | `Phase6AiCurationApi.fetchSuggestions()` accepted unsafe and masked resolver candidates. Original repro path: resolver returns a candidate with `evidence_refs: [{}]`, `source_spans: [{ evidence_id, start_offset, end_offset }]`, `confidence.source: "manual_override"`, no calibration metadata, and nested `payload.assertion_type: "approved"`. API response returned `visible_count: 1`, `calibration: null`, and the nested approved payload. Final recheck confirms the same payload now rejects before API shaping and strict candidate validation no longer breaks valid API/feedback fixtures. | AI Curation API; Security; QA | Landed: API imports `assertSuggestionCandidate`, rejects nested payload/candidate_payload governed-status masquerade before shaping, requires strict evidence/source-span/model/calibration fields, and keeps the exact MASQ regression in API tests. Final exact repro, targeted suite, and full suite pass. | Closed - verified on current HEAD |
| P6-RT-002 | P0 | Safe FAERS/openFDA non-causal suggestions were rejected by the API. Original full suite failure: `tests/e2e/phase6-ai-curation-e2e.test.mjs:266` expected non-causal FAERS/openFDA suggestions with `causality_allowed: false` and non-causal disclaimers to pass API/UI. Final recheck confirms non-causal FAERS/openFDA passes API/UI with disclaimers intact and genuinely causal FAERS/openFDA claims still reject. | AI Curation API; Safety; QA | Landed: causal matching is separated from disclaimer/source limitation text; claim fields remain guarded while required non-causal disclaimer fields are allowed. The P6-P0 E2E and API causal negative pass in the final combined suite. | Closed - verified on current HEAD |

## Phase 7 Red Team Surface

Standing assignment:
Support Oscar's P7-SEC-REVIEW during Wave A, then own the final Phase 7 EXIT Red Team when P7-MVP-RELEASE is assembled. Phase 7 exit requires pilot deployment readiness, all subsystems working, pilot-ready docs, and no unresolved P0/P1.

Wave A support baseline checked 2026-06-27: `node --test tests/security/authz-filter.test.mjs tests/security/operational-schema-security.test.mjs tests/proposal-workflow/proposal-workflow.test.mjs tests/release/release-manager.test.mjs tests/unit/search-service.test.mjs tests/unit/ai-curation-api.test.mjs tests/unit/ai-curation-engine.test.mjs tests/unit/semantic-store.test.mjs tests/unit/workbench-api.test.mjs tests/e2e/phase6-ai-curation-e2e.test.mjs` = 88 tests, 82 pass, 0 fail, 6 Docker-backed skips. Current shipped controls show no new P0/P1 in this support pass.

Oscar's P7-SEC-REVIEW closed 2026-06-27 with report `docs/security/phase7-security-review.md`. Report sign-off: GO for Phase 7 Wave A security review with no unresolved P0/P1. Oscar verification: targeted Phase 7/security stack = 96 total, 90 pass, 0 fail, 6 Docker-backed skips; full `npm test` = 245 total, 234 pass, 0 fail, 11 expected local skips. Residual P2s align to Creed watch items: local live infra skips, frontend null-only hidden placeholders, and environment-specific pilot source/license approvals.

P7-MVP-RELEASE standby 2026-06-27: god reports Wave A green 8/8 and Jim is assembling the MVP release candidate. Creed is holding final Phase 7 EXIT Red Team until the assembled candidate is delivered.

## Phase 7 EXIT Red Team Review (2026-06-27)

GO/NO-GO: GO for Phase 7 EXIT on the assembled MVP candidate `mvp-2026-06-27-rc1` / `rc:mvp-2026-06-27`. No new P0/P1 bypass was found. The project-level Phase 7 exit gate passes on code and release-candidate evidence, with residual P2/human-infra gates explicitly not treated as code defects.

Candidate verified:
- Manifest: `docs/releases/mvp-2026-06-27-rc1/mvp-2026-06-27-rc1.rc_mvp-2026-06-27.manifest.json`.
- Manifest digest: `sha256:68fd2ad5cab1fde056aa9a352950ac2433cbf419233b017cdb1fa37671113684`.
- Bound snapshot: `sha256:e18d1ef247ee6847f49ded255d6d614ff813e299e26eb95bf783e313ff031b49`.
- Bound changelog: `sha256:62a07271e51d778925e8c4c03a1425b73dd8fb3b1924ba4daf9b2867f688b8a8`.
- Bound source pins: ChEMBL `CHEMBL_34`, UniProt `2026_02`, Manual curation `2026-06-27`, PharmaOps validation package `pharmaops-mvp-validation-package-2026-06-27`.
- Rollback target: `2026.1.0`; candidate rollback metadata binds the immutable candidate snapshot ref.

Verification run:
- Targeted Phase 7 EXIT adversarial suite: `node --test tests/release/phase7-mvp-release-candidate.test.mjs tests/release/phase7-release-drill.test.mjs tests/release/release-manager.test.mjs tests/ops/phase7-ops.test.mjs tests/security/authz-filter.test.mjs tests/security/operational-schema-security.test.mjs tests/unit/mvp-validation-package.test.mjs tests/unit/workbench-api.test.mjs tests/unit/search-service.test.mjs tests/unit/ai-curation-api.test.mjs tests/unit/ai-curation-engine.test.mjs tests/unit/semantic-store.test.mjs tests/e2e/phase6-ai-curation-e2e.test.mjs tests/e2e/phase5-workbench-e2e.test.mjs tests/e2e/phase5-export-regressions.test.mjs` = 93 tests, 87 pass, 0 fail, 6 Docker-backed skips.
- Full suite: `npm test` = 248 tests, 237 pass, 0 fail, 11 expected local skips.
- Static hidden-count scan: implementation code serializes `visible_count`, `total`, and `invalid_record_count` only; hidden-count strings are limited to docs, tests, and null-only frontend placeholders.
- Custom final probe: manifest digest changed after tampering with a bound artifact hash; manifest contains no `model_suggested`; `included_graphs[0].target_release_graph` remains `null`; MASQ and nested-MASQ candidates reject before visible API output; non-causal FAERS/openFDA passes with disclaimer and causal FAERS rejects; hidden-only export returns `record_count: 0`, `invalid_record_count: 0`, `export_job: null`, and no hidden-count fields; rollback ignores caller snapshot refs and activates the canonical target snapshot ref.

Probe summary:
- No-auto-release across sibling write paths: PASS-CLOSED. Connector final emit rejects release graph targets, proposal workflow requires governed decisions, semantic-store release snapshot blocks `model_suggested`, and release manager rejects raw `model_suggested` before manifest/ledger persistence with `denial_reason: model_suggested_release_blocked`.
- CRITICAL validation blocks release: PASS-CLOSED. Phase 7 MVP candidate and release-drill negatives block before manifest/ledger/audit writes when critical validation evidence is present.
- Raw `model_suggested` denied and audited: PASS-CLOSED. Release-manager regression verifies one denial audit event and zero manifest/ledger records; assembled manifest contains no `model_suggested`.
- Manifest digest binds canonical content: PASS-CLOSED. Tampering a bound governance artifact hash changed the computed manifest digest.
- Rollback canonical proof: PASS-CLOSED. `restoreRollback()` resolves the target via canonical release metadata/manifest and ignores caller-supplied snapshot refs.
- Tenant/metadata isolation and hidden-count behavior: PASS-CLOSED. Search/export/workbench/authz tests and custom hidden-only export/search probes expose no hidden counts or ready jobs.
- MASQ/nested-MASQ: PASS-CLOSED. Top-level approved/released masquerade and nested payload masquerade reject before API shaping.
- FAERS/openFDA non-causal: PASS-CLOSED. Non-causal signal path stays visible with disclaimer; causal claim rejects.
- Audit completeness/immutability: PASS-CLOSED for local evidence. Release candidate creation, rollback, proposal workflow, backup/restore, and release drill bind append-only audit events; DB-backed append-only tests remain Docker-skipped locally and require staging CI/waiver evidence.
- Source-version pins: PASS-CLOSED. Candidate includes the required ChEMBL, UniProt, Manual curation, and validation-package pins.

Residual P2 / human-infra gates accepted at exit:
- P7-P2-001: live DB/Fuseki and Docker-backed operational-security tests were accepted for pilot exit by signed release-risk waiver `docs/validation/mvp-validation-package/waivers/release-risk-waiver-mvp-2026-06-27-rc1.json` (`sha256:c13b7dc2e0baf671cf52c700d85165d85ad5d614d9f79043f3d5f9203433f7b1`) bound to `mvp-2026-06-27-rc1` / `rc:mvp-2026-06-27`; staging/live execution evidence remains required before closing the residual.
- P7-P2-003: per-tenant and per-environment source-license approvals are required before controlled-prod promotion.
- Live staging/controlled-prod deploy execution, pilot user provisioning, training acknowledgments, and environment smoke evidence remain human/infra-gated.

Initial watch list:

| Finding ID | Severity | Risk | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| P7-RT-WATCH-001 | P0 watch | New Phase 7 observability, KPI, validation-package, backup/restore, release-drill, or pilot endpoints bypass shared server-side authz filtering or expose hidden counts/facets/metadata. | Security; API; Observability; QA | Require every new read/export/report endpoint to call the same authz/query/export chokepoints and serialize no hidden-count fields. Re-run cross-tenant hidden-only probes at final exit. | Closed - final EXIT probes and targeted suite pass; no hidden-count fields in service responses |
| P7-RT-WATCH-002 | P0 watch | Backup/restore or release-drill paths restore, package, or promote caller-supplied governed state, `model_suggested` content, release graph targets, or inline validation/audit proof. | Release Manager; Backup/Restore; Semantic Store; Security | Resolve canonical manifest, ledger, staged entries, validation runs, audit events, and snapshot refs server-side; reject inline copies and raw `model_suggested` at every sibling write path. | Closed - release/rollback/backup probes pass closed on assembled candidate |
| P7-RT-WATCH-003 | P0 watch | Pilot readiness docs or admin flows describe security as a manual/operator checklist while implementation allows service accounts or platform admins to perform privileged release/export/audit actions without dual control and audit. | Security; Docs; Pilot | Keep backend enforcement authoritative; require scoped service-account grants, human owner, release scope, destination, license policy, expiry, step-up, and immutable audit. | Closed as code P0 - backend enforcement green; controlled-prod approvals remain human/infra P2 gate |
| P7-RT-WATCH-004 | P1 watch | Frontend placeholders such as `unauthorized_hidden_count: null` or test fixtures with `filtered_count` could be mistaken for allowed public API fields during new dashboard/report work. | Frontend; API; Security; QA | Keep public API responses allowlisted and null-only display placeholders non-authoritative; final exit should grep serialized service responses and exercise hidden-only dashboard/export scopes. | Closed as code P1 - public API allowlists and hidden-only probes green; null-only frontend placeholders remain non-authoritative |

## Semantic Bridge Phase A Red Team Surface

Standing assignment received 2026-06-27 for `SB-A-RT-TAXONOMY`: hold final taxonomy/contracts verdict until `SB-A-TAXONOMY`, `SB-A-CONTRACTS`, `SB-A-SHACL`, and `SB-A-SAFETY-POLICY` deliver. No GO/NO-GO is due yet.

Reference read: `pharmaops_semantic_bridge_addendum_prompt.md` sections 3-12, Addendum Phase A, and section 19 global instruction. Phase A exit is blocked by unresolved P0 ambiguity in relationship taxonomy, JSON contracts, SHACL requirements, or safety/causal policy.

| Finding ID | Severity | Risk | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| SB-A-RT-WATCH-001 | P0 watch | Identity/crosswalk predicates collapse into generic evidence-backed relationship assertions, making `same_as`, `exact_match`, `close_match`, `related_match`, inference, and hypothesis semantics indistinguishable. | Jim; Kevin; Angela | Taxonomy and schemas must separate identity, vocabulary crosswalk, evidence-backed relationship, inferred path, AI suggestion, hypothesis, unsupported, and blocked classes with class-specific predicates, evidence, review, confidence, and release behavior. | Holding for Phase A deliverables |
| SB-A-RT-WATCH-002 | P0 watch | Model-suggested, inferred, hypothesis, or speculative links can be rendered or serialized as approved/released facts. | Jim; Angela; Kevin | Contracts and SHACL must require assertion type, review status, release context, and direct release prohibition for `model_suggested`; UI/API labels must make released, human-reviewed, inferred, AI-suggested, hypothesis, unsupported, and blocked states non-confusable. | Holding for Phase A deliverables |
| SB-A-RT-WATCH-003 | P0 watch | Safety paths or relationship classes imply causality, incidence, prevalence, product fault, or comparative risk from FAERS/openFDA or other passive-report data. | Andy; Jim; Kevin | Safety policy and SHACL must require evidence-type limitation metadata, causal-claim status, visible warnings, and approved causal review before causal/mechanistic claims. Non-causal safety context must remain non-causal in API/UI/export text. | Holding for Phase A deliverables |
| SB-A-RT-WATCH-004 | P0 watch | RelationshipAssertion, RelationshipPath, BridgeHypothesis, or PathQuery contracts omit governed fields needed to block unprovenanced, unlicensed, unauthorized, or weak-link-hidden relationships. | Angela; Kevin; Jim | Every relationship assertion must include relationship class, evidence, provenance, confidence, assertion type, review status, data license status, and release context. Every path must include path confidence, weakest link, access filtering, warnings, and path status. | Holding for Phase A deliverables |
| SB-A-RT-WATCH-005 | P0 watch | Multi-hop path confidence becomes a naive average or can exceed the weakest critical edge, hiding broadMatch/relatedMatch/model-suggested/safety/restricted weak links. | Angela; Jim; Andy | Path contracts and policies must cap confidence by weakest critical edge, block paths with blocked edges, prevent high confidence for unreviewed model-suggested edges, and require weakest-link explanation. | Holding for Phase A deliverables |
| SB-A-RT-WATCH-006 | P0 watch | Path-level filtering leaks restricted evidence, hidden edge existence, source snippets, confidence notes, warnings, facets, or export metadata across tenant/license/release boundaries. | Angela; Kevin; Andy | Contracts must define edge-level and path-level authorization/redaction semantics; path is viewable/exportable only if every edge/evidence object is authorized, or policy-defined redaction is non-enumerating. | Holding for Phase A deliverables |
