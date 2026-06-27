# ADR-0001: RDF-Native Semantic Core

## Status

Proposed

## Context

PharmaOps is a regulated pharma semantic control plane. It must manage governed ontology modules, canonical biomedical entities, mappings, provenance, evidence links, validation results, AI suggestions, and immutable release snapshots.

The system needs open semantic standards, explainable graph relationships, SHACL validation, source-version-pinned provenance, controlled SPARQL access, and named graph separation between working, staging, source, and released state.

## Decision

Use an RDF-native semantic core as the system of record for semantic data:

- OWL/RDF for ontology modules and semantic assertions.
- SHACL for graph validation.
- SPARQL 1.1 for controlled query access.
- Named graphs for working state, source-version-pinned data, AI suggestion staging, proposal validation, and immutable releases.
- PROV-aligned provenance assertions for source lineage and release reconstruction.

PostgreSQL remains the system of record for operational workflow state, users, jobs, comments, approvals, review queues, release pointers, and audit indexes. Object storage remains the system of record for raw artifacts, source snapshots, documents, validation reports, export files, and release packages. Search/vector indexes remain derived and rebuildable.

## Alternatives considered

- PostgreSQL-only semantic model with relational tables for entities, mappings, and provenance. This simplifies early operations but makes ontology evolution, graph traversal, SHACL validation, named graph releases, and interoperable semantic export harder.
- Document database as semantic store. This can handle flexible records but weakens standards alignment, graph validation, and SPARQL interoperability.
- Property graph as primary store. This improves some traversal ergonomics but does not preserve RDF/OWL/SHACL/SPARQL as the native model.
- Search index as primary semantic store. This helps retrieval but is not appropriate for governed facts, provenance, validation, or immutable release control.

## Consequences

Positive consequences:

- PharmaOps preserves open semantic standards for ontology, mappings, provenance, and exports.
- SHACL validation can run directly against governed graph state.
- Named graphs give a clear mechanism for working, staging, source, and release separation.
- Release snapshots can be immutable and addressable at graph level.
- Search, exports, AI curation, and APIs can derive from a canonical semantic source.

Costs and tradeoffs:

- The team must maintain RDF modeling, IRI, graph naming, and SPARQL discipline.
- RDF store operations, migrations, and performance tuning require specialized expertise.
- Product services need adapters to avoid leaking store-specific SPARQL assumptions everywhere.
- Cross-store consistency between RDF, PostgreSQL, object storage, and search requires explicit workflow and compensation design.

## Security impact

- User-initiated semantic writes must go through workflow APIs; direct SPARQL update is service-only.
- Graph access must be tenant-scoped and role-scoped.
- Service accounts require least-privilege permissions by graph family and operation.
- Search/vector access must not bypass RDF or workflow authorization.
- Audit events are required for semantic promotions, graph writes, validation, release publication, rollback, exports, and privileged access.
- Security Agent review is required for graph access policy, service account scopes, search authorization, and export controls.

## Compliance impact

- RDF-native release graphs support immutable, inspectable release snapshots.
- SHACL validation and validation run metadata support regulated release evidence.
- Named graph separation prevents AI suggestions and unapproved proposal state from being confused with accepted governed facts.
- Rollback can be implemented as an audited active-release pointer change rather than mutable graph surgery.
- Human review remains mandatory before regulated publication.

## Data/provenance impact

- Every promoted assertion must retain links to source graph, source artifact digest, source version, transform version, actor or service account, and validation run.
- Source graphs are source-version pinned.
- AI suggestions remain non-authoritative until human accepted.
- Release manifests identify semantic graph digests and object package digests.
- Search indexes and exports are derived artifacts and must be rebuildable from RDF, PostgreSQL metadata, and object storage.

## Rollback plan

If RDF-native storage proves unsuitable, keep service boundaries stable and migrate through the semantic repository interface:

1. Freeze new semantic writes.
2. Export all named graphs to standard RDF serialization with manifests and digests.
3. Load the exported graphs into the replacement semantic persistence layer.
4. Re-run SHACL validation and release manifest verification.
5. Rebuild search/vector indexes from the migrated semantic store.
6. Switch API and workflow adapters to the replacement backend.
7. Preserve old release graph exports and audit records for inspection.

Published releases remain immutable artifacts. Rollback of a bad release remains an active-release pointer change to a previous release ID.

## Reviewers

- Solution Architect Agent: Jim
- Security and Identity Agent: Oscar
- Compliance and Validation Agent: pending
- Ontology Architect Agent: pending
