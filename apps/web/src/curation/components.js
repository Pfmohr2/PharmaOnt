import { renderAssertionBadge } from "../workbench/index.js";

export const CURATION_SCHEMA_VERSION = "phase6.curation-api.v1";

const SUGGESTION_TYPES = Object.freeze([
  "document_entity_extraction",
  "entity_linking",
  "synonym",
  "relationship",
  "duplicate"
]);

export function renderAiSuggestionWorkspace({
  suggestionsResponse,
  feedbackResponse = null
}) {
  assertCurationResponse(suggestionsResponse, "suggestionsResponse");
  return {
    component: "AiSuggestionWorkspace",
    schema_version: suggestionsResponse.schema_version,
    tenant_id: suggestionsResponse.tenant_id,
    environment: suggestionsResponse.environment,
    scope: suggestionsResponse.scope,
    navigation: ["Suggestions", "Expert review", "Feedback"],
    suggestions: renderSuggestionQueue(suggestionsResponse),
    feedback: feedbackResponse ? renderFeedbackReceipt(feedbackResponse) : null
  };
}

export function renderSuggestionQueue(response) {
  assertCurationResponse(response, "suggestionsResponse");
  const cards = arrayOf(response.suggestions).map(renderSuggestionCard);
  return {
    component: "SuggestionQueue",
    scope: response.scope,
    supported_suggestion_types: SUGGESTION_TYPES,
    visible_count: response.visible_count,
    authorization_filtered: response.authorization_filtered === true,
    policy_notice: response.policy_notice ?? null,
    hidden_count: null,
    empty_state: cards.length === 0 ? "No visible AI suggestions for this scope" : null,
    cards
  };
}

export function renderSuggestionCard(suggestion) {
  assertModelSuggestedCandidate(suggestion);
  const workflow = suggestion.workflow ?? {};
  return {
    component: "AiSuggestionCard",
    candidate_id: suggestion.candidate_id ?? suggestion.suggestion_id,
    suggestion_id: requireText(suggestion.suggestion_id, "suggestion.suggestion_id"),
    suggestion_type: requireText(suggestion.suggestion_type, "suggestion.suggestion_type"),
    proposal_type: suggestion.proposal_type ?? null,
    candidate_payload: suggestion.candidate_payload ?? null,
    payload: suggestion.payload ?? null,
    assertion_badge: renderAssertionBadge({
      assertion_type: suggestion.assertion_type,
      lifecycle_status: suggestion.lifecycle_status,
      release_id: suggestion.release_id,
      badges: suggestion.badges
    }),
    semantic_state: {
      assertion_type: suggestion.assertion_type,
      lifecycle_status: suggestion.lifecycle_status,
      review_status: suggestion.review_status,
      release_id: suggestion.release_id,
      visual_state: suggestion.governance?.visual_state ?? "ai_suggestion_distinct",
      approval_state: suggestion.governance?.approval_state ?? "unapproved",
      approved: false,
      released: false
    },
    model: {
      model_name: suggestion.model_name ?? suggestion.model?.model_id ?? null,
      model_version: requireText(suggestion.model_version, "suggestion.model_version"),
      prompt_version: suggestion.prompt_version ?? null,
      score: requireNumber(suggestion.score ?? suggestion.confidence_score, "suggestion.score"),
      confidence_score: suggestion.confidence_score ?? suggestion.score,
      confidence_band: suggestion.confidence_band ?? suggestion.confidence?.band ?? suggestion.calibration?.confidence_band ?? null,
      confidence_source: suggestion.confidence_source ?? suggestion.confidence?.source ?? null,
      calibration: suggestion.calibration ?? suggestion.confidence?.calibration ?? null
    },
    evidence_refs: arrayOf(suggestion.evidence_refs).map(renderEvidenceRef),
    source_spans: arrayOf(suggestion.source_spans).map(renderSourceSpan),
    provenance_id: requireText(suggestion.provenance_id, "suggestion.provenance_id"),
    duplicate: renderDuplicateState(suggestion.duplicate_status),
    routing: renderRoutingState(workflow),
    rationale: suggestion.rationale ?? null,
    governance: suggestion.governance ?? null,
    safety: renderSafetyState(suggestion.safety),
    feedback: renderFeedbackAffordance(suggestion),
    raw_candidate: suggestion
  };
}

export function renderFeedbackAffordance(suggestion) {
  assertModelSuggestedCandidate(suggestion);
  const actions = suggestion.actions ?? {};
  const suggestionId = requireText(suggestion.suggestion_id, "suggestion.suggestion_id");
  return {
    component: "SuggestionFeedbackAffordance",
    endpoint: `/api/curation/suggestions/${encodeURIComponent(suggestionId)}/feedback`,
    method: "POST",
    actions: [
      feedbackAction("accept", actions.can_accept, suggestion),
      feedbackAction("reject", actions.can_reject, suggestion),
      feedbackAction("revise", actions.can_revise, suggestion, { revision: null })
    ],
    no_auto_release_notice: "Feedback is routed for governed review and never approves or releases a suggestion by itself."
  };
}

export function renderFeedbackReceipt(response) {
  assertCurationResponse(response, "feedbackResponse");
  const feedback = response.feedback ?? {};
  const candidate = feedback.candidate ?? {};
  assertModelSuggestedCandidate(candidate);
  return {
    component: "SuggestionFeedbackReceipt",
    authorization_filtered: response.authorization_filtered === true,
    policy_notice: response.policy_notice ?? null,
    feedback_id: requireText(feedback.feedback_id, "feedback.feedback_id"),
    suggestion_id: requireText(feedback.suggestion_id, "feedback.suggestion_id"),
    action: requireText(feedback.action, "feedback.action"),
    decision: requireText(feedback.decision, "feedback.decision"),
    rationale: requireText(feedback.rationale, "feedback.rationale"),
    reviewer_user_id: feedback.reviewer_user_id ?? null,
    reviewer_role_key: requireText(feedback.reviewer_role_key, "feedback.reviewer_role_key"),
    correlation_id: requireText(feedback.correlation_id, "feedback.correlation_id"),
    occurred_at: requireText(feedback.occurred_at, "feedback.occurred_at"),
    revision: feedback.revision ?? null,
    candidate: renderSuggestionCard(candidate),
    workflow: response.workflow ?? null,
    approval_state: {
      approved: false,
      released: false
    }
  };
}

function feedbackAction(action, enabled, suggestion, extras = {}) {
  return {
    action,
    enabled: Boolean(enabled),
    request_body: {
      suggestion_id: suggestion.suggestion_id,
      action,
      rationale: "",
      candidate: suggestion,
      ...extras
    }
  };
}

function renderEvidenceRef(ref) {
  return {
    evidence_id: requireText(ref.evidence_id, "evidence_ref.evidence_id"),
    evidence_role: requireText(ref.evidence_role, "evidence_ref.evidence_role"),
    required_for_release: Boolean(ref.required_for_release)
  };
}

function renderSourceSpan(span) {
  return {
    source_id: span.source_id ?? null,
    document_id: span.document_id ?? null,
    evidence_id: span.evidence_id ?? null,
    start_offset: requireNumber(span.start_offset, "source_span.start_offset"),
    end_offset: requireNumber(span.end_offset, "source_span.end_offset"),
    text: span.text ?? null
  };
}

function renderDuplicateState(duplicateStatus) {
  const value = duplicateStatus ?? "not_duplicate";
  return {
    status: value,
    flagged: value !== "not_duplicate" && value !== "none",
    merged: false
  };
}

function renderSafetyState(safety) {
  return {
    faers_context: Boolean(safety?.faers_context),
    causality_allowed: safety?.causality_allowed ?? null,
    faers_causal_blocked: Boolean(safety?.faers_causal_blocked),
    causal_claim_warning: safety?.faers_context && safety?.causality_allowed === false
      ? "FAERS/openFDA suggestion is non-causal; do not render as causal."
      : null
  };
}

function renderRoutingState(workflow) {
  const queue = workflow.queue ?? null;
  const displayQueue = queue ? String(queue).replaceAll("_", "-") : null;
  return {
    queue,
    display_queue: displayQueue,
    state: workflow.state ?? workflow.review_state ?? null,
    low_confidence: Boolean(workflow.low_confidence ?? workflow.requires_expert_review),
    review_required: workflow.review_required !== false,
    requires_expert_review: Boolean(workflow.requires_expert_review ?? displayQueue === "expert-review"),
    routing_reason: workflow.routing_reason ?? workflow.reason ?? null,
    routing_policy_id: workflow.routing_policy_id ?? null,
    confidence_band: workflow.confidence_band ?? null,
    risk_level: workflow.risk_level ?? null
  };
}

function assertCurationResponse(response, label) {
  if (response?.schema_version !== CURATION_SCHEMA_VERSION || response?.authorization_filtered !== true) {
    throw new Error(`${label} must be a server-filtered ${CURATION_SCHEMA_VERSION} response`);
  }
}

function assertModelSuggestedCandidate(suggestion) {
  if (suggestion?.assertion_type !== "model_suggested") {
    throw new Error("AI suggestion UI can only render model_suggested candidates");
  }
  if (suggestion.lifecycle_status !== "proposed" || suggestion.review_status !== "proposed" || suggestion.release_id !== null) {
    throw new Error("AI suggestion UI cannot render approved or released assertions");
  }
  if (arrayOf(suggestion.evidence_refs).length === 0 || arrayOf(suggestion.source_spans).length === 0) {
    throw new Error("AI suggestion UI requires evidence_refs and source_spans");
  }
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function requireNumber(value, label) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${label} is required`);
  }
  return value;
}
