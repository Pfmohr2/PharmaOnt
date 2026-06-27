import assert from "node:assert/strict";
import test from "node:test";

import {
  SemanticGraphWriter,
  ShaclRunner,
  relationshipAssertionTurtle,
  tenantWorkingGraph
} from "../../services/semantic-store/src/index.js";

test("B11 NO-GO repro: generic graph writer must not write relationship assertion subjects", async () => {
  const fusekiClient = new FakeFusekiClient();
  const shaclRunner = new ShaclRunner();
  const graphName = tenantWorkingGraph("acme", "relationships");
  const writer = new SemanticGraphWriter({ fusekiClient, shaclRunner });

  let writeError = null;
  try {
    await writer.insertValidatedWorkingTurtle({
      tenantId: "acme",
      graphName,
      turtle: relationshipAssertionTurtle({
        tenantId: "acme",
        graphName,
        assertion: validRelationshipAssertion()
      }),
      fixtureName: "b11-graph-writer-original.ttl"
    });
  } catch (error) {
    writeError = error;
  }

  if (!writeError) {
    assert.fail("SemanticGraphWriter accepted a write into the governed relationships graph family");
  }

  assert.match(writeError.message, /relationship graph|reserved|conflict/i);
  assert.equal(fusekiClient.graphs.has(graphName), false);
});

class FakeFusekiClient {
  constructor() {
    this.graphs = new Map();
  }

  async getGraph(graphName) {
    return this.graphs.get(graphName) ?? "";
  }

  async insertTurtle(graphName, turtle) {
    const existing = this.graphs.get(graphName) ?? "";
    this.graphs.set(graphName, [existing.trim(), turtle.trim()].filter(Boolean).join("\n\n"));
  }
}

function validRelationshipAssertion(overrides = {}) {
  return deepMerge({
    schema_version: "semantic-bridge.relationship-assertion.v1",
    relationship_assertion_id: "ra:b11:graph-writer-duplicate",
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
        evidence_id: "bridge-evidence-writer-original",
        evidence_role: "supports",
        source_name: "B11 graph writer original source",
        source_version: "2026-06-27",
        source_record_id: "record-writer-original",
        source_span_ids: ["span:writer-original"],
        evidence_type: "source_record",
        required_for_release: true
      }
    ],
    source_record_ids: ["record-writer-original"],
    source_names: ["B11 graph writer original source"],
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
    provenance_id: "pharmprov:b11-writer",
    provenance: {
      actor: "user:curator",
      activity: "relationship_assertion_created",
      method: "manual_curation",
      source: {
        source_name: "B11 graph writer original source",
        source_version: "2026-06-27"
      },
      time: "2026-06-27T16:30:00.000Z",
      audit_event_id: "audit:b11-writer"
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
