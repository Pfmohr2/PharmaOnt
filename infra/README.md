# PharmaOps Infra Runbook

Task:
Provide the local development scaffold and container stack for Phase 1 semantic-spine work.

Assumptions:
- `ARCHITECTURE.md` and `ADR-0001` select an RDF-native semantic core but leave the production RDF store vendor open.
- Local development uses Apache Jena Fuseki as the RDF/SPARQL server because it matches the RDF, named graph, SPARQL, and SHACL-oriented architecture contract without deciding the production vendor.
- PostgreSQL is the operational store for workflow state, users, jobs, approvals, release metadata, and audit indexes.
- This round is local/dev scaffold only; no cloud, Terraform implementation, Helm release, production secrets, or CI pipeline is introduced here.

Inputs Reviewed:
- `ARCHITECTURE.md`
- `docs/adr/ADR-0001-rdf-native-semantic-core.md`
- `DOMAIN_MODEL.md`
- `VOCABULARY_POLICY.md`
- `pharmaops_multi_agent_exportable_prompt.md` sections 4.3, 6.1, 7 Agent 24, and 16.

Changes Proposed:
- Add monorepo directory skeleton with placeholder README files.
- Add a local Docker Compose stack for Fuseki and PostgreSQL.
- Add environment-specific config files for `local`, `dev`, `test`, `staging`, `release_candidate`, and `production`.
- Add root Makefile targets to start, stop, and inspect the local stack.

Artifacts Created or Modified:
- `infra/docker/docker-compose.yml`
- `infra/env/*.env`
- `infra/README.md`
- root `Makefile`
- placeholder README files under `apps/`, `services/`, `ontologies/`, `packages/`, `connectors/`, `infra/`, `tests/`, and `docs/` subdirectories.

Interfaces Affected:
- Local backing service endpoints:
  - PostgreSQL: `localhost:${POSTGRES_PORT}`
  - Fuseki UI/API: `http://localhost:${FUSEKI_PORT}`
  - Fuseki dataset: `/${FUSEKI_DATASET}`
- No application runtime API contracts are created yet.

Tests Added or Required:
- Added Docker healthchecks for PostgreSQL and Fuseki.
- Required next: connector fixture tests, ontology/SHACL validation harness, migration dry-run checks, and service-level integration tests against this stack.

Security Impact:
- Local defaults are development-only and must not be reused outside local/dev fixtures.
- Production secrets are not stored here.
- Environment separation is represented as separate env files, ports, Compose project names, database names, dataset names, and volume prefixes.
- Backend service authorization remains required; container network separation is not a substitute for RBAC.

Compliance Impact:
- Local stack is for synthetic or public fixture data only.
- No production release authority is granted by this setup.
- Release-candidate and production env files are placeholders for separation and must be wired to approved secrets, retention, audit, backup, and validation controls before regulated use.

Data and Provenance Impact:
- Fuseki data and PostgreSQL data are persisted in Docker volumes scoped by environment name.
- Raw artifacts/object storage are not implemented in this round.
- Named graph policy remains governed by `ARCHITECTURE.md`; services must write tenant/source/release-scoped graph names.

Risks:
- Fuseki is a local development assumption, not a final production store decision.
- Docker image versions must be reviewed before promotion into shared dev or CI.
- The stack lacks object storage, queue/broker, search/vector index, observability, backups, and migration automation.
- Environment files provide separation metadata but not production-grade isolation by themselves.

Open Questions:
- Which RDF store is final for MVP production?
- Which search/vector stack will be selected?
- Which object storage and queue/broker are in Phase 1 versus Phase 2?

Handoff To:
- Solution Architect: confirm or supersede local Fuseki assumption with a production RDF-store ADR.
- Security and Identity: review local defaults, service-account boundaries, secret handling, and future production environment requirements.
- Compliance and Validation: connect SHACL and release validation harnesses to this stack.
- Ontology Architect: load ontology and shape fixtures into the RDF store.
- QA: add automated health, validation, fixture, and migration tests.

Definition of Done Status:
- Done for local scaffold and CI wiring: directory skeleton exists, Compose stack defines Fuseki and PostgreSQL with healthchecks, six environment config files exist, Makefile targets provide local up/down/logs/ps/live tests, and `.github/workflows/ci.yml` runs the semantic-spine CI gates against a live Docker stack.

## Local Up

Prerequisites:

- Docker Desktop or Docker Engine with Docker Compose v2.
- GNU Make for `make` targets. On Windows without Make, run the `docker compose` commands shown below directly.

Start local services:

```sh
make local-up
```

Equivalent Docker command:

```sh
docker compose --env-file infra/env/local.env -f infra/docker/docker-compose.yml up -d
```

Check service status:

```sh
make local-ps
```

Show logs:

```sh
make local-logs
```

Stop services:

```sh
make local-down
```

Run live-stack tests locally:

```sh
make local-up
```

In a shell where the local environment variables are exported, run:

```sh
npm run test:ontology
npm run test:security
npm test
```

On Bash-compatible shells:

```sh
set -a
. infra/env/local.env
set +a
npm run test:ontology
npm run test:security
npm test
```

The security suite uses `docker compose exec` against the running PostgreSQL service. If the tests cannot find the Compose project, confirm that `COMPOSE_PROJECT_NAME` matches `infra/env/local.env`.

Endpoints with default local config:

- Fuseki: `http://localhost:3030`
- Fuseki dataset: `http://localhost:3030/pharmaops`
- PostgreSQL: `localhost:5432`, database `pharmaops_local`

Default local credentials are in `infra/env/local.env`. They are for local fixtures only.

## Environments

| Environment | Config file | Separation notes |
|---|---|---|
| `local` | `infra/env/local.env` | Developer-only fixtures and public synthetic data; no release authority. |
| `dev` | `infra/env/dev.env` | Shared integration; separate Compose project, ports, database, dataset, and volume prefix from local. |
| `test` | `infra/env/test.env` | Automated integration, ontology, data-quality, security, and performance tests; generated/controlled fixtures only. |
| `staging` | `infra/env/staging.env` | Production-like rehearsal with sanitized or approved pilot data; no production release authority. |
| `release_candidate` | `infra/env/release_candidate.env` | Frozen candidate validation and evidence generation; can produce candidate artifacts, not production releases. |
| `production` | `infra/env/production.env` | Placeholder only in this repo. Must use approved secrets, tenant controls, backups, retention, audit, and release-manager authority before real use. |

Environment separation rules:

- Do not share service accounts, credentials, databases, Fuseki datasets, volumes, object prefixes, or release authority across environments.
- Tenant, environment, release, source-license, workflow-state, and resource scope must travel with service calls and persisted metadata.
- Production credentials and regulated data do not belong in checked-in env files.
- Release-candidate artifacts must be traceable to exact code, ontology, connector, parser, normalization, validation, and source snapshot versions.

## Notes on RDF Store Choice

`ARCHITECTURE.md` and `ADR-0001` fix the RDF-native semantic core but still list the production RDF-store vendor as an open question. This scaffold uses Apache Jena Fuseki for local development only. The semantic store adapter should hide Fuseki-specific details so a later production ADR can choose Fuseki, GraphDB, Stardog, Neptune, Oxigraph, or another SPARQL/SHACL-capable store without changing product semantics.

## CI

GitHub Actions workflow:

```text
.github/workflows/ci.yml
```

The workflow runs:

1. JavaScript syntax lint.
2. Contract declaration smoke type check.
3. `npm run test:unit`.
4. `npm run test:ingestion`.
5. Docker Compose startup for PostgreSQL and Fuseki.
6. Stack health wait using `pg_isready` and Fuseki `/$/ping`.
7. `npm run test:ontology`.
8. `npm run test:security`.
9. `npm test`.
10. E2E placeholder.

The workflow exports the same Compose environment values used to start the stack so live tests do not skip because they cannot find Docker, PostgreSQL, or Fuseki.
