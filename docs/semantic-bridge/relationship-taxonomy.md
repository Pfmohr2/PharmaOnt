# Semantic Bridge Relationship Taxonomy

## Purpose

This document defines the Phase A taxonomy for governed, evidence-backed, explainable cross-domain relationship mapping in PharmaOps Semantic Bridge.

It is a design and schema contract for relationship assertions, relationship paths, API contracts, SHACL validation, and release governance. It does not implement service code.

## Canonical Relationship Class Enum

`relationship_class` is the literal Addendum section 5 / section 6.1 enum and must match `docs/semantic-bridge/contracts/`:

```text
identity
vocabulary_crosswalk
hierarchical
mechanistic
clinical
safety
regulatory
commercial
operational
evidence_support
inferred
hypothesis
blocked
```

Each relationship assertion has exactly one primary `relationship_class`. Epistemic and workflow state are separate fields:

- `assertion_type`: `imported`, `human_curated`, `inferred`, `model_suggested`, `system_generated`, `deprecated`
- `review_status`: `draft`, `proposed`, `in_review`, `approved`, `rejected`, `released`, `deprecated`, `superseded`
- `confidence_band`: `high`, `medium`, `low`, `blocked`
- `secondary_relationship_tags`: governance modifiers only: `causal_sensitive`, `restricted_evidence`, `patient_impacting`

## Non-Collapse Rule

Semantic Bridge must never treat every connection as a generic graph edge.

The following are distinct governed concepts:

| Concept | How it is represented | Non-collapse rule |
|---|---|---|
| Identity | `relationship_class=identity`, or MappingAssertion with `exactMatch` when the scoped claim is true identity. | Must not be treated as biological, clinical, safety, regulatory, commercial, or operational relatedness. |
| Vocabulary crosswalk | `relationship_class=vocabulary_crosswalk` or MappingAssertion with source/target vocabulary versions. | Must not imply identity unless predicate and review explicitly support equivalence. |
| Evidence-backed domain relationship | One of `hierarchical`, `mechanistic`, `clinical`, `safety`, `regulatory`, `commercial`, `operational`, or `evidence_support`. | Must carry evidence, provenance, confidence, review, license, and release context. |
| Inference | `relationship_class=inferred` or `assertion_type=inferred`, depending whether the edge itself is an inferred relationship or a domain relationship produced by inference. | Must show rule/version, input edges, derivation path, and weakest input edge. |
| AI suggestion | Any class with `assertion_type=model_suggested`. | Never directly released; must remain API/UI distinct until reviewed and converted. |
| Hypothesis | `relationship_class=hypothesis` and/or BridgeHypothesis object. | Not a released fact; may be accepted for investigation without becoming an approved relationship. |
| Unsupported or blocked link | `relationship_class=blocked`. | Not release eligible as positive fact; may be retained as negative/suppression metadata with rationale. |

These rules are release-blocking where applicable. Creed's SB-A-RT-TAXONOMY review should fail any design that collapses identity, mapping/crosswalk, evidence relationships, inference, AI suggestions, hypotheses, or blocked links into one ambiguous edge type.

## Required Fields On Every Cross-Domain Connection

Every cross-domain connection must be represented as a governed assertion with:

- `relationship_assertion_id` or `mapping_id`
- `relationship_class`
- `source_entity_id`
- `target_entity_id`
- `predicate`
- `assertion_type`
- `confidence.confidence_score`
- `confidence.confidence_band`
- `evidence_refs`
- `source_names`
- `source_versions`
- `provenance_id`
- `review_status`
- `release_context`
- `data_license`
- `known_limitations`
- `warnings`
- `created_by`
- `created_at`
- `provenance.audit_event_id`

Every multi-hop path must include:

- Ordered edge IDs
- Path confidence score and band
- Weakest-link edge and reason
- Domain-boundary crossings
- Access-filtering result
- Warnings for inferred, model-suggested, restricted, safety-sensitive, causal, hypothesis-level, or blocked content

## Class Table

| Relationship class | Scope | Allowed predicate family | Evidence minimum | Review requirement | Release eligibility |
|---|---|---|---|---|---|
| `identity` | Same concept across labels, aliases, IDs, or source systems. | `same_as`, `has_synonym`, `has_external_identifier`, `identity_replaced_by`; MappingAssertion may use `exactMatch` only for scoped identity. | Identifier/alias source, source version, provenance, confidence. Canonical merge needs source-authoritative evidence or non-conflicting corroboration. | Standards/mapping reviewer for merge-affecting identity; domain reviewer when biomedical interpretation changes. | Eligible only when reviewed, validation-passing, license-valid, and unambiguous. |
| `vocabulary_crosswalk` | Controlled vocabulary or internal-standard mapping. | `exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`, `relatedMatch`, `replacedBy`, `hasDbXref`, `notMatch`, `uncertainMatch`, `requiresReview`, `term_maps_to_standard`, `regulatory_crosswalk_to`. | Source and target vocabulary IDs and versions, mapping evidence or source record, confidence, license policy for both sides. | Standards/mapping reviewer; regulatory reviewer for submission or label terminology. | Eligible after approval except `uncertainMatch` and `requiresReview`. `notMatch` may release only as negative/suppression metadata. |
| `hierarchical` | Broader/narrower, parent/child, partonomy, taxonomy, or class hierarchy. | `broader_than`, `narrower_than`, `parent_of`, `child_of`, `part_of`, `has_part`, `subclass_of`. | Hierarchy source, version, scope, directionality, and provenance. | Standards/domain reviewer when hierarchy affects release, mapping, or interpretation. | Eligible when direction and source scope are explicit. |
| `mechanistic` | Biological or pharmacological mechanism. | `compound_has_target`, `target_associated_with_disease`, `mechanistically_related_to`, `inhibits`, `activates`, `binds_target`, `modulates_pathway`. | Direct source evidence, mechanism evidence type, source version, confidence, known limitations. | Scientific/domain reviewer; causal-sensitive claims require specialist/compliance review. | Eligible with evidence, review, validation, and no unsupported causal wording. |
| `clinical` | Trial, endpoint, eligibility, intervention, outcome, cohort, or clinical context. | `trial_studies_condition`, `trial_uses_intervention`, `trial_has_endpoint`, `clinically_related_to`, `associated_with_outcome`, `biomarker_stratifies_response`. | Trial/source record, source version, clinical context, evidence type, limitations, confidence. | Clinical/domain reviewer for interpretive claims. | Eligible after review; must not imply efficacy, safety, or causality without separate evidence/review. |
| `safety` | Product-event, signal context, adverse event coding, label safety, or pharmacovigilance context. | `product_has_adverse_event`, `safety_context_related_to`, `has_reported_event_context`, `label_mentions_safety_event`, `safety_signal_for_investigation`. | Safety source/version, evidence type, source limitations, non-causal disclaimer when based on spontaneous reports, license/sensitivity metadata. | Safety reviewer and compliance/specialist review for causal or patient-impacting claims. | Eligible only with limitation metadata and non-causal handling. FAERS/openFDA-like evidence alone cannot support causation or incidence. |
| `regulatory` | Submission terminology, controlled term, label, codelist, or regulatory context. | `regulatory_crosswalk_to`, `uses_submission_term`, `label_contains_concept`, `submission_codelist_maps_to`, `controlled_term_for_context`. | Regulatory source/codelist version, submission or label context, evidence pointer, license policy. | Regulatory/standards reviewer. | Eligible with version pins, review, and export/license approval. |
| `commercial` | Market, product, indication, population, outcome, payer, or portfolio concept. | `commercially_related_to`, `product_aligned_to_indication`, `market_segment_for_population`, `payer_concept_related_to`. | Business source/version, context, evidence, license/sensitivity, limitations. | Commercial/domain reviewer; clinical/safety spillover requires appropriate domain review. | Eligible only as commercial context, not as clinical efficacy or safety fact. |
| `operational` | Source system, dataset, API consumer, workflow dependency, dashboard, or downstream process. | `operational_dependency_of`, `dataset_feeds_dashboard`, `api_consumer_uses_term`, `workflow_depends_on_source`, `downstream_uses_mapping`. | System/source metadata, dependency evidence, owner, source version or deployment version, audit context. | System owner or operations reviewer for release-impacting dependencies. | Eligible as operational metadata only; cannot create scientific or clinical claims. |
| `evidence_support` | Assertion supported, contradicted, or contextualized by document, source record, dataset, validation report, or approval record. | `entity_supported_by_evidence`, `assertion_supported_by_evidence`, `evidence_supports_relationship`, `evidence_contradicts_relationship`, `evidence_context_for_relationship`. | Evidence object with source name/version, artifact or pointer, evidence role, source spans where available, license/sensitivity. | Evidence reviewer if evidence is required for release or contradicted. | Eligible as evidence linkage; must not itself be interpreted as a biomedical relationship. |
| `inferred` | Derived relationship from rules, reasoner output, or path logic. | `inferred_from_path`, `inferred_mechanistic_bridge`, `inferred_clinical_bridge`, `inferred_safety_context`; may reference underlying domain predicate in derivation metadata. | Rule ID/version, input assertion IDs, input evidence/provenance, reasoner run, source release scope, weakest input edge. | Reviewer must approve inference policy and release-impacting output. | Not eligible by inference alone; eligible only after review or as disclosed released path component. |
| `hypothesis` | Plausible bridge for investigation, not asserted as fact. | `hypothesis_bridge`, `is_hypothesis_about`, `may_relate_to_investigation`, `accepted_for_investigation`, `convertedToRelationshipAssertion`. | Hypothesis rationale, proposer/generator, supporting and contradicting evidence pointers where available, limitations, confidence no higher than policy allows. | Domain reviewer may accept for investigation or reject. | Not eligible as released fact. Conversion requires a new governed relationship proposal. |
| `blocked` | Known invalid, contradictory, prohibited, license-blocked, unsafe, or rejected connection. | `blocked`, `unsupported`, `notMatch`, `contradicted_by_evidence`, `license_blocked`, `causal_claim_blocked`, `access_blocked`. | Block rationale, blocker category, policy or evidence ref, actor/reviewer, audit event. | Reviewer or policy owner required for persistent block. | Not eligible as positive fact; may release only as labeled negative/suppression artifact if policy-approved. |

## Predicate Matrix By Class

Predicate values below are contract-level names. RDF/OWL implementations should expose relationship predicates under `pharmrel:` unless Angela and Kevin choose aliases. Existing mapping predicates from `VOCABULARY_POLICY.md` remain camelCase for mapping objects.

| Class | Allowed predicates | Explicitly prohibited |
|---|---|---|
| `identity` | `same_as`, `has_synonym`, `has_external_identifier`, `identity_replaced_by`; mapping object `exactMatch` only for scoped identity. | `relatedMatch`, domain relationship predicates, hypothesis predicates, or model-suggested content as released identity. |
| `vocabulary_crosswalk` | `exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`, `relatedMatch`, `replacedBy`, `hasDbXref`, `notMatch`, `uncertainMatch`, `requiresReview`, `term_maps_to_standard`, `regulatory_crosswalk_to`. | Treating `closeMatch`, `relatedMatch`, `hasDbXref`, `uncertainMatch`, or `requiresReview` as identity/equivalence. |
| `hierarchical` | `broader_than`, `narrower_than`, `parent_of`, `child_of`, `part_of`, `has_part`, `subclass_of`. | Undirected hierarchy without directionality. |
| `mechanistic` | `compound_has_target`, `target_associated_with_disease`, `mechanistically_related_to`, `inhibits`, `activates`, `binds_target`, `modulates_pathway`. | Unsupported causal wording or clinical efficacy claims. |
| `clinical` | `trial_studies_condition`, `trial_uses_intervention`, `trial_has_endpoint`, `clinically_related_to`, `associated_with_outcome`, `biomarker_stratifies_response`. | Safety/incidence or efficacy claims from trial metadata alone. |
| `safety` | `product_has_adverse_event`, `safety_context_related_to`, `has_reported_event_context`, `label_mentions_safety_event`, `safety_signal_for_investigation`. | `causes`, `causal_for`, `incidence_rate_for`, or equivalent causal/incidence predicates unless evidence type and review explicitly allow it. |
| `regulatory` | `regulatory_crosswalk_to`, `uses_submission_term`, `label_contains_concept`, `submission_codelist_maps_to`, `controlled_term_for_context`. | Identity merge unless separately represented as identity/crosswalk with version pins. |
| `commercial` | `commercially_related_to`, `product_aligned_to_indication`, `market_segment_for_population`, `payer_concept_related_to`. | Clinical efficacy or safety claims without clinical/safety gates. |
| `operational` | `operational_dependency_of`, `dataset_feeds_dashboard`, `api_consumer_uses_term`, `workflow_depends_on_source`, `downstream_uses_mapping`. | Scientific, clinical, or safety claims from operational dependencies. |
| `evidence_support` | `entity_supported_by_evidence`, `assertion_supported_by_evidence`, `evidence_supports_relationship`, `evidence_contradicts_relationship`, `evidence_context_for_relationship`. | Treating evidence support itself as a biomedical relation. |
| `inferred` | `inferred_from_path`, `inferred_mechanistic_bridge`, `inferred_clinical_bridge`, `inferred_safety_context`; underlying domain predicate only with derivation metadata. | Hiding input edges, weakest link, source limitations, or rule version. |
| `hypothesis` | `hypothesis_bridge`, `is_hypothesis_about`, `may_relate_to_investigation`, `accepted_for_investigation`, `convertedToRelationshipAssertion`. | Display as released fact or approved relationship. |
| `blocked` | `unsupported`, `blocked`, `notMatch`, `contradicted_by_evidence`, `license_blocked`, `causal_claim_blocked`, `access_blocked`. | Positive relationship wording unless explicitly labeled negative/suppression metadata. |

## Evidence, Review, And Release Matrix

| Class | Evidence requirements | Review requirements | Release eligibility |
|---|---|---|---|
| `identity` | Identifier/alias source, source version, provenance, confidence; corroboration for merge-affecting identity unless source-authoritative policy applies. | Standards/mapping reviewer; domain reviewer if semantic interpretation changes. | Eligible only when reviewed, high confidence, license-valid, and unambiguous. |
| `vocabulary_crosswalk` | Source and target vocabulary, source/target versions, mapping evidence, license policy, confidence, scope note for non-exact predicates. | Standards/mapping reviewer; regulatory reviewer for submission/label terms. | Eligible if approved and predicate is not `uncertainMatch` or `requiresReview`; `notMatch` only as negative/suppression metadata. |
| `hierarchical` | Hierarchy source/version, direction, scope, provenance. | Standards/domain reviewer when released. | Eligible with explicit direction and validated source scope. |
| `mechanistic` | Direct evidence, mechanism evidence type, source version, provenance, confidence, limitations. | Scientific/domain reviewer; causal-sensitive claims require specialist/compliance review. | Eligible with evidence/review and no unsupported causal wording. |
| `clinical` | Trial/clinical source record, source version, clinical context, evidence type, limitations. | Clinical/domain reviewer. | Eligible after review; no unreviewed efficacy/safety extrapolation. |
| `safety` | Safety source/version, evidence type, limitations, disclaimers, license/sensitivity. | Safety reviewer; compliance/specialist for causal or patient-impacting claims. | Eligible only with non-causal limitations and required review. |
| `regulatory` | Regulatory source/codelist version, submission/label context, evidence pointer, license policy. | Regulatory/standards reviewer. | Eligible with version pins, review, and export/license approval. |
| `commercial` | Business source/version, context, evidence, license/sensitivity, limitations. | Commercial/domain reviewer. | Eligible as commercial context only. |
| `operational` | System/source metadata, dependency proof, owner, version, audit context. | System owner or operations reviewer. | Eligible as operational metadata only. |
| `evidence_support` | Evidence object with source/version, evidence role, source span or pointer, access policy. | Evidence reviewer if used for release or contradiction. | Eligible as evidence linkage only. |
| `inferred` | Rule/version, input assertions, input evidence/provenance, execution timestamp, derivation path, weakest input edge. | Inference policy/output reviewer for release-impacting use. | Not eligible by inference alone; requires review/disclosure. |
| `hypothesis` | Rationale, proposer/generator, support/contradiction pointers, limitations. | Domain reviewer may accept for investigation or reject. | Not eligible as released fact; conversion requires new relationship proposal. |
| `blocked` | Block rationale, blocker category, policy/evidence ref, contradiction/license/access reason, actor/reviewer, audit event. | Reviewer or policy owner. | Not eligible as positive fact. |

## Epistemic Axis Mapping

Relationship class is not used for epistemic state.

| Situation | Relationship fields |
|---|---|
| AI-suggested mechanistic candidate | `relationship_class=mechanistic`, `assertion_type=model_suggested`, `review_status=proposed`, unreleased working scope. |
| AI-suggested hypothesis | `relationship_class=hypothesis`, `assertion_type=model_suggested`, `review_status=proposed`, BridgeHypothesis reference. |
| Speculative/unreviewed clinical bridge | `relationship_class=clinical`, `review_status=draft` or `proposed`, `confidence_band=low`, warning `requires_human_review`. |
| Deterministic inference path | `relationship_class=inferred` for an inferred edge, or domain class plus `assertion_type=inferred` when a reviewed domain relationship was produced by inference. |
| Unsupported or prohibited candidate | `relationship_class=blocked`, `confidence_band=blocked`, `blocked_rationale` required. |
| Evidence-backed relationship | Domain relationship class, evidence present, non-model assertion type, review status at least `approved` before release. |

## Assertion-Type Rules

| Assertion type | Compatible classes | Release behavior |
|---|---|---|
| `imported` | Any class except release-as-fact hypotheses without review. | Requires class-specific review unless source-authoritative policy permits mechanical staging. |
| `human_curated` | All classes. | Release eligible only when class rules pass. |
| `inferred` | `inferred` or domain classes with derivation metadata. | Requires derivation evidence and review. |
| `model_suggested` | Any class in working/proposed state, commonly `hypothesis`, `inferred`, or a domain class candidate. | Never directly release eligible. |
| `system_generated` | Operational, evidence support, inferred, validation/path metadata, or policy-approved mechanical actions. | Not a domain judgment; release requires policy and review controls where applicable. |
| `deprecated` | Historical versions of any class. | Retained for traceability; not active positive fact. |

## Review-State Rules

| Review status | Meaning | Release behavior |
|---|---|---|
| `draft` | Work-in-progress assertion. | Not eligible. |
| `proposed` | Submitted candidate. | Not eligible. |
| `in_review` | Human/domain review active. | Not eligible. |
| `approved` | Required review complete. | Eligible only if class-specific validation, license, evidence, and release gates pass. |
| `rejected` | Rejected candidate. | Not eligible; may create `blocked` or suppression record. |
| `released` | Immutable release artifact contains assertion. | Active released fact, or labeled negative metadata when `relationship_class=blocked`. |
| `deprecated` | Historical but discouraged. | Historical release only; future use requires successor or new proposal. |
| `superseded` | Replaced by another governed assertion. | Historical only; successor link required. |

## Path Policy

Every path must be computed from visible, authorized relationship assertions. Path services must not return hidden counts or leak restricted evidence through explanations.

### Path confidence factors

Each edge contributes:

- Edge confidence
- Relationship class
- Assertion type
- Evidence quality and diversity
- Source trust and recency
- Human review status
- Mapping exactness
- Ontology constraint satisfaction
- AI/model involvement
- Known limitations
- License/sensitivity status
- Domain-specific risk flags

The path contributes:

- Weakest critical edge
- Number of edges
- Number of domain boundaries crossed
- Presence of broad, related, inferred, model-suggested, hypothesis, restricted, stale, contradictory, safety, regulatory, patient-impacting, or causal content
- Independent corroboration

### Path confidence bands

| Band | Rules |
|---|---|
| `high` | All critical edges are reviewed, evidence-backed, authorized, and high or policy-accepted medium confidence; no unreviewed model-suggested edge; no blocked edge; no undisclosed restricted evidence; evidence diversity present unless policy allows identity exception. |
| `medium` | Reviewed or reviewable path with at least one medium-confidence, broad, related, inferred, or cross-domain edge; warnings required for weak links. |
| `low` | Speculative, weakly supported, long, low-confidence, or unreviewed path; must recommend review action. |
| `blocked` | Any blocked edge, unauthorized required edge, unresolvable restricted evidence when policy requires block, or safety/causal violation. |

### Mandatory path warnings

Path payloads must include warnings when:

- Any edge has `assertion_type=inferred`.
- Any edge has `assertion_type=model_suggested`.
- Any edge has `relationship_class=hypothesis`.
- Any evidence is restricted, redacted, stale, contradictory, or single-source.
- Any edge uses `broadMatch`, `relatedMatch`, `hasDbXref`, `uncertainMatch`, or `requiresReview`.
- The path crosses safety, regulatory, patient, or causal domains.
- The path crosses more than two domain boundaries.
- The path includes unreleased components.

## SHACL And Contract Requirements

Kevin's SHACL work should include shapes equivalent to:

| Shape | Applies to | Critical conditions |
|---|---|---|
| `RelationshipClassValidityShape` | RelationshipAssertion | Exactly one primary class; value is one of the canonical 13 enum values. |
| `IdentityMappingSeparationShape` | RelationshipAssertion and MappingAssertion | Blocks use of identity/crosswalk predicates as generic relationship claims and blocks relationship predicates as mapping equivalence. |
| `RelationshipEvidenceByClassShape` | RelationshipAssertion | Enforces class-specific evidence requirements. |
| `RelationshipReviewByClassShape` | RelationshipAssertion | Enforces reviewer role and review status by class and governance tags. |
| `RelationshipReleaseEligibilityShape` | RelationshipAssertion | Blocks release if review/evidence/provenance/license/release context is incomplete. |
| `ModelSuggestedRelationshipReleaseShape` | RelationshipAssertion | Blocks any direct release/staging of `assertion_type=model_suggested`. |
| `SafetyLimitationShape` | `relationship_class=safety` or `secondary_relationship_tags` contains `causal_sensitive` or `patient_impacting` | Requires evidence type, limitation metadata, non-causal disclaimer, and stronger review for causal claims. |
| `CausalClaimStatusShape` | Mechanistic, safety, clinical, and causal-sensitive claims | Blocks causal wording unless predicate, evidence, and review permit it. |
| `BlockedRelationshipRationaleShape` | `relationship_class=blocked` | Requires blocker category, rationale, policy/evidence ref, actor/reviewer, audit event. |
| `RelationshipPathConfidenceShape` | RelationshipPath | Requires path confidence, weakest link, edge IDs, warnings, and access-filtering result. |
| `RestrictedEvidencePathShape` | RelationshipPath | Blocks/redacts path output when caller lacks access to any required edge/evidence. |
| `HypothesisLabelingShape` | `relationship_class=hypothesis` and BridgeHypothesis | Requires explicit hypothesis labels and blocks released-fact presentation. |

Critical release-blocking violations:

- Released relationship has no evidence.
- Released relationship has no reviewer.
- Released relationship has no release ID.
- Released relationship has no provenance.
- Released relationship has missing or blocked license status.
- Model-suggested relationship is staged or released directly.
- Safety relationship lacks evidence-type limitation metadata.
- Causal claim lacks approved causal review status.
- Identity/crosswalk is represented as generic relatedness or vice versa.
- Path includes a blocked edge.
- Path export includes unauthorized restricted evidence.
- Path confidence is marked high despite unreviewed model-suggested, speculative, blocked, or single-source high-risk edge.

## Coordination Packet For Contracts And Ontology

### For Angela / contracts

Canonical relationship class enum:

```text
identity
vocabulary_crosswalk
hierarchical
mechanistic
clinical
safety
regulatory
commercial
operational
evidence_support
inferred
hypothesis
blocked
```

Secondary relationship tags are governance modifiers only:

```text
causal_sensitive
restricted_evidence
patient_impacting
```

Mapping predicate enum should preserve existing `VOCABULARY_POLICY.md` values:

```text
exactMatch
closeMatch
broadMatch
narrowMatch
relatedMatch
replacedBy
hasDbXref
notMatch
uncertainMatch
requiresReview
```

Relationship predicate enum should remain separate from mapping predicates. Proposed additional local names:

```text
same_as
has_synonym
has_external_identifier
broader_than
narrower_than
mechanistically_related_to
clinically_related_to
safety_context_related_to
regulatory_crosswalk_to
commercially_related_to
operational_dependency_of
inferred_from_path
hypothesis_bridge
unsupported
blocked
contradicted_by_evidence
license_blocked
causal_claim_blocked
access_blocked
```

### For Kevin / ontology and SHACL

Recommended RDF namespace:

- Reuse `pharmrel:` for relationship predicates.
- Keep mapping objects distinct from relationship assertions, even when both use `pharmrel:` local names.
- Add `pharm:hasRelationshipClass`, `pharm:hasAssertionType`, `pharm:hasPathConfidence`, `pharm:hasWeakestLink`, `pharm:hasEvidenceStrength`, `pharm:hasDomainBoundaryCrossing`, `pharm:hasRelationshipWarning`, `pharm:hasReviewRequirement`, `pharm:hasCausalClaimStatus`, `pharm:usesRestrictedEvidence`, `pharm:hasRedactionPolicy`, `pharm:isHypothesisAbout`, and `pharm:convertedToRelationshipAssertion` or equivalent properties from addendum section 11.2.

Recommended class modeling:

- `pharm:RelationshipAssertion`
- `pharm:RelationshipPath`
- `pharm:BridgeHypothesis`
- `pharm:PathEvaluation`
- `pharm:WeakLinkAssessment`
- `pharm:RelationshipEvidence`
- `pharm:DomainBoundaryCrossing`
- `pharm:SafetyLimitation`
- `pharm:RelationshipWarning`

Open naming item for Angela/Kevin:

- Existing mapping predicate local names are camelCase while addendum examples use snake_case. This taxonomy preserves current mapping-contract camelCase values and uses snake_case for newly proposed Semantic Bridge relationship predicate local names. If ontology prefers one style globally, add aliases but do not merge mapping equivalence predicates with relationship predicates.
