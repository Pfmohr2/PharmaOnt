# PharmaOps Validation Service

Phase 4 validation preview provides a pure, non-mutating rule check for governed semantic proposals and release candidates.

## Interface

```js
import {
  validate,
  validationPreview,
  validateProposal,
  validateReleaseCandidate,
  assertNoCriticalFailures,
  resolveValidationEvidence,
  assertResolvedValidationEvidence
} from "./src/index.js";
```

- `validate(proposalOrRelease, options)` returns `{ status, findings, blocking, summary, ruleset_version }`.
- `validationPreview({ proposal, actor, correlation_id, phase })` adapts workflow proposals to `{ status, critical_failures, warnings, validation_report_id, findings }`.
- `validateProposal(proposal, options)` previews a synonym, mapping, relationship, or evidence-link proposal.
- `validateReleaseCandidate(releaseCandidate, options)` validates release packaging inputs.
- `assertNoCriticalFailures(proposalOrRelease, options)` returns the same result when passable and throws `ValidationError` when `blocking` is true.
- `resolveValidationEvidence(releaseCandidate, options)` resolves `validation_report_refs` to immutable validation-run records and returns a validation result.
- `assertResolvedValidationEvidence(releaseCandidate, options)` throws `ValidationError` when evidence is unresolved, scope-mismatched, failed, or has unwaived critical findings.

The validation functions do not mutate proposal, mapping, relationship, evidence-link, or release-candidate objects.

## Critical Rules

- `required_provenance`: governed assertions must carry provenance.
- `required_evidence`: governed assertions must carry supporting evidence.
- `mapping_source_target_versions`: mappings must include source and target vocabulary versions.
- `confidence_not_fabricated`: confidence must be present, numeric from 0 to 1, banded, and not fabricated.
- `faers_non_causal`: FAERS/openFDA safety data must not be presented as causal and must carry source limitations with evidence.
- `tenant_boundary`: validation fails on cross-tenant references.
- `release_approval_state`: release candidates can only contain reviewed, approved, release-ready items.
- `release_candidate_evidence_package`: release candidates must include changelog, artifact hashes, validation evidence, source-version pins, approval trace, and governed items.

## Release Gate

Workflow, staging, and release packaging services should call:

```js
validationPreview({
  proposal,
  actor,
  correlation_id,
  phase: "route" // validation | route | stage_release
});

assertNoCriticalFailures(releaseCandidate, {
  releaseMode: true,
  expectedTenantId: releaseCandidate.tenant_id
});

await assertResolvedValidationEvidence(releaseCandidate, {
  expectedTenantId: releaseCandidate.tenant_id,
  environment: releaseCandidate.environment,
  releaseId: releaseCandidate.release_id,
  releaseCandidateId: releaseCandidate.release_candidate_id,
  async resolveValidationRun({ validation_run_id, tenant_id, environment, release_id, release_candidate_id, item_ids }) {
    return validationRunStore.getImmutableRun({
      validation_run_id,
      tenant_id,
      environment,
      release_id,
      release_candidate_id,
      item_ids
    });
  },
  async resolveValidationWaiver({ validation_run_id, finding_id, rule_id, tenant_id, environment, release_id, release_candidate_id }) {
    return waiverStore.getApprovedAuditedWaiver({
      validation_run_id,
      finding_id,
      rule_id,
      tenant_id,
      environment,
      release_id,
      release_candidate_id
    });
  }
});
```

Any unresolved critical finding sets `blocking: true` and must prevent staging, packaging, or release promotion.

Caller-supplied `validation_report_refs` are identifiers only. Inline fields such as `result`, `severity`, or `resolved` are not authoritative for release packaging. The release gate must resolve each referenced run server-side and fail closed unless the immutable record is passing or every critical finding is covered by a verified audited waiver.

Resolved validation-run records must carry:

- `validation_run_id`, `tenant_id`, `environment`
- `subject_type`, `subject_id`
- `release_id`, `release_candidate_id` when validating a release candidate
- `input_payload_digest` for the exact proposal or release candidate being written
- `item_ids` for included governed items
- `ruleset_version`, `status`, critical finding count, `findings`
- `report_digest`
- `signature` or `immutable_storage_digest`
- immutability evidence such as `immutable: true` or `immutable_record_id`

Missing records, cross-tenant or cross-environment records, subject or input digest mismatch, mutable records, stale or superseded records, failed integrity checks, and unwaived critical findings are hard release blockers.
