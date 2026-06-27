import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NoopReleaseLedger } from "../../semantic-store/src/release-ledger.js";
import { assertNoCriticalFailures, assertResolvedValidationEvidence } from "../../validation/src/index.js";

const DEFAULT_RELEASE_WORKFLOW_SERVICE_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

export class ReleaseManagerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ReleaseManagerError";
    this.details = details;
  }
}

export class ReleaseManagerAuthorizationError extends Error {
  constructor(message = "release candidate creation denied") {
    super(message);
    this.name = "ReleaseManagerAuthorizationError";
  }
}

export class ReleaseManagerService {
  constructor({
    releaseLedger = new NoopReleaseLedger(),
    manifestRoot = new URL("../release-candidates/", import.meta.url),
    validationGate = defaultValidationGate,
    resolveValidationRun = null,
    resolveValidationWaiver = null,
    assertCanCreateRelease = defaultAssertCanCreateRelease,
    assertCanCreateReleaseCandidate = assertCanCreateRelease,
    proposalWorkflowService = null,
    resolveStagedItem = null,
    validationRunResolver = null,
    auditStore = null,
    clock = () => new Date()
  } = {}) {
    this.releaseLedger = releaseLedger;
    this.manifestRoot = manifestRoot;
    this.validationGate = validationGate;
    this.resolveValidationRun = resolveValidationRun;
    this.resolveValidationWaiver = resolveValidationWaiver;
    this.assertCanCreateReleaseCandidate = assertCanCreateReleaseCandidate;
    this.proposalWorkflowService = proposalWorkflowService;
    this.resolveStagedItem = resolveStagedItem;
    this.validationRunResolver = validationRunResolver;
    this.auditStore = auditStore;
    this.usedDecisionBindings = new Set();
    this.clock = clock;
  }

  async createReleaseCandidate(input) {
    const normalized = normalizeReleaseInput(input, this.clock);
    const stagedContext = await this.resolveVerifiedStagedEntries(normalized, input);
    normalized.staged_entries = stagedContext.staged_entries;
    normalized.items = stagedContext.items;
    await this.assertNoModelSuggestedReleaseItems(normalized);
    normalized.validation_report_refs = await this.resolveValidationReportRefs(normalized);

    const snapshot = buildContentSnapshot(normalized);
    const changelog = normalized.changelog ?? buildChangelog(normalized.items);
    const approvalTrace = buildApprovalTraceFromStaging(normalized.staged_entries);
    const artifactHashes = {
      content_snapshot: snapshot.snapshot_digest,
      changelog: sha256(changelog),
      source_version_pins: sha256(normalized.source_version_pins),
      validation_report_refs: sha256(normalized.validation_report_refs),
      approval_trace: sha256(approvalTrace),
      ...(normalized.artifact_hashes ?? {})
    };
    const rollback = buildRollbackMetadata({
      tenant_id: normalized.tenant_id,
      environment: normalized.environment,
      release_id: normalized.release_id,
      release_candidate_id: normalized.release_candidate_id,
      previous_release_id: normalized.previous_release_id,
      rollback_target_release_id: normalized.rollback_target_release_id,
      snapshot_ref: snapshot.snapshot_ref,
      source_version_pins: normalized.source_version_pins
    });
    const releaseCandidate = {
      schema_version: "release-candidate-package.v1",
      kind: "release_candidate",
      release_id: normalized.release_id,
      semantic_version: normalized.semantic_version,
      release_candidate_id: normalized.release_candidate_id,
      tenant_id: normalized.tenant_id,
      environment: normalized.environment,
      created_at: normalized.created_at,
      created_by: normalized.actor.user_id,
      created_by_role: "release_manager",
      previous_release_id: normalized.previous_release_id,
      rollback_target_release_id: normalized.rollback_target_release_id,
      snapshot_ref: snapshot.snapshot_ref,
      content_snapshot: snapshot,
      changelog,
      changelog_uri: normalized.changelog_uri,
      source_version_pins: normalized.source_version_pins,
      validation_report_refs: normalized.validation_report_refs,
      validation_evidence: normalized.validation_report_refs,
      approval_trace: approvalTrace,
      artifact_hashes: artifactHashes,
      audit_event_range: null,
      included_graphs: normalized.included_graphs,
      staged_entries: normalized.staged_entries,
      items: normalized.items,
      ontology_modules: normalized.ontology_modules,
      mapping_files: normalized.mapping_files,
      export_uris: normalized.export_uris,
      known_issues: normalized.known_issues,
      rollback
    };

    const validationResult = await callValidationGate(this.validationGate, releaseCandidate, {
      releaseMode: true,
      expectedTenantId: normalized.tenant_id,
      environment: normalized.environment,
      releaseId: normalized.release_id,
      releaseCandidateId: normalized.release_candidate_id,
      subjectType: "release_candidate",
      subjectId: normalized.release_candidate_id,
      inputPayloadDigest: normalized.validation_report_refs[0]?.input_payload_digest ?? sha256(releaseCandidate),
      resolveValidationRun: this.resolveValidationRun ?? (({ validation_run_id }) =>
        normalized.validation_report_refs.find((record) =>
          (record.validation_run_id ?? record.validation_report_id ?? record.report_id) === validation_run_id
        ) ?? null),
      resolveValidationWaiver: this.resolveValidationWaiver
    });
    if (validationResult?.blocking) {
      throw new ReleaseManagerError("critical validation failure blocks release candidate", { validationResult });
    }
    releaseCandidate.validation_result = validationResult;
    const plannedCreateAuditEvent = buildCreateAuditEvent(normalized, null);
    const auditEventRange = buildAuditEventRange(normalized.staged_entries, plannedCreateAuditEvent);
    const authzInput = {
      actor: normalized.actor,
      release_id: normalized.release_id,
      release_candidate_id: normalized.release_candidate_id,
      tenant_id: normalized.tenant_id,
      environment: normalized.environment,
      included_proposals: buildIncludedProposalEvidence(normalized),
      validation_summary: validationSummary(validationResult),
      source_version_pins: normalized.source_version_pins,
      validation_report_refs: normalized.validation_report_refs,
      changelog_digest: artifactHashes.changelog,
      content_hashes_digest: sha256(artifactHashes),
      approval_trace_digest: artifactHashes.approval_trace,
      audit_event_range: auditEventRange,
      rationale: normalized.rationale,
      correlation_id: normalized.correlation_id
    };
    const authzDecision = await this.assertCanCreateReleaseCandidate(authzInput);
    verifyReleaseCandidateAuthorizationDecision(authzDecision, authzInput, this.usedDecisionBindings, this.clock);
    releaseCandidate.authorization_decision = authzDecision;
    const createAuditEvent = await appendRequiredAuditEvent(this.auditStore, {
      ...plannedCreateAuditEvent,
      decision_binding: authzDecision.decision_binding
    });
    releaseCandidate.audit_event_range = auditEventRange;
    releaseCandidate.approval_trace = [
      ...approvalTrace,
      {
        role: "release_manager",
        actor: normalized.actor.user_id,
        decision: "release_candidate_created",
        audit_event_id: createAuditEvent.audit_event_id
      }
    ];
    releaseCandidate.artifact_hashes.approval_trace = sha256(releaseCandidate.approval_trace);

    const manifestBytes = `${stableJson(releaseCandidate, 2)}\n`;
    const manifestDigest = sha256(manifestBytes);
    const manifestUri = this.writeManifest(normalized.release_id, normalized.release_candidate_id, manifestBytes);
    const storedDigest = sha256(readFileSync(manifestUri, "utf8"));
    if (storedDigest !== manifestDigest) {
      throw new ReleaseManagerError(`release candidate manifest digest mismatch: computed ${manifestDigest}, stored ${storedDigest}`);
    }

    const ledgerRecord = await this.releaseLedger.insertReleaseMetadata({
      tenant_id: normalized.tenant_id,
      environment: normalized.environment,
      release_id: normalized.release_id,
      semantic_version: normalized.semantic_version,
      status: "candidate",
      release_candidate_id: normalized.release_candidate_id,
      previous_release_id: normalized.previous_release_id,
      manifest_uri: manifestUri,
      manifest_digest: manifestDigest,
      ontology_digest: normalized.ontology_digest,
      shape_digest: normalized.shape_digest,
      source_version_pins: normalized.source_version_pins,
      included_graphs: normalized.included_graphs,
      validation_report_refs: normalized.validation_report_refs,
      changelog_uri: normalized.changelog_uri,
      artifact_hashes: artifactHashes,
      approval_trace: releaseCandidate.approval_trace,
      audit_event_range: releaseCandidate.audit_event_range,
      rollback_target_release_id: normalized.rollback_target_release_id,
      created_by_user_id: null,
      created_by_service_account_id: normalized.created_by_service_account_id
    });
    if (ledgerRecord.manifest_digest !== manifestDigest) {
      throw new ReleaseManagerError(`release candidate ledger digest mismatch: manifest ${manifestDigest}, ledger ${ledgerRecord.manifest_digest}`);
    }

    return {
      release_candidate: releaseCandidate,
      manifest_uri: manifestUri,
      manifest_digest: manifestDigest,
      artifact_hashes: artifactHashes,
      validation_result: validationResult,
      authz_decision: authzDecision,
      release_metadata_record: ledgerRecord,
      rollback
    };
  }

  async resolveVerifiedStagedEntries(normalized, rawInput) {
    if (
      arrayOf(rawInput.items).length > 0 ||
      arrayOf(rawInput.staged_items).length > 0 ||
      arrayOf(rawInput.stagedItems).length > 0 ||
      arrayOf(rawInput.staged_entries).length > 0 ||
      arrayOf(rawInput.stagedEntries).length > 0 ||
      arrayOf(rawInput.proposals).length > 0 ||
      arrayOf(rawInput.mappings).length > 0 ||
      arrayOf(rawInput.relationships).length > 0 ||
      arrayOf(rawInput.evidence_links).length > 0
    ) {
      throw new ReleaseManagerError("release candidate must resolve governed items from verified staged entries, not caller-supplied staged data");
    }
    const proposalWorkflowService = rawInput.proposalWorkflowService ?? this.proposalWorkflowService;
    if (!proposalWorkflowService || typeof proposalWorkflowService.stagedEntries !== "function") {
      throw new ReleaseManagerError("release candidate requires ProposalWorkflowService.stagedEntries");
    }
    const stagedEntryIds = rawInput.staged_entry_ids ?? rawInput.stagedEntryIds;
    if (!Array.isArray(stagedEntryIds) || stagedEntryIds.length === 0) {
      throw new ReleaseManagerError("release candidate requires non-empty staged_entry_ids");
    }
    const stagedEntries = await proposalWorkflowService.stagedEntries({
      tenant_id: normalized.tenant_id,
      environment: normalized.environment,
      release_id: normalized.release_id
    });
    const byId = new Map(arrayOf(stagedEntries).map((entry) => [entry.staging_id, entry]));
    const scopedEntries = stagedEntryIds.map((stagingId) => {
      const entry = byId.get(stagingId);
      if (!entry) {
        throw new ReleaseManagerError(`staged entry not found: ${stagingId}`);
      }
      assertStagedEntryBound(entry, normalized);
      return {
        ...entry,
        workflow_audit_events: typeof proposalWorkflowService.auditFor === "function"
          ? proposalWorkflowService.auditFor(entry.proposal_id)
          : []
      };
    });
    const resolveStagedItem = rawInput.resolveStagedItem ?? this.resolveStagedItem;
    if (typeof resolveStagedItem !== "function") {
      throw new ReleaseManagerError("release candidate requires resolveStagedItem adapter for immutable staged payloads");
    }
    const items = await Promise.all(scopedEntries.map(async (entry) => {
      const item = await resolveStagedItem(entry);
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new ReleaseManagerError(`staged entry resolver returned no governed item for ${entry.staging_id}`);
      }
      return item;
    }));
    return {
      staged_entries: scopedEntries,
      items
    };
  }

  async resolveValidationReportRefs(normalized) {
    const resolver = this.validationRunResolver;
    if (!resolver || typeof resolver.resolveValidationReports !== "function") {
      throw new ReleaseManagerError("release candidate requires validationRunResolver.resolveValidationReports");
    }
    const resolved = await resolver.resolveValidationReports({
      tenant_id: normalized.tenant_id,
      environment: normalized.environment,
      release_id: normalized.release_id,
      release_candidate_id: normalized.release_candidate_id,
      staged_entries: normalized.staged_entries,
      items: normalized.items
    });
    assertResolvedValidationReports(resolved, normalized);
    return resolved;
  }

  async assertNoModelSuggestedReleaseItems(input) {
    const blockedItems = input.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => isModelSuggestedReleaseItem(item));
    if (blockedItems.length === 0) {
      return;
    }
    const first = blockedItems[0];
    const auditEvent = await appendRequiredAuditEvent(this.auditStore, {
      audit_event_id: `audit:release-candidate:${input.release_candidate_id}:model-suggested-denied`,
      event_type: "release_candidate_promotion_denied",
      tenant_id: input.tenant_id,
      environment: input.environment,
      actor_user_id: input.actor.user_id,
      actor_role_key: "release_manager",
      actor_type: "user",
      action: "release_candidate.create",
      resource_type: "release_candidate",
      resource_id: input.release_candidate_id,
      release_id: input.release_id,
      rationale: input.rationale,
      correlation_id: input.correlation_id,
      decision: "denied",
      denial_reason: "model_suggested_release_blocked",
      event_payload: {
        blocked_item_count: blockedItems.length,
        first_blocked_index: first.index,
        first_blocked_id: releaseItemId(first.item)
      },
      occurred_at: input.created_at
    });
    throw new ReleaseManagerError("model_suggested items cannot enter release candidate assembly", {
      audit_event_id: auditEvent.audit_event_id,
      blocked_item_count: blockedItems.length
    });
  }

  async createReleaseCandidateFromStaging({
    proposalWorkflowService,
    filters = {},
    resolveStagedItem = (entry) => entry.payload ?? entry.item ?? entry.proposal ?? null,
    ...input
  }) {
    if (!proposalWorkflowService || typeof proposalWorkflowService.stagedEntries !== "function") {
      throw new ReleaseManagerError("createReleaseCandidateFromStaging requires ProposalWorkflowService.stagedEntries");
    }
    const tenant_id = input.tenant_id ?? input.tenantId;
    const environment = input.environment ?? "test";
    const release_id = input.release_id ?? input.releaseId;
    const stagedEntries = await proposalWorkflowService.stagedEntries({
      ...filters,
      tenant_id,
      environment,
      release_id
    });
    const scopedEntries = arrayOf(stagedEntries).filter((entry) =>
      entry.tenant_id === tenant_id &&
      entry.environment === environment &&
      entry.release_id === release_id
    );
    if (scopedEntries.length === 0) {
      throw new ReleaseManagerError("release candidate requires staged entries for tenant, environment, and release_id");
    }
    return this.createReleaseCandidate({
      ...input,
      proposalWorkflowService,
      staged_entry_ids: scopedEntries.map((entry) => entry.staging_id),
      resolveStagedItem
    });
  }

  async restoreRollback({ rollbackMetadata = {}, releasePointerStore, actor, rationale, correlation_id, tenant_id, environment, release_id, rollback_target_release_id }) {
    const rollbackTenantId = tenant_id ?? rollbackMetadata.tenant_id;
    const rollbackEnvironment = environment ?? rollbackMetadata.environment;
    const currentReleaseId = release_id ?? rollbackMetadata.release_id;
    const targetReleaseId = rollback_target_release_id ?? rollbackMetadata.rollback_target_release_id;
    if (!targetReleaseId) {
      throw new ReleaseManagerError("rollback requires rollback_target_release_id");
    }
    if (!releasePointerStore || typeof releasePointerStore.activate !== "function") {
      throw new ReleaseManagerError("rollback requires releasePointerStore.activate");
    }
    defaultAssertRollbackActor({
      actor,
      tenant_id: rollbackTenantId,
      environment: rollbackEnvironment,
      rationale,
      correlation_id
    });
    const canonicalTarget = await this.loadReleaseCandidate({
      tenant_id: rollbackTenantId,
      environment: rollbackEnvironment,
      release_id: targetReleaseId
    });
    const rollbackAuditEvent = await appendRequiredAuditEvent(this.auditStore, {
      audit_event_id: `audit:release:${currentReleaseId}:rollback:${targetReleaseId}`,
      event_type: "release_rollback",
      tenant_id: rollbackTenantId,
      environment: rollbackEnvironment,
      actor_user_id: actor.user_id,
      actor_role_key: "release_manager",
      actor_type: "user",
      action: "release.rollback",
      resource_type: "release",
      resource_id: currentReleaseId,
      release_id: currentReleaseId,
      rollback_target_release_id: targetReleaseId,
      rationale,
      correlation_id,
      occurred_at: this.clock().toISOString()
    });
    return releasePointerStore.activate({
      tenant_id: rollbackTenantId,
      environment: rollbackEnvironment,
      active_release_id: targetReleaseId,
      snapshot_ref: canonicalSnapshotRef(canonicalTarget.manifest),
      source_version_pins: canonicalTarget.manifest.source_version_pins,
      restored_from_release_id: currentReleaseId,
      audit_event_type: "release.rollback",
      audit_event_id: rollbackAuditEvent.audit_event_id,
      rationale,
      correlation_id
    });
  }

  async loadReleaseCandidate({ tenant_id, environment, release_id }) {
    const ledgerRecord = await getReleaseMetadataRecord(this.releaseLedger, { tenant_id, environment, release_id });
    const manifest = verifyManifestAgainstLedger(ledgerRecord);
    return { manifest, release_metadata_record: ledgerRecord };
  }

  writeManifest(releaseId, releaseCandidateId, manifestBytes) {
    const rootPath = this.manifestRoot instanceof URL ? fileURLToPath(this.manifestRoot) : this.manifestRoot;
    const path = join(rootPath, `${safeFileToken(releaseId)}.${safeFileToken(releaseCandidateId)}.manifest.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, manifestBytes, { flag: "wx" });
    return path;
  }
}

export function defaultAssertCanCreateRelease({
  actor,
  release_id,
  release_candidate_id,
  tenant_id,
  environment,
  included_proposals,
  validation_summary,
  source_version_pins,
  validation_report_refs,
  changelog_digest,
  content_hashes_digest,
  approval_trace_digest,
  audit_event_range,
  rationale,
  correlation_id
}) {
  try {
    assertReleaseManagerActor(actor, tenant_id, environment);
    assertNonEmpty(release_id, "release_id");
    assertNonEmpty(release_candidate_id, "release_candidate_id");
    assertNonEmpty(rationale, "rationale");
    assertNonEmpty(correlation_id, "correlation_id");
    assertArray(included_proposals, "included_proposals");
    assertArray(source_version_pins, "source_version_pins");
    assertArray(validation_report_refs, "validation_report_refs");
    assertSha256(changelog_digest, "changelog_digest");
    assertSha256(content_hashes_digest, "content_hashes_digest");
    assertSha256(approval_trace_digest, "approval_trace_digest");
    if (!audit_event_range?.first || !audit_event_range?.last) {
      throw new Error("audit_event_range required");
    }
    const validationPassed = validation_summary?.status !== "fail" && (validation_summary?.critical ?? 0) === 0;
    if (!validationPassed) {
      throw new Error("validation summary did not pass");
    }
    if (!included_proposals.every(isApprovedOrStagedProposalEvidence)) {
      throw new Error("included proposals are not all approved/staged");
    }
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(issuedAt) + 5 * 60 * 1000).toISOString();
    const binding = {
      action: "release_candidate.create",
      actor_user_id: actor.user_id,
      tenant_id,
      environment,
      release_id,
      release_candidate_id,
      included_proposal_ids_digest: sha256(included_proposals.map((proposal) => proposal.proposal_id ?? proposal.id)),
      validation_summary_digest: sha256(validation_summary),
      source_version_pins_digest: sha256(source_version_pins),
      validation_report_refs_digest: sha256(validation_report_refs),
      changelog_digest,
      content_hashes_digest,
      approval_trace_digest,
      audit_event_range_digest: sha256(audit_event_range),
      rationale_digest: sha256(rationale),
      correlation_id,
      issued_at: issuedAt,
      expires_at: expiresAt
    };
    const decisionBinding = sha256(binding);
    return {
      decision_id: `release-candidate-decision:${decisionBinding.slice("sha256:".length, "sha256:".length + 16)}`,
      decision: "allow",
      allowed: true,
      action: "release_candidate.create",
      actor_user_id: actor.user_id,
      actor_role_key: "release_manager",
      tenant_id,
      environment,
      release_id,
      release_candidate_id,
      included_proposal_ids_digest: binding.included_proposal_ids_digest,
      all_approved: true,
      validation_passed: true,
      validation_summary_digest: binding.validation_summary_digest,
      source_version_pins_digest: binding.source_version_pins_digest,
      validation_report_refs_digest: binding.validation_report_refs_digest,
      changelog_digest,
      content_hashes_digest,
      approval_trace_digest,
      audit_event_range_digest: binding.audit_event_range_digest,
      rationale_digest: binding.rationale_digest,
      audit_event_id: `audit:release-candidate:${release_candidate_id}:create`,
      correlation_id,
      issued_at: issuedAt,
      expires_at: expiresAt,
      decision_binding: decisionBinding,
      signature: sha256({ decisionBinding, purpose: "release_candidate.create" })
    };
  } catch (error) {
    if (error instanceof ReleaseManagerAuthorizationError) {
      throw error;
    }
    throw new ReleaseManagerAuthorizationError();
  }
}

export function buildRollbackMetadata({
  tenant_id,
  environment,
  release_id,
  release_candidate_id,
  previous_release_id,
  rollback_target_release_id,
  snapshot_ref,
  source_version_pins
}) {
  if (!rollback_target_release_id) {
    throw new ReleaseManagerError("release candidate requires rollback target");
  }
  return {
    schema_version: "release-rollback-metadata.v1",
    tenant_id,
    environment,
    release_id,
    release_candidate_id,
    previous_release_id,
    rollback_target_release_id,
    prior_snapshot_ref: `release:${rollback_target_release_id}:immutable-snapshot`,
    candidate_snapshot_ref: snapshot_ref,
    source_version_pins,
    procedure: rollbackProcedure()
  };
}

export function rollbackProcedure() {
  return [
    "Freeze new promotion attempts for the tenant and release domain.",
    "Load the prior immutable release manifest identified by rollback_target_release_id.",
    "Verify the prior manifest digest, snapshot reference, source-version pins, validation evidence, and approval trace.",
    "Move the active release pointer back to rollback_target_release_id through the release workflow service account.",
    "Invalidate and rebuild derived search, vector, and API caches from the restored immutable snapshot.",
    "Emit an immutable release.rollback audit event with actor, rationale, before/after release IDs, and correlation ID.",
    "Do not mutate existing released graphs or release candidate manifests."
  ];
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex")}`;
}

export function stableJson(value, spaces = 0) {
  return JSON.stringify(sortForJson(value), null, spaces);
}

function normalizeReleaseInput(input, clock) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ReleaseManagerError("release candidate input is required");
  }
  const tenant_id = input.tenant_id ?? input.tenantId;
  const environment = input.environment ?? "test";
  const release_id = input.release_id ?? input.releaseId;
  const semantic_version = input.semantic_version ?? input.semanticVersion ?? release_id;
  const release_candidate_id = input.release_candidate_id ?? input.releaseCandidateId ?? `rc:${release_id}`;
  const previous_release_id = input.previous_release_id ?? input.previousReleaseId ?? null;
  const rollback_target_release_id = input.rollback_target_release_id ?? input.rollbackTargetReleaseId ?? previous_release_id;
  const items = [];
  const staged_entries = [];
  const workingGraph = input.working_graph ?? input.workingGraph ?? null;
  const included_graphs = arrayOf(input.included_graphs).length > 0
    ? input.included_graphs
    : [{
      graph_name: workingGraph ?? `release-candidate:${release_candidate_id}:content-snapshot`,
      graph_role: "candidate_source_snapshot",
      target_release_graph: null
    }];
  const created_at = input.created_at ?? clock().toISOString();
  const changelog = input.changelog ?? null;
  const changelog_uri = input.changelog_uri ?? input.changelogUri ?? `release-candidate://${tenant_id}/${release_candidate_id}/changelog`;
  const actor = input.actor;
  assertNonEmpty(tenant_id, "tenant_id");
  assertNonEmpty(environment, "environment");
  assertNonEmpty(release_id, "release_id");
  assertNonEmpty(semantic_version, "semantic_version");
  assertNonEmpty(release_candidate_id, "release_candidate_id");
  assertNonEmpty(input.rationale, "rationale");
  assertNonEmpty(input.correlation_id ?? input.correlationId, "correlation_id");
  assertArray(input.source_version_pins ?? input.sourceVersionPins, "source_version_pins");
  return {
    tenant_id,
    environment,
    release_id,
    semantic_version,
    release_candidate_id,
    previous_release_id,
    rollback_target_release_id,
    items,
    staged_entries,
    included_graphs,
    actor,
    rationale: input.rationale,
    correlation_id: input.correlation_id ?? input.correlationId,
    created_at,
    changelog,
    changelog_uri,
    source_version_pins: input.source_version_pins ?? input.sourceVersionPins,
    validation_report_refs: [],
    approval_trace: [],
    audit_event_range: null,
    ontology_modules: input.ontology_modules ?? [],
    mapping_files: input.mapping_files ?? [],
    export_uris: input.export_uris ?? [],
    known_issues: input.known_issues ?? [],
    artifact_hashes: input.artifact_hashes ?? {},
    ontology_digest: input.ontology_digest ?? null,
    shape_digest: input.shape_digest ?? null,
    created_by_service_account_id: input.created_by_service_account_id ?? DEFAULT_RELEASE_WORKFLOW_SERVICE_ACCOUNT_ID
  };
}

function buildContentSnapshot(input) {
  const snapshot = {
    schema_version: "release-candidate-content-snapshot.v1",
    tenant_id: input.tenant_id,
    environment: input.environment,
    release_id: input.release_id,
    release_candidate_id: input.release_candidate_id,
    created_at: input.created_at,
    items: input.items,
    source_version_pins: input.source_version_pins
  };
  const digest = sha256(snapshot);
  return {
    ...snapshot,
    snapshot_digest: digest,
    snapshot_ref: `release-candidate://${input.tenant_id}/${input.release_candidate_id}/snapshot/${digest}`
  };
}

function buildChangelog(items) {
  return {
    summary: `Release candidate includes ${items.length} approved staged change${items.length === 1 ? "" : "s"}.`,
    entries: items.map((item, index) => ({
      ordinal: index + 1,
      object_type: item.object_type ?? item.proposal_type ?? item.type ?? "governed_item",
      object_id: item.mapping_id ?? item.proposal_id ?? item.relationship_id ?? item.evidence_link_id ?? item.id ?? `item:${index + 1}`,
      action: item.change_type ?? item.action ?? "include",
      title: item.title ?? item.label ?? item.description ?? null
    }))
  };
}

function assertStagedEntryBound(entry, input) {
  for (const field of ["staging_id", "proposal_id", "proposal_type", "tenant_id", "environment", "release_id", "staged_by_user_id", "staged_by_role_key", "audit_event_id", "payload_hash", "validation_report_id"]) {
    if (!entry[field]) {
      throw new ReleaseManagerError(`staged entry missing required field: ${field}`);
    }
  }
  if (entry.tenant_id !== input.tenant_id || entry.environment !== input.environment || entry.release_id !== input.release_id) {
    throw new ReleaseManagerError(`staged entry scope mismatch: ${entry.staging_id}`);
  }
  if (entry.staged_by_role_key !== "release_manager") {
    throw new ReleaseManagerError(`staged entry was not staged by release_manager: ${entry.staging_id}`);
  }
}

function assertResolvedValidationReports(records, input) {
  assertArray(records, "resolved validation_report_refs");
  const stagedValidationIds = new Set(input.staged_entries.map((entry) => entry.validation_report_id));
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new ReleaseManagerError("resolved validation report must be an object");
    }
    const validationRunId = record.validation_run_id ?? record.validation_report_id ?? record.report_id;
    if (!validationRunId || !stagedValidationIds.has(validationRunId)) {
      throw new ReleaseManagerError(`resolved validation report is not bound to staged entries: ${validationRunId ?? "missing"}`);
    }
    if (record.tenant_id && record.tenant_id !== input.tenant_id) {
      throw new ReleaseManagerError("resolved validation report tenant mismatch");
    }
    if (record.environment && record.environment !== input.environment) {
      throw new ReleaseManagerError("resolved validation report environment mismatch");
    }
    if (record.release_id && record.release_id !== input.release_id) {
      throw new ReleaseManagerError("resolved validation report release mismatch");
    }
    if (record.immutable !== true && record.persisted !== true) {
      throw new ReleaseManagerError(`resolved validation report is not immutable/persisted: ${validationRunId}`);
    }
    const critical = String(record.severity ?? "").toLowerCase() === "critical" ||
      String(record.result ?? record.status ?? "").toLowerCase() === "failed" ||
      (record.summary?.critical ?? 0) > 0;
    if (critical) {
      throw new ReleaseManagerError("critical validation failure blocks release candidate", { validationReport: record });
    }
  }
}

async function appendRequiredAuditEvent(auditStore, event) {
  if (!auditStore || typeof auditStore.append !== "function") {
    throw new ReleaseManagerError("release manager requires append-only auditStore.append");
  }
  const persisted = await auditStore.append(event);
  if (!persisted?.audit_event_id || persisted.audit_event_id !== event.audit_event_id) {
    throw new ReleaseManagerError("persisted audit id does not match release manifest event");
  }
  return persisted;
}

function buildCreateAuditEvent(input, decisionBinding) {
  return {
    audit_event_id: `audit:release-candidate:${input.release_candidate_id}:create`,
    event_type: "release_candidate_created",
    tenant_id: input.tenant_id,
    environment: input.environment,
    actor_user_id: input.actor.user_id,
    actor_role_key: "release_manager",
    actor_type: "user",
    action: "release_candidate.create",
    resource_type: "release_candidate",
    resource_id: input.release_candidate_id,
    release_id: input.release_id,
    rationale: input.rationale,
    correlation_id: input.correlation_id,
    decision_binding: decisionBinding,
    occurred_at: input.created_at
  };
}

function verifyReleaseCandidateAuthorizationDecision(decision, input, usedDecisionBindings, clock) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    throw new ReleaseManagerAuthorizationError("release candidate authorization decision is required");
  }
  const checks = [
    ["decision", decision.decision, "allow"],
    ["action", decision.action, "release_candidate.create"],
    ["actor_user_id", decision.actor_user_id, input.actor.user_id],
    ["actor_role_key", decision.actor_role_key, "release_manager"],
    ["tenant_id", decision.tenant_id, input.tenant_id],
    ["environment", decision.environment, input.environment],
    ["release_id", decision.release_id, input.release_id],
    ["release_candidate_id", decision.release_candidate_id, input.release_candidate_id],
    ["included_proposal_ids_digest", decision.included_proposal_ids_digest, sha256(input.included_proposals.map((proposal) => proposal.proposal_id ?? proposal.id))],
    ["validation_summary_digest", decision.validation_summary_digest, sha256(input.validation_summary)],
    ["source_version_pins_digest", decision.source_version_pins_digest, sha256(input.source_version_pins)],
    ["validation_report_refs_digest", decision.validation_report_refs_digest, sha256(input.validation_report_refs)],
    ["changelog_digest", decision.changelog_digest, input.changelog_digest],
    ["content_hashes_digest", decision.content_hashes_digest, input.content_hashes_digest],
    ["approval_trace_digest", decision.approval_trace_digest, input.approval_trace_digest],
    ["audit_event_range_digest", decision.audit_event_range_digest, sha256(input.audit_event_range)],
    ["rationale_digest", decision.rationale_digest, sha256(input.rationale)],
    ["correlation_id", decision.correlation_id, input.correlation_id]
  ];
  for (const [field, actual, expected] of checks) {
    if (actual !== expected) {
      throw new ReleaseManagerAuthorizationError(`release candidate authorization decision ${field} mismatch`);
    }
  }
  if (decision.all_approved !== true || decision.validation_passed !== true) {
    throw new ReleaseManagerAuthorizationError("release candidate authorization decision missing approval or validation pass");
  }
  if (!decision.audit_event_id || !decision.decision_binding || !decision.signature || !decision.issued_at || !decision.expires_at) {
    throw new ReleaseManagerAuthorizationError("release candidate authorization decision missing signed binding fields");
  }
  if (decision.audit_event_id !== input.audit_event_range.last) {
    throw new ReleaseManagerAuthorizationError("release candidate authorization decision audit event mismatch");
  }
  if (Date.parse(decision.expires_at) <= clock().getTime()) {
    throw new ReleaseManagerAuthorizationError("release candidate authorization decision expired");
  }
  if (usedDecisionBindings.has(decision.decision_binding)) {
    throw new ReleaseManagerAuthorizationError("release candidate authorization decision replayed");
  }
  usedDecisionBindings.add(decision.decision_binding);
}

function buildPreCreateAuditRange(stagedEntries) {
  const ids = workflowAuditIds(stagedEntries);
  return {
    first: ids[0],
    last: ids.at(-1),
    event_count: ids.length,
    event_ids: ids,
    event_types: ["proposal.stage"]
  };
}

function buildAuditEventRange(stagedEntries, createAuditEvent) {
  const ids = [...workflowAuditIds(stagedEntries), createAuditEvent.audit_event_id];
  return {
    first: ids[0],
    last: createAuditEvent.audit_event_id,
    event_count: ids.length,
    event_ids: ids,
    event_types: ["proposal.stage", "release_candidate.create"]
  };
}

function workflowAuditIds(stagedEntries) {
  return unique([
    ...stagedEntries.flatMap((entry) => arrayOf(entry.workflow_audit_events).map((event) => event.audit_event_id)),
    ...stagedEntries.map((entry) => entry.audit_event_id)
  ].filter(Boolean));
}

function buildApprovalTraceFromStaging(stagedEntries) {
  return stagedEntries.map((entry) => ({
    role: entry.staged_by_role_key,
    actor: entry.staged_by_user_id,
    decision: "staged_for_release",
    audit_event_id: entry.audit_event_id,
    proposal_id: entry.proposal_id,
    staging_id: entry.staging_id,
    validation_report_id: entry.validation_report_id
  }));
}

function buildIncludedProposalEvidence(input) {
  if (input.staged_entries.length > 0) {
    return input.staged_entries.map((entry) => ({
      proposal_id: entry.proposal_id ?? entry.id,
      proposal_type: entry.proposal_type ?? entry.type ?? null,
      tenant_id: entry.tenant_id,
      environment: entry.environment,
      release_id: entry.release_id,
      state: "staged-for-release",
      reviewed_by: entry.staged_by_user_id,
      review_status: "approved",
      staged_by_role_key: entry.staged_by_role_key,
      validation_report_id: entry.validation_report_id,
      audit_event_id: entry.audit_event_id,
      payload_hash: entry.payload_hash
    }));
  }
  return input.items.map((item) => ({
    proposal_id: item.proposal_id ?? item.mapping_id ?? item.relationship_id ?? item.evidence_link_id ?? item.id,
    proposal_type: item.proposal_type ?? item.object_type ?? item.type ?? null,
    tenant_id: item.tenant_id ?? input.tenant_id,
    environment: item.environment ?? input.environment,
    release_id: input.release_id,
    state: item.workflow_status ?? "staged-for-release",
    reviewed_by: item.reviewed_by,
    review_status: item.review_status,
    validation_report_id: item.validation_report_id ?? input.validation_report_refs[0]?.validation_run_id ?? null
  }));
}

function isModelSuggestedReleaseItem(item) {
  return item?.assertion_type === "model_suggested" ||
    item?.payload?.assertion_type === "model_suggested" ||
    item?.candidate?.assertion_type === "model_suggested" ||
    item?.governance?.release_eligible === false ||
    item?.governance?.auto_publish === false ||
    item?.governance?.released_graph_target === null;
}

function releaseItemId(item) {
  return item?.proposal_id ??
    item?.mapping_id ??
    item?.relationship_id ??
    item?.evidence_link_id ??
    item?.candidate_id ??
    item?.suggestion_id ??
    item?.id ??
    null;
}

async function getReleaseMetadataRecord(releaseLedger, lookup) {
  if (!releaseLedger || typeof releaseLedger.getReleaseMetadata !== "function") {
    throw new ReleaseManagerError("release manager requires releaseLedger.getReleaseMetadata before downstream use");
  }
  const record = await releaseLedger.getReleaseMetadata(lookup);
  if (!record) {
    throw new ReleaseManagerError(`release metadata not found: ${lookup.tenant_id}/${lookup.environment}/${lookup.release_id}`);
  }
  if (record.tenant_id !== lookup.tenant_id || record.environment !== lookup.environment || record.release_id !== lookup.release_id) {
    throw new ReleaseManagerError("release metadata scope mismatch");
  }
  return record;
}

function verifyManifestAgainstLedger(ledgerRecord) {
  const manifestBytes = readFileSync(ledgerRecord.manifest_uri, "utf8");
  const digest = sha256(manifestBytes);
  if (digest !== ledgerRecord.manifest_digest) {
    throw new ReleaseManagerError(`release manifest digest mismatch: ledger ${ledgerRecord.manifest_digest}, stored ${digest}`);
  }
  const manifest = JSON.parse(manifestBytes);
  if (!manifest.snapshot_ref && !manifest.content_snapshot?.snapshot_ref && !Array.isArray(manifest.included_graphs)) {
    throw new ReleaseManagerError("release manifest missing immutable snapshot reference");
  }
  assertArray(manifest.source_version_pins, "manifest source_version_pins");
  assertArray(manifest.validation_report_refs, "manifest validation_report_refs");
  assertArray(manifest.approval_trace, "manifest approval_trace");
  if (!manifest.audit_event_range?.first || !manifest.audit_event_range?.last) {
    throw new ReleaseManagerError("release manifest missing audit_event_range");
  }
  if (!manifest.artifact_hashes || typeof manifest.artifact_hashes !== "object" || Array.isArray(manifest.artifact_hashes)) {
    throw new ReleaseManagerError("release manifest missing artifact_hashes");
  }
  return manifest;
}

function canonicalSnapshotRef(manifest) {
  return manifest.snapshot_ref ?? manifest.content_snapshot?.snapshot_ref ?? manifest.included_graphs?.[0]?.graph_name;
}

function validationSummary(validationResult) {
  return {
    status: validationResult?.status ?? "pass",
    critical: validationResult?.summary?.critical ?? 0,
    warning: validationResult?.summary?.warning ?? 0,
    ruleset_version: validationResult?.ruleset_version ?? null
  };
}

async function defaultValidationGate(releaseCandidate, options) {
  const structuralResult = assertNoCriticalFailures(releaseCandidate, options);
  const evidenceResult = await assertResolvedValidationEvidence(releaseCandidate, options);
  return mergeValidationResults(structuralResult, evidenceResult);
}

async function callValidationGate(validationGate, releaseCandidate, options) {
  try {
    return await validationGate(releaseCandidate, options);
  } catch (error) {
    if (error?.result) {
      throw new ReleaseManagerError("critical validation failure blocks release candidate", { validationResult: error.result });
    }
    throw error;
  }
}

function assertNoCriticalValidationRefs(validationReportRefs) {
  const critical = validationReportRefs.find((ref) =>
    String(ref?.severity ?? "").toLowerCase() === "critical" || String(ref?.result ?? "").toLowerCase() === "failed"
  );
  if (critical) {
    throw new ReleaseManagerError("critical validation failure blocks release candidate", { validationReportRef: critical });
  }
}

function mergeValidationResults(primary, secondary) {
  const findings = [
    ...arrayOf(primary?.findings),
    ...arrayOf(secondary?.findings)
  ];
  const critical = findings.filter((item) => item.severity === "critical").length;
  const warning = findings.filter((item) => item.severity === "warning").length;
  return {
    status: critical > 0 ? "fail" : warning > 0 ? "warning" : "pass",
    findings,
    blocking: Boolean(primary?.blocking || secondary?.blocking || critical > 0),
    summary: { critical, warning },
    ruleset_version: `${primary?.ruleset_version ?? "phase4.validation-preview.v1"}+${secondary?.ruleset_version ?? "phase4.validation-evidence.v1"}`,
    structural_result: primary,
    validation_evidence_result: secondary,
    resolved_validation_runs: secondary?.resolved_validation_runs ?? []
  };
}

function defaultAssertRollbackActor({ actor, tenant_id, environment, rationale, correlation_id }) {
  assertReleaseManagerActor(actor, tenant_id, environment);
  assertNonEmpty(rationale, "rationale");
  assertNonEmpty(correlation_id, "correlation_id");
}

function assertReleaseManagerActor(actor, tenantId, environment) {
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
    throw new Error("actor required");
  }
  assertNonEmpty(actor.user_id, "actor.user_id");
  if (actor.principal_type === "service_account" || actor.service_account_id) {
    throw new Error("service accounts cannot create release candidates");
  }
  if (actor.tenant_id !== tenantId || actor.environment !== environment) {
    throw new Error("actor scope mismatch");
  }
  if (!Array.isArray(actor.role_keys) || !actor.role_keys.includes("release_manager")) {
    throw new Error("release_manager role required");
  }
}

function isApprovedOrStagedProposalEvidence(proposal) {
  const state = String(proposal.state ?? proposal.workflow_status ?? "").toLowerCase();
  return proposal.review_status === "approved" &&
    Boolean(proposal.reviewed_by) &&
    (state === "approved" || state === "staged-for-release" || state === "staged_for_release" || proposal.staged_by_role_key === "release_manager") &&
    Boolean(proposal.validation_report_id);
}

function assertSha256(value, fieldName) {
  if (!/^sha256:[a-f0-9]{64}$/.test(String(value ?? ""))) {
    throw new Error(`${fieldName} must be sha256 digest`);
  }
}

function assertArray(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ReleaseManagerError(`release candidate requires non-empty ${fieldName}`);
  }
}

function assertNonEmpty(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ReleaseManagerError(`release candidate requires ${fieldName}`);
  }
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values)];
}

function safeFileToken(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function sortForJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortForJson(nested)])
    );
  }
  return value;
}
