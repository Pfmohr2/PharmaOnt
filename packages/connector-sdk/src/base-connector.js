import { randomUUID } from "node:crypto";
import { connectorLifecycleStates } from "./constants.js";
import { ConnectorPolicyError } from "./errors.js";
import { sha256, sha256Hex, stableStringify } from "./hash.js";
import { buildRunIdentity, validateConnectorMetadata } from "./metadata.js";
import { defaultRetryPolicy, withRetry } from "./retry.js";
import { assertConnectorFinalOutputPolicy, assertConnectorSourcePolicy, requireConnectorAction, validateExecutionContext } from "./security.js";
import {
  InMemoryCheckpointStore,
  InMemoryNormalizedRecordStore,
  InMemoryRawArtifactStore,
  checkpointKey
} from "./stores.js";

export class ConnectorBase {
  constructor({
    metadata,
    rawArtifactStore = new InMemoryRawArtifactStore(),
    checkpointStore = new InMemoryCheckpointStore(),
    normalizedRecordStore = new InMemoryNormalizedRecordStore(),
    retryPolicy = defaultRetryPolicy,
    policyEvaluator = undefined,
    clock = () => new Date()
  }) {
    validateConnectorMetadata(metadata);
    this.metadata = Object.freeze({ ...metadata });
    this.rawArtifactStore = rawArtifactStore;
    this.checkpointStore = checkpointStore;
    this.normalizedRecordStore = normalizedRecordStore;
    this.retryPolicy = retryPolicy;
    this.policyEvaluator = policyEvaluator;
    this.clock = clock;
  }

  async run({ execution_context, source_config = {}, cursor = null }) {
    const executionContext = validateExecutionContext(execution_context, this.metadata);
    const {
      tenant_id,
      environment,
      correlation_id
    } = executionContext;
    assertRunScope({ tenant_id, environment });
    requireConnectorAction(executionContext, "job.claim");
    requireConnectorAction(executionContext, "job.emit_event");
    requireConnectorAction(executionContext, "metric.write_tenant");
    requireConnectorAction(executionContext, "log.write_redacted");
    requireConnectorAction(executionContext, "connector.run");
    requireConnectorAction(executionContext, "source.read");
    const policyDecision = assertConnectorSourcePolicy({
      metadata: this.metadata,
      executionContext
    });
    const lifecycle = ["configured", "scheduled", "running"];
    const fetched = await withRetry(
      ({ attempt }) => this.fetch({ tenant_id, environment, source_config, cursor, attempt, correlation_id }),
      { retryPolicy: this.retryPolicy }
    );
    lifecycle.push("fetched");

    const rawContent = normalizeRawContent(fetched.raw);
    requireConnectorAction(
      executionContext,
      this.metadata.raw_artifact_policy === "pointer_only" ? "artifact.write_pointer" : "artifact.write_raw"
    );
    const rawArtifact = await this.rawArtifactStore.putIfAbsent({
      tenant_id,
      environment,
      source_name: this.metadata.source_name,
      source_version: this.metadata.source_version,
      content: rawContent,
      content_type: fetched.content_type ?? "application/json",
      metadata: {
        connector_name: this.metadata.connector_name,
        connector_id: executionContext.connector_id,
        connector_version: this.metadata.connector_version,
        service_account_id: executionContext.service_account_id,
        license_policy_id: executionContext.license_policy_id,
        parser_version: this.metadata.parser_version,
        source_uri: fetched.source_uri ?? null,
        fetched_at: this.clock().toISOString(),
        retention_class: this.metadata.retention_class,
        correlation_id
      }
    });
    lifecycle.push("raw_persisted");

    const runIdentity = buildRunIdentity({
      tenant_id,
      environment,
      metadata: this.metadata,
      source_snapshot_digest: rawArtifact.digest
    });
    const run_id = `run:${sha256Hex(runIdentity)}`;
    const checkpoint_key = checkpointKey(runIdentity);
    const previousCheckpoint = await this.checkpointStore.load(checkpoint_key);

    const parsed = await this.parse({ raw: rawContent, rawArtifact, tenant_id, environment, source_config });
    lifecycle.push("parsed");
    const sourceRecords = Array.isArray(parsed.records) ? parsed.records : [];
    const records = [];
    let emitted_count = 0;
    let duplicate_count = 0;
    let skipped_count = 0;

    for (const sourceRecord of sourceRecords) {
      if (shouldSkipRecord(sourceRecord, previousCheckpoint)) {
        skipped_count += 1;
        continue;
      }
      requireConnectorAction(executionContext, "record.write_normalized");
      requireConnectorAction(executionContext, "candidate.emit");
      const normalized = await this.normalizeRecord({
        sourceRecord,
        rawArtifact,
        tenant_id,
        environment,
        run_id,
        correlation_id,
        execution_context: executionContext,
        policyDecision
      });
      const output = buildUniversalOutput({
        tenant_id,
        environment,
        metadata: this.metadata,
        sourceRecord,
        normalized,
        rawArtifact,
        run_id,
        attempt_id: `attempt:${correlation_id}`,
        source_retrieved_at: this.clock().toISOString(),
        correlation_id,
        execution_context: executionContext
      });
      const finalPolicyDecision = assertConnectorFinalOutputPolicy({
        output,
        executionContext,
        policyEvaluator: this.policyEvaluator
      });
      output.policy_decision = finalPolicyDecision;
      const upsert = await this.normalizedRecordStore.upsert(output);
      if (upsert.created) {
        emitted_count += 1;
      } else {
        duplicate_count += 1;
      }
      records.push(upsert.record);
      await this.checkpointStore.save(checkpoint_key, {
        run_id,
        attempt_id: `attempt:${correlation_id}`,
        service_account_id: executionContext.service_account_id,
        connector_id: executionContext.connector_id,
        license_policy_id: executionContext.license_policy_id,
        source_cursor: parsed.next_cursor ?? fetched.next_cursor ?? cursor,
        last_raw_artifact_uri: rawArtifact.uri,
        last_successful_source_record_id: sourceRecord.source_record_id,
        counts: {
          parsed: sourceRecords.length,
          emitted: emitted_count,
          duplicates: duplicate_count,
          skipped: skipped_count
        },
        error_count: 0,
        last_failure_reason: null,
        updated_at: this.clock().toISOString()
      });
    }

    lifecycle.push("normalized", "validated", "completed");
    return {
      status: "completed",
      lifecycle,
      run_id,
      checkpoint_key,
      raw_artifact: rawArtifact,
      records,
      emitted_count,
      duplicate_count,
      skipped_count,
      checkpoint: await this.checkpointStore.load(checkpoint_key)
    };
  }

  async fetch() {
    throw new ConnectorPolicyError("connector must implement fetch()");
  }

  async parse() {
    throw new ConnectorPolicyError("connector must implement parse()");
  }

  async normalizeRecord() {
    throw new ConnectorPolicyError("connector must implement normalizeRecord()");
  }
}

export function buildUniversalOutput({
  tenant_id,
  environment,
  metadata,
  sourceRecord,
  normalized,
  rawArtifact,
  run_id,
  attempt_id,
  source_retrieved_at,
  correlation_id,
  execution_context
}) {
  const source_record_id = requireString(sourceRecord.source_record_id, "source_record_id");
  const normalized_record = normalized.normalized_record ?? {};
  const record_hash = sha256(normalized_record);
  const governance = buildGovernanceFields({ metadata, sourceRecord, normalized });
  const idempotency_key = sha256([
    tenant_id,
    environment,
    metadata.connector_name,
    metadata.connector_version,
    metadata.source_name,
    metadata.source_version,
    rawArtifact.digest,
    metadata.parser_version,
    metadata.normalization_ruleset_version,
    source_record_id
  ].join("|"));
  return {
    idempotency_key,
    tenant_id,
    environment,
    service_account_id: execution_context?.service_account_id ?? null,
    connector_id: execution_context?.connector_id ?? metadata.connector_name,
    license_policy_id: execution_context?.license_policy_id ?? null,
    source_name: metadata.source_name,
    source_version: metadata.source_version,
    source_version_strategy: metadata.source_version_strategy,
    source_record_id,
    source_record_uri: sourceRecord.source_record_uri ?? null,
    source_retrieved_at,
    license_classification: metadata.license_classification,
    materialization_policy: governance.materialization_policy,
    sensitivity_classification: governance.sensitivity_classification,
    retention_class: governance.retention_class,
    raw_artifact_policy: governance.raw_artifact_policy,
    ai_use_policy: governance.ai_use_policy,
    permitted_uses: governance.permitted_uses,
    export_restrictions: governance.export_restrictions,
    disclaimer_ids: governance.disclaimer_ids,
    legal_approval_id: governance.legal_approval_id,
    decisions: governance.decisions,
    evidence_flags: governance.evidence_flags,
    blocks: governance.blocks,
    raw_artifact_uri: rawArtifact.uri,
    record_hash,
    normalized_record,
    candidate_entities: normalized.candidate_entities ?? [],
    candidate_relationships: normalized.candidate_relationships ?? [],
    candidate_mappings: normalized.candidate_mappings ?? [],
    warnings: [...(sourceRecord.warnings ?? []), ...(normalized.warnings ?? [])],
    provenance: {
      connector_name: metadata.connector_name,
      connector_version: metadata.connector_version,
      parser_version: metadata.parser_version,
      normalization_ruleset_version: metadata.normalization_ruleset_version,
      source_artifact_digest: rawArtifact.digest,
      run_id,
      attempt_id,
      service_account_id: execution_context?.service_account_id ?? null,
      connector_id: execution_context?.connector_id ?? metadata.connector_name,
      license_policy_id: execution_context?.license_policy_id ?? null,
      retrieval_context: sourceRecord.retrieval_context ?? {},
      transform_version: metadata.normalization_ruleset_version,
      source_terms_uri: metadata.source_terms_uri ?? null,
      disclaimer_ids: governance.disclaimer_ids,
      correlation_id
    }
  };
}

function buildGovernanceFields({ metadata, sourceRecord, normalized }) {
  const policy = sourceRecord.policy ?? normalized.policy ?? {};
  const disclaimerIds = unique([
    ...(metadata.disclaimer_ids ?? []),
    ...(sourceRecord.disclaimer_ids ?? []),
    ...(normalized.disclaimer_ids ?? []),
    ...(policy.disclaimer_ids ?? [])
  ]);
  return {
    materialization_policy: policy.materialization_policy ?? metadata.materialization_policy,
    sensitivity_classification: policy.sensitivity_classification ?? metadata.sensitivity_classification,
    retention_class: policy.retention_class ?? metadata.retention_class,
    raw_artifact_policy: policy.raw_artifact_policy ?? metadata.raw_artifact_policy,
    ai_use_policy: policy.ai_use_policy ?? metadata.ai_use_policy,
    permitted_uses: policy.permitted_uses ?? metadata.permitted_uses ?? [],
    export_restrictions: policy.export_restrictions ?? metadata.export_restrictions ?? [],
    disclaimer_ids: disclaimerIds,
    legal_approval_id: policy.legal_approval_id ?? sourceRecord.legal_approval_id ?? metadata.legal_approval_id ?? null,
    decisions: policy.decisions ?? normalized.decisions ?? {},
    evidence_flags: {
      ...(policy.evidence_flags ?? {}),
      ...(normalized.evidence_flags ?? {}),
      disclaimer_ids: disclaimerIds
    },
    blocks: policy.blocks ?? normalized.blocks ?? []
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeRawContent(raw) {
  return typeof raw === "string" ? raw : stableStringify(raw);
}

function shouldSkipRecord(sourceRecord, checkpoint) {
  if (!checkpoint?.last_successful_source_record_id) {
    return false;
  }
  if (sourceRecord.resume_after_id === checkpoint.last_successful_source_record_id) {
    return false;
  }
  return sourceRecord.source_record_id === checkpoint.last_successful_source_record_id && sourceRecord.skip_when_checkpointed === true;
}

function assertRunScope({ tenant_id, environment }) {
  requireString(tenant_id, "tenant_id");
  requireString(environment, "environment");
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ConnectorPolicyError(`${fieldName} is required`);
  }
  return value;
}
