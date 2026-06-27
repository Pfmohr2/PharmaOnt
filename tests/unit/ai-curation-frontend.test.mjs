import assert from "node:assert/strict";
import test from "node:test";

import {
  renderAiSuggestionWorkspace,
  renderFeedbackAffordance,
  renderFeedbackReceipt,
  renderSuggestionCard,
  renderSuggestionQueue
} from "../../apps/web/src/curation/index.js";

test("Phase 6 suggestion queue renders visible model suggestions without hidden counts", () => {
  const queue = renderSuggestionQueue(suggestionsResponse());

  assert.equal(queue.component, "SuggestionQueue");
  assert.equal(queue.authorization_filtered, true);
  assert.equal(queue.visible_count, 4);
  assert.equal(queue.hidden_count, null);
  assert.equal("filtered_count" in queue, false);
  assert.deepEqual(queue.cards.map((card) => card.suggestion_type), [
    "entity_linking",
    "synonym",
    "relationship",
    "duplicate"
  ]);
  assert.ok(queue.cards.every((card) => card.assertion_badge.some((badge) => badge.value === "model_suggested")));
  assert.ok(queue.cards.every((card) => card.semantic_state.approved === false && card.semantic_state.released === false));
});

test("Phase 6 suggestion cards expose model, prompt, score, evidence, and source spans", () => {
  const card = renderSuggestionCard(suggestionFixture({
    suggestion_type: "relationship",
    prompt_version: "prompt:relationship-v1",
    score: 0.88
  }));

  assert.equal(card.component, "AiSuggestionCard");
  assert.equal(card.candidate_id, "suggestion:visible");
  assert.equal(card.proposal_type, "mapping");
  assert.equal(card.candidate_payload.label, "aspirin inhibits PTGS1");
  assert.equal(card.payload.assertion_type, "model_suggested");
  assert.equal(card.semantic_state.visual_state, "ai_suggestion_distinct");
  assert.equal(card.semantic_state.approval_state, "unapproved");
  assert.equal(card.model.model_name, "p6-curation-baseline");
  assert.equal(card.model.model_version, "model:biomed-curation-1");
  assert.equal(card.model.prompt_version, "prompt:relationship-v1");
  assert.equal(card.model.score, 0.88);
  assert.equal(card.model.confidence_score, 0.92);
  assert.equal(card.model.confidence_band, "high");
  assert.equal(card.model.confidence_source, "model_calibrated_score");
  assert.equal(card.evidence_refs[0].evidence_id, "pharmev:evidence-p6-1");
  assert.equal(card.source_spans[0].start_offset, 12);
  assert.equal(card.provenance_id, "pharmprov:p6-suggestion");
  assert.equal(card.rationale, "Candidate extracted from source span.");
  assert.equal(card.governance.requires_human_review, true);
  assert.equal(card.safety.causality_allowed, false);
  assert.match(card.safety.causal_claim_warning, /non-causal/);
});

test("Phase 6 feedback affordance wires accept, reject, and revise to feedback endpoint", () => {
  const suggestion = suggestionFixture();
  const affordance = renderFeedbackAffordance(suggestion);

  assert.equal(affordance.component, "SuggestionFeedbackAffordance");
  assert.equal(affordance.endpoint, "/api/curation/suggestions/suggestion%3Avisible/feedback");
  assert.equal(affordance.method, "POST");
  assert.deepEqual(affordance.actions.map((action) => action.action), ["accept", "reject", "revise"]);
  assert.ok(affordance.actions.every((action) => action.enabled));
  assert.equal(affordance.actions.find((action) => action.action === "revise").request_body.revision, null);
  assert.equal(affordance.actions[0].request_body.candidate.assertion_type, "model_suggested");
  assert.match(affordance.no_auto_release_notice, /never approves or releases/);
});

test("Phase 6 low-confidence and duplicate suggestions are routed and flagged, not merged", () => {
  const card = renderSuggestionCard(suggestionFixture({
    suggestion_id: "suggestion:low-confidence-duplicate",
    score: 0.42,
    duplicate_status: "duplicate_flagged",
    workflow: {
      queue: "expert_review",
      state: "curator-review",
      low_confidence: true,
      review_required: true,
      requires_expert_review: true,
      routing_reason: "model_suggested_low_confidence",
      routing_policy_id: "policy:low-confidence",
      confidence_band: "low",
      risk_level: "high"
    }
  }));

  assert.equal(card.routing.display_queue, "expert-review");
  assert.equal(card.routing.state, "curator-review");
  assert.equal(card.routing.requires_expert_review, true);
  assert.equal(card.routing.routing_reason, "model_suggested_low_confidence");
  assert.equal(card.routing.confidence_band, "low");
  assert.equal(card.duplicate.flagged, true);
  assert.equal(card.duplicate.merged, false);
});

test("Phase 6 feedback receipt is audit/display data and never approval", () => {
  const receipt = renderFeedbackReceipt(feedbackResponse());

  assert.equal(receipt.component, "SuggestionFeedbackReceipt");
  assert.equal(receipt.action, "revise");
  assert.equal(receipt.decision, "revise");
  assert.equal(receipt.reviewer_role_key, "curator");
  assert.equal(receipt.workflow.routed, true);
  assert.equal(receipt.approval_state.approved, false);
  assert.equal(receipt.approval_state.released, false);
  assert.equal(receipt.candidate.semantic_state.release_id, null);
});

test("Phase 6 workspace composes suggestions and feedback receipt", () => {
  const workspace = renderAiSuggestionWorkspace({
    suggestionsResponse: suggestionsResponse(),
    feedbackResponse: feedbackResponse()
  });

  assert.equal(workspace.component, "AiSuggestionWorkspace");
  assert.equal(workspace.suggestions.cards.length, 4);
  assert.equal(workspace.feedback.component, "SuggestionFeedbackReceipt");
});

test("Phase 6 frontend refuses unfiltered or approved/released suggestion payloads", () => {
  const response = suggestionsResponse();
  response.authorization_filtered = false;

  assert.throws(
    () => renderSuggestionQueue(response),
    /server-filtered/
  );
  assert.throws(
    () => renderSuggestionCard(suggestionFixture({ assertion_type: "approved" })),
    /model_suggested/
  );
  assert.throws(
    () => renderSuggestionCard(suggestionFixture({ release_id: "release-2026-01" })),
    /approved or released/
  );
});

function suggestionsResponse() {
  return {
    schema_version: "phase6.curation-api.v1",
    generated_at: "2026-06-27T08:42:00.000Z",
    tenant_id: "tenant-a",
    environment: "validation",
    scope: { type: "document", document_id: "doc:label-1", suggestion_types: ["entity_linking", "synonym", "relationship", "duplicate"] },
    suggestions: [
      suggestionFixture({ suggestion_id: "suggestion:entity-link", suggestion_type: "entity_linking" }),
      suggestionFixture({ suggestion_id: "suggestion:synonym", suggestion_type: "synonym", prompt_version: null }),
      suggestionFixture({ suggestion_id: "suggestion:relationship", suggestion_type: "relationship", score: 0.81 }),
      suggestionFixture({ suggestion_id: "suggestion:duplicate", suggestion_type: "duplicate", duplicate_status: "duplicate_flagged" })
    ],
    visible_count: 4,
    filtered_count: 9,
    authorization_filtered: true,
    policy_notice: "Suggestions are filtered by tenant, role, environment, and source entitlements."
  };
}

function feedbackResponse() {
  return {
    schema_version: "phase6.curation-api.v1",
    tenant_id: "tenant-a",
    environment: "validation",
    authorization_filtered: true,
    policy_notice: "Feedback is captured for governed review and does not approve or release suggestions.",
    feedback: {
      feedback_id: "feedback:p6-1",
      suggestion_id: "suggestion:visible",
      action: "revise",
      decision: "revise",
      rationale: "Correct target entity before review.",
      reviewer_user_id: "user:curator-p6",
      reviewer_role_key: "curator",
      correlation_id: "feedback:p6-1",
      occurred_at: "2026-06-27T08:43:00.000Z",
      revision: { target_entity_id: "pharment:target/PTGS1" },
      candidate: suggestionFixture({ suggestion_id: "suggestion:visible" })
    },
    workflow: {
      routed: true,
      workflow_event_id: "workflow:p6-feedback-1",
      queue: "curation_review",
      state: "feedback_captured"
    }
  };
}

function suggestionFixture(overrides = {}) {
  return {
    id: "suggestion:visible",
    candidate_id: "suggestion:visible",
    suggestion_id: "suggestion:visible",
    tenant_id: "tenant-a",
    environment: "validation",
    suggestion_type: "entity_linking",
    proposal_type: "mapping",
    assertion_type: "model_suggested",
    lifecycle_status: "proposed",
    review_status: "proposed",
    release_id: null,
    candidate_payload: { label: "aspirin inhibits PTGS1", target_entity_id: "pharment:target/PTGS1" },
    payload: {
      assertion_type: "model_suggested",
      evidence_refs: [{ evidence_id: "pharmev:evidence-p6-1", evidence_role: "supports" }],
      source_spans: [{ source_id: "source:label", document_id: "doc:label-1", evidence_id: "pharmev:evidence-p6-1", start_offset: 12, end_offset: 34, text: "aspirin inhibits PTGS1" }]
    },
    model_name: "p6-curation-baseline",
    model_version: "model:biomed-curation-1",
    prompt_version: "prompt:entity-link-v1",
    score: 0.92,
    confidence_score: 0.92,
    confidence_band: "high",
    confidence_source: "model_calibrated_score",
    confidence: {
      score: 0.92,
      band: "high",
      source: "calibrated_model_score",
      fabricated: false,
      calibration: { metrics_source: "phase6-calibration-report" }
    },
    calibration: { confidence_band: "high", metrics_source: "phase6-calibration-report" },
    evidence_refs: [{ evidence_id: "pharmev:evidence-p6-1", evidence_role: "supports", required_for_release: true }],
    source_spans: [{ source_id: "source:label", document_id: "doc:label-1", evidence_id: "pharmev:evidence-p6-1", start_offset: 12, end_offset: 34, text: "aspirin inhibits PTGS1" }],
    provenance_id: "pharmprov:p6-suggestion",
    duplicate_status: "not_duplicate",
    rationale: "Candidate extracted from source span.",
    governance: {
      auto_publish: false,
      requires_human_review: true,
      release_eligible: false,
      released_graph_target: null,
      visual_state: "ai_suggestion_distinct",
      approval_state: "unapproved",
      duplicate_policy: "not_applicable"
    },
    safety: {
      faers_context: true,
      causality_allowed: false,
      faers_causal_blocked: true
    },
    workflow: {
      queue: "curation_review",
      state: "curator-review",
      low_confidence: false,
      review_required: true,
      routing_reason: "model_suggested",
      routing_policy_id: "policy:p6-default",
      confidence_band: "high",
      risk_level: "medium"
    },
    actions: { can_accept: true, can_reject: true, can_revise: true },
    ...overrides
  };
}
