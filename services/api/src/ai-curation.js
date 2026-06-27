import { assertSuggestionCandidate } from "../../ai-curation/src/index.js";
import { executeAuthorizedQuery } from "./query-boundary.js";

export const PHASE6_CURATION_API_VERSION = "phase6.curation-api.v1";

const SUGGESTION_TYPES = Object.freeze(["document_entity_extraction", "entity_linking", "synonym", "relationship", "duplicate"]);
const FEEDBACK_ACTIONS = Object.freeze(["accept", "reject", "revise"]);
const EXPERT_REVIEW_THRESHOLD = 0.7;

export class AiCurationApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AiCurationApiError";
    this.details = details;
  }
}

export class Phase6AiCurationApi {
  constructor({
    resolveSuggestions,
    recordSuggestionFeedback,
    submitFeedbackToWorkflow,
    authorizeFeedback = null,
    enforceNoAutoRelease = null,
    clock = () => new Date(),
    idFactory = defaultIdFactory
  } = {}) {
    this.resolveSuggestions = requiredResolver(resolveSuggestions, "resolveSuggestions");
    this.recordSuggestionFeedback = requiredResolver(recordSuggestionFeedback ?? submitFeedbackToWorkflow, "recordSuggestionFeedback");
    this.authorizeFeedback = requiredResolver(authorizeFeedback, "authorizeFeedback");
    this.enforceNoAutoRelease = requiredResolver(enforceNoAutoRelease, "enforceNoAutoRelease");
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async fetchSuggestions({ principal, request = {} } = {}) {
    assertPrincipal(principal);
    const scope = normalizeSuggestionScope(request.scope ?? request);
    const rawSuggestions = await this.resolveSuggestions({ principal, scope });
    if (!Array.isArray(rawSuggestions)) {
      throw new AiCurationApiError("resolveSuggestions must return an array");
    }
    const candidates = rawSuggestions.map((suggestion) => normalizeSuggestion({
      suggestion,
      principal,
      generatedAt: this.clock().toISOString()
    }));
    const boundary = await executeAuthorizedQuery({
      principal,
      query: { scope, assertion_type: "model_suggested" },
      candidateResults: candidates,
      releaseContext: { release_id: null, scope: "working" }
    });
    const suggestions = boundary.results.map((suggestion) => ({
      ...suggestion,
      workflow: {
        queue: suggestion.score < EXPERT_REVIEW_THRESHOLD ? "expert_review" : "curation_review",
        low_confidence: suggestion.score < EXPERT_REVIEW_THRESHOLD,
        review_required: true
      },
      actions: {
        can_accept: true,
        can_reject: true,
        can_revise: true
      }
    }));
    return {
      schema_version: PHASE6_CURATION_API_VERSION,
      generated_at: this.clock().toISOString(),
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      scope,
      suggestions,
      visible_count: suggestions.length,
      authorization_filtered: true,
      policy_notice: "AI suggestions are model_suggested candidates only and require human governance before release."
    };
  }

  async submitFeedback({ principal, request = {} } = {}) {
    assertPrincipal(principal);
    const feedback = normalizeFeedbackRequest({ request, principal, generatedAt: this.clock().toISOString(), idFactory: this.idFactory });
    const authorization = await this.authorizeFeedback({
      principal,
      feedback,
      action: `ai_suggestion.${feedback.action}`
    });
    if (authorization?.decision !== "allow") {
      throw new AiCurationApiError("feedback authorization denied", { suggestion_id: feedback.suggestion_id });
    }
    const gated = await this.enforceNoAutoRelease({
      principal,
      feedback,
      candidate: feedback.candidate,
      authorization
    });
    if (gated?.allowed !== true) {
      throw new AiCurationApiError("no-auto-release gate denied AI suggestion feedback", { suggestion_id: feedback.suggestion_id });
    }
    const workflowResult = await this.recordSuggestionFeedback({
      principal,
      feedback,
      authorization,
      no_auto_release_gate: gated
    });
    if (!workflowResult || typeof workflowResult !== "object" || Array.isArray(workflowResult)) {
      throw new AiCurationApiError("workflow feedback hook must return a routing object");
    }
    return {
      schema_version: PHASE6_CURATION_API_VERSION,
      generated_at: this.clock().toISOString(),
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      authorization_filtered: true,
      feedback,
      workflow: {
        routed: true,
        ...workflowResult
      },
      policy_notice: "Feedback captured as governed workflow input; AI suggestions are never auto-published."
    };
  }
}

export function createPhase6AiCurationApi(dependencies) {
  return new Phase6AiCurationApi(dependencies);
}

function normalizeSuggestion({ suggestion, principal, generatedAt }) {
  if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) {
    throw new AiCurationApiError("suggestion must be an object");
  }
  assertNoNestedMasquerade(suggestion);
  try {
    assertSuggestionCandidate(suggestion);
  } catch (error) {
    const strictErrors = error.details?.errors ?? [error.message];
    if (strictErrors.some((strictError) => /FAERS\/openFDA.*causal/.test(strictError))) {
      throw new AiCurationApiError("FAERS/openFDA suggestions cannot be causal", {
        suggestion_id: suggestion.suggestion_id ?? suggestion.candidate_id ?? suggestion.id,
        errors: strictErrors
      });
    }
    throw new AiCurationApiError("AI suggestion failed strict candidate validation", {
      suggestion_id: suggestion.suggestion_id ?? suggestion.candidate_id ?? suggestion.id,
      errors: strictErrors
    });
  }
  const normalized = {
    ...suggestion,
    id: suggestion.id ?? suggestion.suggestion_id ?? suggestion.candidate_id,
    candidate_id: suggestion.candidate_id ?? suggestion.suggestion_id ?? suggestion.id,
    suggestion_id: suggestion.suggestion_id ?? suggestion.candidate_id ?? suggestion.id,
    tenant_id: suggestion.tenant_id ?? principal.tenant_id,
    environment: suggestion.environment ?? principal.environment,
    suggestion_type: normalizeSuggestionType(suggestion.suggestion_type),
    assertion_type: "model_suggested",
    lifecycle_status: "proposed",
    review_status: "proposed",
    release_id: null,
    model_version: suggestion.model_version ?? suggestion.model?.model_version,
    prompt_version: suggestion.prompt_version ?? suggestion.model?.prompt_version ?? null,
    score: suggestion.score ?? suggestion.confidence_score ?? suggestion.confidence?.score,
    calibration: suggestion.calibration ?? suggestion.confidence?.calibration ?? null,
    provenance_id: suggestion.provenance_id ?? suggestion.provenance?.provenance_id,
    permitted_uses: suggestion.permitted_uses ?? ["search"],
    license_status: suggestion.license_status ?? "valid",
    duplicate_status: suggestion.duplicate_status ?? "not_evaluated",
    source_spans: suggestion.source_spans ?? suggestion.payload?.source_spans ?? [],
    evidence_refs: suggestion.evidence_refs ?? suggestion.payload?.evidence_refs ?? [],
    generated_at: suggestion.generated_at ?? generatedAt
  };
  validateSuggestion(normalized);
  return normalized;
}

function assertNoNestedMasquerade(suggestion) {
  for (const [containerName, container] of [
    ["candidate_payload", suggestion.candidate_payload],
    ["payload", suggestion.payload]
  ]) {
    if (!container || typeof container !== "object" || Array.isArray(container)) continue;
    for (const field of ["lifecycle_status", "review_status", "release_id", "approval_state", "release_status"]) {
      if (container[field] !== undefined && container[field] !== null) {
        throw new AiCurationApiError("AI suggestion nested payload cannot carry governed status fields", {
          suggestion_id: suggestion.suggestion_id ?? suggestion.candidate_id ?? suggestion.id,
          field: `${containerName}.${field}`
        });
      }
    }
    if (container.assertion_type !== undefined && container.assertion_type !== "model_suggested") {
      throw new AiCurationApiError("AI suggestion nested payload cannot masquerade as approved or released", {
        suggestion_id: suggestion.suggestion_id ?? suggestion.candidate_id ?? suggestion.id,
        field: `${containerName}.assertion_type`
      });
    }
  }
}

function validateSuggestion(suggestion) {
  for (const field of [
    "suggestion_id",
    "tenant_id",
    "environment",
    "suggestion_type",
    "model_version",
    "score",
    "provenance_id"
  ]) {
    assertSuggestionField(suggestion[field], field, suggestion.suggestion_id);
  }
  if (!SUGGESTION_TYPES.includes(suggestion.suggestion_type)) {
    throw new AiCurationApiError("unsupported suggestion_type", { suggestion_id: suggestion.suggestion_id, suggestion_type: suggestion.suggestion_type });
  }
  if (suggestion.assertion_type !== "model_suggested") {
    throw new AiCurationApiError("AI suggestions must be model_suggested", { suggestion_id: suggestion.suggestion_id });
  }
  if (suggestion.release_id !== null && suggestion.release_id !== undefined) {
    throw new AiCurationApiError("AI suggestions cannot carry release_id", { suggestion_id: suggestion.suggestion_id });
  }
  if (["approved", "released", "active", "published"].includes(String(suggestion.lifecycle_status))) {
    throw new AiCurationApiError("AI suggestions cannot be approved or released", { suggestion_id: suggestion.suggestion_id });
  }
  if (suggestion.lifecycle_status !== "proposed") {
    throw new AiCurationApiError("AI suggestions must remain proposed", { suggestion_id: suggestion.suggestion_id });
  }
  if (suggestion.review_status !== "proposed") {
    throw new AiCurationApiError("AI suggestion review_status must remain proposed", { suggestion_id: suggestion.suggestion_id });
  }
  if (typeof suggestion.score !== "number" || suggestion.score < 0 || suggestion.score > 1) {
    throw new AiCurationApiError("suggestion score must be real model/calibration output in [0,1]", { suggestion_id: suggestion.suggestion_id });
  }
  if (suggestion.confidence_source === "fabricated" || suggestion.confidence?.source === "fabricated" || suggestion.confidence?.fabricated === true || suggestion.fabricated_confidence === true) {
    throw new AiCurationApiError("suggestion confidence must not be fabricated", { suggestion_id: suggestion.suggestion_id });
  }
  if (suggestion.governance?.auto_publish === true || suggestion.governance?.release_eligible === true || suggestion.governance?.released_graph_target) {
    throw new AiCurationApiError("AI suggestions cannot be auto-published or release eligible", { suggestion_id: suggestion.suggestion_id });
  }
  if (suggestion.suggestion_type === "duplicate") {
    if (suggestion.governance?.duplicate_policy && suggestion.governance.duplicate_policy !== "flag_only_never_merge") {
      throw new AiCurationApiError("duplicate suggestions must remain flag-only", { suggestion_id: suggestion.suggestion_id });
    }
    if (suggestion.candidate_payload?.merge_allowed !== false) {
      throw new AiCurationApiError("duplicate suggestions cannot allow merge", { suggestion_id: suggestion.suggestion_id });
    }
  }
  if (!Array.isArray(suggestion.evidence_refs) || suggestion.evidence_refs.length === 0) {
    throw new AiCurationApiError("suggestion requires evidence_refs", { suggestion_id: suggestion.suggestion_id });
  }
  if (!Array.isArray(suggestion.source_spans) || suggestion.source_spans.length === 0) {
    throw new AiCurationApiError("suggestion requires source_spans", { suggestion_id: suggestion.suggestion_id });
  }
  for (const span of suggestion.source_spans) {
    if (!span || typeof span !== "object" || Array.isArray(span)) {
      throw new AiCurationApiError("source span must be an object", { suggestion_id: suggestion.suggestion_id });
    }
    assertSuggestionField(span.source_id ?? span.document_id ?? span.evidence_id, "source_span.source_id", suggestion.suggestion_id);
    if (typeof span.start_offset !== "number" || typeof span.end_offset !== "number" || span.end_offset < span.start_offset) {
      throw new AiCurationApiError("source span requires numeric offsets", { suggestion_id: suggestion.suggestion_id });
    }
  }
  if ((isFaersContext(suggestion) && hasCausalClaim(suggestion)) || (suggestion.safety?.faers_context && suggestion.safety?.causality_allowed)) {
    throw new AiCurationApiError("FAERS/openFDA suggestions cannot be causal", { suggestion_id: suggestion.suggestion_id });
  }
}

function isFaersContext(suggestion) {
  if (suggestion.safety?.faers_context === true) return true;
  const context = [
    suggestion.source_name,
    suggestion.source_version,
    suggestion.provenance?.source?.source_name,
    suggestion.provenance?.source?.source_version,
    ...(suggestion.evidence_refs ?? []).flatMap((ref) => [
      ref.source_name,
      ref.source_version,
      ...(ref.disclaimer_ids ?? [])
    ])
  ].filter(Boolean).join(" ").toLowerCase();
  return context.includes("faers") || context.includes("openfda");
}

function hasCausalClaim(suggestion) {
  const claimText = [
    suggestion.predicate,
    suggestion.claim_type,
    suggestion.relationship_type,
    suggestion.candidate_payload?.predicate,
    suggestion.candidate_payload?.claim_type,
    suggestion.candidate_payload?.relationship_type,
    suggestion.payload?.predicate,
    suggestion.payload?.claim_type,
    suggestion.payload?.relationship_type
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(causal|causes|caused_by|causation|incidence|prevalence|risk_ratio|relative_risk|attributable|product_fault)\b/.test(claimText);
}

function normalizeSuggestionType(suggestionType) {
  if (suggestionType === "entity_link") return "entity_linking";
  return suggestionType;
}

function normalizeFeedbackRequest({ request, principal, generatedAt, idFactory }) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new AiCurationApiError("feedback request must be an object");
  }
  const action = request.action;
  if (!FEEDBACK_ACTIONS.includes(action)) {
    throw new AiCurationApiError("feedback action must be accept, reject, or revise");
  }
  assertText(request.suggestion_id, "suggestion_id");
  assertText(request.rationale, "rationale");
  const candidate = normalizeSuggestion({
    suggestion: request.candidate ?? {
      ...request.suggestion,
      suggestion_id: request.suggestion_id
    },
    principal,
    generatedAt
  });
  if (candidate.suggestion_id !== request.suggestion_id) {
    throw new AiCurationApiError("feedback suggestion_id must match candidate", { suggestion_id: request.suggestion_id });
  }
  if (action === "revise" && (!request.revision || typeof request.revision !== "object" || Array.isArray(request.revision))) {
    throw new AiCurationApiError("revise feedback requires revision object", { suggestion_id: request.suggestion_id });
  }
  const feedbackId = request.feedback_id ?? `feedback:${idFactory()}`;
  return {
    feedback_id: feedbackId,
    suggestion_id: request.suggestion_id,
    action,
    decision: action,
    rationale: request.rationale,
    actor_user_id: principal.user_id ?? principal.service_account_id ?? null,
    reviewer_user_id: principal.user_id ?? principal.service_account_id ?? null,
    reviewer_role_key: principal.role_keys[0],
    tenant_id: principal.tenant_id,
    environment: principal.environment,
    submitted_at: generatedAt,
    occurred_at: generatedAt,
    correlation_id: request.correlation_id ?? feedbackId,
    revision: action === "revise" ? request.revision : null,
    candidate
  };
}

function normalizeSuggestionScope(scope) {
  const normalized = {
    type: scope.type ?? (scope.document_id ? "document" : scope.entity_id ? "entity" : "queue"),
    document_id: scope.document_id ?? null,
    entity_id: scope.entity_id ?? null,
    queue_id: scope.queue_id ?? null,
    suggestion_types: Array.isArray(scope.suggestion_types) ? scope.suggestion_types : SUGGESTION_TYPES
  };
  if (!["document", "entity", "queue"].includes(normalized.type)) {
    throw new AiCurationApiError("suggestion scope type must be document, entity, or queue");
  }
  if (normalized.type === "document") assertText(normalized.document_id, "scope.document_id");
  if (normalized.type === "entity") assertText(normalized.entity_id, "scope.entity_id");
  if (normalized.type === "queue") assertText(normalized.queue_id, "scope.queue_id");
  return normalized;
}

function requiredResolver(fn, name) {
  if (typeof fn !== "function") {
    throw new AiCurationApiError(`${name} hook is required`);
  }
  return fn;
}

function assertPrincipal(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    throw new AiCurationApiError("principal is required");
  }
  assertText(principal.tenant_id, "principal.tenant_id");
  assertText(principal.environment, "principal.environment");
  if (!Array.isArray(principal.role_keys) || principal.role_keys.length === 0) {
    throw new AiCurationApiError("principal.role_keys is required");
  }
}

function assertSuggestionField(value, fieldName, suggestionId) {
  if (fieldName === "score") {
    if (typeof value === "number") return;
    throw new AiCurationApiError(`${fieldName} is required`, { suggestion_id: suggestionId });
  }
  assertText(value, fieldName);
}

function assertText(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new AiCurationApiError(`${fieldName} is required`);
  }
}

function defaultIdFactory() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
