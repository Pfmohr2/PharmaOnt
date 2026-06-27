# tests/security

RBAC, tenant isolation, export control, search leakage, audit coverage, and service-account tests.

Run the operational-schema data-layer suite with:

```bash
npm run test:security
```

The PostgreSQL-backed tests expect the local compose stack from `infra/docker/docker-compose.yml` to be running. They create an isolated temporary database inside the `postgres` service, apply `services/db/migrations/0001_operational_schema.sql`, execute the security assertions, and drop the database afterward.

If Docker is unavailable or the compose Postgres service is not healthy, the database-backed cases skip with an explicit reason instead of producing false failures.
