import { SourceLicenseExportPolicyError, buildAuthorizedExport, readSourceLicenseApprovalPacket } from "../../export/src/index.js";
import { querySearchIndex } from "../../search/src/index.js";
import { executeAuthorizedQuery } from "./query-boundary.js";

export const PHASE5_WORKBENCH_API_VERSION = "phase5.workbench-api.v1";

const DEFAULT_EXPORT_FORMATS = Object.freeze(["json", "jsonld", "csv", "tsv", "rdf", "validation-report"]);
const ENTITY_SECTIONS = Object.freeze(["mappings", "synonyms", "relationships", "evidence", "history", "impact"]);

export class WorkbenchApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "WorkbenchApiError";
    this.details = details;
  }
}

export class Phase5WorkbenchApi {
  constructor({
    resolveSearchIndex,
    resolveEntityDetail,
    resolveExportScope,
    resolveSourceLicenseApprovalPacket = null,
    explanationService = null,
    resolveSearchHit = null,
    clock = () => new Date(),
    idFactory = defaultIdFactory
  } = {}) {
    this.resolveSearchIndex = requiredResolver(resolveSearchIndex, "resolveSearchIndex");
    this.resolveEntityDetail = requiredResolver(resolveEntityDetail, "resolveEntityDetail");
    this.resolveExportScope = requiredResolver(resolveExportScope, "resolveExportScope");
    this.resolveSourceLicenseApprovalPacket = resolveSourceLicenseApprovalPacket;
    this.explanationService = explanationService;
    this.resolveSearchHit = resolveSearchHit;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async search({ principal, request = {} } = {}) {
    assertPrincipal(principal);
    const releaseContext = releaseContextFor(principal, request);
    const query = {
      q: request.query ?? request.q ?? "",
      filters: request.filters ?? {},
      release_context: releaseContext
    };
    const indexResults = await this.resolveSearchIndex({ query, principal, releaseContext });
    if (!Array.isArray(indexResults)) {
      throw new WorkbenchApiError("resolveSearchIndex must return an array");
    }
    const searchBoundary = querySearchIndex({
      principal,
      query,
      indexResults,
      releaseContext
    });
    const apiBoundary = await executeAuthorizedQuery({
      principal,
      query,
      candidateResults: searchBoundary.results,
      releaseContext
    });
    const results = apiBoundary.results.map(normalizeSearchResult);
    const exportPreview = previewExport({
      principal,
      candidateResults: apiBoundary.results,
      releaseContext,
      exportId: `export-preview:${this.idFactory()}`
    });
    return {
      schema_version: PHASE5_WORKBENCH_API_VERSION,
      query_id: request.query_id ?? `query:${this.idFactory()}`,
      generated_at: this.clock().toISOString(),
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      release_context: releaseContext,
      query,
      results,
      visible_count: results.length,
      authorization_filtered: true,
      policy_notice: "Results are filtered by tenant, environment, release, source entitlements, and role.",
      facets: buildFacets(results),
      actions: {
        can_export: exportPreview.record_count > 0,
        export_formats: DEFAULT_EXPORT_FORMATS
      }
    };
  }

  async entityDetail({ principal, entityId, request = {} } = {}) {
    assertPrincipal(principal);
    assertText(entityId, "entityId");
    const releaseContext = releaseContextFor(principal, request);
    const raw = await this.resolveEntityDetail({ entityId, principal, releaseContext });
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new WorkbenchApiError("entity resolver returned no detail", { entity_id: entityId });
    }
    const candidates = entityCandidates(raw);
    const boundary = await executeAuthorizedQuery({
      principal,
      query: { entity_id: entityId, release_context: releaseContext },
      candidateResults: candidates,
      releaseContext
    });
    const byApiId = new Map(boundary.results.map((row) => [row.__api_row_id, row]));
    const header = byApiId.get("header");
    if (!header) {
      throw new WorkbenchApiError("entity is not visible in the requested scope", { entity_id: entityId });
    }
    return {
      schema_version: PHASE5_WORKBENCH_API_VERSION,
      generated_at: this.clock().toISOString(),
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      release_context: releaseContext,
      entity_id: entityId,
      header: normalizeEntityHeader(header),
      sections: Object.fromEntries(ENTITY_SECTIONS.map((section) => [
        section,
        authorizedSectionRows(raw, byApiId, section).map((row) => normalizeEntitySectionRow(section, row))
      ])),
      authorization_filtered: true,
      policy_notice: "Entity detail sections are filtered by tenant, environment, release, source entitlements, and role.",
      actions: {
        can_export: previewExport({
          principal,
          candidateResults: boundary.results,
          releaseContext,
          exportId: `export-preview:${this.idFactory()}`
        }).record_count > 0
      }
    };
  }

  async explainSearchHit({ principal, hitId = null, hit = null, request = {} } = {}) {
    assertPrincipal(principal);
    if (!this.explanationService || typeof this.explanationService.explainSearchHit !== "function") {
      throw new WorkbenchApiError("explanation service is required");
    }
    const releaseContext = releaseContextFor(principal, request);
    const resolvedHit = await this.resolveAuthorizedHit({ principal, hitId, hit, releaseContext });
    const explanation = await this.explanationService.explainSearchHit({
      hit: resolvedHit,
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      release_id: releaseContext.release_id
    });
    return {
      schema_version: PHASE5_WORKBENCH_API_VERSION,
      generated_at: this.clock().toISOString(),
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      release_context: releaseContext,
      authorization_filtered: true,
      explanation
    };
  }

  async evidenceForAssertion({ principal, assertionId, request = {} } = {}) {
    assertPrincipal(principal);
    assertText(assertionId, "assertionId");
    if (!this.explanationService || typeof this.explanationService.evidenceForAssertion !== "function") {
      throw new WorkbenchApiError("explanation service is required");
    }
    const releaseContext = releaseContextFor(principal, request);
    const boundary = await executeAuthorizedQuery({
      principal,
      query: { assertion_id: assertionId, release_context: releaseContext },
      candidateResults: [request.assertion ?? { ...request, id: assertionId, assertion_id: assertionId }],
      releaseContext
    });
    if (boundary.results.length !== 1) {
      throw new WorkbenchApiError("assertion is not visible in the requested scope", { assertion_id: assertionId });
    }
    const evidence = await this.explanationService.evidenceForAssertion({
      assertion_id: assertionId,
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      release_id: releaseContext.release_id
    });
    return {
      schema_version: PHASE5_WORKBENCH_API_VERSION,
      generated_at: this.clock().toISOString(),
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      release_context: releaseContext,
      authorization_filtered: true,
      evidence
    };
  }

  async exportPreview({ principal, request = {} } = {}) {
    const exportResult = await this.createExport({
      principal,
      request: {
        ...request,
        dry_run: true,
        export_id: request.export_id ?? `export-preview:${this.idFactory()}`
      }
    });
    return {
      ...exportResult,
      export_job: null
    };
  }

  async createExport({ principal, request = {} } = {}) {
    assertPrincipal(principal);
    const releaseContext = releaseContextFor(principal, request);
    const scope = request.scope ?? {};
    const candidateResults = await this.resolveExportScope({ scope, principal, releaseContext });
    if (!Array.isArray(candidateResults)) {
      throw new WorkbenchApiError("resolveExportScope must return an array");
    }
    const export_id = request.export_id ?? `export:${this.idFactory()}`;
    const dryRun = request.dry_run === true;
    const sourceLicenseApprovalPacket = await this.sourceLicenseApprovalPacketFor({ principal, request, releaseContext });
    const requestedScopes = requestedExportScopesFor({ request, scope, dryRun });
    const authorizedExport = buildAuthorizedExport({
      principal,
      candidateResults,
      export_id,
      releaseContext,
      format: request.format ?? "json",
      sourceLicenseApprovalPacket,
      requestedScopes,
      action: dryRun ? "export.preview" : "export.create"
    });
    const exportJob = dryRun || authorizedExport.record_count === 0
      ? null
      : {
          job_id: export_id,
          status: "ready",
          created_by: principal.user_id ?? principal.service_account_id ?? null,
          audit_event_id: authorizedExport.source_license_policy?.audit_event?.audit_event_id ?? `audit:${export_id}`,
          artifact_hash: authorizedExport.manifest_digest,
          download_url: null
        };
    return {
      schema_version: PHASE5_WORKBENCH_API_VERSION,
      generated_at: this.clock().toISOString(),
      export_id: authorizedExport.export_id,
      tenant_id: authorizedExport.tenant_id,
      environment: authorizedExport.environment,
      format: authorizedExport.format,
      release_context: releaseContext,
      authorization_filtered: true,
      record_count: authorizedExport.record_count,
      invalid_record_count: authorizedExport.invalid_record_count,
      rows: authorizedExport.rows,
      row_content_hashes: authorizedExport.row_content_hashes,
      manifest_digest: authorizedExport.manifest_digest,
      source_license_policy: authorizedExport.source_license_policy,
      export_scope: scope,
      formats: DEFAULT_EXPORT_FORMATS,
      default_format: "json",
      preserved_fields: [
        "canonical_ids",
        "source_name",
        "source_vocabulary_version",
        "target_vocabulary_version",
        "evidence_refs",
        "provenance_id",
        "source_version",
        "release_id",
        "artifact_hash",
        "audit_event_ids",
        "row_hashes",
        "license_classification",
        "license_policy_id"
      ],
      restrictions: summarizeExportRestrictions(authorizedExport.rows),
      export_job: exportJob
    };
  }

  async sourceLicenseApprovalPacketFor({ principal, request, releaseContext }) {
    if (request.source_license_approval_packet) {
      return request.source_license_approval_packet;
    }
    if (typeof this.resolveSourceLicenseApprovalPacket === "function") {
      return this.resolveSourceLicenseApprovalPacket({ principal, request, releaseContext });
    }
    if (request.source_license_approval_packet_path) {
      return readSourceLicenseApprovalPacket({ packetPath: request.source_license_approval_packet_path });
    }
    return null;
  }

  async resolveAuthorizedHit({ principal, hitId, hit, releaseContext }) {
    const candidate = hit ?? await this.resolveStoredHit({ hitId, principal, releaseContext });
    const boundary = await executeAuthorizedQuery({
      principal,
      query: { hit_id: hitId ?? candidate?.hit_id ?? candidate?.id ?? null, release_context: releaseContext },
      candidateResults: [candidate],
      releaseContext
    });
    if (boundary.results.length !== 1) {
      throw new WorkbenchApiError("search hit is not visible in the requested scope", { hit_id: hitId });
    }
    return boundary.results[0];
  }

  async resolveStoredHit({ hitId, principal, releaseContext }) {
    assertText(hitId, "hitId");
    if (typeof this.resolveSearchHit !== "function") {
      throw new WorkbenchApiError("resolveSearchHit is required when hit is not provided");
    }
    const hit = await this.resolveSearchHit({ hitId, principal, releaseContext });
    if (!hit || typeof hit !== "object" || Array.isArray(hit)) {
      throw new WorkbenchApiError("search hit resolver returned no hit", { hit_id: hitId });
    }
    return hit;
  }
}

export function createPhase5WorkbenchApi(dependencies) {
  return new Phase5WorkbenchApi(dependencies);
}

function releaseContextFor(principal, request) {
  const releaseId = request.release_id ?? request.releaseId ?? request.release_context?.release_id ?? principal.release_id ?? null;
  return {
    release_id: releaseId,
    scope: releaseId ? "release" : "working"
  };
}

function entityCandidates(raw) {
  const header = {
    ...(raw.header ?? raw.entity ?? {}),
    __api_row_id: "header"
  };
  return [
    header,
    ...ENTITY_SECTIONS.flatMap((section) =>
      arrayOf(raw[section]).map((row, index) => ({
        ...row,
        __api_row_id: `${section}:${index}`,
        __api_section: section
      }))
    )
  ];
}

function authorizedSectionRows(raw, byApiId, section) {
  return arrayOf(raw[section])
    .map((_, index) => byApiId.get(`${section}:${index}`))
    .filter(Boolean);
}

function normalizeSearchResult(result) {
  return stripApiMeta({
    object_id: result.object_id ?? result.entity_id ?? result.assertion_id ?? result.mapping_id ?? result.relationship_id ?? result.id,
    object_type: result.object_type ?? result.result_type ?? result.assertion_type,
    display_label: result.display_label ?? result.preferred_label ?? result.label ?? result.id,
    preferred_label: result.preferred_label ?? result.display_label ?? result.label ?? null,
    snippet: result.snippet ?? null,
    rank: result.rank ?? null,
    score_band: result.score_band ?? scoreBand(result.score),
    assertion_type: result.assertion_type,
    lifecycle_status: result.lifecycle_status ?? null,
    review_status: result.review_status ?? null,
    release_id: result.release_id ?? null,
    badges: result.badges ?? badgesFor(result),
    match_reasons: result.match_reasons ?? [],
    evidence_refs: result.evidence_refs ?? [],
    actions: {
      can_open: true,
      can_export: false,
      can_view_evidence: Array.isArray(result.evidence_refs) && result.evidence_refs.length > 0,
      can_view_graph: ["entity", "compound", "disease", "target", "relationship"].includes(result.object_type ?? result.result_type)
    },
    source: result
  });
}

function normalizeEntityHeader(row) {
  return stripApiMeta({
    entity_id: row.entity_id ?? row.object_id ?? row.id,
    entity_type: row.entity_type ?? row.object_type ?? null,
    preferred_label: row.preferred_label ?? row.display_label ?? row.label ?? null,
    definition: row.definition ?? null,
    external_ids: row.external_ids ?? [],
    lifecycle_status: row.lifecycle_status ?? null,
    release_membership: row.release_membership ?? [row.release_id].filter(Boolean),
    badges: row.badges ?? badgesFor(row),
    source: row
  });
}

function normalizeEntitySectionRow(section, row) {
  return stripApiMeta({
    section,
    id: row.id ?? row.mapping_id ?? row.relationship_id ?? row.evidence_id ?? row.audit_event_id ?? row.object_id,
    assertion_type: row.assertion_type,
    lifecycle_status: row.lifecycle_status ?? row.review_status ?? null,
    release_id: row.release_id ?? null,
    badges: row.badges ?? badgesFor(row),
    evidence_refs: row.evidence_refs ?? [],
    provenance_id: row.provenance_id ?? null,
    source: row
  });
}

function buildFacets(results) {
  return {
    object_type: countBy(results, "object_type"),
    assertion_type: countBy(results, "assertion_type"),
    lifecycle_status: countBy(results, "lifecycle_status"),
    release_id: countBy(results, "release_id")
  };
}

function countBy(results, field) {
  const counts = new Map();
  for (const result of results) {
    const value = result[field] ?? "unknown";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
}

function previewExport({ principal, candidateResults, releaseContext, exportId }) {
  try {
    return buildAuthorizedExport({
      principal,
      candidateResults,
      export_id: exportId,
      releaseContext,
      format: "json",
      action: "export.preview",
      requestedScopes: ["export.preview"]
    });
  } catch (error) {
    if (!(error instanceof SourceLicenseExportPolicyError)) {
      throw error;
    }
    return {
      export_id: exportId,
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      format: "json",
      authorization_filtered: true,
      record_count: 0,
      invalid_record_count: 0,
      rows: [],
      row_content_hashes: [],
      source_license_policy: {
        allowed: false,
        export_job_creatable: false,
        denied_scopes: error.details?.denied_scopes ?? [],
        blocks: error.details?.blocks ?? [error.message],
        approval_ids: [],
        audit_event: error.details?.audit_event ?? null,
        requested_scopes: ["export.preview"]
      },
      manifest_digest: null
    };
  }
}

function requestedExportScopesFor({ request, scope, dryRun }) {
  const scopes = request.requested_export_scopes
    ?? request.export_scopes
    ?? request.requestedScopes
    ?? scope.requested_export_scopes
    ?? scope.export_scopes
    ?? scope.requestedScopes
    ?? null;
  if (Array.isArray(scopes)) {
    return scopes;
  }
  return dryRun ? ["export.preview"] : ["export.released_curated_assertions"];
}

function summarizeExportRestrictions(rows) {
  return [...new Set(rows.flatMap((row) => [
    ...(row.export_restrictions ?? []),
    ...(row.disclaimer_ids ?? []),
    row.license_classification ? `license:${row.license_classification}` : null
  ].filter(Boolean)))];
}

function badgesFor(result) {
  return [
    badgeFrom(result.assertion_type),
    badgeFrom(result.lifecycle_status ?? result.review_status),
    result.release_id ? { label: "Released", value: "released" } : null,
    (result.export_restrictions ?? []).length > 0 ? { label: "Restricted", value: "restricted" } : null
  ].filter(Boolean);
}

function badgeFrom(value) {
  if (!value) return null;
  return {
    label: String(value).split(/[_-]/).map(capitalize).join(" "),
    value
  };
}

function scoreBand(score) {
  if (typeof score !== "number") return null;
  if (score >= 0.9) return "high";
  if (score >= 0.7) return "medium";
  return "low";
}

function stripApiMeta(value) {
  const output = { ...value };
  if (output.source && typeof output.source === "object") {
    output.source = Object.fromEntries(Object.entries(output.source).filter(([key]) => !key.startsWith("__api_")));
  }
  return output;
}

function requiredResolver(fn, name) {
  if (typeof fn !== "function") {
    throw new WorkbenchApiError(`${name} resolver is required`);
  }
  return fn;
}

function assertPrincipal(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    throw new WorkbenchApiError("principal is required");
  }
  assertText(principal.tenant_id, "principal.tenant_id");
  assertText(principal.environment, "principal.environment");
  if (!Array.isArray(principal.role_keys) || principal.role_keys.length === 0) {
    throw new WorkbenchApiError("principal.role_keys is required");
  }
}

function assertText(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new WorkbenchApiError(`${fieldName} is required`);
  }
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function capitalize(value) {
  const text = String(value);
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function defaultIdFactory() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
