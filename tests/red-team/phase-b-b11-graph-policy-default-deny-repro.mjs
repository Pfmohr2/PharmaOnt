import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ReleaseSnapshotService,
  ShaclRunner,
  assertGraphWritePolicy,
  relationshipAssertionTurtle,
  tenantReleaseGraph,
  tenantWorkingGraph
} from "../../services/semantic-store/src/index.js";

test("B11 NO-GO repro: relationship graph privileged caller cannot be forged outside RelationshipAssertionStore", () => {
  assert.throws(
    () => assertGraphWritePolicy({
      tenantId: "acme",
      graphName: tenantWorkingGraph("acme", "relationships"),
      caller: "relationship_assertion_store",
      operation: "forged privileged write",
      kind: "working"
    }),
    /reserved|RelationshipAssertionStore|privileged|governed/i
  );
});

test("B11 NO-GO repro: release snapshot must not bulk-copy relationships graph without graph write policy", async () => {
  const tenantId = "acme";
  const workingGraph = tenantWorkingGraph(tenantId, "relationships");
  const releaseGraph = tenantReleaseGraph(tenantId, "b11-release-copy", "relationships");
  const fusekiClient = new FakeFusekiClient(new Map([
    [workingGraph, relationshipAssertionTurtle({
      tenantId,
      graphName: workingGraph,
      assertion: validRelationshipAssertion()
    })]
  ]));
  const service = new ReleaseSnapshotService({
    fusekiClient,
    shaclRunner: new ShaclRunner(),
    manifestRoot: mkdtempSync(join(tmpdir(), "b11-release-snapshot-"))
  });

  await assert.rejects(
    () => service.createReleaseSnapshot({
      tenantId,
      releaseId: "b11-release-copy",
      workingGraph,
      domain: "relationships",
      sourceVersionPins: [{ source_name: "B11 release source", source_version: "2026-06-27" }],
      approvalTrace: [{ role: "release_manager", actor: "probe", decision: "approved" }],
      validationReportRefs: [{ validation_run_id: "validation:b11", result: "passed" }],
      auditEventRange: { first: "audit:first", last: "audit:last" }
    }),
    /relationship graph|reserved|governed|RelationshipAssertionStore/i
  );

  assert.equal(fusekiClient.copyCalls.length, 0, "relationships graph family must not be bulk-copied");
  assert.equal(fusekiClient.graphs.has(releaseGraph), false, "relationships release graph must not be created by generic release snapshot");
});

class FakeFusekiClient {
  constructor(graphs = new Map()) {
    this.graphs = graphs;
    this.copyCalls = [];
  }

  async graphHasTriples(graphName) {
    return Boolean(this.graphs.get(graphName)?.trim());
  }

  async getGraph(graphName) {
    return this.graphs.get(graphName) ?? "";
  }

  async copyGraph(sourceGraph, targetGraph) {
    this.copyCalls.push({ sourceGraph, targetGraph });
    this.graphs.set(targetGraph, this.graphs.get(sourceGraph) ?? "");
  }

  async query() {
    return { boolean: false };
  }
}

function validRelationshipAssertion() {
  return {
    schema_version: "semantic-bridge.relationship-assertion.v1",
    relationship_assertion_id: "ra:b11:release-snapshot-copy",
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
        evidence_id: "bridge-evidence-release-copy",
        evidence_role: "supports",
        source_name: "B11 release source",
        source_version: "2026-06-27",
        source_record_id: "record-release-copy",
        source_span_ids: ["span:release-copy"],
        evidence_type: "source_record",
        required_for_release: true,
        disclaimer_ids: ["source_terms:b11"]
      }
    ],
    source_record_ids: ["record-release-copy"],
    source_names: ["B11 release source"],
    source_versions: ["2026-06-27"],
    confidence: {
      confidence_score: 0.87,
      confidence_band: "high",
      confidence_source: "reviewer_decision",
      calibration_id: null,
      fabricated: false,
      confidence_rationale: "Release snapshot probe."
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
    provenance_id: "pharmprov:b11-release-copy",
    provenance: {
      actor: "user:curator",
      activity: "approve",
      method: "reviewer_decision",
      source: {
        source_name: "B11 release source",
        source_version: "2026-06-27"
      },
      time: "2026-06-27T16:30:00.000Z",
      audit_event_id: "audit:b11-release-copy"
    }
  };
}
