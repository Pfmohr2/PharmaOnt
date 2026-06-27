# DATA_LICENSE_REGISTER.md

Task:
Define the PharmaOps Phase 0 data governance and licensing register covering source access rules, materialization/federation decisions, PII/PHI handling, retention, customer data boundaries, and source-specific disclaimer propagation.

Assumptions:
- PharmaOps must classify every data source before ingestion, indexing, AI use, export, or release inclusion.
- Public-source availability does not remove attribution, source-version, provenance, disclaimer, or downstream-use obligations.
- Licensed commercial vocabularies and datasets, including MedDRA and SNOMED CT, default to no materialization until tenant-level rights and explicit data-governance approval are recorded.
- Internal customer data is tenant-confidential by default and may contain PII/PHI unless proven otherwise by source onboarding.
- PHI/PII must not be sent to AI services unless an approved deployment policy, legal basis, data-processing agreement, and technical controls are in place.
- This Phase 0 artifact defines policy and contract fields; later implementation will enforce them in connectors, workflow, APIs, exports, search, validation, and audit.

Inputs Reviewed:
- `pharmaops_multi_agent_exportable_prompt.md` sections 1.3, 2.1, 3.1, 4.4, 6.1-6.3, 7 Agent 8, 7 Agent 9, 7 Agent 10, 11.4, 15, and 16.
- `VOCABULARY_POLICY.md` mapping object, vocabulary version-pinning, import/export, and MedDRA/SNOMED risk rules.
- `SECURITY_MODEL.md` tenant isolation, license policy authorization dimension, service-account limits, export controls, and audit model.
- `VALIDATION_PLAN.md` release blockers, source-version pins, data-license clearance, retention/legal-hold/export-format evidence, and source disclaimer validation.
- `ARCHITECTURE.md` storage strategy, connector flow, object storage, named graphs, release snapshots, and source-license scoping.
- Hive inbox assignment `2026-06-27T01-11-09-778Z-088c37`.

Changes Proposed:
- Define the seven required source classifications.
- Define a source-license register schema using `license_classification` as the canonical connector field.
- Classify the MVP connector set and assign materialize, federate, stream, redact, or block decisions.
- Define PII/PHI-to-AI restrictions and customer-data-boundary rules.
- Define retention classes for raw artifacts, derived normalized records, evidence, audit, release packages, and rejected/provisional AI suggestions.
- Require source-specific disclaimers and limitations to travel with evidence, search explanations, APIs, exports, and release packages.

Artifacts Created or Modified:
- Created `C:\Projects\Project10\DATA_LICENSE_REGISTER.md`.

Interfaces Affected:
- Connector configuration and universal connector output.
- Source onboarding workflow.
- Mapping registry and evidence object contracts.
- Search indexing and explanation payloads.
- Export service and release package generation.
- AI curation request policy.
- Audit and validation gates.
- Tenant/customer boundary enforcement.

Tests Added or Required:
- Source onboarding validation must reject sources missing `license_classification`, `materialization_policy`, retention class, source-version strategy, sensitivity classification, and disclaimer policy.
- Connector tests must assert license-aware output and required disclaimer propagation.
- Export tests must block restricted data without approval, release ID, provenance, license metadata, and source disclaimers.
- AI policy tests must block PHI/PII and restricted licensed content from unapproved AI services.
- Search tests must prove source limitations appear in explanations and no restricted source leaks through rows, snippets, facets, counts, graph pivots, or exports.
- Retention tests must prove lifecycle policies do not delete release evidence, audit evidence, legal-hold data, or active-release source artifacts.

Security Impact:
- Source license, sensitivity, tenant scope, environment, release, and workflow state are authorization dimensions.
- Internal and restricted sources require tenant-scoped access controls, service-account least privilege, export controls, audit events, and no cross-tenant materialization.
- PHI/PII handling requires deny-by-default AI policy, redaction or de-identification controls, approved private deployment where applicable, and auditability.

Compliance Impact:
- Licensed source materialization without explicit approval blocks release.
- PHI/PII sent to AI services without approved policy blocks release and requires incident review.
- Source-specific disclaimers, especially FAERS/openFDA non-causal warnings, are mandatory evidence metadata and must appear in downstream explanations and exports.
- Raw source artifact retention is governed by retention class and legal hold.

Data and Provenance Impact:
- Every source record, normalized record, evidence object, mapping, search explanation, export row, and release package must preserve source name, source version, retrieval time, raw artifact URI or federation pointer, record hash where materialized, license classification, sensitivity classification, disclaimer IDs, provenance, and release context where applicable.

Risks:
- Public biomedical sources have different terms, attribution expectations, and update behavior; connector implementation must not assume one public-source policy fits all sources.
- PubMed and Europe PMC metadata, abstracts, and full text can have different reuse terms; full text must be governed separately from bibliographic metadata and snippets.
- FAERS data can be misinterpreted as causal or incidence evidence unless warnings travel with every evidence use.
- Internal source templates may hide PHI/PII in free text, notes, document bodies, file names, or metadata.
- Licensed vocabulary identifiers may be usable as references while labels, hierarchy, synonyms, or descriptions remain restricted.

Open Questions:
- What tenant-specific licenses exist for MedDRA, SNOMED CT, licensed journals, commercial real-world datasets, and proprietary vocabularies in the first pilot?
- Which customer retention requirements override the baseline retention classes below?
- Which AI deployment modes are approved for PHI/PII: none, de-identified only, tenant-private model only, or approved vendor with healthcare data terms?
- Should PubMed/Europe PMC full text be out of MVP scope unless an article-level license parser is implemented?

Handoff To:
- Standards and Mapping Agent: add license/data-governance fields to mapping/evidence contracts: `license_classification`, `license_policy_id`, `data_sensitivity`, `disclaimer_ids`, `permitted_uses`, `export_restrictions`, and `legal_approval_id`.
- Connector Architect Agent: use `license_classification` as the canonical connector field and add `materialization_policy`, `sensitivity_classification`, `retention_class`, `disclaimer_ids`, and `ai_use_policy` to connector specs.
- Security and Identity Agent: enforce license policy in authorization, tenant isolation, export, search, audit, and service-account scopes.
- Compliance and Validation Agent: treat missing license classification, unauthorized materialization, missing disclaimers, and unapproved PHI/PII AI use as release blockers.
- QA and Test Automation Agent: create source-license, retention, AI-policy, disclaimer, and export-blocking tests.
- Red Team: review for license bypass, PHI/PII leakage, disclaimer loss, and cross-tenant materialization risk.

Definition of Done Status:
- Draft complete for Phase 0b P0b-10. It includes the seven required source classifications, MVP connector source table, materialize/federate/stream/block decisions and rationales, PII/PHI-to-AI restrictions, retention policy, customer data boundary policy, and source disclaimer propagation requirements.

## 1. Governance Principles

1. Classify before ingesting. No connector, upload, bulk load, stream, or API source may run without license, sensitivity, materialization, retention, and source-version policy.
2. Preserve source context. Every derived assertion, mapping, normalized record, evidence object, search explanation, export, and release package must retain source, source version, retrieval time, license classification, disclaimer IDs, and provenance.
3. Materialize only when allowed. Public and approved data may be materialized; sensitive or licensed data must be federated, streamed, redacted, or blocked unless explicit approval exists.
4. Treat customer data as confidential. Internal source data stays inside the tenant boundary unless an explicit export or processing approval allows otherwise.
5. Keep PHI/PII out of AI by default. AI processing is denied unless policy, contracts, deployment mode, redaction/de-identification, and audit controls approve it.
6. Do not lose disclaimers. Source-specific limitations travel with evidence and appear anywhere the evidence is displayed, searched, exported, or used in release validation.
7. Retain only by policy. Raw artifacts, derived records, release evidence, audit logs, and AI suggestions follow retention classes and legal holds.
8. Fail closed. Unknown license, unknown sensitivity, missing source-version capture, missing retention class, or missing disclaimer policy blocks ingestion and release use.

## 2. Required Source Classifications

`license_classification` is the canonical field name for connector output and source registry records. It must use one of these values:

| Classification | Meaning | Default action |
|---|---|---|
| `open_materializable` | Public source with terms that allow storage and reuse for MVP purposes without special attribution beyond normal citation/provenance | Materialize raw artifacts and derived records with source version, provenance, and disclaimer metadata |
| `open_with_attribution` | Public or open-access source that requires attribution, citation, license display, or source-specific limitations | Materialize only with attribution, source terms, disclaimer IDs, and export/license metadata |
| `licensed_federated` | Licensed source where local storage, redistribution, or export is not approved or is contractually restricted | Federate at query/use time; store only permitted metadata, pointers, and provenance |
| `licensed_materializable_with_restrictions` | Licensed source with explicit approval for bounded materialization under tenant, purpose, retention, display, and export restrictions | Materialize only inside approved tenant/environment with approval ID and restricted export policy |
| `internal_confidential` | Customer or company-internal source not intended for public redistribution and governed by tenant confidentiality | Keep tenant-scoped; materialize or federate per customer policy; block cross-tenant use and public export |
| `contains_phi_or_pii` | Source or field contains, may contain, or derives from identifiable personal or health information | Redact, de-identify, federate, stream, or block by policy; AI use denied by default |
| `blocked_pending_legal_review` | Source has unknown, ambiguous, expired, disputed, or unreviewed legal/privacy status | Block ingestion, materialization, AI use, search indexing, export, and release inclusion |

## 3. Source Register Contract

Every source must have a register record before connector work begins.

```json
{
  "source_id": "string",
  "source_name": "string",
  "source_owner": "string",
  "source_type": "public_api | public_bulk | licensed_api | internal_api | file | stream",
  "license_classification": "open_materializable | open_with_attribution | licensed_federated | licensed_materializable_with_restrictions | internal_confidential | contains_phi_or_pii | blocked_pending_legal_review",
  "materialization_policy": "materialize | federate | stream | redact_then_materialize | block",
  "sensitivity_classification": "public | restricted_public | licensed | internal_confidential | phi_pii | unknown",
  "retention_class": "public_source_snapshot | restricted_source_snapshot | internal_confidential | phi_pii_controlled | release_evidence | blocked_no_retention",
  "source_version_strategy": "version | release | retrieval_timestamp | snapshot_hash | customer_schema_version",
  "raw_artifact_policy": "persist | persist_redacted | pointer_only | no_persist",
  "ai_use_policy": "allowed | allowed_with_attribution | deidentified_only | private_approved_only | prohibited",
  "permitted_uses": ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
  "export_restrictions": ["none"],
  "disclaimer_ids": ["string"],
  "source_terms_uri": "string_or_null",
  "legal_approval_id": "string_or_null",
  "data_governance_approver": "user_or_null",
  "effective_from": "date",
  "review_due": "date",
  "notes": "string"
}
```

Required connector output field alignment:

- Use `license_classification` exactly as the master prompt specifies.
- Connector records must also carry `source_version`, `source_record_id`, `source_record_uri`, `source_retrieved_at`, `raw_artifact_uri`, `record_hash`, `warnings`, and `provenance`.
- If a source is federated or pointer-only, `raw_artifact_uri` may reference an approved pointer object instead of locally stored source content, and `record_hash` must hash the permitted metadata or pointer manifest.

## 4. MVP Connector Source Classification

| Source | Classification | Decision | Rationale | Required controls |
|---|---|---|---|---|
| ClinicalTrials.gov | `open_with_attribution` | Materialize | Public registry data is central to MVP trial semantics and can be stored as source-versioned evidence, but source URL, retrieval time, original labels, and registry context must remain visible | Capture API version or retrieval timestamp, NCT URL, original condition/intervention labels, sponsor, status, endpoints, eligibility snippets, source disclaimer, and update cadence |
| PubMed / Europe PMC | `open_with_attribution` | Materialize metadata and permitted snippets; federate or block full text by article license | Bibliographic metadata and abstracts/snippets are useful evidence, but article-level rights differ and full text may carry separate license constraints | Capture PMID/PMCID/DOI, source metadata, source document ID, text span offsets, evidence snippets, article license when available, attribution, and full-text policy |
| ChEMBL | `open_with_attribution` | Materialize | Versioned public biomedical source for compounds, targets, activities, and mechanisms; materialization supports reproducible normalization and evidence | Pin ChEMBL version, record molecule/target IDs, activity context, source terms URI, attribution, and release manifest inclusion |
| UniProt | `open_with_attribution` | Materialize | Versioned public protein source; materialization supports target normalization and evidence with reviewed/unreviewed status | Pin UniProt release/version, accession, organism, reviewed/unreviewed status, source terms URI, attribution, and release manifest inclusion |
| openFDA FAERS | `open_with_attribution` | Materialize with mandatory warnings | Public pharmacovigilance reports are useful safety context, but they do not prove causation or incidence and may be noisy, duplicated, incomplete, or biased | Preserve FDA/openFDA limitations, source dates, non-causal warning flags, reporting metadata, evidence disclaimers, and block causal/incidence claims without additional evidence |
| Internal source template | `internal_confidential` by default; `contains_phi_or_pii` when applicable | Federate or stream by default; redact-then-materialize only with customer approval; block when sensitivity is unknown | Customer source data can include confidential R&D, regulated documents, proprietary identifiers, free text, PHI/PII, or contractual restrictions | Capture customer source ID, schema version, tenant access controls, confidentiality flags, PHI/PII flags, legal approval ID, retention class, redaction status, and AI use policy |

## 5. Licensed Vocabulary and Commercial Data Policy

Licensed commercial vocabularies and datasets are not covered by public connector defaults.

Default treatment:

- MedDRA: `licensed_federated` until tenant license and approved use are recorded.
- SNOMED CT: `licensed_federated` until tenant license, jurisdiction, affiliate rights, and approved use are recorded.
- Commercial real-world data, claims, EHR, proprietary publications, licensed ontologies, and vendor drug/product datasets: `blocked_pending_legal_review` until a register record proves permitted use.

Allowed use patterns:

| Use pattern | Default decision | Required approval |
|---|---|---|
| Store only an external identifier already present in an approved source | Federate/reference if license permits identifier reference | Data Governance review |
| Store labels, synonyms, hierarchy, definitions, descriptions, or term metadata | Block unless license allows materialization | Legal/Data Governance approval |
| Use in mapping candidate generation | Federate or private approved processing only | Data Governance and Security review |
| Display to users | Block unless display rights are documented | Tenant license approval |
| Export outside tenant | Block unless redistribution/export rights are documented | Legal/Data Governance approval |
| Include in release package | Block unless release packaging is explicitly permitted | Compliance and Release Manager review |

No licensed commercial data may be materialized, indexed, exported, included in a release package, or sent to AI services without explicit approval and a `legal_approval_id`.

## 6. PII/PHI Handling and AI Restrictions

### 6.1 PII/PHI Detection and Classification

Sources must be marked `contains_phi_or_pii` when they include or may include:

- Patient names, initials, contact details, addresses, exact dates tied to individuals, medical record numbers, account numbers, device identifiers, or direct identifiers.
- Free text from clinical, safety, medical, support, or customer systems where direct or indirect identifiers may appear.
- Internal documents, notes, attachments, spreadsheets, emails, or file names that may include identifiable information.
- Trial-site or investigator contact details when the policy treats them as personal data.
- Derived records that remain linkable to individuals or small cohorts.

Unknown sensitivity is treated as `blocked_pending_legal_review` or `contains_phi_or_pii`, whichever is more restrictive for the requested action.

### 6.2 AI Use Policy

PHI/PII must not reach AI services unless all conditions below are satisfied:

1. Approved tenant policy allows the specific AI use case.
2. Legal/privacy review approves the data category, processor, deployment mode, geography, retention, and logging posture.
3. Security approves the AI deployment and service-account scopes.
4. Data is de-identified or redacted unless the approved use explicitly permits identifiable data.
5. The AI provider or deployment is covered by required data-processing terms, including healthcare or regulated-data terms where applicable.
6. Prompt, completion, embedding, trace, telemetry, and error logging are disabled, redacted, or retained only under approved policy.
7. Source record IDs, evidence spans, model version, prompt/policy version, redaction status, actor/service account, timestamp, and audit event are captured.
8. Outputs remain suggestions until governed review and approval.

AI use policy values:

| Value | Meaning |
|---|---|
| `allowed` | Public or approved source can be used with AI under standard platform controls |
| `allowed_with_attribution` | AI may use content only when source attribution and license context are preserved |
| `deidentified_only` | AI may use only de-identified/redacted content with documented transformation |
| `private_approved_only` | AI may use source only in tenant-private or approved dedicated deployment |
| `prohibited` | AI use is blocked |

### 6.3 AI Blocking Rules

Block AI requests when:

- Source classification is `blocked_pending_legal_review`.
- Source classification is `contains_phi_or_pii` and no approved policy exists.
- Source classification is `licensed_federated` and license does not allow AI processing.
- Prompt or embedding would include raw restricted source content, direct identifiers, or unapproved customer confidential data.
- AI service logging or retention cannot be proven compliant with source policy.
- The output would appear as approved fact without review.

## 7. Customer Data Boundary Policy

Customer data means tenant-owned, tenant-provided, tenant-derived, or tenant-licensed content, including internal source records, proprietary identifiers, customer documents, tenant-specific curation decisions, workflow comments, approvals, audit records, and release packages.

Rules:

- Customer data must stay inside the tenant boundary unless export is explicitly authorized.
- Tenant IDs, environment, source license, release context, and confidentiality flags must travel with API calls, search indexing, graph operations, object storage, logs, jobs, AI requests, and exports.
- No customer data may train shared models unless an explicit contract, policy, and opt-in approval exist.
- Cross-tenant joins, embeddings, search indexes, object prefixes, background jobs, logs, analytics, and support exports are prohibited unless covered by audited break-glass or approved aggregate anonymization.
- Internal source artifacts must use tenant-scoped object storage paths or equivalent isolation.
- Internal source-derived search snippets and vector embeddings inherit the source sensitivity and export restrictions.
- Support access requires role authorization, reason, time limit, audit event, and tenant scope.
- Customer-specific release packages must not include unapproved cross-tenant data, unlicensed materialized content, or PHI/PII outside approved policy.

## 8. Retention Policy

Retention class must be assigned before ingestion. Customer or regulatory contracts may require stricter retention than the baseline below.

| Retention class | Applies to | Baseline retention | Deletion/lifecycle rule |
|---|---|---|---|
| `public_source_snapshot` | Public raw source artifacts and parsed records used for reproducible releases | Retain while referenced by active or archived release plus 7 years | Deletion allowed only after no release, audit, validation, or legal hold depends on it |
| `restricted_source_snapshot` | Licensed materialized data with restrictions | Retain only for approved term and purpose | Delete, anonymize, or reduce to pointer when license expires unless legal hold applies |
| `internal_confidential` | Customer internal raw artifacts, documents, normalized records, and evidence | Tenant policy controls; default 7 years for release evidence, shorter for unused staging data | Tenant-approved deletion; release evidence and audit dependencies preserved |
| `phi_pii_controlled` | PHI/PII raw artifacts, redaction originals, and identifiable derived records | Minimum necessary; tenant/legal policy controls; default no persistence unless approved | Prefer pointer-only, redacted persistence, or deletion after processing; legal hold overrides |
| `release_evidence` | Release packages, validation reports, approval records, artifact hashes, source manifests, rollback reports | Minimum 10 years unless tenant policy differs | Immutable retention; no deletion while release/audit/legal hold applies |
| `audit_evidence` | Audit events and audit exports | Minimum 10 years unless tenant policy differs | Append-only; legal hold prevents lifecycle expiration |
| `ai_suggestion_review` | AI suggestions, prompts where retained, redacted inputs, feedback, evaluations | Default 3 years or tenant policy | Must retain enough evidence to audit accepted suggestions included in releases |
| `blocked_no_retention` | Sources blocked before ingestion or legal review | Do not retain raw data; keep only minimal review metadata | Store review decision, not source content |

Retention controls:

- Legal hold overrides lifecycle deletion, compaction, and anonymization.
- Retention-policy changes are privileged regulated actions and must be audited.
- Raw artifacts retained for reproducibility must remain linked to source version, retrieval time, connector version, parser version, record hash, and release IDs.
- If a source must be removed due to license expiration, the system must identify affected releases, exports, search indexes, and downstream consumers before deletion.
- Deleted or expired source content must leave tombstone metadata sufficient for audit without violating license or privacy policy.

## 9. Source Disclaimers and Evidence Limitations

Source-specific disclaimers and limitations must travel with evidence.

Every evidence object must include:

- `disclaimer_ids`.
- Source name and source version.
- Source terms or limitations URI where available.
- Evidence limitation text or code.
- Whether the evidence may support causal, associative, descriptive, or bibliographic claims.
- Required display contexts: entity page, relationship explanation, search result, export, release package, API response.

Mandatory disclaimers:

| Source | Required disclaimer behavior |
|---|---|
| ClinicalTrials.gov | Display registry context, source retrieval time, trial status, and note that registry entries may be incomplete or updated after retrieval |
| PubMed / Europe PMC | Display citation, document ID, publication date, article/license context, and distinguish article evidence from curated fact |
| ChEMBL | Display ChEMBL version, activity context where used, and source record IDs |
| UniProt | Display UniProt release/version and reviewed/unreviewed status |
| openFDA FAERS | Always display non-causal warning: FAERS/openFDA reports are spontaneous reports and do not establish causation, incidence, prevalence, comparative risk, or product fault by themselves |
| Internal source template | Display tenant confidentiality label, source schema version, permitted-use label, and any customer-required limitation text |
| MedDRA/SNOMED/licensed vocabularies | Display only permitted labels/terms; preserve license restrictions and suppress fields not licensed for display/export |

Release validation must block any release where source-specific disclaimers are required but missing from evidence, search explanation payloads, API/export metadata, or release package manifests.

## 10. Materialization Decision Rules

Use the most restrictive applicable rule.

| Condition | Decision |
|---|---|
| License/sensitivity unknown | Block |
| Public source, stable enough for reproducible evidence, no special display restrictions | Materialize |
| Public source requiring attribution or source limitations | Materialize with attribution and disclaimers |
| Licensed source without materialization rights | Federate |
| Licensed source with approved bounded materialization rights | Materialize with restrictions |
| Internal confidential source without PHI/PII | Federate or materialize inside tenant by customer policy |
| PHI/PII source | Redact then materialize, pointer-only federate, stream, or block by approved policy |
| Fast-changing operational event stream | Stream and persist only approved derived state or bounded event windows |
| Safety source with non-causal limitations | Materialize only with mandatory non-causal warnings |
| Source needed only for lookup but not redistribution | Federate |
| Source license expires or review is overdue | Block new ingestion and release use until renewed |

Materialization approval must record approver, role, rationale, source scope, tenant, environment, retention class, legal approval ID where required, and audit event ID.

## 11. Export and Release Rules

Exports must include:

- Release ID.
- Source name and source version.
- License classification.
- Materialization policy.
- Sensitivity classification.
- Source terms URI where available.
- Disclaimer IDs and limitation metadata.
- Provenance references.
- Artifact hashes.
- Tenant scope.
- Export restrictions.

Exports must block when:

- Source is `blocked_pending_legal_review`.
- Source is `licensed_federated` and the export would include locally copied restricted content.
- Source is `licensed_materializable_with_restrictions` and the requested export exceeds approved use.
- Source is `contains_phi_or_pii` and export policy is absent or denied.
- Source-specific disclaimer cannot be included.
- Release ID or provenance is missing.
- Licensed commercial data would be redistributed without explicit approval.

Release packages must include data-license/materialization clearance for every included source.

## 12. Validation and Audit Requirements

Validation must fail when:

- `license_classification` is missing, unknown, or not one of the seven required values.
- `materialization_policy` is missing.
- `sensitivity_classification` is missing.
- `retention_class` is missing.
- Source-version strategy is missing.
- Raw artifact policy conflicts with source classification.
- Licensed source is materialized without explicit approval.
- PHI/PII reaches AI without approved policy.
- Source disclaimer IDs are missing for evidence that requires them.
- FAERS/openFDA evidence lacks non-causal warning flags.
- Export includes restricted source data without permission.
- Release package lacks data-license/materialization clearance.

Audit events are required for:

- Source register creation or change.
- License classification change.
- Materialization approval or denial.
- Legal review approval, denial, expiry, or renewal.
- Source configuration change.
- Connector run, retry, failure, and block due to license.
- PHI/PII detection, redaction, de-identification, and AI-policy decision.
- Export approval, denial, and execution.
- Retention class change, legal hold, lifecycle deletion, and tombstone creation.
- Disclaimer policy change.

## 13. Recommended Contract Fields

### 13.1 Mapping and Evidence Fields for Standards Alignment

Add these fields to mapping and evidence objects when a source or target has license, privacy, or disclaimer constraints:

```json
{
  "license_classification": "string",
  "license_policy_id": "string_or_null",
  "data_sensitivity": "public | restricted_public | licensed | internal_confidential | phi_pii | unknown",
  "materialization_policy": "materialize | federate | stream | redact_then_materialize | block",
  "permitted_uses": ["string"],
  "export_restrictions": ["string"],
  "disclaimer_ids": ["string"],
  "legal_approval_id": "string_or_null",
  "retention_class": "string"
}
```

These fields should not replace provenance fields. They describe what the platform may do with the data; provenance describes where the data came from and how it was produced.

### 13.2 Connector Spec Fields for Connector Architect Alignment

Connector specifications should include:

```yaml
license_classification:
materialization_policy:
sensitivity_classification:
retention_class:
raw_artifact_policy:
source_version_strategy:
ai_use_policy:
disclaimer_ids:
legal_approval_id:
permitted_uses:
export_restrictions:
```

`license_classification` remains the exact universal connector output field from the master prompt.

## 14. Handoff Packet

```yaml
handoff_from: andy-mqvn41pb
handoff_to:
  - god
  - angela-mqvn21zm
  - jim-mqvmnm51
ticket_id: P0b-10
summary: "Created DATA_LICENSE_REGISTER.md defining source classifications, MVP source decisions, PII/PHI-to-AI restrictions, retention classes, customer data boundary policy, disclaimer propagation, validation/audit rules, and contract field recommendations."
artifacts_changed:
  - "C:\\Projects\\Project10\\DATA_LICENSE_REGISTER.md"
contracts_changed:
  - "Source register contract proposed."
  - "Connector license field aligned to license_classification."
  - "Recommended mapping/evidence governance fields proposed."
assumptions:
  - "Exact tenant licenses for MedDRA, SNOMED CT, licensed publications, and commercial datasets are unknown and default blocked/federated."
  - "Internal source template defaults to internal_confidential and may elevate to contains_phi_or_pii."
test_results:
  - "No automated tests run; Phase 0b governance document only."
known_limitations:
  - "No connector implementation or source license parser created."
  - "No customer-specific retention schedules supplied yet."
risks:
  - "PubMed/Europe PMC full-text rights vary by article."
  - "FAERS evidence can be misread without mandatory non-causal warnings."
  - "Internal source free text may contain hidden PHI/PII."
required_next_action:
  - "Standards should confirm mapping/evidence field naming."
  - "Connector Architect should include license_classification and related policy fields in CONNECTOR_CONTRACT.md."
  - "Red Team should review license, PHI/PII, and disclaimer bypass paths."
blocking_questions:
  - "None for Phase 0b draft; tenant-specific licenses remain open."
```
