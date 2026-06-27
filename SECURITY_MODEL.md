# PharmaOps Security Model

Task:
Author the Phase 0 security and identity model for PharmaOps, covering authentication, RBAC, tenancy isolation, secrets, encryption, audit hooks, and threat controls for a regulated pharma semantic operations platform.

Assumptions:
- PharmaOps is a multi-tenant regulated workbench with separated development, validation, staging, and production environments.
- Customers can inspect privileged actions, audit trails, release evidence, and security controls.
- Frontend controls are usability aids only. All authorization and tenant filtering are enforced by backend services and data stores.
- Service accounts are non-human principals bound to explicit tenant, environment, service, scope, and expiry constraints.
- Search, APIs, exports, logs, audit queries, and background jobs are part of the security boundary.

Inputs Reviewed:
- `pharmaops_multi_agent_exportable_prompt.md` section 6.1, required output structure.
- `pharmaops_multi_agent_exportable_prompt.md` section 6.3, blocking failure conditions.
- `pharmaops_multi_agent_exportable_prompt.md` section 7, Agent 20 Security and Identity Agent.
- `pharmaops_multi_agent_exportable_prompt.md` section 10.4, audit system.
- `pharmaops_multi_agent_exportable_prompt.md` section 16, specialist agent base prompt.

Changes Proposed:
- Use deny-by-default backend authorization for every mutating action.
- Treat tenant, environment, release, graph, source-license, and workflow state as mandatory authorization dimensions.
- Require immutable, attributable audit events for all regulated and privileged actions.
- Use least-privilege service accounts with scoped credentials, short-lived tokens, and auditable execution context.
- Block promotion or release when security, audit, provenance, validation, or tenant-isolation controls fail.

Artifacts Created or Modified:
- `SECURITY_MODEL.md`

Interfaces Affected:
- Identity provider integration.
- Backend API gateway and internal service authorization.
- Workflow service.
- Search service.
- Semantic store.
- Connector and job runtime.
- Audit event service and audit search/export APIs.
- Admin, release, and export workflows.

Tests Added or Required:
- Authentication success, failure, logout, session expiry, MFA, and token revocation tests.
- RBAC allow/deny tests for every mutating endpoint and workflow transition.
- Tenant isolation tests for API, search, logs, exports, audit search, and background jobs.
- Environment-permission tests for development, validation, staging, and production.
- Service-account scope tests proving no broad cross-tenant or cross-environment access.
- Audit-emission tests for all auditable actions listed in this model.
- Audit immutability tests proving normal admins cannot edit or delete audit events.
- Secrets tests proving credentials are not logged, exported, indexed, or returned by APIs.
- Release-blocking tests for every mapped blocking failure condition.

Security Impact:
This document defines the required controls for identity, access, tenancy, secrets, encryption, privileged action logging, and threat mitigation. It explicitly rejects frontend-only permission checks, broad service-account permissions, and unscoped search.

Compliance Impact:
The model supports regulated workflow inspection by requiring attributable actions, immutable audit records, role-filtered audit access, release evidence, and blocking controls for unauthorized mutation, missing audit events, and cross-tenant leakage.

Data and Provenance Impact:
All governed semantic data access must preserve tenant, environment, release, source version, evidence, provenance, and licensing context. Exports and search results must include release and provenance constraints and must never bypass role or tenant filters.

Risks:
- Overly broad platform administration could become a de facto bypass unless platform administration and security administration remain separated.
- Search indexing, background jobs, and logs are common cross-tenant leakage paths and need continuous automated tests.
- Break-glass access is necessary for operations but must be time-limited, justified, separately approved, and heavily audited.
- Audit storage must be designed with Compliance and Validation so immutability and retention satisfy customer inspection requirements.

Open Questions:
- Which enterprise IdPs must be supported in v1: OIDC only, SAML only, or both?
- What customer-specific retention periods are required for audit events, exports, logs, and release evidence?
- Which tenant policies require `compliance_reviewer` as the second approver instead of a second `security_admin` for privileged security changes?

Handoff To:
- Solution Architect: confirm service-boundary ownership for policy enforcement, tenant scoping, and audit emission.
- Compliance and Validation: confirm audit immutability, retention, export format, and regulated-action definitions.
- Workflow Backend: implement state-transition authorization and audit hooks.
- API Agent: implement role, tenant, release, environment, and license filters in public and internal APIs.
- Search and Retrieval: implement mandatory tenant, role, release, and license filters at query and index time.
- QA: implement negative tests for unauthorized mutation, tenant leakage, privileged export logging, and audit immutability.

Definition of Done Status:
- Complete for Phase 0 documentation: ten required roles are listed, role-to-permission matrix is defined, backend mutation enforcement is specified, tenant isolation rules are defined, auditable actions are listed, secrets/encryption approach is defined, threat model is included, and blocking failure mappings are documented.

## 1. Security Principles

1. Deny by default. No principal receives access unless a policy explicitly grants it for the tenant, environment, object type, workflow state, and action.
2. Backend enforcement is mandatory. The UI may hide buttons, but backend services must independently authorize every read and mutation.
3. Tenant isolation is part of every interface. Tenant scope is required in API requests, search queries, graph operations, exports, jobs, audit queries, and logs.
4. Least privilege applies to humans and services. Privileged roles are narrow, auditable, and separated.
5. Regulated actions are attributable. Every critical action records actor, role, tenant, environment, rationale, timestamp, target, outcome, and correlation ID.
6. Provenance and release context are security controls. Governed data may not be exported, promoted, or shown as approved without provenance, release ID where applicable, and validation state.
7. Environment separation is mandatory. Development, validation, staging, and production access are independently granted and audited.
8. Secrets are never product data. Secrets are stored only in the approved secret manager and are never returned by APIs, indexed for search, included in exports, or written to logs.

## 2. Identity and Authentication

### 2.1 Human Users

- Use enterprise IdP federation with OIDC or SAML.
- Require MFA for all privileged roles: `domain_approver`, `compliance_reviewer`, `release_manager`, `data_engineer`, `platform_admin`, and `security_admin`.
- Use short-lived access tokens and refresh tokens with rotation.
- Bind sessions to tenant memberships and environment grants.
- Re-evaluate policy on every request; do not rely on stale role claims for privileged mutations.
- Require step-up authentication for privileged actions, including role changes, production source configuration changes, production release promotion, rollback, audit export, and break-glass access.
- Support immediate session revocation for offboarding, incident response, and privilege removal.

### 2.2 Service Accounts

- Service accounts are first-class principals with role `service_account`; they do not inherit human roles.
- Each service account must have:
  - Owner.
  - Tenant scope.
  - Environment scope.
  - Service purpose.
  - Explicit action scopes.
  - Allowed source systems or job queues.
  - Expiration or rotation policy.
  - Secret reference.
  - Audit identity.
- Service accounts must not have platform-wide wildcards except for explicitly approved infrastructure operations.
- Service accounts cannot approve governed data, promote releases, modify RBAC, export audit logs, or perform break-glass actions.
- Service-account export grants must bind all of these attributes: owning human role, owning human user or group, tenant, environment, release scope, destination, export format, license policy, permitted source classes, expiry, rotation schedule, and audit purpose.
- Service accounts may export only approved release-scoped packages by default. Working-state exports and restricted-source exports are prohibited unless an explicit governed approval records the tenant, release or preview scope, destination, license clearance, expiry, and approving human roles.
- Service-account export destinations must be allowlisted and tenant-scoped. A service account must not choose arbitrary destinations at runtime.
- Machine tokens must be short-lived, rotated, and revocable.

Phase 2 connector ingestion uses the narrower service-account contract in `docs/ingestion-security.md`. Connector service accounts may read approved sources, write tenant-scoped raw artifacts or pointer manifests, emit normalized candidates, write tenant working-graph candidate assertions, and emit redacted tenant-scoped observability only. They are explicitly denied released-graph writes, release promotion, governed publication, export, cross-tenant access, RBAC changes, and break-glass actions.

Connector checkpoints and run lineage are tenant-scoped security data. Retry and replay paths must verify a signed binding over tenant, environment, service account, connector, source, source version or snapshot digest, license policy, run lineage, checkpoint identity, idempotency key, and artifact prefix before any checkpoint is read or replayed.

## 3. Authorization Model

Authorization decisions are based on this tuple:

```text
principal + role + tenant + environment + action + resource_type + resource_id + workflow_state + release_context + license_policy
```

The policy engine must support:
- RBAC for coarse permissions.
- Attribute-based constraints for tenant, environment, source license, release, graph, module, and workflow state.
- Object-level checks for entity, mapping, relationship, evidence, source, release, export, job, and audit resources.
- Separation-of-duties rules, including no self-approval for material changes and no unilateral production release by the same actor who authored the change.
- Separation-of-duties rules for privileged security changes, including no self-approval for privileged role grants, RBAC policy changes, service-account export grants, or break-glass enablement.
- Privileged-action step-up requirements.
- Explicit deny rules that override grants.

### 3.1 Separation of Duties for Privileged Security Changes

Privileged security administration requires dual control. A `security_admin` can initiate privileged role grants, RBAC policy changes, service-account export grants, and break-glass enablement, but cannot be the sole approver or the sole beneficiary.

Rules:
- No self-approval. A principal cannot approve a privileged role grant, RBAC policy change, service-account grant, or break-glass session that benefits their own account, their own service account, or a group they control.
- Second approver required. Privileged role grants and RBAC policy changes require approval from a second `security_admin` or an approved `compliance_reviewer` according to tenant policy.
- Expiry required where applicable. Temporary privileged roles, break-glass access, elevated service-account scopes, and exceptional export grants must include an explicit expiry.
- Rationale required. Every privileged security change must include a human-readable business justification and affected tenant/environment/resource scope.
- Mandatory audit review. Privileged role grants, RBAC policy changes, service-account export grants, and break-glass sessions must generate audit events and appear in a periodic security audit review queue.
- Emergency exception. If an emergency break-glass flow allows post-approval instead of pre-approval, it must be time-limited, tenant-scoped, separately reviewed after use, and blocked from becoming standing access.

## 4. Required Roles

The required roles are:

```text
viewer
contributor
curator
domain_approver
compliance_reviewer
release_manager
data_engineer
platform_admin
security_admin
service_account
```

Role intent:
- `viewer`: read authorized released or assigned workbench content.
- `contributor`: propose changes, comments, and evidence additions.
- `curator`: create and edit governed semantic proposals and prepare them for review.
- `domain_approver`: approve or reject domain-scoped governed changes.
- `compliance_reviewer`: review validation evidence, auditability, release controls, and compliance gates.
- `release_manager`: stage, promote, certify, export, and roll back releases after required approvals.
- `data_engineer`: configure and run authorized connectors, ingestion jobs, normalization jobs, and source refreshes.
- `platform_admin`: manage tenant configuration, environment settings, users, operational jobs, and non-security administration.
- `security_admin`: manage identity, RBAC policy, security configuration, secret references, break-glass procedures, and privileged audit access.
- `service_account`: execute narrowly scoped automated actions.

## 5. Role-to-Permission Matrix

Legend:
- `R`: read.
- `C`: create.
- `U`: update.
- `D`: delete or deactivate.
- `A`: approve.
- `X`: execute.
- `E`: export.
- `P`: privileged action requiring elevated role, step-up authentication, and audit event.
- `-`: not allowed.

| Permission area | viewer | contributor | curator | domain_approver | compliance_reviewer | release_manager | data_engineer | platform_admin | security_admin | service_account |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Read released semantic assets in assigned tenant | R | R | R | R | R | R | R | R | R | Scoped R |
| Read working/staging proposals in assigned modules | - | R | R | R | R | R | R | R | R | Scoped R |
| Read evidence and provenance for authorized assets | R | R | R | R | R | R | R | R | R | Scoped R |
| Search authorized entities, mappings, documents, and evidence | R | R | R | R | R | R | R | R | R | Scoped R |
| Create comments and review notes | - | C | C | C | C | C | C | C | C | Scoped C |
| Create semantic change proposal | - | C | C | - | - | - | - | - | - | Scoped C |
| Update own draft proposal before submission | - | U | U | - | - | - | - | - | - | Scoped U |
| Edit governed entity, mapping, relationship, or evidence proposal | - | - | C/U | - | - | - | - | - | - | Scoped C/U |
| Submit proposal to review | - | X | X | - | - | - | - | - | - | Scoped X |
| Approve or reject governed mapping candidate | - | - | A/P | A/P | - | - | - | - | - | - |
| Stage approved mapping candidate for release | - | - | - | - | - | C/P | - | - | - | - |
| Approve or reject domain-scoped proposal | - | - | - | A/P | - | - | - | - | - | - |
| Review compliance evidence and gate readiness | - | - | - | - | A/P | - | - | - | - | - |
| Override or waive non-critical validation warning | - | - | - | - | A/P | - | - | - | - | - |
| Stage release candidate | - | - | - | - | - | C/P | - | - | - | - |
| Promote release to production | - | - | - | - | - | X/P | - | - | - | - |
| Roll back release | - | - | - | - | - | X/P | - | - | - | - |
| Export release package with provenance | - | - | - | - | R | E/P | - | - | R/E/P | Scoped E with human owner, tenant, release, destination, license policy, expiry |
| Export non-release working data | - | - | - | - | - | - | - | - | - | - |
| Search audit events | - | - | - | R | R/P | R/P | - | R | R/P | - |
| Export audit events | - | - | - | - | E/P | - | - | - | E/P | - |
| Configure source connector | - | - | - | - | - | - | C/U/P | U/P | - | Scoped C/U |
| Run connector or normalization job | - | - | - | - | - | - | X | X | - | Scoped X |
| Change production source configuration | - | - | - | - | - | - | U/P | U/P | - | - |
| Manage tenants and environment settings | - | - | - | - | - | - | - | C/U/P | R | - |
| Manage user accounts | - | - | - | - | - | - | - | C/U/P | R | - |
| Assign non-privileged roles | - | - | - | - | - | - | - | U/P | R | - |
| Assign privileged roles | - | - | - | - | - | - | - | - | U/P with second approver | - |
| Manage RBAC policies | - | - | - | - | - | - | - | - | C/U/D/P with second approver | - |
| Manage secret references and rotation policy | - | - | - | - | - | - | - | - | C/U/D/P | - |
| Break-glass access activation | - | - | - | - | A/P | - | - | - | X/P with second approver and expiry | - |
| Delete governed semantic data | - | - | - | - | - | - | - | - | - | - |
| Deactivate obsolete draft or configuration object | - | - | U | - | - | - | U/P | U/P | U/P | Scoped U |

Deletes of governed semantic data are prohibited in normal workflows. Corrections use new versions, supersession, deactivation, rollback, or release replacement with preserved provenance and audit history.

Phase 3 governed mapping RBAC is specified in `docs/curation-rbac.md`. Mapping candidate approval/rejection is limited to `curator` or `domain_approver`; staging an approved mapping candidate for release is limited to `release_manager`. Service accounts cannot approve, reject, stage, publish governed mappings, or promote mappings to released state.

Mapping registry writes that change governed review state must include a short-lived, single-use authorization decision minted by the server-side authorization service. The registry must verify the signed or MAC-bound decision against tenant, environment, action, actor, candidate, mapping, prior/next status, evidence, provenance, vocabulary versions, audit event, correlation ID, and expiry before persistence.

Phase 4 proposal lifecycle RBAC is also specified in `docs/curation-rbac.md`. Contributors may submit own-tenant proposals only; curators validate and route; domain approvers approve or reject; release managers stage approved proposals and create release candidates. Service accounts cannot govern proposals or create release candidates. Proposal approve/reject/stage and release-candidate creation require signed or MAC-bound authorization decisions, and release-candidate creation additionally requires all included proposals approved, validation passed, source-version pins, content hashes, changelog digest, approval trace, and audit event range.

Phase 6 AI-assisted curation adds a stricter write-path rule: no `assertion_type=model_suggested` candidate may be auto-published or packaged for release. Service accounts may only submit or ingest model suggestions into reviewable candidate state. Human feedback decisions (`accept`, `reject`, `revise`) are limited to `curator`, `domain_approver`, or `expert_reviewer`; contributors and service accounts are denied server-side. Any approval or staging transition for a model-suggested candidate must bind an immutable human feedback proof into the signed governed decision (`human_governance_proof_id` and `human_governance_proof_digest`) and must fail closed when the proof is missing, cross-tenant, stale, forged, or not tied to the proposal payload hash. Release-candidate assembly, semantic-store release snapshot creation, sibling CRUD/store/promote paths, and direct governed-store writes must reject raw `model_suggested` payloads before manifest, ledger, or graph writes and must append an audit denial for promotion attempts.

Phase 4 immutable-record verification is mandatory for every governed write path. A caller may pass identifiers for governance proof, but no service may trust caller-supplied copies of governed decisions, staged entries, validation evidence, release-candidate manifest digests, snapshot references, or audit IDs. Each service must resolve the referenced record by ID from its authoritative store under the same tenant and environment, verify immutability and integrity bindings, and then compare the resolved record to the requested write. Inline evidence is advisory only and must be ignored for authorization.

The shared verification rules are:

| Governance artifact | Trusted resolver | Integrity binding | Service rule |
|---|---|---|---|
| Signed governed decision | Authorization decision verifier / workflow decision store | `decision_binding` plus MAC/signature over action, actor, role, tenant, environment, proposal or candidate ID, previous and next state, release ID, evidence digests, audit event ID, correlation ID, issue and expiry times | Phyllis and Jim must verify signature, expiry, single-use decision ID, state/action match, tenant/environment match, and evidence digest match before proposal or release-candidate writes. |
| AI suggestion human-governance proof | Proposal workflow feedback store and audit store | Feedback ID plus audit event ID bound to tenant, environment, proposal ID, suggestion ID, reviewer, reviewer role, decision, payload hash, optional revision hash, and occurred time; digest is embedded in the signed governed decision | Phyllis must resolve proof from immutable feedback before model-suggested approval or staging. Jim must still reject raw model-suggested release-candidate items; proof authorizes human review movement, not auto-publication. |
| Workflow staged entry | Proposal workflow staging store | Immutable staged-entry ID bound to proposal ID, release ID, tenant, environment, `proposal.stage_release` governed decision ID, validation report ID, audit event ID, staged actor, staged role, and staged payload digest | Jim must resolve staged entries from the workflow store by ID or release scope; staged entries supplied inline by a caller cannot authorize release-candidate contents. |
| Validation-run record | Validation service record store | Validation run ID bound to tenant, environment, subject type, subject ID, ruleset version, input payload digest, status, critical finding count, and report digest/signature | Phyllis and Jim must resolve validation records through Andy's validation service and require a non-blocking result whose subject and input digest match the proposal or release candidate being written. |
| Release-candidate manifest digest | Release metadata ledger and immutable manifest storage | `manifest_digest` in `pharmaops.release_metadata` bound to tenant, environment, release ID, release candidate ID, semantic version, included proposal IDs digest, source-version pins, validation report refs, approval trace, artifact hashes, changelog digest, and audit event range | Jim must persist manifest bytes immutably, compute the digest server-side, insert or resolve the ledger row, and reject any mismatch between computed digest, ledger digest, and requested release candidate. |
| Immutable audit event | Append-only audit event store | Audit event ID bound to tenant, environment, actor, role, action, resource type, resource ID, release ID where applicable, outcome, correlation ID, and payload digest | Phyllis and Jim must append or reserve audit records server-side and verify the resolved event matches the governed action; caller-provided audit IDs cannot be used without lookup and field comparison. |

Replay, cross-tenant references, missing resolver records, mutable records, digest mismatches, unsigned decisions, expired decisions, stale validation runs, mismatched staged entries, mismatched manifest digests, and missing audit linkage are hard authorization denials.

## 6. Backend Enforcement of Mutating Actions

Every mutating action must pass through backend authorization. The backend must reject requests that lack explicit permission, tenant scope, environment scope, workflow-state permission, or required rationale.

Mutating actions include:
- Creating, updating, submitting, approving, rejecting, revising, or escalating proposals.
- Creating or updating entities, mappings, relationships, evidence, comments, review records, and AI suggestion dispositions.
- Staging, promoting, certifying, exporting, or rolling back releases.
- Configuring sources, connectors, normalization jobs, schedules, and source credentials.
- Starting, stopping, retrying, or cancelling connector, validation, export, or release jobs.
- Creating, updating, disabling, or deleting users, groups, role assignments, policies, tenant settings, and environment settings.
- Creating, updating, disabling, rotating, or binding secret references.
- Creating exports, audit exports, or service-account export grants.
- Activating, approving, or terminating break-glass access.

Required enforcement pattern:
1. Authenticate the principal.
2. Resolve tenant membership and active environment grant.
3. Load fresh role and policy state from the authorization service.
4. Validate resource ownership, tenant, environment, workflow state, release state, and license policy.
5. Apply explicit deny policies and separation-of-duties checks.
6. Require step-up authentication for privileged actions.
7. Require rationale for regulated state changes and privileged actions.
8. Perform the mutation and audit-event emission in the same transaction boundary where possible.
9. Return a denial without revealing unauthorized resource existence when disclosure would leak tenant or restricted data.

## 7. Environment-Level Permissions

Environment access is independent of role membership. A principal may have a role in one environment and no access in another.

Environments:
- `development`: permits development fixtures and non-regulated test data. No production secrets or customer data.
- `validation`: permits validation evidence generation and qualification testing. Production-like controls apply.
- `staging`: permits release candidate assembly and final pre-production checks. Promotion requires release-manager privilege and compliance gate evidence.
- `production`: permits customer-facing released content and governed operations only. Privileged production mutations require step-up authentication and audit.

Rules:
- No automatic promotion of permissions across environments.
- Production access must be explicitly granted and time-bounded where possible.
- Production break-glass access must require justification, separate approval, expiry, tenant/resource scope, and audit.
- Validation and staging environments must not use production connector credentials unless explicitly approved and audited.
- Environment must be part of every policy decision, audit event, job record, export, and log correlation context.

## 8. Tenant Isolation Rules

Tenant isolation must be enforced in all layers:

### 8.1 Identity and API

- Tokens must identify allowed tenant memberships; clients cannot self-select arbitrary tenants.
- API tenant headers or path parameters must be validated against the authenticated principal.
- Internal service calls must carry signed tenant, environment, actor, and correlation context.
- APIs must return `404` or generic denial where confirming resource existence would leak cross-tenant data.

### 8.2 Operational Store

- Every tenant-owned row must include `tenant_id`.
- PostgreSQL row-level security or equivalent enforced predicates must apply to tenant-owned tables.
- Admin queries must require explicit privileged paths and must still record tenant scope.
- Shared reference tables must be classified as global, tenant-owned, or licensed-restricted.

### 8.3 Semantic Store

- Named graphs must separate tenant, environment, source, suggestion, staging, and release contexts.
- Graph queries must inject tenant, environment, release, role, and license filters at the server layer.
- Direct SPARQL access must never bypass tenant or RBAC constraints.
- Cross-tenant graph reads are prohibited by default. Any exceptional internal support access must be controlled by `security_admin`, time-limited, justified, separately approved, tenant-scoped, and audited. `platform_admin` alone cannot authorize or execute break-glass cross-tenant graph reads.
- No graph export may include cross-tenant triples unless it is an explicitly approved internal support export with privileged audit and the same `security_admin`-controlled break-glass constraints.

### 8.4 Search

- Search indexing must include tenant, environment, release, role visibility, license class, provenance, and source version fields.
- Query-time filters must be mandatory and server-side.
- Search snippets, explanations, facets, counts, and zero-result diagnostics must respect tenant and role filters.
- Unscoped search access is prohibited.
- Vector, semantic, lexical, and hybrid retrieval pipelines must apply the same authorization filter before returning results.

Phase 5 server-side result filtering is implemented by `services/authz-filter/src/index.js`. Stanley's API boundary must use `services/api/src/query-boundary.js`; Dwight's search boundary must use `services/search/src/index.js`; export paths must use `services/export/src/index.js`. These modules apply the same tenant, environment, role, assertion-type, release-context, license, and export-use checks before results leave the backend. A result-returning path that bypasses this filter is a P0.

Authorization-hidden result counts are prohibited in public and sibling service responses. The shared filter and API/search/export wrappers must not return `filtered_count`, `hidden_count`, `authorization_filtered_count`, or equivalent fields that enumerate denied or cross-tenant candidates. Counts, facets, and invalid-row counters may describe visible authorized rows only.

### 8.5 Logs and Observability

- Logs must not contain raw secrets, tokens, connector credentials, protected records, or full regulated payloads.
- Log records must include tenant and environment context where operationally necessary, but log search must be tenant and role filtered.
- Cross-tenant aggregate metrics must be anonymized and must not expose customer-specific data.

### 8.6 Exports

- Exports must include tenant, release ID, provenance, source versions, artifact hashes, and license constraints.
- Exports must fail closed when tenant, release, provenance, or license scope cannot be proven.
- Export rows must include required regulated fields before leaving the backend: stable row ID, tenant, environment, release ID, provenance ID, artifact or content hash, license status, license classification, license policy ID, and source/target vocabulary versions for mapping-like assertion rows.
- Export manifests must bind canonical sorted exported row content or per-row content hashes, not only row identifiers. Changes to regulated export fields must change the manifest digest or fail verification.
- Working data exports are disallowed unless a future approved workflow explicitly defines them with tenant scope, destination, provenance, license clearance, expiry, named human approval, and privileged audit.
- Restricted-source exports are prohibited unless license/materialization policy explicitly approves the source, destination, tenant, release or preview scope, and exporting principal.
- Service-account exports require an active export grant bound to owning human role, tenant, release scope, destination, license policy, expiry/rotation, and audit purpose.
- Export jobs must write immutable audit events before and after execution.

### 8.7 Background Jobs

- Every job must carry tenant, environment, actor or service-account principal, source, release, and correlation context.
- Workers must claim only jobs within their authorized tenant and environment scope.
- Retry, dead-letter, and failure logs must preserve tenant isolation and avoid sensitive payload leakage.
- Idempotent connector reruns must not overwrite another tenant's source artifacts, normalized records, or job outputs.

## 9. Audit Model

### 9.1 Audit Event Schema

Audit events must include:

```text
event_id
event_type
occurred_at
actor_id
actor_type
actor_role
tenant_id
environment
source_ip_or_client_id
correlation_id
request_id
resource_type
resource_id
resource_version
workflow_state_before
workflow_state_after
release_id
source_system
source_version
action
decision
rationale
policy_result
validation_result
provenance_ref
artifact_hash
outcome
failure_reason
impersonation_or_break_glass_context
```

Payloads must be minimized. Sensitive data, secrets, tokens, and regulated source payloads must not be embedded directly in audit events.

### 9.2 Required Auditable Actions

The full required audit action list from the master prompt is:
- Login.
- Logout.
- Failed authentication.
- Role changes.
- Source configuration changes.
- Connector runs.
- Entity changes.
- Mapping changes.
- AI suggestions.
- Review decisions.
- Release staging.
- Release promotion.
- Rollback.
- Exports.
- Admin actions.

Additional PharmaOps privileged and regulated actions that must be audited:
- MFA enrollment, reset, and failure.
- Session revocation.
- User creation, update, disablement, and tenant membership changes.
- Privileged role assignment or removal.
- RBAC policy creation, update, or deletion.
- Privileged role grant approval or rejection, including second-approver identity.
- RBAC policy change approval or rejection, including second-approver identity.
- Service-account export grant creation, approval, use, expiry, rotation, denial, and revocation.
- Secret reference creation, update, binding, rotation, or disablement.
- Break-glass request, approval, activation, use, expiry, and termination.
- Mandatory security audit review of privileged role grants, RBAC policy changes, service-account export grants, and break-glass sessions.
- Audit search by privileged users.
- Audit export.
- Validation warning waiver.
- Release certification.
- Export denial due to missing release, provenance, license, or tenant scope.
- Unauthorized mutation attempt.
- Cross-tenant access denial.
- Service-account token issuance and use for privileged job execution.
- Job cancellation, retry, and dead-letter handling for connector, export, validation, and release jobs.

### 9.3 Audit Immutability and Access

- Audit events must be append-only.
- Normal admins, including `platform_admin`, cannot edit or delete audit events.
- Audit correction must be represented by a new audit event, not mutation of the original event.
- Audit search is role-filtered and tenant-filtered.
- Audit export requires `security_admin` or `compliance_reviewer` privilege and step-up authentication.
- Audit retention, legal hold, and export format must be confirmed with Compliance and Validation.
- Audit event hashes or append-only storage controls must support tamper-evidence.

## 10. Secrets and Encryption

### 10.1 Secrets Management

- Store secrets only in an approved secrets manager or vault.
- Use references to secrets in application databases; never store plaintext credentials in PostgreSQL, graph stores, search indexes, logs, exports, or audit payloads.
- Scope connector credentials by tenant, environment, source system, and purpose.
- Rotate service-account credentials and connector secrets on a defined schedule and immediately after suspected exposure.
- Require dual control or security-admin approval for production secret changes.
- Deny secret readback through application APIs; privileged users can update or rotate references, not view raw secret values.

### 10.2 Encryption

- Encrypt data in transit with TLS for browser, API, service-to-service, database, object store, search, graph, and queue traffic.
- Encrypt data at rest for PostgreSQL, semantic store, search indexes, object storage, backups, audit store, and job artifacts.
- Use KMS-managed keys with per-environment separation and tenant-aware key strategy where customer requirements demand it.
- Use envelope encryption for sensitive connector artifacts and exports.
- Hash or token-protect API keys and recovery tokens.
- Sign release artifacts and export manifests with artifact hashes.
- Maintain key rotation procedures and recovery testing.

## 11. Threat Model

| Threat | Example | Required controls |
|---|---|---|
| Unauthorized governed mutation | Viewer submits approval API call directly | Backend deny-by-default RBAC, workflow-state checks, audit denial |
| Cross-tenant search leak | Facets or snippets reveal another tenant's entity | Mandatory index-time and query-time tenant filters, count filtering, search isolation tests |
| Cross-tenant API leak | User guesses another tenant resource ID | Tenant-bound tokens, object-level authorization, non-disclosing denial |
| Cross-tenant background job leak | Worker processes wrong tenant queue item | Tenant-scoped job claims, signed execution context, worker authorization |
| Log or metrics leakage | Connector payload appears in logs | Log redaction, payload minimization, tenant-filtered log access |
| Broad service-account misuse | Connector service exports all tenants | Scoped service accounts, short-lived tokens, no wildcard scopes, active export grant bound to human owner, tenant, release, destination, license policy, expiry, and audit per execution |
| Insider privilege abuse | Admin assigns themselves release authority | Separation of `platform_admin` and `security_admin`, step-up auth, audit, dual approval for privileged changes |
| Audit tampering | Admin edits release approval evidence | Append-only audit store, tamper-evidence, no normal-admin edit path |
| Secret exposure | Connector credential stored in source config | Vault references only, no readback, redaction tests, rotation |
| AI suggestion misrepresented | AI output appears as approved fact | Workflow gating, provenance display, review requirement, blocking release check |
| Data poisoning | Connector imports corrupted or unversioned source | Source version pins, validation, provenance, connector reproducibility tests |
| License breach | Licensed source materialized in unauthorized export | License policy checks, export gate, audit denial |
| Release integrity failure | Release lacks hashes or approval trace | Release gate, artifact signing, changelog and evidence checks |
| Rollback failure | Bad release cannot be reverted | Rollback drills, immutable release ledger, tested rollback procedure |
| Security self-escalation | Security admin grants themselves broader privileged access | No self-approval, second approver, expiry for temporary grants, step-up auth, mandatory audit review |
| Break-glass abuse | Security admin accesses production or cross-tenant graphs without reason | Separate approval, rationale, expiry, tenant/resource scope, scoped session, step-up auth, audit review |
| Automated export bypass | Service account exports working-state or restricted licensed data | Release-scoped export grants, human owner binding, destination allowlist, license policy check, expiry/rotation, privileged audit |
| Supply-chain compromise | Vulnerable dependency bypasses service auth | Dependency scanning, signed builds, least-privilege runtime identities |
| Denial of service | Expensive unscoped semantic query | Rate limits, scoped query planner, resource limits, async job controls |
| Backup exposure | Backup contains cross-tenant regulated data | Encrypted backups, access controls, restore evidence, tenant-aware handling |

## 12. Blocking Failure Condition Mapping

| Blocking failure condition | Security control |
|---|---|
| Critical SHACL validation failure | Release workflow must block staging or promotion when validation result is critical. Security policy treats bypass attempts as privileged denied actions and emits audit events. |
| Mapping without source vocabulary version or target vocabulary version | Proposal and release gates require source and target version fields before approval, export, or promotion. |
| Assertion without provenance | Backend blocks proposal approval, release promotion, search-as-approved, and export when provenance is missing. |
| AI suggestion shown as approved fact | AI suggestions remain separate workflow objects until human review and governed approval; raw `model_suggested` payloads are blocked from release-candidate assembly and release graph writes even when feedback exists. |
| Unauthorized user can mutate governed data | Every mutating action requires backend authorization, workflow-state permission, tenant scope, and audit. This is a P0 security blocker. |
| Search leaks unauthorized or cross-tenant data | Search filters are mandatory at index and query time; snippets, facets, counts, and explanations are filtered. Any leak blocks release. |
| Licensed source is materialized without approval | License policy is part of authorization and export gates. Materialization attempts without approval are denied and audited. |
| Export lacks release ID or provenance | Export service fails closed unless release ID, provenance, source versions, tenant scope, and artifact hashes are present. |
| Rollback procedure fails | Release manager cannot certify production readiness without tested rollback evidence. Failed rollback drills block release. |
| Audit event missing for a regulated action | Mutation must fail or enter blocked state if required audit emission cannot be completed. Missing critical audit events block release. |
| Safety data presented as causal without appropriate evidence and disclaimers | Search/API presentation must preserve evidence classification and disclaimers; release gates block unsupported causal claims. |
| Connector cannot be rerun idempotently | Data-engineer connector jobs require source pins, job identity, and reproducibility evidence before governed data can be promoted. |
| Production deployment lacks backup/restore evidence | Production release gate requires backup and restore evidence; privileged release promotion is denied without it. |
| Release candidate lacks changelog, artifact hashes, validation evidence, source-version pins, or approval trace | Release manager promotion requires all listed evidence. Missing evidence blocks promotion and emits audit denial. |

## 13. Security Test Plan

Required test families:
- RBAC negative tests for each role and each mutating action.
- Tenant isolation tests across API, search, graph queries, logs, exports, audit search, and background jobs.
- Privileged-action step-up tests.
- Service-account scope and expiry tests.
- Service-account export grant tests proving human-owner binding, tenant scope, release scope, destination allowlist, license policy, expiry/rotation, and denial of working-state or restricted-source exports without explicit approval.
- Separation-of-duties tests proving no self-approval for privileged role grants, RBAC policy changes, service-account export grants, or break-glass enablement.
- Environment separation tests.
- Audit emission and audit immutability tests.
- Phase 6 no-auto-release tests proving feedback RBAC denial for contributors/service accounts, missing human-governance proof denial, forged proof/signature denial, cross-tenant proof denial, replayed decision denial, raw `model_suggested` release-candidate denial, and audit emission for denied promotion attempts.
- Secret redaction and no-readback tests.
- Release-blocking condition tests.
- Search explanation security tests proving explanations do not expose filtered evidence.
- Break-glass tests for separate approval, expiry, audit, tenant/resource scope, and denial of `platform_admin`-only cross-tenant graph reads.

No release candidate is acceptable until these tests cover the regulated paths they protect.
