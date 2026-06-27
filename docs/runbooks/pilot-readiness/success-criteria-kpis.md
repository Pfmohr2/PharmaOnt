# Pilot Success Criteria And KPI Targets

Pilot scope: aspirin antiplatelet curation for COX/PTGS targets.

This KPI shape is intended to align with Phyllis's P7-OBS-KPI work. Each KPI is defined as a structured row with an owner, measurement window, source, target, and exit-gate impact.

## KPI Shape

Each KPI should be represented with:

- `kpi_id`
- `name`
- `phase`
- `pilot_scope`
- `owner_role`
- `definition`
- `measurement_window`
- `data_source`
- `target`
- `warning_threshold`
- `critical_threshold`
- `exit_gate`
- `evidence`

## Success Criteria

The pilot is successful only if all mandatory criteria pass:

1. A trained pilot team can complete the scripted aspirin/PTGS workflow without engineering intervention.
2. Required ChEMBL and UniProt source slices ingest with pinned source versions, artifact hashes, provenance, and license metadata.
3. Curators can review mappings, synonyms, relationships, evidence, duplicate flags, and AI suggestions in governed queues.
4. Low-confidence and duplicate model suggestions are visibly distinct, routed correctly, and never merged or approved automatically.
5. Domain approver and release manager can create a release candidate only from governed approved/staged entries.
6. Workbench search, entity detail, evidence, explanation, graph, and export affordances work against the pilot release.
7. Export manifest preserves regulated fields and creates no hidden-count leakage.
8. Compliance/security reviewer confirms no unresolved P0/P1, no unauthorized cross-tenant visibility, and no causal FAERS presentation.
9. Pilot sponsor accepts the output as sufficient for a controlled next-step expansion decision.

## KPI Targets

| KPI ID | Name | Owner role | Target | Warning | Critical / P1 trigger |
| --- | --- | --- | --- | --- | --- |
| P7-PILOT-KPI-001 | Source ingestion success | Connector operator | 100% required source jobs complete for approved ChEMBL and UniProt slices. | Any retryable failure not resolved in same day. | Required source cannot ingest or replay idempotently. |
| P7-PILOT-KPI-002 | Source provenance completeness | Compliance/security reviewer | 100% source-derived records have source version, artifact hash, provenance ID, license policy, and disclaimer IDs. | Any non-release row missing one field. | Any release/export candidate missing a required regulated field. |
| P7-PILOT-KPI-003 | Dead-letter explainability | Connector operator | 100% dead letters include source record ID, reason, tenant, environment, connector, and correlation ID. | Any dead letter requires engineering inspection to understand. | Dead-letter handling loses record lineage or blocks unrelated records. |
| P7-PILOT-KPI-004 | Normalization reviewability | Curator | 100% accepted candidates show evidence refs, provenance, confidence source, duplicate status, and diff/review context. | Any candidate needs manual source lookup outside the app. | Candidate can be approved without evidence/provenance. |
| P7-PILOT-KPI-005 | AI suggestion governance | Expert reviewer | 100% model suggestions render as model_suggested, proposed, unreleased, unapproved, with source spans and feedback affordances. | Any suggestion lacks prompt/model/score display. | Any suggestion appears approved/released or can bypass human review. |
| P7-PILOT-KPI-006 | Expert-review routing | Domain expert reviewer | 100% low-confidence suggestions route to expert review with reason and policy ID. | Any route has missing confidence band or risk level. | Low-confidence suggestion can be approved without expert-review path. |
| P7-PILOT-KPI-007 | Duplicate handling | Curator | 100% duplicate candidates are flagged and never auto-merged. | Duplicate rationale missing or unclear. | Duplicate path mutates canonical data without governed approval. |
| P7-PILOT-KPI-008 | Search authorization safety | Compliance/security reviewer | 0 hidden-count leaks; unauthorized results absent server-side. | Any neutral policy notice missing. | Any hidden count, placeholder, or cross-tenant result is visible. |
| P7-PILOT-KPI-009 | Workbench task completion | Pilot sponsor | 5/5 scripted tasks completed by at least two pilot users without engineering help. | One task needs support workaround. | Any core task cannot be completed in the UI/API. |
| P7-PILOT-KPI-010 | Release candidate integrity | Release manager | 100% release items have immutable validation evidence, approval trace, source pins, and audit range. | Any waiver needed. | Release candidate can be assembled from forged or unresolved evidence. |
| P7-PILOT-KPI-011 | Export fidelity | Release manager | 100% exported rows include required IDs, versions, provenance, release context, license metadata, artifact hashes, row hashes, and manifest digest. | `invalid_record_count` greater than 0 but explained. | Export leaks hidden counts or omits regulated fields from exported rows. |
| P7-PILOT-KPI-012 | Pilot support responsiveness | Pilot support | P1 triage within 4 business hours; P2 triage within 1 business day. | P2 exceeds one business day. | P1 exceeds 4 business hours or any P0 not immediately escalated. |

## Scripted Pilot Tasks

Each pilot user should complete these tasks during readiness validation:

1. Search for aspirin and open the compound entity page.
2. Inspect ChEMBL evidence and explain why the entity/result matched.
3. Review a PTGS relationship proposal and route or approve according to role.
4. Review one low-confidence AI suggestion and submit accept/reject/revise feedback.
5. Preview an export for the pilot release and confirm manifest fields.

## Exit Gate Decision

The pilot can proceed to controlled production only when:

- All mandatory success criteria pass.
- All critical KPI thresholds pass.
- No P0/P1 defects remain open.
- Any warning-threshold KPI is either remediated or explicitly accepted by pilot sponsor plus compliance/security reviewer.
- Release manager confirms release snapshot and export manifest integrity.

If any critical threshold fails, treat it as a P1 product-readiness blocker and route to god with owner, evidence, and remediation proposal.
