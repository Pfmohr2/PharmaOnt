import { createHash } from "node:crypto";

import {
  mappingObjectSchemaContract,
  mappingPredicates,
  validateMappingObjectShape
} from "../../../packages/contracts/src/index.js";

export const mappingRegistryPersistedSchema = Object.freeze({
  name: "pharmaops.mapping_registry.mapping",
  version: "p3-02.working.v1",
  mapping_object_schema_id: mappingObjectSchemaContract.$id,
  persisted_mapping_schema: mappingObjectSchemaContract,
  registry_metadata: Object.freeze({
    tenant_id: "string",
    working_state: "working",
    duplicate_of: "string|null",
    supersedes: "string|null",
    superseded_by: "string|null",
    workflow_status: "string|null",
    candidate_metadata: "object|null",
    deleted_at: "date-time|null",
    release_staging: "object|null",
    governed_audit_event_ids: "string[]",
    audit_event_ids: "string[]"
  })
});

const CRUD_STATUSES = Object.freeze(["draft", "proposed"]);
const CANDIDATE_STATUSES = Object.freeze(["draft", "proposed"]);
const GOVERNED_TRANSITIONS = Object.freeze({
  approve: Object.freeze({
    action: "mapping_candidate.approve",
    audit_event_type: "mapping_candidate_approved",
    review_status: "approved",
    workflow_status: "approved",
    roles: ["curator", "domain_approver"]
  }),
  reject: Object.freeze({
    action: "mapping_candidate.reject",
    audit_event_type: "mapping_candidate_rejected",
    review_status: "rejected",
    workflow_status: "rejected",
    roles: ["curator", "domain_approver"]
  }),
  stage_release: Object.freeze({
    action: "mapping_candidate.stage_release",
    audit_event_type: "mapping_candidate_staged",
    review_status: "approved",
    workflow_status: "staged_for_release",
    roles: ["release_manager"]
  })
});

export class MappingRegistryError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MappingRegistryError";
    this.details = details;
  }
}

export class InMemoryMappingRegistryStore {
  constructor() {
    this.records = new Map();
    this.auditEvents = [];
  }

  key(tenantId, mappingId) {
    return `${tenantId}\u0000${mappingId}`;
  }

  put(record) {
    this.records.set(this.key(record.tenant_id, record.mapping.mapping_id), clone(record));
    return clone(record);
  }

  get(tenantId, mappingId) {
    const record = this.records.get(this.key(tenantId, mappingId));
    return record ? clone(record) : null;
  }

  list(tenantId) {
    return [...this.records.values()]
      .filter((record) => record.tenant_id === tenantId)
      .map(clone);
  }

  appendAudit(event) {
    const stored = clone(event);
    this.auditEvents.push(stored);
    return clone(stored);
  }

  listAudit(tenantId, mappingId = null) {
    return this.auditEvents
      .filter((event) => event.tenant_id === tenantId && (!mappingId || event.mapping_id === mappingId))
      .map(clone);
  }
}

export class MappingRegistry {
  constructor({
    store = new InMemoryMappingRegistryStore(),
    clock = () => new Date(),
    idFactory = defaultIdFactory,
    governedDecisionVerifier = null
  } = {}) {
    this.store = store;
    this.clock = clock;
    this.idFactory = idFactory;
    this.governedDecisionVerifier = governedDecisionVerifier;
    this.usedGovernedDecisionIds = new Set();
  }

  createMapping({ tenantId, mapping, actor, correlationId = null, authorizationContext = null, registryMetadata = null }) {
    assertTenant(tenantId);
    assertActor(actor);
    const normalized = normalizeMappingForWorkingState(mapping);
    assertPersistableMapping(normalized);
    if (this.store.get(tenantId, normalized.mapping_id)) {
      throw new MappingRegistryError(`mapping already exists: ${normalized.mapping_id}`);
    }
    const now = this.clock().toISOString();
    const duplicateOf = this.findDuplicate({ tenantId, mapping: normalized })?.mapping.mapping_id ?? null;
    const audit = this.audit({
      tenantId,
      mappingId: normalized.mapping_id,
      action: "mapping.create",
      actor,
      correlationId,
      previous: null,
      next: normalized
    });
    const record = {
      tenant_id: tenantId,
      working_state: "working",
      mapping: normalized,
      registry_metadata: {
        created_at: now,
        updated_at: now,
        deleted_at: null,
        duplicate_of: duplicateOf,
        duplicate_status: duplicateOf ? "flagged_duplicate_not_merged" : null,
        supersedes: null,
        superseded_by: null,
        deprecation: null,
        workflow_status: registryMetadata?.workflow_status ?? null,
        candidate_metadata: registryMetadata?.candidate_metadata ?? null,
        authorization_context: authorizationContext,
        audit_event_ids: [audit.audit_event_id]
      }
    };
    return this.store.put(record);
  }

  getMapping({ tenantId, mappingId, includeDeleted = false }) {
    assertTenant(tenantId);
    const record = this.store.get(tenantId, mappingId);
    if (!record || (!includeDeleted && record.registry_metadata.deleted_at)) {
      return null;
    }
    return record;
  }

  updateMapping({ tenantId, mappingId, patch, actor, correlationId = null, authorizationContext = null }) {
    assertTenant(tenantId);
    assertActor(actor);
    assertOrdinaryPatch(patch);
    const existing = requireRecord(this.store.get(tenantId, mappingId), mappingId);
    assertNotDeleted(existing);
    const nextMapping = normalizeMappingForWorkingState({
      ...existing.mapping,
      ...patch,
      mapping_id: existing.mapping.mapping_id
    });
    assertPersistableMapping(nextMapping);
    const audit = this.audit({
      tenantId,
      mappingId,
      action: "mapping.update",
      actor,
      correlationId,
      previous: existing.mapping,
      next: nextMapping
    });
    const nextRecord = {
      ...existing,
      mapping: nextMapping,
      registry_metadata: {
        ...existing.registry_metadata,
        updated_at: this.clock().toISOString(),
        authorization_context: authorizationContext,
        audit_event_ids: [...existing.registry_metadata.audit_event_ids, audit.audit_event_id]
      }
    };
    return this.store.put(nextRecord);
  }

  applyGovernedTransition({
    tenantId,
    mappingId,
    transition,
    authorizationDecision,
    authorizationContext = null,
    auditContext = {}
  }) {
    assertTenant(tenantId);
    const spec = GOVERNED_TRANSITIONS[transition];
    if (!spec) {
      throw new MappingRegistryError(`unknown governed transition: ${transition}`);
    }
    const governedDecision = authorizationDecision ?? authorizationContext?.governedDecision;
    const existing = requireRecord(this.store.get(tenantId, mappingId), mappingId);
    assertNotDeleted(existing);
    assertGovernedTransitionState({ record: existing, transition });
    assertAuthorizationDecision({
      decision: governedDecision,
      spec,
      tenantId,
      record: existing,
      releaseId: auditContext.release_id ?? null,
      actorUserId: auditContext.actor_user_id,
      correlationId: auditContext.correlation_id,
      rationale: auditContext.rationale,
      clock: this.clock,
      verifier: this.governedDecisionVerifier,
      usedDecisionIds: this.usedGovernedDecisionIds
    });
    const nextMapping = {
      ...existing.mapping,
      review_status: spec.review_status,
      reviewed_by: governedDecision.actor_user_id,
      release_id: null
    };
    assertPersistableGovernedMapping(nextMapping);
    const now = this.clock().toISOString();
    const audit = this.audit({
      tenantId,
      mappingId,
      action: `mapping.governed.${transition}`,
      actor: governedDecision.actor_user_id,
      correlationId: auditContext.correlation_id ?? null,
      reason: auditContext.rationale ?? null,
      previous: existing.mapping,
      next: nextMapping,
      authorizationDecision: governedDecision
    });
    this.usedGovernedDecisionIds.add(governedDecision.decision_id);
    const nextRecord = {
      ...existing,
      mapping: nextMapping,
      registry_metadata: {
        ...existing.registry_metadata,
        updated_at: now,
        workflow_status: spec.workflow_status,
        release_staging: transition === "stage_release"
          ? {
              release_id: auditContext.release_id,
              staged_by: governedDecision.actor_user_id,
              staged_at: now,
              audit_event_id: governedDecision.audit_event_id,
              registry_audit_event_id: audit.audit_event_id
            }
          : existing.registry_metadata.release_staging ?? null,
        authorization_context: {
          governedDecision,
          audit_event_id: governedDecision.audit_event_id,
          registry_audit_event_id: audit.audit_event_id
        },
        governed_audit_event_ids: [
          ...(existing.registry_metadata.governed_audit_event_ids ?? []),
          governedDecision.audit_event_id
        ],
        audit_event_ids: [...existing.registry_metadata.audit_event_ids, audit.audit_event_id]
      }
    };
    return this.store.put(nextRecord);
  }

  deleteMapping({ tenantId, mappingId, actor, reason, correlationId = null }) {
    assertTenant(tenantId);
    assertActor(actor);
    assertNonEmpty(reason, "reason");
    const existing = requireRecord(this.store.get(tenantId, mappingId), mappingId);
    assertNotDeleted(existing);
    const audit = this.audit({
      tenantId,
      mappingId,
      action: "mapping.delete",
      actor,
      correlationId,
      reason,
      previous: existing.mapping,
      next: null
    });
    const nextRecord = {
      ...existing,
      registry_metadata: {
        ...existing.registry_metadata,
        updated_at: this.clock().toISOString(),
        deleted_at: this.clock().toISOString(),
        delete_reason: reason,
        audit_event_ids: [...existing.registry_metadata.audit_event_ids, audit.audit_event_id]
      }
    };
    return this.store.put(nextRecord);
  }

  createCandidateMappingsFromNormalization({ tenantId, normalizationOutput, actor, correlationId = null }) {
    assertTenant(tenantId);
    assertActor(actor);
    const candidates = extractCandidateMappings(normalizationOutput);
    const created = [];
    const rejected = [];
    for (const candidate of candidates) {
      try {
        const mapping = mappingFromCandidate(candidate);
        assertCandidateMapping(mapping);
        const record = this.createMapping({
          tenantId,
          mapping,
          actor,
          correlationId,
          authorizationContext: { source: "normalization_candidate_ingest" },
          registryMetadata: candidateRegistryMetadata(candidate)
        });
        const audit = this.audit({
          tenantId,
          mappingId: mapping.mapping_id,
          action: "mapping.candidate_ingest",
          actor,
          correlationId,
          previous: null,
          next: mapping
        });
        record.registry_metadata.audit_event_ids.push(audit.audit_event_id);
        created.push(this.store.put(record));
      } catch (error) {
        rejected.push({
          candidate_mapping_id: candidate?.mapping_id ?? null,
          error: error.message
        });
      }
    }
    return { created, rejected };
  }

  queryMappings({
    tenantId,
    entityId = null,
    vocabulary = null,
    status = null,
    releaseId = undefined,
    includeDeleted = false
  }) {
    assertTenant(tenantId);
    return this.store.list(tenantId)
      .filter((record) => includeDeleted || !record.registry_metadata.deleted_at)
      .filter((record) => !entityId ||
        record.mapping.source_entity_id === entityId ||
        record.mapping.target_entity_id === entityId)
      .filter((record) => !vocabulary ||
        record.mapping.source_vocabulary === vocabulary ||
        record.mapping.target_vocabulary === vocabulary)
      .filter((record) => !status || record.mapping.review_status === status)
      .filter((record) => releaseId === undefined || record.mapping.release_id === releaseId)
      .map(clone);
  }

  deprecateMapping({ tenantId, mappingId, actor, reason, replacedByMappingId = null, correlationId = null }) {
    throw new MappingRegistryError("deprecation is a governed transition and cannot be written through ordinary registry CRUD");
  }

  supersedeMapping({ tenantId, mappingId, replacementMapping, actor, reason, correlationId = null }) {
    throw new MappingRegistryError("supersession is a governed transition and cannot be written through ordinary registry CRUD");
  }

  listAuditEvents({ tenantId, mappingId = null }) {
    assertTenant(tenantId);
    return this.store.listAudit(tenantId, mappingId);
  }

  diffPreview({ proposal, actor = null, correlation_id = null } = {}) {
    if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
      throw new MappingRegistryError("diffPreview requires a proposal object");
    }
    const tenantId = proposal.tenant_id ?? actor?.tenant_id;
    assertTenant(tenantId);
    const objectType = proposal.semantic_object_type ?? proposal.proposal_type ?? "proposal";
    const mappingId = inferProposalMappingId(proposal, objectType);
    return this.createDiff({
      tenantId,
      mappingId,
      proposalId: proposal.proposal_id ?? null,
      objectType,
      correlationId: correlation_id,
      proposalPayload: proposalPayloadForDiff(proposal, Boolean(mappingId))
    });
  }

  createDiff({
    tenantId,
    mappingId = null,
    current = undefined,
    proposed = undefined,
    proposalPayload = undefined,
    proposalId = null,
    objectType = "mapping",
    correlationId = null
  } = {}) {
    assertTenant(tenantId);
    const currentSide = current === undefined
      ? resolveStoredDiffSide({ store: this.store, tenantId, mappingId })
      : resolveDiffSide(current, null);
    const proposedSide = resolveDiffSide(proposed ?? proposalPayload, currentSide.record);
    if (!proposedSide.object) {
      throw new MappingRegistryError("createDiff requires proposed mapping or proposal payload");
    }
    const now = this.clock().toISOString();
    const fields = diffObjects(currentSide.object, proposedSide.object)
      .map((field) => ({
        ...field,
        current_context: diffFieldContext(currentSide),
        proposed_context: diffFieldContext(proposedSide)
      }));
    const objectId = currentSide.object?.mapping_id ??
      proposedSide.object?.mapping_id ??
      mappingId ??
      currentSide.object?.entity_id ??
      proposedSide.object?.entity_id ??
      null;
    return {
      diff_id: `diff:mapping-registry:${this.idFactory()}`,
      object_type: objectType,
      object_id: objectId,
      tenant_id: tenantId,
      proposal_id: proposalId,
      correlation_id: correlationId,
      generated_at: now,
      sides: {
        current: diffSideSummary(currentSide),
        proposed: diffSideSummary(proposedSide)
      },
      summary: summarizeDiffFields(fields),
      fields
    };
  }

  exportMappings({
    tenantId,
    mappingIds = null,
    status = null,
    releaseId = undefined,
    includeDeleted = false,
    releaseContext = null,
    exportId = null
  } = {}) {
    assertTenant(tenantId);
    const records = Array.isArray(mappingIds)
      ? mappingIds.map((mappingId) => requireRecord(this.store.get(tenantId, mappingId), mappingId))
      : this.queryMappings({ tenantId, status, releaseId, includeDeleted });
    const filtered = records
      .filter((record) => includeDeleted || !record.registry_metadata.deleted_at)
      .filter((record) => !status || record.mapping.review_status === status)
      .filter((record) => releaseId === undefined || record.mapping.release_id === releaseId);
    const exportPayload = {
      export_id: exportId ?? `export:mapping-registry:${this.idFactory()}`,
      tenant_id: tenantId,
      exported_at: this.clock().toISOString(),
      mapping_object_schema_id: mappingObjectSchemaContract.$id,
      release_context: releaseContext ?? {
        release_id: releaseId ?? null,
        source: "mapping-registry"
      },
      record_count: filtered.length,
      mappings: filtered.map(exportMappingRecord)
    };
    return {
      ...exportPayload,
      manifest_digest: digestValue(exportPayload)
    };
  }

  findDuplicate({ tenantId, mapping }) {
    return this.store.list(tenantId)
      .find((record) => !record.registry_metadata.deleted_at &&
        record.mapping.source_entity_id === mapping.source_entity_id &&
        record.mapping.target_entity_id === mapping.target_entity_id &&
        record.mapping.predicate === mapping.predicate &&
        record.mapping.source_vocabulary === mapping.source_vocabulary &&
        record.mapping.source_vocabulary_version === mapping.source_vocabulary_version &&
        record.mapping.target_vocabulary === mapping.target_vocabulary &&
        record.mapping.target_vocabulary_version === mapping.target_vocabulary_version) ?? null;
  }

  audit({ tenantId, mappingId, action, actor, correlationId, reason = null, previous, next, authorizationDecision = null }) {
    const event = {
      audit_event_id: `audit:mapping-registry:${this.idFactory()}`,
      tenant_id: tenantId,
      mapping_id: mappingId,
      action,
      actor,
      timestamp: this.clock().toISOString(),
      reason,
      correlation_id: correlationId,
      previous,
      next,
      authorization_decision: authorizationDecision
    };
    return this.store.appendAudit(event);
  }
}

export function mappingFromCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new MappingRegistryError("candidate mapping must be an object");
  }
  const mapping = {
    mapping_id: candidate.mapping_id,
    source_entity_id: candidate.source_entity_id,
    target_entity_id: candidate.target_entity_id,
    predicate: candidate.predicate,
    source_vocabulary: candidate.source_vocabulary,
    source_vocabulary_version: candidate.source_vocabulary_version,
    target_vocabulary: candidate.target_vocabulary,
    target_vocabulary_version: candidate.target_vocabulary_version,
    source_license_classification: candidate.source_license_classification,
    source_license_policy_id: candidate.source_license_policy_id,
    target_license_classification: candidate.target_license_classification,
    target_license_policy_id: candidate.target_license_policy_id,
    data_sensitivity: candidate.data_sensitivity,
    materialization_policy: candidate.materialization_policy,
    permitted_uses: candidate.permitted_uses,
    export_restrictions: candidate.export_restrictions,
    disclaimer_ids: candidate.disclaimer_ids,
    legal_approval_id: candidate.legal_approval_id ?? null,
    retention_class: candidate.retention_class,
    license_status: candidate.license_status,
    confidence_score: candidate.confidence_score,
    confidence_band: candidate.confidence_band,
    evidence_ids: candidate.evidence_ids,
    evidence_refs: candidate.evidence_refs,
    provenance_id: candidate.provenance_id,
    created_by: candidate.created_by,
    reviewed_by: candidate.reviewed_by ?? null,
    review_status: candidate.review_status ?? "proposed",
    release_id: candidate.release_id ?? null,
    provenance: candidate.provenance
  };
  if (candidate.source_term) {
    mapping.provenance = { ...mapping.provenance, source_term: candidate.source_term };
  }
  if (candidate.target_term) {
    mapping.provenance = { ...mapping.provenance, target_term: candidate.target_term };
  }
  return mapping;
}

export function candidateRegistryMetadata(candidate) {
  return {
    workflow_status: candidate.workflow_status ?? null,
    candidate_metadata: dropUndefined({
      candidate_id: candidate.candidate_id,
      tenant_id: candidate.tenant_id,
      environment: candidate.environment,
      confidence_source: candidate.confidence_source,
      duplicate_status: candidate.duplicate_status,
      duplicate_candidate_flags: candidate.duplicate_candidate_flags,
      scoring_signals: candidate.scoring_signals,
      release_evidence_refs: candidate.release_evidence_refs,
      validation_report_refs: candidate.validation_report_refs,
      auto_publish: candidate.auto_publish,
      workflow_status: candidate.workflow_status
    })
  };
}

export function extractCandidateMappings(normalizationOutput) {
  if (!normalizationOutput) {
    return [];
  }
  if (Array.isArray(normalizationOutput)) {
    return normalizationOutput.flatMap(extractCandidateMappings);
  }
  if (Array.isArray(normalizationOutput.candidate_mappings)) {
    return normalizationOutput.candidate_mappings;
  }
  if (Array.isArray(normalizationOutput.mapping_proposals)) {
    return normalizationOutput.mapping_proposals;
  }
  if (Array.isArray(normalizationOutput.proposals)) {
    return normalizationOutput.proposals.flatMap(extractCandidateMappings);
  }
  if (Array.isArray(normalizationOutput.normalized_outputs)) {
    return normalizationOutput.normalized_outputs.flatMap(extractCandidateMappings);
  }
  if (normalizationOutput.normalized_record) {
    return extractCandidateMappings(normalizationOutput.normalized_record);
  }
  return [];
}

function assertCandidateMapping(mapping) {
  if (!CANDIDATE_STATUSES.includes(mapping.review_status)) {
    throw new MappingRegistryError(`candidate mappings must stay proposed/draft, got ${mapping.review_status}`);
  }
  if (mapping.release_id !== null) {
    throw new MappingRegistryError("candidate mappings cannot carry release_id");
  }
  assertNonEmpty(mapping.source_vocabulary_version, "source_vocabulary_version");
  assertNonEmpty(mapping.target_vocabulary_version, "target_vocabulary_version");
  if (typeof mapping.confidence_score !== "number") {
    throw new MappingRegistryError("candidate confidence_score is required and must not be fabricated");
  }
  assertNonEmpty(mapping.confidence_band, "confidence_band");
}

function normalizeMappingForWorkingState(mapping) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new MappingRegistryError("mapping must be an object");
  }
  if (mapping.release_id !== null && mapping.release_id !== undefined) {
    throw new MappingRegistryError("mapping registry CRUD writes are working-state only; release_id must be null");
  }
  const normalized = {
    ...mapping,
    release_id: null
  };
  if (!CRUD_STATUSES.includes(normalized.review_status)) {
    throw new MappingRegistryError(`ordinary mapping registry CRUD can persist only draft/proposed mappings: ${normalized.review_status}`);
  }
  if (!mappingPredicates.includes(normalized.predicate)) {
    throw new MappingRegistryError(`Invalid predicate: ${normalized.predicate}`);
  }
  return normalized;
}

function assertPersistableMapping(mapping) {
  const validation = validateMappingObjectShape(mapping);
  if (!validation.valid) {
    throw new MappingRegistryError(`mapping failed schema validation: ${validation.errors.join("; ")}`, { errors: validation.errors });
  }
  assertNonEmpty(mapping.source_vocabulary_version, "source_vocabulary_version");
  assertNonEmpty(mapping.target_vocabulary_version, "target_vocabulary_version");
  if (!Array.isArray(mapping.evidence_ids) || mapping.evidence_ids.length === 0) {
    throw new MappingRegistryError("mapping requires evidence_ids");
  }
  if (!Array.isArray(mapping.evidence_refs) || mapping.evidence_refs.length === 0) {
    throw new MappingRegistryError("mapping requires evidence_refs");
  }
  assertConfidenceBand(mapping);
}

function assertPersistableGovernedMapping(mapping) {
  const validation = validateMappingObjectShape(mapping);
  if (!validation.valid) {
    throw new MappingRegistryError(`mapping failed schema validation: ${validation.errors.join("; ")}`, { errors: validation.errors });
  }
  if (!["approved", "rejected"].includes(mapping.review_status)) {
    throw new MappingRegistryError(`unsupported governed review_status: ${mapping.review_status}`);
  }
  assertNonEmpty(mapping.reviewed_by, "reviewed_by");
  assertNonEmpty(mapping.source_vocabulary_version, "source_vocabulary_version");
  assertNonEmpty(mapping.target_vocabulary_version, "target_vocabulary_version");
  assertConfidenceBand(mapping);
}

function assertOrdinaryPatch(patch) {
  const blocked = [
    "review_status",
    "reviewed_by",
    "release_id",
    "workflow_status",
    "release_staging",
    "deprecation",
    "supersedes",
    "superseded_by"
  ].filter((field) => field in (patch ?? {}));
  if (blocked.length > 0) {
    throw new MappingRegistryError(`ordinary mapping registry CRUD cannot patch governed fields: ${blocked.join(", ")}`);
  }
}

function assertGovernedTransitionState({ record, transition }) {
  if (["approve", "reject"].includes(transition) && record.mapping.review_status !== "proposed") {
    throw new MappingRegistryError(`${transition} requires proposed review_status`);
  }
  if (transition === "stage_release" && record.mapping.review_status !== "approved") {
    throw new MappingRegistryError("stage_release requires approved review_status");
  }
}

function assertAuthorizationDecision({
  decision,
  spec,
  tenantId,
  record,
  releaseId,
  actorUserId,
  correlationId,
  rationale,
  clock,
  verifier,
  usedDecisionIds
}) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    throw new MappingRegistryError("governed transition requires authorization decision");
  }
  for (const field of [
    "decision_id",
    "decision",
    "action",
    "actor_user_id",
    "actor_role_key",
    "tenant_id",
    "environment",
    "candidate_id",
    "mapping_id",
    "previous_review_status",
    "next_review_status",
    "rationale_digest",
    "evidence_digest",
    "provenance_id",
    "source_vocabulary_version",
    "target_vocabulary_version",
    "audit_event_id",
    "correlation_id",
    "issued_at",
    "expires_at",
    "decision_binding",
    "signature"
  ]) {
    assertNonEmpty(decision[field], `authorizationDecision.${field}`);
  }
  if (decision.decision !== "allow") {
    throw new MappingRegistryError("authorization decision must allow the transition");
  }
  const required = {
    action: spec.action,
    audit_event_type: spec.audit_event_type,
    tenant_id: tenantId,
    environment: record.registry_metadata.candidate_metadata?.environment,
    candidate_id: record.registry_metadata.candidate_metadata?.candidate_id,
    mapping_id: record.mapping.mapping_id,
    previous_review_status: record.mapping.review_status,
    next_review_status: spec.review_status,
    correlation_id: correlationId,
    provenance_id: record.mapping.provenance_id,
    source_vocabulary_version: record.mapping.source_vocabulary_version,
    target_vocabulary_version: record.mapping.target_vocabulary_version,
    duplicate_status: record.registry_metadata.candidate_metadata?.duplicate_status ?? null,
    rationale_digest: digestValue(rationale ?? ""),
    evidence_digest: mappingEvidenceDigest(record),
    release_id: spec.action === "mapping_candidate.stage_release" ? releaseId : null
  };
  for (const [field, expected] of Object.entries(required)) {
    if (expected === undefined) {
      throw new MappingRegistryError(`governed transition cannot validate missing candidate metadata: ${field}`);
    }
    if ((decision[field] ?? null) !== expected) {
      throw new MappingRegistryError(`authorization decision mismatch for ${field}`);
    }
  }
  assertNonEmpty(actorUserId, "auditContext.actor_user_id");
  if (decision.actor_user_id !== actorUserId) {
    throw new MappingRegistryError("authorization decision actor mismatch");
  }
  if (!spec.roles.includes(decision.actor_role_key)) {
    throw new MappingRegistryError(`authorization decision role cannot perform ${spec.action}`);
  }
  if (usedDecisionIds.has(decision.decision_id)) {
    throw new MappingRegistryError("authorization decision has already been used");
  }
  const expiresAt = Date.parse(decision.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= clock().getTime()) {
    throw new MappingRegistryError("authorization decision is expired");
  }
  const binding = buildGovernedDecisionBinding(decision);
  if (decision.decision_binding !== binding) {
    throw new MappingRegistryError("authorization decision binding mismatch");
  }
  if (typeof verifier !== "function" || verifier({ decision, decision_binding: binding }) !== true) {
    throw new MappingRegistryError("authorization decision signature verification failed");
  }
  if (spec.action === "mapping_candidate.stage_release") {
    assertNonEmpty(releaseId, "auditContext.release_id");
  }
}

export function buildGovernedDecisionBinding(decision) {
  return digestValue([
    decision.decision_id,
    decision.decision,
    decision.action,
    decision.actor_user_id,
    decision.actor_role_key,
    decision.tenant_id,
    decision.environment,
    decision.candidate_id,
    decision.mapping_id,
    decision.previous_review_status,
    decision.next_review_status,
    decision.release_id ?? null,
    decision.rationale_digest,
    decision.evidence_digest,
    decision.provenance_id,
    decision.source_vocabulary_version,
    decision.target_vocabulary_version,
    decision.duplicate_status ?? null,
    decision.audit_event_id,
    decision.correlation_id,
    decision.issued_at,
    decision.expires_at
  ]);
}

export function mappingEvidenceDigest(record) {
  return digestValue({
    evidence_ids: record.mapping.evidence_ids,
    evidence_refs: record.mapping.evidence_refs,
    release_evidence_refs: record.registry_metadata.candidate_metadata?.release_evidence_refs ?? [],
    validation_report_refs: record.registry_metadata.candidate_metadata?.validation_report_refs ?? []
  });
}

export function digestValue(value) {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function assertConfidenceBand(mapping) {
  if (mapping.confidence_band === "blocked") {
    return;
  }
  if (mapping.confidence_score >= 0.9 && mapping.confidence_band !== "high") {
    throw new MappingRegistryError("confidence_band must match confidence_score threshold");
  }
  if (mapping.confidence_score >= 0.7 && mapping.confidence_score < 0.9 && mapping.confidence_band !== "medium") {
    throw new MappingRegistryError("confidence_band must match confidence_score threshold");
  }
  if (mapping.confidence_score > 0 && mapping.confidence_score < 0.7 && mapping.confidence_band !== "low") {
    throw new MappingRegistryError("confidence_band must match confidence_score threshold");
  }
}

function requireRecord(record, mappingId) {
  if (!record) {
    throw new MappingRegistryError(`mapping not found: ${mappingId}`);
  }
  return record;
}

function assertNotDeleted(record) {
  if (record.registry_metadata.deleted_at) {
    throw new MappingRegistryError(`mapping is deleted: ${record.mapping.mapping_id}`);
  }
}

function assertTenant(tenantId) {
  assertNonEmpty(tenantId, "tenantId");
}

function assertActor(actor) {
  assertNonEmpty(actor, "actor");
}

function assertNonEmpty(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new MappingRegistryError(`${fieldName} is required`);
  }
}

function defaultIdFactory() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function dropUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined));
}

function resolveStoredDiffSide({ store, tenantId, mappingId }) {
  if (!mappingId) {
    return { record: null, object: null, registry_metadata: null };
  }
  return resolveDiffSide(requireRecord(store.get(tenantId, mappingId), mappingId), null);
}

function inferProposalMappingId(proposal, objectType) {
  if (proposal.mapping_id) {
    return proposal.mapping_id;
  }
  if (proposal.target_mapping_id) {
    return proposal.target_mapping_id;
  }
  if (proposal.payload?.mapping_id) {
    return proposal.payload.mapping_id;
  }
  if (objectType === "mapping" || proposal.proposal_type === "mapping") {
    return proposal.semantic_object_id ?? null;
  }
  return null;
}

function proposalPayloadForDiff(proposal, hasCurrentMapping) {
  const payload = proposal.payload ?? {};
  const provenancePatch = dropUndefined({
    provenance_id: proposal.provenance_id ?? proposal.provenance?.provenance_id ?? payload.provenance_id,
    provenance: proposal.provenance ?? payload.provenance,
    evidence_ids: payload.evidence_ids ?? proposal.provenance?.evidence_ids,
    evidence_refs: payload.evidence_refs ?? proposal.provenance?.evidence_refs
  });
  if (payload.mapping_patch) {
    return {
      ...payload,
      mapping_patch: {
        ...payload.mapping_patch,
        ...provenancePatch
      }
    };
  }
  if (payload.patch) {
    return {
      ...payload,
      patch: {
        ...payload.patch,
        ...provenancePatch
      }
    };
  }
  if (payload.proposed_mapping) {
    return {
      ...payload,
      proposed_mapping: {
        ...payload.proposed_mapping,
        ...provenancePatch
      }
    };
  }
  if (payload.proposedMapping) {
    return {
      ...payload,
      proposedMapping: {
        ...payload.proposedMapping,
        ...provenancePatch
      }
    };
  }
  if (payload.mapping) {
    return {
      ...payload,
      mapping: {
        ...payload.mapping,
        ...provenancePatch
      }
    };
  }
  if (hasCurrentMapping) {
    return {
      patch: {
        ...payload,
        ...provenancePatch
      }
    };
  }
  return {
    ...payload,
    ...provenancePatch
  };
}

function resolveDiffSide(value, currentRecord) {
  if (value === null) {
    return { record: null, object: null, registry_metadata: null };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { record: null, object: null, registry_metadata: null };
  }
  if (isRegistryRecord(value)) {
    return {
      record: clone(value),
      object: clone(value.mapping),
      registry_metadata: clone(value.registry_metadata)
    };
  }
  const proposedObject = unwrapProposalObject(value, currentRecord);
  return {
    record: null,
    object: proposedObject ? clone(proposedObject) : null,
    registry_metadata: value.registry_metadata ? clone(value.registry_metadata) : null
  };
}

function isRegistryRecord(value) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.mapping &&
    typeof value.mapping === "object" &&
    value.registry_metadata &&
    typeof value.registry_metadata === "object";
}

function unwrapProposalObject(value, currentRecord) {
  if (value.proposed_mapping && typeof value.proposed_mapping === "object") {
    return value.proposed_mapping;
  }
  if (value.proposedMapping && typeof value.proposedMapping === "object") {
    return value.proposedMapping;
  }
  if (value.mapping_patch && typeof value.mapping_patch === "object") {
    return mergeProposalPatch(currentRecord, value.mapping_patch);
  }
  if (value.patch && typeof value.patch === "object") {
    return mergeProposalPatch(currentRecord, value.patch);
  }
  if (value.mapping && typeof value.mapping === "object") {
    return value.mapping;
  }
  return value;
}

function mergeProposalPatch(currentRecord, patch) {
  if (!currentRecord?.mapping) {
    throw new MappingRegistryError("proposal patch diff requires a current registry mapping");
  }
  return {
    ...currentRecord.mapping,
    ...patch,
    mapping_id: currentRecord.mapping.mapping_id
  };
}

function diffObjects(before, after) {
  return diffValues(before, after, []);
}

function diffValues(before, after, path) {
  if (stableStringify(before) === stableStringify(after)) {
    return [];
  }
  const beforeIsObject = isPlainObject(before);
  const afterIsObject = isPlainObject(after);
  if (beforeIsObject && afterIsObject) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].sort().flatMap((key) => {
      const beforeHas = Object.hasOwn(before, key);
      const afterHas = Object.hasOwn(after, key);
      if (!beforeHas) {
        return [diffField([...path, key], "added", false, undefined, true, after[key])];
      }
      if (!afterHas) {
        return [diffField([...path, key], "removed", true, before[key], false, undefined)];
      }
      return diffValues(before[key], after[key], [...path, key]);
    });
  }
  return [diffField(path, "changed", true, before, true, after)];
}

function diffField(path, changeType, beforePresent, beforeValue, afterPresent, afterValue) {
  return {
    path: path.join("."),
    change_type: changeType,
    before: {
      present: beforePresent,
      value: beforePresent ? copyValue(beforeValue) : null
    },
    after: {
      present: afterPresent,
      value: afterPresent ? copyValue(afterValue) : null
    }
  };
}

function summarizeDiffFields(fields) {
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const field of fields) {
    counts[field.change_type] += 1;
  }
  return {
    total_fields_changed: fields.length,
    counts,
    changed_paths: fields.map((field) => field.path)
  };
}

function diffSideSummary(side) {
  if (!side.object) {
    return null;
  }
  return {
    object_id: side.object.mapping_id ?? side.object.entity_id ?? null,
    review_status: side.object.review_status ?? null,
    release_id: side.object.release_id ?? null,
    vocabulary_versions: vocabularyContext(side.object),
    provenance: provenanceContext(side),
    registry_metadata: side.registry_metadata ? {
      workflow_status: side.registry_metadata.workflow_status ?? null,
      duplicate_of: side.registry_metadata.duplicate_of ?? null,
      duplicate_status: side.registry_metadata.duplicate_status ?? null,
      release_staging: side.registry_metadata.release_staging ?? null,
      audit_event_ids: side.registry_metadata.audit_event_ids ?? [],
      governed_audit_event_ids: side.registry_metadata.governed_audit_event_ids ?? []
    } : null
  };
}

function diffFieldContext(side) {
  if (!side.object) {
    return null;
  }
  return {
    vocabulary_versions: vocabularyContext(side.object),
    provenance_id: side.object.provenance_id ?? null,
    release_id: side.object.release_id ?? null,
    review_status: side.object.review_status ?? null,
    audit_event_ids: side.registry_metadata?.audit_event_ids ?? []
  };
}

function vocabularyContext(object) {
  return {
    source_vocabulary: object.source_vocabulary ?? null,
    source_vocabulary_version: object.source_vocabulary_version ?? null,
    target_vocabulary: object.target_vocabulary ?? null,
    target_vocabulary_version: object.target_vocabulary_version ?? null
  };
}

function provenanceContext(side) {
  return {
    provenance_id: side.object.provenance_id ?? null,
    provenance: side.object.provenance ?? null,
    evidence_ids: side.object.evidence_ids ?? [],
    evidence_refs: side.object.evidence_refs ?? [],
    source_audit_event_id: side.object.provenance?.audit_event_id ?? null,
    registry_audit_event_ids: side.registry_metadata?.audit_event_ids ?? [],
    governed_audit_event_ids: side.registry_metadata?.governed_audit_event_ids ?? []
  };
}

function exportMappingRecord(record) {
  return {
    mapping_id: record.mapping.mapping_id,
    canonical_ids: {
      mapping_id: record.mapping.mapping_id,
      source_entity_id: record.mapping.source_entity_id,
      target_entity_id: record.mapping.target_entity_id,
      predicate: record.mapping.predicate
    },
    source: {
      entity_id: record.mapping.source_entity_id,
      vocabulary: record.mapping.source_vocabulary,
      vocabulary_version: record.mapping.source_vocabulary_version,
      license_classification: record.mapping.source_license_classification,
      license_policy_id: record.mapping.source_license_policy_id
    },
    target: {
      entity_id: record.mapping.target_entity_id,
      vocabulary: record.mapping.target_vocabulary,
      vocabulary_version: record.mapping.target_vocabulary_version,
      license_classification: record.mapping.target_license_classification,
      license_policy_id: record.mapping.target_license_policy_id
    },
    review_status: record.mapping.review_status,
    release_id: record.mapping.release_id,
    evidence: {
      evidence_ids: record.mapping.evidence_ids,
      evidence_refs: record.mapping.evidence_refs,
      release_evidence_refs: record.registry_metadata.candidate_metadata?.release_evidence_refs ?? [],
      validation_report_refs: record.registry_metadata.candidate_metadata?.validation_report_refs ?? []
    },
    provenance_id: record.mapping.provenance_id,
    provenance: record.mapping.provenance,
    audit_linkage: {
      registry_audit_event_ids: record.registry_metadata.audit_event_ids ?? [],
      governed_audit_event_ids: record.registry_metadata.governed_audit_event_ids ?? [],
      authorization_audit_event_id: record.registry_metadata.authorization_context?.audit_event_id ?? null,
      registry_authorization_audit_event_id: record.registry_metadata.authorization_context?.registry_audit_event_id ?? null,
      source_provenance_audit_event_id: record.mapping.provenance?.audit_event_id ?? null
    },
    release_staging: record.registry_metadata.release_staging ?? null,
    registry_metadata: {
      tenant_id: record.tenant_id,
      working_state: record.working_state,
      duplicate_of: record.registry_metadata.duplicate_of ?? null,
      duplicate_status: record.registry_metadata.duplicate_status ?? null,
      supersedes: record.registry_metadata.supersedes ?? null,
      superseded_by: record.registry_metadata.superseded_by ?? null,
      workflow_status: record.registry_metadata.workflow_status ?? null,
      candidate_id: record.registry_metadata.candidate_metadata?.candidate_id ?? null,
      created_at: record.registry_metadata.created_at ?? null,
      updated_at: record.registry_metadata.updated_at ?? null,
      deleted_at: record.registry_metadata.deleted_at ?? null
    },
    mapping: clone(record.mapping)
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function copyValue(value) {
  if (value === undefined) {
    return null;
  }
  return clone(value);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
