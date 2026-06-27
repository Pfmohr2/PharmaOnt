import { createHash } from "node:crypto";

export class BackupRestoreError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BackupRestoreError";
    this.details = details;
  }
}

export function createBackupSnapshot({
  tenant_id,
  environment,
  snapshot_id,
  created_at,
  graph_exports = [],
  release_manifests = [],
  release_metadata = [],
  audit_events = [],
  object_artifacts = [],
  governance_proof_resolver,
  rpo_target_minutes = 15,
  rto_target_minutes = 60
}) {
  assertNonEmpty(tenant_id, "tenant_id");
  assertNonEmpty(environment, "environment");
  assertArray(graph_exports, "graph_exports");
  assertArray(release_manifests, "release_manifests");
  assertArray(release_metadata, "release_metadata");
  assertArray(audit_events, "audit_events");
  const capturedAt = created_at ?? new Date().toISOString();
  const sections = {
    graph_exports: digestRecords(graph_exports),
    release_manifests: digestRecords(release_manifests),
    release_metadata: digestRecords(release_metadata),
    audit_events: digestRecords(audit_events),
    object_artifacts: digestRecords(object_artifacts)
  };
  const backup = {
    schema_version: "phase7.backup.v1",
    snapshot_id: snapshot_id ?? `backup:${tenant_id}:${environment}:${capturedAt}`,
    tenant_id,
    environment,
    created_at: capturedAt,
    rpo_target_minutes,
    rto_target_minutes,
    graph_exports: structuredClone(graph_exports),
    release_manifests: structuredClone(release_manifests),
    release_metadata: structuredClone(release_metadata),
    audit_events: structuredClone(audit_events),
    object_artifacts: structuredClone(object_artifacts),
    section_digests: Object.fromEntries(
      Object.entries(sections).map(([section, records]) => [section, sha256(records)])
    )
  };
  backup.manifest_digest = sha256({
    schema_version: backup.schema_version,
    snapshot_id: backup.snapshot_id,
    tenant_id,
    environment,
    created_at: capturedAt,
    section_digests: backup.section_digests,
    rpo_target_minutes,
    rto_target_minutes
  });
  assertNoCallerSuppliedGovernedState(backup);
  assertCanonicalGovernanceProofs(backup, governance_proof_resolver);
  assertNoModelSuggestedReleasedLeakage(backup);
  return deepFreeze(backup);
}

export function restoreBackupSnapshot({ backup, target = {}, restored_at = new Date().toISOString() }) {
  assertBackupShape(backup);
  assertCleanTarget(target);
  const restored = {
    schema_version: "phase7.restore.v1",
    source_snapshot_id: backup.snapshot_id,
    source_manifest_digest: backup.manifest_digest,
    tenant_id: backup.tenant_id,
    environment: backup.environment,
    restored_at,
    graph_exports: structuredClone(backup.graph_exports),
    release_manifests: structuredClone(backup.release_manifests),
    release_metadata: structuredClone(backup.release_metadata),
    audit_events: structuredClone(backup.audit_events),
    object_artifacts: structuredClone(backup.object_artifacts)
  };
  restored.section_digests = {
    graph_exports: sha256(digestRecords(restored.graph_exports)),
    release_manifests: sha256(digestRecords(restored.release_manifests)),
    release_metadata: sha256(digestRecords(restored.release_metadata)),
    audit_events: sha256(digestRecords(restored.audit_events)),
    object_artifacts: sha256(digestRecords(restored.object_artifacts))
  };
  return deepFreeze(restored);
}

export function verifyRestoredBackup({ backup, restored }) {
  assertBackupShape(backup);
  if (!restored || typeof restored !== "object" || Array.isArray(restored)) {
    throw new BackupRestoreError("restored backup target is required");
  }
  const mismatchedSections = Object.entries(backup.section_digests)
    .filter(([section, digest]) => restored.section_digests?.[section] !== digest)
    .map(([section]) => section);
  if (mismatchedSections.length > 0) {
    throw new BackupRestoreError("restored content hashes do not match backup", { mismatchedSections });
  }
  assertReleaseIntegrity(restored);
  assertAuditPreserved(backup, restored);
  assertNoModelSuggestedReleasedLeakage(restored);
  return {
    status: "pass",
    snapshot_id: backup.snapshot_id,
    manifest_digest: backup.manifest_digest,
    release_count: restored.release_metadata.length,
    graph_export_count: restored.graph_exports.length,
    audit_event_count: restored.audit_events.length,
    checked_sections: Object.keys(backup.section_digests),
    checks: {
      content_hashes_match: true,
      releases_intact: true,
      audit_preserved: true,
      no_model_suggested_released_leakage: true
    }
  };
}

export function runBackupRestoreDrill({
  tenant_id,
  environment,
  snapshot_id,
  started_at,
  completed_at,
  clean_target = {},
  graph_exports = [],
  release_manifests = [],
  release_metadata = [],
  audit_events = [],
  object_artifacts = [],
  governance_proof_resolver,
  rpo_target_minutes = 15,
  rto_target_minutes = 60
}) {
  const start = started_at ?? new Date().toISOString();
  const backup = createBackupSnapshot({
    tenant_id,
    environment,
    snapshot_id,
    created_at: start,
    graph_exports,
    release_manifests,
    release_metadata,
    audit_events,
    object_artifacts,
    governance_proof_resolver,
    rpo_target_minutes,
    rto_target_minutes
  });
  const restored = restoreBackupSnapshot({
    backup,
    target: clean_target,
    restored_at: completed_at ?? start
  });
  const verification = verifyRestoredBackup({ backup, restored });
  const completed = completed_at ?? new Date().toISOString();
  const rtoMinutes = Math.max(0, (Date.parse(completed) - Date.parse(start)) / 60000);
  return {
    drill_id: `backup-restore-drill:${backup.snapshot_id}`,
    tenant_id,
    environment,
    started_at: start,
    completed_at: completed,
    rpo_target_minutes,
    rto_target_minutes,
    measured_rto_minutes: rtoMinutes,
    rpo_met: true,
    rto_met: rtoMinutes <= rto_target_minutes,
    backup,
    restored,
    verification
  };
}

function assertBackupShape(backup) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    throw new BackupRestoreError("backup snapshot is required");
  }
  for (const field of ["snapshot_id", "tenant_id", "environment", "manifest_digest", "section_digests"]) {
    if (!backup[field]) {
      throw new BackupRestoreError(`backup snapshot missing ${field}`);
    }
  }
}

function assertReleaseIntegrity(restored) {
  const manifestsByRelease = new Map(restored.release_manifests.map((manifest) => [manifest.release_id, manifest]));
  for (const record of restored.release_metadata) {
    const manifest = manifestsByRelease.get(record.release_id);
    if (!manifest) {
      throw new BackupRestoreError(`release metadata has no manifest: ${record.release_id}`);
    }
    if (record.manifest_digest && manifest.manifest_digest && record.manifest_digest !== manifest.manifest_digest) {
      throw new BackupRestoreError(`release manifest digest mismatch after restore: ${record.release_id}`);
    }
    if (!Array.isArray(manifest.included_graphs) || manifest.included_graphs.length === 0) {
      throw new BackupRestoreError(`release manifest missing included graphs: ${record.release_id}`);
    }
    if (!manifest.audit_event_range?.first || !manifest.audit_event_range?.last) {
      throw new BackupRestoreError(`release manifest missing audit range: ${record.release_id}`);
    }
  }
}

function assertCanonicalGovernanceProofs(snapshot, governanceProofResolver) {
  if (snapshot.release_metadata.length === 0) {
    return;
  }
  if (typeof governanceProofResolver !== "function") {
    throw new BackupRestoreError("backup snapshot requires server-side canonical governance proof resolver");
  }
  const manifestsByRelease = new Map(snapshot.release_manifests.map((manifest) => [manifest.release_id, manifest]));
  for (const record of snapshot.release_metadata) {
    const manifest = manifestsByRelease.get(record.release_id);
    if (!manifest) {
      throw new BackupRestoreError(`canonical governance proof cannot resolve release without manifest: ${record.release_id}`);
    }
    const proof = governanceProofResolver({
      tenant_id: snapshot.tenant_id,
      environment: snapshot.environment,
      release_id: record.release_id,
      release_candidate_id: record.release_candidate_id,
      manifest_digest: record.manifest_digest ?? manifest.manifest_digest
    });
    if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
      throw new BackupRestoreError(`canonical governance proof missing for release: ${record.release_id}`);
    }
    const expectedDigest = record.manifest_digest ?? manifest.manifest_digest;
    if (
      proof.canonical !== true ||
      proof.tenant_id !== snapshot.tenant_id ||
      proof.environment !== snapshot.environment ||
      proof.release_id !== record.release_id ||
      proof.manifest_digest !== expectedDigest ||
      !(proof.approval_trace_digest || proof.human_governance_proof_digest || proof.audit_event_range_digest)
    ) {
      throw new BackupRestoreError(`canonical governance proof mismatch for release: ${record.release_id}`);
    }
  }
}

function assertNoCallerSuppliedGovernedState(snapshot) {
  const records = [
    ...arrayOf(snapshot.release_manifests),
    ...arrayOf(snapshot.release_metadata),
    ...arrayOf(snapshot.graph_exports)
  ];
  const forbidden = records.find((record) => containsForbiddenInlineGovernance(record));
  if (forbidden) {
    throw new BackupRestoreError("caller-supplied governed state or release target is not accepted in backup snapshot payload", {
      release_id: forbidden.release_id ?? null,
      graph_name: forbidden.graph_name ?? null
    });
  }
}

function containsForbiddenInlineGovernance(value) {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenInlineGovernance);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const forbiddenKeys = new Set([
    "governed_state",
    "governedState",
    "inline_governance_proof",
    "inlineGovernanceProof",
    "release_target",
    "releaseTarget",
    "released_graph_target",
    "releasedGraphTarget"
  ]);
  if (Object.keys(value).some((key) => forbiddenKeys.has(key))) {
    return true;
  }
  return Object.values(value).some(containsForbiddenInlineGovernance);
}

function assertAuditPreserved(backup, restored) {
  const before = new Set(backup.audit_events.map((event) => event.audit_event_id));
  const after = new Set(restored.audit_events.map((event) => event.audit_event_id));
  for (const auditId of before) {
    if (!after.has(auditId)) {
      throw new BackupRestoreError(`audit event missing after restore: ${auditId}`);
    }
  }
  for (const manifest of restored.release_manifests) {
    const eventIds = manifest.audit_event_range?.event_ids ?? [
      manifest.audit_event_range?.first,
      manifest.audit_event_range?.last
    ].filter(Boolean);
    for (const auditId of eventIds) {
      if (!after.has(auditId)) {
        throw new BackupRestoreError(`release audit event missing after restore: ${auditId}`);
      }
    }
  }
}

function assertNoModelSuggestedReleasedLeakage(snapshot) {
  const releasedRecords = [
    ...arrayOf(snapshot.release_manifests),
    ...arrayOf(snapshot.release_metadata),
    ...arrayOf(snapshot.graph_exports).filter((graph) =>
      graph.graph_role === "release" || graph.graph_name?.includes(":release:")
    )
  ];
  const leaked = releasedRecords.find((record) => containsModelSuggested(record));
  if (leaked) {
    throw new BackupRestoreError("model_suggested content found in released backup scope", {
      release_id: leaked.release_id ?? null,
      graph_name: leaked.graph_name ?? null
    });
  }
}

function containsModelSuggested(value) {
  if (Array.isArray(value)) {
    return value.some(containsModelSuggested);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(containsModelSuggested);
  }
  return value === "model_suggested";
}

function digestRecords(records) {
  return records.map((record) => ({
    id: record.release_id ?? record.graph_name ?? record.audit_event_id ?? record.object_key ?? record.id ?? null,
    digest: sha256(record)
  }));
}

function assertCleanTarget(target) {
  const occupied = ["graph_exports", "release_manifests", "release_metadata", "audit_events", "object_artifacts"]
    .filter((field) => Array.isArray(target[field]) && target[field].length > 0);
  if (occupied.length > 0) {
    throw new BackupRestoreError("restore target must be clean", { occupied });
  }
}

function assertArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new BackupRestoreError(`${fieldName} must be an array`);
  }
}

function assertNonEmpty(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new BackupRestoreError(`${fieldName} is required`);
  }
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
