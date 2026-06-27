# services/api

REST or GraphQL API facade.

Responsibilities:

- Central product API boundary.
- Authentication and authorization enforcement.
- Controlled SPARQL access routing.
- Export request authorization.
- Tenant, environment, release, and license scoping.

## Phase 5 Query Authorization

Stanley's API facade must route every result-returning query through `services/api/src/query-boundary.js`.

`executeAuthorizedQuery` and `filterApiResponse` call the shared `services/authz-filter` chokepoint before returning results. API handlers must not return raw resolver rows, raw SPARQL rows, raw entity-page sections, or export previews directly to clients.

The API query boundary does not return authorization-hidden counts. API handlers must not serialize `filtered_count`, `hidden_count`, `authorization_filtered_count`, or equivalent fields.

## Phase 5 Workbench API

Published contract: `docs/api/phase5-workbench.openapi.json`.

Implementation: `services/api/src/workbench.js`.

The workbench facade exposes dependency-injected handler methods for the eventual HTTP layer:

- `search({ principal, request })` routes candidate hits through `services/search/src/index.js` `querySearchIndex(...)`, then through `executeAuthorizedQuery(...)`.
- `entityDetail({ principal, entityId, request })` resolves semantic-store detail rows, filters the header and every section through `executeAuthorizedQuery(...)`, and reconstructs the entity page from visible rows only.
- `explainSearchHit({ principal, hitId|hit, request })` authorizes the search hit before calling Andy's explanation service.
- `evidenceForAssertion({ principal, assertionId, request })` authorizes the assertion before calling Andy's evidence viewer service.
- `exportPreview(...)` and `createExport(...)` resolve export scope rows and call `services/export/src/index.js` `buildAuthorizedExport(...)`.

Export consumers must supply rows with the server-enforced regulated export fields: `id`, `tenant_id`, `environment`, `release_id`, `provenance_id`, `artifact_hash`, `license_status`, `license_classification`, `license_policy_id`, and source/target vocabulary versions for mapping, synonym, relationship, canonical, approved, and released assertion rows. The export boundary drops incomplete authorized rows and reports public `invalid_record_count`; `row_content_hashes` and `manifest_digest` are computed from canonical exported row content.

The workbench API does not expose authorization-hidden counts, because those counts would reveal hidden cross-tenant or restricted candidates. Public export responses expose only `record_count`, `invalid_record_count`, exported rows, and row/content hashes. `export_job` is null for previews, zero-row scopes, and hidden-only scopes.

The API layer is intentionally framework-free in Phase 5 so frontend and QA can bind to the contract while the transport layer remains replaceable.

## Phase 6 AI Curation API

Published contract: `docs/api/phase6-curation.openapi.json`.

Implementation: `services/api/src/ai-curation.js`.

The Phase 6 facade exposes:

- `fetchSuggestions({ principal, request })` for document, entity, or queue scopes. It normalizes Andy's `ai-suggestion-candidate.v1` output to `assertion_type: "model_suggested"`, `lifecycle_status: "proposed"`, `review_status: "proposed"`, and `release_id: null`, then routes it through `executeAuthorizedQuery(...)`.
- `submitFeedback({ principal, request })` for `accept`, `reject`, or `revise`. It validates the suggestion candidate, requires feedback authorization, runs the no-auto-release gate, and routes to Phyllis's governed `recordSuggestionFeedback` workflow hook. The legacy injected name `submitFeedbackToWorkflow` is accepted only as a compatibility alias.

Suggestions must include `candidate_id`/`suggestion_id`, `suggestion_type`, `proposal_type`, `model_version`, optional `prompt_version`, real model/calibration `score`, `evidence_refs`, `source_spans`, `provenance_id`, governance/safety metadata, and `duplicate_status`. The API rejects fabricated confidence, approved/released suggestion state, missing evidence/spans, auto-publish or release-eligible governance, duplicate merge permission, and FAERS/openFDA causal suggestions. Duplicate suggestions are flagged through `duplicate_status`; they are not auto-merged.

The API no-auto-release hook is advisory at the facade and mandatory again at the write paths: Phyllis's workflow must bind immutable feedback proof into model-suggested governed decisions, and Jim's release manager must reject raw `model_suggested` items during release candidate assembly.
