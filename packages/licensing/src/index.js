export const LICENSE_CLASSIFICATIONS = Object.freeze([
  "open_materializable",
  "open_with_attribution",
  "licensed_federated",
  "licensed_materializable_with_restrictions",
  "internal_confidential",
  "contains_phi_or_pii",
  "blocked_pending_legal_review"
]);

export const MATERIALIZATION_POLICIES = Object.freeze([
  "materialize",
  "federate",
  "stream",
  "redact_then_materialize",
  "block"
]);

export const AI_USE_POLICIES = Object.freeze([
  "allowed",
  "allowed_with_attribution",
  "deidentified_only",
  "private_approved_only",
  "prohibited"
]);

export const FAERS_NON_CAUSAL_DISCLAIMER_ID = "source_limit:faers_non_causal";

export class PolicyViolation extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PolicyViolation";
    this.details = details;
  }
}

const BASE_PUBLIC_ATTRIBUTION = Object.freeze({
  license_classification: "open_with_attribution",
  materialization_policy: "materialize",
  sensitivity_classification: "public",
  retention_class: "public_source_snapshot",
  raw_artifact_policy: "persist",
  source_version_strategy: "retrieval_timestamp",
  ai_use_policy: "allowed_with_attribution",
  permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
  export_restrictions: ["attribution_required"]
});

export const DEFAULT_SOURCE_POLICIES = Object.freeze({
  clinicaltrials_gov: Object.freeze({
    ...BASE_PUBLIC_ATTRIBUTION,
    source_name: "ClinicalTrials.gov",
    disclaimer_ids: ["source_limit:clinicaltrials_registry_context"]
  }),
  pubmed_europe_pmc: Object.freeze({
    ...BASE_PUBLIC_ATTRIBUTION,
    source_name: "PubMed / Europe PMC",
    disclaimer_ids: ["source_limit:publication_context"],
    export_restrictions: ["attribution_required", "full_text_license_required"]
  }),
  chembl: Object.freeze({
    ...BASE_PUBLIC_ATTRIBUTION,
    source_name: "ChEMBL",
    source_version_strategy: "release",
    disclaimer_ids: ["source_terms:chembl"]
  }),
  uniprot: Object.freeze({
    ...BASE_PUBLIC_ATTRIBUTION,
    source_name: "UniProt",
    source_version_strategy: "release",
    disclaimer_ids: ["source_terms:uniprot", "source_limit:reviewed_status"]
  }),
  openfda_faers: Object.freeze({
    ...BASE_PUBLIC_ATTRIBUTION,
    source_name: "openFDA FAERS",
    disclaimer_ids: [FAERS_NON_CAUSAL_DISCLAIMER_ID],
    export_restrictions: ["attribution_required", "non_causal_warning_required"]
  }),
  internal_source_template: Object.freeze({
    source_name: "Internal source template",
    license_classification: "internal_confidential",
    materialization_policy: "stream",
    sensitivity_classification: "internal_confidential",
    retention_class: "internal_confidential",
    raw_artifact_policy: "pointer_only",
    source_version_strategy: "customer_schema_version",
    ai_use_policy: "prohibited",
    permitted_uses: ["ingest", "normalize", "curate", "evidence"],
    export_restrictions: ["tenant_only", "customer_approval_required"],
    disclaimer_ids: ["source_limit:tenant_confidential"],
    legal_approval_id: null
  }),
  meddra: Object.freeze({
    source_name: "MedDRA",
    license_classification: "licensed_federated",
    materialization_policy: "federate",
    sensitivity_classification: "licensed",
    retention_class: "restricted_source_snapshot",
    raw_artifact_policy: "pointer_only",
    source_version_strategy: "version",
    ai_use_policy: "prohibited",
    permitted_uses: ["ingest", "normalize", "curate", "evidence"],
    export_restrictions: ["no_redistribution", "tenant_license_required"],
    disclaimer_ids: ["source_terms:meddra"],
    legal_approval_id: null
  }),
  snomed_ct: Object.freeze({
    source_name: "SNOMED CT",
    license_classification: "licensed_federated",
    materialization_policy: "federate",
    sensitivity_classification: "licensed",
    retention_class: "restricted_source_snapshot",
    raw_artifact_policy: "pointer_only",
    source_version_strategy: "version",
    ai_use_policy: "prohibited",
    permitted_uses: ["ingest", "normalize", "curate", "evidence"],
    export_restrictions: ["no_redistribution", "tenant_license_required"],
    disclaimer_ids: ["source_terms:snomed_ct"],
    legal_approval_id: null
  })
});

const SOURCE_ALIASES = Object.freeze({
  "clinicaltrials.gov": "clinicaltrials_gov",
  "clinicaltrialsgov": "clinicaltrials_gov",
  "pubmed/europepmc": "pubmed_europe_pmc",
  "pubmed / europe pmc": "pubmed_europe_pmc",
  "pubmed": "pubmed_europe_pmc",
  "europe pmc": "pubmed_europe_pmc",
  "chembl": "chembl",
  "uniprot": "uniprot",
  "openfda faers": "openfda_faers",
  "openfda_faers": "openfda_faers",
  "faers": "openfda_faers",
  "internal source template": "internal_source_template",
  "internal_template": "internal_source_template",
  "meddra": "meddra",
  "snomed ct": "snomed_ct",
  "snomed_ct": "snomed_ct"
});

export function getSourcePolicy(source) {
  if (typeof source === "string") {
    const key = sourceKey(source);
    const policy = DEFAULT_SOURCE_POLICIES[key];
    if (!policy) {
      return {
        source_name: source,
        license_classification: "blocked_pending_legal_review",
        materialization_policy: "block",
        sensitivity_classification: "unknown",
        retention_class: "blocked_no_retention",
        raw_artifact_policy: "no_persist",
        source_version_strategy: null,
        ai_use_policy: "prohibited",
        permitted_uses: [],
        export_restrictions: ["blocked_pending_legal_review"],
        disclaimer_ids: []
      };
    }
    return { ...policy };
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {
      source_name: "unknown",
      license_classification: "blocked_pending_legal_review",
      materialization_policy: "block",
      sensitivity_classification: "unknown",
      retention_class: "blocked_no_retention",
      raw_artifact_policy: "no_persist",
      source_version_strategy: null,
      ai_use_policy: "prohibited",
      permitted_uses: [],
      export_restrictions: ["blocked_pending_legal_review"],
      disclaimer_ids: []
    };
  }
  return { ...source };
}

export function evaluateLicensePolicy({
  source,
  record = {},
  requestedUses = ["ingest", "normalize"],
  aiPolicyApproved = false,
  legalApprovalId = null,
  finalObject = false
}) {
  const policy = normalizePolicy(getSourcePolicy(source), record, legalApprovalId);
  const requested = new Set(requestedUses);
  const finalObjectCheck = Boolean(finalObject || requested.has("finalize") || requested.has("emit") || isFinalEmittedRecord(record));
  const blocks = [];
  const warnings = [];

  if (!LICENSE_CLASSIFICATIONS.includes(policy.license_classification)) {
    blocks.push("missing or unknown license_classification");
  }
  if (!MATERIALIZATION_POLICIES.includes(policy.materialization_policy)) {
    blocks.push("missing or unknown materialization_policy");
  }
  if (!policy.retention_class) {
    blocks.push("missing retention_class");
  }
  if (!policy.source_version_strategy) {
    blocks.push("missing source_version_strategy");
  }

  const containsPhiOrPii = recordContainsPhiOrPii(record) ||
    policy.license_classification === "contains_phi_or_pii" ||
    policy.sensitivity_classification === "phi_pii";

  if (policy.license_classification === "blocked_pending_legal_review" || policy.materialization_policy === "block") {
    blocks.push("source is blocked pending legal review or policy block");
  }

  const federateOnly = policy.license_classification === "licensed_federated" ||
    policy.materialization_policy === "federate" ||
    policy.raw_artifact_policy === "pointer_only";

  const materializationRequested = requested.has("materialize") ||
    requested.has("persist_raw") ||
    requested.has("raw_persist") ||
    requested.has("release");

  if (federateOnly && materializationRequested) {
    blocks.push("federated or pointer-only source cannot be materialized");
  }

  if (policy.license_classification === "licensed_materializable_with_restrictions" && materializationRequested && !policy.legal_approval_id) {
    blocks.push("restricted licensed materialization requires legal_approval_id");
  }

  if (containsPhiOrPii && materializationRequested && !["redact_then_materialize", "stream", "federate"].includes(policy.materialization_policy)) {
    blocks.push("PHI/PII source requires redaction, streaming, federation, or explicit block policy before materialization");
  }

  const aiRequested = requested.has("ai") || requested.has("embedding") || requested.has("model");
  const aiAllowedByPolicy = ["allowed", "allowed_with_attribution"].includes(policy.ai_use_policy) ||
    (policy.ai_use_policy === "deidentified_only" && Boolean(record.deidentified || record.redacted)) ||
    (policy.ai_use_policy === "private_approved_only" && aiPolicyApproved);

  if (aiRequested && (!aiAllowedByPolicy || (containsPhiOrPii && !aiPolicyApproved))) {
    blocks.push("source is not eligible for requested AI processing");
  }

  const exportRequested = requested.has("export");
  if (exportRequested && !policy.permitted_uses.includes("export")) {
    blocks.push("source is not export eligible");
  }

  const releaseRequested = requested.has("release");
  if (releaseRequested && !policy.permitted_uses.includes("release")) {
    blocks.push("source is not release eligible");
  }

  const isFaers = isFaersPolicy(policy);
  const recordDisclaimers = recordDisclaimerIds(record);
  const disclaimerIds = unique([
    ...policy.disclaimer_ids,
    ...recordDisclaimers,
    ...(isFaers ? [FAERS_NON_CAUSAL_DISCLAIMER_ID] : [])
  ]);
  if (isFaers) {
    warnings.push("FAERS/openFDA evidence is non-causal and cannot support causation, incidence, prevalence, comparative risk, or product fault by itself.");
    if (finalObjectCheck && !recordDisclaimers.includes(FAERS_NON_CAUSAL_DISCLAIMER_ID)) {
      blocks.push("final FAERS/openFDA object is missing required non-causal disclaimer");
    }
  }

  const allowedUses = policy.permitted_uses.filter((use) => {
    if (use === "export" && blocks.includes("source is not export eligible")) return false;
    if (use === "release" && blocks.includes("source is not release eligible")) return false;
    return true;
  });

  return {
    source_name: policy.source_name,
    license_classification: policy.license_classification,
    materialization_policy: policy.materialization_policy,
    sensitivity_classification: containsPhiOrPii ? "phi_pii" : policy.sensitivity_classification,
    retention_class: policy.retention_class,
    raw_artifact_policy: policy.raw_artifact_policy,
    source_version_strategy: policy.source_version_strategy,
    ai_use_policy: policy.ai_use_policy,
    permitted_uses: allowedUses,
    export_restrictions: policy.export_restrictions,
    disclaimer_ids: disclaimerIds,
    legal_approval_id: policy.legal_approval_id,
    decisions: {
      ingest: blocks.length === 0 && policy.permitted_uses.includes("ingest"),
      normalize: blocks.length === 0 && policy.permitted_uses.includes("normalize"),
      materialize: blocks.length === 0 && ["materialize", "redact_then_materialize"].includes(policy.materialization_policy),
      federate_only: federateOnly,
      ai_eligible: aiAllowedByPolicy && !(containsPhiOrPii && !aiPolicyApproved),
      export_eligible: policy.permitted_uses.includes("export") && !policy.export_restrictions.includes("no_redistribution"),
      release_eligible: policy.permitted_uses.includes("release"),
      contains_phi_or_pii: containsPhiOrPii,
      requires_non_causal_disclaimer: isFaers
    },
    final_object_evaluated: finalObjectCheck,
    evidence_flags: {
      disclaimer_ids: disclaimerIds,
      non_causal_warning_required: isFaers,
      supports_causal_claims: !isFaers
    },
    warnings,
    blocks
  };
}

export function assertIngestionPolicy(input) {
  const result = evaluateLicensePolicy(input);
  if (result.blocks.length > 0) {
    throw new PolicyViolation(`ingestion policy blocked: ${result.blocks.join("; ")}`, result);
  }
  return result;
}

function normalizePolicy(policy, record, legalApprovalId) {
  return {
    source_name: policy.source_name ?? record.source_name ?? "unknown",
    license_classification: record.license_classification ?? policy.license_classification,
    materialization_policy: record.materialization_policy ?? policy.materialization_policy,
    sensitivity_classification: record.sensitivity_classification ?? record.data_sensitivity ?? policy.sensitivity_classification ?? "unknown",
    retention_class: record.retention_class ?? policy.retention_class,
    raw_artifact_policy: record.raw_artifact_policy ?? policy.raw_artifact_policy,
    source_version_strategy: record.source_version_strategy ?? policy.source_version_strategy,
    ai_use_policy: record.ai_use_policy ?? policy.ai_use_policy ?? "prohibited",
    permitted_uses: arrayOrEmpty(record.permitted_uses ?? policy.permitted_uses),
    export_restrictions: arrayOrEmpty(record.export_restrictions ?? policy.export_restrictions),
    disclaimer_ids: arrayOrEmpty(record.disclaimer_ids ?? policy.disclaimer_ids),
    legal_approval_id: legalApprovalId ?? record.legal_approval_id ?? policy.legal_approval_id ?? null
  };
}

function recordContainsPhiOrPii(record) {
  return Boolean(
    record?.contains_phi_or_pii ||
    record?.phi_pii_detected ||
    record?.has_phi ||
    record?.has_pii ||
    record?.sensitivity_classification === "phi_pii" ||
    record?.data_sensitivity === "phi_pii" ||
    record?.normalized_record?.contains_phi_or_pii ||
    record?.normalized_record?.phi_pii_detected
  );
}

function isFinalEmittedRecord(record) {
  return Boolean(
    record?.policy_decision ||
    record?.normalized_record ||
    Array.isArray(record?.candidate_entities) ||
    Array.isArray(record?.candidate_relationships) ||
    Array.isArray(record?.candidate_mappings)
  );
}

function recordDisclaimerIds(record) {
  return unique([
    ...arrayOrEmpty(record?.disclaimer_ids),
    ...arrayOrEmpty(record?.normalized_record?.disclaimer_ids),
    ...arrayOrEmpty(record?.evidence_flags?.disclaimer_ids),
    ...arrayOrEmpty(record?.policy_decision?.disclaimer_ids),
    ...disclaimerIdsFromArray(record?.candidate_entities),
    ...disclaimerIdsFromArray(record?.candidate_relationships),
    ...disclaimerIdsFromArray(record?.candidate_mappings),
    ...disclaimerIdsFromArray(record?.evidence_refs)
  ]);
}

function disclaimerIdsFromArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.flatMap((value) => arrayOrEmpty(value?.disclaimer_ids));
}

function isFaersPolicy(policy) {
  const name = String(policy.source_name ?? "").toLowerCase();
  return name.includes("faers") || name.includes("openfda");
}

function sourceKey(value) {
  const normalized = String(value).trim().toLowerCase();
  return SOURCE_ALIASES[normalized] ?? normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? [...value] : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
