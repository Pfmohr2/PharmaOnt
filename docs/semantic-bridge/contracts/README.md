# Semantic Bridge JSON Contracts

These four JSON Schema contracts define Addendum Phase A API/request-response data models for governed, evidence-backed, explainable cross-domain relationship mapping.

Contracts:

- `relationship-assertion.schema.json`
- `relationship-path.schema.json`
- `bridge-hypothesis.schema.json`
- `path-query.schema.json`

## Field Rationale

| Field or group | Governance purpose |
|---|---|
| `schema_version` | Version-locks every object so API and validation changes are explicit. |
| `tenant_id`, `environment` | Prevents cross-tenant and cross-environment leakage. |
| `relationship_assertion_id`, `relationship_path_id`, `hypothesis_id`, `path_query_id` | Provides stable IDs for audit, review, release, export, and references between contracts. |
| `source_entity_id`, `target_entity_id`, `start_entity_id`, `end_entity_id`, `intermediate_entity_ids` | Makes every edge and path explainable as explicit source/target concepts. |
| `predicate` | Preserves the specific relationship predicate instead of collapsing links into generic graph edges. |
| `relationship_class`, `secondary_relationship_tags`, `relationship_classes` | Uses the addendum 13-value primary relationship class enum: identity, vocabulary crosswalk, hierarchical, mechanistic, clinical, safety, regulatory, commercial, operational, evidence support, inferred, hypothesis, and blocked. Secondary tags retain governance modifiers: causal-sensitive, restricted-evidence, and patient-impacting. |
| `assertion_type` | Distinguishes imported, human-curated, inferred, model-suggested, system-generated, deprecated, and mixed content. Model-suggested content cannot be treated as approved fact. |
| `review_status`, `reviewed_by`, `reviewed_at` | Carries governed workflow state and human review proof. |
| `release_context` | Keeps working, release-candidate, and released state explicit. Model-suggested and hypothesis content is constrained away from released state. |
| `evidence_refs`, `source_record_ids`, `source_names`, `source_versions` | Makes every relationship and hypothesis evidence-backed with source-version lineage. Empty evidence shells are not valid. |
| `provenance_id`, `provenance` | Records actor, method, source, time, and audit linkage for regulated traceability. |
| `confidence`, `path_confidence` | Requires non-fabricated confidence scores, bands, sources, and rationale. |
| `weakest_link` | Forces each multi-hop path to expose the limiting edge and recommended review action. |
| `evidence_summary` | Captures evidence count, source diversity, review mix, model-suggested edge count, restricted evidence, and conflicts for path ranking and warnings. |
| `data_license`, `data_license_filters` | Carries license status, license classification, permitted uses, export restrictions, and sensitivity with every relationship, path, hypothesis, and query. |
| `permissions`, `access_context` | Ensures paths are filtered or redacted before response according to role/source entitlements and export intent. |
| `known_limitations`, `warnings`, `risk_flags`, `causal_claim_status` | Prevents overstated causality, flags safety/openFDA/FAERS limitations, labels hypotheses, and preserves interpretation risk. |
| `generated_by`, `model` | Identifies model, rule, mixed, or human generation for hypotheses and prevents AI-origin content from being confused with released fact. |
| `candidate_path_ids`, `converted_relationship_assertion_id` | Links hypotheses to supporting paths and eventual governed relationship proposals without auto-publication. |
| `allowed_relationship_classes`, `excluded_relationship_classes`, `allowed_assertion_types`, `allowed_review_statuses` | Makes PathQuery policy intent explicit for downstream API filtering. |
| `include_inferred`, `include_model_suggested`, `include_hypotheses`, `released_only` | Controls whether speculative or unreleased content can appear in path results. |
| `result_requirements` | Locks every PathQuery response to include relationship class, evidence refs, provenance, confidence, assertion type, review status, data license, release context, path confidence, weakest link, access filtering, and warnings. |
| `minimum_confidence_band`, `required_evidence_sources`, `excluded_sources`, `max_path_length`, `max_results` | Bounds query quality, source policy, interpretability, and response size. |

## Alignment Notes

- Relationship class enum follows Addendum sections 5 and 6 verbatim and is shared by all four contracts. Secondary relationship tags are governance modifiers only: `causal_sensitive`, `restricted_evidence`, and `patient_impacting`.
- Confidence bands are `high`, `medium`, `low`, and `blocked`, matching the addendum and existing Phase 6 conventions.
- Assertion and review status names preserve the existing PharmaOps distinction between `model_suggested`, human-reviewed content, release state, and deprecated content.
- Evidence refs require source names, source versions, and source spans so every relationship/path can be explained without trusting opaque graph links.
- The path contract explicitly carries `path_confidence`, `weakest_link`, `permissions`, and `warnings` per the section 19 global rule.
