import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const composeFile = resolve(repoRoot, "infra/docker/docker-compose.yml");
const migrationDir = resolve(repoRoot, "services/db/migrations");
const migrationFiles = readdirSync(migrationDir)
  .filter((file) => /^\d+_.*\.sql$/.test(file))
  .sort()
  .map((file) => resolve(migrationDir, file));

const postgresUser = process.env.POSTGRES_USER ?? "pharmaops";
const postgresDb = process.env.POSTGRES_DB ?? "pharmaops_local";
const testDb = `pharmaops_security_${process.pid}_${Date.now()}`.slice(0, 55).toLowerCase();

const tenantA = "00000000-0000-0000-0000-00000000000a";
const tenantB = "00000000-0000-0000-0000-00000000000b";

const dockerAvailable = commandSucceeds("docker", ["--version"]);
const postgresAvailable =
  dockerAvailable &&
  commandSucceeds("docker", [
    "compose",
    "-f",
    composeFile,
    "exec",
    "-T",
    "postgres",
    "pg_isready",
    "-U",
    postgresUser,
    "-d",
    postgresDb
  ]);
const skipReason = !dockerAvailable
  ? "Docker is not available in this shell"
  : !postgresAvailable
    ? "Postgres compose service is not running or not healthy"
    : false;

before(() => {
  if (skipReason) {
    return;
  }

  adminPsql("postgres", `DROP DATABASE IF EXISTS ${quoteIdent(testDb)};`);
  adminPsql("postgres", `CREATE DATABASE ${quoteIdent(testDb)};`);
  for (const migrationFile of migrationFiles) {
    adminPsql(testDb, readFileSync(migrationFile, "utf8"));
  }
  adminPsql(testDb, securityFixtureSql());
});

after(() => {
  if (skipReason) {
    return;
  }

  adminPsql("postgres", `DROP DATABASE IF EXISTS ${quoteIdent(testDb)} WITH (FORCE);`);
});

test("tenant-scoped app role cannot read another tenant's rows on tenant-owned operational tables", { skip: skipReason }, () => {
  const tables = adminPsql(
    testDb,
    `
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
      WHERE n.nspname = 'pharmaops'
        AND c.relkind = 'r'
      ORDER BY c.relname;
    `
  )
    .trim()
    .split("\n")
    .filter(Boolean);

  assert.ok(tables.length >= 18, `expected tenant-scoped tables, found ${tables.length}`);

  const leaks = [];
  const missingTenantRows = [];

  for (const table of tables) {
    const visibleTenantA = appPsqlInteger(`SELECT count(*) FROM pharmaops.${quoteIdent(table)} WHERE tenant_id = '${tenantA}';`);
    const leakedTenantB = appPsqlInteger(`SELECT count(*) FROM pharmaops.${quoteIdent(table)} WHERE tenant_id = '${tenantB}';`);

    if (visibleTenantA < 1) {
      missingTenantRows.push(table);
    }
    if (leakedTenantB !== 0) {
      leaks.push(`${table}:${leakedTenantB}`);
    }
  }

  assert.deepEqual(missingTenantRows, [], "fixture must include tenant A rows for every tenant-scoped table");
  assert.deepEqual(leaks, [], "tenant A scoped role must not see tenant B rows");
});

test("audit_events are append-only for normal application roles", { skip: skipReason }, () => {
  const auditEventId = "aaaaaaaa-0000-0000-0000-000000000101";

  appPsql(`
    INSERT INTO pharmaops.audit_events (
      audit_event_id,
      event_type,
      tenant_id,
      environment,
      actor_user_id,
      actor_role_key,
      actor_type,
      correlation_id,
      resource_type,
      resource_id,
      action,
      outcome,
      rationale
    )
    VALUES (
      '${auditEventId}',
      'security_test_insert',
      '${tenantA}',
      'dev',
      '10000000-0000-0000-0000-000000000101',
      'security_admin',
      'human',
      'corr-security-test-insert',
      'audit_event',
      '${auditEventId}',
      'insert',
      'success',
      'prove normal app role can append audit events'
    );
  `);

  assertSqlFails(
    () => appPsql(`UPDATE pharmaops.audit_events SET rationale = 'tampered' WHERE audit_event_id = '${auditEventId}';`),
    /permission denied|append-only/i
  );

  assertSqlFails(
    () => appPsql(`DELETE FROM pharmaops.audit_events WHERE audit_event_id = '${auditEventId}';`),
    /permission denied|append-only/i
  );
});

test("RBAC negative controls reject self-approval, viewer export permission, privileged self-approval, and break-glass without audit", { skip: skipReason }, () => {
  assertSqlFails(
    () =>
      adminPsql(
        testDb,
        `
          INSERT INTO pharmaops.approvals (
            tenant_id,
            proposal_id,
            approval_type,
            approved_object_type,
            approved_object_id,
            actor_user_id,
            actor_role_id,
            decision,
            rationale
          )
          VALUES (
            '${tenantA}',
            '30000000-0000-0000-0000-000000000101',
            'domain',
            'mapping',
            'pharmmap:self-approval',
            '10000000-0000-0000-0000-000000000102',
            (SELECT role_id FROM pharmaops.roles WHERE role_key = 'contributor'),
            'approved',
            'attempt self approval'
          );
        `
      ),
    /cannot approve their own governed proposal/i
  );

  const viewerExportPermissionCount = Number(
    adminPsql(
      testDb,
      `
        SELECT count(*)
        FROM pharmaops.roles r
        JOIN pharmaops.role_permissions rp ON rp.role_id = r.role_id
        JOIN pharmaops.permissions p ON p.permission_id = rp.permission_id
        WHERE r.role_key = 'viewer'
          AND p.permission_key IN ('export.release_package', 'service_account.export_grant', 'audit.export');
      `
    )
  );
  assert.equal(viewerExportPermissionCount, 0, "viewer must not have export or audit-export permissions");

  assertSqlFails(
    () =>
      adminPsql(
        testDb,
        `
          INSERT INTO pharmaops.role_assignments (
            tenant_id,
            principal_type,
            user_id,
            role_id,
            environment,
            rationale,
            approved_by_user_id,
            created_by_user_id
          )
          VALUES (
            '${tenantA}',
            'human',
            '10000000-0000-0000-0000-000000000102',
            (SELECT role_id FROM pharmaops.roles WHERE role_key = 'security_admin'),
            'production',
            'attempt privileged grant without second approver',
            '10000000-0000-0000-0000-000000000104',
            '10000000-0000-0000-0000-000000000104'
          );
        `
      ),
    /require a second approver/i
  );

  assertSqlFails(
    () =>
      adminPsql(
        testDb,
        `
          INSERT INTO pharmaops.role_assignments (
            tenant_id,
            principal_type,
            user_id,
            role_id,
            environment,
            rationale,
            approved_by_user_id,
            second_approved_by_user_id,
            created_by_user_id
          )
          VALUES (
            '${tenantA}',
            'human',
            '10000000-0000-0000-0000-000000000102',
            (SELECT role_id FROM pharmaops.roles WHERE role_key = 'security_admin'),
            'production',
            'attempt self approved privileged grant',
            '10000000-0000-0000-0000-000000000104',
            '10000000-0000-0000-0000-000000000102',
            '10000000-0000-0000-0000-000000000104'
          );
        `
      ),
    /self-approved|role_assignment_no_self_second_approval/i
  );

  assertSqlFails(
    () =>
      adminPsql(
        testDb,
        `
          INSERT INTO pharmaops.break_glass_sessions (
            tenant_id,
            environment,
            requested_by_user_id,
            approved_by_user_id,
            second_approved_by_user_id,
            status,
            scope,
            rationale,
            expires_at
          )
          VALUES (
            '${tenantA}',
            'production',
            '10000000-0000-0000-0000-000000000104',
            '10000000-0000-0000-0000-000000000103',
            '10000000-0000-0000-0000-000000000106',
            'active',
            '{"tenant_id":"${tenantA}","graph_family":"release"}',
            'support incident',
            now() + interval '1 hour'
          );
        `
      ),
    /requires an audit event reference/i
  );
});

test("service-account export grants require human owner, release scope, license policy, destination, and expiry", { skip: skipReason }, () => {
  assertSqlFails(
    () =>
      adminPsql(
        testDb,
        `
          INSERT INTO pharmaops.service_account_export_grants (
            tenant_id,
            service_account_id,
            owning_human_role,
            owning_user_id,
            environment,
            release_id,
            destination_uri,
            export_format,
            license_policy_id,
            rationale,
            expires_at
          )
          VALUES (
            '${tenantA}',
            '20000000-0000-0000-0000-000000000101',
            'release_manager',
            '10000000-0000-0000-0000-000000000105',
            'production',
            'working',
            's3://tenant-a/export',
            'jsonl',
            'license-policy:open',
            'attempt working state export',
            now() + interval '1 hour'
          );
        `
      ),
    /export_grant_release_not_working/i
  );

  assertSqlFails(
    () =>
      adminPsql(
        testDb,
        `
          INSERT INTO pharmaops.service_account_export_grants (
            tenant_id,
            service_account_id,
            owning_human_role,
            owning_user_id,
            environment,
            release_id,
            destination_uri,
            export_format,
            rationale,
            expires_at
          )
          VALUES (
            '${tenantA}',
            '20000000-0000-0000-0000-000000000101',
            'release_manager',
            '10000000-0000-0000-0000-000000000105',
            'production',
            'release:v1',
            's3://tenant-a/export',
            'jsonl',
            'attempt missing license policy',
            now() + interval '1 hour'
          );
        `
      ),
    /license_policy_id/i
  );

  adminPsql(
    testDb,
    `
      INSERT INTO pharmaops.service_account_export_grants (
        export_grant_id,
        tenant_id,
        service_account_id,
        owning_human_role,
        owning_user_id,
        environment,
        release_id,
        destination_uri,
        export_format,
        license_policy_id,
        permitted_source_classes,
        status,
        approved_by_user_id,
        second_approved_by_user_id,
        rationale,
        expires_at,
        audit_event_id
      )
      VALUES (
        '92000000-0000-0000-0000-000000000101',
        '${tenantA}',
        '20000000-0000-0000-0000-000000000101',
        'release_manager',
        '10000000-0000-0000-0000-000000000105',
        'production',
        'release:v1',
        's3://tenant-a/export',
        'jsonl',
        'license-policy:open',
        ARRAY['open_materializable'],
        'active',
        '10000000-0000-0000-0000-000000000103',
        '10000000-0000-0000-0000-000000000106',
        'approved release export',
        now() + interval '1 hour',
        '90000000-0000-0000-0000-000000000101'
      );
    `
  );
});

test("ADR-0002-dependent audit storage decisions are explicitly marked in DB docs", () => {
  const readme = readFileSync(resolve(repoRoot, "services/db/README.md"), "utf8");

  assert.match(readme, /ADR-0002 makes `pharmaops\.audit_events` the canonical searchable audit-event system of record/i);
  assert.match(readme, /release_metadata` is the canonical searchable release-package ledger row/i);
  assert.match(readme, /retention or object-lock/i);
});

test("Phase 2 ingestion security model documents connector service-account invariants", () => {
  const note = readFileSync(resolve(repoRoot, "docs/ingestion-security.md"), "utf8");
  const migration = readFileSync(resolve(repoRoot, "services/db/migrations/0003_ingestion_service_account_scopes.sql"), "utf8");

  assert.match(note, /Each connector job runs as a tenant-owned `service_account` principal/i);
  assert.match(note, /No license pass can grant a connector service account additional RBAC power/i);
  assert.match(note, /No service-account scope can override a license block/i);
  assert.match(note, /introduced after fetch during normalization or candidate generation/i);
  assert.match(note, /enforced on the write attempt itself/i);
  assert.match(note, /Connector checkpoints and `run_lineage_id` values are tenant-scoped security data/i);
  assert.match(note, /Checkpoints must be signed or MAC-bound by the ingestion runtime/i);
  assert.match(note, /Cross-tenant, cross-connector, cross-source, and cross-service-account checkpoint replay is denied/i);
  assert.match(note, /graph\.write_released/);
  assert.match(note, /SET LOCAL app\.allow_cross_tenant = 'false'/);
  assert.match(migration, /connector_service_account_scope_templates/);
  assert.match(migration, /service_account_scope_no_connector_forbidden_actions/);
  assert.match(migration, /connector\.write_working_graph_candidate/);
  assert.match(migration, /connector\.replay_checkpoint/);
  assert.match(migration, /connector_checkpoint_replay/);
});

test("Phase 3 governed mapping RBAC documents server-side decision invariants", () => {
  const note = readFileSync(resolve(repoRoot, "docs/curation-rbac.md"), "utf8");
  const migration = readFileSync(resolve(repoRoot, "services/db/migrations/0004_curation_mapping_rbac.sql"), "utf8");

  assert.match(note, /Frontend controls may hide buttons, but they are not an authorization boundary/i);
  assert.match(note, /mapping_candidate\.approve/);
  assert.match(note, /mapping_candidate\.reject/);
  assert.match(note, /mapping_candidate\.stage_release/);
  assert.match(note, /function assertCanGovernMappingCandidate/);
  assert.match(note, /type GovernedMappingAuthorizationDecision/);
  assert.match(note, /MappingRegistry\.createMapping/);
  assert.match(note, /MappingRegistry\.updateMapping/);
  assert.match(note, /not a caller-authored `\{ authorized: true \}` flag/);
  assert.match(note, /`signature` is a MAC or signature over `decision_binding`/i);
  assert.match(note, /decision is single-use for one registry write/i);
  assert.match(note, /registry must reject replayed decisions, expired decisions, cross-tenant decisions, cross-candidate decisions/i);
  assert.match(note, /actor cannot approve, reject, or stage/i);
  assert.match(note, /source_vocabulary_version/);
  assert.match(note, /target_vocabulary_version/);
  assert.match(note, /confidence_score/);
  assert.match(note, /Every allowed decision must write the workflow state transition, review or approval row, and audit event/i);
  assert.match(migration, /governed_mapping_action_policies/);
  assert.match(migration, /governed_mapping_action_role_allowed/);
  assert.match(migration, /WHERE r\.role_key IN \('curator', 'domain_approver'\)/);
  assert.match(migration, /WHERE r\.role_key = 'release_manager'/);
  assert.match(migration, /mapping_candidate\.stage_release/);
});

test("Phase 4 proposal lifecycle RBAC documents role boundaries and signed decisions", () => {
  const note = readFileSync(resolve(repoRoot, "docs/curation-rbac.md"), "utf8");
  const securityModel = readFileSync(resolve(repoRoot, "SECURITY_MODEL.md"), "utf8");
  const readme = readFileSync(resolve(repoRoot, "services/db/README.md"), "utf8");
  const migration = readFileSync(resolve(repoRoot, "services/db/migrations/0005_proposal_lifecycle_rbac.sql"), "utf8");

  assert.match(note, /Phase 4 Proposal Lifecycle RBAC/);
  assert.match(note, /`proposal\.submit`/);
  assert.match(note, /`proposal\.validate`/);
  assert.match(note, /`proposal\.route_curator_review`/);
  assert.match(note, /`proposal\.route_approver_decision`/);
  assert.match(note, /`proposal\.approve`/);
  assert.match(note, /`proposal\.reject`/);
  assert.match(note, /`proposal\.stage_release`/);
  assert.match(note, /`release_candidate\.create`/);
  assert.match(note, /function assertCanGovernProposal/);
  assert.match(note, /function assertCanSubmitProposal/);
  assert.match(note, /function assertCanRouteProposal/);
  assert.match(note, /function assertCanApproveRejectProposal/);
  assert.match(note, /function assertCanCreateReleaseCandidate/);
  assert.match(note, /proposal_type/);
  assert.match(note, /previous_state/);
  assert.match(note, /next_state/);
  assert.match(note, /validation_report_id/);
  assert.match(note, /type ProposalLifecycleAuthorizationDecision/);
  assert.match(note, /type ReleaseCandidateAuthorizationDecision/);
  assert.match(note, /all_approved: true/);
  assert.match(note, /validation_passed: true/);
  assert.match(note, /not a caller-authored boolean/i);
  assert.match(note, /decisions are short-lived and single-use/i);
  assert.match(note, /Service accounts cannot submit governed proposals, validate, route, approve, reject, stage, create release candidates/i);
  assert.match(note, /release-candidate decisions with missing all-approved evidence/i);
  assert.match(note, /release-candidate decisions without validation-passed evidence/i);

  assert.match(migration, /proposal_lifecycle_action_policies/);
  assert.match(migration, /proposal_lifecycle_action_role_allowed/);
  assert.match(migration, /WHERE r\.role_key = 'contributor'/);
  assert.match(migration, /WHERE r\.role_key = 'curator'/);
  assert.match(migration, /WHERE r\.role_key = 'domain_approver'/);
  assert.match(migration, /WHERE r\.role_key = 'release_manager'/);
  assert.match(migration, /requires_all_approved/);
  assert.match(migration, /requires_signed_decision/);
  assert.match(migration, /service_account_scope_no_connector_forbidden_actions/);
  assert.match(migration, /'proposal\.submit'/);
  assert.match(migration, /'proposal\.approve'/);
  assert.match(migration, /'release_candidate\.create'/);

  assert.match(securityModel, /Phase 4 proposal lifecycle RBAC is also specified in `docs\/curation-rbac\.md`/);
  assert.match(securityModel, /Service accounts cannot govern proposals or create release candidates/);
  assert.match(readme, /0005_proposal_lifecycle_rbac\.sql/);
});

test("Phase 4 immutable governance proof model requires server-side persisted-record verification", () => {
  const note = readFileSync(resolve(repoRoot, "docs/curation-rbac.md"), "utf8");
  const securityModel = readFileSync(resolve(repoRoot, "SECURITY_MODEL.md"), "utf8");

  for (const artifact of [
    /Signed governed decision/,
    /Workflow staged entry/,
    /Validation-run record/,
    /Release-candidate manifest digest/,
    /Immutable audit event/
  ]) {
    assert.match(securityModel, artifact);
  }

  assert.match(securityModel, /no service may trust caller-supplied copies of governed decisions, staged entries, validation evidence, release-candidate manifest digests, snapshot references, or audit IDs/i);
  assert.match(securityModel, /resolve the referenced record by ID from its authoritative store under the same tenant and environment/i);
  assert.match(securityModel, /Inline evidence is advisory only and must be ignored for authorization/i);
  assert.match(securityModel, /Replay, cross-tenant references, missing resolver records, mutable records, digest mismatches, unsigned decisions, expired decisions, stale validation runs/i);
  assert.match(securityModel, /Jim must persist manifest bytes immutably, compute the digest server-side, insert or resolve the ledger row/i);
  assert.match(securityModel, /Phyllis and Jim must append or reserve audit records server-side/i);
  assert.match(securityModel, /Phyllis and Jim must resolve validation records through Andy's validation service/i);

  assert.match(note, /Immutable Governance Proof Verification/);
  assert.match(note, /Request payloads may carry IDs such as `decision_id`, `staged_entry_id`, `validation_run_id`, `release_candidate_id`, `manifest_digest`, or `audit_event_id`; they must not carry authoritative governed state/i);
  assert.match(note, /Jim must load staged entries server-side by release scope or staged entry ID/i);
  assert.match(note, /Phyllis and Jim must resolve validation records server-side/i);
  assert.match(note, /Jim must compute the manifest digest from bytes written immutably and reconcile it with `pharmaops\.release_metadata\.manifest_digest`/);
  assert.match(note, /caller cannot fabricate governance by sending `\{ authorized: true \}`, inline validation summaries, inline staged entries, snapshot refs, manifest digests, or audit IDs/i);
});

test("release_metadata rejects rows weaker than the ADR-0002 canonical ledger contract", { skip: skipReason }, () => {
  assertSqlFails(
    () => adminPsql(testDb, `
      INSERT INTO pharmaops.release_metadata (
        tenant_id,
        environment,
        release_id,
        semantic_version,
        status,
        manifest_uri,
        manifest_digest,
        source_version_pins,
        included_graphs,
        validation_report_refs,
        artifact_hashes,
        approval_trace,
        audit_event_range,
        created_by_user_id
      )
      VALUES (
        '${tenantA}',
        'dev',
        'release:bad-digest',
        '1.0.1',
        'candidate',
        's3://pharmaops-release-packages/${tenantA}/release-bad-digest/manifest.json',
        'sha256:not-a-real-digest',
        '[{"source":"git","ref":"abc123"}]'::jsonb,
        '[{"graph_name":"urn:graph:a","digest":"sha256:${"a".repeat(64)}"}]'::jsonb,
        '[{"uri":"s3://validation/report.json","digest":"sha256:${"b".repeat(64)}"}]'::jsonb,
        '{"urn:graph:a":"sha256:${"a".repeat(64)}"}'::jsonb,
        '[{"approval_id":"approval-1","decision":"approved"}]'::jsonb,
        '{"first":"audit-1","last":"audit-2"}'::jsonb,
        '10000000-0000-0000-0000-000000000105'
      );
    `),
    /release_metadata_manifest_digest_format/
  );

  assertSqlFails(
    () => adminPsql(testDb, `
      INSERT INTO pharmaops.release_metadata (
        tenant_id,
        environment,
        release_id,
        semantic_version,
        status,
        manifest_uri,
        manifest_digest,
        source_version_pins,
        included_graphs,
        validation_report_refs,
        artifact_hashes,
        approval_trace,
        audit_event_range,
        created_by_user_id
      )
      VALUES (
        '${tenantA}',
        'dev',
        'release:missing-evidence',
        '1.0.2',
        'candidate',
        's3://pharmaops-release-packages/${tenantA}/release-missing-evidence/manifest.json',
        'sha256:${"c".repeat(64)}',
        '[]'::jsonb,
        '[{"graph_name":"urn:graph:a","digest":"sha256:${"a".repeat(64)}"}]'::jsonb,
        '[{"uri":"s3://validation/report.json","digest":"sha256:${"b".repeat(64)}"}]'::jsonb,
        '{"urn:graph:a":"sha256:${"a".repeat(64)}"}'::jsonb,
        '[{"approval_id":"approval-1","decision":"approved"}]'::jsonb,
        '{"first":"audit-1","last":"audit-2"}'::jsonb,
        '10000000-0000-0000-0000-000000000105'
      );
    `),
    /release_metadata_promoted_rows_have_evidence/
  );
});

test("normal app role cannot write release_metadata ledger rows directly", { skip: skipReason }, () => {
  assertSqlFails(
    () => appPsql(`
      INSERT INTO pharmaops.release_metadata (
        tenant_id,
        environment,
        release_id,
        semantic_version,
        status,
        manifest_uri,
        manifest_digest,
        source_version_pins,
        included_graphs,
        validation_report_refs,
        artifact_hashes,
        approval_trace,
        audit_event_range,
        created_by_user_id
      )
      VALUES (
        '${tenantA}',
        'dev',
        'release:direct-app-write',
        '1.0.3',
        'candidate',
        's3://pharmaops-release-packages/${tenantA}/release-direct-app-write/manifest.json',
        'sha256:${"d".repeat(64)}',
        '[{"source":"git","ref":"abc123"}]'::jsonb,
        '[{"graph_name":"urn:graph:a","digest":"sha256:${"a".repeat(64)}"}]'::jsonb,
        '[{"uri":"s3://validation/report.json","digest":"sha256:${"b".repeat(64)}"}]'::jsonb,
        '{"urn:graph:a":"sha256:${"a".repeat(64)}"}'::jsonb,
        '[{"approval_id":"approval-1","decision":"approved"}]'::jsonb,
        '{"first":"audit-1","last":"audit-2"}'::jsonb,
        '10000000-0000-0000-0000-000000000105'
      );
    `),
    /permission denied|permission denied for table release_metadata/
  );
});

function adminPsql(database, sql) {
  return execFileSync(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      postgresUser,
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-At"
    ],
    {
      cwd: repoRoot,
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
}

function appPsql(sql) {
  return adminPsql(
    testDb,
    `
      SET ROLE pharmaops_app_test;
      BEGIN;
      SET LOCAL app.tenant_id = '${tenantA}';
      SET LOCAL app.environment = 'dev';
      SET LOCAL app.allow_cross_tenant = 'false';
      ${sql}
      COMMIT;
      RESET ROLE;
    `
  ).trim();
}

function appPsqlInteger(sql) {
  const output = appPsql(sql);
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const commandStatusLines = new Set(["SET", "BEGIN", "COMMIT", "RESET"]);
  const integerLines = lines.filter((line) => /^-?\d+$/.test(line));
  const unexpectedLines = lines.filter((line) => !commandStatusLines.has(line) && !/^-?\d+$/.test(line));

  assert.deepEqual(unexpectedLines, [], `unexpected SQL output while parsing integer result: ${output}`);
  assert.equal(integerLines.length, 1, `expected exactly one integer SQL result line, got ${integerLines.length}: ${output}`);

  return Number(integerLines[0]);
}

function assertSqlFails(runSql, pattern) {
  try {
    runSql();
  } catch (error) {
    const output = [
      error.stdout?.toString?.() ?? "",
      error.stderr?.toString?.() ?? "",
      error.message ?? ""
    ].join("\n");
    assert.match(output, pattern);
    return;
  }

  assert.fail("expected SQL command to fail");
}

function commandSucceeds(command, args) {
  try {
    execFileSync(command, args, {
      cwd: repoRoot,
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

function quoteIdent(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function securityFixtureSql() {
  return `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharmaops_app_test') THEN
        CREATE ROLE pharmaops_app_test;
      END IF;
    END $$;

    GRANT USAGE ON SCHEMA pharmaops TO pharmaops_app_test;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA pharmaops TO pharmaops_app_test;
    REVOKE UPDATE, DELETE ON pharmaops.audit_events FROM pharmaops_app_test;
    GRANT INSERT, SELECT ON pharmaops.audit_events TO pharmaops_app_test;
    REVOKE INSERT, UPDATE, DELETE ON pharmaops.release_metadata FROM pharmaops_app_test;
    GRANT SELECT ON pharmaops.release_metadata TO pharmaops_app_test;

    INSERT INTO pharmaops.tenants (tenant_id, tenant_key, display_name)
    VALUES
      ('${tenantA}', 'tenant-a', 'Tenant A'),
      ('${tenantB}', 'tenant-b', 'Tenant B');

    INSERT INTO pharmaops.users (user_id, tenant_id, external_subject, email, display_name)
    VALUES
      ('10000000-0000-0000-0000-000000000101', '${tenantA}', 'viewer-a', 'viewer-a@example.test', 'Viewer A'),
      ('10000000-0000-0000-0000-000000000102', '${tenantA}', 'contributor-a', 'contributor-a@example.test', 'Contributor A'),
      ('10000000-0000-0000-0000-000000000103', '${tenantA}', 'approver-a', 'approver-a@example.test', 'Approver A'),
      ('10000000-0000-0000-0000-000000000104', '${tenantA}', 'security-a', 'security-a@example.test', 'Security A'),
      ('10000000-0000-0000-0000-000000000105', '${tenantA}', 'owner-a', 'owner-a@example.test', 'Owner A'),
      ('10000000-0000-0000-0000-000000000106', '${tenantA}', 'compliance-a', 'compliance-a@example.test', 'Compliance A'),
      ('11000000-0000-0000-0000-000000000101', '${tenantB}', 'viewer-b', 'viewer-b@example.test', 'Viewer B'),
      ('11000000-0000-0000-0000-000000000102', '${tenantB}', 'contributor-b', 'contributor-b@example.test', 'Contributor B'),
      ('11000000-0000-0000-0000-000000000103', '${tenantB}', 'approver-b', 'approver-b@example.test', 'Approver B'),
      ('11000000-0000-0000-0000-000000000104', '${tenantB}', 'security-b', 'security-b@example.test', 'Security B'),
      ('11000000-0000-0000-0000-000000000105', '${tenantB}', 'owner-b', 'owner-b@example.test', 'Owner B'),
      ('11000000-0000-0000-0000-000000000106', '${tenantB}', 'compliance-b', 'compliance-b@example.test', 'Compliance B');

    INSERT INTO pharmaops.service_accounts (
      service_account_id,
      tenant_id,
      name,
      owner_user_id,
      owning_human_role,
      environment,
      service_purpose,
      secret_ref,
      expires_at,
      rotation_due_at
    )
    VALUES
      ('20000000-0000-0000-0000-000000000101', '${tenantA}', 'export-worker-a', '10000000-0000-0000-0000-000000000105', 'release_manager', 'production', 'release export', 'vault://tenant-a/export-worker', now() + interval '30 days', now() + interval '15 days'),
      ('21000000-0000-0000-0000-000000000101', '${tenantB}', 'export-worker-b', '11000000-0000-0000-0000-000000000105', 'release_manager', 'production', 'release export', 'vault://tenant-b/export-worker', now() + interval '30 days', now() + interval '15 days');

    INSERT INTO pharmaops.audit_events (
      audit_event_id,
      event_type,
      tenant_id,
      environment,
      actor_user_id,
      actor_role_key,
      actor_type,
      correlation_id,
      resource_type,
      resource_id,
      action,
      outcome,
      rationale
    )
    VALUES
      ('90000000-0000-0000-0000-000000000101', 'fixture_created', '${tenantA}', 'dev', '10000000-0000-0000-0000-000000000104', 'security_admin', 'human', 'corr-a', 'fixture', 'tenant-a', 'create', 'success', 'fixture setup'),
      ('91000000-0000-0000-0000-000000000101', 'fixture_created', '${tenantB}', 'dev', '11000000-0000-0000-0000-000000000104', 'security_admin', 'human', 'corr-b', 'fixture', 'tenant-b', 'create', 'success', 'fixture setup');

    INSERT INTO pharmaops.role_assignments (
      role_assignment_id,
      tenant_id,
      principal_type,
      user_id,
      role_id,
      environment,
      rationale,
      approved_by_user_id,
      second_approved_by_user_id,
      created_by_user_id
    )
    VALUES
      ('22000000-0000-0000-0000-000000000101', '${tenantA}', 'human', '10000000-0000-0000-0000-000000000101', (SELECT role_id FROM pharmaops.roles WHERE role_key = 'viewer'), 'dev', 'fixture viewer', '10000000-0000-0000-0000-000000000104', NULL, '10000000-0000-0000-0000-000000000104'),
      ('22000000-0000-0000-0000-000000000102', '${tenantA}', 'human', '10000000-0000-0000-0000-000000000104', (SELECT role_id FROM pharmaops.roles WHERE role_key = 'security_admin'), 'production', 'fixture security admin', '10000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000106', '10000000-0000-0000-0000-000000000103'),
      ('22000000-0000-0000-0000-000000000103', '${tenantB}', 'human', '11000000-0000-0000-0000-000000000101', (SELECT role_id FROM pharmaops.roles WHERE role_key = 'viewer'), 'dev', 'fixture viewer', '11000000-0000-0000-0000-000000000104', NULL, '11000000-0000-0000-0000-000000000104');

    INSERT INTO pharmaops.security_change_requests (
      security_change_request_id,
      tenant_id,
      environment,
      change_type,
      requested_by_user_id,
      beneficiary_user_id,
      second_approver_user_id,
      status,
      rationale,
      requested_scope,
      expires_at,
      audit_event_id
    )
    VALUES
      ('23000000-0000-0000-0000-000000000101', '${tenantA}', 'production', 'privileged_role_grant', '10000000-0000-0000-0000-000000000104', '10000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000106', 'approved', 'fixture privileged grant', '{"role":"security_admin"}', now() + interval '1 hour', '90000000-0000-0000-0000-000000000101'),
      ('23000000-0000-0000-0000-000000000102', '${tenantB}', 'production', 'privileged_role_grant', '11000000-0000-0000-0000-000000000104', '11000000-0000-0000-0000-000000000102', '11000000-0000-0000-0000-000000000106', 'approved', 'fixture privileged grant', '{"role":"security_admin"}', now() + interval '1 hour', '91000000-0000-0000-0000-000000000101');

    INSERT INTO pharmaops.service_account_scopes (
      service_account_scope_id,
      tenant_id,
      service_account_id,
      environment,
      resource_type,
      resource_pattern,
      allowed_actions,
      license_policy_id,
      expires_at,
      approved_by_user_id,
      second_approved_by_user_id,
      rationale
    )
    VALUES
      ('24000000-0000-0000-0000-000000000101', '${tenantA}', '20000000-0000-0000-0000-000000000101', 'production', 'object_prefix', 's3://tenant-a/releases/*', ARRAY['read','write'], 'license-policy:open', now() + interval '1 day', '10000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000106', 'fixture scope'),
      ('24000000-0000-0000-0000-000000000102', '${tenantB}', '21000000-0000-0000-0000-000000000101', 'production', 'object_prefix', 's3://tenant-b/releases/*', ARRAY['read','write'], 'license-policy:open', now() + interval '1 day', '11000000-0000-0000-0000-000000000103', '11000000-0000-0000-0000-000000000106', 'fixture scope');

    INSERT INTO pharmaops.service_account_export_grants (
      export_grant_id,
      tenant_id,
      service_account_id,
      owning_human_role,
      owning_user_id,
      environment,
      release_id,
      destination_uri,
      export_format,
      license_policy_id,
      permitted_source_classes,
      status,
      approved_by_user_id,
      second_approved_by_user_id,
      rationale,
      expires_at,
      audit_event_id
    )
    VALUES
      ('25000000-0000-0000-0000-000000000101', '${tenantA}', '20000000-0000-0000-0000-000000000101', 'release_manager', '10000000-0000-0000-0000-000000000105', 'production', 'release:v1', 's3://tenant-a/releases/v1', 'jsonl', 'license-policy:open', ARRAY['open_materializable'], 'active', '10000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000106', 'fixture export grant', now() + interval '1 day', '90000000-0000-0000-0000-000000000101'),
      ('25000000-0000-0000-0000-000000000102', '${tenantB}', '21000000-0000-0000-0000-000000000101', 'release_manager', '11000000-0000-0000-0000-000000000105', 'production', 'release:v1', 's3://tenant-b/releases/v1', 'jsonl', 'license-policy:open', ARRAY['open_materializable'], 'active', '11000000-0000-0000-0000-000000000103', '11000000-0000-0000-0000-000000000106', 'fixture export grant', now() + interval '1 day', '91000000-0000-0000-0000-000000000101');

    INSERT INTO pharmaops.break_glass_sessions (
      break_glass_session_id,
      tenant_id,
      environment,
      requested_by_user_id,
      approved_by_user_id,
      second_approved_by_user_id,
      status,
      scope,
      rationale,
      starts_at,
      expires_at,
      audit_event_id
    )
    VALUES
      ('26000000-0000-0000-0000-000000000101', '${tenantA}', 'production', '10000000-0000-0000-0000-000000000104', '10000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000106', 'active', '{"tenant_id":"${tenantA}"}', 'fixture break glass', now(), now() + interval '1 hour', '90000000-0000-0000-0000-000000000101'),
      ('26000000-0000-0000-0000-000000000102', '${tenantB}', 'production', '11000000-0000-0000-0000-000000000104', '11000000-0000-0000-0000-000000000103', '11000000-0000-0000-0000-000000000106', 'active', '{"tenant_id":"${tenantB}"}', 'fixture break glass', now(), now() + interval '1 hour', '91000000-0000-0000-0000-000000000101');

    INSERT INTO pharmaops.proposals (
      proposal_id,
      tenant_id,
      environment,
      proposal_key,
      proposal_kind,
      title,
      lifecycle_status,
      semantic_object_type,
      semantic_object_id,
      graph_name,
      provenance_ref,
      created_by_user_id
    )
    VALUES
      ('30000000-0000-0000-0000-000000000101', '${tenantA}', 'dev', 'proposal-a', 'mapping', 'Tenant A proposal', 'proposed', 'mapping', 'pharmmap:tenant-a', 'graph:tenant:a:mappings:working', '{"source":"fixture"}', '10000000-0000-0000-0000-000000000102'),
      ('31000000-0000-0000-0000-000000000101', '${tenantB}', 'dev', 'proposal-b', 'mapping', 'Tenant B proposal', 'proposed', 'mapping', 'pharmmap:tenant-b', 'graph:tenant:b:mappings:working', '{"source":"fixture"}', '11000000-0000-0000-0000-000000000102');

    INSERT INTO pharmaops.reviews (
      review_id,
      tenant_id,
      proposal_id,
      reviewer_user_id,
      reviewer_role_id,
      decision,
      rationale
    )
    VALUES
      ('32000000-0000-0000-0000-000000000101', '${tenantA}', '30000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000103', (SELECT role_id FROM pharmaops.roles WHERE role_key = 'domain_approver'), 'pending', 'fixture review'),
      ('32000000-0000-0000-0000-000000000102', '${tenantB}', '31000000-0000-0000-0000-000000000101', '11000000-0000-0000-0000-000000000103', (SELECT role_id FROM pharmaops.roles WHERE role_key = 'domain_approver'), 'pending', 'fixture review');

    INSERT INTO pharmaops.approvals (
      approval_id,
      tenant_id,
      proposal_id,
      approval_type,
      approved_object_type,
      approved_object_id,
      actor_user_id,
      actor_role_id,
      decision,
      rationale,
      audit_event_id
    )
    VALUES
      ('33000000-0000-0000-0000-000000000101', '${tenantA}', '30000000-0000-0000-0000-000000000101', 'domain', 'mapping', 'pharmmap:tenant-a', '10000000-0000-0000-0000-000000000103', (SELECT role_id FROM pharmaops.roles WHERE role_key = 'domain_approver'), 'approved', 'fixture approval', '90000000-0000-0000-0000-000000000101'),
      ('33000000-0000-0000-0000-000000000102', '${tenantB}', '31000000-0000-0000-0000-000000000101', 'domain', 'mapping', 'pharmmap:tenant-b', '11000000-0000-0000-0000-000000000103', (SELECT role_id FROM pharmaops.roles WHERE role_key = 'domain_approver'), 'approved', 'fixture approval', '91000000-0000-0000-0000-000000000101');

    INSERT INTO pharmaops.review_queues (review_queue_id, tenant_id, queue_key, display_name, owning_role_id)
    VALUES
      ('34000000-0000-0000-0000-000000000101', '${tenantA}', 'domain-review-a', 'Domain review A', (SELECT role_id FROM pharmaops.roles WHERE role_key = 'domain_approver')),
      ('34000000-0000-0000-0000-000000000102', '${tenantB}', 'domain-review-b', 'Domain review B', (SELECT role_id FROM pharmaops.roles WHERE role_key = 'domain_approver'));

    INSERT INTO pharmaops.review_queue_items (review_queue_item_id, tenant_id, review_queue_id, proposal_id)
    VALUES
      ('35000000-0000-0000-0000-000000000101', '${tenantA}', '34000000-0000-0000-0000-000000000101', '30000000-0000-0000-0000-000000000101'),
      ('35000000-0000-0000-0000-000000000102', '${tenantB}', '34000000-0000-0000-0000-000000000102', '31000000-0000-0000-0000-000000000101');

    INSERT INTO pharmaops.comments (comment_id, tenant_id, proposal_id, body, created_by_user_id)
    VALUES
      ('36000000-0000-0000-0000-000000000101', '${tenantA}', '30000000-0000-0000-0000-000000000101', 'Tenant A comment', '10000000-0000-0000-0000-000000000102'),
      ('36000000-0000-0000-0000-000000000102', '${tenantB}', '31000000-0000-0000-0000-000000000101', 'Tenant B comment', '11000000-0000-0000-0000-000000000102');

    INSERT INTO pharmaops.jobs (
      job_id,
      tenant_id,
      environment,
      job_type,
      status,
      idempotency_key,
      queue_name,
      requested_by_user_id
    )
    VALUES
      ('37000000-0000-0000-0000-000000000101', '${tenantA}', 'dev', 'connector', 'queued', 'tenant-a-job', 'ingestion', '10000000-0000-0000-0000-000000000102'),
      ('37000000-0000-0000-0000-000000000102', '${tenantB}', 'dev', 'connector', 'queued', 'tenant-b-job', 'ingestion', '11000000-0000-0000-0000-000000000102');

    INSERT INTO pharmaops.job_events (job_event_id, tenant_id, job_id, event_type)
    VALUES
      ('38000000-0000-0000-0000-000000000101', '${tenantA}', '37000000-0000-0000-0000-000000000101', 'queued'),
      ('38000000-0000-0000-0000-000000000102', '${tenantB}', '37000000-0000-0000-0000-000000000102', 'queued');

    INSERT INTO pharmaops.release_metadata (
      release_metadata_id,
      tenant_id,
      environment,
      release_id,
      semantic_version,
      status,
      manifest_uri,
      manifest_digest,
      source_version_pins,
      included_graphs,
      validation_report_refs,
      artifact_hashes,
      approval_trace,
      audit_event_range,
      created_by_user_id
    )
    VALUES
      (
        '39000000-0000-0000-0000-000000000101',
        '${tenantA}',
        'dev',
        'release:v1',
        '1.0.0',
        'candidate',
        's3://pharmaops-release-packages/${tenantA}/release-v1/manifest.json',
        'sha256:${"a".repeat(64)}',
        '[{"source":"git","ref":"abc123"}]'::jsonb,
        '[{"graph_name":"urn:pharmaops:tenant-a:release-v1","digest":"sha256:${"a".repeat(64)}"}]'::jsonb,
        '[{"uri":"s3://validation/tenant-a/release-v1.json","digest":"sha256:${"b".repeat(64)}"}]'::jsonb,
        '{"urn:pharmaops:tenant-a:release-v1":"sha256:${"a".repeat(64)}"}'::jsonb,
        '[{"approval_id":"approval-tenant-a","decision":"approved"}]'::jsonb,
        '{"first":"audit-tenant-a-1","last":"audit-tenant-a-2"}'::jsonb,
        '10000000-0000-0000-0000-000000000105'
      ),
      (
        '39000000-0000-0000-0000-000000000102',
        '${tenantB}',
        'dev',
        'release:v1',
        '1.0.0',
        'candidate',
        's3://pharmaops-release-packages/${tenantB}/release-v1/manifest.json',
        'sha256:${"b".repeat(64)}',
        '[{"source":"git","ref":"def456"}]'::jsonb,
        '[{"graph_name":"urn:pharmaops:tenant-b:release-v1","digest":"sha256:${"b".repeat(64)}"}]'::jsonb,
        '[{"uri":"s3://validation/tenant-b/release-v1.json","digest":"sha256:${"a".repeat(64)}"}]'::jsonb,
        '{"urn:pharmaops:tenant-b:release-v1":"sha256:${"b".repeat(64)}"}'::jsonb,
        '[{"approval_id":"approval-tenant-b","decision":"approved"}]'::jsonb,
        '{"first":"audit-tenant-b-1","last":"audit-tenant-b-2"}'::jsonb,
        '11000000-0000-0000-0000-000000000105'
      );
  `;
}
