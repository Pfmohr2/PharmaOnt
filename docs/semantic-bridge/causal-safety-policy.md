# Semantic Bridge Causal and Safety Claim Policy

Owner: Causal and Safety Claims Guardrail Agent (`andy-mqvn41pb`)

Status: Addendum Phase A policy contract

Scope: Relationship assertions, relationship paths, bridge hypotheses, path explanations, API responses, UI cards, exports, and release validation for governed cross-domain relationship mapping.

This policy implements the Semantic Bridge guardrails from addendum sections 4.2, 4.5, 9.6, 11.3, 12 Agent 32, and the global section 19 rule that every cross-domain connection is a governed relationship assertion with class, evidence, provenance, confidence, assertion type, review status, license, and release context. It also inherits the existing PharmaOps section 6.3 controls: no AI auto-publish, evidence and provenance on every governed object, no fabricated confidence, FAERS/openFDA non-causal enforcement, and no cross-tenant leakage.

## Core Rule

No relationship assertion, path, hypothesis, explanation, export, or release artifact may state or imply causation unless all of the following are true:

1. The relationship class and predicate are allowed to carry a causal claim.
2. The supporting evidence type is allowed to support that causal interpretation.
3. The claim has a real evidence chain, source versions, source spans where applicable, provenance, confidence source, and license metadata.
4. The relationship has passed required human review for the domain.
5. The explanation states the evidence type and limitations that support the claim.
6. The path does not include any edge whose source, class, assertion type, review status, or warning downgrades the path below causal eligibility.

Absence of a warning is not proof of causal eligibility. Causal eligibility must be explicit.

## Required Fields

Every relationship assertion and every path result that could be safety-sensitive or causality-adjacent must carry these fields:

| Field | Required meaning |
|---|---|
| `relationship_class` | One primary class from the Semantic Bridge taxonomy. |
| `predicate` | The exact relationship predicate, not a generic "related" label when a stronger claim is implied. |
| `claim_type` | `descriptive`, `associative`, `mechanistic`, `causal`, `safety_signal`, `regulatory`, `operational`, `hypothesis`, or `blocked`. |
| `causal_claim_status` | `not_causal`, `causal_prohibited`, `causal_review_required`, `causal_review_approved`, or `blocked_overclaim`. |
| `assertion_type` | `imported`, `human_curated`, `inferred`, `model_suggested`, `system_generated`, `deprecated`. |
| `review_status` | `draft`, `proposed`, `in_review`, `approved`, `rejected`, `released`, `deprecated`, or `superseded`. |
| `evidence_type` | Source-specific evidence category such as trial registry, publication, curated activity, spontaneous report, label, internal template, rule, model output. |
| `disclaimer_ids` | Source-specific limitation identifiers. FAERS/openFDA must include `source_limit:faers_non_causal`. |
| `known_limitations` | Human-readable limitation text that must travel with evidence. |
| `confidence_score` and `confidence_band` | Real calibrated or rule-derived confidence, never fabricated. |
| `confidence_source` | Calibration, reviewer, deterministic rule, source score, or blocked. |
| `release_context` | `working`, `review`, or released ID. |
| `data_license_class` | License class for every edge and evidence object. |

## Prohibited Claim Matrix

The classes below may never assert causality. They can support context, mapping, navigation, provenance, review, or investigation only.

| Relationship class | Causal claim allowed? | Prohibited wording and behavior | Required path status if present |
|---|---:|---|---|
| `identity` | No | Must not imply that aliases, synonyms, or same-as mappings cause any outcome. | May be released only as identity/mapping, not as causal evidence. |
| `vocabulary_crosswalk` | No | Must not imply a term mapping proves biology, clinical effect, safety signal, incidence, or product fault. | Mapping context only. |
| `hierarchical` | No | Must not imply parent/child ontology placement causes the child concept or any clinical outcome. | Taxonomy context only. |
| `clinical` | No by default | Trial participation, endpoint, eligibility, cohort, or outcome evidence must not be stated as causal unless a separate approved causal or mechanistic assertion exists. | `causal_review_required` for any causal wording. |
| `safety` | No by default | Product-event, AE coding, label safety, or signal context must not prove causation, incidence, prevalence, comparative risk, or product fault from safety data alone. | `not_causal` or `blocked_overclaim`; FAERS/openFDA is always non-causal. |
| `regulatory` | No | Submission terms, labels, codelists, and crosswalks must not imply causation beyond the exact approved label or regulatory text. | Regulatory context only unless separately reviewed. |
| `commercial` | No | Market, payer, segment, or product-alignment links must not imply clinical efficacy, causality, safety, or medical suitability. | Commercial context only. |
| `operational` | No | Workflow, system, dataset, and dashboard dependencies must not imply scientific or clinical facts. | Operational context only. |
| `evidence_support` | No | A document or source record supporting an assertion is not itself a causal claim. | Evidence context only. |
| `inferred` | No direct causality | Path-derived links must not upgrade association into causation. | `inferred` or `hypothesis`; release requires reviewed source edges and no overclaim. |
| `hypothesis` | No direct causality | May state "hypothesis" or "candidate for investigation"; must not state "causes", "drives", "prevents", or "increases risk" as fact. | Not released fact; may be `accepted_for_investigation`. |
| `blocked` | No | Must not be used in released or exportable paths except as rejected/blocked history. | Path is `blocked`. |

Limited causal or mechanistic language is only eligible for:

| Relationship class | Eligibility |
|---|---|
| `mechanistic` | May use mechanistic language only with direct mechanistic evidence, explicit predicate, source evidence, confidence source, and approved domain review. |
| `clinical` | May use causal language only when the claim is backed by appropriate reviewed clinical evidence and the explanation states the study/evidence limitations. Trial registry presence alone is not causal. |
| `safety` | May use causal language only when supported by reviewed non-FAERS evidence that is policy-approved for causal interpretation. FAERS/openFDA alone remains prohibited. |

## Source and Evidence Rules

| Source or evidence type | Allowed claim types | Mandatory warning | Release gate |
|---|---|---|---|
| openFDA FAERS / FAERS-like spontaneous reports | `safety_signal`, `associative`, `descriptive`, `investigation_prompt` | `warning:faers_non_causal` | Block if causal, incidence, prevalence, comparative-risk, or product-fault wording appears, or if `source_limit:faers_non_causal` is missing. |
| Case reports and noisy safety sources | `safety_signal`, `associative`, `descriptive`, `investigation_prompt` | `warning:case_report_limitations` | Block causal or incidence claims unless separately reviewed with additional eligible evidence. |
| ClinicalTrials.gov registry records | `clinical`, `descriptive`, `trial_context` | `warning:trial_registry_not_result_proof` | Block causal claims unless outcome evidence and causal review are attached. |
| PubMed / Europe PMC articles | Depends on article type | `warning:publication_context_required` | Block if article evidence is promoted as curated fact without review or if limitations are missing. |
| ChEMBL activities | `mechanistic`, `associative`, `descriptive` | `warning:activity_context_required` | Block causal disease or patient-impact claims from assay data alone. |
| UniProt | `mechanistic`, `identity`, `descriptive` | `warning:protein_annotation_context_required` | Block clinical/safety causal claims from protein annotation alone. |
| Internal confidential templates | Depends on source policy | `warning:internal_source_policy_required` | Block if license, tenant, confidentiality, PHI/PII, or permitted-use metadata is missing. |
| AI/model output | `model_suggested`, `hypothesis`, `reviewable_candidate` only | `warning:model_suggested_not_approved_fact` | Block release until converted through human governance with immutable evidence and review proof. |

## Mandatory Warning Rules

Warnings are structured objects, not free text. They must travel with the edge, path, explanation, UI result, API response, export, and release package when applicable.

| Warning ID | Trigger | Required text intent | Release effect |
|---|---|---|---|
| `warning:faers_non_causal` | Any path edge or evidence object sourced from openFDA FAERS or FAERS-like spontaneous reports. | FAERS/openFDA reports are spontaneous reports and do not establish causation, incidence, prevalence, comparative risk, or product fault by themselves. | Missing warning blocks release and export. Causal wording blocks release. |
| `warning:safety_signal_not_causal` | Safety class edge without approved causal review. | This is safety context or signal evidence, not a causal conclusion. | Blocks causal claim; non-causal path may remain reviewable or releasable if other requirements pass. |
| `warning:case_report_limitations` | Case report or low-volume/noisy safety source. | Case reports may suggest context but cannot establish incidence or causality by themselves. | Blocks causal/incidence claims unless eligible reviewed evidence is added. |
| `warning:trial_registry_not_result_proof` | Trial registry record used as evidence. | Registry data describes study context and may be incomplete or updated; it is not by itself proof of causal effect. | Blocks causal claims unless reviewed outcome evidence is attached. |
| `warning:publication_context_required` | Publication evidence used in assertion or path. | Publication evidence must be interpreted by article type, quality, and curated review status. | Blocks release if citation, source version, evidence role, or review is missing. |
| `warning:activity_context_required` | ChEMBL or assay/activity evidence used. | Assay/activity data provides experimental context and does not by itself prove clinical effect or safety. | Blocks clinical/safety causal claims from assay data alone. |
| `warning:model_suggested_not_approved_fact` | Any model-generated edge, hypothesis, path summary, or explanation. | Model suggested only; not approved, released, or publishable without human governance. | Blocks release until converted and approved. |
| `warning:inferred_path_not_direct_evidence` | Multi-hop path creates an inferred connection. | The endpoint relationship is inferred from a path and is not direct evidence. | Blocks direct causal wording; release requires reviewed exceptions. |
| `warning:weakest_link_limits_path` | Any edge has lower confidence, weaker review, restricted license, broad/related match, or non-causal warning. | Path confidence and claim strength are limited by the weakest edge. | Blocks high confidence or causal status if the weakest link is not eligible. |
| `warning:conflicting_evidence` | Evidence polarity is conflicting or unknown. | Evidence is conflicting or incomplete. | Blocks high confidence and causal release until reviewed. |
| `warning:restricted_or_redacted_evidence` | Any edge or evidence is restricted, redacted, federated, or inaccessible to the requester. | Some path evidence is restricted or redacted under source policy. | Blocks export/release for unauthorized viewers and blocks AI summaries from using hidden content. |
| `warning:unreleased_context` | Path or edge is not bound to a released semantic version. | Working/review context only; not a released semantic version. | Blocks released-context presentation. |

## Path-Level Claim Rules

1. A path may not have a stronger `claim_type`, `causal_claim_status`, or `confidence_band` than its weakest critical edge allows.
2. A path containing any FAERS/openFDA edge must carry `warning:faers_non_causal` and cannot have `causal_claim_status=causal_review_approved` unless the causal claim is supported by separate eligible evidence and the explanation states that FAERS was not used as causal proof.
3. A path containing `model_suggested` or `hypothesis` edges must be labeled `model_suggested`, `hypothesis`, or `reviewable_candidate`; it must not be displayed as released fact.
4. A path containing `inferred`, `broad_match`, `related_match`, or low-confidence edges must include `warning:weakest_link_limits_path` and cannot be `high` confidence unless a reviewed policy exception is attached.
5. A path with restricted evidence must be filtered, redacted, or blocked before explanation generation. Warnings must not leak hidden source details, counts, snippets, or confidence notes.
6. Plain-language summaries must avoid causal verbs unless causal eligibility is explicit. Prohibited terms include `causes`, `caused by`, `causal`, `drives`, `prevents`, `increases risk`, `reduces risk`, `incidence`, `prevalence`, `relative risk`, `attributable`, and `product fault` unless the policy gates are satisfied.
7. Ranking, badges, graph arrows, and visual proximity must not imply causation. A directed edge is not automatically causal.

## AI, Speculation, and Hypothesis Labeling

AI-generated and speculative links must be impossible to confuse with approved facts.

| Object | Required label | Required status | Release behavior |
|---|---|---|---|
| AI relationship candidate | `model_suggested` | `proposed` or `in_review` | Release-blocked until converted through governed human review. |
| AI path summary | `model_suggested_path_summary` | Working/review only | Must cite source edge IDs and warnings; cannot introduce unsupported causal wording. |
| Bridge hypothesis | `hypothesis_bridge` | `draft`, `proposed`, `in_review`, or `accepted_for_investigation` | Not a released fact. Conversion creates a new relationship proposal with evidence and review proof. |
| Inferred path | `inferred_from_path` | `reviewable_candidate` unless released by exception | Must show weakest link and warning that endpoint relation is inferred. |
| Unsupported speculation | `unsupported` | `blocked` or `rejected` | Must not be exported as evidence or released. |

AI may summarize existing evidence only within the access-filtered payload it is authorized to see. AI may not invent confidence, evidence, reviewer status, source limitations, or release context. PHI/PII and restricted evidence remain governed by the customer-data-boundary and licensing policies.

## Release-Block Conditions

Validation, SHACL, API, workflow, export, and release-manager checks must block release or released-context presentation when any condition below is true.

| Block ID | Condition | Required action |
|---|---|---|
| `block:causal_class_prohibited` | Relationship class is in the prohibited matrix and the assertion/path uses causal, incidence, prevalence, comparative-risk, or product-fault language. | Set `causal_claim_status=blocked_overclaim`; reject release. |
| `block:causal_review_missing` | Causal or mechanistic claim lacks approved causal/domain review. | Keep in review; reject release. |
| `block:evidence_missing` | Released assertion or path lacks evidence IDs, evidence roles, source names, source versions, or provenance. | Reject release. |
| `block:confidence_fabricated` | Confidence score or band lacks a real source or exceeds weakest-link policy. | Reject release and route to review. |
| `block:faers_causal_overclaim` | FAERS/openFDA or FAERS-like evidence is used to support causation, incidence, prevalence, comparative risk, or product fault by itself. | Reject release and explanation. |
| `block:faers_disclaimer_missing` | FAERS/openFDA evidence lacks `source_limit:faers_non_causal` or equivalent source limitation text. | Reject release/export; require evidence repair. |
| `block:safety_limitations_missing` | Safety relationship lacks evidence-type and limitation metadata. | Reject release. |
| `block:model_suggested_release` | Raw `model_suggested` edge, path, or hypothesis appears in released scope. | Reject release and audit denial. |
| `block:hypothesis_as_fact` | Hypothesis bridge is presented as approved/released fact. | Reject release/export; relabel or remove. |
| `block:unsupported_speculation` | Assertion/path has no eligible evidence or includes unsupported speculative language. | Reject release and mark blocked/rejected. |
| `block:blocked_edge_in_path` | Path includes a blocked, rejected, deprecated, or superseded edge without a documented exception. | Set path status `blocked`; reject release. |
| `block:restricted_evidence_leak` | Path explanation, summary, export, AI prompt, or warning leaks restricted evidence to an unauthorized user. | Block or redact path; audit. |
| `block:source_disclaimer_missing` | Required source disclaimer/limitation is absent from evidence, API, UI, export, or release package. | Reject release/export. |
| `block:release_context_mismatch` | Edge, evidence, provenance, or validation proof is not bound to the requested tenant, environment, or release context. | Reject release and response. |

Any critical release-block finding must be authoritative. Caller-supplied validation results, inline waiver flags, or client-provided warnings are not sufficient.

## Existing FAERS/openFDA Control Inheritance

Semantic Bridge implementations must reuse and preserve these existing controls:

- `packages/licensing/src/index.js` defines `FAERS_NON_CAUSAL_DISCLAIMER_ID = "source_limit:faers_non_causal"`, marks FAERS/openFDA as requiring a non-causal disclaimer, and reports `supports_causal_claims: false`.
- `services/ai-curation/src/index.js` rejects FAERS/openFDA causal relationship suggestions, sets `safety.causality_allowed=false`, sets `safety.faers_causal_blocked=true`, and attaches non-causal source limitations to evidence refs.
- `services/api/src/ai-curation.js` rejects FAERS/openFDA causal suggestions while preserving valid non-causal disclaimer text.
- `services/explanation/src/index.js` blocks FAERS/openFDA evidence when used for causal explanation.
- `services/validation/src/index.js` includes the `faers_non_causal` rule: FAERS/openFDA safety data must remain non-causal and carry source limitations with evidence.
- Validation package control "FAERS/openFDA non-causal enforcement" records that causal FAERS/openFDA claims are blocked while required disclaimer/source limitation fields remain attached to evidence.

The relationship layer must not create alternate disclaimer IDs, weaker safety flags, or a separate causal exception path for FAERS/openFDA. It may add source-specific warnings, but it must preserve `source_limit:faers_non_causal` end to end.

## Acceptance Criteria

This policy is satisfied only when later implementation can prove:

1. Every safety or causality-adjacent edge has `causal_claim_status`, evidence limitations, warnings, and review status.
2. Every path has a weakest-link explanation and cannot exceed the weakest link's claim strength.
3. FAERS/openFDA paths display non-causal warnings and cannot imply causation, incidence, prevalence, comparative risk, or product fault from FAERS/openFDA evidence.
4. AI-suggested and inferred paths are visibly labeled and cannot enter release without governed human review and conversion.
5. Missing evidence, missing source limitations, fabricated confidence, unsupported causal wording, restricted-evidence leaks, and model-suggested release attempts are release-blocking findings.
6. UI, API, export, and release package representations carry the same warnings and blockers as the relationship assertion source records.
