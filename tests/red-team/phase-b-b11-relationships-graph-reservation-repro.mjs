import assert from "node:assert/strict";
import test from "node:test";

import {
  MappingStore,
  SemanticGraphWriter,
  ShaclRunner,
  relationshipAssertionTurtle,
  tenantWorkingGraph
} from "../../services/semantic-store/src/index.js";

test("B11 NO-GO repro: graph-writer relationship reservation must reject case/domain near-miss replacement", async () => {
  for (const graphName of [
    "graph:tenant:acme:Relationships:working",
    "graph:tenant:acme:relationships:shadow:working"
  ]) {
    const fusekiClient = new FakeFusekiClient();
    const writer = new SemanticGraphWriter({
      fusekiClient,
      shaclRunner: new ShaclRunner()
    });

    await assert.rejects(
      () => writer.replaceValidatedWorkingGraph({
        tenantId: "acme",
        graphName,
        turtle: relationshipAssertionTurtle({
          tenantId: "acme",
          graphName,
          assertion: validRelationshipAssertion()
        }),
        fixtureName: "b11-relationships-near-miss-replace.ttl"
      }),
      /relationship graph|reserved|conflict/i,
      `${graphName} must not accept RelationshipAssertion replacement outside RelationshipAssertionStore`
    );

    assert.equal(fusekiClient.putGraphCalls.length, 0, `${graphName} must not be replaced`);
  }
});

test("B11 NO-GO repro: other semantic stores must not write into the reserved relationships graph", async () => {
  const fusekiClient = new FakeFusekiClient();
  const graphName = tenantWorkingGraph("acme", "relationships");
  const store = new MappingStore({
    fusekiClient,
    shaclRunner: new ShaclRunner()
  });

  await assert.rejects(
    () => store.createMapping({
      tenantId: "acme",
      graphName,
      mapping: validMappingObject()
    }),
    /relationship graph|reserved|dedicated|relationships/i
  );

  assert.equal(fusekiClient.insertCalls.length, 0, "reserved relationships graph must not receive MappingStore writes");
});

class FakeFusekiClient {
  constructor() {
    this.graphs = new Map();
    this.insertCalls = [];
    this.putGraphCalls = [];
  }

  async putGraph(graphName, turtle) {
    this.putGraphCalls.push({ graphName, turtle });
    this.graphs.set(graphName, turtle);
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
    relationship_assertion_id: "ra:b11:relationships-reservation",
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
        evidence_id: "bridge-evidence-reservation",
        evidence_role: "supports",
        source_name: "B11 reservation source",
        source_version: "2026-06-27",
        source_record_id: "record-reservation",
        source_span_ids: ["span:reservation"],
        evidence_type: "source_record",
        required_for_release: true
      }
    ],
    source_record_ids: ["record-reservation"],
    source_names: ["B11 reservation source"],
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
    provenance_id: "pharmprov:b11-reservation",
    provenance: {
      actor: "user:curator",
      activity: "relationship_assertion_created",
      method: "manual_curation",
      source: {
        source_name: "B11 reservation source",
        source_version: "2026-06-27"
      },
      time: "2026-06-27T16:30:00.000Z",
      audit_event_id: "audit:b11-reservation"
    }
  }, overrides);
}

function validMappingObject(overrides = {}) {
  return {
    mapping_id: "pharmmap:b11-reserved-relationships-graph",
    source_entity_id: "chembl:CHEMBL25",
    target_entity_id: "pubchem:CID2244",
    predicate: "exactMatch",
    source_vocabulary: "ChEMBL",
    source_vocabulary_version: "34",
    target_vocabulary: "PubChem",
    target_vocabulary_version: "2026-06-01",
    source_license_classification: "open_with_attribution",
    source_license_policy_id: "license-policy:chembl-34",
    target_license_classification: "open_with_attribution",
    target_license_policy_id: "license-policy:pubchem-2026-06-01",
    data_sensitivity: "public",
    materialization_policy: "materialize",
    permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
    export_restrictions: ["attribution_required"],
    disclaimer_ids: ["source_terms:chembl"],
    legal_approval_id: null,
    retention_class: "public_source_snapshot",
    license_status: "valid",
    confidence_score: 0.99,
    confidence_band: "high",
    evidence_ids: ["pharmev:evidence-b11-reserved-relationships-graph"],
    evidence_refs: [
      {
        evidence_id: "pharmev:evidence-b11-reserved-relationships-graph",
        evidence_role: "supports",
        required_for_release: true
      }
    ],
    provenance_id: "pharmprov:mapping/b11-reserved-relationships-graph",
    created_by: "service:normalization",
    reviewed_by: "user:curator-1",
    review_status: "approved",
    release_id: null,
    provenance: {
      actor: "service:normalization",
      timestamp: "2026-06-27T01:20:00.000Z",
      source: "ChEMBL",
      source_version: "34",
      audit_event_id: "audit:b11-reserved-relationships-graph"
    },
    ...overrides
  };
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
