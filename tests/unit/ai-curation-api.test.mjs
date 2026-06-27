import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AiCurationApiError,
  createPhase6AiCurationApi
} from "../../services/api/src/index.js";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const curator = Object.freeze({
  user_id: "user:curator-p6",
  tenant_id: "tenant-a",
  environment: "validation",
  role_keys: ["curator"]
});

test("Phase 6 AI curation OpenAPI contract is published for suggestions and feedback", () => {
  const contract = JSON.parse(readFileSync(resolve(repoRoot, "docs/api/phase6-curation.openapi.json"), "utf8"));

  assert.equal(contract.openapi, "3.1.0");
  assert.equal(contract.info.version, "phase6.curation-api.v1");
  assert.ok(contract.paths["/api/curation/suggestions"]);
  assert.ok(contract.paths["/api/curation/suggestions/{suggestionId}/feedback"]);
  assert.equal(contract.components.schemas.AiSuggestion.properties.assertion_type.const, "model_suggested");
  assert.equal(contract.components.schemas.AiSuggestion.properties.lifecycle_status.const, "proposed");
  assert.equal(contract.components.schemas.AiSuggestion.properties.release_id.type, "null");
  assert.ok(contract.components.schemas.AiSuggestion.properties.suggestion_type.enum.includes("entity_linking"));
  assert.ok(contract.components.schemas.AiSuggestion.required.includes("source_spans"));
  assert.ok(contract.components.schemas.AiSuggestion.required.includes("model_version"));
  assert.ok(contract.components.schemas.AiSuggestion.required.includes("candidate_id"));
  assert.ok(contract.components.schemas.FeedbackRequest.properties.action.enum.includes("revise"));
});

test("Phase 6 suggestions are authorized model_suggested candidates with provenance, evidence, score, and spans", async () => {
  const api = fixtureApi({
    suggestions: [
      suggestionFixture({ suggestion_id: "suggestion:visible", score: 0.92 }),
      suggestionFixture({ suggestion_id: "suggestion:cross-tenant", tenant_id: "tenant-b" }),
      suggestionFixture({ suggestion_id: "suggestion:low-confidence", score: 0.42, duplicate_status: "possible_duplicate" })
    ]
  });

  const response = await api.fetchSuggestions({
    principal: curator,
    request: {
      scope: { type: "document", document_id: "doc:label-1", suggestion_types: ["relationship", "synonym"] }
    }
  });

  assert.equal(response.schema_version, "phase6.curation-api.v1");
  assert.equal(response.authorization_filtered, true);
  assert.equal(response.visible_count, 2);
  assert.equal("filtered_count" in response, false);
  assert.deepEqual(response.suggestions.map((suggestion) => suggestion.suggestion_id), [
    "suggestion:visible",
    "suggestion:low-confidence"
  ]);
  assert.ok(response.suggestions.every((suggestion) => suggestion.assertion_type === "model_suggested"));
  assert.ok(response.suggestions.every((suggestion) => suggestion.lifecycle_status === "proposed"));
  assert.ok(response.suggestions.every((suggestion) => suggestion.release_id === null));
  assert.equal(response.suggestions[0].model_version, "model:biomed-curation-1");
  assert.equal(response.suggestions[0].prompt_version, "prompt:relationship-v1");
  assert.equal(response.suggestions[0].evidence_refs[0].evidence_id, "pharmev:evidence-p6-1");
  assert.equal(response.suggestions[0].source_spans[0].start_offset, 12);
  assert.equal(response.suggestions[1].duplicate_status, "possible_duplicate");
  assert.equal(response.suggestions[1].workflow.queue, "expert_review");
});

test("Phase 6 API accepts Andy ai-suggestion-candidate.v1 shape", async () => {
  const api = fixtureApi({
    suggestions: [andySuggestionFixture()]
  });

  const response = await api.fetchSuggestions({
    principal: curator,
    request: { scope: { type: "entity", entity_id: "pharment:compound/aspirin" } }
  });

  assert.equal(response.visible_count, 1);
  assert.equal(response.suggestions[0].schema_version, "ai-suggestion-candidate.v1");
  assert.equal(response.suggestions[0].candidate_id, "aisug:andy-1");
  assert.equal(response.suggestions[0].suggestion_type, "entity_linking");
  assert.equal(response.suggestions[0].proposal_type, "mapping");
  assert.equal(response.suggestions[0].model_version, "2026-06-27");
  assert.equal(response.suggestions[0].prompt_version, "p6-ai-curation-v1");
  assert.equal(response.suggestions[0].score, 0.88);
  assert.equal(response.suggestions[0].calibration.calibration_id, "cal:p6-curation-baseline");
  assert.equal(response.suggestions[0].source_spans[0].source_id, "doc:ctgov:NCT00000001");
});

test("Phase 6 API permits non-causal FAERS disclaimers but rejects causal FAERS claims", async () => {
  const nonCausal = andySuggestionFixture({
    suggestion_id: "aisug:faers-non-causal",
    candidate_id: "aisug:faers-non-causal",
    suggestion_type: "relationship",
    proposal_type: "relationship",
    candidate_payload: {
      subject_id: "pharment:compound/aspirin",
      predicate: "pharm:associatedWithAdverseEvent",
      object_id: "pharment:adverse-event/bleeding",
      relationship_type: "safety_signal_association",
      claim_type: "association"
    },
    payload: {
      assertion_type: "model_suggested",
      subject_id: "pharment:compound/aspirin",
      predicate: "pharm:associatedWithAdverseEvent",
      object_id: "pharment:adverse-event/bleeding",
      relationship_type: "safety_signal_association",
      claim_type: "association",
      evidence_refs: [{
        evidence_id: "pharmev:faers-case",
        evidence_role: "supports",
        source_name: "openFDA FAERS",
        source_version: "2026Q1",
        source_span_ids: ["span:faers"],
        disclaimer_ids: ["source_limit:faers_non_causal"],
        source_limitations: [
          "FAERS/openFDA reports are non-causal safety reports and cannot establish incidence, prevalence, comparative risk, product fault, or causation."
        ]
      }],
      source_spans: [{
        span_id: "span:faers",
        source_record_id: "FAERS-P6",
        source_id: "FAERS-P6",
        document_id: "FAERS-P6",
        field_path: "text",
        start_offset: 0,
        end_offset: 52,
        text: "FAERS reports include aspirin and bleeding co-reports.",
        evidence_id: "pharmev:faers-case"
      }]
    },
      evidence_refs: [{
        evidence_id: "pharmev:faers-case",
        evidence_role: "supports",
        source_name: "openFDA FAERS",
        source_version: "2026Q1",
        source_span_ids: ["span:faers"],
        disclaimer_ids: ["source_limit:faers_non_causal"],
        source_limitations: [
        "FAERS/openFDA reports are non-causal safety reports and cannot establish incidence, prevalence, comparative risk, product fault, or causation."
      ]
    }],
    source_spans: [{
      span_id: "span:faers",
      source_record_id: "FAERS-P6",
      source_id: "FAERS-P6",
      document_id: "FAERS-P6",
      field_path: "text",
      start_offset: 0,
      end_offset: 52,
      text: "FAERS reports include aspirin and bleeding co-reports.",
      evidence_id: "pharmev:faers-case"
    }],
    provenance: {
      ...andySuggestionFixture().provenance,
      source: { source_name: "openFDA FAERS", source_version: "2026Q1" }
    },
    safety: {
      faers_context: true,
      causality_allowed: false,
      faers_causal_blocked: true
    }
  });
  const response = await fixtureApi({ suggestions: [nonCausal] }).fetchSuggestions({
    principal: curator,
    request: { scope: { type: "queue", queue_id: "curation_review" } }
  });
  assert.equal(response.visible_count, 1);
  assert.equal(response.suggestions[0].evidence_refs[0].source_limitations[0].includes("comparative risk"), true);

  await assert.rejects(
    () => fixtureApi({
      suggestions: [andySuggestionFixture({
        ...nonCausal,
        suggestion_id: "aisug:faers-causal",
        candidate_id: "aisug:faers-causal",
        candidate_payload: {
          ...nonCausal.candidate_payload,
          predicate: "causes",
          claim_type: "causal"
        }
      })]
    }).fetchSuggestions({
      principal: curator,
      request: { scope: { type: "queue", queue_id: "curation_review" } }
    }),
    /FAERS\/openFDA suggestions cannot be causal/
  );
});

test("Phase 6 suggestion fetch fails closed on unsafe or incomplete AI candidates", async () => {
  for (const badSuggestion of [
    suggestionFixture({ suggestion_id: "suggestion:approved", lifecycle_status: "approved" }),
    suggestionFixture({ suggestion_id: "suggestion:release", release_id: "release-2026-01" }),
    suggestionFixture({ suggestion_id: "suggestion:fabricated", confidence_source: "fabricated" }),
    { ...suggestionFixture({ suggestion_id: "suggestion:no-evidence" }), evidence_refs: [] },
    { ...suggestionFixture({ suggestion_id: "suggestion:no-span" }), source_spans: [] },
    andySuggestionFixture({
      suggestion_id: "suggestion:duplicate-merge",
      candidate_id: "suggestion:duplicate-merge",
      suggestion_type: "duplicate",
      duplicate_status: "possible_duplicate",
      governance: { ...andySuggestionFixture().governance, duplicate_policy: "flag_only_never_merge" },
      candidate_payload: { entity_id: "a", duplicate_entity_id: "b", merge_allowed: true }
    }),
    suggestionFixture({
      suggestion_id: "suggestion:faers-causal",
      source_name: "openFDA FAERS",
      predicate: "causes",
      claim_type: "causal"
    })
  ]) {
    await assert.rejects(
      () => fixtureApi({ suggestions: [badSuggestion] }).fetchSuggestions({
        principal: curator,
        request: { scope: { type: "queue", queue_id: "queue:p6" } }
      }),
      AiCurationApiError
    );
  }
});

test("Phase 6 suggestion fetch rejects resolver output that masquerades as approved with loose evidence", async () => {
  const masquerade = andySuggestionFixture({
    suggestion_id: "suggestion:masquerade-approved",
    candidate_id: "suggestion:masquerade-approved",
    payload: {
      assertion_type: "approved",
      evidence_refs: [{}],
      source_spans: [{
        evidence_id: "pharmev:loose",
        start_offset: 3,
        end_offset: 9
      }]
    },
    evidence_refs: [{}],
    source_spans: [{
      evidence_id: "pharmev:loose",
      start_offset: 3,
      end_offset: 9
    }],
    confidence_source: "manual_override",
    confidence: {
      score: 0.91,
      band: "high",
      source: "manual_override",
      fabricated: false,
      calibration: null
    }
  });

  await assert.rejects(
    () => fixtureApi({ suggestions: [masquerade] }).fetchSuggestions({
      principal: curator,
      request: { scope: { type: "queue", queue_id: "queue:p6" } }
    }),
    /nested payload cannot masquerade/
  );

  const looseCandidate = {
    ...masquerade,
    payload: {
      ...masquerade.payload,
      assertion_type: "model_suggested"
    }
  };
  await assert.rejects(
    () => fixtureApi({ suggestions: [looseCandidate] }).fetchSuggestions({
      principal: curator,
      request: { scope: { type: "queue", queue_id: "queue:p6" } }
    }),
    /strict candidate validation/
  );
});

test("Phase 6 feedback is authorized, no-auto-release gated, and routed to workflow", async () => {
  const calls = [];
  const api = fixtureApi({
    authorizeFeedback: async ({ feedback, action }) => {
      calls.push(["authorize", feedback.suggestion_id, action]);
      return { decision: "allow", decision_id: "decision:p6-feedback" };
    },
    enforceNoAutoRelease: async ({ feedback }) => {
      calls.push(["gate", feedback.suggestion_id]);
      return { allowed: true, gate_id: "gate:no-auto-release" };
    },
    recordSuggestionFeedback: async ({ feedback }) => {
      calls.push(["workflow", feedback.suggestion_id, feedback.action]);
      return {
        workflow_event_id: "workflow:p6-feedback-1",
        queue: "curation_review",
        state: "feedback_captured"
      };
    }
  });

  const response = await api.submitFeedback({
    principal: curator,
    request: {
      suggestion_id: "suggestion:visible",
      action: "revise",
      rationale: "Correct target entity before review.",
      candidate: suggestionFixture({ suggestion_id: "suggestion:visible" }),
      revision: {
        target_entity_id: "pharment:target/PTGS1"
      }
    }
  });

  assert.equal(response.schema_version, "phase6.curation-api.v1");
  assert.equal(response.authorization_filtered, true);
  assert.equal(response.feedback.action, "revise");
  assert.equal(response.feedback.decision, "revise");
  assert.equal(response.feedback.reviewer_user_id, "user:curator-p6");
  assert.equal(response.feedback.reviewer_role_key, "curator");
  assert.equal(response.feedback.correlation_id, response.feedback.feedback_id);
  assert.equal(response.feedback.candidate.assertion_type, "model_suggested");
  assert.equal(response.feedback.candidate.release_id, null);
  assert.equal(response.workflow.routed, true);
  assert.equal(response.workflow.workflow_event_id, "workflow:p6-feedback-1");
  assert.deepEqual(calls, [
    ["authorize", "suggestion:visible", "ai_suggestion.revise"],
    ["gate", "suggestion:visible"],
    ["workflow", "suggestion:visible", "revise"]
  ]);
});

test("Phase 6 feedback fails closed without authorization, no-auto-release gate, or workflow routing", async () => {
  assert.throws(
    () => createPhase6AiCurationApi({
      resolveSuggestions: async () => [],
      recordSuggestionFeedback: async () => ({})
    }),
    AiCurationApiError
  );

  await assert.rejects(
    () => fixtureApi({
      authorizeFeedback: async () => ({ decision: "deny" })
    }).submitFeedback({
      principal: curator,
      request: feedbackRequest()
    }),
    /authorization denied/
  );

  await assert.rejects(
    () => fixtureApi({
      enforceNoAutoRelease: async () => ({ allowed: false })
    }).submitFeedback({
      principal: curator,
      request: feedbackRequest()
    }),
    /no-auto-release/
  );

  await assert.rejects(
    () => fixtureApi({
      recordSuggestionFeedback: async () => null
    }).submitFeedback({
      principal: curator,
      request: feedbackRequest()
    }),
    /workflow feedback hook/
  );
});

function fixtureApi({
  suggestions = [],
  authorizeFeedback = async () => ({ decision: "allow", decision_id: "decision:p6" }),
  enforceNoAutoRelease = async () => ({ allowed: true, gate_id: "gate:p6" }),
  recordSuggestionFeedback = async () => ({ workflow_event_id: "workflow:p6", queue: "curation_review" })
} = {}) {
  return createPhase6AiCurationApi({
    clock: () => new Date("2026-06-27T08:30:00.000Z"),
    idFactory: (() => {
      let id = 0;
      return () => `fixture-${++id}`;
    })(),
    async resolveSuggestions() {
      return suggestions;
    },
    authorizeFeedback,
    enforceNoAutoRelease,
    recordSuggestionFeedback
  });
}

function feedbackRequest(overrides = {}) {
  return {
    suggestion_id: "suggestion:visible",
    action: "accept",
    rationale: "Looks correct for review.",
    candidate: suggestionFixture({ suggestion_id: "suggestion:visible" }),
    ...overrides
  };
}

function suggestionFixture(overrides = {}) {
  const score = overrides.score ?? overrides.confidence_score ?? overrides.confidence?.score ?? 0.91;
  const id = overrides.suggestion_id ?? overrides.candidate_id ?? "suggestion:visible";
  return andySuggestionFixture({
    candidate_id: id,
    suggestion_id: id,
    id,
    suggestion_type: "relationship",
    proposal_type: "relationship",
    candidate_payload: {
      subject_id: "pharment:compound/aspirin",
      predicate: "pharm:hasKnownTarget",
      object_id: "pharment:target/PTGS1",
      relationship_type: "pharm:hasKnownTarget",
      claim_type: "association"
    },
    payload: {
      assertion_type: "model_suggested",
      subject_id: "pharment:compound/aspirin",
      predicate: "pharm:hasKnownTarget",
      object_id: "pharment:target/PTGS1",
      relationship_type: "pharm:hasKnownTarget",
      claim_type: "association",
      evidence_refs: [{
        evidence_id: "pharmev:evidence-p6-1",
        evidence_role: "supports",
        source_name: "ClinicalTrials.gov",
        source_version: "2026-06-01",
        source_span_ids: ["span:p6-api"]
      }],
      source_spans: [{
        span_id: "span:p6-api",
        source_record_id: "doc:label-1",
        source_id: "doc:label-1",
        document_id: "doc:label-1",
        field_path: "text",
        evidence_id: "pharmev:evidence-p6-1",
        start_offset: 12,
        end_offset: 48,
        text: "aspirin inhibits PTGS1"
      }]
    },
    score,
    confidence_score: score,
    confidence_band: score >= 0.85 ? "high" : score >= 0.65 ? "medium" : score >= 0.35 ? "low" : "blocked",
    confidence_source: "model_calibrated_score",
    confidence: {
      score,
      band: score >= 0.85 ? "high" : score >= 0.65 ? "medium" : score >= 0.35 ? "low" : "blocked",
      source: "calibrated_model_score",
      fabricated: false,
      calibration: {
        calibration_id: "cal:p6-api-fixture",
        calibration_version: "2026-06-27",
        calibration_method: "heldout-review-set",
        calibrated_score: score,
        sample_size: 120,
        metrics_source: "phase6-calibration-report"
      }
    },
    model: {
      model_id: "model:biomed-curation-1",
      model_version: "model:biomed-curation-1",
      prompt_version: "prompt:relationship-v1"
    },
    model_name: "model:biomed-curation-1",
    model_version: "model:biomed-curation-1",
    prompt_version: "prompt:relationship-v1",
    evidence_refs: [{
      evidence_id: "pharmev:evidence-p6-1",
      evidence_role: "supports",
      source_name: "ClinicalTrials.gov",
      source_version: "2026-06-01",
      source_span_ids: ["span:p6-api"]
    }],
    source_spans: [{
      span_id: "span:p6-api",
      source_record_id: "doc:label-1",
      source_id: "doc:label-1",
      document_id: "doc:label-1",
      field_path: "text",
      evidence_id: "pharmev:evidence-p6-1",
      start_offset: 12,
      end_offset: 48,
      text: "aspirin inhibits PTGS1"
    }],
      provenance_id: "pharmprov:ai-suggestion/p6-1",
      provenance: {
        provenance_id: "pharmprov:ai-suggestion/p6-1",
        model_name: "model:biomed-curation-1",
        model_version: "model:biomed-curation-1",
        evidence_refs: [{
          evidence_id: "pharmev:evidence-p6-1",
          evidence_role: "supports",
          source_name: "ClinicalTrials.gov",
          source_version: "2026-06-01",
          source_span_ids: ["span:p6-api"]
        }],
        source_spans: [{
          span_id: "span:p6-api",
          source_record_id: "doc:label-1",
          source_id: "doc:label-1",
          document_id: "doc:label-1",
          field_path: "text",
          evidence_id: "pharmev:evidence-p6-1",
          start_offset: 12,
          end_offset: 48,
          text: "aspirin inhibits PTGS1"
        }],
        actor: "model:model:biomed-curation-1",
        activity: "ai_suggestion_generation",
      method: "ai-curation-candidate-generation",
      source: { source_name: "ClinicalTrials.gov", source_version: "2026-06-01" },
      time: "2026-06-27T12:00:00.000Z",
      audit_event_id: "audit:p6-api"
    },
    rationale: "AI-generated relationship candidate requires governed human review before use.",
    ...overrides
  });
}

function andySuggestionFixture(overrides = {}) {
  const id = overrides.suggestion_id ?? overrides.candidate_id ?? "aisug:andy-1";
  const score = overrides.score ?? overrides.confidence_score ?? overrides.confidence?.score ?? 0.88;
  const confidenceBand = overrides.confidence_band ?? (score >= 0.85 ? "high" : score >= 0.65 ? "medium" : score >= 0.35 ? "low" : "blocked");
  return {
    schema_version: "ai-suggestion-candidate.v1",
    candidate_id: id,
    suggestion_id: id,
    tenant_id: "tenant-a",
    environment: "validation",
    release_id: null,
    suggestion_type: "entity_linking",
    proposal_type: "mapping",
    assertion_type: "model_suggested",
    lifecycle_status: "proposed",
    review_status: "proposed",
    candidate_payload: {
      mention_id: "mention:aspirin",
      candidate_canonical_id: "pharment:compound/aspirin",
      candidate_label: "Aspirin"
    },
    payload: {
      assertion_type: "model_suggested",
      evidence_refs: [{
        evidence_id: "pharmev:ctgov-aspirin",
        evidence_role: "supports",
        source_name: "ClinicalTrials.gov",
        source_version: "2026-06-01",
        source_span_ids: ["span:source"]
      }],
      source_spans: [{
        span_id: "span:source",
        source_record_id: "doc:ctgov:NCT00000001",
        source_id: "doc:ctgov:NCT00000001",
        document_id: "doc:ctgov:NCT00000001",
        field_path: "text",
        start_offset: 10,
        end_offset: 17,
        text: "Aspirin",
        evidence_id: "pharmev:ctgov-aspirin"
      }]
    },
    score,
    confidence_score: score,
    confidence_band: confidenceBand,
    confidence_source: "model_calibrated_score",
    confidence: {
      score,
      band: confidenceBand,
      source: "calibrated_model_score",
      fabricated: false,
      calibration: {
        calibration_id: "cal:p6-curation-baseline",
        calibration_version: "2026-06-27",
        calibration_method: "heldout-review-set",
        calibrated_score: score,
        sample_size: 120,
        metrics_source: "phase6-calibration-report"
      }
    },
    model: {
      model_id: "p6-curation-baseline",
      model_version: "2026-06-27",
      prompt_version: "p6-ai-curation-v1"
    },
    model_name: "p6-curation-baseline",
    model_version: "2026-06-27",
    prompt_version: "p6-ai-curation-v1",
    evidence_refs: [{
      evidence_id: "pharmev:ctgov-aspirin",
      evidence_role: "supports",
      source_name: "ClinicalTrials.gov",
      source_version: "2026-06-01",
      source_span_ids: ["span:source"]
    }],
    source_spans: [{
      span_id: "span:source",
      source_record_id: "doc:ctgov:NCT00000001",
      source_id: "doc:ctgov:NCT00000001",
      document_id: "doc:ctgov:NCT00000001",
      field_path: "text",
      start_offset: 10,
      end_offset: 17,
      text: "Aspirin",
      evidence_id: "pharmev:ctgov-aspirin"
    }],
    provenance_id: "pharmprov:andy-1",
    provenance: {
      provenance_id: "pharmprov:andy-1",
      model_name: "p6-curation-baseline",
      model_version: "2026-06-27",
      evidence_refs: [{
        evidence_id: "pharmev:ctgov-aspirin",
        evidence_role: "supports",
        source_name: "ClinicalTrials.gov",
        source_version: "2026-06-01",
        source_span_ids: ["span:source"]
      }],
      source_spans: [{
        span_id: "span:source",
        source_record_id: "doc:ctgov:NCT00000001",
        source_id: "doc:ctgov:NCT00000001",
        document_id: "doc:ctgov:NCT00000001",
        field_path: "text",
        start_offset: 10,
        end_offset: 17,
        text: "Aspirin",
        evidence_id: "pharmev:ctgov-aspirin"
      }],
      actor: "model:p6-curation-baseline",
      activity: "ai_suggestion_generation",
      method: "ai-curation-candidate-generation",
      source: { source_name: "ClinicalTrials.gov", source_version: "2026-06-01" },
      time: "2026-06-27T12:00:00.000Z",
      audit_event_id: "audit:andy-1"
    },
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
      faers_context: false,
      causality_allowed: true,
      faers_causal_blocked: false
    },
    duplicate_status: "not_duplicate",
    rationale: "AI-generated entity_linking candidate requires governed human review before use.",
    created_at: "2026-06-27T12:00:00.000Z",
    created_by: "service:ai-curation",
    ...overrides
  };
}
