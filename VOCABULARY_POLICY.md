# VOCABULARY_POLICY.md

Task:
Define PharmaOps namespace, CURIE/IRI, preferred identifier, mapping predicate, mapping object, confidence, version-pinning, import/export, and vocabulary-risk policy for Phase 0 task P0-04.

Assumptions:
- This policy is the Phase 0 governance contract for later implementation in the namespace library and mapping registry.
- PharmaOps uses open semantic standards at the core: stable IRIs, CURIEs, RDF/OWL/SHACL-compatible predicates, and PROV-style provenance.
- Licensed vocabularies such as MedDRA and SNOMED CT may be referenced only where the customer has appropriate rights and data governance approval.
- Internal identifiers are allowed when no durable public identifier exists, but they must remain stable, resolvable inside the tenant, and traceable to provenance.

Inputs Reviewed:
- `pharmaops_multi_agent_exportable_prompt.md` section 6.1, Required output structure.
- `pharmaops_multi_agent_exportable_prompt.md` section 6.2, Merge rule.
- `pharmaops_multi_agent_exportable_prompt.md` section 6.3, Blocking failure conditions.
- `pharmaops_multi_agent_exportable_prompt.md` Agent 6, Standards and Mapping Agent.
- `pharmaops_multi_agent_exportable_prompt.md` section 10.2, Mapping registry.
- `pharmaops_multi_agent_exportable_prompt.md` section 11.2, Agent handoff packet.
- `hive/tasks.json` task P0-04.

Changes Proposed:
- Establish canonical namespace and CURIE rules.
- Define preferred external identifiers per MVP entity class.
- Define the ten required mapping predicates and their review semantics.
- Define the required mapping object contract.
- Define vocabulary source-version pinning rules.
- Flag licensing and vocabulary-use risks for controlled biomedical vocabularies.

Artifacts Created or Modified:
- Created `VOCABULARY_POLICY.md`.

Interfaces Affected:
- Future namespace registry and CURIE helper library.
- Mapping registry schema, CRUD, review workflow, diff, export, and release inclusion.
- Connector output contracts that emit external identifiers or candidate mappings.
- API filters and exports for mappings by source, target, predicate, vocabulary, version, status, and release.
- SHACL validation rules for mapping completeness and release eligibility.
- Audit events for mapping lifecycle changes.

## 1. Namespace Policy

### 1.1 Namespace Goals

PharmaOps namespaces must make semantic assets stable, explainable, version-aware, and exportable. Every governed entity, vocabulary term, mapping, assertion, evidence object, source record, release, and workflow action needs an identifier that can be traced to provenance and release context.

Namespace decisions must preserve:
- Stability across releases.
- Tenant isolation.
- Reproducible exports.
- Clear separation between public vocabulary identifiers and PharmaOps-governed internal identifiers.
- Compatibility with RDF, OWL, SHACL, SPARQL, and CURIE-based APIs.

### 1.2 Reserved Prefixes

| Prefix | Purpose | Example |
|---|---|---|
| `pharm:` | PharmaOps core ontology terms | `pharm:Mapping` |
| `pharmrel:` | PharmaOps relationship and mapping predicates | `pharmrel:exactMatch` |
| `pharment:` | Tenant-scoped governed entity IRIs | `pharment:compound/12345` |
| `pharmmap:` | Governed mapping objects | `pharmmap:map-2026-000001` |
| `pharmev:` | Evidence records and source spans | `pharmev:evidence-2026-000001` |
| `pharmsrc:` | Source system and source record identifiers | `pharmsrc:chembl/34/compound/CHEMBL25` |
| `pharmrelset:` | Immutable semantic release identifiers | `pharmrelset:2026.0.0-rc.1` |
| `pharmwf:` | Workflow tasks, approvals, and audit-linked actions | `pharmwf:review-task-000001` |
| `chembl:` | ChEMBL identifiers | `chembl:CHEMBL25` |
| `pubchem:` | PubChem compound identifiers | `pubchem:CID2244` |
| `uniprot:` | UniProt accessions | `uniprot:P00533` |
| `mesh:` | MeSH descriptors | `mesh:D012345` |
| `mondo:` | MONDO disease terms | `mondo:0004975` |
| `snomed:` | SNOMED CT concepts, licensed use only | `snomed:44054006` |
| `rxnorm:` | RxNorm clinical drug concepts | `rxnorm:1191` |
| `meddra:` | MedDRA terms, licensed use only | `meddra:10002034` |
| `cdisc:` | CDISC controlled terminology and codelists | `cdisc:C66731` |
| `nct:` | ClinicalTrials.gov records | `nct:NCT00000102` |
| `pmid:` | PubMed identifiers | `pmid:12345678` |
| `pmcid:` | PubMed Central identifiers | `pmcid:PMC1234567` |
| `doi:` | Digital Object Identifiers | `doi:10.1000/example` |

Prefix ownership must be documented in the namespace registry before implementation. New prefixes require Standards and Ontology review, plus Data Governance review when license or redistribution rights are unclear.

### 1.3 IRI Rules

- IRIs must be absolute, stable, and deterministic.
- Internal PharmaOps IRIs must never encode mutable labels, display names, lifecycle state, review status, or release status.
- Tenant-local entity IRIs must include a tenant-safe namespace boundary in storage and API resolution, even if export aliases omit tenant internals.
- Released IRIs must remain resolvable after deprecation or supersession.
- Deleted public-facing identifiers are not reused. Retired internal identifiers remain tombstoned with audit and provenance.
- Source-record IRIs must include source system and source version or release.
- Mapping IRIs must identify the mapping object, not only the source-target pair, because multiple predicates, evidence sets, or review states may exist over time.

### 1.4 CURIE Rules

- CURIEs are compact API and export aliases for full IRIs.
- CURIE prefixes are case-sensitive and must match the namespace registry.
- CURIE local IDs must preserve the source system's canonical casing where the source treats casing as meaningful.
- CURIEs must round-trip to full IRIs without loss.
- APIs may accept CURIEs, but stored governed records must retain canonical IRI or stable internal ID plus the resolved namespace version.
- Unknown prefixes, ambiguous aliases, or unmapped local IDs must fail validation before release.
- CURIE display is allowed in UI, but review screens must show source vocabulary, vocabulary version, evidence, and release context.

## 2. Preferred Identifier Policy

Preferred identifiers are selected for durability, domain fit, source authority, and practical connector availability. Alternative identifiers are stored as xrefs or mappings, not as replacements for canonical governed identity.

| Entity class | Preferred identifiers | Allowed secondary identifiers | Notes |
|---|---|---|---|
| Compound | ChEMBL ID | PubChem CID, InChIKey, internal compound ID | Use ChEMBL for public bioactivity context. Use internal ID for proprietary compounds. |
| Protein or target | UniProt accession | Gene symbol, Ensembl ID, internal target ID | Gene symbols are aliases, not stable canonical IDs. |
| Gene | Ensembl ID where in scope | HGNC symbol, NCBI Gene ID | Gene symbols require version-aware synonym handling. |
| Disease or condition | MeSH or MONDO | SNOMED CT where licensed, source-specific disease code | Prefer open identifiers for broad interoperability. |
| Drug or clinical product | RxNorm concept ID where appropriate | ChEMBL, product code, internal product ID | Product-specific identifiers are required for proprietary assets or formulation-specific records. |
| Adverse event | MedDRA term where licensed | Source verbatim term, internal event code | MedDRA materialization/export requires license approval. |
| Clinical submission term | CDISC controlled terminology and codelist code | Internal submission term ID | Preserve codelist version and submission context. |
| Clinical trial | NCT ID | Sponsor protocol ID, EudraCT ID where available | NCT is preferred for ClinicalTrials.gov records. |
| Publication | PMID, PMCID, DOI | Source document ID | Preserve all available publication IDs as xrefs. |
| Source document or evidence | PharmaOps evidence ID | Source file ID, URL, API record ID | Evidence IDs must resolve to source, version, retrieval time, and access controls. |

## 3. Mapping Predicate Policy

Mappings are first-class governed assets. A mapping is not a lookup row; it has identity, predicate, source and target vocabulary versions, confidence, evidence, reviewer state, provenance, release membership, and audit history.

### 3.1 Required Mapping Predicates

| Predicate | Meaning | Release behavior |
|---|---|---|
| `exactMatch` | Source and target represent the same concept for the scoped use case. | May release after evidence and review pass. |
| `closeMatch` | Concepts are sufficiently similar for the scoped use case but not identical. | May release with rationale and scope note. |
| `broadMatch` | Source concept is broader than the target concept. | May release only when direction is explicit in UI/API. |
| `narrowMatch` | Source concept is narrower than the target concept. | May release only when direction is explicit in UI/API. |
| `relatedMatch` | Concepts are related but not substitutable. | Must not be used for normalization equivalence. |
| `replacedBy` | Source identifier or term is deprecated and superseded by target. | Requires deprecation provenance and effective date where available. |
| `hasDbXref` | Source has a database cross-reference to target without asserted equivalence. | Must not imply semantic equivalence. |
| `notMatch` | Source and target were reviewed and found not equivalent. | Used to suppress repeated false-positive candidates. |
| `uncertainMatch` | Candidate relation has insufficient evidence or confidence. | Must remain provisional; not eligible as approved fact. |
| `requiresReview` | Candidate must be reviewed by a human or approved policy route. | Blocks release until resolved. |

### 3.2 Predicate Guardrails

- `exactMatch` is the only predicate that may support automatic canonical merge behavior, and only after review, provenance, and SHACL validation pass.
- `closeMatch`, `broadMatch`, `narrowMatch`, and `relatedMatch` must not be silently treated as equivalence by APIs, search ranking, exports, or downstream connectors.
- `hasDbXref` records source cross-reference evidence but does not assert semantic sameness.
- `notMatch` must include evidence or review rationale so future candidate generation can learn from the rejection.
- `uncertainMatch` and `requiresReview` are provisional and must never appear as approved released facts.

## 4. Mapping Object Contract

Every mapping object must contain all fields below before it can enter the governed mapping registry.

```json
{
  "mapping_id": "string",
  "source_entity_id": "string",
  "target_entity_id": "string",
  "predicate": "exactMatch | closeMatch | broadMatch | narrowMatch | relatedMatch | replacedBy | hasDbXref | notMatch | uncertainMatch | requiresReview",
  "source_vocabulary": "string",
  "source_vocabulary_version": "string",
  "target_vocabulary": "string",
  "target_vocabulary_version": "string",
  "source_license_classification": "open_materializable | open_with_attribution | licensed_federated | licensed_materializable_with_restrictions | internal_confidential | contains_phi_or_pii | blocked_pending_legal_review",
  "source_license_policy_id": "string",
  "target_license_classification": "open_materializable | open_with_attribution | licensed_federated | licensed_materializable_with_restrictions | internal_confidential | contains_phi_or_pii | blocked_pending_legal_review",
  "target_license_policy_id": "string",
  "data_sensitivity": "public | restricted_public | licensed | internal_confidential | phi_pii | unknown",
  "materialization_policy": "materialize | federate | stream | redact_then_materialize | block",
  "permitted_uses": ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
  "export_restrictions": ["string"],
  "disclaimer_ids": ["string"],
  "legal_approval_id": "string_or_null",
  "retention_class": "string",
  "license_status": "valid | restricted | blocked | pending_review | not_required",
  "confidence_score": "number",
  "confidence_band": "high | medium | low | blocked",
  "evidence_ids": ["string"],
  "created_by": "user_or_service",
  "reviewed_by": "user_or_null",
  "review_status": "draft | proposed | approved | rejected | deprecated | released",
  "release_id": "string_or_null",
  "provenance": {}
}
```

### 4.1 Field Rules

- `mapping_id` must be globally stable inside the tenant and must not change when review status changes.
- `source_entity_id` and `target_entity_id` must be CURIEs or internal IDs resolvable through the namespace registry.
- `predicate` must be one of the ten required predicates.
- `source_vocabulary_version` and `target_vocabulary_version` are mandatory. Missing values are blocking release failures.
- `source_license_classification` and `target_license_classification` must use the Data Governance source classifications: `open_materializable`, `open_with_attribution`, `licensed_federated`, `licensed_materializable_with_restrictions`, `internal_confidential`, `contains_phi_or_pii`, or `blocked_pending_legal_review`.
- `source_license_policy_id` and `target_license_policy_id` must reference current entries in `DATA_LICENSE_REGISTER.md` or its implemented registry table. The references are required even for open vocabularies so validation can prove that the license posture was checked.
- `data_sensitivity`, `materialization_policy`, `permitted_uses`, `export_restrictions`, `disclaimer_ids`, `legal_approval_id`, and `retention_class` must mirror the controlling Data License Register policy for the source and target vocabularies or data sources that participate in the mapping.
- `license_status` must summarize whether the mapping is currently usable under the source and target license constraints. `blocked` and `pending_review` are not release eligible.
- `confidence_score` must be numeric from `0.0` to `1.0`.
- `confidence_band` must be derived from configured thresholds or set to `blocked` when evidence, license, or policy prevents use.
- `evidence_ids` must reference evidence objects with source, source version, retrieval time, and access controls.
- `created_by` must identify a human user, service account, connector job, or AI suggestion workflow.
- `reviewed_by` must be non-null before `review_status` can become `approved`, except for a documented policy-approved route.
- `review_status` controls workflow state and release eligibility.
- `release_id` is null until included in an immutable semantic release.
- `provenance` must include source record references, generation method, timestamps, and audit correlation IDs.

### 4.2 Review Status Rules

| Status | Meaning | Release eligible |
|---|---|---|
| `draft` | Work-in-progress mapping not submitted for review. | No |
| `proposed` | Candidate mapping submitted by connector, AI, or user. | No |
| `approved` | Reviewed and approved for release candidate inclusion. | Yes, if validation passes |
| `rejected` | Reviewed and rejected. | No |
| `deprecated` | Previously valid mapping superseded or no longer recommended. | No for new releases, retained for history |
| `released` | Included in immutable release artifact. | Already released; future changes require new mapping version or successor |

## 5. Confidence Policy

| Band | Score range | Required treatment |
|---|---|---|
| `high` | `>= 0.90` | May be prioritized for review but still requires evidence and eligible review route. |
| `medium` | `>= 0.70` and `< 0.90` | Requires curator review before approval. |
| `low` | `> 0.0` and `< 0.70` | Review queue only; cannot be auto-approved. |
| `blocked` | Any score | Must not be approved until the blocking policy, evidence, or license issue is resolved. |

Confidence is decision support, not approval. High confidence does not bypass provenance, RBAC, audit, validation, or release gates.

## 6. Vocabulary Version-Pinning Rules

- Every mapping must store both source and target vocabulary versions.
- Every mapping must store source and target license classifications and source and target license policy references.
- Public connector outputs must include source version or release for imported source records.
- A mapping candidate generated from source data must record the source data version, vocabulary version, retrieval timestamp, connector version, and normalization method where applicable.
- Version labels must come from the source authority when available. If a source lacks explicit versions, PharmaOps must capture retrieval timestamp, source endpoint, checksum or artifact hash, and connector version.
- Release candidates must include a manifest of vocabulary versions and source versions.
- Mappings must be revalidated when source or target vocabulary versions change.
- Deprecated or replaced vocabulary identifiers must create `replacedBy`, `deprecated`, or review tasks rather than mutating released mappings in place.
- SHACL and release validation must block any mapping missing `source_vocabulary_version` or `target_vocabulary_version`.
- SHACL and release validation must block any mapping missing source or target license classification, source or target license policy reference, required governance fields from the Data License Register, or a valid `license_status`.

## 7. Licensing and Vocabulary-Use Risk Flags

### 7.1 Controlled Vocabulary Risk Matrix

| Vocabulary | Risk | Required control |
|---|---|---|
| MedDRA | Licensed terminology; redistribution and display restrictions may apply. | Require license verification before materialization, export, or customer display. |
| SNOMED CT | Jurisdiction and affiliate licensing constraints may apply. | Require tenant-level license status and jurisdiction policy before use. |
| CDISC controlled terminology | Publicly accessible but submission context and versioning matter. | Pin codelist versions and preserve submission context. |
| RxNorm | Public US clinical terminology but may not cover proprietary product semantics. | Use only where clinical drug concept fit is appropriate. |
| ChEMBL | Public biomedical source, versioned releases required. | Pin release and preserve source record provenance. |
| PubChem | Public source, record updates possible. | Capture retrieval time and source record metadata. |
| UniProt | Public source with reviewed/unreviewed records and releases. | Capture UniProt release and reviewed status. |
| MeSH | Public vocabulary with annual updates. | Pin annual version when used in release artifacts. |
| MONDO | Open disease ontology with release versions. | Pin release version and revalidate changed mappings. |

### 7.2 License Guardrails

- Licensed vocabularies must not be materialized, exported, or displayed beyond licensed terms.
- A mapping can reference a restricted vocabulary identifier only if the source and target license-register entries permit that use for the tenant and workflow.
- A mapping touching licensed vocabularies such as MedDRA or SNOMED CT without valid source and target license status is a release blocker.
- `confidence_band` must be `blocked` when licensing status prevents use, even if semantic confidence is high.
- Exports must preserve release ID, provenance, vocabulary version, and licensing flags.
- Connectors and imports must reject data sources with unknown licensing status when materialization or redistribution is requested.

## 8. Import and Export Policy

### 8.1 Mapping Import

Imported mapping files must include:
- Mapping object fields from section 4.
- Source file or API provenance.
- Import job ID and actor.
- Source and target vocabulary versions.
- Evidence references or source record links.
- Source and target license classifications.
- Source and target license policy references.
- Data sensitivity, materialization policy, permitted uses, export restrictions, disclaimers, legal approval, and retention class when source or target data has license, privacy, or disclaimer constraints.
- License status for the mapping.

Imports must validate before registry write. Invalid records enter a rejected import report, not the governed registry.

### 8.2 Mapping Export

Mapping exports must include:
- Stable mapping IDs.
- Source and target IDs.
- Predicate and predicate semantics.
- Source and target vocabulary versions.
- Confidence score and band.
- Evidence IDs and provenance references.
- Review status.
- Release ID.
- Source and target license classifications.
- Source and target license policy references.
- Data sensitivity, materialization policy, permitted uses, export restrictions, disclaimer IDs, legal approval ID, and retention class where applicable.
- License status and export restrictions.

Exports must not include unreleased provisional mappings unless the API request explicitly asks for working-state data and the caller has RBAC permission.

## 9. Validation and Audit Requirements

### 9.1 Release Blocking Conditions

Release promotion must be blocked when:
- A mapping lacks source vocabulary version.
- A mapping lacks target vocabulary version.
- A mapping lacks source or target license classification.
- A mapping lacks source or target license policy reference.
- A mapping omits required Data License Register governance fields for licensed, restricted, confidential, PHI/PII, or disclaimer-bound source or target data.
- A mapping has `license_status` of `blocked` or `pending_review`.
- A mapping lacks evidence.
- A mapping lacks provenance.
- A mapping has `review_status` of `draft`, `proposed`, `rejected`, or `deprecated`.
- A mapping has `predicate` of `uncertainMatch` or `requiresReview`.
- A licensed source is materialized or exported without approval.
- A mapping touches MedDRA, SNOMED CT, or another licensed vocabulary without valid license status.
- A release candidate lacks vocabulary version pins, source version pins, validation evidence, approval trace, artifact hashes, or rollback target.

### 9.2 Audit Events

Audit events are required for:
- Mapping creation.
- Mapping update.
- Predicate change.
- Confidence change.
- Evidence change.
- Review submission.
- Approval.
- Rejection.
- Deprecation.
- Release inclusion.
- Export.
- Import.
- License override or block.

Each audit event must include actor, timestamp, tenant, mapping ID, previous state where applicable, new state, evidence or rationale, and correlation ID.

## 10. Open Questions for Reviewers

- Should PharmaOps reserve separate prefixes for each tenant in exported RDF, or keep tenant boundaries in access-controlled metadata only?
- Should confidence thresholds be globally fixed in Phase 1, or configurable per tenant and mapping type with validation evidence?
- Which licensed vocabulary uses are allowed in the first pilot: MedDRA display only, MedDRA identifier reference only, SNOMED CT reference only, or none until license register is complete?
- Should DOI CURIE local IDs preserve raw DOI casing, or normalize to lowercase for lookup while preserving original display?

Tests Added or Required:
- Add namespace registry validation tests for prefix uniqueness and CURIE round-tripping.
- Add mapping schema validation tests requiring all contract fields.
- Add SHACL tests blocking missing source or target vocabulary versions.
- Add SHACL tests blocking missing license classifications, missing license policy references, missing Data License Register governance fields, and blocked or pending license status.
- Add workflow tests preventing provisional mappings from release.
- Add export tests preserving release ID, vocabulary versions, evidence IDs, and provenance.
- Add license-policy tests blocking unauthorized MedDRA and SNOMED CT materialization/export.

Security Impact:
- Mapping and vocabulary APIs must enforce RBAC for working-state mappings, licensed vocabulary fields, imports, exports, approvals, and release inclusion.
- Tenant isolation must apply to internal IRIs, evidence records, source records, and audit trails.
- Unauthorized users must not mutate governed mappings or view restricted source evidence.

Compliance Impact:
- The policy supports regulated release gates by requiring evidence, reviewer state, audit events, immutable release membership, and vocabulary/source version pins.
- Missing source or target vocabulary version, license classification, license policy reference, required governance fields, or valid license status is explicitly a release-blocking failure.
- Licensed vocabulary handling is flagged as a controlled governance risk.

Data and Provenance Impact:
- Every mapping preserves source and target vocabulary versions, source and target license classifications, source and target license policy references, evidence IDs, provenance, review state, and release ID.
- Source records, connector jobs, imports, exports, and release artifacts must be traceable through stable identifiers.
- Deprecated mappings remain traceable and must not be overwritten in place.

Risks:
- MedDRA and SNOMED CT licensing constraints may limit MVP data display, export, or materialization until the license register is complete.
- Mapping predicate misuse could cause false equivalence if downstream APIs treat `closeMatch`, `hasDbXref`, or `relatedMatch` as `exactMatch`.
- Source vocabularies without explicit version labels need stronger artifact hashing and retrieval metadata to remain reproducible.
- Tenant-specific internal identifiers may complicate cross-tenant export if namespace rules are not implemented consistently.

Open Questions:
- Confirm licensed vocabulary posture for MedDRA and SNOMED CT in the first pilot.
- Confirm whether initial mapping object validation should be JSON Schema, SHACL, or both.
- Confirm exact namespace base URLs before implementation.

Handoff To:
- Ontology Architect: align entity classes, predicates, SHACL shapes, and namespace registry with this policy.
- API Agent: expose mapping filters by entity, vocabulary, predicate, version, status, and release.
- Workflow Backend Agent: enforce review status transitions, approvals, and release eligibility.
- QA Agent: create schema, SHACL, workflow, export, and license-policy tests.
- Red Team: review predicate misuse, licensing leakage, provenance gaps, and release-blocking controls.
- God: update P0-04 status and route reviewer feedback.

Definition of Done Status:
- Draft complete for Phase 0 review.
- Acceptance criteria covered: preferred IDs per entity class, ten mapping predicates, required mapping object fields, vocabulary version-pinning rules, enforceable license status/policy fields, and MedDRA/SNOMED licensing risk flags.
- Not yet final until Ontology, Red Team, and god review pass with no unresolved P0 finding.

## 11. Agent Handoff Packet

```yaml
handoff_from: angela-mqvn21zm
handoff_to: god
ticket_id: P0-04
summary: "Created VOCABULARY_POLICY.md covering namespaces, CURIE/IRI rules, preferred identifiers, required mapping predicates, required mapping object fields, enforceable license classification/status fields, confidence bands, version pinning, import/export, validation, audit, and licensing risk flags."
artifacts_changed:
  - "C:\\Projects\\Project10\\VOCABULARY_POLICY.md"
contracts_changed:
  - "Namespace prefix registry contract proposed."
  - "Mapping object contract defined with required fields."
  - "Mapping object contract now requires source/target license classifications, source/target license policy references, Data License Register governance fields, and license status."
  - "Mapping predicate vocabulary fixed to ten required predicates."
  - "Version-pinning and release-blocking rules defined."
assumptions:
  - "Namespace base URLs will be finalized during implementation."
  - "Licensed vocabulary use depends on a future DATA_LICENSE_REGISTER.md."
test_results:
  - "No automated tests run; Phase 0 governance document only."
known_limitations:
  - "No JSON Schema or SHACL file generated yet."
  - "Exact tenant export namespace strategy remains open."
risks:
  - "MedDRA/SNOMED licensing can block materialization or export."
  - "Downstream services must not treat non-exact predicates as equivalence."
required_next_action:
  - "Review by Kevin/Ontology, Creed/Red Team, and god."
blocking_questions:
  - "Confirm first-pilot posture for MedDRA and SNOMED CT usage."
```
