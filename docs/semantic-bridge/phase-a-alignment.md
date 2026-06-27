# Semantic Bridge Phase A Alignment

Status: canonical Phase A alignment for JSON contracts, SHACL shapes, shacl-runner tests, and causal-safety policy.

Sources:
- `docs/semantic-bridge/relationship-taxonomy.md`
- `docs/semantic-bridge/causal-safety-policy.md`
- `docs/semantic-bridge/contracts/relationship-assertion.schema.json`
- `docs/semantic-bridge/contracts/relationship-path.schema.json`

## Relationship Class Enum

`relationship_class` is exactly one of:

`identity`, `vocabulary_crosswalk`, `hierarchical`, `mechanistic`, `clinical`, `safety`, `regulatory`, `commercial`, `operational`, `evidence_support`, `inferred`, `hypothesis`, `blocked`

Secondary governance tags remain separate from the primary enum:

`causal_sensitive`, `restricted_evidence`, `patient_impacting`

## Class To Predicate Matrix

The predicates below are the only legal `relationshipPredicate` values for each primary class. `pharmrel:`-prefixed forms are equivalent contract literals where present.

| `relationship_class` | Legal predicates |
| --- | --- |
| `identity` | `same_as`, `has_synonym`, `has_external_identifier`, `identity_replaced_by`, `exactMatch` only for scoped identity |
| `vocabulary_crosswalk` | `exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`, `relatedMatch`, `replacedBy`, `hasDbXref`, `notMatch`, `uncertainMatch`, `requiresReview`, `term_maps_to_standard`, `regulatory_crosswalk_to` |
| `hierarchical` | `broader_than`, `narrower_than`, `parent_of`, `child_of`, `part_of`, `has_part`, `subclass_of` |
| `mechanistic` | `compound_has_target`, `target_associated_with_disease`, `mechanistically_related_to`, `inhibits`, `activates`, `binds_target`, `modulates_pathway` |
| `clinical` | `trial_studies_condition`, `trial_uses_intervention`, `trial_has_endpoint`, `clinically_related_to`, `associated_with_outcome`, `biomarker_stratifies_response` |
| `safety` | `product_has_adverse_event`, `safety_context_related_to`, `has_reported_event_context`, `label_mentions_safety_event`, `safety_signal_for_investigation` |
| `regulatory` | `regulatory_crosswalk_to`, `uses_submission_term`, `label_contains_concept`, `submission_codelist_maps_to`, `controlled_term_for_context` |
| `commercial` | `commercially_related_to`, `product_aligned_to_indication`, `market_segment_for_population`, `payer_concept_related_to` |
| `operational` | `operational_dependency_of`, `dataset_feeds_dashboard`, `api_consumer_uses_term`, `workflow_depends_on_source`, `downstream_uses_mapping` |
| `evidence_support` | `entity_supported_by_evidence`, `assertion_supported_by_evidence`, `evidence_supports_relationship`, `evidence_contradicts_relationship`, `evidence_context_for_relationship` |
| `inferred` | `inferred_from_path`, `inferred_mechanistic_bridge`, `inferred_clinical_bridge`, `inferred_safety_context` |
| `hypothesis` | `hypothesis_bridge`, `is_hypothesis_about`, `may_relate_to_investigation`, `accepted_for_investigation`, `convertedToRelationshipAssertion` |
| `blocked` | `unsupported`, `blocked`, `notMatch`, `contradicted_by_evidence`, `license_blocked`, `causal_claim_blocked`, `access_blocked` |

Identity and crosswalk predicates are not domain evidence predicates. `exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`, `relatedMatch`, `replacedBy`, `hasDbXref`, `uncertainMatch`, and `requiresReview` are illegal on evidence-backed and domain classes such as `evidence_support`, `mechanistic`, `clinical`, `safety`, `regulatory`, `commercial`, and `operational`.

## Causal Claim Status

`causal_claim_status` is exactly Andy's canonical enum:

`not_causal`, `causal_prohibited`, `causal_review_required`, `causal_review_approved`, `blocked_overclaim`

Safety assertions and assertions tagged `causal_sensitive` must carry `causal_claim_status`.

## Released Assertion Requirements

A released `RelationshipAssertion` must satisfy all of the following:

- `review_status=released`
- `assertion_type` is not `model_suggested`
- `reviewed_by` is a non-empty string
- `reviewed_at` is a date-time string
- `release_context.scope=release`
- `release_context.release_id` is a non-empty string
- `release_context.included_in_release=true`
- `data_license.license_status` is not `blocked` or `pending_review`
- `data_license.license_classification` is not `blocked_pending_legal_review`
- `data_license.permitted_uses` contains `release`
- `validation_report_ids` is present

## Path Confidence And Release Rules

Path confidence and release status are bounded by the weakest edge:

- `path_status=released` requires release scope, `included_in_release=true`, a non-empty release ID, top-level `review_status=released`, and no top-level or edge `assertion_type=model_suggested`.
- Released path edges must have `review_status=approved` or `review_status=released`.
- `path_confidence.confidence_band=high` requires every edge to have `confidence_band=high`, `review_status=approved` or `released`, and no `assertion_type=model_suggested`.
- `path_confidence.confidence_band=medium` rejects low or blocked edge confidence.
- `path_confidence.weakest_link_adjusted=false` is allowed only when `warnings` is non-empty, making the weakest-link limitation visible to callers.

