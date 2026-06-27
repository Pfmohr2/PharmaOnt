# services/normalization

Entity normalization and mapping pipelines.

Normalization emits candidate canonical entities, mappings, synonyms, and relationship assertions with provenance and confidence.

## MVP engine

`src/index.js` exports `NormalizationEngine` and `normalizeSourceRecord()`.
The engine consumes a connector normalized output object and emits reviewable
proposals only. It never writes to released graphs, never approves mappings,
and never fabricates ML confidence.

Candidate mapping proposals follow the Phase 1 mapping object contract with:

- `mapping_id`, `source_entity_id`, `target_entity_id`, `predicate`
- `source_vocabulary`, `source_vocabulary_version`
- `target_vocabulary`, `target_vocabulary_version`
- `confidence_score`, `confidence_band`, `scoring_signals`
- `evidence_ids`, `evidence_refs`, `provenance_id`, `provenance`
- `review_status: "proposed"`, `release_id: null`, `auto_publish: false`
- `duplicate_candidate_flags` when possible duplicates are detected

The 11 required normalization stages are represented in `stage_trace`.
