BEGIN;

INSERT INTO pharmaops.permissions (permission_key, description, is_privileged) VALUES
  ('mapping_candidate.approve', 'Approve governed mapping candidates after tenant, provenance, evidence, confidence, license, and vocabulary-version checks.', true),
  ('mapping_candidate.reject', 'Reject governed mapping candidates with rationale and audit linkage.', true),
  ('mapping_candidate.stage_release', 'Stage approved governed mapping candidates for release assembly.', true)
ON CONFLICT (permission_key) DO UPDATE
SET description = EXCLUDED.description,
    is_privileged = EXCLUDED.is_privileged;

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'mapping_candidate.approve',
  'mapping_candidate.reject'
)
WHERE r.role_key IN ('curator', 'domain_approver')
ON CONFLICT DO NOTHING;

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key = 'mapping_candidate.stage_release'
WHERE r.role_key = 'release_manager'
ON CONFLICT DO NOTHING;

DELETE FROM pharmaops.role_permissions rp
USING pharmaops.roles r, pharmaops.permissions p
WHERE rp.role_id = r.role_id
  AND rp.permission_id = p.permission_id
  AND r.role_key IN (
    'viewer',
    'contributor',
    'compliance_reviewer',
    'data_engineer',
    'platform_admin',
    'security_admin',
    'service_account'
  )
  AND p.permission_key IN (
    'mapping_candidate.approve',
    'mapping_candidate.reject',
    'mapping_candidate.stage_release'
  );

CREATE TABLE IF NOT EXISTS pharmaops.governed_mapping_action_policies (
  action_key text NOT NULL CHECK (
    action_key IN (
      'mapping_candidate.approve',
      'mapping_candidate.reject',
      'mapping_candidate.stage_release'
    )
  ),
  role_key text NOT NULL REFERENCES pharmaops.roles(role_key),
  requires_non_creator boolean NOT NULL DEFAULT true,
  requires_proposed_status boolean NOT NULL DEFAULT true,
  requires_approved_status boolean NOT NULL DEFAULT false,
  requires_release_eligible boolean NOT NULL DEFAULT false,
  requires_no_unresolved_duplicate boolean NOT NULL DEFAULT true,
  requires_audit_event boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (action_key, role_key)
);

CREATE TRIGGER governed_mapping_action_policies_set_updated_at
BEFORE UPDATE ON pharmaops.governed_mapping_action_policies
FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();

INSERT INTO pharmaops.governed_mapping_action_policies (
  action_key,
  role_key,
  requires_non_creator,
  requires_proposed_status,
  requires_approved_status,
  requires_release_eligible,
  requires_no_unresolved_duplicate,
  requires_audit_event
) VALUES
  ('mapping_candidate.approve', 'curator', true, true, false, false, true, true),
  ('mapping_candidate.approve', 'domain_approver', true, true, false, false, true, true),
  ('mapping_candidate.reject', 'curator', true, true, false, false, false, true),
  ('mapping_candidate.reject', 'domain_approver', true, true, false, false, false, true),
  ('mapping_candidate.stage_release', 'release_manager', true, false, true, true, true, true)
ON CONFLICT (action_key, role_key) DO UPDATE
SET requires_non_creator = EXCLUDED.requires_non_creator,
    requires_proposed_status = EXCLUDED.requires_proposed_status,
    requires_approved_status = EXCLUDED.requires_approved_status,
    requires_release_eligible = EXCLUDED.requires_release_eligible,
    requires_no_unresolved_duplicate = EXCLUDED.requires_no_unresolved_duplicate,
    requires_audit_event = EXCLUDED.requires_audit_event;

CREATE OR REPLACE FUNCTION pharmaops.governed_mapping_action_role_allowed(actor_role_key text, requested_action_key text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pharmaops.governed_mapping_action_policies p
    WHERE p.role_key = actor_role_key
      AND p.action_key = requested_action_key
  );
$$;

ALTER TABLE pharmaops.service_account_scopes
  DROP CONSTRAINT IF EXISTS service_account_scope_no_connector_forbidden_actions;

ALTER TABLE pharmaops.service_account_scopes
  ADD CONSTRAINT service_account_scope_no_connector_forbidden_actions CHECK (
    NOT allowed_actions && ARRAY[
      'cross_tenant.read',
      'cross_tenant.write',
      'graph.write_released',
      'graph.write_release_candidate',
      'governed.publish',
      'approval.approve',
      'mapping_candidate.approve',
      'mapping_candidate.reject',
      'mapping_candidate.stage_release',
      'release.stage',
      'release.promote',
      'release.rollback',
      'export.release_package',
      'audit.export',
      'rbac.manage_policy',
      'break_glass.activate'
    ]::text[]
  );

COMMIT;
