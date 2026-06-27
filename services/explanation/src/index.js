import { createHash } from "node:crypto";

export const EXPLANATION_SCHEMA_VERSION = "phase5.explanation.v1";
export const EVIDENCE_VIEWER_SCHEMA_VERSION = "phase5.evidence-viewer.v1";

export const ASSERTION_TYPES = Object.freeze([
  "asserted",
  "derived",
  "normalized",
  "model_suggested",
  "imported",
  "human_curated",
  "inferred",
  "deprecated",
  "administrative"
]);

const CAUSAL_TERMS = ["causal", "causes", "caused_by", "causation", "incidence", "prevalence", "risk_ratio", "relative_risk", "attributable", "product_fault"];
const FAERS_TERMS = ["faers", "openfda"];

export class ExplanationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ExplanationError";
    this.details = details;
  }
}

export class ExplanationEvidenceService {
  constructor({
    resolveAssertion,
    resolveEvidence,
    resolveProvenance,
    resolveMatchReasons,
    clock = () => new Date()
  } = {}) {
    this.resolveAssertion = requiredResolver(resolveAssertion, "resolveAssertion");
    this.resolveEvidence = requiredResolver(resolveEvidence, "resolveEvidence");
    this.resolveProvenance = requiredResolver(resolveProvenance, "resolveProvenance");
    this.resolveMatchReasons = requiredResolver(resolveMatchReasons, "resolveMatchReasons");
    this.clock = clock;
  }

  async explainSearchHit({ hit, tenant_id, environment, release_id = null } = {}) {
    const assertionId = hit?.assertion_id ?? hit?.mapping_id ?? hit?.relationship_id ?? hit?.entity_id ?? hit?.id;
    assertText(assertionId, "search hit assertion_id");
    const assertion = await this.loadAssertion({ assertion_id: assertionId, tenant_id, environment, release_id });
    const match_reasons = await this.loadMatchReasons({ hit, assertion, tenant_id, environment, release_id });
    if (match_reasons.length === 0) {
      throw new ExplanationError("search hit explanation requires authoritative match reasons", { assertion_id: assertionId });
    }
    const evidenceViewer = await this.evidenceForAssertion({ assertion_id: assertionId, tenant_id, environment, release_id, assertion });

    return {
      schema_version: EXPLANATION_SCHEMA_VERSION,
      generated_at: this.clock().toISOString(),
      tenant_id,
      environment,
      release_id: release_id ?? assertion.release_id ?? null,
      hit_id: hit?.hit_id ?? hit?.id ?? null,
      assertion: assertionSummary(assertion),
      why: {
        match_reasons,
        matched_fields: match_reasons.map((reason) => reason.matched_field).filter(Boolean),
        matched_synonyms: match_reasons.filter((reason) => reason.match_type === "synonym"),
        matched_mappings: match_reasons.filter((reason) => reason.match_type === "mapping")
      },
      evidence: evidenceViewer.evidence_objects,
      provenance_chain: evidenceViewer.provenance_chain,
      source_vocabulary_versions: sourceVocabularyVersions(assertion, evidenceViewer.evidence_objects, evidenceViewer.provenance_chain),
      governance_flags: governanceFlags(assertion, evidenceViewer.evidence_objects)
    };
  }

  async evidenceForAssertion({ assertion_id, tenant_id, environment, release_id = null, assertion = null } = {}) {
    assertText(assertion_id, "assertion_id");
    const resolvedAssertion = assertion ?? await this.loadAssertion({ assertion_id, tenant_id, environment, release_id });
    validateAssertionForExplainability(resolvedAssertion);
    assertScope(resolvedAssertion, { tenant_id, environment, release_id }, "assertion");

    const evidenceIds = evidenceIdsForAssertion(resolvedAssertion);
    if (evidenceIds.length === 0) {
      throw new ExplanationError("assertion explanation requires evidence_refs or evidence_ids", { assertion_id });
    }
    const evidence_objects = await Promise.all(evidenceIds.map((evidence_id) =>
      this.loadEvidence({ evidence_id, tenant_id, environment, release_id, assertion: resolvedAssertion })
    ));
    const provenanceIds = unique([
      resolvedAssertion.provenance_id,
      ...evidence_objects.map((evidence) => evidence.provenance_id)
    ].filter(Boolean));
    const provenance_chain = await Promise.all(provenanceIds.map((provenance_id) =>
      this.loadProvenance({ provenance_id, tenant_id, environment, release_id, assertion: resolvedAssertion })
    ));

    validateEvidenceAndProvenance(resolvedAssertion, evidence_objects, provenance_chain);

    return {
      schema_version: EVIDENCE_VIEWER_SCHEMA_VERSION,
      generated_at: this.clock().toISOString(),
      tenant_id,
      environment,
      release_id: release_id ?? resolvedAssertion.release_id ?? null,
      assertion: assertionSummary(resolvedAssertion),
      evidence_objects: evidence_objects.map(evidenceSummary),
      provenance_chain: provenance_chain.map(provenanceSummary),
      integrity_bindings: integrityBindings(resolvedAssertion, evidence_objects, provenance_chain),
      source_vocabulary_versions: sourceVocabularyVersions(resolvedAssertion, evidence_objects, provenance_chain),
      governance_flags: governanceFlags(resolvedAssertion, evidence_objects)
    };
  }

  async loadAssertion({ assertion_id, tenant_id, environment, release_id }) {
    const assertion = await this.resolveAssertion({ assertion_id, tenant_id, environment, release_id });
    if (!isObject(assertion)) {
      throw new ExplanationError("assertion resolver returned no authoritative assertion", { assertion_id });
    }
    return assertion;
  }

  async loadMatchReasons({ hit, assertion, tenant_id, environment, release_id }) {
    const reasons = await this.resolveMatchReasons({
      hit_id: hit?.hit_id ?? hit?.id ?? null,
      assertion_id: assertionId(assertion),
      tenant_id,
      environment,
      release_id
    });
    if (!Array.isArray(reasons)) {
      throw new ExplanationError("match reason resolver must return an array", { assertion_id: assertionId(assertion) });
    }
    return reasons.map((reason, index) => normalizeMatchReason(reason, index));
  }

  async loadEvidence({ evidence_id, tenant_id, environment, release_id }) {
    const evidence = await this.resolveEvidence({ evidence_id, tenant_id, environment, release_id });
    if (!isObject(evidence)) {
      throw new ExplanationError("evidence resolver returned no authoritative evidence", { evidence_id });
    }
    assertScope(evidence, { tenant_id, environment, release_id }, "evidence");
    return evidence;
  }

  async loadProvenance({ provenance_id, tenant_id, environment, release_id }) {
    const provenance = await this.resolveProvenance({ provenance_id, tenant_id, environment, release_id });
    if (!isObject(provenance)) {
      throw new ExplanationError("provenance resolver returned no authoritative provenance", { provenance_id });
    }
    assertScope(provenance, { tenant_id, environment, release_id }, "provenance");
    return provenance;
  }
}

export function buildExplanationService(resolvers) {
  return new ExplanationEvidenceService(resolvers);
}

function validateAssertionForExplainability(assertion) {
  const type = assertion.assertion_type;
  if (!ASSERTION_TYPES.includes(type)) {
    throw new ExplanationError("assertion_type must be resolved server-side and valid", { assertion_id: assertionId(assertion), assertion_type: type });
  }
  if (assertion.confidence_source === "fabricated" || assertion.confidence?.is_fabricated === true || assertion.fabricated_confidence === true) {
    throw new ExplanationError("fabricated confidence cannot be explained as trustworthy", { assertion_id: assertionId(assertion) });
  }
  if (assertion.release_id && type === "model_suggested") {
    throw new ExplanationError("model_suggested assertion cannot be shown as released or approved fact", { assertion_id: assertionId(assertion) });
  }
}

function validateEvidenceAndProvenance(assertion, evidenceObjects, provenanceChain) {
  if (provenanceChain.length === 0) {
    throw new ExplanationError("assertion explanation requires provenance chain", { assertion_id: assertionId(assertion) });
  }
  for (const evidence of evidenceObjects) {
    if (!hasText(evidence.source_name) || !hasText(evidence.source_version)) {
      throw new ExplanationError("evidence must include source_name and source_version", { evidence_id: evidence.evidence_id });
    }
    if (!hasText(evidence.record_hash) && !hasText(evidence.raw_artifact_uri) && !hasText(evidence.source_record_uri)) {
      throw new ExplanationError("evidence must include an integrity binding", { evidence_id: evidence.evidence_id });
    }
  }
  for (const provenance of provenanceChain) {
    if (!hasText(provenance.provenance_id)) {
      throw new ExplanationError("provenance object must include provenance_id");
    }
    const auditIds = provenance.audit_event_ids ?? provenance.audit_event_id ? [provenance.audit_event_id].filter(Boolean) : [];
    if (!Array.isArray(provenance.audit_event_ids) && auditIds.length === 0) {
      throw new ExplanationError("provenance object must include audit linkage", { provenance_id: provenance.provenance_id });
    }
  }
  if (usesFaers(evidenceObjects) && isCausalAssertion(assertion)) {
    throw new ExplanationError("FAERS/openFDA evidence cannot support causal explanation", { assertion_id: assertionId(assertion) });
  }
}

function normalizeMatchReason(reason, index) {
  if (!isObject(reason)) {
    throw new ExplanationError("match reason must be an object", { index });
  }
  assertText(reason.match_type, "match_reason.match_type");
  assertText(reason.matched_field, "match_reason.matched_field");
  return {
    match_reason_id: reason.match_reason_id ?? `match:${index + 1}`,
    match_type: reason.match_type,
    matched_field: reason.matched_field,
    matched_value: reason.matched_value ?? null,
    query_term: reason.query_term ?? null,
    source: reason.source ?? "search_index",
    score_contribution: typeof reason.score_contribution === "number" ? reason.score_contribution : null,
    mapping_id: reason.mapping_id ?? null,
    synonym_id: reason.synonym_id ?? null
  };
}

function assertionSummary(assertion) {
  return {
    assertion_id: assertionId(assertion),
    assertion_kind: assertion.assertion_kind ?? assertion.object_type ?? assertion.proposal_type ?? assertion.type ?? "assertion",
    assertion_type: assertion.assertion_type,
    subject_id: assertion.subject_id ?? assertion.subject ?? assertion.source_entity_id ?? null,
    predicate: assertion.predicate ?? null,
    object_id: assertion.object_id ?? assertion.object ?? assertion.target_entity_id ?? null,
    confidence_score: assertion.confidence_score ?? assertion.confidence?.score ?? null,
    confidence_band: assertion.confidence_band ?? assertion.confidence?.band ?? null,
    lifecycle_status: assertion.lifecycle_status ?? assertion.review_status ?? null,
    release_id: assertion.release_id ?? null
  };
}

function evidenceSummary(evidence) {
  return {
    evidence_id: evidence.evidence_id,
    evidence_type: evidence.evidence_type ?? null,
    evidence_role: evidence.evidence_role ?? null,
    source_name: evidence.source_name,
    source_version: evidence.source_version,
    source_record_id: evidence.source_record_id ?? null,
    source_record_uri: evidence.source_record_uri ?? null,
    raw_artifact_uri: evidence.raw_artifact_uri ?? null,
    record_hash: evidence.record_hash ?? null,
    text_spans: evidence.text_spans ?? [],
    snippet: evidence.snippet ?? null,
    disclaimer_ids: evidence.disclaimer_ids ?? [],
    source_limitations: evidence.source_limitations ?? [],
    license_classification: evidence.license_classification ?? null,
    materialization_policy: evidence.materialization_policy ?? null,
    access_control: evidence.access_control ?? null,
    provenance_id: evidence.provenance_id,
    release_id: evidence.release_id ?? null
  };
}

function provenanceSummary(provenance) {
  return {
    provenance_id: provenance.provenance_id,
    object_id: provenance.object_id ?? null,
    object_type: provenance.object_type ?? null,
    actor: provenance.actor ?? null,
    activity: provenance.activity ?? null,
    source: provenance.source ?? null,
    time: provenance.time ?? null,
    method: provenance.method ?? null,
    confidence: provenance.confidence ?? null,
    environment: provenance.environment ?? null,
    release: provenance.release ?? null,
    audit_event_ids: provenance.audit_event_ids ?? [provenance.audit_event_id].filter(Boolean)
  };
}

function integrityBindings(assertion, evidenceObjects, provenanceChain) {
  return {
    assertion_digest: digest(assertion),
    evidence_digests: Object.fromEntries(evidenceObjects.map((evidence) => [
      evidence.evidence_id,
      evidence.record_hash ?? digest(evidence)
    ])),
    provenance_digests: Object.fromEntries(provenanceChain.map((provenance) => [
      provenance.provenance_id,
      provenance.record_hash ?? digest(provenance)
    ])),
    audit_event_ids: unique(provenanceChain.flatMap((provenance) => provenance.audit_event_ids ?? [provenance.audit_event_id].filter(Boolean)))
  };
}

function sourceVocabularyVersions(assertion, evidenceObjects, provenanceChain) {
  return uniqueObjects([
    versionEntry(assertion.source_vocabulary ?? assertion.source_name, assertion.source_vocabulary_version ?? assertion.source_version, "assertion_source"),
    versionEntry(assertion.target_vocabulary, assertion.target_vocabulary_version, "assertion_target"),
    ...evidenceObjects.map((evidence) => versionEntry(evidence.source_name, evidence.source_version, "evidence")),
    ...provenanceChain.map((provenance) => versionEntry(provenance.source?.source_name ?? provenance.source_name, provenance.source?.source_version ?? provenance.source_version, "provenance"))
  ].filter(Boolean));
}

function governanceFlags(assertion, evidenceObjects) {
  return {
    assertion_type_visible: true,
    model_suggested_not_approved_fact: assertion.assertion_type === "model_suggested",
    faers_non_causal: usesFaers(evidenceObjects),
    requires_disclaimers: usesFaers(evidenceObjects) || evidenceObjects.some((evidence) => (evidence.disclaimer_ids ?? []).length > 0),
    disclaimer_ids: unique(evidenceObjects.flatMap((evidence) => evidence.disclaimer_ids ?? []))
  };
}

function assertScope(record, { tenant_id, environment, release_id }, label) {
  const recordTenant = record.tenant_id ?? record.access_control?.tenant_id ?? record.environment?.tenant_id;
  const recordEnvironment = record.environment?.environment ?? record.environment;
  const recordRelease = record.release_id ?? record.release?.release_id;
  if (hasText(tenant_id) && hasText(recordTenant) && recordTenant !== tenant_id) {
    throw new ExplanationError(`${label} tenant mismatch`, { expected: tenant_id, actual: recordTenant });
  }
  if (hasText(environment) && hasText(recordEnvironment) && recordEnvironment !== environment) {
    throw new ExplanationError(`${label} environment mismatch`, { expected: environment, actual: recordEnvironment });
  }
  if (hasText(release_id) && hasText(recordRelease) && recordRelease !== release_id) {
    throw new ExplanationError(`${label} release mismatch`, { expected: release_id, actual: recordRelease });
  }
}

function evidenceIdsForAssertion(assertion) {
  return unique([
    ...arrayOf(assertion.evidence_ids),
    ...arrayOf(assertion.evidence_refs).map((ref) => ref.evidence_id)
  ].filter(Boolean));
}

function assertionId(assertion) {
  return assertion.assertion_id ?? assertion.mapping_id ?? assertion.relationship_id ?? assertion.proposal_id ?? assertion.entity_id ?? assertion.id ?? null;
}

function isCausalAssertion(assertion) {
  const text = `${assertion.claim_type ?? ""} ${assertion.assertion_type ?? ""} ${assertion.predicate ?? ""} ${assertion.relationship_type ?? ""}`.toLowerCase();
  return CAUSAL_TERMS.some((term) => text.includes(term));
}

function usesFaers(evidenceObjects) {
  return evidenceObjects.some((evidence) => {
    const text = `${evidence.source_name ?? ""} ${arrayOf(evidence.disclaimer_ids).join(" ")} ${arrayOf(evidence.source_limitations).join(" ")}`.toLowerCase();
    return FAERS_TERMS.some((term) => text.includes(term));
  });
}

function versionEntry(source_name, source_version, role) {
  if (!hasText(source_name) || !hasText(source_version)) {
    return null;
  }
  return { source_name, source_version, role };
}

function uniqueObjects(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      output.push(value);
    }
  }
  return output;
}

function requiredResolver(fn, name) {
  if (typeof fn !== "function") {
    throw new ExplanationError(`${name} resolver is required`);
  }
  return fn;
}

function assertText(value, fieldName) {
  if (!hasText(value)) {
    throw new ExplanationError(`${fieldName} is required`);
  }
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortForJson(value))).digest("hex")}`;
}

function sortForJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortForJson(item)]));
  }
  return value;
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function unique(value) {
  return [...new Set(value)];
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
