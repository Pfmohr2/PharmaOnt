# Pilot Dataset Checklist

Pilot scope: aspirin antiplatelet curation for COX/PTGS targets.

Use this checklist before each pilot dry run and before controlled production onboarding.

## Dataset Inventory

| Dataset slice | Required | Source | Minimum records | Purpose |
| --- | --- | --- | --- | --- |
| Aspirin compound identity | Yes | ChEMBL `CHEMBL_34` | CHEMBL25 and synonyms | Canonical compound, identifiers, evidence refs. |
| PTGS target identity | Yes | UniProt `2026_02` or approved pin | PTGS1, PTGS2 where available | Canonical targets, synonyms, target identifiers. |
| Compound-target relationship evidence | Yes | ChEMBL plus curated evidence refs | At least one evidence-backed aspirin/PTGS assertion | Relationship review and explanation path. |
| Synonym/mapping candidates | Yes | ChEMBL/UniProt normalized output | At least one synonym and one mapping candidate | Mapping registry and proposal workflow validation. |
| AI suggestion candidates | Yes | Phase 6 AI curation service or fixture | At least one each: entity_linking, synonym, relationship, duplicate | Suggestion UI and feedback workflow. |
| Safety context | Optional | openFDA FAERS approved snapshot | Small non-causal adverse-event context slice | Safety display only; not causal. |
| Pilot documents/evidence artifacts | Yes | Source artifact store | Source records/spans for every assertion and suggestion | Evidence viewer, explanation panel, release validation. |

## Required Record Shape

Every source-derived row entering the pilot must carry:

- `tenant_id`
- `environment`
- `source_name`
- `source_version`
- `source_record_id`
- `source_record_uri` when available
- `source_retrieved_at`
- `source_snapshot_digest` or raw artifact digest
- `license_classification`
- `license_policy_id`
- `retention_class`
- `disclaimer_ids`
- `provenance_id`
- `evidence_refs`
- `artifact_hash` or source artifact pointer

Every mapping, synonym, relationship, or canonical assertion candidate must carry:

- Stable canonical or candidate ID.
- Assertion type.
- Lifecycle/review state.
- Source and target vocabulary names.
- Source and target vocabulary versions where applicable.
- Evidence refs.
- Provenance ID.
- Confidence score and confidence source only when produced by a real model or deterministic matcher.
- Duplicate status.
- Tenant/environment scope.

Every AI suggestion candidate must carry:

- `schema_version: ai-suggestion-candidate.v1` before API normalization where applicable.
- `candidate_id` and `suggestion_id`.
- `suggestion_type`: one of `document_entity_extraction`, `entity_linking`, `synonym`, `relationship`, `duplicate`.
- `proposal_type`.
- `assertion_type: model_suggested`.
- `lifecycle_status: proposed`.
- `review_status: proposed`.
- `release_id: null`.
- `candidate_payload` and `payload`.
- `score`, `confidence_score`, `confidence_band`, `confidence_source`, and `confidence`.
- `model_name`, `model_version`, and `prompt_version`.
- `evidence_refs` and `source_spans`.
- `provenance_id` and provenance payload.
- `governance.visual_state: ai_suggestion_distinct`.
- `governance.approval_state: unapproved`.
- `governance.requires_human_review: true`.
- `duplicate_status`.
- `rationale`.
- `safety.faers_context`, `safety.causality_allowed`, and `safety.faers_causal_blocked`.

## Governance And Provenance Checks

Before ingestion:

- Source is approved for pilot tenant and environment.
- Source version is pinned and documented.
- License classification and policy ID are known.
- Unknown license or sensitivity fails closed.
- No internal PHI/PII source is included in the first pilot run.

During ingestion:

- Raw artifacts are content-addressed.
- Replays are idempotent.
- Dead-letter records include source record ID, reason, tenant, environment, connector ID, and correlation ID.
- Source freshness metric is emitted.
- Records targeting a release graph are rejected before persistence.

During normalization and curation:

- No fabricated confidence.
- Duplicate candidates are flagged, not merged.
- Low-confidence AI suggestions route to expert review.
- Model-suggested candidates cannot be approved or staged without governed human proof.
- FAERS/openFDA suggestions cannot be causal.

Before release:

- Validation preview has no critical unresolved findings.
- Release candidate is assembled only from approved/staged governed entries.
- Validation evidence is resolved from immutable validation runs.
- Source-version pins are included in release metadata.
- Audit range and approval trace are complete.

Before export:

- Export preview is generated through the server export boundary.
- No hidden authorization counts are displayed.
- Public fields only: `record_count`, `invalid_record_count`, rows, row content hashes, manifest digest, restrictions, preserved fields, and export job state.
- Required export fields are present: IDs, source/target vocabulary versions, source versions, provenance IDs, evidence refs, release context, license metadata, artifact hashes, row content hashes.

## Minimum Pilot Fixture Set

The pilot dry run should include at least:

- 1 compound canonical entity: aspirin.
- 2 target canonical entities: PTGS1 and PTGS2, or one target plus documented source unavailability for the other.
- 2 compound synonyms.
- 1 source-to-canonical mapping.
- 1 compound-target relationship.
- 1 evidence artifact for each approved assertion.
- 1 model-suggested entity-linking candidate.
- 1 model-suggested synonym candidate.
- 1 model-suggested relationship candidate.
- 1 duplicate-flagged candidate.
- 1 low-confidence candidate routed to expert review.
- 1 rejected candidate retained for audit.
- 1 revised candidate with feedback record.
- 1 release candidate and export manifest.

## Data Acceptance Checklist

- [ ] Pilot tenant and environment are present on every row.
- [ ] Source names and source versions match approved pins.
- [ ] Raw artifacts are content-addressed and replay-safe.
- [ ] Evidence refs resolve to visible evidence records for authorized pilot users.
- [ ] Source spans include offsets, text, evidence ID, source ID, and document/source record ID.
- [ ] Provenance IDs resolve to actor/activity/method/source/time/audit event metadata.
- [ ] License policy IDs and restrictions are present.
- [ ] FAERS/openFDA records, if included, carry non-causal limitation text.
- [ ] No model-suggested candidate is marked approved, released, active, or published.
- [ ] Duplicate candidates are flagged only.
- [ ] Export preview reports zero missing regulated fields for required release rows, or `invalid_record_count` is explained and accepted before pilot exit.
