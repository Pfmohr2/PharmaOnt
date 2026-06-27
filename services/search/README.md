# services/search

Indexing, query, ranking, and match-reason retrieval for the Phase 5 workbench.

Search indexes are derived and rebuildable from governed/published RDF, PostgreSQL metadata, object storage manifests, and release-scoped evidence records. The service does not own regulated source data; it owns derived index documents and deterministic match reasons for release-context search.

## Phase 5 Query Authorization

All lexical, identifier, synonym, semantic, vector, and hybrid retrieval paths must route candidate hits through `querySearchIndex` from `services/search/src/index.js`.

The search boundary builds tenant/environment-bearing index documents and applies `services/authz-filter` before returning results, snippets, match reasons, facets, or counts. Client-side filtering is not an authorization control.

Search counts and facets are computed only over visible authorized results. Search responses must not expose authorization-hidden counts such as `filtered_count`, `hidden_count`, or equivalent fields.

## Index Schema

`buildSearchIndexDocument(record)` emits `phase5.search-index.v1` documents with:

- canonical scope fields: `tenant_id`, `environment`, `release_id`, `release_context`, `assertion_type`, `lifecycle_status`, `permitted_uses`, `license_status`
- object fields: `object_id`, `object_type`, `result_type`, `display_label`, `preferred_label`
- searchable fields: `identifiers`, `synonyms`, `mappings`, `relationships`, `evidence_refs`, `sources`, `searchable_text`
- index guard fields: `indexed_for_tenant`, `indexed_environment`, `indexed_object_type`

`indexGovernedStoreState(...)` / `indexGovernedRecords(...)` flattens canonical entities, diseases, targets, compounds, trials, products, adverse events, documents, mappings, relationships, and evidence into those documents. The index is intentionally replayable from a release snapshot rather than manually edited.

## Retrieval

`searchIndexedDocuments({ documents, query })` is a candidate-generation helper only. Production request paths must use `SearchIndexService.search(...)` or pass candidates through `querySearchIndex(...)` before returning anything to a caller.

Candidate retrieval supports:

- keyword search over labels, descriptions, snippets, evidence, and derived searchable text
- exact identifier/CURIE search over canonical IDs, object IDs, assertion IDs, mappings, and external IDs
- synonym-expanded search over governed synonyms and aliases
- facets for `object_type`, `entity_type`, `source`, `assertion_type`, and `release_context`

Every retrieval-produced hit has non-empty `match_reasons`. Each reason includes both UX/API fields (`reason_type`, `field`) and explanation fields (`match_type`, `matched_field`) so Andy's `explainSearchHit` can resolve the same reason shape authoritatively.
