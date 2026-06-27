# Mapping Registry Service

Phase 3 backend for governed mapping persistence and lookup.

Scope:

- Persist mapping objects that validate against `packages/contracts/src/mapping-object.schema.json`.
- Keep ordinary CRUD writes in non-governed candidate state only: `review_status` must be `draft` or `proposed`, and `release_id` must be null.
- Create proposed candidate mappings from normalization output without approving or staging them.
- Query mappings by entity, vocabulary, status, and release.
- Record append-only audit events for create, update, delete, candidate ingest, deprecation, and supersession.
- Flag duplicate mapping candidates without auto-merging them.
- Apply governed review transitions only through `applyGovernedTransition({ tenantId, mappingId, transition, authorizationDecision, auditContext })`.
- Produce structured side-by-side diffs from registry working state and proposal payloads.
- Export provenance-preserving mapping manifests with canonical IDs, vocabulary versions, release context, evidence, provenance, and audit linkage.

Out of scope for P3-02:

- Review workflow transitions such as approve, reject, and stage-for-release. Those belong to `services/workflow`.
- RBAC enforcement. Oscar owns the authorization layer; this service exposes `authorizationContext` passthrough metadata for that integration.

## Diff Shape

`diffPreview({ proposal, actor, correlation_id })` is the proposal-workflow adapter. It infers `tenantId`, mapping ID, proposal ID, object type, and proposal payload from the proposal object, then delegates to `createDiff`.

`createDiff({ tenantId, mappingId, proposalPayload, proposalId, correlationId })` compares the stored working-state mapping to a proposed mapping object or patch. It returns:

```js
{
  diff_id,
  object_type: "mapping",
  object_id,
  tenant_id,
  proposal_id,
  correlation_id,
  generated_at,
  sides: {
    current: { vocabulary_versions, provenance, registry_metadata },
    proposed: { vocabulary_versions, provenance, registry_metadata }
  },
  summary: {
    total_fields_changed,
    counts: { added, removed, changed },
    changed_paths
  },
  fields: [
    {
      path,
      change_type: "added" | "removed" | "changed",
      before: { present, value },
      after: { present, value },
      current_context,
      proposed_context
    }
  ]
}
```

Proposal payloads may provide `proposed_mapping`, `proposedMapping`, `mapping`, `mapping_patch`, or `patch`.

## Export Shape

`exportMappings({ tenantId, mappingIds, status, releaseId, releaseContext })` returns a manifest with `export_id`, `manifest_digest`, `release_context`, `record_count`, and one entry per mapping. Each entry preserves canonical mapping/source/target IDs, source and target vocabulary versions, evidence refs, provenance, release staging metadata, registry metadata, and audit linkage.

## Governed Entry Point

`applyGovernedTransition` is the only registry method that can write `review_status: "approved"` or `review_status: "rejected"`, or set `workflow_status: "staged_for_release"` in registry metadata.

Signature:

```js
registry.applyGovernedTransition({
  tenantId,
  mappingId,
  transition: "approve" | "reject" | "stage_release",
  authorizationContext: {
    governedDecision
  },
  auditContext: {
    actor_user_id,
    rationale,
    correlation_id,
    release_id // required only for stage_release
  }
});
```

`governedDecision` must match the signed decision minted by the workflow/RBAC layer after `assertCanGovernMappingCandidate` passes. The registry verifies `decision_id`, `decision="allow"`, action, actor, role, tenant, environment, candidate, mapping, previous/next review status, release ID, rationale digest, evidence digest, provenance ID, source/target vocabulary versions, duplicate status, audit event ID, correlation ID, expiry, `decision_binding`, and signature. Decision IDs are single-use and expired, unsigned, stale, cross-tenant, cross-candidate, cross-mapping, or mismatched decisions fail closed.
