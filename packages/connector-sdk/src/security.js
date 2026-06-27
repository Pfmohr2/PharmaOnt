import { assertIngestionPolicy } from "../../licensing/src/index.js";
import { ConnectorPolicyError } from "./errors.js";

export const connectorAllowedActions = Object.freeze([
  "connector.run",
  "source.read",
  "license.evaluate",
  "artifact.write_raw",
  "artifact.write_pointer",
  "record.write_normalized",
  "candidate.emit",
  "graph.write_working_candidate",
  "job.claim",
  "job.emit_event",
  "metric.write_tenant",
  "log.write_redacted"
]);

export const connectorForbiddenActions = Object.freeze([
  "cross_tenant.read",
  "cross_tenant.write",
  "graph.write_released",
  "graph.write_release_candidate",
  "governed.publish",
  "approval.approve",
  "release.stage",
  "release.promote",
  "release.rollback",
  "export.release_package",
  "audit.export",
  "rbac.manage_policy",
  "break_glass.activate",
  "*",
  "all",
  "admin"
]);

const requiredExecutionContextFields = Object.freeze([
  "tenant_id",
  "environment",
  "service_account_id",
  "connector_id",
  "connector_version",
  "source_name",
  "license_policy_id",
  "correlation_id"
]);

export function validateExecutionContext(executionContext, metadata) {
  if (!executionContext || typeof executionContext !== "object" || Array.isArray(executionContext)) {
    throw new ConnectorPolicyError("execution_context is required for connector SDK runs");
  }
  const errors = [];
  for (const field of requiredExecutionContextFields) {
    if (!executionContext[field]) {
      errors.push(`missing execution_context field: ${field}`);
    }
  }
  if (!executionContext.source_version && !executionContext.source_version_strategy) {
    errors.push("missing execution_context field: source_version or source_version_strategy");
  }
  if (metadata && executionContext.connector_version !== metadata.connector_version) {
    errors.push("execution_context connector_version must match connector metadata");
  }
  if (metadata && executionContext.source_name !== metadata.source_name) {
    errors.push("execution_context source_name must match connector metadata");
  }
  if (metadata?.source_version && executionContext.source_version && executionContext.source_version !== metadata.source_version) {
    errors.push("execution_context source_version must match connector metadata");
  }
  if (hasForbiddenAction(executionContext.allowed_actions ?? [])) {
    errors.push("execution_context allowed_actions contains connector-forbidden action");
  }
  if (errors.length > 0) {
    throw new ConnectorPolicyError(errors.join("; "));
  }
  return executionContext;
}

export function requireConnectorAction(executionContext, action) {
  if (connectorForbiddenActions.includes(action) || action.includes("*")) {
    throw new ConnectorPolicyError(`connector service account action is forbidden: ${action}`);
  }
  if (!connectorAllowedActions.includes(action)) {
    throw new ConnectorPolicyError(`connector service account action is not in the allowed SDK action set: ${action}`);
  }
  const granted = executionContext.allowed_actions;
  if (Array.isArray(granted) && granted.length > 0 && !granted.includes(action)) {
    throw new ConnectorPolicyError(`connector service account is not scoped for action: ${action}`);
  }
  return true;
}

export function assertConnectorSourcePolicy({ metadata, executionContext, requestedUses = ["ingest", "normalize", "persist_raw"] }) {
  requireConnectorAction(executionContext, "license.evaluate");
  return assertIngestionPolicy({
    source: {
      source_name: metadata.source_name,
      license_classification: metadata.license_classification,
      materialization_policy: metadata.materialization_policy,
      sensitivity_classification: metadata.sensitivity_classification,
      retention_class: metadata.retention_class,
      raw_artifact_policy: metadata.raw_artifact_policy,
      source_version_strategy: metadata.source_version_strategy,
      ai_use_policy: metadata.ai_use_policy,
      permitted_uses: metadata.permitted_uses,
      export_restrictions: metadata.export_restrictions,
      disclaimer_ids: metadata.disclaimer_ids,
      legal_approval_id: metadata.legal_approval_id ?? null
    },
    requestedUses,
    legalApprovalId: metadata.legal_approval_id ?? null
  });
}

export function assertConnectorFinalOutputPolicy({
  output,
  executionContext,
  policyEvaluator = assertIngestionPolicy,
  requestedUses = ["ingest", "normalize", "persist_raw"]
}) {
  requireConnectorAction(executionContext, "license.evaluate");
  assertNoReleaseTarget(output);
  return policyEvaluator({
    source: {
      source_name: output.source_name,
      license_classification: output.license_classification,
      materialization_policy: output.materialization_policy,
      sensitivity_classification: output.sensitivity_classification,
      retention_class: output.retention_class,
      raw_artifact_policy: output.raw_artifact_policy,
      source_version_strategy: output.source_version_strategy,
      ai_use_policy: output.ai_use_policy,
      permitted_uses: output.permitted_uses,
      export_restrictions: output.export_restrictions,
      disclaimer_ids: output.disclaimer_ids,
      legal_approval_id: output.legal_approval_id
    },
    record: output,
    requestedUses,
    legalApprovalId: output.legal_approval_id ?? null
  });
}

export function assertNoReleaseTarget(output) {
  for (const finding of findReleaseTargets(output)) {
    if (finding.kind === "release_graph") {
      throw new ConnectorPolicyError(`connector SDK output cannot target release graphs at ${finding.path}: ${finding.value}`);
    }
    throw new ConnectorPolicyError(`connector SDK output cannot set release field ${finding.path}`);
  }
  return true;
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

function hasForbiddenAction(actions) {
  return actions.some((action) => connectorForbiddenActions.includes(action) || String(action).includes("*"));
}
