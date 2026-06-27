import {
  licenseClassifications,
  materializationPolicies,
  requiredConnectorMetadataFields,
  sourceVersionStrategies
} from "./constants.js";
import { ConnectorPolicyError } from "./errors.js";

export function validateConnectorMetadata(metadata) {
  const errors = [];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ConnectorPolicyError("connector metadata must be an object");
  }
  for (const field of requiredConnectorMetadataFields) {
    if (metadata[field] === undefined || metadata[field] === null || metadata[field] === "") {
      errors.push(`missing connector metadata field: ${field}`);
    }
  }
  if (!licenseClassifications.includes(metadata.license_classification)) {
    errors.push(`invalid license_classification: ${metadata.license_classification}`);
  }
  if (!materializationPolicies.includes(metadata.materialization_policy)) {
    errors.push(`invalid materialization_policy: ${metadata.materialization_policy}`);
  }
  if (!sourceVersionStrategies.includes(metadata.source_version_strategy)) {
    errors.push(`invalid source_version_strategy: ${metadata.source_version_strategy}`);
  }
  for (const field of ["disclaimer_ids", "permitted_uses", "export_restrictions"]) {
    if (!Array.isArray(metadata[field])) {
      errors.push(`${field} must be an array`);
    }
  }
  if (metadata.license_classification === "blocked_pending_legal_review") {
    errors.push("blocked_pending_legal_review blocks connector execution");
  }
  if (metadata.materialization_policy === "block") {
    errors.push("materialization_policy block prevents connector execution");
  }
  if (errors.length > 0) {
    throw new ConnectorPolicyError(errors.join("; "));
  }
  return true;
}

export function buildRunIdentity({ tenant_id, environment, metadata, source_snapshot_digest }) {
  return {
    tenant_id,
    environment,
    connector_name: metadata.connector_name,
    connector_version: metadata.connector_version,
    source_name: metadata.source_name,
    source_version: metadata.source_version,
    source_snapshot_digest,
    parser_version: metadata.parser_version,
    normalization_ruleset_version: metadata.normalization_ruleset_version
  };
}
