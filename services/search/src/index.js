import { filterAuthorizedResults } from "../../authz-filter/src/index.js";

export const SEARCH_INDEX_SCHEMA_VERSION = "phase5.search-index.v1";
export const SEARCH_RESULT_SCHEMA_VERSION = "phase5.search-result.v1";

export const SEARCHABLE_OBJECT_TYPES = Object.freeze([
  "disease",
  "target",
  "compound",
  "trial",
  "product",
  "adverse_event",
  "document",
  "mapping",
  "relationship",
  "evidence"
]);

const ENTITY_BUCKETS = Object.freeze([
  ["disease", "diseases"],
  ["target", "targets"],
  ["compound", "compounds"],
  ["trial", "trials"],
  ["product", "products"],
  ["adverse_event", "adverse_events"],
  ["document", "documents"]
]);

const FIELD_WEIGHTS = Object.freeze({
  identifier: 1,
  label: 0.9,
  synonym: 0.82,
  mapping: 0.74,
  relationship: 0.68,
  evidence: 0.56,
  document: 0.5,
  browse: 0.1
});

export class SearchIndexService {
  constructor({ documents = [], clock = () => new Date() } = {}) {
    this.clock = clock;
    this.documents = documents.map(buildSearchIndexDocument);
  }

  replace(records = []) {
    this.documents = records.map(buildSearchIndexDocument);
    return this;
  }

  addDocuments(records = []) {
    this.documents.push(...records.map(buildSearchIndexDocument));
    return this;
  }

  search({ principal, query, releaseContext = query?.release_context ?? null } = {}) {
    const indexResults = searchIndexedDocuments({
      documents: this.documents,
      query,
      generatedAt: this.clock().toISOString()
    });
    return querySearchIndex({
      principal,
      query,
      indexResults,
      releaseContext
    });
  }
}

export function createSearchIndexService(options) {
  return new SearchIndexService(options);
}

export function indexGovernedStoreState(storeState = {}) {
  const records = [
    ...arrayOf(storeState.entities),
    ...ENTITY_BUCKETS.flatMap(([objectType, field]) =>
      arrayOf(storeState[field]).map((record) => ({ object_type: objectType, ...record }))
    ),
    ...arrayOf(storeState.canonical_entities).map((record) => ({ assertion_type: "canonical", ...record })),
    ...arrayOf(storeState.canonicalEntities).map((record) => ({ assertion_type: "canonical", ...record })),
    ...arrayOf(storeState.mappings).map((record) => ({ object_type: "mapping", assertion_type: "mapping", ...record })),
    ...arrayOf(storeState.relationships).map((record) => ({ object_type: "relationship", assertion_type: "relationship", ...record })),
    ...arrayOf(storeState.evidence).map((record) => ({ object_type: "evidence", assertion_type: "evidence", ...record }))
  ];
  return records.map(buildSearchIndexDocument);
}

export const indexGovernedRecords = indexGovernedStoreState;

export function buildSearchIndexDocument(record) {
  for (const field of ["tenant_id", "environment", "assertion_type"]) {
    if (typeof record?.[field] !== "string" || record[field].length === 0) {
      throw new Error(`search index document requires ${field}`);
    }
  }

  const objectId = firstText(
    record.object_id,
    record.entity_id,
    record.assertion_id,
    record.mapping_id,
    record.relationship_id,
    record.evidence_id,
    record.document_id,
    record.candidate_id,
    record.suggestion_id,
    record.id
  );
  const objectType = firstText(
    record.object_type,
    record.result_type,
    record.entity_type,
    record.suggestion_type ? "ai_suggestion" : null,
    "document"
  );
  const preferredLabel = firstText(
    record.preferred_label,
    record.display_label,
    record.label,
    record.name,
    record.title,
    labelFromSuggestionPayload(record),
    objectId
  );
  const identifiers = uniqueText([
    objectId,
    record.id,
    record.entity_id,
    record.assertion_id,
    record.mapping_id,
    record.relationship_id,
    record.evidence_id,
    record.document_id,
    record.candidate_id,
    record.suggestion_id,
    record.provenance_id,
    ...arrayOf(record.identifiers),
    ...arrayOf(record.external_ids),
    ...arrayOf(record.curies),
    ...arrayOf(record.xrefs)
  ]);
  const synonyms = normalizeSynonyms(record.synonyms ?? record.aliases);
  const mappings = normalizeMappings(record.mappings ?? record.mapping_refs, record);
  const relationships = normalizeRelationships(record.relationships ?? record.relationship_refs, record);
  const evidenceRefs = normalizeEvidenceRefs(record.evidence_refs ?? record.evidence ?? record.evidence_ids);
  const sourceNames = sourceNamesFor(record);

  return {
    ...record,
    schema_version: record.schema_version ?? SEARCH_INDEX_SCHEMA_VERSION,
    object_id: objectId,
    object_type: objectType,
    result_type: record.result_type ?? objectType,
    display_label: record.display_label ?? preferredLabel,
    preferred_label: record.preferred_label ?? preferredLabel,
    identifiers,
    synonyms,
    mappings,
    relationships,
    evidence_refs: evidenceRefs,
    sources: sourceNames,
    release_context: record.release_context ?? {
      release_id: record.release_id ?? null,
      scope: record.release_id ? "release" : "working"
    },
    indexed_for_tenant: record.tenant_id,
    indexed_environment: record.environment,
    indexed_object_type: objectType,
    searchable_text: searchableTextFor({
      record,
      preferredLabel,
      identifiers,
      synonyms,
      mappings,
      relationships,
      evidenceRefs,
      sourceNames
    })
  };
}

export function searchIndexedDocuments({ documents, query, generatedAt = null } = {}) {
  const normalizedQuery = normalizeQuery(query);
  const scored = documents
    .map(buildSearchIndexDocument)
    .filter((document) => matchesFilters(document, normalizedQuery.filters))
    .map((document) => scoreDocument(document, normalizedQuery, generatedAt))
    .filter(Boolean)
    .sort((left, right) =>
      right.score - left.score ||
      String(left.display_label ?? left.object_id).localeCompare(String(right.display_label ?? right.object_id))
    )
    .map((result, index) => ({
      ...result,
      rank: index + 1,
      score_band: scoreBand(result.score)
    }));
  return scored;
}

export function querySearchIndex({
  principal,
  query,
  indexResults,
  releaseContext = null
}) {
  const indexed = scopeResultsForReleaseContext(indexResults.map(buildSearchIndexDocument), releaseContext);
  const results = filterAuthorizedResults({
    principal,
    results: indexed,
    action: "search",
    releaseContext
  });
  return {
    schema_version: SEARCH_RESULT_SCHEMA_VERSION,
    query,
    results,
    total: results.length,
    authorization_filtered: true,
    facets: buildSearchFacets(results)
  };
}

export function buildSearchFacets(results) {
  return {
    object_type: countBy(results, (result) => result.object_type ?? result.result_type ?? "unknown"),
    entity_type: countBy(results, (result) => result.entity_type ?? result.object_type ?? result.result_type ?? "unknown"),
    source: countByMany(results, (result) => result.sources ?? result.source_name ?? result.source ?? "unknown"),
    assertion_type: countBy(results, (result) => result.assertion_type ?? "unknown"),
    release_context: countBy(results, (result) =>
      result.release_context?.release_id ?? result.release_id ?? result.release_context?.scope ?? "working"
    )
  };
}

export const search = querySearchIndex;

function scoreDocument(document, query, generatedAt) {
  const reasons = [];
  if (query.terms.length === 0) {
    reasons.push(matchReason({
      type: "browse",
      field: "release_context",
      value: document.release_id ?? document.release_context?.scope ?? "working",
      queryTerm: "",
      scoreContribution: FIELD_WEIGHTS.browse
    }));
  }

  for (const term of query.terms) {
    reasons.push(...identifierReasons(document, term));
    reasons.push(...textReasons({
      type: "label",
      field: "preferred_label",
      values: [document.preferred_label, document.display_label, document.label],
      term
    }));
    reasons.push(...synonymReasons(document, term));
    reasons.push(...mappingReasons(document, term));
    reasons.push(...relationshipReasons(document, term));
    reasons.push(...evidenceReasons(document, term));
    reasons.push(...textReasons({
      type: "document",
      field: "searchable_text",
      values: [document.definition, document.description, document.snippet, document.searchable_text],
      term
    }));
  }

  const match_reasons = dedupeReasons(reasons);
  if (match_reasons.length === 0) {
    return null;
  }

  const score = Number(match_reasons.reduce((sum, reason) => sum + (reason.score_contribution ?? 0), 0).toFixed(6));
  return {
    ...document,
    hit_id: document.hit_id ?? `hit:${document.object_id ?? document.id}`,
    match_reasons,
    snippet: document.snippet ?? snippetFor(document, match_reasons),
    score,
    indexed_at: document.indexed_at ?? generatedAt
  };
}

function identifierReasons(document, term) {
  return arrayOf(document.identifiers)
    .filter((identifier) => identifierMatches(identifier, term))
    .map((identifier) => matchReason({
      type: "identifier",
      field: "identifiers",
      value: identifier,
      queryTerm: term.original,
      scoreContribution: FIELD_WEIGHTS.identifier
    }));
}

function synonymReasons(document, term) {
  return arrayOf(document.synonyms)
    .filter((synonym) => exactOrContains(synonym.value, term))
    .map((synonym) => matchReason({
      type: "synonym",
      field: "synonyms",
      value: synonym.value,
      queryTerm: term.original,
      source: synonym.source,
      scoreContribution: FIELD_WEIGHTS.synonym,
      synonym_id: synonym.synonym_id,
      evidence_id: synonym.evidence_id
    }));
}

function mappingReasons(document, term) {
  return arrayOf(document.mappings)
    .filter((mapping) => includesAny(mapping.search_values, term))
    .map((mapping) => matchReason({
      type: "mapping",
      field: "mappings",
      value: firstText(mapping.label, mapping.mapping_id, mapping.source_id, mapping.target_id),
      queryTerm: term.original,
      source: mapping.source,
      scoreContribution: FIELD_WEIGHTS.mapping,
      mapping_id: mapping.mapping_id,
      evidence_id: mapping.evidence_id
    }));
}

function relationshipReasons(document, term) {
  return arrayOf(document.relationships)
    .filter((relationship) => includesAny(relationship.search_values, term))
    .map((relationship) => matchReason({
      type: "relationship",
      field: "relationships",
      value: firstText(relationship.label, relationship.relationship_id, relationship.predicate),
      queryTerm: term.original,
      source: relationship.source,
      scoreContribution: FIELD_WEIGHTS.relationship,
      evidence_id: relationship.evidence_id
    }));
}

function evidenceReasons(document, term) {
  return arrayOf(document.evidence_refs)
    .filter((evidence) => includesAny(evidence.search_values, term))
    .map((evidence) => matchReason({
      type: "evidence",
      field: "evidence_refs",
      value: firstText(evidence.snippet, evidence.evidence_id, evidence.source_name),
      queryTerm: term.original,
      source: evidence.source_name,
      scoreContribution: FIELD_WEIGHTS.evidence,
      evidence_id: evidence.evidence_id
    }));
}

function textReasons({ type, field, values, term }) {
  return uniqueText(values)
    .filter((value) => containsNormalized(value, term.normalized))
    .map((value) => matchReason({
      type,
      field,
      value,
      queryTerm: term.original,
      scoreContribution: FIELD_WEIGHTS[type]
    }));
}

function matchReason({
  type,
  field,
  value,
  queryTerm,
  source = "search_index",
  scoreContribution,
  mapping_id = null,
  synonym_id = null,
  evidence_id = null
}) {
  const normalizedValue = normalizeText(value);
  return {
    match_reason_id: stableReasonId(type, field, value, queryTerm),
    reason_type: type,
    match_type: type,
    field,
    matched_field: field,
    matched_value: value ?? null,
    normalized_value: normalizedValue,
    query_term: queryTerm ?? null,
    source: source ?? "search_index",
    score_contribution: scoreContribution,
    mapping_id,
    synonym_id,
    evidence_id,
    highlight_ranges: []
  };
}

function stableReasonId(type, field, value, queryTerm) {
  return `match:${type}:${normalizeText(field)}:${normalizeText(value)}:${normalizeText(queryTerm)}`;
}

function dedupeReasons(reasons) {
  const seen = new Set();
  const output = [];
  for (const reason of reasons) {
    const key = [reason.reason_type, reason.field, reason.normalized_value, normalizeText(reason.query_term)].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      output.push(reason);
    }
  }
  return output.sort((left, right) =>
    (right.score_contribution ?? 0) - (left.score_contribution ?? 0) ||
    left.reason_type.localeCompare(right.reason_type)
  );
}

function normalizeQuery(query = {}) {
  const source = typeof query === "string" ? { q: query } : query ?? {};
  const rawTerms = uniqueText([
    source.q,
    source.query,
    ...arrayOf(source.terms)
  ]).join(" ");
  const terms = tokenize(rawTerms);
  return {
    ...source,
    q: source.q ?? source.query ?? rawTerms,
    terms,
    filters: normalizeFilters(source.filters ?? {})
  };
}

function tokenize(value) {
  const normalizedFull = normalizeText(value);
  const rawTokens = String(value ?? "")
    .split(/[\s,;|]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const tokens = [
    ...rawTokens,
    rawTokens.length > 1 ? String(value).trim() : null
  ].filter(Boolean);
  if (tokens.length === 0 && normalizedFull.length > 0) {
    tokens.push(String(value));
  }
  return uniqueText(tokens).map((token) => ({
    original: token,
    normalized: normalizeText(token),
    isIdentifier: token.includes(":") || /[A-Z]{2,}\d+/.test(token)
  }));
}

function normalizeFilters(filters) {
  return Object.fromEntries(Object.entries(filters)
    .filter(([, value]) => value !== undefined && value !== null && arrayOf(value).length !== 0)
    .map(([key, value]) => [key, new Set(arrayOf(value).map(normalizeText))]));
}

function matchesFilters(document, filters) {
  return Object.entries(filters).every(([field, accepted]) => {
    if (field === "entity_type") {
      return accepted.has(normalizeText(document.entity_type ?? document.object_type ?? document.result_type));
    }
    if (field === "source") {
      return arrayOf(document.sources).some((source) => accepted.has(normalizeText(source)));
    }
    if (field === "release_context") {
      return accepted.has(normalizeText(document.release_context?.release_id ?? document.release_id ?? document.release_context?.scope));
    }
    return accepted.has(normalizeText(document[field]));
  });
}

function normalizeSynonyms(value) {
  return arrayOf(value).map((synonym) => {
    if (isObject(synonym)) {
      return {
        synonym_id: synonym.synonym_id ?? synonym.id ?? null,
        value: firstText(synonym.value, synonym.label, synonym.name, synonym.text),
        source: synonym.source ?? synonym.source_name ?? "search_index",
        evidence_id: synonym.evidence_id ?? null
      };
    }
    return {
      synonym_id: null,
      value: String(synonym),
      source: "search_index",
      evidence_id: null
    };
  }).filter((synonym) => synonym.value);
}

function normalizeMappings(value, record) {
  const mappings = arrayOf(value).map((mapping) => {
    if (!isObject(mapping)) {
      return { mapping_id: String(mapping), search_values: [String(mapping)], source: "search_index" };
    }
    return {
      mapping_id: mapping.mapping_id ?? mapping.id ?? null,
      source_id: mapping.source_id ?? mapping.source_entity_id ?? mapping.subject_id ?? null,
      target_id: mapping.target_id ?? mapping.target_entity_id ?? mapping.object_id ?? null,
      label: mapping.label ?? mapping.predicate ?? mapping.mapping_type ?? null,
      source: mapping.source ?? mapping.source_name ?? "search_index",
      evidence_id: mapping.evidence_id ?? null,
      search_values: uniqueText([
        mapping.mapping_id,
        mapping.id,
        mapping.source_id,
        mapping.source_entity_id,
        mapping.target_id,
        mapping.target_entity_id,
        mapping.object_id,
        mapping.label,
        mapping.predicate,
        mapping.mapping_type
      ])
    };
  });
  if (record.mapping_id || record.source_entity_id || record.target_entity_id) {
    mappings.push(normalizeMappings([record], {})[0]);
  }
  return mappings.filter(Boolean);
}

function normalizeRelationships(value, record) {
  const relationships = arrayOf(value).map((relationship) => {
    if (!isObject(relationship)) {
      return { relationship_id: String(relationship), search_values: [String(relationship)], source: "search_index" };
    }
    return {
      relationship_id: relationship.relationship_id ?? relationship.id ?? null,
      subject_id: relationship.subject_id ?? relationship.subject ?? null,
      predicate: relationship.predicate ?? relationship.relationship_type ?? null,
      object_id: relationship.object_id ?? relationship.object ?? null,
      label: relationship.label ?? relationship.predicate ?? relationship.relationship_type ?? null,
      source: relationship.source ?? relationship.source_name ?? "search_index",
      evidence_id: relationship.evidence_id ?? null,
      search_values: uniqueText([
        relationship.relationship_id,
        relationship.id,
        relationship.subject_id,
        relationship.subject,
        relationship.predicate,
        relationship.relationship_type,
        relationship.object_id,
        relationship.object,
        relationship.label
      ])
    };
  });
  if (record.relationship_id || record.subject_id || record.predicate) {
    relationships.push(normalizeRelationships([record], {})[0]);
  }
  return relationships.filter(Boolean);
}

function normalizeEvidenceRefs(value) {
  return arrayOf(value).map((evidence) => {
    if (isObject(evidence)) {
      return {
        evidence_id: evidence.evidence_id ?? evidence.id ?? null,
        evidence_role: evidence.evidence_role ?? evidence.role ?? null,
        source_name: evidence.source_name ?? evidence.source ?? null,
        source_version: evidence.source_version ?? null,
        source_record_id: evidence.source_record_id ?? null,
        source_record_uri: evidence.source_record_uri ?? null,
        source_span_ids: arrayOf(evidence.source_span_ids),
        disclaimer_ids: arrayOf(evidence.disclaimer_ids),
        source_limitations: arrayOf(evidence.source_limitations),
        snippet: evidence.snippet ?? evidence.text ?? null,
        search_values: uniqueText([
          evidence.evidence_id,
          evidence.id,
          evidence.source_name,
          evidence.source_version,
          evidence.source,
          evidence.snippet,
          evidence.text,
          evidence.source_record_id,
          ...(evidence.disclaimer_ids ?? []),
          ...(evidence.source_limitations ?? [])
        ])
      };
    }
    return {
      evidence_id: String(evidence),
      evidence_role: null,
      source_name: null,
      snippet: null,
      search_values: [String(evidence)]
    };
  });
}

function sourceNamesFor(record) {
  return uniqueText([
    record.source_name,
    record.source_system,
    record.source_vocabulary,
    isObject(record.source) ? record.source.source_name ?? record.source.name : record.source,
    ...arrayOf(record.sources).map((source) => isObject(source) ? source.source_name ?? source.name ?? source.id : source)
  ]);
}

function searchableTextFor({ record, preferredLabel, identifiers, synonyms, mappings, relationships, evidenceRefs, sourceNames }) {
  return uniqueText([
    preferredLabel,
    record.definition,
    record.description,
    record.snippet,
    record.suggestion_type,
    record.proposal_type,
    record.duplicate_status,
    record.rationale,
    ...payloadSearchValues(record.candidate_payload),
    ...payloadSearchValues(record.payload),
    ...sourceSpanSearchValues(record.source_spans),
    modelLabel(record),
    ...identifiers,
    ...synonyms.map((synonym) => synonym.value),
    ...mappings.flatMap((mapping) => mapping.search_values),
    ...relationships.flatMap((relationship) => relationship.search_values),
    ...evidenceRefs.flatMap((evidence) => evidence.search_values),
    ...sourceNames
  ]).join(" ");
}

function scopeResultsForReleaseContext(results, releaseContext) {
  if (!releaseContext?.release_id) {
    return results;
  }
  return results.filter((result) =>
    result.release_id === releaseContext.release_id &&
    result.assertion_type !== "model_suggested" &&
    result.governance?.release_eligible !== false
  );
}

function labelFromSuggestionPayload(record) {
  const payload = record.candidate_payload ?? record.payload;
  if (!isObject(payload)) {
    return null;
  }
  return firstText(
    payload.candidate_label,
    payload.canonical_label,
    payload.entity_text,
    payload.synonym,
    payload.relationship_type,
    payload.predicate,
    payload.document_id,
    payload.mention_id
  );
}

function payloadSearchValues(payload) {
  if (!isObject(payload)) {
    return [];
  }
  return Object.values(payload).flatMap((value) => {
    if (isObject(value)) {
      return payloadSearchValues(value);
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => isObject(item) ? payloadSearchValues(item) : item);
    }
    return value;
  });
}

function sourceSpanSearchValues(sourceSpans) {
  return arrayOf(sourceSpans).flatMap((span) => isObject(span)
    ? [span.span_id, span.source_record_id, span.field_path, span.text, span.evidence_id, span.source_id, span.document_id]
    : [span]
  );
}

function modelLabel(record) {
  return firstText(
    record.model_name,
    record.model_version,
    record.prompt_version,
    record.model?.model_id,
    record.model?.model_version,
    record.model?.prompt_version
  );
}

function snippetFor(document, reasons) {
  const label = document.display_label ?? document.preferred_label ?? document.object_id;
  const reason = reasons[0];
  return `${label} matched ${reason.reason_type} ${reason.matched_value ?? ""}`.trim();
}

function scoreBand(score) {
  if (score >= 1.5) return "high";
  if (score >= 0.75) return "medium";
  return "low";
}

function countBy(results, resolver) {
  const counts = new Map();
  for (const result of results) {
    const value = resolver(result);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
}

function countByMany(results, resolver) {
  const counts = new Map();
  for (const result of results) {
    const values = arrayOf(resolver(result));
    for (const value of values.length > 0 ? values : ["unknown"]) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
}

function includesAny(values, term) {
  return arrayOf(values).some((value) => exactOrContains(value, term));
}

function exactOrContains(value, term) {
  const normalized = normalizeText(value);
  if (term.isIdentifier) {
    return normalized === term.normalized;
  }
  return normalized.includes(term.normalized);
}

function identifierMatches(value, term) {
  return normalizeText(value) === term.normalized;
}

function containsNormalized(value, term) {
  return normalizeText(value).includes(term);
}

function uniqueText(values) {
  const output = [];
  const seen = new Set();
  for (const value of values.flat(Infinity)) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text.length === 0) continue;
    const key = normalizeText(text);
    if (!seen.has(key)) {
      seen.add(key);
      output.push(text);
    }
  }
  return output;
}

function firstText(...values) {
  return uniqueText(values)[0] ?? null;
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null) : [value];
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
