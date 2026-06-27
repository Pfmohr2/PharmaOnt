# Semantic Bridge Relationship Taxonomy

## Purpose

This document defines the Phase A taxonomy for governed, evidence-backed, explainable cross-domain relationship mapping in PharmaOps Semantic Bridge.

It is a design and schema contract for relationship assertions, relationship paths, API contracts, SHACL validation, and release governance. It does not implement service code.

## Non-Collapse Rule

Semantic Bridge must never treat every connection as a generic graph edge.

The following are distinct governed concepts:

| Concept | Meaning | Governed object | Release implication |
|---|---|---|---|
| Identity | Two identifiers or labels represent the same real-world concept in a scoped context. | Identity assertion or mapping assertion, not a relationship assertion for biological relatedness. | May support canonical identity merge only after review and validation. |
| Vocabulary crosswalk | A source term maps to a target vocabulary or internal standard. | Mapping assertion. | Requires source and target vocabulary versions and mapping predicate semantics. |
| Evidence-backed relationship | A scientific, clinical, safety, regulatory, commercial, or operational relation between two governed concepts. | Relationship assertion. | May release only with evidence, provenance, confidence, review, license, and validation. |
| Inference | A derived connection from rules, reasoner output, or approved path logic. | Relationship assertion or RelationshipPath with derivation metadata. | Not release eligible by itself; requires derivation evidence and review route. |
| AI suggestion | A model-proposed edge or path. | Relationship assertion or BridgeHypothesis with `assertion_type=model_suggested`. | Never directly released. Must remain visually/API distinct and pass human governance before conversion. |
| Hypothesis | A plausible bridge for investigation. | BridgeHypothesis, optionally converted later to a relationship proposal. | Not a released fact; can be accepted for investigation but not published as fact. |
| Unsupported or blocked link | A rejected, contradictory, prohibited, or policy-blocked connection. | Blocked relationship assertion or blocked mapping assertion. | Not release eligible except as a negative control/suppression artifact with rationale. |

The class and predicate rules below are designed so Creed's taxonomy red team can verify that identity, mapping/crosswalk, and relationship intelligence cannot collapse into one ambiguous edge type.

## Required Fields On Every Cross-Domain Connection

Every cross-domain connection must be represented as a governed assertion with:

- `relationship_assertion_id` or `mapping_id`
- `relationship_class`
- `subject`
- `predicate`
- `object`
- `assertion_type`
- `confidence_score`
- `confidence_band`
- `evidence_refs`
- `provenance_id`
- `review_status`
- `license_status`
- `release_id` or explicit unreleased state
- `data_sensitivity`
- `known_limitations`
- `created_by`
- `created_at`
- `audit_event_id`

Every multi-hop path must include:

- Ordered edge IDs
- Path confidence score and band
- Weakest-link edge and reason
- Domain-boundary crossings
- Access-filtering result
- Warnings for inferred, model-suggested, restricted, safety-sensitive, causal, hypothesis-level, or blocked content

## Class Table

Primary class values are stable contract values. Each relationship assertion must have exactly one primary class. Domain-specific detail should use secondary tags such as `mechanistic`, `clinical`, `safety`, `regulatory`, `commercial`, `operational`, or `evidence_support`.

| Primary class | Contract value | Scope | Allowed predicate family | Evidence minimum | Review requirement | Release eligibility |
|---|---|---|---|---|---|---|
| Identity mapping | `identity` | Same entity across labels, aliases, IDs, or source systems. | Identity predicates only: `same_as`, `has_synonym`, `has_external_identifier`; mapping `exactMatch` only when represented as a mapping assertion. | Source identifier/label evidence, source version, provenance; evidence diversity required for canonical merge unless policy permits source-authoritative identity. | Domain or standards reviewer for merge-affecting identity; service imports may propose only. | Eligible only after review, validation, no license blocker, and no ambiguity. |
| Vocabulary crosswalk | `vocabulary_crosswalk` | Controlled vocabulary or internal-standard mapping. | Mapping predicates: `exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`, `relatedMatch`, `replacedBy`, `hasDbXref`, `notMatch`, `uncertainMatch`, `requiresReview`; regulatory crosswalk predicate allowed for submission terminology. | Source and target vocabulary IDs and versions, mapping evidence or source record, confidence, license policy for both sides. | Standards/mapping reviewer; regulatory reviewer for submission or label terminology. | Only `exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`, `relatedMatch`, `replacedBy`, and `hasDbXref` may release after approval. `notMatch` may release only as negative/suppression record. `uncertainMatch` and `requiresReview` are not release eligible. |
| Evidence-backed relationship | `evidence_backed_relationship` | A direct governed relationship between domain concepts. Secondary domain tags refine semantics. | Domain predicates: mechanistic, clinical, safety, regulatory, commercial, operational, and evidence-support predicates listed below. | Direct evidence object or source record, source version, provenance, evidence strength, confidence, known limitations, license/sensitivity metadata. | Domain reviewer for the affected domain; compliance review for safety, regulatory, patient-impacting, or causal claims. | Eligible after validation, review, evidence/license checks, and release packaging. |
| Inferred relationship | `inferred_relationship` | Deterministically derived edge or path-derived relation. | `inferred_from_path`, `inferred_mechanistic_bridge`, `inferred_clinical_bridge`, `inferred_safety_context`, or the underlying domain predicate with derivation metadata. | Rule ID/version, input assertion IDs, input evidence/provenance, reasoner run ID, source release scope, confidence derivation. | Reviewer must approve inference rule and output when release-impacting. | Not eligible by inference alone; eligible only after conversion to reviewed relationship assertion or released path with derivation disclosure. |
| AI-suggested relationship | `ai_suggested_relationship` | Model-proposed edge or path candidate. | `model_suggested`, or proposed domain predicate with `assertion_type=model_suggested`; may also create `hypothesis_bridge` candidate. | Model name/version, prompt/config or pipeline version, source spans, evidence pointers, confidence, rationale, safety/license flags. | Human reviewer required before conversion. AI confidence is never approval. | Never directly release eligible. Must become a reviewed governed proposal and pass all class-specific evidence/review gates. |
| Hypothesis bridge | `hypothesis_bridge` | Plausible bridge accepted for investigation, not asserted as fact. | `hypothesis_bridge`, `is_hypothesis_about`, `may_relate_to_investigation`, `accepted_for_investigation`. | Rationale, supporting/contradicting evidence pointers if available, source limitations, hypothesis author, confidence band no higher than medium unless converted and reviewed. | Scientific/domain reviewer can accept for investigation; approval does not make it a released fact. | Not release eligible as a fact. Can be released only as a labeled hypothesis workspace artifact if policy permits; conversion requires new relationship proposal. |
| Speculative/unreviewed | `speculative_unreviewed` | Unreviewed, low-evidence, uncertain, or exploratory connection. | `requiresReview`, `uncertainMatch`, `relatedMatch` as weak mapping, `possible_related_to`, `candidate_bridge`. | At least candidate provenance, generation method, and reason for speculation; evidence may be weak or missing but missing evidence must be explicit. | Must be routed to review or rejected; cannot be silently promoted. | Not release eligible. |
| Unsupported/blocked | `unsupported_blocked` | Known invalid, contradictory, prohibited, license-blocked, unsafe, or rejected connection. | `blocked`, `unsupported`, `notMatch`, `contradicted_by_evidence`, `license_blocked`, `causal_claim_blocked`, `access_blocked`. | Rationale, blocker type, reviewer or policy source, evidence or policy reference, audit event. | Reviewer or policy owner required for persistent blocked records. | Not release eligible as positive fact. May release as negative/suppression metadata only if clearly labeled and policy-approved. |

## Predicate Matrix By Class

Predicate values below are contract-level names. RDF/OWL implementations should expose them under the `pharmrel:` namespace unless Angela and Kevin choose a different local-name convention. Existing mapping predicates from `VOCABULARY_POLICY.md` remain camelCase (`exactMatch`, `closeMatch`, etc.) for mapping objects.

| Class | Allowed predicates | Explicitly prohibited |
|---|---|---|
| `identity` | `same_as`, `has_synonym`, `has_external_identifier`, `identity_replaced_by`; mapping object may use `exactMatch` only when scope is true identity. | `relatedMatch`, `clinically_related_to`, `mechanistically_related_to`, `hypothesis_bridge`, `model_suggested` as released identity. |
| `vocabulary_crosswalk` | `exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`, `relatedMatch`, `replacedBy`, `hasDbXref`, `notMatch`, `uncertainMatch`, `requiresReview`, `regulatory_crosswalk_to`, `term_maps_to_standard`. | Treating `closeMatch`, `relatedMatch`, `hasDbXref`, `uncertainMatch`, or `requiresReview` as identity/equivalence. |
| `evidence_backed_relationship` with `mechanistic` tag | `compound_has_target`, `target_associated_with_disease`, `mechanistically_related_to`, `inhibits`, `activates`, `binds_target`, `modulates_pathway`. | Causal wording without mechanistic predicate, evidence support, and review. |
| `evidence_backed_relationship` with `clinical` tag | `trial_studies_condition`, `trial_uses_intervention`, `trial_has_endpoint`, `biomarker_stratifies_response`, `clinically_related_to`, `associated_with_outcome`. | Safety/incidence claims from trial metadata alone. |
| `evidence_backed_relationship` with `safety` tag | `product_has_adverse_event`, `safety_context_related_to`, `has_reported_event_context`, `label_mentions_safety_event`, `safety_signal_for_investigation`. | `causes`, `causal_for`, `incidence_rate_for`, or equivalent causal/incidence predicates unless evidence type and compliance review explicitly allow it. |
| `evidence_backed_relationship` with `regulatory` tag | `regulatory_crosswalk_to`, `uses_submission_term`, `label_contains_concept`, `submission_codelist_maps_to`, `controlled_term_for_context`. | Identity merge unless represented separately as identity/crosswalk with version pins. |
| `evidence_backed_relationship` with `commercial` tag | `commercially_related_to`, `product_aligned_to_indication`, `market_segment_for_population`, `payer_concept_related_to`. | Clinical efficacy or safety claims without clinical/safety relationship and evidence gates. |
| `evidence_backed_relationship` with `operational` tag | `operational_dependency_of`, `dataset_feeds_dashboard`, `api_consumer_uses_term`, `workflow_depends_on_source`, `downstream_uses_mapping`. | Scientific or clinical claims from operational dependency edges. |
| `evidence_backed_relationship` with `evidence_support` tag | `entity_supported_by_evidence`, `assertion_supported_by_evidence`, `evidence_supports_relationship`, `evidence_contradicts_relationship`, `evidence_context_for_relationship`. | Treating evidence support itself as a biomedical relationship. |
| `inferred_relationship` | `inferred_from_path`, `inferred_mechanistic_bridge`, `inferred_clinical_bridge`, `inferred_safety_context`, plus underlying domain predicate with `derivation_metadata`. | Hiding input edges, weakest link, or source limitations. |
| `ai_suggested_relationship` | `model_suggested`, `candidate_bridge`, proposed domain predicate only with `assertion_type=model_suggested`. | Any released graph target or approved/released status without conversion and review. |
| `hypothesis_bridge` | `hypothesis_bridge`, `is_hypothesis_about`, `may_relate_to_investigation`, `accepted_for_investigation`, `convertedToRelationshipAssertion`. | Displaying as released fact or approved relationship. |
| `speculative_unreviewed` | `candidate_bridge`, `possible_related_to`, `requiresReview`, `uncertainMatch`. | Release inclusion, high confidence, or unqualified factual language. |
| `unsupported_blocked` | `unsupported`, `blocked`, `notMatch`, `contradicted_by_evidence`, `license_blocked`, `causal_claim_blocked`, `access_blocked`. | Any positive relationship wording unless the payload is explicitly a negative control. |

## Evidence, Review, And Release Matrix

| Class | Evidence requirements | Review requirements | Release eligibility |
|---|---|---|---|
| `identity` | Identifier/alias source, source version, provenance, confidence. Canonical merge needs source-authoritative evidence or at least two non-conflicting sources unless policy permits otherwise. | Standards/mapping reviewer for merge-affecting identity; domain reviewer when identity changes biomedical interpretation. | Eligible only when reviewed and `confidence_band=high`; uncertain identity remains crosswalk/speculative. |
| `vocabulary_crosswalk` | Source and target vocabulary, source and target versions, mapping predicate evidence, license policy for both sides, confidence and scope note for non-exact predicates. | Standards/mapping reviewer; regulatory reviewer for submission or controlled-label terms. | Eligible if approved, source/target versions present, license status valid, and predicate is not `uncertainMatch` or `requiresReview`. |
| `evidence_backed_relationship` | Evidence object with source name/version, source record/artifact, source trust, evidence type, evidence strength, license/sensitivity, source limitations, provenance. | Domain reviewer. Safety, regulatory, patient-impacting, or causal claims require compliance/specialist review. | Eligible if approved, evidence complete, no critical validation findings, and release package binds validation and approval trace. |
| `inferred_relationship` | Rule/version, input assertion IDs, input releases, input evidence/provenance, execution timestamp, derivation path, weakest input edge. | Reviewer must approve the inference policy and the release-impacting output. | Not eligible by itself. Eligible only after reviewed conversion or as disclosed released path component. |
| `ai_suggested_relationship` | Model metadata, prompt/config/pipeline version, source spans, candidate evidence refs, rationale, confidence, duplicate/safety/license flags. | Human review mandatory before any conversion. | Never directly eligible. |
| `hypothesis_bridge` | Hypothesis rationale, supporting and contradicting evidence pointers where available, known limitations, author/proposer, source constraints. | Domain reviewer may accept for investigation or reject. | Not eligible as released fact. May be exported only as clearly labeled hypothesis if policy allows. |
| `speculative_unreviewed` | Candidate provenance, generation method, reason for speculation, evidence gap statement, confidence no higher than low/medium per policy. | Must route to review, rejection, or hypothesis workspace. | Not eligible. |
| `unsupported_blocked` | Block rationale, blocker category, policy or evidence ref, contradiction or license/access reason, actor/reviewer, audit event. | Reviewer or policy owner for persistent block. | Not eligible as positive fact; may release only as negative/suppression artifact with explicit labeling. |

## Assertion-Type Rules

Relationship class and assertion type are separate fields.

| Assertion type | Compatible classes | Release behavior |
|---|---|---|
| `imported` | `identity`, `vocabulary_crosswalk`, `evidence_backed_relationship`, `unsupported_blocked` | Requires review before release unless source-authoritative policy route allows mechanical staging. |
| `human_curated` | All except raw `ai_suggested_relationship` | Release eligible only when class rules pass. |
| `inferred` | `inferred_relationship`, reviewed inferred variants of `evidence_backed_relationship` | Requires derivation evidence and review. |
| `model_suggested` | `ai_suggested_relationship`, `hypothesis_bridge`, `speculative_unreviewed` | Never directly release eligible. |
| `deprecated` | Historical versions of any class | Retained for traceability; not active positive fact. |
| `administrative` | `unsupported_blocked`, release/path metadata, operational dependencies | Cannot create positive biomedical claims without evidence. |

## Review-State Rules

| Review status | Meaning | Release behavior |
|---|---|---|
| `draft` | Work-in-progress assertion. | Not eligible. |
| `proposed` | Submitted candidate. | Not eligible. |
| `in_review` | Human/domain review active. | Not eligible. |
| `accepted_for_investigation` | Hypothesis accepted for study. | Not eligible as fact. |
| `approved` | Required review complete. | Eligible only if class-specific validation, license, evidence, and release gates pass. |
| `rejected` | Rejected candidate. | Not eligible. May create blocked/suppression record. |
| `staged` | Included in release candidate. | Candidate only. |
| `released` | Immutable release artifact contains assertion. | Active released fact or labeled negative/hypothesis artifact depending class. |
| `deprecated` | Historical but discouraged. | Historical release only; not new active assertion. |
| `blocked` | Policy, access, evidence, safety, or contradiction block. | Not eligible as positive fact. |

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
| `medium` | Reviewed or reviewable path with at least one medium-confidence or broad/related/inferred edge; warnings required for weak links. |
| `low` | Speculative, weakly supported, long, low-confidence, or unreviewed path; must recommend review action. |
| `blocked` | Any blocked edge, unauthorized required edge, unresolvable restricted evidence when policy requires block, or safety/causal violation. |

### Mandatory path warnings

Path payloads must include warnings when:

- Any edge is inferred.
- Any edge is model-suggested.
- Any edge is a hypothesis.
- Any evidence is restricted, redacted, stale, contradictory, or single-source.
- Any edge uses `broadMatch`, `relatedMatch`, `hasDbXref`, `uncertainMatch`, or `requiresReview`.
- The path crosses safety, regulatory, patient, or causal domains.
- The path crosses more than two domain boundaries.
- The path includes unreleased components.

## SHACL And Contract Requirements

Kevin's SHACL work should include shapes equivalent to:

| Shape | Applies to | Critical conditions |
|---|---|---|
| `RelationshipClassValidityShape` | RelationshipAssertion | Exactly one primary class; value in taxonomy; secondary tags valid for class. |
| `IdentityMappingSeparationShape` | RelationshipAssertion and MappingAssertion | Blocks use of identity/crosswalk predicates as generic relationship claims and blocks relationship predicates as mapping equivalence. |
| `RelationshipEvidenceByClassShape` | RelationshipAssertion | Enforces class-specific evidence requirements. |
| `RelationshipReviewByClassShape` | RelationshipAssertion | Enforces reviewer role and review status by class and domain tag. |
| `RelationshipReleaseEligibilityShape` | RelationshipAssertion | Blocks release if review/evidence/provenance/license/release context is incomplete. |
| `ModelSuggestedRelationshipReleaseShape` | RelationshipAssertion | Blocks any direct release/staging of `assertion_type=model_suggested`. |
| `SafetyLimitationShape` | Safety-tagged relationships | Requires evidence type, limitation metadata, non-causal disclaimer, and stronger review for causal claims. |
| `CausalClaimStatusShape` | Mechanistic/safety/clinical claims | Blocks causal wording unless predicate, evidence, and review permit it. |
| `BlockedRelationshipRationaleShape` | `unsupported_blocked` | Requires blocker category, rationale, policy/evidence ref, actor/reviewer, audit event. |
| `RelationshipPathConfidenceShape` | RelationshipPath | Requires path confidence, weakest link, edge IDs, warnings, and access-filtering result. |
| `RestrictedEvidencePathShape` | RelationshipPath | Blocks/redacts path output when caller lacks access to any required edge/evidence. |
| `HypothesisLabelingShape` | BridgeHypothesis and hypothesis paths | Requires explicit hypothesis labels and blocks released-fact presentation. |

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

Recommended JSON contract enum values:

```text
identity
vocabulary_crosswalk
evidence_backed_relationship
inferred_relationship
ai_suggested_relationship
hypothesis_bridge
speculative_unreviewed
unsupported_blocked
```

Recommended secondary tag values:

```text
hierarchical
mechanistic
clinical
safety
regulatory
commercial
operational
evidence_support
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

Relationship predicate enum should be separate from mapping predicates. Proposed additional local names:

```text
same_as
has_synonym
has_external_identifier
mechanistically_related_to
clinically_related_to
safety_context_related_to
regulatory_crosswalk_to
commercially_related_to
operational_dependency_of
inferred_from_path
model_suggested
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
- Keep mapping objects distinct from relationship assertions, even if both use `pharmrel:` local names.
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

- Existing mapping predicate local names are camelCase while addendum examples use snake_case. This taxonomy preserves the current mapping-contract camelCase values and uses snake_case for newly proposed Semantic Bridge relationship predicate local names. If ontology prefers one style globally, add aliases but do not merge mapping equivalence predicates with relationship predicates.
