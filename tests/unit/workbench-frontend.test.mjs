import assert from "node:assert/strict";
import test from "node:test";

import {
  renderEntityPage,
  renderEvidenceViewer,
  renderExplanationPanel,
  renderExportAffordance,
  renderGraphNeighborhood,
  renderSearchSurface,
  renderWorkbenchShell
} from "../../apps/web/src/workbench/index.js";

test("Phase 5 search surface renders all entity types, facets, badges, match reasons, and no hidden unauthorized counts", () => {
  const surface = renderSearchSurface(searchResponse());

  assert.equal(surface.component, "SearchSurface");
  assert.equal(surface.authorization_filtered, true);
  assert.equal(surface.unauthorized_hidden_count, null);
  assert.deepEqual(surface.supported_entity_types, ["disease", "target", "compound", "trial", "product", "adverse_event", "document"]);
  assert.equal(surface.facets.object_type.length, 7);
  assert.equal(surface.results.length, 7);
  assert.equal(surface.results[0].match_reasons[0].reason_type, "label");
  assert.ok(surface.results.some((row) => row.assertion_badge.some((badge) => badge.value === "model_suggested")));
  assert.ok(surface.results.every((row) => row.assertion_badge.every((badge) => badge.accessible_label)));
});

test("Phase 5 entity page renders mappings, synonyms, relationships, evidence, history, and impact tabs", () => {
  const page = renderEntityPage(entityDetailResponse());

  assert.equal(page.component, "EntityPage");
  assert.equal(page.header.preferred_label, "Aspirin");
  assert.deepEqual(page.tabs.map((tab) => tab.id), ["mappings", "synonyms", "relationships", "evidence", "history", "impact"]);
  assert.ok(page.tabs.every((tab) => tab.rows.length === 1));
  assert.equal(page.tabs.find((tab) => tab.id === "mappings").rows[0].evidence, true);
  assert.equal(page.can_export, true);
});

test("Phase 5 explanation panel and evidence viewer render provenance, restrictions, supports, and model-suggested warning", () => {
  const explanation = renderExplanationPanel(explanationResponse({ assertion_type: "model_suggested" }));
  const evidence = renderEvidenceViewer(evidenceResponse());

  assert.equal(explanation.component, "ExplanationPanel");
  assert.equal(explanation.model_suggested_warning, "Model suggested only; not approved or released.");
  assert.equal(explanation.match_reasons[0].evidence_id, "pharmev:evidence-1");
  assert.equal(explanation.provenance.provenance_id, "pharmprov:aspirin");
  assert.equal(evidence.component, "EvidenceViewer");
  assert.equal(evidence.source_version, "CHEMBL_34");
  assert.deepEqual(evidence.restrictions, ["attribution_required"]);
  assert.equal(evidence.supports[0].why, true);
});

test("Phase 5 graph neighborhood renders visible nodes and assertion-badged edges without hidden counts", () => {
  const graph = renderGraphNeighborhood(graphPayload());

  assert.equal(graph.component, "GraphNeighborhood");
  assert.equal(graph.unauthorized_hidden_count, null);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.edges.every((edge) => edge.why));
  assert.ok(graph.edges[1].assertion_badge.some((badge) => badge.value === "model_suggested"));
});

test("Phase 5 export affordance uses server preview/action state and preserves regulated fields", () => {
  const exportView = renderExportAffordance(exportResponse());

  assert.equal(exportView.component, "ExportAffordance");
  assert.equal(exportView.create_enabled, true);
  assert.equal(exportView.invalid_record_count, 2);
  assert.equal("filtered_count" in exportView, false);
  assert.ok(exportView.preserved_fields.includes("source_vocabulary_version"));
  assert.ok(exportView.preserved_fields.includes("provenance_id"));
  assert.deepEqual(exportView.row_content_hashes, [
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  ]);
  assert.match(exportView.manifest_digest, /^sha256:[a-f0-9]{64}$/);
});

test("Phase 5 workbench shell composes all seven requested surfaces from API-shaped payloads", () => {
  const shell = renderWorkbenchShell({
    searchResponse: searchResponse(),
    entityDetail: entityDetailResponse(),
    explanation: explanationResponse(),
    evidence: evidenceResponse(),
    graph: graphPayload(),
    exportPreview: exportResponse()
  });

  assert.equal(shell.component, "WorkbenchShell");
  assert.equal(shell.search.results.length, 7);
  assert.equal(shell.entity.tabs.length, 6);
  assert.equal(shell.explanation.component, "ExplanationPanel");
  assert.equal(shell.evidence.component, "EvidenceViewer");
  assert.equal(shell.graph.component, "GraphNeighborhood");
  assert.equal(shell.export_affordance.component, "ExportAffordance");
});

test("Phase 5 frontend refuses to render unfiltered API payloads", () => {
  const response = searchResponse();
  response.authorization_filtered = false;

  assert.throws(
    () => renderSearchSurface(response),
    /server-filtered/
  );
});

function searchResponse() {
  const objectTypes = ["compound", "target", "disease", "trial", "product", "adverse_event", "document"];
  return {
    schema_version: "phase5.workbench-api.v1",
    query_id: "query:aspirin",
    tenant_id: "tenant-a",
    environment: "prod",
    release_context: { release_id: "release-2026-01", scope: "release" },
    results: objectTypes.map((type, index) => ({
      object_id: `pharment:${type}/${index + 1}`,
      object_type: type,
      display_label: type === "compound" ? "Aspirin" : `Visible ${type}`,
      snippet: `${type} matched by label, synonym, or source identifier.`,
      rank: index + 1,
      score_band: index < 2 ? "high" : "medium",
      assertion_type: index === 4 ? "model_suggested" : index === 5 ? "imported" : "approved",
      lifecycle_status: index === 4 ? "proposed" : "released",
      release_id: index === 4 ? null : "release-2026-01",
      badges: [{ label: index === 4 ? "Model suggested" : "Approved", value: index === 4 ? "model_suggested" : "approved" }],
      match_reasons: [
        { reason_type: "label", field: "preferred_label", matched_value: "aspirin", normalized_value: "aspirin", source: "search", evidence_id: "pharmev:evidence-1" },
        { reason_type: "identifier", field: "external_ids", matched_value: "CHEMBL25", normalized_value: "chembl25", source: "ChEMBL" }
      ],
      evidence_refs: [{ evidence_id: "pharmev:evidence-1", evidence_role: "supports" }],
      actions: { can_open: true, can_export: index !== 4, can_view_evidence: true, can_view_graph: ["compound", "target", "disease"].includes(type) }
    })),
    visible_count: 7,
    authorization_filtered: true,
    policy_notice: "Results are filtered by your tenant, release, source entitlements, and role.",
    facets: {
      object_type: objectTypes.map((value) => ({ value, count: 1 })),
      assertion_type: [{ value: "approved", count: 6 }, { value: "model_suggested", count: 1 }]
    },
    actions: { can_export: true, export_formats: ["json", "jsonld", "csv", "tsv", "rdf", "validation-report"] }
  };
}

function entityDetailResponse() {
  const row = (section) => ({
    id: `${section}:1`,
    assertion_type: section === "relationships" ? "human_curated" : "approved",
    lifecycle_status: "released",
    release_id: "release-2026-01",
    evidence_refs: [{ evidence_id: "pharmev:evidence-1", evidence_role: "supports" }],
    provenance_id: "pharmprov:aspirin"
  });
  return {
    schema_version: "phase5.workbench-api.v1",
    tenant_id: "tenant-a",
    environment: "prod",
    release_context: { release_id: "release-2026-01", scope: "release" },
    entity_id: "pharment:compound/aspirin",
    header: {
      entity_id: "pharment:compound/aspirin",
      entity_type: "compound",
      preferred_label: "Aspirin",
      definition: "Acetylsalicylic acid.",
      external_ids: ["chembl:CHEMBL25", "pubchem:2244"],
      lifecycle_status: "released",
      release_membership: ["release-2026-01"],
      assertion_type: "approved"
    },
    sections: {
      mappings: [row("mappings")],
      synonyms: [row("synonyms")],
      relationships: [row("relationships")],
      evidence: [row("evidence")],
      history: [row("history")],
      impact: [row("impact")]
    },
    authorization_filtered: true,
    policy_notice: "Entity detail sections are filtered by tenant, release, entitlements, and role.",
    actions: { can_export: true }
  };
}

function explanationResponse(overrides = {}) {
  return {
    schema_version: "phase5.workbench-api.v1",
    tenant_id: "tenant-a",
    environment: "prod",
    release_context: { release_id: "release-2026-01", scope: "release" },
    authorization_filtered: true,
    explanation: {
      object_id: "pharment:compound/aspirin",
      object_type: "compound",
      assertion_type: "approved",
      lifecycle_status: "released",
      release_id: "release-2026-01",
      match_reasons: [{ reason_type: "label", field: "preferred_label", matched_value: "Aspirin", evidence_id: "pharmev:evidence-1" }],
      evidence_chain: [{ evidence_id: "pharmev:evidence-1", evidence_role: "supports", source_name: "ChEMBL", source_version: "CHEMBL_34" }],
      provenance: { provenance_id: "pharmprov:aspirin", actor: "service:normalization", source: "ChEMBL", source_version: "CHEMBL_34" },
      governance: { review_status: "approved", audit_event_id: "audit:approved" },
      ...overrides
    }
  };
}

function evidenceResponse() {
  return {
    schema_version: "phase5.workbench-api.v1",
    tenant_id: "tenant-a",
    environment: "prod",
    release_context: { release_id: "release-2026-01", scope: "release" },
    authorization_filtered: true,
    evidence: {
      evidence_id: "pharmev:evidence-1",
      evidence_type: "source_record",
      source_name: "ChEMBL",
      source_version: "CHEMBL_34",
      source_record_id: "CHEMBL25",
      artifact_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      license_classification: "open_with_attribution",
      export_restrictions: ["attribution_required"],
      disclaimer_ids: ["source_terms:chembl"],
      content_mode: "structured fields",
      structured_fields: { molecule_chembl_id: "CHEMBL25", pref_name: "ASPIRIN" },
      provenance_id: "pharmprov:aspirin",
      supports: [{ assertion_id: "assertion:aspirin", assertion_type: "approved", lifecycle_status: "released", release_id: "release-2026-01" }],
      actions: { can_export: true, can_open_artifact: false, can_view_raw: false }
    }
  };
}

function graphPayload() {
  return {
    root_entity_id: "pharment:compound/aspirin",
    release_context: { release_id: "release-2026-01", scope: "release" },
    depth: 1,
    policy_notice: "Graph is filtered by tenant, release, source entitlements, and role.",
    nodes: [
      { id: "pharment:compound/aspirin", type: "compound", label: "Aspirin", badges: [{ label: "Released", value: "released" }] },
      { id: "pharment:target/ptgs1", type: "target", label: "PTGS1", badges: [{ label: "Approved", value: "approved" }] },
      { id: "pharmev:evidence-1", type: "evidence", label: "ChEMBL evidence", badges: [{ label: "Imported", value: "imported" }] }
    ],
    edges: [
      { id: "edge:target", subject: "pharment:compound/aspirin", predicate: "compound_has_target", object: "pharment:target/ptgs1", assertion_type: "human_curated", lifecycle_status: "released", release_id: "release-2026-01", evidence_count: 3, provenance_id: "pharmprov:edge" },
      { id: "edge:suggested", subject: "pharment:compound/aspirin", predicate: "relatedMatch", object: "pharmev:evidence-1", assertion_type: "model_suggested", lifecycle_status: "proposed", evidence_count: 1, provenance_id: "pharmprov:model" }
    ],
    actions: { can_export: true }
  };
}

function exportResponse() {
  return {
    schema_version: "phase5.workbench-api.v1",
    export_id: "export:preview-1",
    tenant_id: "tenant-a",
    environment: "prod",
    release_context: { release_id: "release-2026-01", scope: "release" },
    authorization_filtered: true,
    record_count: 7,
    invalid_record_count: 2,
    filtered_count: 12,
    rows: [],
    row_content_hashes: [
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    ],
    manifest_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    preserved_fields: ["canonical_ids", "source_vocabulary_version", "target_vocabulary_version", "evidence_refs", "provenance_id", "source_version", "release_id", "artifact_hash", "license_classification", "license_policy_id"],
    restrictions: ["attribution_required"],
    export_scope: { type: "search", query_id: "query:aspirin" },
    format: "json",
    export_job: null
  };
}
