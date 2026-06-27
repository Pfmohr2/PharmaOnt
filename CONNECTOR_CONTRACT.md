# PharmaOps Connector Contract

## Task

Define the universal connector interface every PharmaOps source connector must implement.

This document covers connector lifecycle states, required output payload, source licensing fields, idempotency and replay rules, provenance requirements, normalization handoff boundaries, fixture expectations, and connector onboarding template.

## Assumptions

- Connectors fetch and parse source data, persist raw artifacts or approved pointers, and emit normalized candidate records.
- Connectors may propose candidate entities, identifiers, mappings, relationships, evidence, and warnings.
- Connectors must never publish governed assets directly to released graphs.
- Connectors must not bypass RBAC, audit logging, provenance, validation, release workflow, human review for regulated publication, or licensing/materialization policy.
- `license_classification` is the canonical universal connector output field.
- Source onboarding must happen before connector execution so licensing, sensitivity, retention, raw artifact, AI-use, and export policy are known.

## Inputs Reviewed

- `pharmaops_multi_agent_exportable_prompt.md`
- Section 6.1, required output structure
- Section 7 Agent 8, Data Governance and Licensing Agent
- Section 7 Agent 9, Connector Architect Agent
- Section 11.4, connector specification template
- Section 16, specialist agent base prompt
- `ARCHITECTURE.md`
- `SECURITY_MODEL.md`
- `DATA_LICENSE_REGISTER.md`
- `VOCABULARY_POLICY.md`
- `packages/contracts/src/mapping-object.schema.json`
- `packages/contracts/src/relationship-assertion.schema.json`
- `packages/pharma-identifiers/src/namespace-registry.json`
- Andy handoff: P0b connector contract license field guidance
- Angela handoff: Standards review of connector candidate mappings, provenance, evidence refs, and CURIE/IRI handling
- Oscar handoffs: backend authorization, tenant/license scope, audit coupling, break-glass graph-read alignment

## Changes Proposed

Create a universal connector contract with:

- Fixed lifecycle state vocabulary.
- Required connector output object.
- Required source governance fields.
- Deterministic idempotency and checkpoint rules.
- Clear normalization handoff boundary.
- Connector onboarding template based on the master prompt plus data-governance additions.
- Security, compliance, provenance, observability, and testing expectations.

## Connector Scope And Non-Scope

Connectors own:

- Source configuration validation.
- Source-version capture.
- Fetch scheduling and execution.
- Checkpointing and retry metadata.
- Raw artifact persistence or approved pointer persistence.
- Parsing source records into stable normalized source records.
- Candidate entity, identifier, relationship, mapping, and evidence proposal generation.
- Connector-run telemetry and audit event emission.
- Fixture-based acceptance tests.

Connectors do not own:

- Final canonical entity merge decisions.
- Governed mapping approval.
- Release graph publication.
- Human review decisions.
- Export authorization.
- License override approval.
- Cross-tenant access exceptions.
- Direct SPARQL writes to released graphs.

## Connector Lifecycle States

Every connector run must report one of these lifecycle states:

```text
configured
scheduled
running
fetched
raw_persisted
parsed
normalized
validated
indexed
completed
failed_retryable
failed_blocked
deprecated
```

State rules:

- `configured`: source register, credentials reference, governance policy, schedule, and fixture metadata exist.
- `scheduled`: a run has been queued with tenant, environment, source, connector version, and idempotency key.
- `running`: worker claimed the run and emitted a start audit event.
- `fetched`: source response or stream segment was retrieved, but not yet persisted.
- `raw_persisted`: raw artifact, redacted artifact, or approved pointer manifest was persisted with digest.
- `parsed`: source-specific parser emitted source records with stable source record IDs.
- `normalized`: connector emitted the universal output contract and normalization candidates.
- `validated`: schema, license, provenance, source-version, record-hash, and data-quality checks passed.
- `indexed`: authorized derived records were queued for search indexing or indexing was confirmed.
- `completed`: run finished and emitted final metrics, manifests, and audit event.
- `failed_retryable`: run failed due to transient rate limit, timeout, service outage, or retriable infrastructure error.
- `failed_blocked`: run failed due to policy, license, validation, source schema, credential, provenance, or non-retryable source contract issue.
- `deprecated`: connector is no longer approved for new runs; existing release evidence remains addressable.

Allowed transitions are append-only in run history. A retry creates a new attempt under the same run lineage and idempotency key unless source version or connector configuration changes.

## Universal Connector Output

Each source record emitted by a connector must conform to this object:

```json
{
  "source_name": "string",
  "source_version": "string",
  "source_record_id": "string",
  "source_record_uri": "string_or_null",
  "source_retrieved_at": "timestamp",
  "license_classification": "open_materializable | open_with_attribution | licensed_federated | licensed_materializable_with_restrictions | internal_confidential | contains_phi_or_pii | blocked_pending_legal_review",
  "raw_artifact_uri": "string",
  "record_hash": "sha256",
  "normalized_record": {},
  "candidate_entities": [],
  "candidate_relationships": [],
  "candidate_mappings": [],
  "warnings": [],
  "provenance": {}
}
```

Field rules:

- `source_name` must match the approved source register.
- `source_version` must be source-provided version, release, retrieval timestamp, snapshot hash, or customer schema version according to `source_version_strategy`.
- `source_record_id` must be stable across idempotent replays. Its uniqueness scope is `source_name + source_version + source_record_id`.
- `source_record_uri` must be an absolute IRI/URL or `null`; it should carry the authoritative source URL/URI when one exists.
- `source_retrieved_at` must be captured in UTC.
- `license_classification` must use one of the seven source classifications from `DATA_LICENSE_REGISTER.md`.
- `raw_artifact_uri` must point to object storage artifact, redacted artifact, or approved pointer manifest according to `raw_artifact_policy`.
- `record_hash` must be SHA-256 over the canonicalized permitted record content or pointer manifest.
- `normalized_record` contains connector-normalized source fields, not governed canonical facts.
- `candidate_entities`, `candidate_relationships`, and `candidate_mappings` are proposals for downstream normalization and review.
- `warnings` must include parsing, policy, quality, disclaimer, license, and source-limit warnings.
- `provenance` must identify connector, connector version, parser version, source artifact digest, run ID, attempt ID, retrieval context, transform version, and source terms where available.

## Source Governance Fields

Every connector specification must include these policy fields from Data Governance:

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

Allowed `license_classification` values:

```text
open_materializable
open_with_attribution
licensed_federated
licensed_materializable_with_restrictions
internal_confidential
contains_phi_or_pii
blocked_pending_legal_review
```

Policy rules:

- Missing or unknown `license_classification` blocks connector execution.
- `blocked_pending_legal_review` blocks ingestion, materialization, AI use, search indexing, export, and release inclusion.
- `licensed_federated` connectors must persist only approved metadata or pointer manifests unless Data Governance approves materialization.
- `contains_phi_or_pii` connectors default to no AI use and no raw persistence unless approved policy permits redaction, de-identification, private processing, or pointer-only operation.
- Source-specific disclaimers must travel in warnings, normalized records, evidence candidates, search payloads, API payloads, exports, and release manifests.
- `legal_approval_id` is required for restricted licensed materialization, PHI/PII processing, and other source policies requiring approval.

## Required Connector Qualities

All connectors must be:

- Idempotent.
- Checkpointed.
- Retryable.
- Source-version pinned.
- Observable.
- Testable with fixtures.
- License-aware.
- Provenance-preserving.
- Unable to directly publish to released graphs.

### Idempotent

The same connector version, source version, source artifact digest, parser version, normalization ruleset version, tenant, and source record ID must produce the same output identity and not duplicate downstream assertions.

Required idempotency key components:

```text
tenant_id
environment
connector_name
connector_version
source_name
source_version
source_snapshot_digest
parser_version
normalization_ruleset_version
source_record_id
```

### Checkpointed

Connectors must persist checkpoints that allow safe resume after worker crash, source timeout, or queue retry.

Checkpoint metadata must include:

- Run ID.
- Attempt ID.
- Source cursor, page token, offset, file chunk, or stream position.
- Last raw artifact URI or pointer manifest.
- Last successful source record ID.
- Record counts by state.
- Error count and last failure reason.

### Retryable

Transient failures enter `failed_retryable` with bounded retry policy. Policy, validation, license, credential, source schema, or provenance failures enter `failed_blocked`.

Retries must not:

- Reuse expired credentials.
- Overwrite immutable artifacts.
- Duplicate emitted records.
- Advance checkpoints before artifact persistence.
- Hide failed attempts from audit or observability.

### Source-Version Pinned

Every connector run must capture source version using the approved strategy:

```text
version
release
retrieval_timestamp
snapshot_hash
customer_schema_version
```

When a source lacks a formal version, the connector must capture retrieval timestamp, endpoint, query parameters, artifact digest, connector version, parser version, and source response metadata.

### Observable

Connectors must emit:

- Structured logs with tenant and environment context.
- Metrics for records fetched, persisted, parsed, normalized, warned, blocked, retried, and completed.
- Traces for source calls, object storage writes, parsing, normalization handoff, validation, and indexing enqueue.
- Audit events for source configuration changes, connector run start, retry, blocked failure, completion, and policy denials.

Logs must not contain secrets, raw PHI/PII, connector credentials, or restricted raw payloads.

### Testable With Fixtures

Every connector must include:

- Small happy-path fixture.
- Empty-source fixture.
- Malformed-record fixture.
- Changed-source-version fixture.
- Duplicate-record replay fixture.
- License-blocked fixture.
- Source warning/disclaimer fixture.
- Rate-limit or retry fixture.

Fixture tests must assert output contract shape, stable IDs, hashes, warnings, provenance, license fields, and deterministic replay.

## Normalization Handoff Boundary

Connector output is the boundary between source-specific ingestion and PharmaOps normalization.

Connectors may:

- Normalize source field names and simple scalar formats.
- Canonicalize dates, identifiers, labels, URLs, and source-specific enum values.
- Emit candidate entities with source identifiers and class hints.
- Emit candidate relationships with source evidence and relationship hints.
- Emit candidate mappings or xrefs when the source provides them.
- Emit warnings about ambiguity, parsing quality, source limitations, licensing, or evidence disclaimers.

Connectors must not:

- Decide final canonical entity identity.
- Merge source records into governed canonical entities.
- Promote `exactMatch` or equivalent mapping as approved.
- Convert AI or connector suggestions into approved facts.
- Write directly to working, staging, or released RDF graphs except through approved ingestion service adapters.
- Publish to released graphs.
- Export governed data.

Handoff payloads must include enough information for normalization to:

- Resolve preferred identifiers using `VOCABULARY_POLICY.md`.
- Validate CURIE/IRI-compatible normalized identifiers through `packages/pharma-identifiers`.
- Evaluate mapping candidates using governed predicates.
- Preserve source vocabulary version and source license posture.
- Attach evidence and disclaimer IDs.
- Route restricted, licensed, PHI/PII, or low-confidence records to review or block state.

## Candidate Object Guidance

Candidate entities should use this shape:

```json
{
  "candidate_id": "string",
  "entity_class": "compound | target | gene | disease | drug | adverse_event | trial | publication | evidence | other",
  "source_label": "string",
  "source_identifiers": ["string"],
  "raw_source_identifiers": ["string"],
  "preferred_identifier_hint": "string_or_null",
  "synonyms": ["string"],
  "confidence_score": 0.0,
  "evidence_ids": ["string"],
  "evidence_refs": [
    {
      "evidence_id": "string",
      "evidence_role": "supports | contradicts | context | source_only | validation_evidence | approval_evidence",
      "required_for_release": false
    }
  ],
  "provenance_id": "string",
  "warnings": ["string"],
  "provenance": {}
}
```

Entity identifier rules:

- `source_identifiers` must contain CURIE/IRI-compatible identifiers validated through `packages/pharma-identifiers`.
- If the source supplies raw IDs that are not valid CURIEs or IRIs, preserve them in `raw_source_identifiers` and emit a warning until normalization can map them.
- `preferred_identifier_hint` must be CURIE/IRI-compatible when present.

Candidate relationships should use this shape:

```json
{
  "candidate_id": "string",
  "subject_ref": "string",
  "predicate_hint": "string",
  "object_ref": "string",
  "relationship_source_text": "string_or_null",
  "confidence_score": 0.0,
  "evidence_ids": ["string"],
  "evidence_refs": [
    {
      "evidence_id": "string",
      "evidence_role": "supports | contradicts | context | source_only | validation_evidence | approval_evidence",
      "required_for_release": false
    }
  ],
  "provenance_id": "string",
  "warnings": ["string"],
  "provenance": {}
}
```

Candidate mappings should use this shape:

```json
{
  "mapping_id": "string",
  "source_entity_id": "string",
  "source_term": "string",
  "target_entity_id": "string",
  "target_term": "string",
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
  "permitted_uses": ["ingest", "normalize", "curate"],
  "export_restrictions": ["string"],
  "disclaimer_ids": ["string"],
  "legal_approval_id": "string_or_null",
  "retention_class": "string",
  "license_status": "valid | restricted | blocked | pending_review | not_required",
  "confidence_score": 0.0,
  "confidence_band": "high | medium | low | blocked",
  "evidence_ids": ["string"],
  "evidence_refs": [
    {
      "evidence_id": "string",
      "evidence_role": "supports | contradicts | context | source_only | validation_evidence | approval_evidence",
      "required_for_release": false
    }
  ],
  "provenance_id": "string",
  "created_by": "user_or_service",
  "reviewed_by": null,
  "review_status": "proposed",
  "release_id": null,
  "provenance": {}
}
```

Candidate mapping rules:

- `candidate_mappings` are provisional connector outputs and must use `review_status: "proposed"`.
- Candidate mapping predicates must align with `VOCABULARY_POLICY.md` and remain provisional unless reviewed:

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

- `source_entity_id` and `target_entity_id` must be CURIE/IRI-compatible identifiers when known. If the source provides raw terms or raw IDs only, preserve the raw values in `source_term` and `target_term` and route to review.
- `source_vocabulary_version` and `target_vocabulary_version` are mandatory when known and must be set before governed approval or release eligibility.
- License governance fields are required when restricted vocabularies, licensed data, internal confidential data, PHI/PII, or export-restricted data participate.
- `evidence_refs` must use the structured evidence reference object from `packages/contracts`.
- `provenance_id` is required and must resolve to a provenance record from `packages/provenance`.

## Raw Artifact And Object Storage Rules

- Persist raw artifact, redacted artifact, or pointer manifest before parsing.
- Use immutable object keys or content-addressed paths.
- Store artifact digest, size, content type, source URL or source pointer, retrieval timestamp, source version, tenant, environment, connector version, parser version, and retention class.
- Never store raw secrets or connector credentials.
- Use tenant-scoped object prefixes for tenant-owned or internal data.
- Signed URLs must be short-lived, tenant/object-prefix scoped, and audited for privileged downloads.
- Raw artifact lifecycle follows `retention_class` and legal hold.

## Security Requirements

- Backend services authorize every connector configuration, run, retry, cancel, source credential change, and export-related action.
- Internal service calls carry signed actor or service-account identity, tenant, environment, source, license scope, and correlation ID.
- Service accounts are scoped by tenant, environment, source, queue, object prefix, graph family, and action.
- Direct SPARQL and internal service calls cannot bypass RBAC, tenant filters, release scope, or license policy.
- Cross-tenant connector execution is prohibited by default.
- Break-glass source or graph access follows `SECURITY_MODEL.md`: `security_admin` controlled, time-limited, justified, separately approved, tenant-scoped, and audited.
- Connector logs, traces, warnings, embeddings, and search payloads must not leak restricted source content.

## Compliance Requirements

- Connectors must fail closed when source licensing, source version, provenance, retention class, sensitivity classification, or disclaimer policy is missing.
- Connector output cannot enter release candidates unless validation proves source-version capture, artifact hash, license classification, provenance, and disclaimers.
- Licensed commercial data is not materialized unless explicitly approved.
- PHI/PII is not sent to AI services unless explicitly approved by deployment policy and governance controls.
- Source-specific disclaimers and limitations travel with evidence and downstream explanations.
- Connector rerun idempotency failure is a release blocker.

## Connector Onboarding Template

```yaml
connector_name:
source_owner:
source_type: public_api | public_bulk | licensed_api | internal_api | file | stream
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
update_cadence:
primary_entities:
relationships_extracted:
external_identifiers:
required_metadata:
failure_modes:
retry_policy:
checkpoint_strategy:
normalization_handoff:
test_fixtures:
data_quality_checks:
security_notes:
compliance_notes:
```

Required onboarding approvals:

- Connector Architect: contract fit, lifecycle, idempotency, retry, checkpoint, fixture readiness.
- Data Governance: license classification, materialization policy, sensitivity, retention, AI use, disclaimers, legal approval.
- Standards and Mapping: identifier policy, CURIE/IRI mapping, source vocabulary version, candidate mapping predicate use.
- Security and Identity: service account scope, secrets, tenant/environment isolation, logs, audit, break-glass posture.
- Compliance and Validation: release blockers, validation evidence, retention and audit requirements.
- QA: fixture and replay test coverage.

## Interfaces Affected

- Connector configuration schema.
- Source license register.
- Ingestion job API and queue payloads.
- Object storage artifact manifests.
- Normalization service handoff payloads.
- Candidate entity and relationship schemas.
- Search indexing enqueue contracts.
- Audit event schema.
- Validation and release gates.

## Tests Added Or Required

- Contract schema validation for every connector output field.
- Candidate mapping schema validation aligned to `packages/contracts/src/mapping-object.schema.json`.
- Candidate entity and relationship validation for `provenance_id`, `evidence_ids`, and structured `evidence_refs`.
- Identifier validation through `packages/pharma-identifiers`, including separation of raw source IDs from normalized CURIE/IRI identifiers.
- Lifecycle transition tests.
- Idempotent replay tests using duplicate fixtures.
- Checkpoint resume tests.
- Retry and blocked-failure tests.
- Source-version pinning tests.
- License-classification and materialization-policy tests.
- Raw artifact digest and pointer manifest tests.
- Provenance completeness tests.
- Fixture tests for malformed records and source warnings.
- Security tests for service account scope, tenant isolation, secrets redaction, and log redaction.
- Release-blocking tests for missing provenance, source version, license classification, disclaimers, or idempotency evidence.

## Security Impact

This contract makes connectors part of the security boundary. Connector execution requires backend authorization, least-privilege service accounts, tenant/environment/license scope, scoped object storage access, secret manager references, and audited run state.

## Compliance Impact

This contract supports regulated evidence by requiring source-version pins, raw artifact or pointer persistence, deterministic hashes, provenance, license classification, disclaimer propagation, fixture evidence, and idempotent replay.

## Data And Provenance Impact

Every connector output preserves source name, source version, source record ID, record URI, retrieval time, license classification, raw artifact URI or pointer, record hash, normalized record, candidate proposals, warnings, and provenance. Downstream semantic assertions must remain traceable to connector run, artifact digest, parser version, and source policy.

## Risks

- Source APIs without explicit versions may reduce reproducibility unless snapshot hashes and retrieval metadata are strong.
- Licensed and PHI/PII sources can be accidentally materialized if source onboarding is bypassed.
- Connectors can create review overload if candidate quality thresholds are too permissive.
- Search or logs can leak restricted content if connector warnings or normalized records include raw text without policy filtering.
- Source schema drift can silently degrade parsing unless fixture and data-quality checks are maintained.

## Open Questions

- Should the universal connector output be formalized first as JSON Schema, Pydantic, TypeScript, or all three generated from one source?
- Which connector runtime will own checkpoint persistence: ingestion service database tables, queue metadata, or connector-local manifests?
- What are the first pilot-specific legal approval IDs and retention overrides for licensed or internal sources?
- Which source-specific disclaimer IDs will be standardized first for ClinicalTrials.gov, PubMed/Europe PMC, ChEMBL, UniProt, openFDA FAERS, and internal templates?

## Handoff To

- Standards and Mapping Agent: review identifier, CURIE/IRI, candidate mapping predicate, and source vocabulary version handling.
- Data Governance and Licensing Agent: confirm license/governance fields and source classification alignment.
- Ingestion Service Agent: implement connector run, checkpoint, retry, artifact, and output schema behavior.
- Normalization Service Agent: consume the handoff boundary and preserve provenance/license/disclaimer fields.
- Security and Identity Agent: review service-account, tenant, source credential, object storage, and audit controls.
- QA and Test Automation Agent: turn fixture and replay requirements into connector acceptance tests.

## Definition Of Done Status

Complete for Phase 0b connector contract draft:

- Lifecycle states are defined.
- Universal connector output contract is defined.
- Required connector qualities are defined.
- License classification values align with Data Governance.
- Data-governance connector spec fields are included.
- Normalization handoff boundary is defined.
- Connector onboarding template is included.
- Security, compliance, provenance, risks, tests, and downstream handoffs are documented.
