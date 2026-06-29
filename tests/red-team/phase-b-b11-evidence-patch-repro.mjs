import assert from "node:assert/strict";
import test from "node:test";

import { PhaseBRelationshipAssertionApi } from "../../services/api/src/index.js";
import {
  createGovernedRelationshipAssertionStore,
  MemoryRelationshipAssertionAuditStore,
  ShaclRunner
} from "../../services/semantic-store/src/index.js";

test("B11 NO-GO repro: PATCH evidence on approved assertion must demote to in_review", async () => {
  const currentAssertion = validRelationshipAssertion();
  const api = new PhaseBRelationshipAssertionApi({
    relationshipAssertionStore: createGovernedRelationshipAssertionStore({
      fusekiClient: new FakeFusekiClient(),
      shaclRunner: new ShaclRunner(),
      auditStore: new MemoryRelationshipAssertionAuditStore()
    }),
    resolveRelationshipAssertionById: async () => ({ assertion: currentAssertion }),
    clock: () => new Date("2026-06-27T16:45:00.000Z")
  });

  const response = await api.patchRelationshipAssertion({
    principal: {
      principal_type: "human",
      user_id: "user:curator",
      tenant_id: "acme",
      environment: "test",
      role_keys: ["curator"]
    },
    relationshipAssertionId: currentAssertion.relationship_assertion_id,
    patch: {
      evidence_refs: [
        {
          evidence_id: "bridge-evidence-mutated",
          evidence_role: "supports",
          source_name: "B11 mutated source",
          source_version: "2026-06-28",
          source_record_id: "record-mutated",
          source_span_ids: ["span:mutated"],
          evidence_type: "source_record",
          required_for_release: true
        }
      ],
      source_record_ids: ["record-mutated"],
      source_names: ["B11 mutated source"],
      source_versions: ["2026-06-28"]
    }
  });

  assert.equal(response.relationship_assertion.evidence_refs[0].evidence_id, "bridge-evidence-mutated");
  assert.equal(response.relationship_assertion.review_status, "in_review");
  assert.equal(response.relationship_assertion.reviewed_by, null);
  assert.equal(response.relationship_assertion.reviewed_at, null);
});

class FakeFusekiClient {
  constructor() {
    this.graphs = new Map();
    this.insertCalls = [];
  }

  async getGraph(graphName) {
    return this.graphs.get(graphName) ?? "";
  }

  async insertTurtle(graphName, turtle) {
    this.insertCalls.push({ graphName, turtle });
    const existing = this.graphs.get(graphName) ?? "";
    this.graphs.set(graphName, [existing.trim(), turtle.trim()].filter(Boolean).join("\n\n"));
  }
}

function validRelationshipAssertion(overrides = {}) {
  return deepMerge({
    schema_version: "semantic-bridge.relationship-assertion.v1",
    relationship_assertion_id: "ra:b11:evidence-patch",
    tenant_id: "acme",
    environment: "test",
    source_entity_id: "compound-b11",
    target_entity_id: "target-b11",
    predicate: "compound_has_target",
    relationship_class: "mechanistic",
    assertion_type: "human_curated",
    directionality: "directed",
    polarity: "positive",
    causal_claim_status: "not_causal",
    evidence_refs: [
      {
        evidence_id: "bridge-evidence-original",
        evidence_role: "supports",
        source_name: "B11 original source",
        source_version: "2026-06-27",
        source_record_id: "record-original",
        source_span_ids: ["span:original"],
        evidence_type: "source_record",
        required_for_release: true
      }
    ],
    source_record_ids: ["record-original"],
    source_names: ["B11 original source"],
    source_versions: ["2026-06-27"],
    confidence: {
      confidence_score: 0.87,
      confidence_band: "high",
      confidence_source: "reviewer_decision",
      calibration_id: null,
      fabricated: false,
      confidence_rationale: "Original reviewed evidence."
    },
    review_status: "approved",
    reviewed_by: "user:reviewer",
    reviewed_at: "2026-06-27T16:30:00.000Z",
    release_context: {
      release_id: null,
      scope: "working",
      included_in_release: false,
      release_candidate_id: null
    },
    data_license: {
      license_status: "valid",
      license_classification: "open_materializable",
      license_policy_id: "license-policy:b11",
      permitted_uses: ["search", "evidence", "export", "release"],
      export_restrictions: [],
      data_sensitivity: "public"
    },
    known_limitations: ["B11 fixture only."],
    warnings: [],
    blocked_rationale: null,
    validation_report_ids: [],
    created_by: "user:curator",
    created_at: "2026-06-27T16:29:00.000Z",
    updated_at: "2026-06-27T16:30:00.000Z",
    provenance_id: "pharmprov:b11",
    provenance: {
      actor: "user:curator",
      activity: "relationship_assertion_created",
      method: "manual_curation",
      source: {
        source_name: "B11 original source",
        source_version: "2026-06-27"
      },
      time: "2026-06-27T16:30:00.000Z",
      audit_event_id: "audit:b11"
    }
  }, overrides);
}

function deepMerge(base, overrides) {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
