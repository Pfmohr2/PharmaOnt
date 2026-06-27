BEGIN;

INSERT INTO pharmaops.permissions (permission_key, description, is_privileged) VALUES
  ('connector.read_source', 'Read from an approved tenant-scoped source through a connector service account.', false),
  ('connector.write_raw_artifact', 'Write raw, redacted, or pointer artifacts to an approved tenant-scoped object prefix.', false),
  ('connector.write_normalized_candidate', 'Write normalized source records and candidate proposals for downstream review.', false),
  ('connector.write_working_graph_candidate', 'Write connector candidate assertions only to tenant working graph families.', false),
  ('connector.replay_checkpoint', 'Read or replay connector checkpoints only within the bound tenant, service-account, connector, source, and run lineage scope.', false),
  ('connector.emit_runtime_observability', 'Emit tenant-scoped connector job events, redacted logs, metrics, and audit context.', false)
ON CONFLICT (permission_key) DO UPDATE
SET description = EXCLUDED.description,
    is_privileged = EXCLUDED.is_privileged;

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'connector.read_source',
  'connector.write_raw_artifact',
  'connector.write_normalized_candidate',
  'connector.write_working_graph_candidate',
  'connector.replay_checkpoint',
  'connector.emit_runtime_observability'
)
WHERE r.role_key = 'service_account'
ON CONFLICT DO NOTHING;

ALTER TABLE pharmaops.service_account_scopes
  ADD CONSTRAINT service_account_scope_no_wildcard_actions CHECK (
    NOT allowed_actions && ARRAY['*', 'all', 'admin']::text[]
  );

ALTER TABLE pharmaops.service_account_scopes
  ADD CONSTRAINT service_account_scope_no_connector_forbidden_actions CHECK (
    NOT allowed_actions && ARRAY[
      'cross_tenant.read',
      'cross_tenant.write',
      'graph.write_released',
      'graph.write_release_candidate',
      'governed.publish',
      'approval.approve',
      'release.stage',
      'release.promote',
      'release.rollback',
      'export.release_package',
      'audit.export',
      'rbac.manage_policy',
      'break_glass.activate'
    ]::text[]
  );

ALTER TABLE pharmaops.service_account_scopes
  ADD CONSTRAINT service_account_scope_connector_actions_limited CHECK (
    resource_type <> 'connector'
    OR allowed_actions <@ ARRAY[
      'connector.run',
      'source.read',
      'license.evaluate',
      'artifact.write_raw',
      'artifact.write_pointer',
      'record.write_normalized',
      'candidate.emit',
      'graph.write_working_candidate',
      'checkpoint.read',
      'checkpoint.write',
      'checkpoint.replay',
      'job.claim',
      'job.emit_event',
      'metric.write_tenant',
      'log.write_redacted'
    ]::text[]
  );

CREATE TABLE IF NOT EXISTS pharmaops.connector_service_account_scope_templates (
  scope_template_key text PRIMARY KEY,
  resource_type text NOT NULL CHECK (
    resource_type IN (
      'graph_family',
      'object_prefix',
      'database_schema',
      'queue',
      'connector',
      'api_endpoint'
    )
  ),
  resource_pattern_hint text NOT NULL,
  allowed_actions text[] NOT NULL,
  denied_actions text[] NOT NULL DEFAULT ARRAY[]::text[],
  required boolean NOT NULL DEFAULT true,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER connector_scope_templates_set_updated_at
BEFORE UPDATE ON pharmaops.connector_service_account_scope_templates
FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();

INSERT INTO pharmaops.connector_service_account_scope_templates (
  scope_template_key,
  resource_type,
  resource_pattern_hint,
  allowed_actions,
  denied_actions,
  description
) VALUES
  (
    'connector_source_read',
    'connector',
    'tenant:{tenant_id}:env:{environment}:connector:{connector_id}:source:{source_name}',
    ARRAY['connector.run', 'source.read', 'license.evaluate']::text[],
    ARRAY['cross_tenant.read', 'cross_tenant.write', 'governed.publish']::text[],
    'Connector service account may run one approved connector and read its approved source only after the license gate passes.'
  ),
  (
    'connector_raw_artifact_write',
    'object_prefix',
    'tenants/{tenant_id}/{environment}/connectors/{connector_id}/raw/',
    ARRAY['artifact.write_raw', 'artifact.write_pointer']::text[],
    ARRAY['cross_tenant.read', 'cross_tenant.write', 'export.release_package']::text[],
    'Connector service account may write raw, redacted, or pointer artifacts only under the tenant/environment connector prefix.'
  ),
  (
    'connector_normalized_candidate_write',
    'database_schema',
    'pharmaops.jobs, pharmaops.job_events, normalized candidate persistence owned by ingestion service',
    ARRAY['record.write_normalized', 'candidate.emit', 'job.emit_event']::text[],
    ARRAY['governed.publish', 'approval.approve', 'release.promote']::text[],
    'Connector service account may persist normalized records and candidate proposals, not approved governed assets.'
  ),
  (
    'connector_working_graph_candidate_write',
    'graph_family',
    'tenant:{tenant_id}:env:{environment}:working:connector:{connector_id}:candidates',
    ARRAY['graph.write_working_candidate']::text[],
    ARRAY['graph.write_released', 'graph.write_release_candidate', 'governed.publish']::text[],
    'Connector service account may write only candidate assertions to tenant working graph families.'
  ),
  (
    'connector_runtime_observability',
    'queue',
    'tenant:{tenant_id}:env:{environment}:queue:connector',
    ARRAY['job.claim', 'job.emit_event', 'metric.write_tenant', 'log.write_redacted']::text[],
    ARRAY['cross_tenant.read', 'cross_tenant.write', 'audit.export']::text[],
    'Connector service account may claim tenant-scoped jobs and emit redacted tenant-scoped logs, metrics, and job events.'
  ),
  (
    'connector_checkpoint_replay',
    'connector',
    'tenant:{tenant_id}:env:{environment}:connector:{connector_id}:source:{source_name}:lineage:{run_lineage_id}',
    ARRAY['checkpoint.read', 'checkpoint.write', 'checkpoint.replay']::text[],
    ARRAY['cross_tenant.read', 'cross_tenant.write', 'governed.publish']::text[],
    'Connector service account may read, write, or replay checkpoints only when the signed checkpoint binding matches tenant, environment, service account, connector, source, and run lineage.'
  )
ON CONFLICT (scope_template_key) DO UPDATE
SET resource_type = EXCLUDED.resource_type,
    resource_pattern_hint = EXCLUDED.resource_pattern_hint,
    allowed_actions = EXCLUDED.allowed_actions,
    denied_actions = EXCLUDED.denied_actions,
    required = EXCLUDED.required,
    description = EXCLUDED.description;

COMMIT;
