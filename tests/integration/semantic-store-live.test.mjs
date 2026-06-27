import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EntityStore,
  MappingStore,
  ReleaseSnapshotService,
  SemanticGraphWriter,
  ShaclRunner,
  tenantReleaseGraph,
  tenantWorkingGraph
} from "../../services/semantic-store/src/index.js";
import { FusekiClient } from "../../services/semantic-store/src/fuseki-client.js";

test("live Fuseki supports working graph entity CRUD and release snapshot skeleton", { timeout: 30000 }, async (t) => {
  const fuseki = new FusekiClient();
  if (!(await canReachFuseki(fuseki))) {
    t.skip("Fuseki is not available; CI starts infra/docker/docker-compose.yml before this live test");
    return;
  }

  const tenantId = `ci${Date.now()}`;
  const releaseId = `2026.0.0-${tenantId}`;
  const workingGraph = tenantWorkingGraph(tenantId, "data:canonical");
  const releaseGraph = tenantReleaseGraph(tenantId, releaseId, "canonical");
  await fuseki.clearGraph(workingGraph);
  await fuseki.clearGraph(releaseGraph);

  const shaclRunner = new ShaclRunner();
  const entityStore = new EntityStore({ fusekiClient: fuseki, shaclRunner });
  await entityStore.createCanonicalEntity({
    tenantId,
    entityId: "compound-live-001",
    entityType: "Compound",
    preferredLabel: "Live CI fixture compound",
    sourceName: "CI fixture",
    sourceVersion: "2026-06-27"
  });

  const entity = await entityStore.getCanonicalEntity({ tenantId, entityId: "compound-live-001" });
  assert.equal(entity.entityType, "Compound");
  assert.equal(entity.preferredLabel, "Live CI fixture compound");
  assert.equal(entity.graphName, workingGraph);

  const releaseService = new ReleaseSnapshotService({
    fusekiClient: fuseki,
    shaclRunner,
    manifestRoot: mkdtempSync(join(tmpdir(), "pharmaops-live-release-"))
  });
  const release = await releaseService.createReleaseSnapshot({
    tenantId,
    releaseId,
    workingGraph,
    sourceVersionPins: [{ source_name: "CI fixture", source_version: "2026-06-27" }],
    approvalTrace: [{ role: "release_manager", actor: "ci", decision: "approved" }],
    validationReportRefs: [{ validation_run_id: "ci-shacl", result: "passed" }],
    auditEventRange: { first: "audit:ci:start", last: "audit:ci:end" }
  });

  assert.equal(release.release_graph, releaseGraph);
  assert.match(release.manifest_digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(await fuseki.graphHasTriples(releaseGraph), true);

  await assert.rejects(
    () => releaseService.createReleaseSnapshot({
      tenantId,
      releaseId,
      workingGraph,
      sourceVersionPins: [{ source_name: "CI fixture", source_version: "2026-06-27" }],
      approvalTrace: [{ role: "release_manager", actor: "ci", decision: "approved" }],
      validationReportRefs: [{ validation_run_id: "ci-shacl", result: "passed" }],
      auditEventRange: { first: "audit:ci:start", last: "audit:ci:end" }
    }),
    /immutable/
  );
});

test("live Fuseki enforces public semantic-store write guards", { timeout: 30000 }, async (t) => {
  const fuseki = new FusekiClient();
  if (!(await canReachFuseki(fuseki))) {
    t.skip("Fuseki is not available; CI starts infra/docker/docker-compose.yml before this live test");
    return;
  }

  const tenantId = `ci${Date.now()}`;
  const shaclRunner = new ShaclRunner();
  const writer = new SemanticGraphWriter({ fusekiClient: fuseki, shaclRunner });
  const mappingStore = new MappingStore({ fusekiClient: fuseki, shaclRunner });
  const workingGraph = tenantWorkingGraph(tenantId, "mappings");
  const releaseGraph = tenantReleaseGraph(tenantId, "guarded-write", "canonical");
  await fuseki.clearGraph(workingGraph);
  await fuseki.clearGraph(releaseGraph);

  await assert.rejects(
    () => writer.insertValidatedWorkingTurtle({
      tenantId,
      graphName: releaseGraph,
      turtle: readFixture("valid-core.ttl")
    }),
    /working graphs/
  );

  await assert.rejects(
    () => writer.insertValidatedWorkingTurtle({
      tenantId,
      graphName: tenantWorkingGraph(`${tenantId}other`, "mappings"),
      turtle: readFixture("valid-core.ttl")
    }),
    /tenant mismatch/
  );

  const missingSourceVersion = validMappingObject();
  delete missingSourceVersion.source_vocabulary_version;
  await assert.rejects(
    () => mappingStore.createMapping({ tenantId, graphName: workingGraph, mapping: missingSourceVersion }),
    /source_vocabulary_version/
  );

  const missingTargetVersion = validMappingObject();
  delete missingTargetVersion.target_vocabulary_version;
  await assert.rejects(
    () => mappingStore.createMapping({ tenantId, graphName: workingGraph, mapping: missingTargetVersion }),
    /target_vocabulary_version/
  );
});

async function canReachFuseki(fuseki) {
  try {
    return await fuseki.ping();
  } catch {
    return false;
  }
}

function readFixture(name) {
  return readFileSync(new URL(`../../ontologies/fixtures/${name}`, import.meta.url), "utf8");
}

function validMappingObject() {
  return {
    mapping_id: "pharmmap:live-map-000001",
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
    evidence_ids: ["pharmev:evidence-2026-000001"],
    evidence_refs: [
      {
        evidence_id: "pharmev:evidence-2026-000001",
        evidence_role: "supports",
        required_for_release: true
      }
    ],
    provenance_id: "pharmprov:mapping/live-000001",
    created_by: "service:normalization",
    reviewed_by: "user:curator-1",
    review_status: "approved",
    release_id: null,
    provenance: {
      actor: "service:normalization",
      timestamp: "2026-06-27T01:20:00.000Z",
      source: "ChEMBL",
      source_version: "34",
      audit_event_id: "audit:evt-live-1"
    }
  };
}
