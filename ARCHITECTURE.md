# PharmaOps Architecture

## Task

Define the Phase 0 architecture for PharmaOps as a regulated pharma semantic control plane.

This document establishes service boundaries, technology decisions, storage strategy, deployment topology, named-graph policy, release snapshot rules, ingestion replay rules, and downstream handoff points.

## Assumptions

- PharmaOps preserves open semantic standards: RDF, OWL, SHACL, SPARQL, PROV-O-aligned provenance, and SSSOM-like mapping records.
- Operational product behavior remains pragmatic: workflow state, user actions, jobs, approvals, comments, and release metadata are not forced into RDF when relational storage is a better fit.
- Regulated publication requires human review, immutable audit records, validation evidence, and addressable release packages.
- Multi-tenancy is expected, even if the first MVP tenant is internal.
- Security ownership sits with the Security and Identity Agent; this document calls out required controls and review points but does not replace `SECURITY_MODEL.md`.

## Inputs Reviewed

- `pharmaops_multi_agent_exportable_prompt.md`
- Section 4.1, core architecture pattern
- Section 4.2, required platform services
- Section 4.3, recommended monorepo layout
- Section 4.4, storage strategy
- Section 4.5, named graph pattern
- Section 6.1, required output structure
- Section 7, Agent 3 Solution Architect instructions
- Section 11.3, ADR template
- Section 16, specialist agent base prompt
- `SECURITY_MODEL.md` security boundary handoff from Oscar

## Changes Proposed

Adopt a split architecture:

- RDF-native semantic core for ontology, canonical entities, mappings, provenance, evidence assertions, SHACL validation, and release graphs.
- PostgreSQL operational store for users, roles, workflow state, jobs, comments, approvals, review queues, release metadata, and audit indexes.
- Object storage for raw artifacts, source snapshots, documents, validation reports, export packages, and release bundles.
- Search and vector infrastructure for full-text, faceted, synonym-expanded, semantic, vector, and evidence retrieval.
- Asynchronous jobs for connector ingestion, parsing, normalization, indexing, AI suggestions, validation, release packaging, and exports.
- API facade and workflow service as the policy-enforced interaction layer between users, services, and semantic assets.

## Architecture Principles

1. Use RDF-native storage for ontology, canonical entities, mappings, provenance, validation, and released semantic snapshots.
2. Use PostgreSQL for operational workflow state, users, jobs, comments, approvals, and review queues.
3. Use object storage for raw artifacts, source snapshots, documents, import outputs, validation reports, export files, and release packages.
4. Use search and vector infrastructure for hybrid retrieval over entities, mappings, evidence, documents, and explanations.
5. Use asynchronous jobs for connector ingestion, normalization, indexing, AI suggestions, validation, and export generation.
6. Separate local, dev, test, staging, release-candidate, and production environments.
7. Make every source ingestion idempotent and replayable.
8. Make every release snapshot immutable and addressable.

## Core Flow

```text
Connectors
  -> raw artifact persistence
  -> parsing
  -> normalization/enrichment
  -> semantic core
  -> search/indexing
  -> workflow UI
  -> validation/release pipeline
  -> APIs/exports
```

Flow rules:

- Raw source artifacts are persisted before parsing.
- Parsing and normalization are deterministic for a connector version, source snapshot, parser version, and normalization ruleset.
- Candidate semantic assertions enter staging or proposal state before governed acceptance.
- Accepted semantic changes are validated with SHACL and domain checks before release staging.
- Released graphs and release packages are immutable. Rollback changes the active release pointer and metadata, not released graph contents.
- Exports are generated from release snapshots, not from mutable working graphs.

## Technology Decisions

| Concern | Decision | Rationale |
|---|---|---|
| Semantic standards | RDF, OWL, SHACL, SPARQL 1.1, named graphs | Preserves open interoperability and supports graph validation, provenance, and release snapshots. |
| Semantic persistence | RDF-native graph store behind a repository interface | Avoids relational impedance for ontology, mappings, provenance, and named graph release policy. |
| Operational persistence | PostgreSQL | Mature transactional store for workflow state, jobs, approvals, users, RBAC metadata, and release indexes. |
| Raw and release artifacts | S3-compatible object storage | Content-addressable, immutable object retention is a good fit for source snapshots and release evidence. |
| Search | Search engine plus vector index behind a search service | Supports full-text, facets, synonyms, graph-aware ranking, evidence retrieval, and AI-assisted workflows. |
| Async execution | Queue-backed worker pool with durable job records in PostgreSQL | Keeps ingestion, validation, indexing, and export work retryable, observable, and independently scalable. |
| API style | REST or GraphQL for product APIs; controlled SPARQL for semantic access | Gives application clients stable contracts while preserving expert semantic access under policy. |
| Validation | SHACL plus service-level business validation | SHACL validates graph shape; workflow validation handles release, license, review, and product rules. |

## Deployment Topology

The production topology should be service-oriented but deployable as a small number of containers for MVP:

```text
Ingress / API gateway
  -> web workbench
  -> API facade
       -> workflow service
       -> semantic store adapter
       -> search service
       -> export service
       -> audit service
  -> worker services
       -> ingestion workers
       -> normalization workers
       -> AI curation workers
       -> validation workers
       -> indexing workers
       -> export workers

Shared backing services:
  RDF store
  PostgreSQL
  object storage
  search/vector index
  queue/broker
  observability stack
  secrets manager / KMS
```

Baseline environment topology:

| Environment | Purpose | Data policy | Release authority |
|---|---|---|---|
| local | Developer iteration with fixtures and local containers | Synthetic or public fixture data only | None |
| dev | Shared integration for active development | Non-sensitive public/fixture data | None |
| test | Automated integration, ontology, data-quality, security, and performance tests | Controlled fixtures and generated data | None |
| staging | Pre-production validation against production-like topology | Sanitized or approved pilot data | None |
| release-candidate | Frozen candidate validation, evidence generation, release rehearsal | Approved candidate datasets only | Can produce candidate artifacts, not production releases |
| production | Regulated user workflows and released semantic assets | Customer-approved data with retention, tenancy, and audit controls | Production release managers only |

Environment rules:

- Environment-level permissions are mandatory.
- Production service accounts cannot be reused in lower environments.
- Tenant, environment, release, and source-license scope must travel with API calls, graph operations, search requests, exports, logs, and background jobs.
- Release-candidate artifacts must be traceable to exact code, ontology, connector, parser, normalization, validation, and source snapshot versions.
- Production writes to released graphs and released object prefixes are prohibited after publication.

## Recommended Monorepo Layout

```text
pharmaops/
  apps/
    web/                         # Main React/Next workbench
    admin/                       # Optional internal admin console
  services/
    api/                         # REST/GraphQL API facade
    workflow/                    # Review, approval, release state machine
    ingestion/                   # Connector runtime and jobs
    normalization/               # Entity normalization and mapping pipelines
    ai-curation/                 # NER, linking, relation suggestions
    search/                      # Indexing, query, ranking, explainability
    audit/                       # Audit event service
    export/                      # RDF/JSON/TSV/export package generation
  ontologies/
    core/                        # OWL/RDF ontology modules
    shapes/                      # SHACL validation shapes
    mappings/                    # SSSOM-like mapping files
    fixtures/                    # Small ontology/data fixtures for tests
  packages/
    contracts/                   # Shared TypeScript/Python data contracts
    pharma-identifiers/          # CURIE/IRI helpers and namespace registry
    provenance/                  # PROV helpers and audit schemas
    ui-components/               # Reusable UI components
  connectors/
    clinicaltrials/
    pubmed_europepmc/
    chembl/
    uniprot/
    openfda_faers/
    internal_template/
  infra/
    docker/
    terraform/
    helm/
    ci/
  tests/
    unit/
    integration/
    e2e/
    ontology/
    data_quality/
    security/
    performance/
  docs/
    adr/
    runbooks/
    validation/
    user_guides/
```

## Storage By Data Type

| Data type | System of record | Secondary indexes or copies | Notes |
|---|---|---|---|
| Ontology modules | Version-controlled files and RDF store | Search index for documentation | Working and release graphs must match committed ontology artifact digests. |
| SHACL shapes | Version-controlled files and RDF store | Validation reports in object storage | Shape version is part of validation evidence. |
| Canonical entities | RDF store | Search/vector index; operational references in PostgreSQL | RDF remains authoritative for semantic facts. |
| Mappings | RDF store | PostgreSQL workflow metadata; search index | Mapping proposals and review state live in PostgreSQL until accepted. |
| Provenance assertions | RDF store | Audit index for discovery | Use source-version-pinned graphs and PROV-aligned predicates. |
| Source records | Object storage for raw artifacts; metadata in PostgreSQL; normalized assertions in RDF staging | Search index where authorized | Raw artifacts are content-addressed before parsing. |
| Connector runs | PostgreSQL job and run metadata | Logs/metrics/traces | Include connector version, source version, input digest, parser version, output digest. |
| Workflow state | PostgreSQL | Audit service | Transactional state machine, not RDF. |
| Review comments and decisions | PostgreSQL | Audit events and authorized search | Decision records link to semantic proposal IDs. |
| Evidence documents | Object storage | Search/vector index; RDF evidence metadata | Access controls must apply to documents and derived search snippets. |
| Search documents | Search/vector index | Rebuildable from RDF, PostgreSQL metadata, and object storage | Search is not system of record. |
| AI suggestions | RDF staging graph plus PostgreSQL review metadata | Search/index for work queues | Suggestions are not authoritative until human accepted. |
| Release snapshots | RDF release named graphs plus object storage release package | PostgreSQL release pointer and metadata | Immutable and addressable by release ID and manifest digest. |
| Audit events | Append-only audit service/store; indexed for authorized users | Object storage archive if needed | Audit records must not be mutable by product services. |
| Export packages | Object storage | PostgreSQL export metadata; audit events | Generated from immutable release snapshots. Phase 0 does not allow external working-data exports; any future internal preview workflow must be governed, tenant/release/provenance/license scoped, privileged, audited, and explicitly non-distributable. |

## Named Graph Policy

Named graph pattern:

```text
graph:ontology:core:working
graph:ontology:core:release:{release_id}
graph:ai-suggestions:staging
graph:source:{source_name}:{source_version}
```

Global graph families are allowed only for explicitly classified public or shared reference data. Tenant-owned canonical data, mappings, evidence, source records, proposals, validation outputs, and releases must use tenant-scoped graph names.

Additional allowed graph families:

```text
graph:tenant:{tenant_id}:ontology:core:working
graph:tenant:{tenant_id}:data:canonical:working
graph:tenant:{tenant_id}:mappings:working
graph:tenant:{tenant_id}:release:{release_id}:{domain}
graph:tenant:{tenant_id}:source:{source_name}:{source_version}
graph:tenant:{tenant_id}:proposal:{proposal_id}
graph:tenant:{tenant_id}:validation:{validation_run_id}
```

Rules:

- Working graphs and released graphs are separate.
- Released graphs are immutable after publication.
- Tenant-owned data must be stored in tenant-scoped graph families. Global graphs are limited to explicitly classified public/shared reference data and must not contain tenant-owned, restricted, confidential, licensed-restricted, PHI/PII, proposal, or working customer data.
- AI suggestions live in staging until accepted into a governed proposal.
- Source graphs are source-version pinned.
- Proposal graphs are temporary, review-scoped, and linked to PostgreSQL workflow state.
- Release candidate validation reads a closed set of working/proposal/source graphs and writes validation evidence to a validation graph and object storage.
- Rollback restores a previous release pointer and release metadata, not ad hoc partial state.
- Cross-tenant graph reads are prohibited by default. Exceptional internal support access must be controlled by `security_admin`, time-limited, justified, separately approved, tenant-scoped, and audited. `platform_admin` alone cannot authorize or execute break-glass cross-tenant graph reads.
- Graph names must not encode sensitive customer names; tenant IDs are opaque.
- Every assertion promoted from source, staging, or proposal to working/release graphs must retain provenance links to source graph, source artifact digest, transform version, actor or service account, and validation run.
- SPARQL update access is service-only. User-initiated semantic changes pass through workflow APIs and audited proposal/release flows.

## Idempotent And Replayable Ingestion

Every ingestion must be repeatable without duplicating semantic facts or corrupting workflow state.

Required identifiers:

- `connector_id`
- `connector_version`
- `source_name`
- `source_version`
- `source_snapshot_digest`
- `parser_version`
- `normalization_ruleset_version`
- `run_id`
- `idempotency_key`

Rules:

- Persist raw artifacts to object storage before parsing.
- Compute content digest and store it with connector run metadata.
- Derive idempotency keys from source identity, source version, artifact digest, connector version, parser version, and normalization ruleset version.
- Parsing outputs normalized records with stable source record IDs.
- Normalization emits deterministic candidate entity, mapping, synonym, and relationship assertions.
- RDF writes use deterministic IRIs and upsert semantics for working/staging graphs.
- Replays may produce a new run record, but they must not create duplicate assertions for the same semantic identity and version.
- Failed runs are resumable from persisted artifacts and durable job state.
- Search indexes are rebuildable from systems of record.

## Immutable Addressable Release Snapshots

Each release must produce:

- Release ID.
- Release manifest with code version, ontology digest, shape digest, source graph versions, source artifact digests, connector versions, parser versions, normalization ruleset versions, validation run IDs, approving users, release timestamp, and package digests.
- RDF release named graphs for ontology, canonical data, mappings, and evidence.
- Object storage package with RDF, JSON-LD, TSV/CSV where approved, validation reports, changelog, manifest, and signatures/checksums.
- PostgreSQL release metadata and active release pointer.
- Audit events for staging, validation, approval, publication, rollback, and export generation.

Rules:

- Release graph contents are append-forbidden after publication.
- Release packages are written to immutable object prefixes or buckets with retention controls where available.
- A release is addressable by release ID and manifest digest.
- Rollback selects a prior release as active and records the rollback event; it does not mutate the rolled-back or restored release graphs.
- Export APIs default to the active release unless a caller supplies an authorized release ID.

## Major Service Boundaries

| Service | Boundary | Data ownership | Failure modes | Security implications | Migration risks | Tests required |
|---|---|---|---|---|---|---|
| RDF semantic store | Stores and validates semantic graphs; exposes controlled SPARQL/query/update through service adapters | Ontology graphs, canonical entity graphs, mapping graphs, provenance graphs, release graphs | Store unavailable, SPARQL update failure, graph lock contention, invalid RDF, SHACL failures, slow queries | Service-only writes, scoped graph reads, tenant isolation, audit around updates, restricted SPARQL access | Vendor-specific SPARQL features, graph naming drift, large graph migration cost | SHACL tests, graph permission tests, release immutability tests, query performance tests |
| PostgreSQL operational store | Transactional workflow, identity metadata references, jobs, release metadata, comments, approvals, review queues | Operational tables and release pointers | Transaction deadlocks, failed migrations, queue metadata drift, partial workflow transitions | RBAC checks, row-level tenant constraints where appropriate, encrypted sensitive fields, audit hooks | Schema evolution across workflow state machines, tenancy retrofit risk | Migration tests, workflow transition tests, RBAC integration tests, backup/restore tests |
| Object storage | Durable blobs for raw artifacts, documents, validation reports, exports, release packages | Content-addressed objects and immutable release packages | Missing object, digest mismatch, retention misconfiguration, lifecycle deletion errors | Bucket/prefix IAM, encryption, signed URLs, malware scanning for uploads, retention locks | Provider API differences, lifecycle policy drift, object key convention changes | Digest verification, retention tests, access-control tests, replay-from-artifact tests |
| Search and vector service | Builds and serves authorized retrieval indexes | Derived search documents, embeddings, facets, explainability metadata | Stale indexes, failed rebuild, unauthorized snippet exposure, ranking regressions | Tenant, role, environment, release, and license filters at index and query time; no unscoped vector search; document ACL propagation | Reindex cost, embedding model changes, search schema migrations | Rebuild tests, access-filter tests, relevance regression tests, stale-index alerts |
| Workflow service | Governs proposals, review, approval, validation previews, release staging, promotion, rollback metadata | Workflow state in PostgreSQL; proposal references to RDF graphs | Stuck state transitions, duplicate approvals, release race, partial rollback metadata | Backend permission checks on every mutating action, privileged release roles, audit events coupled to regulated mutations where possible | State machine changes may strand in-flight proposals | State-machine tests, concurrency tests, audit emission tests, rollback tests |
| Ingestion service | Runs connectors, persists artifacts, parses records, emits normalized outputs and candidate assertions | Connector run metadata; raw artifact references; parsed output manifests | Source API outage, rate limits, parser failure, duplicate runs, malformed source data | Least-privilege service accounts, source credential isolation, license/materialization checks, audit source config changes | Connector version changes can alter outputs; source schema drift | Replay tests, fixture connector tests, idempotency tests, source failure simulations |
| Normalization service | Resolves source records to canonical entities, mappings, synonyms, relationships, and confidence scores | Normalization output manifests; candidate assertion batches | Over-merge, under-merge, confidence drift, inconsistent deterministic IDs | Human review for regulated publication, provenance on every candidate, no silent promotion | Ruleset changes can remap canonical identities | Golden fixture tests, entity-resolution regression tests, provenance tests |
| AI curation service | Generates suggestions with evidence for human review | Suggestion batches, model metadata, evidence links, review references | Hallucinated suggestions, missing evidence, model/provider outage, prompt drift | Suggestions are non-authoritative, require human review, store model/version/prompt metadata, redact sensitive context | Model swaps affect quality and explainability | Evaluation set tests, rejection workflow tests, evidence-link tests, safety tests |
| Audit service | Captures immutable activity records for user and service actions | Append-only audit records and searchable audit index | Dropped events, duplicated events, index lag, clock skew | Tamper resistance, service authentication, privileged action coverage, retention policy, transaction coupling for regulated mutations where possible | Changing audit schema after validation is costly | Audit coverage tests, append-only tests, retention tests, export audit tests |
| API facade | Product API boundary for UI, integrations, controlled SPARQL, and exports | API contracts and request authorization; no primary data ownership | Downstream outage, inconsistent authorization, schema breaking changes | Central authN/authZ; tenant, environment, release, and license scoping; request audit; rate limits; export authorization; signed internal-service context | API versioning and client compatibility | Contract tests, authZ tests, integration tests, rate-limit tests |
| Frontend workbench | User-facing search, entity pages, mapping registry, evidence viewer, review queues, release dashboard, audit browser, connector status, admin screens | Client state only | Stale data, unauthorized UI affordances, failed uploads, incomplete review context | Frontend checks are advisory only; backend enforces all permissions; avoid leaking hidden fields | UI workflows coupled to backend state machine changes | E2E tests, accessibility tests, role-specific UI tests |
| Export service | Generates RDF, JSON-LD, TSV/CSV, reports, and release packages | Export job metadata; object storage package references | Partial package, digest mismatch, stale snapshot, large export timeout | Export authorization, watermarks where needed, audit every export, no hidden cross-tenant data | Format changes can break downstream consumers | Package integrity tests, format contract tests, large export tests |
| Observability layer | Logs, metrics, traces, alerts, dashboards, runbooks | Telemetry and operational metadata | Missing telemetry, alert noise, sensitive data in logs, trace gaps | Redaction, tenant-safe logging, access controls for dashboards, audit for production access | Telemetry schema changes can break dashboards and SLOs | Log redaction tests, alert tests, trace propagation tests |

## Interfaces Affected

- Semantic write interface: workflow and ingestion services write semantic changes through controlled adapters, not direct user SPARQL updates.
- Workflow API: owns proposal, review, approval, validation, release, and rollback commands.
- Ingestion API and job contracts: require idempotency keys, source snapshots, connector versions, parser versions, and output manifests.
- Search indexing contracts: search service consumes release/working graph deltas, PostgreSQL metadata, and object evidence metadata.
- Export contracts: export service reads release snapshots and emits object storage packages with manifests and checksums.
- Audit contracts: every privileged or mutating service action emits audit events.
- Internal service contracts: every call carries signed actor or service-account identity, tenant, environment, release context when applicable, license scope, and correlation ID.

## Tests Added Or Required

Required Phase 0 downstream test families:

- Ontology and SHACL validation tests.
- Named graph policy tests, including released graph immutability.
- Ingestion idempotency and replay tests.
- Workflow state machine and approval authorization tests.
- Search access-control and index rebuild tests.
- Release snapshot addressability, manifest, digest, and rollback tests.
- Audit coverage and append-only tests.
- Object storage retention, digest, and package integrity tests.
- Migration tests for PostgreSQL schemas, RDF graph layout, search indexes, and object key conventions.
- Security tests for RBAC, service accounts, tenant isolation, exports, logs, and background jobs.

## Security Impact

Security requirements for architecture review:

- RBAC must be enforced on the backend for every mutating action.
- Environment-level permissions are required.
- Tenant, environment, release, source-license, workflow-state, and resource scope are mandatory authorization dimensions for API, semantic store, search, exports, logs, and background jobs.
- Service accounts must have least privilege by service, graph family, object prefix, queue, and database schema.
- SPARQL update is not exposed directly to users.
- Direct SPARQL and internal service calls must not bypass RBAC, tenant filters, release scope, or license policy.
- Search and vector retrieval must apply tenant and document access filters before returning facets, snippets, embeddings, or explanations.
- Object storage access must use scoped service credentials and short-lived signed URLs where direct download is required.
- Secrets must live in a secrets manager; connector credentials must not be stored in source files, logs, object artifacts, or job payloads.
- Logs, traces, vector metadata, and export manifests must not leak restricted tenant data.
- Audit events are required for auth, role changes, approvals, exports, source config changes, release actions, privileged admin actions, and service-account actions.
- For regulated mutations, the service mutation and required audit event should commit in the same transaction boundary where possible. If a single transaction is impossible across stores, the workflow must use an outbox or compensating mechanism that blocks promotion until audit emission is confirmed.

Security coordination:

- Oscar, Security and Identity Agent, should review graph access policy, service-account boundaries, export authorization, search/vector tenant filtering, object storage retention/access controls, and audit coverage.

## Compliance Impact

- Human review is required before regulated publication.
- Release-candidate validation must produce evidence artifacts that identify the exact code, data, ontology, shape, connector, parser, normalization, and source versions.
- Released graphs and packages are immutable, addressable, and auditable.
- Rollback is auditable and pointer-based.
- Validation failures block promotion.
- Audit records support inspection of user and service actions.
- Environment separation prevents accidental promotion from unvalidated lower environments.

## Data And Provenance Impact

- Source artifacts are retained in object storage before parsing.
- Source graphs are version pinned.
- Every promoted assertion traces to source graph, source artifact digest, transform version, actor or service account, and validation run.
- AI suggestions remain distinct from governed facts until accepted.
- Search indexes and exports are derived artifacts, not systems of record.
- Release manifests provide durable provenance for release reconstruction and external inspection.

## Risks

- RDF store vendor lock-in if services use non-portable extensions directly.
- Search and vector indexes can leak data if tenant filters are applied inconsistently.
- Internal service calls can become an authorization bypass if signed context and backend policy checks are not enforced consistently.
- Workflow and semantic graph state can diverge if proposal promotion is not transactional or compensated.
- Connector and source schema drift can silently affect normalized outputs without strong fixture tests.
- Long-running graph migrations may require dual-write or graph copy plans.
- Object storage lifecycle or retention misconfiguration can destroy replay evidence.
- AI suggestions can create review burden or unsafe trust if UI does not clearly separate suggestions from accepted facts.
- Release snapshot growth may require partitioning, archival, and query optimization.

## Open Questions

- Which RDF store will be selected for MVP and production: Apache Jena/Fuseki, GraphDB, Stardog, Amazon Neptune, or another SPARQL/SHACL-capable platform?
- Which search/vector stack will be selected: OpenSearch, Elasticsearch, PostgreSQL with pgvector for MVP, or a dedicated vector database?
- Will the MVP require customer multi-tenancy on day one or only tenant-safe architecture with one internal tenant?
- What retention periods apply to raw artifacts, audit events, release packages, and rejected AI suggestions?
- What regulated data classes are explicitly in scope for MVP pilots?

## Handoff To

- Security and Identity Agent: review graph access, RBAC, service accounts, tenant isolation, search/vector filtering, object storage controls, and audit requirements.
- Compliance and Validation Agent: define validation evidence requirements and release-candidate approval gates.
- Ontology Architect Agent: refine ontology modules, SHACL shapes, graph families, and IRI policy.
- Connector Architect Agent: define connector run manifests, idempotency keys, source snapshot contracts, and replay behavior.
- DevOps and Platform Agent: turn the topology into local/dev/test/staging/release-candidate/production infrastructure plans.
- QA and Test Automation Agent: convert required tests into Phase 1 and Phase 2 automated suites.

## Definition Of Done Status

Complete for Phase 0 architecture lock:

- Service boundaries are defined.
- Data ownership is defined per major service.
- Failure modes are identified per major service.
- Security implications are identified and routed for Oscar review.
- Migration risks are identified per major service.
- Storage strategy is defined by data type.
- Named graph pattern and rules are defined.
- Six environments are defined.
- Idempotent and replayable ingestion rules are defined.
- Immutable addressable release snapshot rules are defined.
- ADR-0001 records the RDF-native semantic core decision.
