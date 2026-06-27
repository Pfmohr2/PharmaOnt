import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SUGGESTION_SCHEMA_VERSION = "ai-suggestion-candidate.v1";

export const SUGGESTION_TYPES = Object.freeze([
  "document_entity_extraction",
  "entity_linking",
  "synonym",
  "relationship",
  "duplicate"
]);

const CAUSAL_TERMS = ["causal", "causes", "caused_by", "causation", "incidence", "prevalence", "risk_ratio", "relative_risk", "attributable", "product_fault"];
const FAERS_TERMS = ["faers", "openfda"];
const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../schemas/suggestion-candidate.schema.json");

export const suggestionCandidateSchema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

export class AiCurationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AiCurationError";
    this.details = details;
  }
}

export class AiCurationEngine {
  constructor({
    model,
    calibration,
    clock = () => new Date()
  } = {}) {
    this.model = normalizeModel(model);
    this.calibration = normalizeCalibration(calibration);
    this.clock = clock;
  }

  extractDocumentEntities({ tenant_id, environment = "working", document, entities = [] } = {}) {
    assertText(tenant_id, "tenant_id");
    const source = sourceFrom(document);
    if (!Array.isArray(entities) || entities.length === 0) {
      throw new AiCurationError("document entity extraction requires at least one entity candidate");
    }
    return entities.map((entity) => this.buildCandidate({
      tenant_id,
      environment,
      suggestion_type: "document_entity_extraction",
      source,
      score: entity.score,
      candidate_payload: {
        document_id: document.document_id ?? source.source_record_id,
        mention_id: entity.mention_id ?? `mention:${digest({ source, text: entity.text, start: entity.start_offset })}`,
        entity_text: entity.text,
        entity_class: entity.entity_class,
        normalized_text: entity.normalized_text ?? normalizeText(entity.text)
      },
      evidence_refs: entity.evidence_refs,
      source_spans: [spanFrom(entity, source)]
    }));
  }

  suggestEntityLinks({ tenant_id, environment = "working", mention, candidates = [] } = {}) {
    assertText(tenant_id, "tenant_id");
    const source = sourceFrom(mention);
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new AiCurationError("entity linking requires at least one candidate canonical link");
    }
    return candidates.map((candidate) => this.buildCandidate({
      tenant_id,
      environment,
      suggestion_type: "entity_linking",
      source,
      score: candidate.score,
      candidate_payload: {
        mention_id: mention.mention_id,
        entity_text: mention.text ?? mention.entity_text,
        entity_class: mention.entity_class,
        candidate_canonical_id: candidate.canonical_id,
        candidate_label: candidate.label,
        match_features: candidate.match_features ?? []
      },
      evidence_refs: candidate.evidence_refs ?? mention.evidence_refs,
      source_spans: candidate.source_spans ?? [spanFrom(mention, source)]
    }));
  }

  suggestSynonyms({ tenant_id, environment = "working", entity, synonyms = [] } = {}) {
    assertText(tenant_id, "tenant_id");
    const source = sourceFrom(entity);
    assertText(entity?.entity_id, "entity.entity_id");
    if (!Array.isArray(synonyms) || synonyms.length === 0) {
      throw new AiCurationError("synonym suggestions require at least one synonym");
    }
    return synonyms.map((synonym) => this.buildCandidate({
      tenant_id,
      environment,
      suggestion_type: "synonym",
      source,
      score: synonym.score,
      candidate_payload: {
        entity_id: entity.entity_id,
        canonical_label: entity.label,
        synonym: synonym.text,
        language: synonym.language ?? "en",
        synonym_type: synonym.synonym_type ?? "alias"
      },
      evidence_refs: synonym.evidence_refs ?? entity.evidence_refs,
      source_spans: synonym.source_spans ?? [spanFrom(synonym, source)]
    }));
  }

  suggestRelationships({ tenant_id, environment = "working", relationships = [] } = {}) {
    assertText(tenant_id, "tenant_id");
    if (!Array.isArray(relationships) || relationships.length === 0) {
      throw new AiCurationError("relationship suggestions require at least one relationship");
    }
    return relationships.map((relationship) => {
      const source = sourceFrom(relationship);
      if (usesFaers(source, relationship.evidence_refs) && isCausal(relationship)) {
        throw new AiCurationError("FAERS/openFDA suggestions cannot assert causal relationships", {
          subject_id: relationship.subject_id,
          predicate: relationship.predicate,
          object_id: relationship.object_id
        });
      }
      return this.buildCandidate({
        tenant_id,
        environment,
        suggestion_type: "relationship",
        source,
        score: relationship.score,
        candidate_payload: {
          subject_id: relationship.subject_id,
          predicate: relationship.predicate,
          object_id: relationship.object_id,
          relationship_type: relationship.relationship_type ?? relationship.predicate,
          claim_type: relationship.claim_type ?? "association"
        },
        evidence_refs: relationship.evidence_refs,
        source_spans: relationship.source_spans ?? [spanFrom(relationship, source)]
      });
    });
  }

  suggestDuplicates({ tenant_id, environment = "working", duplicate_pairs = [] } = {}) {
    assertText(tenant_id, "tenant_id");
    if (!Array.isArray(duplicate_pairs) || duplicate_pairs.length === 0) {
      throw new AiCurationError("duplicate suggestions require at least one duplicate pair");
    }
    return duplicate_pairs.map((pair) => {
      const source = sourceFrom(pair);
      return this.buildCandidate({
        tenant_id,
        environment,
        suggestion_type: "duplicate",
        source,
        score: pair.score,
        candidate_payload: {
          entity_id: pair.entity_id,
          duplicate_entity_id: pair.duplicate_entity_id,
          duplicate_action: "flag_only",
          merge_allowed: false,
          match_features: pair.match_features ?? []
        },
        evidence_refs: pair.evidence_refs,
        source_spans: pair.source_spans ?? [spanFrom(pair, source)]
      });
    });
  }

  buildCandidate({ tenant_id, environment, suggestion_type, source, score, candidate_payload, evidence_refs, source_spans }) {
    if (!SUGGESTION_TYPES.includes(suggestion_type)) {
      throw new AiCurationError("unknown suggestion_type", { suggestion_type });
    }
    assertScore(score);
    const spans = normalizeSourceSpans(source_spans, source);
    const evidence = normalizeEvidenceRefs(evidence_refs, source, spans);
    const workflowSpans = spans.map((span) => ({
      ...span,
      evidence_id: span.evidence_id ?? evidence[0].evidence_id,
      source_id: span.source_record_id,
      document_id: span.source_record_id
    }));
    const now = this.clock().toISOString();
    const candidate_id = `aisug:${digest({ tenant_id, environment, suggestion_type, candidate_payload, score, evidence, workflowSpans })}`;
    const provenance_id = `pharmprov:${digest({ candidate_id, activity: "ai_suggestion_generation" })}`;
    const faersContext = usesFaers(source, evidence);
    const workflowPayload = {
      ...candidate_payload,
      assertion_type: "model_suggested",
      evidence_refs: evidence,
      source_spans: workflowSpans
    };
    const candidate = {
      schema_version: SUGGESTION_SCHEMA_VERSION,
      candidate_id,
      suggestion_id: candidate_id,
      tenant_id,
      environment,
      release_id: null,
      suggestion_type,
      proposal_type: proposalTypeForSuggestion(suggestion_type),
      assertion_type: "model_suggested",
      lifecycle_status: "proposed",
      review_status: "proposed",
      candidate_payload,
      payload: workflowPayload,
      score,
      confidence_score: score,
      confidence_band: confidenceFor(score, this.calibration).band,
      confidence_source: "model_calibrated_score",
      confidence: confidenceFor(score, this.calibration),
      model: this.model,
      model_name: this.model.model_id,
      model_version: this.model.model_version,
      prompt_version: this.model.prompt_version,
      evidence_refs: evidence,
      source_spans: workflowSpans,
      provenance_id,
      provenance: {
        provenance_id,
        model_name: this.model.model_id,
        model_version: this.model.model_version,
        evidence_refs: evidence,
        source_spans: workflowSpans,
        actor: `model:${this.model.model_id}`,
        activity: "ai_suggestion_generation",
        method: "ai-curation-candidate-generation",
        source: {
          source_name: source.source_name,
          source_version: source.source_version
        },
        time: now,
        audit_event_id: `audit:${digest({ candidate_id, now })}`
      },
      governance: {
        auto_publish: false,
        requires_human_review: true,
        release_eligible: false,
        released_graph_target: null,
        visual_state: "ai_suggestion_distinct",
        approval_state: "unapproved",
        duplicate_policy: suggestion_type === "duplicate" ? "flag_only_never_merge" : "not_applicable"
      },
      safety: {
        faers_context: faersContext,
        causality_allowed: !faersContext,
        faers_causal_blocked: faersContext
      },
      duplicate_status: duplicateStatusForSuggestion(suggestion_type),
      rationale: `AI-generated ${suggestion_type} candidate requires governed human review before use.`,
      created_at: now,
      created_by: "service:ai-curation"
    };
    assertSuggestionCandidate(candidate);
    return candidate;
  }
}

export function validateSuggestionCandidate(candidate) {
  const errors = [];
  if (!isObject(candidate)) {
    return { valid: false, errors: ["candidate must be an object"] };
  }
  requireEqual(candidate.schema_version, SUGGESTION_SCHEMA_VERSION, "schema_version", errors);
  requireText(candidate.candidate_id, "candidate_id", errors);
  requireText(candidate.suggestion_id, "suggestion_id", errors);
  requireEqual(candidate.suggestion_id, candidate.candidate_id, "suggestion_id", errors);
  requireText(candidate.tenant_id, "tenant_id", errors);
  requireText(candidate.environment, "environment", errors);
  requireEqual(candidate.release_id, null, "release_id", errors);
  requireOneOf(candidate.suggestion_type, SUGGESTION_TYPES, "suggestion_type", errors);
  requireOneOf(candidate.proposal_type, ["synonym", "mapping", "relationship", "evidence-link"], "proposal_type", errors);
  requireEqual(candidate.assertion_type, "model_suggested", "assertion_type", errors);
  requireEqual(candidate.lifecycle_status, "proposed", "lifecycle_status", errors);
  requireEqual(candidate.review_status, "proposed", "review_status", errors);
  if (requireObject(candidate.candidate_payload, "candidate_payload", errors)) {
    validateNestedGovernanceOverride(candidate.candidate_payload, "candidate_payload", errors);
  }
  if (requireObject(candidate.payload, "payload", errors)) {
    requireEqual(candidate.payload.assertion_type, "model_suggested", "payload.assertion_type", errors);
    validateNestedGovernanceOverride(candidate.payload, "payload", errors);
    validateEvidence(candidate.payload.evidence_refs, errors, "payload.evidence_refs");
    validateSpans(candidate.payload.source_spans, errors, "payload.source_spans");
  }
  validateScore(candidate.score, "score", errors);
  validateScore(candidate.confidence_score, "confidence_score", errors);
  requireEqual(candidate.confidence_score, candidate.score, "confidence_score", errors);
  requireOneOf(candidate.confidence_band, ["high", "medium", "low", "blocked"], "confidence_band", errors);
  requireEqual(candidate.confidence_source, "model_calibrated_score", "confidence_source", errors);
  requireText(candidate.model_name, "model_name", errors);
  requireText(candidate.model_version, "model_version", errors);
  requireText(candidate.prompt_version, "prompt_version", errors);
  requireOneOf(candidate.duplicate_status, ["not_duplicate", "possible_duplicate", "duplicate", "not_evaluated"], "duplicate_status", errors);
  requireText(candidate.rationale, "rationale", errors);
  validateModel(candidate.model, errors);
  if (isObject(candidate.model)) {
    requireEqual(candidate.model_name, candidate.model.model_id, "model_name", errors);
    requireEqual(candidate.model_version, candidate.model.model_version, "model_version", errors);
    requireEqual(candidate.prompt_version, candidate.model.prompt_version, "prompt_version", errors);
  }
  validateConfidence(candidate.confidence, errors);
  validateEvidence(candidate.evidence_refs, errors);
  validateSpans(candidate.source_spans, errors);
  validateProvenance(candidate.provenance_id, candidate.provenance, errors);
  validateGovernance(candidate, errors);
  validateSafety(candidate, errors);
  requireText(candidate.created_at, "created_at", errors);
  requireEqual(candidate.created_by, "service:ai-curation", "created_by", errors);
  return { valid: errors.length === 0, errors };
}

export function assertSuggestionCandidate(candidate) {
  const result = validateSuggestionCandidate(candidate);
  if (!result.valid) {
    throw new AiCurationError("invalid AI suggestion candidate", { errors: result.errors });
  }
  return candidate;
}

function validateModel(model, errors) {
  if (!requireObject(model, "model", errors)) {
    return;
  }
  requireText(model.model_id, "model.model_id", errors);
  requireText(model.model_version, "model.model_version", errors);
  requireText(model.prompt_version, "model.prompt_version", errors);
}

function validateConfidence(confidence, errors) {
  if (!requireObject(confidence, "confidence", errors)) {
    return;
  }
  validateScore(confidence.score, "confidence.score", errors);
  requireOneOf(confidence.band, ["high", "medium", "low", "blocked"], "confidence.band", errors);
  requireEqual(confidence.source, "calibrated_model_score", "confidence.source", errors);
  requireEqual(confidence.fabricated, false, "confidence.fabricated", errors);
  if (!requireObject(confidence.calibration, "confidence.calibration", errors)) {
    return;
  }
  const calibration = confidence.calibration;
  requireText(calibration.calibration_id, "confidence.calibration.calibration_id", errors);
  requireText(calibration.calibration_version, "confidence.calibration.calibration_version", errors);
  requireText(calibration.calibration_method, "confidence.calibration.calibration_method", errors);
  validateScore(calibration.calibrated_score, "confidence.calibration.calibrated_score", errors);
  if (!Number.isInteger(calibration.sample_size) || calibration.sample_size < 1) {
    errors.push("confidence.calibration.sample_size must be a positive integer");
  }
  requireText(calibration.metrics_source, "confidence.calibration.metrics_source", errors);
}

function validateEvidence(evidenceRefs, errors, fieldName = "evidence_refs") {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    errors.push(`${fieldName} must contain at least one evidence reference`);
    return;
  }
  for (const [index, ref] of evidenceRefs.entries()) {
    if (!isObject(ref)) {
      errors.push(`${fieldName}[${index}] must be an object`);
      continue;
    }
    requireText(ref.evidence_id, `${fieldName}[${index}].evidence_id`, errors);
    requireText(ref.evidence_role, `${fieldName}[${index}].evidence_role`, errors);
    requireText(ref.source_name, `${fieldName}[${index}].source_name`, errors);
    requireText(ref.source_version, `${fieldName}[${index}].source_version`, errors);
    if (!Array.isArray(ref.source_span_ids) || ref.source_span_ids.length === 0) {
      errors.push(`${fieldName}[${index}].source_span_ids must contain at least one span id`);
    }
  }
}

function validateSpans(spans, errors, fieldName = "source_spans") {
  if (!Array.isArray(spans) || spans.length === 0) {
    errors.push(`${fieldName} must contain at least one source span`);
    return;
  }
  for (const [index, span] of spans.entries()) {
    if (!isObject(span)) {
      errors.push(`${fieldName}[${index}] must be an object`);
      continue;
    }
    requireText(span.span_id, `${fieldName}[${index}].span_id`, errors);
    requireText(span.source_record_id, `${fieldName}[${index}].source_record_id`, errors);
    requireText(span.field_path, `${fieldName}[${index}].field_path`, errors);
    if (!Number.isInteger(span.start_offset) || span.start_offset < 0) {
      errors.push(`${fieldName}[${index}].start_offset must be a non-negative integer`);
    }
    if (!Number.isInteger(span.end_offset) || span.end_offset < span.start_offset) {
      errors.push(`${fieldName}[${index}].end_offset must be an integer greater than or equal to start_offset`);
    }
    requireText(span.text, `${fieldName}[${index}].text`, errors);
    requireText(span.evidence_id, `${fieldName}[${index}].evidence_id`, errors);
  }
}

function validateProvenance(provenanceId, provenance, errors) {
  requireText(provenanceId, "provenance_id", errors);
  if (!requireObject(provenance, "provenance", errors)) {
    return;
  }
  requireEqual(provenance.provenance_id, provenanceId, "provenance.provenance_id", errors);
  requireText(provenance.actor, "provenance.actor", errors);
  requireEqual(provenance.activity, "ai_suggestion_generation", "provenance.activity", errors);
  requireText(provenance.method, "provenance.method", errors);
  if (requireObject(provenance.source, "provenance.source", errors)) {
    requireText(provenance.source.source_name, "provenance.source.source_name", errors);
    requireText(provenance.source.source_version, "provenance.source.source_version", errors);
  }
  requireText(provenance.time, "provenance.time", errors);
  requireText(provenance.audit_event_id, "provenance.audit_event_id", errors);
  validateEvidence(provenance.evidence_refs, errors, "provenance.evidence_refs");
  validateSpans(provenance.source_spans, errors, "provenance.source_spans");
}

function validateNestedGovernanceOverride(value, fieldName, errors) {
  if (!isObject(value)) {
    return;
  }
  if ("assertion_type" in value && value.assertion_type !== "model_suggested") {
    errors.push(`${fieldName}.assertion_type must equal "model_suggested" when present`);
  }
  if ("lifecycle_status" in value && value.lifecycle_status !== "proposed") {
    errors.push(`${fieldName}.lifecycle_status must not override proposed status`);
  }
  if ("review_status" in value && value.review_status !== "proposed") {
    errors.push(`${fieldName}.review_status must not override proposed status`);
  }
  if ("release_id" in value && value.release_id !== null) {
    errors.push(`${fieldName}.release_id must be null when present`);
  }
}

function validateGovernance(candidate, errors) {
  const governance = candidate.governance;
  if (!requireObject(governance, "governance", errors)) {
    return;
  }
  requireEqual(governance.auto_publish, false, "governance.auto_publish", errors);
  requireEqual(governance.requires_human_review, true, "governance.requires_human_review", errors);
  requireEqual(governance.release_eligible, false, "governance.release_eligible", errors);
  requireEqual(governance.released_graph_target, null, "governance.released_graph_target", errors);
  requireEqual(governance.visual_state, "ai_suggestion_distinct", "governance.visual_state", errors);
  requireEqual(governance.approval_state, "unapproved", "governance.approval_state", errors);
  const expectedDuplicatePolicy = candidate.suggestion_type === "duplicate" ? "flag_only_never_merge" : "not_applicable";
  requireEqual(governance.duplicate_policy, expectedDuplicatePolicy, "governance.duplicate_policy", errors);
  if (candidate.suggestion_type === "duplicate" && candidate.candidate_payload?.merge_allowed !== false) {
    errors.push("duplicate candidate payload must set merge_allowed=false");
  }
}

function validateSafety(candidate, errors) {
  const safety = candidate.safety;
  if (!requireObject(safety, "safety", errors)) {
    return;
  }
  if (typeof safety.faers_context !== "boolean") {
    errors.push("safety.faers_context must be boolean");
  }
  if (typeof safety.causality_allowed !== "boolean") {
    errors.push("safety.causality_allowed must be boolean");
  }
  if (typeof safety.faers_causal_blocked !== "boolean") {
    errors.push("safety.faers_causal_blocked must be boolean");
  }
  if (safety.faers_context && safety.causality_allowed) {
    errors.push("FAERS/openFDA candidate safety must not allow causality");
  }
  if (candidate.suggestion_type === "relationship" && safety.faers_context && isCausal(candidate.candidate_payload)) {
    errors.push("FAERS/openFDA relationship candidates cannot be causal");
  }
}

function sourceFrom(record = {}) {
  if (!isObject(record)) {
    throw new AiCurationError("source-bearing record must be an object");
  }
  const source = {
    source_name: record.source_name ?? record.source ?? record.sourceName,
    source_version: record.source_version ?? record.version ?? record.sourceVersion,
    source_record_id: record.source_record_id ?? record.document_id ?? record.record_id ?? record.id,
    source_record_uri: record.source_record_uri ?? record.uri ?? null
  };
  assertText(source.source_name, "source_name");
  assertText(source.source_version, "source_version");
  assertText(source.source_record_id, "source_record_id");
  return source;
}

function spanFrom(item = {}, source) {
  const text = item.text ?? item.snippet ?? item.label ?? item.synonym ?? item.evidence_text;
  assertText(text, "source span text");
  const start = integerOr(item.start_offset, 0);
  const end = integerOr(item.end_offset, start + text.length);
  return {
    span_id: item.span_id ?? `span:${digest({ source, text, start, end })}`,
    source_record_id: item.source_record_id ?? source.source_record_id,
    field_path: item.field_path ?? "text",
    start_offset: start,
    end_offset: end,
    text,
    quote_hash: item.quote_hash ?? `sha256:${digest(text)}`
  };
}

function normalizeSourceSpans(spans, source) {
  if (!Array.isArray(spans) || spans.length === 0) {
    throw new AiCurationError("candidate requires source_spans");
  }
  return spans.map((span) => spanFrom({ ...span, source_record_id: span.source_record_id ?? source.source_record_id }, source));
}

function normalizeEvidenceRefs(evidenceRefs, source, spans) {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    throw new AiCurationError("candidate requires evidence_refs");
  }
  const spanIds = spans.map((span) => span.span_id);
  return evidenceRefs.map((ref, index) => {
    if (!isObject(ref)) {
      throw new AiCurationError("evidence_refs entries must be objects", { index });
    }
    return {
      evidence_id: ref.evidence_id ?? `pharmev:${digest({ source, index, spanIds })}`,
      evidence_role: ref.evidence_role ?? "supports",
      source_name: ref.source_name ?? source.source_name,
      source_version: ref.source_version ?? source.source_version,
      source_record_id: ref.source_record_id ?? source.source_record_id,
      source_record_uri: ref.source_record_uri ?? source.source_record_uri ?? null,
      source_span_ids: ref.source_span_ids ?? spanIds,
      disclaimer_ids: ref.disclaimer_ids ?? (usesFaers(source, [ref]) ? ["source_limit:faers_non_causal"] : []),
      source_limitations: ref.source_limitations ?? (usesFaers(source, [ref]) ? ["FAERS/openFDA reports are non-causal safety reports and cannot establish incidence, prevalence, comparative risk, product fault, or causation."] : [])
    };
  });
}

function normalizeModel(model) {
  if (!isObject(model)) {
    throw new AiCurationError("AI suggestion engine requires model metadata");
  }
  assertText(model.model_id, "model.model_id");
  assertText(model.model_version, "model.model_version");
  assertText(model.prompt_version, "model.prompt_version");
  return {
    model_id: model.model_id,
    model_version: model.model_version,
    prompt_version: model.prompt_version,
    prompt_id: model.prompt_id ?? null,
    provider: model.provider ?? null
  };
}

function normalizeCalibration(calibration) {
  if (!isObject(calibration)) {
    throw new AiCurationError("AI suggestion engine requires real calibration metadata");
  }
  assertText(calibration.calibration_id, "calibration.calibration_id");
  assertText(calibration.calibration_version, "calibration.calibration_version");
  assertText(calibration.calibration_method, "calibration.calibration_method");
  if (!Number.isInteger(calibration.sample_size) || calibration.sample_size < 1) {
    throw new AiCurationError("calibration.sample_size must be a positive integer");
  }
  assertText(calibration.metrics_source, "calibration.metrics_source");
  return {
    calibration_id: calibration.calibration_id,
    calibration_version: calibration.calibration_version,
    calibration_method: calibration.calibration_method,
    sample_size: calibration.sample_size,
    expected_accuracy: nullableScore(calibration.expected_accuracy),
    observed_accuracy: nullableScore(calibration.observed_accuracy),
    confidence_interval: calibration.confidence_interval ?? null,
    metrics_source: calibration.metrics_source
  };
}

function confidenceFor(score, calibration) {
  return {
    score,
    band: score >= 0.85 ? "high" : score >= 0.65 ? "medium" : score >= 0.35 ? "low" : "blocked",
    source: "calibrated_model_score",
    fabricated: false,
    calibration: {
      ...calibration,
      calibrated_score: score
    }
  };
}

function proposalTypeForSuggestion(suggestionType) {
  if (suggestionType === "synonym") return "synonym";
  if (suggestionType === "relationship") return "relationship";
  if (suggestionType === "document_entity_extraction") return "evidence-link";
  return "mapping";
}

function duplicateStatusForSuggestion(suggestionType) {
  return suggestionType === "duplicate" ? "possible_duplicate" : "not_duplicate";
}

function assertScore(score) {
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
    throw new AiCurationError("candidate score must be a real number between 0 and 1");
  }
}

function validateScore(score, field, errors) {
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
    errors.push(`${field} must be a number between 0 and 1`);
  }
}

function nullableScore(score) {
  if (score === undefined || score === null) {
    return null;
  }
  assertScore(score);
  return score;
}

function usesFaers(source, evidenceRefs = []) {
  const text = [
    source?.source_name,
    source?.source_version,
    ...arrayOf(evidenceRefs).flatMap((ref) => [
      ref?.source_name,
      ref?.source_version,
      ...(ref?.disclaimer_ids ?? []),
      ...(ref?.source_limitations ?? [])
    ])
  ].filter(Boolean).join(" ").toLowerCase();
  return FAERS_TERMS.some((term) => text.includes(term));
}

function isCausal(record = {}) {
  const text = [
    record.claim_type,
    record.assertion_type,
    record.predicate,
    record.relationship_type
  ].filter(Boolean).join(" ").toLowerCase();
  return CAUSAL_TERMS.some((term) => text.includes(term));
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function integerOr(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function assertText(value, fieldName) {
  if (!hasText(value)) {
    throw new AiCurationError(`${fieldName} is required`);
  }
}

function requireText(value, fieldName, errors) {
  if (!hasText(value)) {
    errors.push(`${fieldName} is required`);
    return false;
  }
  return true;
}

function requireObject(value, fieldName, errors) {
  if (!isObject(value)) {
    errors.push(`${fieldName} must be an object`);
    return false;
  }
  return true;
}

function requireEqual(actual, expected, fieldName, errors) {
  if (actual !== expected) {
    errors.push(`${fieldName} must equal ${JSON.stringify(expected)}`);
  }
}

function requireOneOf(actual, allowed, fieldName, errors) {
  if (!allowed.includes(actual)) {
    errors.push(`${fieldName} must be one of ${allowed.join(", ")}`);
  }
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function digest(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(sortForJson(value))).digest("hex").slice(0, 24);
}

function sortForJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortForJson(item)]));
  }
  return value;
}
