# infra/ci

CI/CD notes for PharmaOps.

The active GitHub Actions workflow is `.github/workflows/ci.yml`.

Current Phase 1 gates:

- JavaScript syntax lint with `node --check`.
- Contract declaration smoke check for package `.d.ts` files.
- Unit tests with `npm run test:unit`.
- Ingestion runtime tests with `npm run test:ingestion`.
- Live Docker stack startup using `infra/docker/docker-compose.yml`.
- Ontology and SHACL fixture validation with `npm run test:ontology`.
- Security live-stack suite with `npm run test:security`.
- Full matrix with `npm test`.
- E2E placeholder until application/API workflows exist.

The CI job starts PostgreSQL and Apache Jena Fuseki through Docker Compose, waits for both health endpoints, runs the live-stack suites, and tears the stack down with volumes removed.

Future gates still required before release-candidate promotion:

- API contract tests.
- Dependency and static security scan.
- Container scan.
- Migration dry run.
- Connector fixture tests.
- Release-branch E2E smoke tests.
- Evidence artifact upload once ADR-0002 defines the regulated evidence store.
