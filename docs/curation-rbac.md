# Governed Mapping Curation RBAC

Phase 3 mapping normalization produces reviewable candidates only. Candidate entities, relationships, and mappings are not governed facts until a server-side authorization check, review decision, validation, audit write, and workflow transition succeed.

This document defines RBAC for governed mapping candidate actions. It complements the mapping object contract in `packages/contracts/src/mapping-object.schema.json`, the provenance/evidence schemas, and the security model. Frontend controls may hide buttons, but they are not an authorization boundary.

## Governed Actions

The MVP governed actions are:

| Action | Permission | Allowed human roles | Required starting state | Result |
|---|---|---|---|---|
| Approve mapping candidate | `mapping_candidate.approve` | `curator`, `domain_approver` | `review_status = proposed` | Candidate becomes approved for governed working state, not released |
| Reject mapping candidate | `mapping_candidate.reject` | `curator`, `domain_approver` | `review_status = proposed` | Candidate becomes rejected with rationale |
| Stage mapping candidate for release | `mapping_candidate.stage_release` | `release_manager` | `review_status = approved` | Candidate is included in release-candidate assembly queue |

Service accounts cannot approve, reject, stage for release, publish governed facts, promote releases, or bypass review. Migration `services/db/migrations/0004_curation_mapping_rbac.sql` removes these permissions from non-authorized roles and adds explicit service-account scope denies for:

- `mapping_candidate.approve`
- `mapping_candidate.reject`
- `mapping_candidate.stage_release`

## Required Candidate Preconditions

Authorization must fail closed unless the mapping candidate has:

- matching `tenant_id` and `environment`;
- `mapping_id`;
- source and target entity identifiers;
- source and target vocabulary names;
- `source_vocabulary_version`;
- `target_vocabulary_version`;
- predicate from the approved mapping predicate enum;
- license policy fields and non-blocked `license_status`;
- `confidence_score` and `confidence_band` supplied by upstream evidence or scoring provenance, not fabricated by the reviewer;
- `provenance_id` and provenance payload;
- at least one `evidence_id` and structured `evidence_refs`;
- duplicate status explicitly evaluated.

Duplicate candidates may be flagged, routed, or rejected, but they must not be auto-merged. Approval and staging require no unresolved duplicate flag.

## Separation Of Duties

The actor approving, rejecting, or staging a candidate must be a human user. The actor cannot approve, reject, or stage:

- a candidate they created;
- a candidate emitted by a service account they own or control, when ownership is known;
- a candidate from another tenant or environment;
- a candidate whose source or target license policy blocks curation or release;
- a candidate with missing source/target vocabulary versions, provenance, evidence, or confidence metadata.

Staging for release is deliberately narrower than approval. Only `release_manager` can stage approved candidates for release assembly. A `curator` or `domain_approver` approval does not imply release eligibility or release-manager authority.

## Authorization Interface

Phyllis's workflow service should call the authorization layer before any review-state mutation:

```ts
type GovernedMappingAction =
  | "mapping_candidate.approve"
  | "mapping_candidate.reject"
  | "mapping_candidate.stage_release";

type GovernedMappingActor = {
  user_id: string;
  role_keys: string[];
  tenant_id: string;
  environment: string;
  mfa_verified_at?: string;
};

type GovernedMappingCandidate = {
  candidate_id: string;
  mapping_id: string;
  tenant_id: string;
  environment: string;
  review_status: "proposed" | "approved" | "rejected" | "deprecated" | "released";
  created_by_user_id?: string | null;
  created_by_service_account_id?: string | null;
  service_account_owner_user_id?: string | null;
  source_entity_id: string;
  target_entity_id: string;
  predicate: string;
  source_vocabulary: string;
  source_vocabulary_version: string;
  target_vocabulary: string;
  target_vocabulary_version: string;
  source_license_policy_id: string;
  target_license_policy_id: string;
  license_status: "valid" | "restricted" | "blocked" | "pending_review" | "not_required";
  permitted_uses: string[];
  confidence_score: number;
  confidence_band: "high" | "medium" | "low" | "blocked";
  confidence_source?: string;
  provenance_id: string;
  provenance: Record<string, unknown>;
  evidence_ids: string[];
  evidence_refs: Array<Record<string, unknown>>;
  duplicate_status?: "not_duplicate" | "possible_duplicate" | "confirmed_duplicate" | "unresolved";
  release_id?: string | null;
};

function assertCanGovernMappingCandidate(input: {
  actor: GovernedMappingActor;
  candidate: GovernedMappingCandidate;
  action: GovernedMappingAction;
  tenant_id: string;
  environment: string;
  rationale: string;
  correlation_id: string;
  release_id?: string;
}): {
  allowed: true;
  action: GovernedMappingAction;
  actor_user_id: string;
  actor_role_key: "curator" | "domain_approver" | "release_manager";
  tenant_id: string;
  environment: string;
  candidate_id: string;
  audit_event_type: "mapping_candidate_approved" | "mapping_candidate_rejected" | "mapping_candidate_staged";
};
```

The function must throw a non-disclosing authorization error when denied. It must not return partial candidate data for another tenant.

Action-specific checks:

- `mapping_candidate.approve`: actor has `curator` or `domain_approver`; candidate is `proposed`; required evidence, provenance, confidence, license, and vocabulary-version fields are present; duplicate status is not unresolved; actor is not creator or service-account owner.
- `mapping_candidate.reject`: actor has `curator` or `domain_approver`; candidate is `proposed`; rationale is present; actor is not creator or service-account owner.
- `mapping_candidate.stage_release`: actor has `release_manager`; candidate is `approved`; release ID is supplied; `permitted_uses` includes `release`; license status is not `blocked` or `pending_review`; duplicate status is not unresolved; required release evidence and validation references are present.

## Authorization Decision For Registry Writes

The mapping registry is a write boundary. `MappingRegistry.createMapping` and `MappingRegistry.updateMapping` must not accept governed transitions such as `review_status = approved`, `review_status = rejected`, `reviewed_by`, release staging metadata, deprecation by review, supersession by review, or other governed decision fields unless the call includes a verified authorization decision minted by `assertCanGovernMappingCandidate`.

The workflow service may pass the decision as `authorizationContext.governedDecision`:

```ts
type GovernedMappingAuthorizationDecision = {
  decision_id: string;
  decision: "allow";
  action: GovernedMappingAction;
  actor_user_id: string;
  actor_role_key: "curator" | "domain_approver" | "release_manager";
  tenant_id: string;
  environment: string;
  candidate_id: string;
  mapping_id: string;
  previous_review_status: "proposed" | "approved" | "rejected" | "deprecated" | "released";
  next_review_status: "approved" | "rejected" | "deprecated";
  release_id?: string | null;
  rationale_digest: string;
  evidence_digest: string;
  provenance_id: string;
  source_vocabulary_version: string;
  target_vocabulary_version: string;
  duplicate_status?: string | null;
  audit_event_id: string;
  correlation_id: string;
  issued_at: string;
  expires_at: string;
  decision_binding: string;
  signature: string;
};
```

The decision is not a caller-authored `{ authorized: true }` flag. It is minted only by the server-side authorization service after `assertCanGovernMappingCandidate` passes and after the governed audit event ID is reserved or written. Connector code, frontend code, registry clients, and service accounts must not mint it.

`decision_binding` is a canonical SHA-256 digest over:

```text
decision_id
decision
action
actor_user_id
actor_role_key
tenant_id
environment
candidate_id
mapping_id
previous_review_status
next_review_status
release_id
rationale_digest
evidence_digest
provenance_id
source_vocabulary_version
target_vocabulary_version
duplicate_status
audit_event_id
correlation_id
issued_at
expires_at
```

`signature` is a MAC or signature over `decision_binding` using a server-side key unavailable to callers and unavailable to the mapping registry persistence client. Short expiry is required; the decision is single-use for one registry write.

The registry must verify all of the following before persisting a governed transition:

1. `decision === "allow"`.
2. `action` matches the requested transition.
3. Signature or MAC verifies against `decision_binding`.
4. `expires_at` is in the future.
5. `tenant_id`, `environment`, `candidate_id`, and `mapping_id` match the write target.
6. Previous and next review statuses match the actual mutation.
7. `actor_user_id`, `actor_role_key`, and `audit_event_id` are stamped into registry metadata and audit linkage.
8. Source/target vocabulary versions, provenance ID, evidence digest, duplicate status, release ID, and correlation ID match the candidate state and requested patch.
9. `decision_id` has not already been used.

The registry must reject replayed decisions, expired decisions, cross-tenant decisions, cross-candidate decisions, mismatched action/status decisions, decisions missing audit linkage, and unsigned/unbound objects. A stale approval decision cannot be reused to stage release, approve another mapping, or approve a modified candidate whose evidence/provenance/vocabulary versions differ.

## Audit Linkage

Every allowed decision must write the workflow state transition, review or approval row, and audit event in one transaction where possible. The audit event must include:

- `tenant_id` and `environment`;
- `actor_user_id`;
- `actor_role_key`;
- `action`;
- `candidate_id` and `mapping_id`;
- previous and next review status;
- source and target vocabulary versions;
- provenance ID and evidence IDs;
- license policy IDs and license status;
- duplicate status;
- rationale;
- correlation ID.

Denied attempts must also be auditable without leaking cross-tenant candidate details.

## Phase 4 Proposal Lifecycle RBAC

Phase 4 extends the same server-side authorization pattern from mapping candidates to the full proposal lifecycle. A proposal may move through workflow state only after the authorization service validates actor role, tenant and environment, state preconditions, separation of duties, audit linkage, and any required signed decision.

| Lifecycle step | Permission | Allowed human roles | Required starting state | Result |
|---|---|---|---|---|
| Submit proposal | `proposal.submit` | `contributor`, `curator` | Draft proposal in actor tenant | Proposal enters governed review workflow |
| Validate proposal | `proposal.validate` | `curator` | Submitted proposal in actor tenant | Validation result is recorded for routing |
| Route to curator review | `proposal.route_curator_review` | `curator` | Submitted or validated proposal | Proposal enters curator review queue |
| Route to approver decision | `proposal.route_approver_decision` | `curator` | Validation passed | Proposal enters domain approver queue |
| Approve proposal | `proposal.approve` | `domain_approver` | Routed proposal with validation passed | Proposal becomes approved through a signed decision |
| Reject proposal | `proposal.reject` | `domain_approver` | Routed proposal | Proposal becomes rejected through a signed decision |
| Stage approved proposal | `proposal.stage_release` | `release_manager` | Approved proposal with validation passed | Proposal is eligible for release-candidate assembly |
| Create release candidate | `release_candidate.create` | `release_manager` | All included proposals approved and validation passed | Release candidate is created through a signed release decision |

Service accounts cannot submit governed proposals, validate, route, approve, reject, stage, create release candidates, or mint proposal lifecycle decisions. Service accounts may emit tenant-scoped candidates through connector-specific scopes only; those candidates must still pass human governance before they become governed proposals or release content.

The lifecycle policy is fail closed:

- `contributor` can submit own-tenant proposals but cannot approve, reject, route, stage, or create release candidates.
- `curator` can validate and route own-tenant proposals but cannot approve or reject the final domain decision.
- `domain_approver` can approve or reject routed own-tenant proposals but cannot approve or reject proposals they submitted.
- `release_manager` can stage approved proposals and create release candidates but cannot approve proposal content.
- All checks require matching `tenant_id` and `environment`; cross-tenant data must return a non-disclosing authorization denial.
- Validation-passed evidence is required before `proposal.route_approver_decision`, `proposal.approve`, `proposal.stage_release`, or `release_candidate.create`.
- Release-candidate creation requires all included proposal IDs to be approved, source-version pins, validation report references, changelog digest, content hashes, approval trace, and audit event range.

### Proposal Authorization Interfaces

Phyllis's workflow service calls `assertCanGovernProposal(...)` before mutating proposal state. The authorization layer may also expose narrower wrappers for readability, but `assertCanGovernProposal` is the integration hook for `services/proposal-workflow/src/authz.js` and the action names must stay stable.

```ts
type ProposalLifecycleAction =
  | "proposal.submit"
  | "proposal.validate"
  | "proposal.route_curator_review"
  | "proposal.route_approver_decision"
  | "proposal.approve"
  | "proposal.reject"
  | "proposal.stage_release"
  | "release_candidate.create";

type ProposalLifecycleActor = {
  user_id: string;
  role_keys: string[];
  tenant_id: string;
  environment: string;
  mfa_verified_at?: string;
};

type GovernedProposal = {
  proposal_id: string;
  proposal_key?: string;
  proposal_type: "synonym" | "mapping" | "relationship" | "evidence-link" | string;
  tenant_id: string;
  environment: string;
  state: "submitted" | "validation" | "curator-review" | "approver-decision" | "approved" | "rejected" | "staged-for-release";
  submitted_by_user_id?: string | null;
  created_by_user_id?: string | null;
  created_by_service_account_id?: string | null;
  payload?: Record<string, unknown>;
  validation_result?: Record<string, unknown> | null;
  provenance?: Record<string, unknown> | null;
  provenance_id?: string | null;
  release_id?: string | null;
};

type ProposalLifecycleDecision = {
  allowed: true;
  action: ProposalLifecycleAction;
  actor_user_id: string;
  actor_role_key: "contributor" | "curator" | "domain_approver" | "release_manager";
  tenant_id: string;
  environment: string;
  proposal_id: string | null;
  proposal_type: string | null;
  audit_event_type:
    | "proposal_submitted"
    | "proposal_validated"
    | "proposal_routed_curator_review"
    | "proposal_routed_approver_decision"
    | "proposal_approved"
    | "proposal_rejected"
    | "proposal_staged_for_release";
};

function assertCanGovernProposal(input: {
  actor: ProposalLifecycleActor;
  proposal?: GovernedProposal | null;
  action: ProposalLifecycleAction;
  tenant_id: string;
  environment: string;
  rationale: string;
  correlation_id: string;
  release_id?: string | null;
}): ProposalLifecycleDecision;

function assertCanSubmitProposal(input: {
  actor: ProposalLifecycleActor;
  proposal?: GovernedProposal | null;
  tenant_id: string;
  environment: string;
  rationale: string;
  correlation_id: string;
}): ProposalLifecycleDecision;

function assertCanRouteProposal(input: {
  actor: ProposalLifecycleActor;
  proposal: GovernedProposal;
  action: "proposal.validate" | "proposal.route_curator_review" | "proposal.route_approver_decision";
  tenant_id: string;
  environment: string;
  route?: string;
  validation_result?: Record<string, unknown>;
  rationale: string;
  correlation_id: string;
}): ProposalLifecycleDecision;

function assertCanApproveRejectProposal(input: {
  actor: ProposalLifecycleActor;
  proposal: GovernedProposal;
  action: "proposal.approve" | "proposal.reject" | "proposal.stage_release";
  tenant_id: string;
  environment: string;
  rationale: string;
  correlation_id: string;
  release_id?: string | null;
}): ProposalLifecycleAuthorizationDecision;

function assertCanCreateReleaseCandidate(input: {
  actor: ProposalLifecycleActor;
  release_candidate_id: string;
  tenant_id: string;
  environment: string;
  included_proposals: GovernedProposal[];
  validation_summary: Record<string, unknown>;
  source_version_pins: Record<string, unknown>[];
  validation_report_refs: Record<string, unknown>[];
  changelog_digest: string;
  content_hashes_digest: string;
  approval_trace_digest: string;
  audit_event_range: { first: string; last: string };
  rationale: string;
  correlation_id: string;
}): ReleaseCandidateAuthorizationDecision;
```

`ProposalLifecycleDecision` is an allow result consumed by Phyllis's workflow. Approve, reject, stage, and release-candidate creation require signed authorization decisions because they cross governed write boundaries. `assertCanSubmitProposal`, `assertCanRouteProposal`, and `assertCanApproveRejectProposal` are typed wrappers over `assertCanGovernProposal`; they should not implement divergent policy.

### Proposal And Release Signed Decisions

```ts
type ProposalLifecycleAuthorizationDecision = {
  decision_id: string;
  decision: "allow";
  action: "proposal.approve" | "proposal.reject" | "proposal.stage_release";
  actor_user_id: string;
  actor_role_key: "domain_approver" | "release_manager";
  tenant_id: string;
  environment: string;
  proposal_id: string;
  proposal_type: string;
  previous_state: string;
  next_state: string;
  validation_digest: string;
  validation_report_id?: string | null;
  payload_digest: string;
  provenance_id: string;
  rationale_digest: string;
  release_id?: string | null;
  audit_event_id: string;
  correlation_id: string;
  issued_at: string;
  expires_at: string;
  decision_binding: string;
  signature: string;
};

type ReleaseCandidateAuthorizationDecision = {
  decision_id: string;
  decision: "allow";
  action: "release_candidate.create";
  actor_user_id: string;
  actor_role_key: "release_manager";
  tenant_id: string;
  environment: string;
  release_candidate_id: string;
  included_proposal_ids_digest: string;
  all_approved: true;
  validation_passed: true;
  validation_summary_digest: string;
  source_version_pins_digest: string;
  validation_report_refs_digest: string;
  changelog_digest: string;
  content_hashes_digest: string;
  approval_trace_digest: string;
  audit_event_range_digest: string;
  rationale_digest: string;
  audit_event_id: string;
  correlation_id: string;
  issued_at: string;
  expires_at: string;
  decision_binding: string;
  signature: string;
};
```

The decision is minted only by the server-side authorization service after the required audit event is reserved or written. It is not a caller-authored boolean. `decision_binding` is a canonical SHA-256 digest over every field above except `signature`; `signature` is a MAC or signature over `decision_binding` using a key unavailable to callers and persistence clients. Decisions are short-lived and single-use.

Workflow and release-manager write paths must reject replayed decisions, expired decisions, cross-tenant decisions, cross-proposal decisions, release-candidate decisions with missing all-approved evidence, release-candidate decisions without validation-passed evidence, mismatched lifecycle states, unsigned decisions, and decisions missing audit linkage.

### Immutable Governance Proof Verification

Phase 4 services must verify governance proof against immutable persisted records, not caller-supplied copies. Request payloads may carry IDs such as `decision_id`, `staged_entry_id`, `validation_run_id`, `release_candidate_id`, `manifest_digest`, or `audit_event_id`; they must not carry authoritative governed state.

The write path must resolve and compare these records before persisting a governed transition or release candidate:

| Artifact | Resolve by ID from | Required binding | Verification rule |
|---|---|---|---|
| `governed_decision` | Authorization decision verifier or workflow decision store | Decision ID, action, actor, role, tenant, environment, proposal ID, previous state, next state, release ID, validation digest or validation report ID, payload digest, provenance ID, audit event ID, correlation ID, `issued_at`, `expires_at`, `decision_binding`, `signature` | Phyllis must verify approve/reject/stage decisions before workflow writes; Jim must verify `release_candidate.create` decisions before candidate writes. Decisions are single-use and expire. |
| Workflow staged entry | Proposal workflow staging store | Staged entry ID, proposal ID, release ID, tenant, environment, staged state, staged actor, staged role, `proposal.stage_release` governed decision ID, validation report ID, audit event ID, and staged payload digest | Jim must load staged entries server-side by release scope or staged entry ID. Inline staged entries may be used only as display hints and cannot authorize candidate content. |
| Validation-run record | Andy's validation service record store | Validation run ID, tenant, environment, subject type, subject ID, ruleset version, input payload digest, status, critical finding count, report digest, and signature or immutable storage digest | Phyllis and Jim must resolve validation records server-side and require a non-blocking result whose subject and input digest match the proposal or release candidate being written. |
| Release-candidate manifest digest | Immutable manifest storage plus release metadata ledger | Manifest digest bound to tenant, environment, release ID, release candidate ID, semantic version, included proposal IDs digest, source-version pins digest, validation report refs digest, approval trace digest, artifact hashes digest, changelog digest, and audit event range digest | Jim must compute the manifest digest from bytes written immutably and reconcile it with `pharmaops.release_metadata.manifest_digest`; caller-provided digest or snapshot refs cannot override the ledger. |
| Immutable audit event | Append-only audit event store | Audit event ID, tenant, environment, actor, role, action, resource type, resource ID, release ID where applicable, outcome, correlation ID, payload digest, and occurrence time | Phyllis and Jim must append or reserve audit events server-side and verify the resolved event matches the governed action before stamping audit linkage. |

If any resolver lookup fails, returns another tenant or environment, returns a mutable record, returns a stale validation run, returns a digest or signature mismatch, or does not match the requested write, the service must fail closed. A caller cannot fabricate governance by sending `{ authorized: true }`, inline validation summaries, inline staged entries, snapshot refs, manifest digests, or audit IDs without matching persisted records.

## Database Stub

Migration `0004_curation_mapping_rbac.sql` adds:

- `mapping_candidate.approve`;
- `mapping_candidate.reject`;
- `mapping_candidate.stage_release`;
- grants for approve/reject to `curator` and `domain_approver`;
- grant for stage to `release_manager`;
- `governed_mapping_action_policies` for workflow-policy lookup;
- `pharmaops.governed_mapping_action_role_allowed(role_key, action_key)`;
- service-account deny constraints for mapping candidate decision actions.

Migration `0005_proposal_lifecycle_rbac.sql` adds:

- `proposal.validate`;
- `proposal.route_curator_review`;
- `proposal.route_approver_decision`;
- `proposal.approve`;
- `proposal.reject`;
- `proposal.stage_release`;
- `release_candidate.create`;
- grants for `proposal.submit` to `contributor` and `curator`;
- grants for validate and route actions to `curator`;
- grants for approve/reject to `domain_approver`;
- grants for stage and release-candidate creation to `release_manager`;
- `proposal_lifecycle_action_policies` for workflow-policy lookup;
- `pharmaops.proposal_lifecycle_action_role_allowed(role_key, action_key)`;
- service-account deny constraints for proposal lifecycle and release-candidate creation actions.
