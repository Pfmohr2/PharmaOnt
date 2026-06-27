# Phase 5 Workbench UX Spec

Owner: Phyllis, UX and Product Design  
Audience: Pam, frontend; Stanley, API; search, provenance, security, QA

## Scope

Phase 5 delivers the workbench surfaces for search, explainability, entity inspection, evidence review, graph neighborhood exploration, and export. This spec is a UI and API contract guide only; it does not implement frontend or backend code.

Phase 5 exit criteria covered here:

- Users can search diseases, targets, compounds, trials, products, adverse events, and documents.
- Results show why they matched.
- Evidence and provenance are accessible.
- Assertion type is visible.
- Unauthorized results are filtered.
- Entity pages show mappings, synonyms, relationships, evidence, history, and impact.
- Export preserves IDs, versions, release context, and provenance.

Hard governance assumptions:

- Search/API responses are already tenant-, entitlement-, release-, and role-filtered server-side. The UI must never imply hidden counts or try to reveal unauthorized records.
- AI-suggested assertions are visually and semantically distinct from approved, imported, inferred, human-curated, deprecated, staged, or released assertions.
- Match reasons, explanations, evidence summaries, validation status, export eligibility, and graph edges are server-resolved from trusted stores. The UI renders them; it does not infer regulated state from caller-supplied data.
- Exports are generated from immutable release snapshots or approved server-side working scopes only. Export requests pass IDs and options; server resolves content, provenance, license, and audit obligations.

## Badge System

Assertion badges appear in result rows, entity relationship tables, evidence links, explanation panels, and graph edges.

| Badge | Visual intent | Meaning |
|---|---|---|
| `Approved` | Solid green | Human or policy-approved governed assertion. |
| `Released` | Solid blue | Included in immutable release context. |
| `Staged` | Blue outline | Included in release candidate, not active release. |
| `Imported` | Gray | Source-backed but not local endorsement by itself. |
| `Inferred` | Purple outline | Deterministically derived; explanation must show derivation path. |
| `Human curated` | Teal | Curator-created or edited with review provenance. |
| `Model suggested` | Amber outline plus warning icon | AI/ML suggestion only; never shown as approved fact. |
| `Deprecated` | Muted gray with strike indicator | Historical assertion retained for traceability. |
| `Restricted` | Lock icon | Evidence or record has access/export constraints. |

Do not rely on color alone. Every badge needs text and an accessible label.

## Global Layout

```text
+---------------------------------------------------------------------+
| PharmaOps Workbench                    Release: active v2026.0.0 v |
+---------------+-----------------------------------------------------+
| Search        | Search input, filters, entity pages, evidence, graph|
| Recent        |                                                     |
| Saved exports |                                                     |
| Audit links   |                                                     |
+---------------+-----------------------------------------------------+
```

Global controls:

- Release context selector: active release by default; optional working scope only when role permits.
- Tenant/environment indicator: read-only visible context.
- Search box: keyword, synonym-expanded, and identifier search.
- Export menu: disabled until selected view has exportable server-resolved scope.
- Permission state: show only allowed actions returned by API.

## Search Results

### Wireframe

```text
+ Search diseases, targets, compounds, trials, products, events, docs +
| aspirin target safety                                      [Search] |
+---------------------------------------------------------------------+
| Type v  Assertion v  Source v  Release v  Evidence v  Export v     |
+---------------------------------------------------------------------+
| 128 visible results for active release v2026.0.0                   |
| Unauthorized records are filtered by policy.                       |
+---------------------------------------------------------------------+
| Compound  Aspirin                         Approved  Released       |
| ID: pharm:compound/chembl-CHEMBL25                                  |
| Match reasons: label exact; synonym ASA; external ID CHEMBL25       |
| Evidence: ChEMBL 34, PubChem 2026-06-01          [Why] [Open]       |
+---------------------------------------------------------------------+
| Relationship  Product has adverse event       Imported  Restricted |
| Product X -> adverse event headache                                  |
| Match reasons: evidence span contains "aspirin"; product synonym    |
| Disclaimer: source reports are non-causal.       [Why] [Evidence]   |
+---------------------------------------------------------------------+
```

### Interactions

- Pressing Enter runs search with current filters.
- Clicking a result label opens entity page or assertion detail based on object type.
- `Why` opens explanation panel pinned to the result.
- `Evidence` opens evidence viewer scoped to the result.
- Assertion badges filter on click when the badge type is included in facets.
- Export menu exports current server-resolved result set or selected rows only when API returns `export_allowed: true`.

### States

| State | UI behavior |
|---|---|
| Loading | Keep filters visible; show row skeletons and disabled export. |
| Empty | Show "No visible results in this release context" and keep filters editable. Do not mention hidden unauthorized records. |
| Unauthorized-filtered | Show neutral note: "Results are filtered by your tenant, release, source entitlements, and role." No hidden count. |
| Error | Show retry and correlation ID. Do not display partial unfiltered data. |

### Data Needed

- `query_id`, `query`, `release_context`, `tenant_id`, `environment`.
- `results[]`: `object_id`, `object_type`, `display_label`, `preferred_label`, `snippet`, `rank`, `score_band`, `assertion_type`, `lifecycle_status`, `review_status`, `release_id`, `badges[]`.
- `match_reasons[]`: `reason_type`, `field`, `matched_value`, `normalized_value`, `source`, `evidence_id`, `highlight_ranges`.
- `facets`: type, assertion type, lifecycle, source, evidence type, release, vocabulary, confidence band.
- `policy_notice`: plain text filtered-state notice, no hidden record counts.
- `actions`: `can_open`, `can_export`, `can_view_evidence`, `can_view_graph`.

## Entity Page

### Wireframe

```text
+ Aspirin                                      Compound  Approved Released +
| pharm:compound/chembl-CHEMBL25       ChEMBL:CHEMBL25  PubChem:CID2244   |
| Source versions: ChEMBL 34; PubChem 2026-06-01       [Export entity]    |
+-------------------------------------------------------------------------+
| Overview | Mappings | Synonyms | Relationships | Evidence | History | Impact |
+-------------------------------------------------------------------------+
| Overview                                                                |
| Preferred label, definition, lifecycle, release membership, warnings    |
+-------------------------------------------------------------------------+
| Mappings                                                                |
| Source            Predicate       Target             Type       Why      |
| ChEMBL:CHEMBL25   exactMatch      PubChem:CID2244    Approved   [Why]    |
+-------------------------------------------------------------------------+
| Relationships                                                           |
| Predicate                 Object              Assertion        Evidence |
| compound_has_target       PTGS1               Human curated    [3 refs] |
+-------------------------------------------------------------------------+
```

### Interactions

- Tabs preserve scroll and filter state within the entity page.
- Every mapping, synonym, relationship, and evidence row has a `Why` or `Evidence` affordance.
- History entries open explanation panel with before/after provenance when available.
- Impact tab shows downstream affected relationships, mappings, release membership, and export packages.
- `Export entity` opens export affordance with this entity and server-resolved dependent records.

### States

| State | UI behavior |
|---|---|
| Loading | Header skeleton first, then tab skeletons. |
| Empty tab | Explain the absence only within visible authorized scope, e.g. "No visible relationships in this release context." |
| Unauthorized-filtered | Per-tab policy note when API returns filtered notice. No hidden counts. |
| Error | Keep entity header if already loaded; show tab-level retry and correlation ID. |

### Data Needed

- Header: `entity_id`, `entity_type`, `preferred_label`, `definition`, `external_ids[]`, `lifecycle_status`, `release_membership[]`, `badges[]`.
- Mappings: `mapping_id`, source/target IDs, vocabularies and versions, predicate, confidence band, evidence refs, provenance id, review/release status.
- Synonyms: value, language, source, source version, assertion type, lifecycle, provenance id, evidence refs.
- Relationships: `relationship_id`, subject, predicate, object, object labels/types, assertion type, confidence, lifecycle, evidence refs, provenance id, release id.
- Evidence: evidence refs and access status.
- History: audit event ids, actor display, role, action, previous/next lifecycle, rationale digest or summary, timestamps, release ids.
- Impact: affected entity IDs, relationship IDs, mapping IDs, release candidates, active exports, downstream graph neighborhoods.

## Evidence Viewer

### Wireframe

```text
+ Evidence: pharmev:evidence-2026-000001              Restricted [restricted] +
| Source: ChEMBL | Version: 34 | Type: source_record | License: ... |
+------------------------------------------------------------------+
| Citation / source record metadata                                |
| Artifact hash, source record ID, ingestion run, provenance ID     |
+------------------------------------------------------------------+
| Evidence content                                                  |
| [permitted snippet, span, or structured fields]                    |
| Highlighted spans tied to selected assertion                       |
+------------------------------------------------------------------+
| Supports                                                          |
| Mapping pharmmap:...        Approved Released       [Why]          |
| Relationship pharmrel:...   Model suggested         [Why]          |
+------------------------------------------------------------------+
```

### Interactions

- Evidence opens from result rows, entity tabs, explanation panel, or graph edge detail.
- Restricted evidence shows permitted metadata and pointer fields only; no client-side redaction.
- Source/version and provenance IDs are copyable.
- `Supports` rows navigate back to assertion/entity/explanation.

### States

| State | UI behavior |
|---|---|
| Loading | Metadata skeleton, content skeleton, supports skeleton. |
| Empty content | Show pointer-only or metadata-only state from API; do not imply missing evidence if content is restricted. |
| Unauthorized-filtered | Show "You can view metadata only for this evidence under current entitlements" if API returns metadata-only. |
| Error | Show retry and correlation ID; keep already-visible metadata if safe. |

### Data Needed

- `evidence_id`, `evidence_type`, `source_name`, `source_version`, `source_record_id`, `artifact_uri` or pointer, `artifact_hash`.
- `license_classification`, `license_policy_id`, `export_restrictions[]`, `disclaimer_ids[]`, `data_sensitivity`.
- `content_mode`: full, snippet, structured fields, pointer-only, metadata-only.
- `spans[]`: field/path, start/end offsets, text, assertion IDs.
- `provenance_id`, ingestion job/run IDs, created_at/generated_at.
- `supports[]`: assertion IDs/types, relationship/mapping IDs, lifecycle/release status, evidence role.
- `actions`: `can_export`, `can_open_artifact`, `can_view_raw`.

## Explanation Panel

### Wireframe

```text
+ Why this matched / why this assertion holds +
| Object: Aspirin                             |
| Assertion: compound_has_target PTGS1        |
| Type: Human curated  Status: Approved       |
+---------------------------------------------+
| Match reasons                               |
| 1. Exact label match: "aspirin"             |
| 2. Synonym match: "ASA"                     |
| 3. External ID match: CHEMBL25              |
+---------------------------------------------+
| Evidence chain                              |
| Evidence pharmev:... source ChEMBL 34       |
| Provenance pharmprov:...                    |
| Validation report validation:...            |
+---------------------------------------------+
| Governance                                  |
| Approved by role domain_approver            |
| Audit event audit:...                       |
| Release v2026.0.0                           |
+---------------------------------------------+
```

### Interactions

- Panel can open as side panel from search, entity rows, evidence supports, or graph nodes/edges.
- Switching selected result keeps panel open and updates content.
- Evidence, provenance, audit event, validation report, and release IDs are linkable if API returns `can_open`.
- Explanation for `model_suggested` must show suggestion provenance and warning that it is not approved.

### States

| State | UI behavior |
|---|---|
| Loading | Panel skeleton; preserve previous panel title until new content arrives. |
| Empty | "No explanation available for this visible record." Treat as API gap for QA, not hidden content. |
| Unauthorized-filtered | Show available explanation fields only; omit restricted sections without placeholders that reveal hidden records. |
| Error | Show retry and correlation ID. |

### Data Needed

- `object_id`, `object_type`, `assertion_id`, `assertion_type`, `lifecycle_status`, `release_id`, `badges[]`.
- `match_reasons[]` for search context.
- `assertion_reasons[]`: predicate, confidence, rule/source/reviewer/model route, source fields, derivation path if inferred.
- `evidence_chain[]`: evidence IDs, roles, source/version, spans, validation report IDs.
- `provenance`: provenance ID, actor or service, method, source, source version, timestamps, environment.
- `governance`: review status, approver role/user display if allowed, audit event IDs, release membership, deprecation/supersession metadata.

## Graph Neighborhood View

### Wireframe

```text
+ Graph neighborhood: Aspirin                         Depth 1 v  Export v +
+-------------------------------------------------------------------------+
| Legend: Compound o Target o Disease o Trial o Product o Evidence *      |
| Edge badges: Approved Released Imported Inferred Model suggested         |
+-------------------------------------------------------------------------+
|                                                                         |
|          PTGS1 o                                                        |
|            | compound_has_target [Human curated][Approved]              |
|            |                                                            |
|  Evidence * - entity_supported_by_evidence - o Aspirin - exactMatch - o |
|                                             ChEMBL25       PubChem2244  |
|                                                                         |
+-------------------------------------------------------------------------+
| Selected edge                                                           |
| compound_has_target | confidence high | evidence 3 refs | [Why]         |
+-------------------------------------------------------------------------+
```

### Interactions

- Default depth is 1; deeper expansion must request server-filtered neighbors.
- Clicking node opens entity preview and link to entity page.
- Clicking edge opens selected-edge detail and explanation panel.
- Badge legend toggles visible assertion types within already-authorized graph payload.
- Export exports selected subgraph only when server returns an exportable graph scope.

### States

| State | UI behavior |
|---|---|
| Loading | Preserve current graph, show loading indicator on expanding node. |
| Empty | "No visible neighbors in this release context." |
| Unauthorized-filtered | Show neutral policy note; do not render phantom nodes or hidden edge counts. |
| Error | Keep existing graph if safe; show retry for failed expansion. |

### Data Needed

- `root_entity_id`, `release_context`, `depth`, `policy_notice`.
- `nodes[]`: id, type, label, lifecycle, release, badges, degree within visible graph, export eligibility.
- `edges[]`: id, subject, predicate, object, relationship/assertion ID, assertion type, confidence, lifecycle, evidence count, provenance ID, release ID, badges.
- `legend`: available node and edge types in visible payload.
- `selected_detail`: evidence refs, match/explanation summary, actions.

## Export Affordances

### Wireframe

```text
+ Export +
| Scope: current search results / selected rows / entity / subgraph       |
| Format: JSON-LD v  CSV v  TSV v  RDF v  Validation report v             |
| Release: active v2026.0.0                                               |
| Includes: IDs, vocabulary versions, release context, provenance, hashes  |
| Restrictions: attribution required; restricted evidence metadata only    |
| [Cancel]                                         [Create export]         |
+-------------------------------------------------------------------------+
```

### Interactions

- Export entry points: search toolbar, entity header, evidence viewer, graph toolbar.
- Export preview displays server-resolved count, release context, included object classes, and restrictions.
- `Create export` calls API with scope ID or selected IDs; server resolves final records and returns an export job ID.
- Completed export link appears in global saved exports and optionally current surface.

### States

| State | UI behavior |
|---|---|
| Loading preview | Disable create button until server returns exportability and restrictions. |
| Empty/unexportable | Show server reason, e.g. no visible exportable records or missing immutable release context. |
| Unauthorized-filtered | Show only allowed export scope and restrictions. |
| Error | Show retry and correlation ID; do not generate local fallback exports. |

### Data Needed

- `export_scope`: search query ID, selected object IDs, entity ID, graph scope ID, evidence ID.
- `release_id`, `release_context`, `environment`, `tenant_id`.
- `formats[]`, `default_format`, `estimated_record_count`, `included_object_types[]`.
- `preserved_fields`: IDs, source/target vocabulary versions, evidence refs, provenance IDs, source versions, release membership, artifact hashes, license metadata.
- `restrictions[]`: license, restricted evidence, attribution, disclaimer, destination limits.
- `export_job`: job ID, status, created_by, audit event ID, artifact hash, download URL when ready.

## Component Inventory

| Component | Used by | Key props/data |
|---|---|---|
| Workbench shell | All surfaces | tenant, environment, active release, navigation, global search. |
| Search bar | Search, global shell | query, supported query modes, recent queries. |
| Filter/facet bar | Search, graph | facets, active filters, release context. |
| Result row | Search | object summary, badges, match reasons, evidence count, actions. |
| Assertion badge | All | assertion type, lifecycle, release/review status, restricted flag. |
| Match reason list | Search, explanation | reason type, field, value, source/evidence link. |
| Entity header | Entity page | label, IDs, type, lifecycle, release, warnings. |
| Entity tab table | Entity page | mappings, synonyms, relationships, evidence, history, impact. |
| Evidence card/viewer | Evidence, explanation | source/version, content mode, spans, restrictions. |
| Explanation panel | Search/entity/evidence/graph | match reasons, evidence chain, provenance, governance. |
| Graph canvas | Graph | nodes, edges, badges, selected detail, expansion state. |
| Export dialog | Search/entity/evidence/graph | scope, formats, restrictions, job status. |
| Empty/error state | All | safe message, retry action, correlation ID. |

## API Alignment Checklist

Stanley should provide endpoints or equivalent payloads for:

- Search with server-side authorization filtering, match reasons, facets, badges, and exportability.
- Entity detail with mappings, synonyms, relationships, evidence, history, and impact sections.
- Evidence detail with content mode, source/version, spans, provenance, supports, and restrictions.
- Explanation by result/assertion/evidence/graph edge ID.
- Graph neighborhood by root entity ID, release context, depth, filters, and server-resolved visible nodes/edges.
- Export preview and export job creation from search/entity/evidence/graph scopes.

Pam should implement UI behavior so:

- Every visible assertion has an assertion badge.
- Every result row has visible match reasons without opening a secondary panel.
- Every `Why` opens explanation panel.
- Every evidence count/link opens evidence viewer when permitted.
- Unauthorized filtering is presented neutrally without hidden counts.
- Export is disabled until export preview confirms server-side eligibility.

## QA Acceptance Cases

- Search for a compound by label, synonym, and external ID; visible result shows all match reasons.
- Search result with relationship assertion shows assertion type badge and evidence link.
- Entity page for a compound shows mappings, synonyms, relationships, evidence, history, and impact tabs.
- Evidence viewer displays source name, source version, evidence type, provenance ID, and restrictions.
- Explanation panel for a result shows match reasons, evidence chain, provenance, governance, and release context.
- Graph neighborhood shows typed nodes, assertion-badged edges, and no hidden unauthorized counts.
- Export from search/entity/graph preserves IDs, versions, release context, provenance, license metadata, and artifact hashes.
- Model-suggested assertion is visually distinct and never styled as approved or released.
- Restricted evidence appears as metadata-only or pointer-only exactly as returned by API.
- API error states show correlation IDs and never fall back to local unfiltered rendering.

