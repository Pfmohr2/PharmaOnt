# services/proposal-workflow

Phase 4 backend workflow core for governed semantic proposals.

Scope:

- Submit proposals of type `synonym`, `mapping`, `relationship`, or `evidence-link`.
- Move proposals through `submitted -> validation -> curator-review -> approver-decision -> approved|rejected -> staged-for-release`.
- Keep a queryable review queue by tenant, environment, type, state, queue, status, and confidence band.
- Call the P4-02 validation preview adapter before routing and before release staging.
- Capture a diff preview hook at submission without owning diff computation.
- Emit immutable audit events for every allowed or denied workflow action.
- Use a proposal-equivalent signed governed decision for approve, reject, and stage transitions.
- Stage approved proposals for release-candidate handoff without publishing them.
- Ingest Phase 6 AI suggestions as `assertion_type=model_suggested` candidates that still traverse the same human review lifecycle.
- Route low-confidence AI suggestions to an expert review queue using an explicit threshold/policy.
- Capture human accept/reject/revise feedback as immutable feedback records plus audit events.

Proposal object shape:

```json
{
  "proposal_id": "optional stable id",
  "tenant_id": "tenant-a",
  "environment": "test",
  "proposal_type": "synonym | mapping | relationship | evidence-link",
  "payload": {},
  "provenance": { "provenance_id": "prov:..." },
  "rationale": "why the semantic change is proposed",
  "confidence_score": 0.92,
  "confidence_band": "high"
}
```

Role policy:

- `contributor`: submit.
- `curator`: submit, validate, and route.
- `domain_approver`: approve or reject, with separation of duties from the submitter.
- `release_manager`: stage approved proposals for release.
- AI/ingest service accounts may call `submitAiSuggestion` only to create reviewable `model_suggested` candidates. They cannot validate, route, approve, reject, stage, or record human feedback.
- `expert_reviewer`, `curator`, or `domain_approver` may record AI suggestion feedback; feedback does not approve or release a candidate.
- Model-suggested approval or staging requires immutable human feedback proof from the feedback store. The proof is digest-bound into the signed governed decision through `human_governance_proof_id` and `human_governance_proof_digest`; missing, cross-tenant, stale, or forged proof fails closed and emits a denied audit event.

Phase 6 hooks:

- `submitAiSuggestion({ suggestion, actor, rationale, correlation_id })` / `ingestAiSuggestion(...)`: normalizes Andy's model output into a submitted proposal. Required suggestion fields are provenance, evidence refs, source spans, real confidence score, model name/version, and duplicate status. The submitted proposal is semantically marked `assertion_type=model_suggested`.
- `routeProposal(...)`: routes low-confidence model-suggested proposals to the configured expert queue while preserving state `curator-review`.
- `recordSuggestionFeedback({ proposalId, actor, feedback, rationale, correlation_id })`: appends human feedback with decision `accept`, `reject`, or `revise`; revision feedback carries an immutable revision payload/hash. This records feedback and audit only; it does not approve or reject the proposal.
- `suggestionFeedbackFor(proposalId)`: returns immutable feedback records for API/UI display.

No-auto-release write-path contract:

- `submitAiSuggestion` / `ingestAiSuggestion`: can only create `submitted` `assertion_type=model_suggested` candidates with provenance, evidence, source spans, model metadata, score, and duplicate status.
- `recordSuggestionFeedback`: requires human reviewer roles (`curator`, `domain_approver`, `expert_reviewer`) and rejects contributors and service accounts.
- `approveProposal` / `stageForRelease`: for `model_suggested`, resolve feedback proof server-side and bind it into the signed governed decision before persistence.
- `MemoryProposalStore.applyGovernedTransition`: rejects forged direct model-suggested governed writes that lack proof fields in the signed decision.

Default expert routing policy:

```json
{
  "policy_id": "policy:ai-suggestion-low-confidence-v1",
  "low_confidence_threshold": 0.6,
  "queue": "expert-review"
}
```

Boundaries:

- Validator implementation belongs to P4-02. The default hook calls `services/validation/src/index.js` `validationPreview`; tests and deployments may inject a compatible hook.
- Diff implementation belongs to P4-03. Inject `diffPreview` directly, or pass a mapping registry exposing `diffPreview({ proposal, actor, correlation_id })`.
- RBAC internals belong to P4-04.
- Release candidate packaging belongs to P4-05.
- UI is deferred to Phase 5.
- AI suggestion engines are Phase 6 inputs owned outside this service; this service owns only governed routing and feedback capture.
