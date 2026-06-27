# PharmaOps Pilot User Guide

Audience: pilot users, curators, domain approvers, and release reviewers who work in the PharmaOps workbench.

This guide explains how to search the governed graph, inspect evidence, review AI suggestions, submit curation feedback, approve or reject candidates, and confirm release-facing state. PharmaOps is governed by server-side tenant, role, release, license, and evidence checks. If a record is not visible to you, the UI will not expose hidden counts or placeholders.

## Before You Start

You need:

- An active PharmaOps account for the pilot tenant and environment.
- One or more assigned roles, such as `viewer`, `curator`, `domain_approver`, or `release_manager`.
- Access to the relevant release context or working scope.
- Source entitlements for restricted evidence or exportable data.

Use the tenant and environment indicator in the workbench header to confirm you are in the intended pilot workspace before taking action.

## Core Concepts

| Term | Meaning |
|---|---|
| Entity | A governed object such as a compound, disease, target, product, adverse event, trial, or document. |
| Assertion | A mapping, synonym, relationship, evidence link, or status statement about an entity. |
| Evidence | Source-backed support for an assertion, including source name, source version, record ID, spans, license, and provenance. |
| Provenance | The who/what/how/when metadata that explains where an assertion or evidence record came from. |
| Release context | The immutable release snapshot or working scope used for search, entity pages, evidence, graph views, and exports. |
| AI suggestion | A `model_suggested` candidate only. It is never approved, released, or export-ready until governed human review and release gates succeed. |
| Low-confidence suggestion | A suggestion routed to expert review because its calibrated score is below the expert-review threshold. |
| Duplicate suggestion | A flag-only candidate. Duplicate suggestions can be reviewed, but they must not auto-merge records. |

## Assertion Badges

Badges appear on results, entity tabs, evidence links, explanation panels, and graph edges.

| Badge | How to use it |
|---|---|
| `Approved` | The assertion passed human or governed approval in working state. |
| `Released` | The assertion is included in an immutable release context. |
| `Staged` | The assertion is included in a release candidate, but is not the active release. |
| `Imported` | The assertion came from a source-backed import and is not local endorsement by itself. |
| `Inferred` | The assertion was deterministically derived; use `Why` to inspect derivation. |
| `Human curated` | The assertion was created or edited by a curator with review provenance. |
| `Model suggested` | AI-generated proposal only. Treat it as unapproved. |
| `Deprecated` | Historical assertion retained for traceability. |
| `Restricted` | Evidence or export is constrained by license or access policy. |

Do not treat badge color as the source of truth. Read the badge text, evidence, provenance, and release context.

## Search The Workbench

Use search to find diseases, targets, compounds, trials, products, adverse events, documents, mappings, synonyms, relationships, and evidence-backed assertions.

1. Confirm tenant, environment, and release context in the workbench header.
2. Enter a keyword, synonym, external identifier, CURIE, or source identifier.
3. Apply filters for type, assertion type, lifecycle, source, evidence type, vocabulary, confidence band, or release context.
4. Run the search.
5. Review result labels, snippets, badges, match reasons, evidence summaries, and available actions.
6. Open `Why` to inspect the explanation panel.
7. Open `Evidence` to inspect the evidence viewer.
8. Open the result label to go to the entity page or assertion detail.

Search behavior:

- Results are server-filtered before the UI receives them.
- Empty results mean "no visible results in this release context."
- The UI must not show hidden unauthorized counts.
- Restricted evidence may show metadata only.
- Export is disabled unless the API returns an exportable authorized scope.

Related API contract: `POST /api/workbench/search` in `docs/api/phase5-workbench.openapi.json`.

## Understand Search Explanations

Use the explanation panel whenever you need to know why a result matched.

1. Select `Why` on a search result, entity row, relationship, mapping, synonym, or graph edge.
2. Review match reasons, including exact labels, synonym expansion, external identifiers, source fields, and highlighted evidence spans.
3. Review assertion type, lifecycle, release context, provenance ID, evidence refs, and confidence or score band.
4. Check source name and source version before using the result in curation or export.
5. For restricted records, use the available metadata and request access through your admin if the full evidence is needed.

Related API contract: `GET /api/workbench/explanations/search-hit/{hitId}`.

## Open An Entity Workspace

An entity page is the main workspace for reviewing a governed object and its connected facts.

1. Open an entity from search results or a relationship/mapping row.
2. Read the header: entity ID, type, preferred label, lifecycle, release membership, external IDs, and badges.
3. Use tabs to inspect:
   - `Overview`: label, definition, lifecycle, release membership, warnings.
   - `Mappings`: source and target vocabularies, versions, predicates, evidence, provenance, confidence.
   - `Synonyms`: labels, aliases, source, language, evidence, lifecycle.
   - `Relationships`: subject, predicate, object, assertion type, confidence, evidence, release state.
   - `Evidence`: source records and evidence refs supporting the entity.
   - `History`: audit events and before/after state.
   - `Impact`: downstream relationships, mappings, release candidates, active exports, and graph neighborhoods.
4. Use `Why` or `Evidence` from any row before making a review decision.
5. If you change filters or release context, re-check the header and tab notices.

Related API contract: `GET /api/workbench/entities/{entityId}`.

## Inspect Evidence

Evidence is required for governed decisions. Use the evidence viewer before accepting, rejecting, revising, approving, staging, or exporting.

1. Open `Evidence` from search, an entity tab, an explanation panel, or a graph edge.
2. Confirm evidence ID, source name, source version, source record ID, artifact hash, and provenance ID.
3. Review content mode:
   - `full`: full permitted evidence content.
   - `snippet`: excerpted permitted content.
   - `structured fields`: source fields only.
   - `pointer-only` or `metadata-only`: restricted or unavailable raw content.
4. Check highlighted spans and confirm they support the selected assertion.
5. Review license classification, export restrictions, disclaimer IDs, and data sensitivity.
6. Use `Supports` rows to move back to related assertions or entities.

For FAERS/openFDA records, non-causal source limitations are expected. Treat FAERS/openFDA as safety report context only unless the system shows an approved, non-FAERS causal source and governed human approval.

Related API contract: `GET /api/workbench/evidence/by-assertion/{assertionId}`.

## Review AI Suggestions

AI suggestions are governed candidates. They are always returned as `assertion_type = model_suggested`, `lifecycle_status = proposed`, and `release_id = null`.

1. Open the AI suggestion queue, an entity-scoped suggestion view, or a document-scoped suggestion view.
2. Confirm the queue scope:
   - document scope for document entity extraction;
   - entity scope for entity linking, synonyms, relationships, or duplicates;
   - queue scope for review worklists.
3. Review each suggestion:
   - suggestion type and proposal type;
   - model version and prompt version;
   - calibrated score and confidence band;
   - evidence refs and source spans;
   - provenance ID;
   - duplicate status;
   - workflow queue and low-confidence indicator.
4. Open evidence and source spans before taking action.
5. For low-confidence suggestions, expect expert-review routing.
6. For duplicate suggestions, treat them as flag-only and never as an automatic merge.

Related API contract: `POST /api/curation/suggestions` in `docs/api/phase6-curation.openapi.json`.

## Accept, Reject, Or Revise AI Suggestions

Available actions are returned by the API. If an action is disabled, your role or the candidate state does not permit it.

### Accept

Use accept when the suggestion is correct as a candidate for governed workflow.

1. Open the suggestion.
2. Confirm model version, prompt version, score, evidence, source spans, and provenance.
3. Select `Accept`.
4. Enter a concise rationale.
5. Submit feedback.
6. Confirm the feedback receipt shows workflow routing, not approval or release.

### Reject

Use reject when the suggestion is incorrect, unsupported, unsafe, duplicate-ineligible, cross-tenant, license-blocked, or not useful.

1. Open the suggestion.
2. Review evidence and explanation.
3. Select `Reject`.
4. Enter the reason, such as wrong entity, weak evidence, unsupported relationship, or duplicate risk.
5. Submit feedback.
6. Confirm the suggestion remains auditable.

### Revise

Use revise when the suggestion is useful but needs a corrected entity, predicate, synonym, relationship target, or rationale.

1. Open the suggestion.
2. Review evidence and source spans.
3. Select `Revise`.
4. Enter the corrected fields and rationale.
5. Submit feedback.
6. Confirm workflow routing for human review.

Feedback is authorized, no-auto-release gated, and routed to the governed workflow. It does not publish facts.

Related API contract: `POST /api/curation/suggestions/{suggestionId}/feedback`.

## Approve Or Reject Governed Candidates

Approvals apply to governed workflow candidates, not raw AI suggestions.

1. Open the candidate from the review queue, entity page, or workflow view.
2. Confirm it is in the expected tenant and environment.
3. Verify required fields:
   - source and target IDs, when applicable;
   - vocabulary names and versions;
   - predicate;
   - license status;
   - confidence score and confidence band;
   - evidence refs and provenance;
   - duplicate status;
   - audit context.
4. Confirm separation of duties: you must not approve your own submission or a candidate emitted by a service account you own.
5. Select `Approve` or `Reject`.
6. Enter a rationale.
7. Submit the decision.
8. Confirm the candidate state and audit event.

Only authorized human roles can approve or reject. Frontend controls are convenience only; the server enforces the boundary.

## Stage For Release

Release staging is narrower than approval. A candidate must be approved before a release manager can stage it.

1. Open the approved candidate or release staging queue.
2. Confirm release ID and release scope.
3. Confirm release evidence, validation references, license status, duplicate status, and source version pins.
4. Select `Stage for release`.
5. Enter release rationale.
6. Confirm the staged state and audit event.

Staging does not activate a release. It makes the item available for release-candidate assembly.

## Preview And Create Exports

Exports preserve governed IDs, vocabulary versions, release context, provenance, license metadata, and hashes.

1. Search or open an entity page.
2. Confirm release context and visible scope.
3. Select export only when enabled.
4. Run export preview first.
5. Review included row counts, invalid visible rows, license notices, provenance fields, and manifest digest.
6. Create the export job only if the preview matches your intended scope.
7. Save the returned job ID and manifest reference for audit or downstream use.

The export service does not reveal hidden unauthorized counts. Hidden-only scopes do not create ready jobs.

Related API contracts:

- `POST /api/workbench/export/preview`
- `POST /api/workbench/export`

## Common Warnings

| Warning | What to do |
|---|---|
| No visible results | Adjust filters or release context. Do not infer hidden record counts. |
| Restricted evidence | Use metadata-only view or ask an admin for entitlement review. |
| Model suggested | Treat as unapproved. Review and route through feedback/workflow. |
| Low confidence | Route to expert review and inspect evidence carefully. |
| Possible duplicate | Do not merge automatically. Review duplicate evidence and policy. |
| Missing source version | Do not approve or export; source version is required. |
| Fabricated or manual confidence | Do not accept; valid candidates require model-calibrated confidence. |
| FAERS/openFDA causal wording | Reject causal claims from FAERS/openFDA context; non-causal disclaimers are expected. |

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Search returns nothing | Release context, role, tenant, source entitlement, or filters limit visibility. | Clear filters, confirm context, or ask an admin to verify access. |
| Export disabled | API did not authorize export for the current scope. | Run from an approved release or request role/source entitlement review. |
| Evidence shows metadata only | Source is restricted or raw content is not permitted. | Use available metadata or request access. |
| Action button missing | Role, candidate state, or separation-of-duties rule blocks the action. | Ask a different authorized reviewer or release manager. |
| Feedback failed | Suggestion was malformed, unauthorized, or no-auto-release gate failed. | Reopen the suggestion, confirm evidence/provenance, and retry with rationale. |
| Release staging failed | Candidate is not approved, validation evidence is critical, license blocks release, or duplicate status is unresolved. | Resolve candidate validation and ask a release manager to retry. |

## MVP Coverage Checklist

| MVP capability | Covered in this guide |
|---|---|
| Search across entities, assertions, evidence, and documents | Search The Workbench |
| Search explainability and match reasons | Understand Search Explanations |
| Entity workspace with mappings, synonyms, relationships, evidence, history, impact | Open An Entity Workspace |
| Evidence and provenance inspection | Inspect Evidence |
| AI suggestion review | Review AI Suggestions |
| Accept/reject/revise AI feedback | Accept, Reject, Or Revise AI Suggestions |
| Low-confidence routing | Review AI Suggestions; Common Warnings |
| Duplicate flag-only handling | Review AI Suggestions; Common Warnings |
| Governed approval and rejection | Approve Or Reject Governed Candidates |
| Release staging | Stage For Release |
| Export preview and export job creation | Preview And Create Exports |
| RBAC and no hidden unauthorized counts | Before You Start; Search The Workbench; Approve Or Reject Governed Candidates |
| FAERS/openFDA non-causal handling | Inspect Evidence; Common Warnings |
