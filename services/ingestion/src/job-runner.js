import { randomUUID } from "node:crypto";

import { PolicyViolation, assertIngestionPolicy } from "../../../packages/licensing/src/index.js";
import { stableDigest } from "./canonical.js";
import { MemoryDeadLetterQueue } from "./error-queue.js";
import { MemoryJobRunStore } from "./job-run-store.js";
import { MemoryMetricSink, systemClock } from "./metrics.js";
import { MemoryNormalizedOutputStore } from "./normalized-output-store.js";

const REQUIRED_OUTPUT_FIELDS = [
  "source_name",
  "source_version",
  "source_record_id",
  "license_classification"
];
const DEFAULT_CHECKPOINT_BINDING_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHECKPOINT_SIGNING_KEY = "local-ingestion-checkpoint-binding-key";

export class IngestionBlockedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "IngestionBlockedError";
    this.details = details;
  }
}

export class IngestionJobRunner {
  constructor({
    rawArtifactStore,
    normalizedOutputStore = new MemoryNormalizedOutputStore(),
    errorQueue = new MemoryDeadLetterQueue(),
    jobRunStore = new MemoryJobRunStore(),
    metrics = new MemoryMetricSink(),
    clock = systemClock
  }) {
    if (!rawArtifactStore) {
      throw new Error("IngestionJobRunner requires rawArtifactStore");
    }
    this.rawArtifactStore = rawArtifactStore;
    this.normalizedOutputStore = normalizedOutputStore;
    this.errorQueue = errorQueue;
    this.jobRunStore = jobRunStore;
    this.metrics = metrics;
    this.clock = clock;
  }

  async runConnectorJob(options) {
    return runConnectorJob({
      rawArtifactStore: this.rawArtifactStore,
      normalizedOutputStore: this.normalizedOutputStore,
      errorQueue: this.errorQueue,
      jobRunStore: this.jobRunStore,
      metrics: this.metrics,
      clock: this.clock,
      ...options
    });
  }

  async retryConnectorJob(previousRun, options) {
    return retryConnectorJob(previousRun, {
      rawArtifactStore: this.rawArtifactStore,
      normalizedOutputStore: this.normalizedOutputStore,
      errorQueue: this.errorQueue,
      jobRunStore: this.jobRunStore,
      metrics: this.metrics,
      clock: this.clock,
      ...options
    });
  }
}

export async function retryConnectorJob(previousRun, options) {
  if (!previousRun) {
    throw new Error("retryConnectorJob requires a previousRun");
  }
  assertRetryScope(previousRun, options);
  return runConnectorJob({
    ...options,
    runLineageId: previousRun.run_lineage_id ?? previousRun.run_id,
    attempt: (previousRun.attempt ?? 1) + 1,
    checkpoint: previousRun.checkpoint ?? options.checkpoint
  });
}

export function assertRetryScope(previousRun, options) {
  if (previousRun.checkpoint != null) {
    verifyCheckpointBinding(previousRun, {
      signingKey: options.checkpointSigningKey,
      now: options.clock?.now?.() ?? new Date()
    });
  }
  const checks = [
    ["tenant", previousRun.tenant_id, options.tenantId],
    ["environment", previousRun.environment, options.environment],
    ["connector id", previousRun.connector_id, options.connector?.id ?? options.connector?.connectorId],
    ["connector name", previousRun.connector_name, options.connector?.name],
    ["connector version", previousRun.connector_version, options.connector?.version],
    ["source name", previousRun.source_name, options.connector?.sourceName],
    ["source version", previousRun.source_version, options.connector?.sourceVersion],
    ["source snapshot", previousRun.source_snapshot_digest, options.connector?.sourceSnapshotDigest],
    ["service-account", previousRun.service_account_id, options.executionContext?.service_account_id],
    ["license policy", previousRun.license_policy_id, options.executionContext?.license_policy_id]
  ];
  for (const [label, previousValue, nextValue] of checks) {
    if (previousValue != null && nextValue != null && previousValue !== nextValue) {
      throw new IngestionBlockedError(`retry scope mismatch for ${label}: previous lineage cannot replay checkpoint across scope`);
    }
  }
  if (options.executionContext) {
    assertExecutionContext({
      executionContext: options.executionContext,
      job: options.job,
      connector: options.connector,
      tenantId: options.tenantId,
      environment: options.environment
    });
  }
}

export async function runConnectorJob({
  connector,
  tenantId,
  environment,
  rawArtifactStore,
  normalizedOutputStore = new MemoryNormalizedOutputStore(),
  errorQueue = new MemoryDeadLetterQueue(),
  jobRunStore = new MemoryJobRunStore(),
  metrics = new MemoryMetricSink(),
  clock = systemClock,
  runId = randomUUID(),
  runLineageId = runId,
  attempt = 1,
  checkpoint = null,
  executionContext = null,
  job = null,
  checkpointSigningKey = DEFAULT_CHECKPOINT_SIGNING_KEY
}) {
  assertConnector(connector);
  assertNonEmpty(tenantId, "tenantId");
  assertNonEmpty(environment, "environment");
  if (!rawArtifactStore) {
    throw new Error("runConnectorJob requires rawArtifactStore");
  }
  const securityContext = assertExecutionContext({
    executionContext,
    job,
    connector,
    tenantId,
    environment
  });

  const startedAt = clock.now();
  const labels = connectorMetricLabels({ connector, tenantId, environment, attempt, securityContext });
  const baseRun = {
    run_id: runId,
    run_lineage_id: runLineageId,
    attempt,
    tenant_id: tenantId,
    environment,
    service_account_id: securityContext.service_account_id ?? null,
    correlation_id: securityContext.correlation_id ?? null,
    license_policy_id: securityContext.license_policy_id ?? null,
    job_id: job?.job_id ?? null,
    connector_id: connector.id ?? connector.connectorId,
    connector_name: connector.name,
    connector_version: connector.version,
    parser_version: connector.parserVersion,
    normalization_ruleset_version: connector.normalizationRulesetVersion,
    source_name: connector.sourceName,
    source_version: connector.sourceVersion,
    source_snapshot_digest: connector.sourceSnapshotDigest,
    started_at: startedAt.toISOString(),
    completed_at: null,
    status: "queued",
    records_seen: 0,
    records_persisted: 0,
    records_normalized: 0,
    records_failed: 0,
    skipped_duplicate_count: 0,
    records_duplicate_skipped: 0,
    checkpoint,
    error_summary: [],
    artifact_uris: []
  };
  baseRun.checkpoint_scope_digest = buildCheckpointScopeDigest(baseRun);

  await jobRunStore.record({ ...baseRun });
  await metrics.increment("ingestion_job_queued_total", 1, labels);
  let run = { ...baseRun, status: "running" };
  await jobRunStore.record({ ...run });
  await metrics.increment("ingestion_job_started_total", 1, labels);
  const outputs = [];

  try {
    for await (const fetchedRecord of connector.fetchRecords({ checkpoint: run.checkpoint, attempt })) {
      run.records_seen += 1;
      await metrics.increment("ingestion_records_fetched_total", 1, labels);
      try {
        const output = await processFetchedRecord({
          fetchedRecord,
          connector,
          tenantId,
          environment,
          run,
          rawArtifactStore
        });
        run.records_persisted += 1;
        run.checkpoint = fetchedRecord.checkpoint ?? output.source_record_id;
        run.last_idempotency_key = output.idempotency_key;
        run.artifact_uris.push(output.raw_artifact_uri);
        await metrics.increment("ingestion_records_persisted_total", 1, labels);
        const persistedOutput = await normalizedOutputStore.putIfAbsent(output);
        if (persistedOutput.created) {
          outputs.push(persistedOutput.record);
          run.records_normalized += 1;
          await metrics.increment("ingestion_records_normalized_total", 1, labels);
        } else {
          run.skipped_duplicate_count += 1;
          run.records_duplicate_skipped += 1;
          await metrics.increment("ingestion_records_duplicate_skipped_total", 1, labels);
        }
      } catch (error) {
        run.records_failed += 1;
        run.error_summary.push({
          source_record_id: fetchedRecord?.source_record_id ?? fetchedRecord?.id ?? null,
          message: error.message
        });
        const blockedByPolicy = error instanceof PolicyViolation || error instanceof IngestionBlockedError;
        await errorQueue.enqueue({
          run_id: run.run_id,
          run_lineage_id: run.run_lineage_id,
          attempt,
          connector_name: connector.name,
          connector_version: connector.version,
          source_name: fetchedRecord?.source_name ?? connector.sourceName,
          source_version: fetchedRecord?.source_version ?? connector.sourceVersion,
          source_record_id: fetchedRecord?.source_record_id ?? fetchedRecord?.id ?? null,
          error_class: error.name,
          error_message: error.message,
          error_status: blockedByPolicy ? "failed_blocked" : "failed_retryable",
          retryable: !blockedByPolicy,
          policy_decision: blockedByPolicy ? error.details : undefined,
          tenant_id: tenantId,
          environment,
          service_account_id: securityContext.service_account_id ?? null,
          correlation_id: securityContext.correlation_id ?? null,
          replay_payload: redactReplayPayload(fetchedRecord)
        });
        await metrics.increment("ingestion_records_failed_total", 1, labels);
        if (blockedByPolicy) {
          await metrics.increment("ingestion_records_policy_blocked_total", 1, labels);
        }
      }
    }
    run.status = "completed";
  } catch (error) {
    run.status = "failed";
    run.error_summary.push({
      source_record_id: null,
      message: error.message
    });
    await errorQueue.enqueue({
      run_id: run.run_id,
      run_lineage_id: run.run_lineage_id,
      attempt,
      connector_name: connector.name,
      connector_version: connector.version,
      source_name: connector.sourceName,
      source_version: connector.sourceVersion,
      source_record_id: null,
      error_class: error.name,
      error_message: error.message,
      retryable: true,
      tenant_id: tenantId,
      environment,
      service_account_id: securityContext.service_account_id ?? null,
      correlation_id: securityContext.correlation_id ?? null,
      replay_payload: { checkpoint: run.checkpoint }
    });
    await metrics.increment("ingestion_jobs_failed_total", 1, labels);
  } finally {
    const completedAt = clock.now();
    run.completed_at = completedAt.toISOString();
    run.duration_ms = Math.max(0, completedAt.getTime() - startedAt.getTime());
    run.checkpoint_scope_digest = buildCheckpointScopeDigest(run);
    run.checkpoint_binding = run.checkpoint == null ? null : buildCheckpointBinding(run, {
      issuedAt: completedAt,
      expiresAt: new Date(completedAt.getTime() + DEFAULT_CHECKPOINT_BINDING_TTL_MS),
      signingKey: checkpointSigningKey
    });
    await metrics.observe("ingestion_job_duration_ms", run.duration_ms, labels);
    await metrics.gauge("ingestion_source_freshness_ms", sourceFreshnessMs(outputs, completedAt), labels);
    await jobRunStore.record({ ...run });
  }

  return {
    ...run,
    normalized_outputs: outputs
  };
}

async function processFetchedRecord({ fetchedRecord, connector, tenantId, environment, run, rawArtifactStore }) {
  const record = normalizeFetchedRecord(fetchedRecord, connector);
  assertUniversalFields(record);
  const policyDecision = assertIngestionPolicy({
    source: record.source_policy ?? connector.sourcePolicy ?? record.source_name,
    record,
    requestedUses: record.requested_uses ?? connector.requestedUses ?? ["ingest", "persist_raw", "materialize", "normalize"],
    aiPolicyApproved: Boolean(record.ai_policy_approved ?? connector.aiPolicyApproved),
    legalApprovalId: record.legal_approval_id ?? connector.legalApprovalId ?? null
  });
  assertNoReleasedGraphWrite(record);
  const artifact = await rawArtifactStore.putArtifact({
    tenantId,
    environment,
    connectorId: connector.id ?? connector.connectorId,
    sourceName: record.source_name,
    sourceVersion: record.source_version,
    sourceRecordId: record.source_record_id,
    content: record.raw_artifact ?? record.raw_record ?? record.normalized_record ?? fetchedRecord,
    contentType: record.raw_artifact_content_type ?? "application/json",
    metadata: {
      source_record_uri: record.source_record_uri ?? null,
      source_retrieved_at: record.source_retrieved_at ?? null,
      connector_name: connector.name,
      connector_version: connector.version,
      parser_version: connector.parserVersion,
      normalization_ruleset_version: connector.normalizationRulesetVersion,
      retention_class: record.retention_class ?? null,
      license_classification: policyDecision.license_classification,
      materialization_policy: policyDecision.materialization_policy,
      raw_artifact_policy: policyDecision.raw_artifact_policy,
      source_version_strategy: policyDecision.source_version_strategy
    }
  });

  const normalized = connector.normalizeRecord
    ? await connector.normalizeRecord(record, { run, artifact })
    : record.normalized_record ?? {};

  const normalizedRecord = normalized?.normalized_record ?? normalized;
  const finalGovernance = {
    license_classification: normalized?.license_classification ?? normalizedRecord?.license_classification ?? record.license_classification,
    materialization_policy: normalized?.materialization_policy ?? normalizedRecord?.materialization_policy ?? record.materialization_policy,
    sensitivity_classification: normalized?.sensitivity_classification ?? normalizedRecord?.sensitivity_classification ?? record.sensitivity_classification,
    retention_class: normalized?.retention_class ?? normalizedRecord?.retention_class ?? record.retention_class,
    raw_artifact_policy: normalized?.raw_artifact_policy ?? normalizedRecord?.raw_artifact_policy ?? record.raw_artifact_policy,
    source_version_strategy: normalized?.source_version_strategy ?? normalizedRecord?.source_version_strategy ?? record.source_version_strategy,
    ai_use_policy: normalized?.ai_use_policy ?? normalizedRecord?.ai_use_policy ?? record.ai_use_policy,
    permitted_uses: normalized?.permitted_uses ?? normalizedRecord?.permitted_uses ?? record.permitted_uses,
    export_restrictions: normalized?.export_restrictions ?? normalizedRecord?.export_restrictions ?? record.export_restrictions,
    disclaimer_ids: normalized?.disclaimer_ids ?? normalizedRecord?.disclaimer_ids ?? record.disclaimer_ids,
    legal_approval_id: normalized?.legal_approval_id ?? normalizedRecord?.legal_approval_id ?? record.legal_approval_id
  };
  const output = {
    ...record,
    ...dropUndefined(finalGovernance),
    raw_artifact_uri: artifact.uri,
    record_hash: artifact.digest,
    normalized_record: normalizedRecord,
    normalization_handoff: normalized?.normalization_handoff ?? record.normalization_handoff ?? null,
    candidate_entities: normalized?.candidate_entities ?? record.candidate_entities ?? [],
    candidate_relationships: normalized?.candidate_relationships ?? record.candidate_relationships ?? [],
    candidate_mappings: normalized?.candidate_mappings ?? record.candidate_mappings ?? [],
    warnings: [...(record.warnings ?? []), ...(policyDecision.warnings ?? [])],
    idempotency_key: buildIdempotencyKey({
      tenantId,
      environment,
      connectorName: connector.name,
      connectorVersion: connector.version,
      sourceName: record.source_name,
      sourceVersion: record.source_version,
      sourceSnapshotDigest: connector.sourceSnapshotDigest,
      parserVersion: connector.parserVersion,
      normalizationRulesetVersion: connector.normalizationRulesetVersion,
      sourceRecordId: record.source_record_id
    }),
    provenance: {
      ...(record.provenance ?? {}),
      connector_name: connector.name,
      connector_version: connector.version,
      parser_version: connector.parserVersion,
      normalization_ruleset_version: connector.normalizationRulesetVersion,
      source_artifact_digest: artifact.digest,
      run_id: run.run_id,
      run_lineage_id: run.run_lineage_id,
      attempt: run.attempt
    }
  };
  assertNoReleasedGraphWrite(output);
  const finalPolicyDecision = assertIngestionPolicy({
    source: output.source_policy ?? connector.sourcePolicy ?? output.source_name,
    record: output,
    requestedUses: output.requested_uses ?? connector.requestedUses ?? ["ingest", "persist_raw", "materialize", "normalize"],
    aiPolicyApproved: Boolean(output.ai_policy_approved ?? connector.aiPolicyApproved),
    legalApprovalId: output.legal_approval_id ?? connector.legalApprovalId ?? null,
    finalObject: true
  });
  return {
    ...output,
    warnings: [...(output.warnings ?? []), ...(finalPolicyDecision.warnings ?? [])],
    policy_decision: finalPolicyDecision
  };
}

export function buildIdempotencyKey(components) {
  return stableDigest({
    tenant_id: components.tenantId,
    environment: components.environment,
    connector_name: components.connectorName,
    connector_version: components.connectorVersion,
    source_name: components.sourceName,
    source_version: components.sourceVersion,
    source_snapshot_digest: components.sourceSnapshotDigest,
    parser_version: components.parserVersion,
    normalization_ruleset_version: components.normalizationRulesetVersion,
    source_record_id: components.sourceRecordId
  });
}

export function buildCheckpointScopeDigest(run) {
  return stableDigest({
    tenant_id: run.tenant_id ?? null,
    environment: run.environment ?? null,
    service_account_id: run.service_account_id ?? null,
    connector_id: run.connector_id ?? null,
    connector_name: run.connector_name ?? null,
    connector_version: run.connector_version ?? null,
    source_name: run.source_name ?? null,
    source_version: run.source_version ?? null,
    source_snapshot_digest: run.source_snapshot_digest ?? null,
    license_policy_id: run.license_policy_id ?? null,
    run_lineage_id: run.run_lineage_id ?? run.run_id ?? null,
    checkpoint: run.checkpoint ?? null
  });
}

export function buildCheckpointBinding(run, {
  issuedAt = new Date(),
  expiresAt = new Date(issuedAt.getTime() + DEFAULT_CHECKPOINT_BINDING_TTL_MS),
  signingKey = DEFAULT_CHECKPOINT_SIGNING_KEY
} = {}) {
  const payload = {
    tenant_id: run.tenant_id ?? null,
    environment: run.environment ?? null,
    service_account_id: run.service_account_id ?? null,
    connector_id: run.connector_id ?? null,
    connector_version: run.connector_version ?? null,
    source_name: run.source_name ?? null,
    source_version: run.source_version ?? null,
    source_version_strategy: run.source_version_strategy ?? null,
    source_snapshot_digest: run.source_snapshot_digest ?? null,
    license_policy_id: run.license_policy_id ?? null,
    run_lineage_id: run.run_lineage_id ?? run.run_id ?? null,
    checkpoint_id: run.checkpoint ?? null,
    checkpoint_sequence: run.attempt ?? null,
    idempotency_key: run.last_idempotency_key ?? null,
    raw_artifact_prefix: artifactPrefix(run.artifact_uris?.[0] ?? null),
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    checkpoint_digest: stableDigest({ checkpoint: run.checkpoint ?? null }),
    correlation_id: run.correlation_id ?? null
  };
  return {
    ...payload,
    signature: signCheckpointBinding(payload, signingKey)
  };
}

export function verifyCheckpointBinding(previousRun, {
  signingKey = DEFAULT_CHECKPOINT_SIGNING_KEY,
  now = new Date()
} = {}) {
  const binding = previousRun.checkpoint_binding;
  if (!binding || typeof binding !== "object") {
    throw new IngestionBlockedError("retry scope checkpoint binding is required before replay");
  }
  const { signature, ...payload } = binding;
  if (!signature || signature !== signCheckpointBinding(payload, signingKey)) {
    throw new IngestionBlockedError("retry scope checkpoint binding signature mismatch");
  }
  if (Date.parse(binding.expires_at) <= now.getTime()) {
    throw new IngestionBlockedError("retry scope checkpoint binding expired");
  }
  const expectedDigest = stableDigest({ checkpoint: previousRun.checkpoint ?? null });
  if (binding.checkpoint_digest !== expectedDigest) {
    throw new IngestionBlockedError("retry scope checkpoint digest mismatch");
  }
  const checks = [
    ["tenant", binding.tenant_id, previousRun.tenant_id],
    ["environment", binding.environment, previousRun.environment],
    ["service-account", binding.service_account_id, previousRun.service_account_id],
    ["connector id", binding.connector_id, previousRun.connector_id],
    ["connector version", binding.connector_version, previousRun.connector_version],
    ["source name", binding.source_name, previousRun.source_name],
    ["source version", binding.source_version, previousRun.source_version],
    ["source snapshot", binding.source_snapshot_digest, previousRun.source_snapshot_digest],
    ["license policy", binding.license_policy_id, previousRun.license_policy_id],
    ["lineage", binding.run_lineage_id, previousRun.run_lineage_id ?? previousRun.run_id],
    ["checkpoint", binding.checkpoint_id, previousRun.checkpoint],
    ["attempt", binding.checkpoint_sequence, previousRun.attempt],
    ["idempotency", binding.idempotency_key, previousRun.last_idempotency_key],
    ["correlation", binding.correlation_id, previousRun.correlation_id]
  ];
  for (const [label, boundValue, runValue] of checks) {
    if (boundValue != null && runValue != null && boundValue !== runValue) {
      throw new IngestionBlockedError(`retry checkpoint binding mismatch for ${label}`);
    }
  }
  return true;
}

function signCheckpointBinding(payload, signingKey) {
  return stableDigest({
    checkpoint_binding_payload: payload,
    signing_key: signingKey
  });
}

function artifactPrefix(uri) {
  if (!uri || typeof uri !== "string") {
    return null;
  }
  return uri.replace(/\/[^/]*$/, "/");
}

export function assertNoReleasedGraphWrite(record) {
  for (const finding of findReleaseTargets(record)) {
    if (finding.kind === "release_graph") {
      throw new IngestionBlockedError(`ingestion cannot write or target released graphs at ${finding.path}: ${finding.value}`);
    }
    throw new IngestionBlockedError(`ingestion output cannot set release field ${finding.path}`);
  }
}

export function findReleaseTargets(value, path = "$", seen = new WeakSet()) {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);
  const findings = [];
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [rawKey, nested] of entries) {
    const key = String(rawKey);
    const nestedPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
    const normalizedKey = key.replace(/[_-]/g, "").toLowerCase();
    if (typeof nested === "string" && /^graph:tenant:[^:]+:release:/.test(nested)) {
      findings.push({ kind: "release_graph", path: nestedPath, value: nested });
    }
    if (nested != null && isBlockedReleaseField(normalizedKey)) {
      findings.push({ kind: "release_field", path: nestedPath, value: nested });
    }
    findings.push(...findReleaseTargets(nested, nestedPath, seen));
  }
  return findings;
}

function isBlockedReleaseField(normalizedKey) {
  return [
    "releaseid",
    "releasegraph",
    "targetrelease",
    "targetreleaseid",
    "targetreleasegraph",
    "releasecandidategraph"
  ].includes(normalizedKey);
}

function dropUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function normalizeFetchedRecord(record, connector) {
  return {
    source_name: connector.sourceName,
    source_version: connector.sourceVersion,
    source_record_uri: null,
    source_retrieved_at: new Date().toISOString(),
    ...record
  };
}

function assertConnector(connector) {
  if (!connector || typeof connector !== "object") {
    throw new Error("connector is required");
  }
  for (const field of ["name", "version", "sourceName", "sourceVersion", "sourceSnapshotDigest", "parserVersion", "normalizationRulesetVersion"]) {
    assertNonEmpty(connector[field], `connector.${field}`);
  }
  if (!connector.id && !connector.connectorId) {
    throw new Error("connector.id is required");
  }
  if (typeof connector.fetchRecords !== "function") {
    throw new Error("connector.fetchRecords is required");
  }
}

function assertUniversalFields(record) {
  for (const field of REQUIRED_OUTPUT_FIELDS) {
    assertNonEmpty(record[field], field);
  }
}

function assertNonEmpty(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
}

export function assertExecutionContext({ executionContext, job, connector, tenantId, environment }) {
  if (!executionContext) {
    return {};
  }
  for (const field of ["tenant_id", "environment", "service_account_id", "connector_id"]) {
    assertNonEmpty(executionContext[field], `executionContext.${field}`);
  }
  if (executionContext.tenant_id !== tenantId) {
    throw new Error("cross-tenant connector job claim denied");
  }
  if (executionContext.environment !== environment) {
    throw new Error("cross-environment connector job claim denied");
  }
  const connectorId = connector.id ?? connector.connectorId;
  if (executionContext.connector_id !== connectorId) {
    throw new Error("connector execution context does not match connector_id");
  }
  if (job) {
    if (job.tenant_id !== executionContext.tenant_id) {
      throw new Error("job claim denied: tenant_id does not match service-account context");
    }
    if (job.environment !== executionContext.environment) {
      throw new Error("job claim denied: environment does not match service-account context");
    }
    if (job.requested_by_service_account_id !== executionContext.service_account_id) {
      throw new Error("job claim denied: requested_by_service_account_id does not match service-account context");
    }
  }
  return { ...executionContext };
}

function connectorMetricLabels({ connector, tenantId, environment, attempt, securityContext = {} }) {
  return {
    tenant_id: tenantId,
    environment,
    service_account_id: securityContext.service_account_id ?? null,
    connector_id: connector.id ?? connector.connectorId,
    connector_name: connector.name,
    connector_version: connector.version,
    source_name: connector.sourceName,
    source_version: connector.sourceVersion,
    attempt
  };
}

function sourceFreshnessMs(outputs, completedAt) {
  const retrieved = outputs
    .map((output) => Date.parse(output.source_retrieved_at))
    .filter((timestamp) => Number.isFinite(timestamp));
  if (retrieved.length === 0) {
    return 0;
  }
  return Math.max(0, completedAt.getTime() - Math.max(...retrieved));
}

function redactReplayPayload(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  const { raw_artifact, raw_record, source_payload, ...rest } = record;
  return rest;
}
