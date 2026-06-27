export const connectorLifecycleStates = Object.freeze([
  "configured",
  "scheduled",
  "running",
  "fetched",
  "raw_persisted",
  "parsed",
  "normalized",
  "validated",
  "indexed",
  "completed",
  "failed_retryable",
  "failed_blocked",
  "deprecated"
]);

export const licenseClassifications = Object.freeze([
  "open_materializable",
  "open_with_attribution",
  "licensed_federated",
  "licensed_materializable_with_restrictions",
  "internal_confidential",
  "contains_phi_or_pii",
  "blocked_pending_legal_review"
]);

export const materializationPolicies = Object.freeze([
  "materialize",
  "federate",
  "stream",
  "redact_then_materialize",
  "block"
]);

export const sourceVersionStrategies = Object.freeze([
  "version",
  "release",
  "retrieval_timestamp",
  "snapshot_hash",
  "customer_schema_version"
]);

export const requiredConnectorMetadataFields = Object.freeze([
  "connector_name",
  "connector_version",
  "parser_version",
  "normalization_ruleset_version",
  "source_name",
  "source_version",
  "source_version_strategy",
  "license_classification",
  "materialization_policy",
  "sensitivity_classification",
  "retention_class",
  "raw_artifact_policy",
  "ai_use_policy",
  "disclaimer_ids",
  "permitted_uses",
  "export_restrictions"
]);
