# services/mapping-workflow

Phase 3 governed mapping candidate review workflow.

Scope:

- Route mapping candidates by confidence band.
- Approve or reject proposed mapping candidates with rationale.
- Stage approved mappings for release-candidate assembly without publishing them.
- Keep rejected candidates queryable and auditable.
- Block duplicate candidates from auto-merge and from approval/staging until resolved.
- Call `assertCanGovernMappingCandidate` before any review-state mutation.
- Emit immutable audit events for allowed and denied state transitions.

## State Model

Mapping `review_status` stays compatible with the mapping object contract:

- `proposed`
- `approved`
- `rejected`

Workflow-specific staging uses `workflow_status`:

- `queued_high_confidence`
- `explicit_curator_review`
- `duplicate_review`
- `approved`
- `rejected`
- `staged_for_release`

Allowed transitions:

- `proposed` -> `approved`: `mapping_candidate.approve`, role `curator` or `domain_approver`, non-creator, complete provenance/evidence/confidence/license/vocabulary metadata, no unresolved duplicate.
- `proposed` -> `rejected`: `mapping_candidate.reject`, role `curator` or `domain_approver`, non-creator, rationale required.
- `approved` -> `staged_for_release`: `mapping_candidate.stage_release`, role `release_manager`, release ID supplied, release permitted, validation/evidence refs present, no unresolved duplicate.

`staged_for_release` does not publish a released graph or released mapping. It creates a release staging queue entry for the release manager path.
