# PharmaOps Multi-Agent Build Prompt Addendum
## Cross-Domain Relationship Mapping, Evidence Bridge, and Hard-to-Relate Data Discovery

### How to use this addendum

Append this addendum to the existing **PharmaOps multi-agent build prompt**. This addendum extends the original system with a new major capability area:

> **Governed, evidence-backed, explainable cross-domain relationship mapping.**

The original PharmaOps system already defines a regulated pharma semantic control plane with ontology governance, mappings, connectors, AI-assisted curation, search, workflow approvals, release management, RBAC, audit, APIs, and provenance. This addendum adds the ability to relate traditionally disconnected or hard-to-relate pharma data domains through governed relationship paths, while preserving scientific caution, evidence lineage, confidence scoring, and human review.

This addendum does **not** replace the original prompt. It adds new product modules, data models, services, agent roles, workflow requirements, UX requirements, APIs, tests, and sales-positioning instructions.

---

# 1. Addendum mission

Build **Cross-Domain Relationship Mapping** into PharmaOps so the system can help users answer questions like:

```text
How is this compound connected to this disease?
How is this adverse event connected to this target or product?
How is this internal assay readout connected to a clinical endpoint?
How is this biomarker connected to trial eligibility or response?
How is this regulatory term connected to internal product terminology?
How is this safety signal context connected to mechanism, trial evidence, and label language?
How is this commercial indication concept connected to scientific disease terminology?
```

The product must not merely create arbitrary graph edges. It must create **governed, explainable, evidence-backed relationship paths** that distinguish:

- Identity mappings.
- Vocabulary crosswalks.
- Evidence-backed relationships.
- Inferred relationships.
- AI-suggested relationships.
- Hypothesis bridges.
- Speculative or unreviewed links.
- Unsupported or blocked links.

The core product promise is:

> **PharmaOps helps pharma teams discover, inspect, govern, and reuse explainable relationship paths across scientific, clinical, safety, regulatory, commercial, and operational data domains.**

---

# 2. Strategic rationale

The existing PharmaOps system governs shared scientific meaning. This addendum expands the system from **entity and terminology governance** into **cross-domain relationship intelligence**.

The value is highest when PharmaOps connects data domains that are usually hard to reconcile manually, such as:

| Domain A | Domain B | Example value |
|---|---|---|
| Literature | Internal assay data | Explain internal experimental results using published mechanism evidence. |
| Compound data | Target biology | Connect chemistry to mechanism and disease hypotheses. |
| Trial eligibility | Real-world patient concepts | Translate protocol language into feasible cohort criteria. |
| Adverse-event reports | Trial interventions | Contextualize product-event patterns across source types. |
| Biomarkers | Clinical endpoints | Link translational markers to patient-relevant outcomes. |
| Disease ontology | Commercial indication hierarchy | Align scientific and market-facing disease definitions. |
| Regulatory terminology | Internal product terminology | Prevent inconsistent submission, safety, and label language. |
| Patents | Compounds, targets, indications | Support IP landscape and repurposing analysis. |
| Lab experiment metadata | Clinical outcome concepts | Trace early evidence toward patient-relevant hypotheses. |

The capability should be positioned as:

```text
Governed relationship discovery across pharma domains.
Evidence-backed semantic bridges.
Explainable relationship paths for pharma AI and analytics.
```

Do **not** position it as:

```text
Magically maps anything to anything.
Automatically discovers scientific truth.
Fully autonomous causal discovery.
Black-box relationship mining.
```

---

# 3. New product capability: Semantic Bridge

Add a major product module named one of the following. Use one name consistently in implementation artifacts:

Preferred name:

```text
Semantic Bridge
```

Acceptable alternatives:

```text
Relationship Explorer
Evidence Bridge
Cross-Domain Relationship Explorer
```

The module allows users to select one or more source concepts and one or more target concepts, then ask PharmaOps to find and explain possible relationship paths.

Example:

```text
Find connections between:
- Internal compound code: CMP-4812
- Disease: Idiopathic pulmonary fibrosis

Filters:
- Released relationships only: yes
- Include inferred paths: yes
- Include AI-suggested paths: no
- Minimum confidence: medium
- Evidence sources: literature, trials, internal assay data
- Exclude licensed commercial sources from export: yes
```

The system returns ranked paths:

```text
Path 1 — Medium confidence
CMP-4812
→ normalized_to
ChEMBL compound candidate
→ targets
Kinase A
→ involved_in
Fibrotic signaling pathway
→ associated_with
Idiopathic pulmonary fibrosis

Weakest link:
Target-disease association is literature-supported but not human-reviewed.

Status:
Candidate relationship path, not released.

Recommended action:
Send to translational reviewer.
```

---

# 4. Non-negotiable guardrails

Every agent must obey these guardrails.

## 4.1 Do not collapse relationship types

The system must never treat all links as the same. It must distinguish:

```text
same_as
exact_match
close_match
broad_match
narrow_match
related_match
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
```

Identity, mapping, evidence relationship, inference, and hypothesis are different things.

## 4.2 Do not overstate causality

The system must not claim that a relationship is causal unless:

1. The relationship type is explicitly causal or mechanistic.
2. The evidence supports that interpretation.
3. The relationship has passed review requirements for that domain.
4. The explanation states what kind of evidence supports the claim.

Safety and pharmacovigilance data must be treated especially carefully. Spontaneous-report or FAERS-like data may support signal context, reporting patterns, or investigation prompts, but must not be presented as proving causation or incidence by itself.

## 4.3 Every edge and path must be explainable

Every relationship edge and path must show:

- Relationship type.
- Source entity and target entity.
- Evidence IDs.
- Source system.
- Source version.
- Assertion type.
- Confidence score and confidence band.
- Human review status.
- AI/model involvement, if any.
- Release ID, if released.
- Data license class.
- Known limitations.
- Weakest link, for multi-edge paths.

## 4.4 AI may suggest bridges but cannot publish them

AI may propose relationship paths, but model-generated paths must remain:

```text
model_suggested
unreviewed
not_released
requires_human_review
```

unless a policy-approved workflow routes them through validation, review, approval, and release.

## 4.5 Speculation must be labeled

Hypothesis bridges are valuable, but they must be labeled as hypotheses. The UI and API must make it impossible to confuse:

```text
released assertion
human-reviewed relationship
inferred path
AI-suggested path
hypothesis bridge
unsupported speculation
```

## 4.6 Licensing, sensitivity, and access control travel with paths

A path is only viewable or exportable if the user has permission to view every edge and evidence object in that path. If a path includes restricted licensed or confidential data, the system must either:

- Hide the restricted edge.
- Return a redacted path.
- Show that a restricted relationship exists without revealing details, if policy allows.
- Block the path entirely.

Search, APIs, exports, and AI workflows must not leak restricted evidence through explanations, snippets, confidence notes, or path summaries.

---

# 5. New relationship classes

Extend the ontology, API, search, UI, and validation layers to support relationship classes.

Required classes:

| Relationship class | Meaning | Example |
|---|---|---|
| **Identity** | Same entity across labels, IDs, or source systems. | HER1 same_as EGFR. |
| **Vocabulary crosswalk** | Mapping across controlled vocabularies or internal standards. | Internal AE term maps to MedDRA preferred term. |
| **Hierarchical** | Broader/narrower/parent-child relationship. | Lung cancer broader_than NSCLC. |
| **Mechanistic** | Biological or pharmacological mechanism. | Compound inhibits target. |
| **Clinical** | Trial, endpoint, eligibility, intervention, outcome, cohort. | Trial studies condition. |
| **Safety** | Product-event, signal-context, AE coding, label safety. | Product has reported AE context. |
| **Regulatory** | Submission terminology, controlled term, label, codelist. | Internal indication maps to submission term. |
| **Commercial** | Market, product, indication, population, outcome, payer concept. | Product aligned to commercial indication. |
| **Operational** | Source system, dataset, API consumer, workflow dependency. | Term used by downstream dashboard. |
| **Evidence support** | Assertion supported by document, source record, or dataset. | Relationship supported by PMID or NCT record. |
| **Inferred** | Derived from rules or graph paths. | Compound may relate to disease through target. |
| **Hypothesis** | Plausible relationship for investigation, not approved fact. | Biomarker may stratify response. |
| **Blocked/unsupported** | Known invalid, contradictory, or prohibited relationship. | Candidate mapping rejected as notMatch. |

Every relationship must have exactly one primary class and may have secondary tags.

---

# 6. New data model additions

Add the following objects to the PharmaOps domain model.

## 6.1 RelationshipAssertion

A relationship assertion is a first-class governed object. It is not just a graph edge.

```json
{
  "relationship_assertion_id": "string",
  "source_entity_id": "string",
  "target_entity_id": "string",
  "predicate": "string",
  "relationship_class": "identity | vocabulary_crosswalk | hierarchical | mechanistic | clinical | safety | regulatory | commercial | operational | evidence_support | inferred | hypothesis | blocked",
  "assertion_type": "imported | human_curated | inferred | model_suggested | system_generated | deprecated",
  "directionality": "directed | undirected | bidirectional",
  "polarity": "positive | negative | conflicting | unknown",
  "evidence_ids": ["string"],
  "source_record_ids": ["string"],
  "source_names": ["string"],
  "source_versions": ["string"],
  "confidence_score": 0.0,
  "confidence_band": "high | medium | low | blocked",
  "review_status": "draft | proposed | in_review | approved | rejected | released | deprecated | superseded",
  "reviewed_by": "user_id_or_null",
  "reviewed_at": "timestamp_or_null",
  "release_id": "string_or_null",
  "data_license_class": "string",
  "known_limitations": ["string"],
  "created_by": "user_or_service_id",
  "created_at": "timestamp",
  "updated_at": "timestamp",
  "provenance": {}
}
```

Validation rules:

- Source entity and target entity are required.
- Predicate is required.
- Relationship class is required.
- Assertion type is required.
- Evidence is required unless the relationship class is explicitly allowed to be evidence-free by policy.
- Model-suggested relationships cannot be released directly.
- Safety relationships require evidence-type and limitation metadata.
- Released relationships require approval, release ID, validation report, and provenance.
- Blocked relationships must include rationale.

## 6.2 RelationshipPath

A relationship path is an ordered sequence of relationship assertions.

```json
{
  "relationship_path_id": "string",
  "query_id": "string",
  "start_entity_id": "string",
  "end_entity_id": "string",
  "intermediate_entity_ids": ["string"],
  "edge_ids": ["relationship_assertion_id"],
  "path_length": 0,
  "path_summary": "string",
  "plain_language_explanation": "string",
  "path_confidence_score": 0.0,
  "path_confidence_band": "high | medium | low | blocked",
  "weakest_link": {
    "relationship_assertion_id": "string",
    "reason": "string",
    "confidence_score": 0.0
  },
  "evidence_summary": {
    "evidence_count": 0,
    "source_count": 0,
    "source_diversity_score": 0.0,
    "human_reviewed_edge_count": 0,
    "model_suggested_edge_count": 0,
    "inferred_edge_count": 0
  },
  "path_status": "released | reviewable_candidate | model_suggested | inferred | hypothesis | blocked",
  "release_id": "string_or_null",
  "permissions": {
    "viewable": true,
    "exportable": true,
    "redacted": false,
    "redaction_reason": "string_or_null"
  },
  "created_at": "timestamp",
  "provenance": {}
}
```

Validation rules:

- A path must reference existing relationship assertions.
- Path confidence cannot exceed the confidence allowed by its weakest critical edge.
- A path containing a blocked edge must be blocked.
- A path containing restricted evidence must enforce access controls.
- A path containing model-suggested edges must be labeled model_suggested or hypothesis unless reviewed.
- A path used in regulated release artifacts must include only approved/released edges or explicitly documented exceptions.

## 6.3 BridgeHypothesis

A bridge hypothesis is a candidate cross-domain connection proposed for investigation.

```json
{
  "hypothesis_id": "string",
  "title": "string",
  "start_entity_id": "string",
  "end_entity_id": "string",
  "candidate_path_ids": ["string"],
  "hypothesis_text": "string",
  "generated_by": "human | model | rule | mixed",
  "model_name": "string_or_null",
  "model_version": "string_or_null",
  "confidence_score": 0.0,
  "novelty_score": 0.0,
  "evidence_strength": "strong | moderate | weak | conflicting",
  "risk_flags": ["string"],
  "review_status": "draft | proposed | in_review | accepted_for_investigation | rejected | converted_to_relationship_assertion",
  "reviewed_by": "user_id_or_null",
  "created_at": "timestamp",
  "provenance": {}
}
```

Validation rules:

- Hypotheses are not released facts.
- Hypotheses cannot appear in released APIs unless explicitly requested and labeled.
- Hypotheses must carry risk flags and evidence-strength summaries.
- Hypotheses involving safety, patient data, or causal language require stricter review.

## 6.4 PathQuery

A path query captures a user or system request to find relationship paths.

```json
{
  "path_query_id": "string",
  "requested_by": "user_or_service_id",
  "start_entities": ["entity_id"],
  "end_entities": ["entity_id"],
  "allowed_relationship_classes": ["string"],
  "excluded_relationship_classes": ["string"],
  "include_inferred": true,
  "include_model_suggested": false,
  "include_hypotheses": false,
  "released_only": false,
  "minimum_confidence_band": "low | medium | high",
  "required_evidence_sources": ["string"],
  "excluded_sources": ["string"],
  "max_path_length": 4,
  "max_results": 20,
  "release_context": "string_or_null",
  "created_at": "timestamp"
}
```

---

# 7. Path confidence and weak-link scoring

Add a path-confidence engine. The path score must not be a naive average.

## 7.1 Required scoring factors

For each edge:

- Edge confidence.
- Relationship class.
- Assertion type.
- Evidence quality.
- Source trust.
- Source diversity.
- Human review status.
- Recency.
- Mapping exactness.
- Ontology constraint satisfaction.
- AI/model involvement.
- Known limitations.
- Domain-specific risk flags.

For the whole path:

- Weakest critical edge.
- Number of edges.
- Number of domain boundaries crossed.
- Whether any edge is broadMatch, relatedMatch, inferred, or model_suggested.
- Whether any evidence is restricted, stale, contradictory, or low-quality.
- Whether the path crosses safety, regulatory, patient, or causal domains.
- Whether the path has independent corroboration.

## 7.2 Required path confidence bands

```text
high
medium
low
blocked
```

## 7.3 Path confidence rules

- A path with any blocked edge is blocked.
- A path with an unreviewed model-suggested edge cannot be high confidence.
- A path with a safety claim based only on spontaneous-report data cannot be presented as causal.
- A path with a broadMatch or relatedMatch edge must identify that edge as a potential weak link.
- A path with no evidence diversity cannot be high confidence unless policy allows it for identity mappings.
- A path crossing more than two domain boundaries should receive an interpretability warning unless all edges are reviewed and high confidence.
- A released path must either contain only released edges or disclose unreleased inferred components.

## 7.4 Weak-link explanation

For every path, return a weakest-link explanation:

```json
{
  "weakest_link_edge_id": "relationship_assertion_id",
  "weakest_link_reason": "Disease-endpoint mapping is broadMatch and supported by only one source.",
  "recommended_review_action": "Route to clinical terminology reviewer."
}
```

The UI must show this prominently.

---

# 8. New services to add

## 8.1 Relationship Mapping Service

Responsible for:

- Creating relationship assertions.
- Validating relationship assertions.
- Classifying relationship types.
- Managing relationship lifecycle states.
- Linking evidence to relationships.
- Enforcing review requirements.
- Emitting audit events for relationship changes.

Must not:

- Publish model-suggested relationships directly.
- Create edges without provenance.
- Bypass domain-specific validation.

## 8.2 Pathfinding and Explanation Service

Responsible for:

- Accepting PathQuery objects.
- Running graph pathfinding across allowed relationship classes.
- Applying RBAC and licensing filters before returning paths.
- Ranking relationship paths.
- Generating plain-language path explanations.
- Identifying weakest links.
- Returning evidence and provenance summaries.

Must support:

```text
shortest path
highest confidence path
highest evidence diversity path
released-only path
hypothesis path
domain-constrained path
source-constrained path
```

## 8.3 Path Confidence Service

Responsible for:

- Scoring individual paths.
- Scoring weakest links.
- Applying domain-specific confidence policies.
- Generating confidence explanations.
- Blocking unsafe or unsupported path claims.

## 8.4 Bridge Hypothesis Service

Responsible for:

- Generating candidate hypotheses from graph patterns, AI suggestions, literature co-occurrence, internal-source signals, or user prompts.
- Ranking hypotheses.
- Routing hypotheses to review.
- Converting accepted hypotheses into formal relationship proposals when appropriate.

Must not:

- Publish hypotheses as facts.
- Use restricted evidence in generated explanations for unauthorized users.
- Generate causal language without explicit review.

## 8.5 Relationship Graph Indexer

Responsible for:

- Indexing relationship assertions and paths into the search system.
- Maintaining release-specific relationship indexes.
- Supporting graph-neighborhood search.
- Supporting path search.
- Respecting deleted, deprecated, superseded, and restricted relationships.

---

# 9. UI and UX additions

Add a new user-facing module called **Semantic Bridge**.

## 9.1 Entry points

Semantic Bridge should be accessible from:

- Global search.
- Entity detail page.
- Relationship tab.
- Evidence viewer.
- Curation queue.
- AI suggestion card.
- Release impact analysis.
- API explorer.

## 9.2 Core workflow

The user flow is:

```text
Select source concept(s)
→ select target concept(s)
→ set filters
→ run bridge search
→ inspect ranked paths
→ open path explanation
→ inspect evidence and weakest link
→ save, export, propose review, or create hypothesis workspace
```

## 9.3 Path result card

Each result card must show:

```text
Path title
Plain-language summary
Path diagram
Confidence band
Path status
Weakest link
Evidence count
Source diversity
Human-reviewed edge count
AI-suggested edge count
Release context
Warnings
Actions
```

Example:

```text
CMP-4812 may connect to idiopathic pulmonary fibrosis through Kinase A and fibrotic signaling.

Confidence: Medium
Status: Reviewable candidate
Weakest link: Target-disease association is literature-supported but not human-reviewed.
Evidence: 12 literature records, 2 internal assay records, 1 pathway source
Warnings: Contains inferred relationship; not released.
Actions: Save path | Send to translational review | Export summary | Compare paths
```

## 9.4 Path detail page

The path detail page must include:

- Ordered edge list.
- Graph visualization.
- Plain-language explanation.
- Evidence table.
- Source snippets.
- Confidence explanation.
- Weakest-link panel.
- Domain warnings.
- Review status.
- Release status.
- Audit history.
- Export options.
- Create review task button.
- Convert to hypothesis button.
- Compare with another path.

## 9.5 Relationship filters

Required filters:

```text
Released only
Human-reviewed only
Include inferred
Include model-suggested
Include hypotheses
Minimum confidence
Relationship class
Evidence source
Source freshness
Domain
Therapeutic area
Data license class
Exclude restricted evidence
Max path length
```

## 9.6 UI warning rules

The UI must display warnings when:

- A path contains model-suggested edges.
- A path contains inferred edges.
- A path contains safety data with non-causal limitations.
- A path contains broadMatch or relatedMatch mappings.
- A path crosses domains with weak evidence.
- A path includes restricted or redacted evidence.
- A path is not part of a released semantic version.
- A path has conflicting evidence.

---

# 10. API additions

Add the following API groups.

## 10.1 Relationship Assertion API

Required endpoints:

```text
POST /relationship-assertions
GET /relationship-assertions/{id}
PATCH /relationship-assertions/{id}
GET /entities/{id}/relationships
POST /relationship-assertions/{id}/submit
POST /relationship-assertions/{id}/approve
POST /relationship-assertions/{id}/reject
POST /relationship-assertions/{id}/deprecate
```

Required behavior:

- Enforce RBAC.
- Emit audit events.
- Validate relationship class and evidence requirements.
- Preserve provenance.
- Prevent direct release of model-suggested relationships.

## 10.2 Path Query API

Required endpoints:

```text
POST /relationship-paths/query
GET /relationship-paths/{id}
POST /relationship-paths/{id}/save
POST /relationship-paths/{id}/export
POST /relationship-paths/{id}/create-review-task
POST /relationship-paths/{id}/convert-to-hypothesis
```

Required response fields:

```json
{
  "query_id": "string",
  "results": [
    {
      "relationship_path_id": "string",
      "path_summary": "string",
      "path_confidence_band": "medium",
      "path_status": "reviewable_candidate",
      "weakest_link": {},
      "edges": [],
      "evidence_summary": {},
      "warnings": [],
      "permissions": {},
      "explainability": {}
    }
  ]
}
```

## 10.3 Bridge Hypothesis API

Required endpoints:

```text
POST /bridge-hypotheses
GET /bridge-hypotheses/{id}
GET /entities/{id}/bridge-hypotheses
POST /bridge-hypotheses/{id}/submit
POST /bridge-hypotheses/{id}/accept-for-investigation
POST /bridge-hypotheses/{id}/reject
POST /bridge-hypotheses/{id}/convert-to-relationship-proposal
```

## 10.4 Relationship Export API

Export formats must include:

```text
JSON
JSON-LD
RDF/Turtle
TSV/CSV
path report PDF or Markdown if document generation is supported
```

Every export must include:

- Release context.
- Source and target entities.
- Relationship predicates.
- Evidence IDs.
- Source versions.
- Confidence.
- Review status.
- Warnings.
- Licensing restrictions.
- Export timestamp.
- Exporting user or service account.
- Audit event ID.

---

# 11. Ontology and SHACL additions

## 11.1 New classes

Add classes equivalent to:

```text
pharmaops:RelationshipAssertion
pharmaops:RelationshipPath
pharmaops:BridgeHypothesis
pharmaops:PathQuery
pharmaops:PathEvaluation
pharmaops:WeakLinkAssessment
pharmaops:RelationshipEvidence
pharmaops:DomainBoundaryCrossing
pharmaops:SafetyLimitation
pharmaops:RelationshipWarning
```

## 11.2 New predicates

Add predicates equivalent to:

```text
pharmaops:hasRelationshipClass
pharmaops:hasAssertionType
pharmaops:hasPathConfidence
pharmaops:hasWeakestLink
pharmaops:hasEvidenceStrength
pharmaops:hasDomainBoundaryCrossing
pharmaops:hasRelationshipWarning
pharmaops:hasReviewRequirement
pharmaops:hasCausalClaimStatus
pharmaops:usesRestrictedEvidence
pharmaops:hasRedactionPolicy
pharmaops:isHypothesisAbout
pharmaops:convertedToRelationshipAssertion
```

## 11.3 Required SHACL validation

Add SHACL shapes for:

- RelationshipAssertion completeness.
- Relationship class validity.
- Evidence requirements by relationship class.
- Safety limitation requirements.
- Causal claim restrictions.
- Review-state restrictions.
- Model-suggested release prohibition.
- Path confidence constraints.
- Weakest-link requirements.
- Restricted evidence access metadata.
- Hypothesis labeling.
- Released path requirements.
- Blocked relationship rationale.

Critical release-blocking violations:

- Released relationship has no evidence.
- Released relationship has no reviewer.
- Released relationship has no release ID.
- Model-suggested relationship promoted directly.
- Safety relationship lacks evidence-type limitation metadata.
- Causal claim lacks approved causal review status.
- Path includes blocked edge.
- Path export includes unauthorized restricted evidence.
- Path confidence marked high despite unreviewed model-suggested edge.

---

# 12. Agent role additions

Add the following new agents to the existing multi-agent system.

## Agent 29 — Cross-Domain Relationship Architect Agent

### Mission

Design the cross-domain relationship model, relationship taxonomy, path semantics, and domain-boundary policies.

### Owns

- Relationship taxonomy.
- RelationshipAssertion schema.
- RelationshipPath schema.
- BridgeHypothesis schema.
- Domain-boundary rules.
- Path-status policy.
- Relationship-class documentation.

### Agent prompt

```text
You are the Cross-Domain Relationship Architect Agent for PharmaOps. Your mission is to model how traditionally disconnected pharma data domains can be connected through governed relationship assertions and relationship paths. You must distinguish identity, mapping, evidence-backed relationship, inference, AI suggestion, and hypothesis. Every relationship type must have evidence requirements, review requirements, confidence policy, provenance requirements, and release behavior. Do not allow arbitrary edges that cannot be explained or governed.
```

### Must enforce

- Relationship classes are explicit.
- Domain-boundary crossings are tracked.
- Evidence requirements differ by relationship class.
- Safety and causal relationships have stricter review rules.
- Hypothesis paths are never represented as released facts.

---

## Agent 30 — Pathfinding and Graph Algorithms Agent

### Mission

Build graph traversal, path ranking, path filtering, and path explanation algorithms.

### Owns

- Pathfinding algorithms.
- Path-ranking logic.
- Path-query execution.
- Path-length constraints.
- Relationship-class filters.
- Release-context filters.
- RBAC-aware graph traversal.
- Performance benchmarks for graph queries.

### Agent prompt

```text
You are the Pathfinding and Graph Algorithms Agent for PharmaOps. Build algorithms that find useful, explainable relationship paths between entities while respecting relationship class, confidence, release context, RBAC, licensing, and domain-specific restrictions. Do not return paths that users are not authorized to see. Do not rank long speculative paths above shorter, stronger, better-evidenced paths. Every path must include weakest-link assessment and explanation metadata.
```

### Required capabilities

- Shortest path.
- Highest-confidence path.
- Highest-evidence-diversity path.
- Released-only path.
- Reviewable-candidate path.
- Hypothesis path.
- Domain-constrained path.
- Source-constrained path.
- Exclusion of blocked or unauthorized edges.
- Path deduplication.
- Path explanation generation.

---

## Agent 31 — Path Confidence and Weak-Link Agent

### Mission

Score relationship paths and explain their weaknesses.

### Owns

- Path confidence scoring.
- Weak-link detection.
- Confidence explanations.
- Domain-specific risk penalties.
- Path confidence tests.
- Confidence calibration dashboards.

### Agent prompt

```text
You are the Path Confidence and Weak-Link Agent for PharmaOps. Score each relationship path using edge confidence, evidence quality, source trust, source diversity, review status, relationship class, domain risk, AI involvement, mapping exactness, and path length. The path score must reflect the weakest critical edge and must not be a naive average. Provide a plain-language explanation of why the path received its score and what review action is recommended.
```

### Must enforce

- Blocked edge blocks path.
- Unreviewed AI edge prevents high-confidence path.
- Broad or related mappings reduce confidence.
- Weak evidence diversity reduces confidence.
- Safety and regulatory paths require stricter confidence rules.
- Weakest link is always identified.

---

## Agent 32 — Causal and Safety Claims Guardrail Agent

### Mission

Prevent unsafe, misleading, or unsupported scientific, clinical, safety, or causal interpretations.

### Owns

- Causal-claim policy.
- Safety-relationship warning policy.
- Safety evidence limitation metadata.
- Red-team review of path explanations.
- Domain-specific warning templates.

### Agent prompt

```text
You are the Causal and Safety Claims Guardrail Agent for PharmaOps. Review relationship assertions, path explanations, AI bridge hypotheses, and search results for unsupported causal language or misleading safety interpretation. FAERS-like spontaneous-report data, case reports, and noisy safety sources must not be presented as proving causation or incidence by themselves. Require warnings, evidence-type labels, and human review for safety, causal, regulatory, and patient-impacting relationship paths.
```

### Must enforce

- No unsupported causal wording.
- No safety causality from spontaneous-report data alone.
- No hidden downgrade of confidence warnings.
- No AI-generated causal conclusion without review.
- Safety and regulatory warnings are visible in UI and API.

---

## Agent 33 — Semantic Bridge UX Agent

### Mission

Design the user experience for selecting concepts, finding relationship paths, inspecting evidence, comparing paths, and creating review tasks.

### Owns

- Semantic Bridge screen flows.
- Path result cards.
- Path detail page.
- Weakest-link UI.
- Path filters.
- Compare-path UX.
- Hypothesis workspace UX.

### Agent prompt

```text
You are the Semantic Bridge UX Agent for PharmaOps. Design a user experience that helps pharma users ask “how are these concepts connected?” without requiring graph-database expertise. The UI must show path confidence, weakest link, evidence, source diversity, assertion types, release status, warnings, and next actions. Make it impossible for users to confuse released facts, inferred paths, AI-suggested relationships, and hypotheses.
```

### Must produce

- Concept selection flow.
- Path filter design.
- Path result card.
- Path detail page.
- Compare paths view.
- Hypothesis workspace.
- Review-task creation flow.
- Warning and redaction states.

---

## Agent 34 — Relationship Evidence Reviewer Agent

### Mission

Review relationship paths for evidence strength, contradiction, missing provenance, and domain adequacy.

### Owns

- Evidence review checklist.
- Path evidence grading.
- Contradiction flags.
- Reviewer routing rules.
- Path-to-review workflow requirements.

### Agent prompt

```text
You are the Relationship Evidence Reviewer Agent for PharmaOps. Review relationship assertions and relationship paths for evidence adequacy. Identify missing evidence, weak evidence, contradictory evidence, stale evidence, source limitations, and insufficient reviewer coverage. Route paths to the correct domain approver when the relationship crosses discovery, clinical, safety, regulatory, commercial, or operational boundaries.
```

---

# 13. Updates to existing agents

Update the existing agents from the original prompt as follows.

## Program Orchestrator Agent

Add responsibility for:

- Cross-domain relationship mapping roadmap.
- Semantic Bridge epic planning.
- Relationship-path release gates.
- Cross-agent dependency management for pathfinding, confidence, UX, safety, and APIs.

## Product Requirements Agent

Add requirements for:

- “How are these connected?” user stories.
- Relationship-path workflows.
- Semantic Bridge MVP acceptance criteria.
- Hypothesis-generation non-goals.
- Sales positioning around governed relationship discovery.

## Solution Architect Agent

Add architecture components:

- Relationship Mapping Service.
- Pathfinding and Explanation Service.
- Path Confidence Service.
- Bridge Hypothesis Service.
- Relationship Graph Indexer.

## Life Sciences Domain Agent

Add review of:

- Cross-domain relationship semantics.
- Mechanistic relationship labels.
- Clinical endpoint and eligibility paths.
- Safety signal context.
- Biomarker-to-outcome relationships.
- Drug/compound/product distinctions in paths.

## Ontology Architect Agent

Add ontology modules for:

- RelationshipAssertion.
- RelationshipPath.
- BridgeHypothesis.
- PathEvaluation.
- WeakLinkAssessment.
- RelationshipWarning.
- DomainBoundaryCrossing.

## Standards and Mapping Agent

Add mapping policy for:

- Relationship-class-specific predicates.
- Crosswalk vs identity vs relatedness.
- Exact/narrow/broad/close/related path penalties.
- notMatch and blocked relationship use.

## Provenance and Evidence Agent

Add provenance requirements for:

- Path queries.
- Path results.
- Path exports.
- Hypothesis generation.
- Weak-link assessment.
- Path explanation generation.

## Data Governance and Licensing Agent

Add enforcement for:

- Path-level data access.
- Edge-level license restrictions.
- Redacted paths.
- Federated-only path edges.
- Export restrictions.

## Entity Resolution and Normalization Agent

Add support for:

- Candidate relationship assertions.
- Cross-domain candidate bridge generation.
- Relationship-class classification.
- Evidence-backed path construction.

## Biomedical NLP and AI Curation Agent

Add support for:

- Bridge hypothesis generation.
- Candidate relationship extraction.
- Path explanation drafting.
- Contradiction detection.
- AI risk flags.
- Model-suggested path objects.

## Search and Retrieval Agent

Add support for:

- Relationship path search.
- Graph neighborhood expansion.
- Relationship-class filters.
- Path explanations.
- Weak-link search facets.
- Bridge result ranking.

## Semantic Store Backend Agent

Add support for:

- Relationship assertion graphs.
- Path query indexes.
- Release-specific relationship graphs.
- Hypothesis staging graphs.
- Blocked relationship graphs.

## Workflow and Governance Backend Agent

Add workflows for:

- Relationship assertion review.
- Path review task creation.
- Bridge hypothesis review.
- Converting accepted hypotheses into relationship proposals.
- Escalating domain-boundary paths.

## API Agent

Add APIs defined in this addendum.

## UX and Frontend Agents

Add Semantic Bridge UI, path detail pages, path result cards, warning states, compare-path views, and hypothesis workspace.

## Security and Identity Agent

Add path-level and edge-level authorization rules.

## Compliance and Validation Agent

Add release gates for relationship assertions, path exports, causal claims, safety limitations, and model-suggested relationship promotion.

## QA and Test Automation Agent

Add relationship-path test suites.

## Red Team Agent

Add attacks for:

- Spurious path generation.
- Unsupported causal claims.
- FAERS causality mistakes.
- AI hallucinated bridges.
- Restricted evidence leakage.
- Overconfident long paths.
- Hidden weak links.
- Inferred paths shown as facts.

## Observability and SRE Agent

Add metrics for:

- Path query volume.
- Path query latency.
- Zero-path rate.
- Path confidence distribution.
- Weak-link distribution.
- User saves/exports/review-task creation.
- Rejected path reasons.
- AI hypothesis acceptance rate.

## Release Manager Agent

Add release-package sections for:

- New relationship assertions.
- Deprecated relationship assertions.
- Released paths, if any.
- Relationship validation reports.
- Safety/causal review evidence.
- Relationship export artifact hashes.

## Documentation Agent

Add docs for:

- Relationship classes.
- Semantic Bridge user guide.
- Path confidence scoring.
- Weak-link explanation.
- Hypothesis vs fact.
- Safety and causal warnings.
- Relationship APIs.

---

# 14. Implementation phases for this addendum

## Addendum Phase A — Relationship taxonomy and contracts

### Lead agents

- Cross-Domain Relationship Architect.
- Ontology Architect.
- Standards and Mapping Agent.
- Life Sciences Domain Agent.
- Causal and Safety Claims Guardrail Agent.

### Tasks

1. Define relationship classes.
2. Define allowed predicates by relationship class.
3. Define evidence requirements by relationship class.
4. Define review requirements by relationship class.
5. Define causal and safety warning policies.
6. Define RelationshipAssertion schema.
7. Define RelationshipPath schema.
8. Define BridgeHypothesis schema.
9. Add SHACL shape requirements.
10. Red Team relationship taxonomy for ambiguity.

### Exit criteria

- Relationship taxonomy approved.
- JSON contracts approved.
- SHACL requirements documented.
- Safety and causal claim policies approved.
- P0 ambiguity risks resolved.

---

## Addendum Phase B — Relationship assertion backend

### Lead agents

- Relationship Mapping Service owner.
- Semantic Store Backend Agent.
- API Agent.
- Workflow Backend Agent.
- QA Agent.

### Tasks

1. Implement RelationshipAssertion storage.
2. Implement relationship assertion validation.
3. Implement relationship assertion API.
4. Implement review workflow for relationship assertions.
5. Implement audit events.
6. Implement release inclusion.
7. Implement blocked relationship handling.
8. Implement evidence attachment.
9. Add fixtures and tests.
10. Add relationship assertion export.

### Exit criteria

- Relationship assertions can be created, validated, reviewed, approved, rejected, released, deprecated, and exported.
- Model-suggested relationships cannot bypass review.
- Safety relationships require limitation metadata.
- Audit events are emitted.

---

## Addendum Phase C — Pathfinding and confidence

### Lead agents

- Pathfinding and Graph Algorithms Agent.
- Path Confidence and Weak-Link Agent.
- Search and Retrieval Agent.
- Security and Identity Agent.
- Data Governance Agent.

### Tasks

1. Implement PathQuery object.
2. Implement relationship-class filtering.
3. Implement RBAC-aware traversal.
4. Implement license-aware path filtering.
5. Implement path ranking.
6. Implement path confidence scoring.
7. Implement weakest-link detection.
8. Implement path explanation payloads.
9. Add path performance tests.
10. Add path result fixtures.

### Exit criteria

- User can query paths between two entities.
- Unauthorized or restricted paths are filtered or redacted.
- Every path has confidence and weakest link.
- Long speculative paths are not over-ranked.
- Path query latency meets MVP target on fixture graph.

---

## Addendum Phase D — Semantic Bridge UI

### Lead agents

- Semantic Bridge UX Agent.
- Frontend Application Agent.
- API Agent.
- Search and Retrieval Agent.
- QA Agent.

### Tasks

1. Build concept selection UI.
2. Build path filters.
3. Build path result cards.
4. Build path detail page.
5. Build weakest-link panel.
6. Build evidence table.
7. Build compare-path view.
8. Build save/export/review-task actions.
9. Build warning and redaction states.
10. Add E2E tests.

### Exit criteria

- User can ask how two concepts are connected.
- User can inspect path evidence and confidence.
- User can see warnings.
- User can create review task from a path.
- UI distinguishes released, inferred, model-suggested, and hypothesis paths.

---

## Addendum Phase E — Bridge hypotheses and AI support

### Lead agents

- Biomedical NLP and AI Curation Agent.
- Bridge Hypothesis Service owner.
- Relationship Evidence Reviewer Agent.
- Causal and Safety Claims Guardrail Agent.
- Workflow Backend Agent.
- Red Team Agent.

### Tasks

1. Generate candidate bridge hypotheses from selected domains.
2. Generate evidence-backed path summaries.
3. Route AI-generated hypotheses to review.
4. Capture accept/reject feedback.
5. Convert accepted hypotheses to relationship proposals.
6. Add hallucination and unsupported-claim tests.
7. Add contradiction detection where feasible.
8. Add model/version metadata.
9. Add hypothesis workspace.
10. Add AI explanation review.

### Exit criteria

- AI can suggest bridge hypotheses.
- AI hypotheses are clearly labeled.
- AI hypotheses cannot be released as facts.
- Human feedback is captured.
- Red Team has no unresolved P0 safety findings.

---

## Addendum Phase F — Release, audit, observability, and pilot

### Lead agents

- Release Manager Agent.
- Compliance and Validation Agent.
- Observability Agent.
- Customer Pilot Agent.
- Documentation Agent.

### Tasks

1. Add relationship assertions to release package.
2. Add relationship validation reports.
3. Add path export audit events.
4. Add path query and review metrics.
5. Add relationship-path documentation.
6. Add pilot workflow for Semantic Bridge.
7. Add user training.
8. Run release and rollback drill.
9. Run safety and causal review.
10. Run pilot KPI dashboard.

### Exit criteria

- Relationship assertions are included in governed releases.
- Path exports are audited.
- Metrics are visible.
- Documentation is complete.
- Pilot users can test Semantic Bridge.
- No P0 release blockers remain.

---

# 15. MVP scope for this addendum

Do include in MVP/P1:

- RelationshipAssertion object.
- RelationshipPath object.
- Relationship classes.
- Evidence-backed pathfinding.
- Released-only and reviewable-candidate filters.
- Path confidence and weakest-link scoring.
- Semantic Bridge UI.
- Review task creation from path.
- AI-suggested bridge hypotheses with strict labeling.
- Safety and causal warning policies.
- Path API and export.

Do not include in MVP:

- Fully autonomous causal discovery.
- Omics/image/multimodal path mining beyond available structured/text sources.
- Automated scientific conclusion generation.
- Broad unrestricted path search across all enterprise data.
- Predictive modeling claims.
- Patient-level causal inference.
- Unreviewed safety signal conclusions.
- Deep commercial-dashboard analytics.

---

# 16. Acceptance test scenarios

## Scenario 1 — Identity versus relationship distinction

### Flow

1. User searches for HER1.
2. System maps HER1 to EGFR as identity/synonym.
3. User searches for EGFR to NSCLC.
4. System returns target-disease relationship, not identity.

### Pass criteria

- HER1 → EGFR is represented as identity/synonym.
- EGFR → NSCLC is represented as biological/clinical relationship.
- UI labels the two differently.
- API returns different relationship classes.
- No “same as” misuse occurs.

---

## Scenario 2 — Compound to disease bridge

### Flow

1. User asks for paths between Compound X and Disease Y.
2. System finds Compound X → Target A → Disease Y.
3. System ranks path medium confidence.
4. User opens evidence and weakest-link panel.

### Pass criteria

- Path shows edge evidence.
- Path shows confidence.
- Weakest link is identified.
- Path status is released, inferred, or reviewable candidate.
- User can create review task.

---

## Scenario 3 — Safety path with non-causal warning

### Flow

1. User asks how Product A is connected to Adverse Event B.
2. System returns product-event context from safety data.
3. UI displays safety limitation warning.

### Pass criteria

- System does not claim causality from spontaneous-report evidence.
- Evidence type is visible.
- Limitation metadata is visible.
- Safety reviewer is required for release.
- Export includes warning.

---

## Scenario 4 — AI-suggested hypothesis

### Flow

1. AI suggests Biomarker M may connect to response in Disease Z.
2. Hypothesis appears in Semantic Bridge.
3. User opens evidence.
4. Reviewer rejects the hypothesis.

### Pass criteria

- Hypothesis is labeled model_suggested.
- It is not released as fact.
- Model version and evidence spans are visible.
- Rejection is audited.
- Feedback is captured.

---

## Scenario 5 — Restricted evidence path

### Flow

1. User queries a path that includes licensed commercial data.
2. User lacks permission for that source.
3. System returns redacted or blocked path according to policy.

### Pass criteria

- Restricted edge details are not exposed.
- Explanation does not leak source text or sensitive metadata.
- Export is blocked or redacted.
- Audit event is recorded.

---

## Scenario 6 — Overconfident long path prevention

### Flow

1. System finds a five-edge path with one broadMatch edge and one AI-suggested edge.
2. Path confidence is calculated.

### Pass criteria

- Path is not high confidence.
- Weakest link identifies broadMatch or AI-suggested edge.
- Warning explains interpretability risk.
- Path ranking favors stronger shorter paths where available.

---

## Scenario 7 — Release validation failure

### Flow

1. Release candidate includes a relationship assertion with no evidence.
2. Validation runs.
3. Release promotion is attempted.

### Pass criteria

- Release is blocked.
- Validation report identifies missing evidence.
- Audit log records failed promotion attempt.
- Responsible reviewer receives task.

---

# 17. Sales and positioning update

Update the product positioning in the original prompt to include this capability.

## New positioning pillar

```text
Explainable cross-domain relationship mapping
```

## Sales message

```text
PharmaOps does not just normalize terms. It reveals governed, evidence-backed relationship paths across R&D, clinical, safety, regulatory, commercial, and operational data — so teams and AI systems can reason across domains without inventing unsupported connections.
```

## Short tagline options

```text
Connect the evidence your teams could never reliably connect before.
Map hard-to-relate pharma data into governed relationship paths.
Turn fragmented pharma data into explainable scientific bridges.
The semantic bridge for pharma AI and analytics.
```

## Buyer-specific value

| Buyer | Value message |
|---|---|
| Discovery / translational science | Connect compounds, targets, diseases, biomarkers, trials, and literature evidence. |
| Clinical operations | Connect protocol language, eligibility criteria, endpoints, cohorts, and trial evidence. |
| Safety / pharmacovigilance | Connect product-event context across safety reports, trials, literature, labels, and coding systems without overstating causality. |
| Regulatory affairs | Connect controlled terminology, submissions, labels, products, indications, and downstream systems with release control. |
| Data science / AI | Give AI agents governed relationship paths, stable IDs, confidence, provenance, and release context. |
| Enterprise platform teams | Provide a reusable semantic bridge across data silos and downstream systems. |

## Differentiation

Against ontology editors:

```text
Ontology editors manage terms. PharmaOps explains relationship paths across pharma domains and governs them through release control.
```

Against generic knowledge graphs:

```text
Generic graphs connect data. PharmaOps connects pharma concepts with evidence, confidence, provenance, review, and compliance workflows.
```

Against AI search:

```text
AI search retrieves documents. PharmaOps gives AI a governed relationship layer with approved entities, evidence-backed paths, and human-reviewed semantics.
```

---

# 18. New KPIs

Add these KPIs to the original PharmaOps KPI framework.

## Relationship quality KPIs

- Percentage of relationship assertions with evidence.
- Percentage of relationship assertions with source-version provenance.
- Percentage of paths with weakest-link explanation.
- Percentage of released paths with all edges reviewed.
- Ratio of blocked/rejected relationships to approved relationships.
- Confidence calibration for path scores.
- Contradictory evidence detection rate.

## User workflow KPIs

- Semantic Bridge query volume.
- Zero-path query rate.
- Path save rate.
- Path export rate.
- Review tasks created from paths.
- Median time from path discovery to review decision.
- User-rated path usefulness.
- Compare-path usage.

## Business impact KPIs

- Time to answer cross-domain questions.
- Reduction in manual relationship investigation effort.
- Number of downstream AI or analytics systems using relationship paths.
- Number of cross-domain hypotheses accepted for investigation.
- Reduction in duplicate or conflicting relationship interpretations.
- Improvement in audit readiness for semantic relationship changes.

---

# 19. Global instruction to all agents

Add the following instruction to the global rules of the original prompt:

```text
When building any feature that connects concepts across domains, do not create opaque or arbitrary graph links. Every connection must be represented as a governed relationship assertion with relationship class, evidence, provenance, confidence, assertion type, review status, data license status, and release context. Every multi-hop relationship path must include path confidence, weakest-link explanation, access-control filtering, and warnings when the path includes inferred, model-suggested, restricted, safety-sensitive, causal, or hypothesis-level content.
```

---

# 20. Final addendum definition of done

This addendum is complete when PharmaOps can demonstrate the following end-to-end flow:

```text
User selects two hard-to-relate concepts
→ system finds candidate relationship paths
→ system filters paths by permissions and release context
→ system ranks paths by confidence and evidence quality
→ system explains each path in plain language
→ system identifies weakest link and warnings
→ user inspects evidence and provenance
→ user creates a review task or saves/exports path
→ reviewer approves, rejects, or escalates relationship assertions
→ approved relationships enter a governed release
→ released paths become available through UI, API, and export
→ every action is audited
```

The winning version of PharmaOps is not the system that creates the most connections. It is the system that helps users understand:

```text
Which connections are real.
Which connections are inferred.
Which connections are AI-suggested.
Which connections are speculative.
Which connections are unsupported.
Why each connection should be trusted, reviewed, or rejected.
```
