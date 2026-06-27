BEGIN;

INSERT INTO pharmaops.permissions (permission_key, description, is_privileged) VALUES
  ('proposal.validate', 'Validate an own-tenant governed proposal before routing or decision.', true),
  ('proposal.route_curator_review', 'Route an own-tenant governed proposal to curator review.', true),
  ('proposal.route_approver_decision', 'Route an own-tenant governed proposal to domain approver decision.', true),
  ('proposal.approve', 'Approve a governed proposal after validation, evidence, tenant, and separation-of-duties checks.', true),
  ('proposal.reject', 'Reject a governed proposal with rationale and audit linkage.', true),
  ('proposal.stage_release', 'Stage approved governed proposals for release-candidate assembly.', true),
  ('release_candidate.create', 'Create a release candidate from approved proposals with validation, evidence, and approval trace checks.', true)
ON CONFLICT (permission_key) DO UPDATE
SET description = EXCLUDED.description,
    is_privileged = EXCLUDED.is_privileged;

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key = 'proposal.submit'
WHERE r.role_key = 'contributor'
ON CONFLICT DO NOTHING;

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'proposal.validate',
  'proposal.route_curator_review',
  'proposal.route_approver_decision'
)
WHERE r.role_key = 'curator'
ON CONFLICT DO NOTHING;

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'proposal.approve',
  'proposal.reject'
)
WHERE r.role_key = 'domain_approver'
ON CONFLICT DO NOTHING;

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'proposal.stage_release',
  'release_candidate.create'
)
WHERE r.role_key = 'release_manager'
ON CONFLICT DO NOTHING;

DELETE FROM pharmaops.role_permissions rp
USING pharmaops.roles r, pharmaops.permissions p
WHERE rp.role_id = r.role_id
  AND rp.permission_id = p.permission_id
  AND (
    (p.permission_key = 'proposal.submit' AND r.role_key NOT IN ('contributor', 'curator'))
    OR (p.permission_key IN ('proposal.validate', 'proposal.route_curator_review', 'proposal.route_approver_decision') AND r.role_key <> 'curator')
    OR (p.permission_key IN ('proposal.approve', 'proposal.reject') AND r.role_key <> 'domain_approver')
    OR (p.permission_key IN ('proposal.stage_release', 'release_candidate.create') AND r.role_key <> 'release_manager')
  );

DELETE FROM pharmaops.role_permissions rp
USING pharmaops.roles r, pharmaops.permissions p
WHERE rp.role_id = r.role_id
  AND rp.permission_id = p.permission_id
  AND r.role_key = 'service_account'
  AND p.permission_key IN (
    'proposal.submit',
    'proposal.edit_governed',
    'proposal.validate',
    'proposal.route_curator_review',
    'proposal.route_approver_decision',
    'proposal.approve',
    'proposal.reject',
    'proposal.stage_release',
    'release_candidate.create'
  );

CREATE TABLE IF NOT EXISTS pharmaops.proposal_lifecycle_action_policies (
  action_key text NOT NULL CHECK (
    action_key IN (
      'proposal.submit',
      'proposal.validate',
      'proposal.route_curator_review',
      'proposal.route_approver_decision',
      'proposal.approve',
      'proposal.reject',
      'proposal.stage_release',
      'release_candidate.create'
    )
  ),
  role_key text NOT NULL REFERENCES pharmaops.roles(role_key),
  requires_human_actor boolean NOT NULL DEFAULT true,
  requires_same_tenant boolean NOT NULL DEFAULT true,
  requires_non_submitter boolean NOT NULL DEFAULT true,
  requires_validation_passed boolean NOT NULL DEFAULT false,
  requires_all_approved boolean NOT NULL DEFAULT false,
  requires_signed_decision boolean NOT NULL DEFAULT false,
  requires_audit_event boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (action_key, role_key)
);

CREATE TRIGGER proposal_lifecycle_action_policies_set_updated_at
BEFORE UPDATE ON pharmaops.proposal_lifecycle_action_policies
FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();

INSERT INTO pharmaops.proposal_lifecycle_action_policies (
  action_key,
  role_key,
  requires_human_actor,
  requires_same_tenant,
  requires_non_submitter,
  requires_validation_passed,
  requires_all_approved,
  requires_signed_decision,
  requires_audit_event
) VALUES
  ('proposal.submit', 'contributor', true, true, false, false, false, false, true),
  ('proposal.submit', 'curator', true, true, false, false, false, false, true),
  ('proposal.validate', 'curator', true, true, false, true, false, false, true),
  ('proposal.route_curator_review', 'curator', true, true, false, true, false, false, true),
  ('proposal.route_approver_decision', 'curator', true, true, false, true, false, false, true),
  ('proposal.approve', 'domain_approver', true, true, true, true, false, true, true),
  ('proposal.reject', 'domain_approver', true, true, true, false, false, true, true),
  ('proposal.stage_release', 'release_manager', true, true, true, true, true, true, true),
  ('release_candidate.create', 'release_manager', true, true, true, true, true, true, true)
ON CONFLICT (action_key, role_key) DO UPDATE
SET requires_human_actor = EXCLUDED.requires_human_actor,
    requires_same_tenant = EXCLUDED.requires_same_tenant,
    requires_non_submitter = EXCLUDED.requires_non_submitter,
    requires_validation_passed = EXCLUDED.requires_validation_passed,
    requires_all_approved = EXCLUDED.requires_all_approved,
    requires_signed_decision = EXCLUDED.requires_signed_decision,
    requires_audit_event = EXCLUDED.requires_audit_event;

CREATE OR REPLACE FUNCTION pharmaops.proposal_lifecycle_action_role_allowed(actor_role_key text, requested_action_key text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pharmaops.proposal_lifecycle_action_policies p
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
      'proposal.submit',
      'proposal.validate',
      'proposal.route_curator_review',
      'proposal.route_approver_decision',
      'proposal.approve',
      'proposal.reject',
      'proposal.stage_release',
      'release_candidate.create',
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
