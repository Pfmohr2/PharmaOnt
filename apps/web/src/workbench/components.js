export const WORKBENCH_SCHEMA_VERSION = "phase5.workbench-api.v1";

const ENTITY_TYPES = Object.freeze([
  "disease",
  "target",
  "compound",
  "trial",
  "product",
  "adverse_event",
  "document"
]);

const ENTITY_SECTIONS = Object.freeze(["mappings", "synonyms", "relationships", "evidence", "history", "impact"]);

export function renderWorkbenchShell({
  searchResponse,
  entityDetail = null,
  explanation = null,
  evidence = null,
  graph = null,
  exportPreview = null
}) {
  assertWorkbenchResponse(searchResponse, "searchResponse");
  return {
    component: "WorkbenchShell",
    schema_version: searchResponse.schema_version,
    tenant_id: searchResponse.tenant_id,
    environment: searchResponse.environment,
    release_context: searchResponse.release_context,
    navigation: ["Search", "Recent", "Saved exports", "Audit links"],
    search: renderSearchSurface(searchResponse),
    entity: entityDetail ? renderEntityPage(entityDetail) : null,
    explanation: explanation ? renderExplanationPanel(explanation) : null,
    evidence: evidence ? renderEvidenceViewer(evidence) : null,
    graph: graph ? renderGraphNeighborhood(graph) : null,
    export_affordance: exportPreview ? renderExportAffordance(exportPreview) : null
  };
}

export function renderSearchSurface(response) {
  assertWorkbenchResponse(response, "searchResponse");
  const results = arrayOf(response.results).map(renderSearchResultRow);
  return {
    component: "SearchSurface",
    query_id: response.query_id,
    release_context: response.release_context,
    supported_entity_types: ENTITY_TYPES,
    visible_count: response.visible_count,
    authorization_filtered: response.authorization_filtered === true,
    policy_notice: response.policy_notice,
    unauthorized_hidden_count: null,
    empty_state: results.length === 0 ? "No visible results in this release context" : null,
    facets: normalizeFacets(response.facets),
    can_export: Boolean(response.actions?.can_export),
    export_formats: response.actions?.export_formats ?? [],
    results
  };
}

export function renderSearchResultRow(result) {
  return {
    component: "ResultRow",
    object_id: requireText(result.object_id, "result.object_id"),
    object_type: requireText(result.object_type, "result.object_type"),
    relationship_assertion_id: result.relationship_assertion_id ?? null,
    provenance_id: result.provenance_id ?? result.source?.provenance_id ?? null,
    display_label: requireText(result.display_label, "result.display_label"),
    snippet: result.snippet ?? null,
    assertion_badge: renderAssertionBadge({
      assertion_type: result.assertion_type,
      lifecycle_status: result.lifecycle_status,
      release_id: result.release_id,
      badges: result.badges
    }),
    match_reasons: renderMatchReasons(result.match_reasons ?? []),
    evidence_refs: result.evidence_refs ?? [],
    actions: {
      open: Boolean(result.actions?.can_open),
      why: true,
      evidence: Boolean(result.actions?.can_view_evidence),
      graph: Boolean(result.actions?.can_view_graph),
      export: Boolean(result.actions?.can_export)
    }
  };
}

export function renderEntityPage(response) {
  assertWorkbenchResponse(response, "entityDetail");
  const sections = response.sections ?? {};
  return {
    component: "EntityPage",
    entity_id: requireText(response.entity_id, "entityDetail.entity_id"),
    release_context: response.release_context,
    authorization_filtered: response.authorization_filtered === true,
    policy_notice: response.policy_notice ?? null,
    header: renderEntityHeader(response.header ?? {}),
    tabs: ENTITY_SECTIONS.map((section) => ({
      id: section,
      label: titleCase(section),
      rows: arrayOf(sections[section]).map((row) => renderEntitySectionRow(section, row)),
      empty_state: arrayOf(sections[section]).length === 0 ? `No visible ${section} in this release context` : null
    })),
    can_export: Boolean(response.actions?.can_export)
  };
}

export function renderEvidenceViewer(response) {
  assertWorkbenchResponse(response, "evidenceResponse");
  const evidence = response.evidence ?? {};
  return {
    component: "EvidenceViewer",
    evidence_id: requireText(evidence.evidence_id, "evidence.evidence_id"),
    release_context: response.release_context,
    authorization_filtered: response.authorization_filtered === true,
    source_name: evidence.source_name ?? null,
    source_version: evidence.source_version ?? null,
    evidence_type: evidence.evidence_type ?? null,
    license_classification: evidence.license_classification ?? null,
    restrictions: evidence.export_restrictions ?? [],
    disclaimer_ids: evidence.disclaimer_ids ?? [],
    content_mode: evidence.content_mode ?? "metadata-only",
    content: evidence.content ?? evidence.structured_fields ?? null,
    artifact_hash: evidence.artifact_hash ?? null,
    provenance_id: evidence.provenance_id ?? null,
    supports: arrayOf(evidence.supports).map((support) => ({
      assertion_id: support.assertion_id ?? support.relationship_id ?? support.mapping_id ?? null,
      assertion_type: support.assertion_type ?? null,
      lifecycle_status: support.lifecycle_status ?? null,
      release_id: support.release_id ?? null,
      why: true
    })),
    actions: {
      export: Boolean(evidence.actions?.can_export),
      open_artifact: Boolean(evidence.actions?.can_open_artifact),
      view_raw: Boolean(evidence.actions?.can_view_raw)
    }
  };
}

export function renderExplanationPanel(response) {
  assertWorkbenchResponse(response, "explanationResponse");
  const explanation = response.explanation ?? {};
  return {
    component: "ExplanationPanel",
    release_context: response.release_context,
    authorization_filtered: response.authorization_filtered === true,
    object_id: explanation.object_id ?? explanation.assertion?.assertion_id ?? null,
    object_type: explanation.object_type ?? explanation.assertion?.assertion_type ?? null,
    assertion_badge: renderAssertionBadge({
      assertion_type: explanation.assertion_type ?? explanation.assertion?.assertion_type,
      lifecycle_status: explanation.lifecycle_status ?? explanation.assertion?.lifecycle_status,
      release_id: explanation.release_id ?? explanation.assertion?.release_id,
      badges: explanation.badges
    }),
    match_reasons: renderMatchReasons(explanation.match_reasons ?? explanation.why?.match_reasons ?? []),
    evidence_chain: arrayOf(explanation.evidence_chain ?? explanation.evidence_refs).map((entry) => ({
      evidence_id: entry.evidence_id,
      evidence_role: entry.evidence_role ?? entry.role ?? null,
      source_name: entry.source_name ?? null,
      source_version: entry.source_version ?? null
    })),
    provenance: explanation.provenance ?? null,
    governance: explanation.governance ?? null,
    model_suggested_warning: (explanation.assertion_type ?? explanation.assertion?.assertion_type) === "model_suggested"
      ? "Model suggested only; not approved or released."
      : null
  };
}

export function renderGraphNeighborhood(payload) {
  return {
    component: "GraphNeighborhood",
    root_entity_id: requireText(payload.root_entity_id, "graph.root_entity_id"),
    release_context: payload.release_context ?? null,
    depth: payload.depth ?? 1,
    policy_notice: payload.policy_notice ?? null,
    unauthorized_hidden_count: null,
    nodes: arrayOf(payload.nodes).map((node) => ({
      id: requireText(node.id, "graph.node.id"),
      type: node.type ?? "entity",
      label: node.label ?? node.id,
      badges: (node.badges ?? []).map(renderBadge),
      exportable: Boolean(node.actions?.can_export ?? node.exportable)
    })),
    edges: arrayOf(payload.edges).map((edge) => ({
      id: requireText(edge.id, "graph.edge.id"),
      subject: requireText(edge.subject, "graph.edge.subject"),
      predicate: requireText(edge.predicate, "graph.edge.predicate"),
      object: requireText(edge.object, "graph.edge.object"),
      assertion_badge: renderAssertionBadge({
        assertion_type: edge.assertion_type,
        lifecycle_status: edge.lifecycle_status,
        release_id: edge.release_id,
        badges: edge.badges
      }),
      confidence: edge.confidence ?? null,
      evidence_count: edge.evidence_count ?? arrayOf(edge.evidence_refs).length,
      provenance_id: edge.provenance_id ?? null,
      why: true
    })),
    can_export: Boolean(payload.actions?.can_export),
    empty_state: arrayOf(payload.nodes).length === 0 ? "No visible neighbors in this release context" : null
  };
}

export function renderExportAffordance(response) {
  assertWorkbenchResponse(response, "exportResponse");
  return {
    component: "ExportAffordance",
    export_id: response.export_id,
    release_context: response.release_context,
    authorization_filtered: response.authorization_filtered === true,
    scope: response.export_scope ?? null,
    format: response.format ?? response.default_format ?? "json",
    record_count: response.record_count,
    invalid_record_count: response.invalid_record_count ?? 0,
    create_enabled: Number(response.record_count) > 0 && arrayOf(response.restrictions).every((restriction) => !String(restriction).startsWith("blocked")),
    preserved_fields: response.preserved_fields ?? [],
    restrictions: response.restrictions ?? [],
    row_content_hashes: response.row_content_hashes ?? [],
    manifest_digest: response.manifest_digest,
    export_job: response.export_job ?? null
  };
}

export function renderAssertionBadge({ assertion_type, lifecycle_status = null, release_id = null, badges = [] } = {}) {
  const values = new Map();
  for (const badge of badges ?? []) {
    const rendered = renderBadge(badge);
    values.set(rendered.value, rendered);
  }
  if (assertion_type) values.set(assertion_type, renderBadge({ value: assertion_type, label: labelForAssertion(assertion_type) }));
  if (lifecycle_status) values.set(lifecycle_status, renderBadge({ value: lifecycle_status, label: titleCase(lifecycle_status) }));
  if (release_id) values.set("released", renderBadge({ value: "released", label: "Released" }));
  return [...values.values()].map((badge) => ({
    ...badge,
    accessible_label: `${badge.label} assertion state`
  }));
}

export function renderMatchReasons(matchReasons) {
  return arrayOf(matchReasons).map((reason) => ({
    reason_type: requireText(reason.reason_type, "match_reason.reason_type"),
    field: requireText(reason.field, "match_reason.field"),
    matched_value: reason.matched_value,
    normalized_value: reason.normalized_value ?? null,
    source: reason.source ?? null,
    evidence_id: reason.evidence_id ?? null
  }));
}

function renderEntityHeader(header) {
  return {
    entity_id: header.entity_id ?? header.object_id ?? null,
    entity_type: header.entity_type ?? header.object_type ?? null,
    preferred_label: header.preferred_label ?? header.display_label ?? null,
    definition: header.definition ?? null,
    external_ids: header.external_ids ?? [],
    lifecycle_status: header.lifecycle_status ?? null,
    release_membership: header.release_membership ?? [],
    badges: renderAssertionBadge({
      assertion_type: header.assertion_type,
      lifecycle_status: header.lifecycle_status,
      release_id: header.release_membership?.[0] ?? header.release_id,
      badges: header.badges
    })
  };
}

function renderEntitySectionRow(section, row) {
  return {
    id: row.id ?? row.mapping_id ?? row.relationship_id ?? row.evidence_id ?? row.audit_event_id ?? null,
    section,
    relationship_assertion_id: row.relationship_assertion_id ?? null,
    provenance_id: row.provenance_id ?? row.source?.provenance_id ?? null,
    source: row,
    badges: renderAssertionBadge({
      assertion_type: row.assertion_type,
      lifecycle_status: row.lifecycle_status ?? row.review_status,
      release_id: row.release_id,
      badges: row.badges
    }),
    evidence_refs: row.evidence_refs ?? [],
    why: true,
    evidence: arrayOf(row.evidence_refs).length > 0
  };
}

function normalizeFacets(facets = {}) {
  return Object.fromEntries(Object.entries(facets).map(([key, values]) => [key, arrayOf(values)]));
}

function renderBadge(badge) {
  const value = requireText(badge?.value ?? badge, "badge.value");
  return {
    value,
    label: badge?.label ?? titleCase(value)
  };
}

function assertWorkbenchResponse(response, label) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error(`${label} must be an object`);
  }
  if (response.schema_version !== WORKBENCH_SCHEMA_VERSION) {
    throw new Error(`${label} must use schema_version ${WORKBENCH_SCHEMA_VERSION}`);
  }
  if (response.authorization_filtered !== true) {
    throw new Error(`${label} must be server-filtered before rendering`);
  }
}

function labelForAssertion(value) {
  if (value === "model_suggested") return "Model suggested";
  return titleCase(value);
}

function titleCase(value) {
  return String(value ?? "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function requireText(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}
