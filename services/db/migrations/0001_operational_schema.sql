BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS pharmaops;

CREATE TYPE pharmaops.environment_name AS ENUM (
  'local',
  'dev',
  'test',
  'staging',
  'release_candidate',
  'production'
);

CREATE TYPE pharmaops.principal_type AS ENUM (
  'human',
  'service_account'
);

CREATE TYPE pharmaops.lifecycle_status AS ENUM (
  'draft',
  'proposed',
  'validated',
  'in_review',
  'revision_requested',
  'approved',
  'staged',
  'released',
  'deprecated',
  'superseded',
  'rejected',
  'rolled_back'
);

CREATE TYPE pharmaops.proposal_kind AS ENUM (
  'entity',
  'mapping',
  'relationship',
  'evidence',
  'release',
  'source_config',
  'security_policy',
  'other'
);

CREATE TYPE pharmaops.review_decision AS ENUM (
  'pending',
  'approved',
  'rejected',
  'revision_requested',
  'escalated'
);

CREATE TYPE pharmaops.job_status AS ENUM (
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'dead_lettered'
);

CREATE TYPE pharmaops.release_status AS ENUM (
  'draft',
  'candidate',
  'validated',
  'approved',
  'active',
  'superseded',
  'rolled_back',
  'failed'
);

CREATE TYPE pharmaops.audit_outcome AS ENUM (
  'success',
  'denied',
  'failed'
);

CREATE TYPE pharmaops.export_grant_status AS ENUM (
  'draft',
  'pending_approval',
  'active',
  'expired',
  'revoked',
  'denied'
);

CREATE TYPE pharmaops.break_glass_status AS ENUM (
  'requested',
  'approved',
  'active',
  'expired',
  'terminated',
  'denied'
);

CREATE FUNCTION pharmaops.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION pharmaops.prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only; create a compensating audit event instead';
END;
$$;

CREATE FUNCTION pharmaops.prevent_self_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  proposal_creator uuid;
BEGIN
  IF NEW.decision = 'approved' AND NEW.proposal_id IS NOT NULL AND NEW.actor_user_id IS NOT NULL THEN
    SELECT created_by_user_id
      INTO proposal_creator
      FROM pharmaops.proposals
     WHERE proposal_id = NEW.proposal_id;

    IF proposal_creator IS NOT NULL AND proposal_creator = NEW.actor_user_id THEN
      RAISE EXCEPTION 'contributors and authors cannot approve their own governed proposal';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION pharmaops.enforce_privileged_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  assigned_role_is_privileged boolean;
BEGIN
  SELECT is_privileged
    INTO assigned_role_is_privileged
    FROM pharmaops.roles
   WHERE role_id = NEW.role_id;

  IF assigned_role_is_privileged THEN
    IF NEW.second_approved_by_user_id IS NULL THEN
      RAISE EXCEPTION 'privileged role assignments require a second approver';
    END IF;

    IF NEW.user_id IS NOT NULL AND NEW.second_approved_by_user_id = NEW.user_id THEN
      RAISE EXCEPTION 'privileged role assignments cannot be self-approved';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION pharmaops.enforce_break_glass_controls()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.rationale IS NULL OR btrim(NEW.rationale) = '' THEN
    RAISE EXCEPTION 'break-glass access requires rationale';
  END IF;

  IF NEW.expires_at IS NULL OR NEW.expires_at <= NEW.created_at THEN
    RAISE EXCEPTION 'break-glass access requires a future expiry';
  END IF;

  IF NEW.audit_event_id IS NULL THEN
    RAISE EXCEPTION 'break-glass access requires an audit event reference';
  END IF;

  IF NEW.status IN ('approved', 'active') THEN
    IF NEW.approved_by_user_id IS NULL OR NEW.second_approved_by_user_id IS NULL THEN
      RAISE EXCEPTION 'approved or active break-glass access requires separate approval';
    END IF;

    IF NEW.approved_by_user_id = NEW.requested_by_user_id
       OR NEW.second_approved_by_user_id = NEW.requested_by_user_id THEN
      RAISE EXCEPTION 'break-glass access cannot be self-approved';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION pharmaops.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION pharmaops.current_environment()
RETURNS pharmaops.environment_name
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.environment', true), '')::pharmaops.environment_name
$$;

CREATE FUNCTION pharmaops.allow_cross_tenant()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.allow_cross_tenant', true), '')::boolean, false)
$$;

CREATE FUNCTION pharmaops.tenant_visible(row_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT pharmaops.allow_cross_tenant()
    OR row_tenant_id = pharmaops.current_tenant_id()
$$;

CREATE TABLE pharmaops.tenants (
  tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  data_classification text NOT NULL DEFAULT 'regulated',
  retention_policy_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pharmaops.users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  external_subject text NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'pending')),
  mfa_required boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_subject),
  UNIQUE (tenant_id, email)
);

CREATE TABLE pharmaops.service_accounts (
  service_account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  name text NOT NULL,
  owner_user_id uuid REFERENCES pharmaops.users(user_id),
  owning_human_role text NOT NULL,
  environment pharmaops.environment_name NOT NULL,
  service_purpose text NOT NULL,
  secret_ref text NOT NULL,
  expires_at timestamptz,
  rotation_due_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'expired', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, environment),
  CONSTRAINT service_accounts_expiry_future CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE TABLE pharmaops.roles (
  role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text NOT NULL,
  is_privileged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pharmaops.permissions (
  permission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_key text NOT NULL UNIQUE,
  description text NOT NULL,
  is_privileged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pharmaops.role_permissions (
  role_id uuid NOT NULL REFERENCES pharmaops.roles(role_id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES pharmaops.permissions(permission_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE pharmaops.role_assignments (
  role_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  principal_type pharmaops.principal_type NOT NULL,
  user_id uuid REFERENCES pharmaops.users(user_id),
  service_account_id uuid REFERENCES pharmaops.service_accounts(service_account_id),
  role_id uuid NOT NULL REFERENCES pharmaops.roles(role_id),
  environment pharmaops.environment_name NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale text,
  approved_by_user_id uuid REFERENCES pharmaops.users(user_id),
  second_approved_by_user_id uuid REFERENCES pharmaops.users(user_id),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid REFERENCES pharmaops.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_assignment_one_principal CHECK (
    (principal_type = 'human' AND user_id IS NOT NULL AND service_account_id IS NULL)
    OR
    (principal_type = 'service_account' AND service_account_id IS NOT NULL AND user_id IS NULL)
  ),
  CONSTRAINT role_assignment_no_self_second_approval CHECK (
    second_approved_by_user_id IS NULL
    OR user_id IS NULL
    OR second_approved_by_user_id <> user_id
  ),
  CONSTRAINT role_assignment_expiry_valid CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE TABLE pharmaops.security_change_requests (
  security_change_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  environment pharmaops.environment_name NOT NULL,
  change_type text NOT NULL CHECK (
    change_type IN (
      'privileged_role_grant',
      'rbac_policy_change',
      'service_account_export_grant',
      'break_glass_enablement',
      'secret_reference_change'
    )
  ),
  requested_by_user_id uuid NOT NULL REFERENCES pharmaops.users(user_id),
  beneficiary_user_id uuid REFERENCES pharmaops.users(user_id),
  beneficiary_service_account_id uuid REFERENCES pharmaops.service_accounts(service_account_id),
  second_approver_user_id uuid REFERENCES pharmaops.users(user_id),
  status pharmaops.review_decision NOT NULL DEFAULT 'pending',
  rationale text NOT NULL,
  requested_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  decided_at timestamptz,
  audit_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_change_second_approver_not_requester CHECK (
    second_approver_user_id IS NULL OR second_approver_user_id <> requested_by_user_id
  ),
  CONSTRAINT security_change_no_self_benefit CHECK (
    beneficiary_user_id IS NULL OR beneficiary_user_id <> requested_by_user_id
  )
);

CREATE TABLE pharmaops.service_account_scopes (
  service_account_scope_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  service_account_id uuid NOT NULL REFERENCES pharmaops.service_accounts(service_account_id) ON DELETE CASCADE,
  environment pharmaops.environment_name NOT NULL,
  resource_type text NOT NULL CHECK (
    resource_type IN (
      'graph_family',
      'object_prefix',
      'database_schema',
      'queue',
      'connector',
      'api_endpoint',
      'export_destination'
    )
  ),
  resource_pattern text NOT NULL,
  allowed_actions text[] NOT NULL,
  license_policy_id text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  approved_by_user_id uuid NOT NULL REFERENCES pharmaops.users(user_id),
  second_approved_by_user_id uuid REFERENCES pharmaops.users(user_id),
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_account_scope_expiry_valid CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE TABLE pharmaops.service_account_export_grants (
  export_grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  service_account_id uuid NOT NULL REFERENCES pharmaops.service_accounts(service_account_id),
  owning_human_role text NOT NULL,
  owning_user_id uuid NOT NULL REFERENCES pharmaops.users(user_id),
  environment pharmaops.environment_name NOT NULL,
  release_id text NOT NULL,
  destination_uri text NOT NULL,
  export_format text NOT NULL,
  license_policy_id text NOT NULL,
  permitted_source_classes text[] NOT NULL DEFAULT '{}'::text[],
  status pharmaops.export_grant_status NOT NULL DEFAULT 'pending_approval',
  approved_by_user_id uuid REFERENCES pharmaops.users(user_id),
  second_approved_by_user_id uuid REFERENCES pharmaops.users(user_id),
  rationale text NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  rotation_due_at timestamptz,
  revoked_at timestamptz,
  audit_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT export_grant_release_not_working CHECK (release_id <> 'working'),
  CONSTRAINT export_grant_expiry_valid CHECK (expires_at > starts_at),
  CONSTRAINT export_grant_no_self_second_approval CHECK (
    second_approved_by_user_id IS NULL OR second_approved_by_user_id <> owning_user_id
  )
);

CREATE TABLE pharmaops.break_glass_sessions (
  break_glass_session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  environment pharmaops.environment_name NOT NULL,
  requested_by_user_id uuid NOT NULL REFERENCES pharmaops.users(user_id),
  approved_by_user_id uuid REFERENCES pharmaops.users(user_id),
  second_approved_by_user_id uuid REFERENCES pharmaops.users(user_id),
  status pharmaops.break_glass_status NOT NULL DEFAULT 'requested',
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale text NOT NULL,
  starts_at timestamptz,
  expires_at timestamptz NOT NULL,
  terminated_at timestamptz,
  audit_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT break_glass_second_approver_not_requester CHECK (
    second_approved_by_user_id IS NULL OR second_approved_by_user_id <> requested_by_user_id
  ),
  CONSTRAINT break_glass_expiry_valid CHECK (expires_at > created_at)
);

CREATE TABLE pharmaops.proposals (
  proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  environment pharmaops.environment_name NOT NULL,
  proposal_key text NOT NULL,
  proposal_kind pharmaops.proposal_kind NOT NULL,
  title text NOT NULL,
  description text,
  lifecycle_status pharmaops.lifecycle_status NOT NULL DEFAULT 'draft',
  semantic_object_type text,
  semantic_object_id text,
  graph_name text,
  source_version text,
  source_artifact_digest text,
  validation_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  release_id text,
  created_by_user_id uuid REFERENCES pharmaops.users(user_id),
  created_by_service_account_id uuid REFERENCES pharmaops.service_accounts(service_account_id),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, proposal_key),
  CONSTRAINT proposals_one_creator CHECK (
    (created_by_user_id IS NOT NULL AND created_by_service_account_id IS NULL)
    OR
    (created_by_user_id IS NULL AND created_by_service_account_id IS NOT NULL)
  )
);

CREATE TABLE pharmaops.reviews (
  review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  proposal_id uuid NOT NULL REFERENCES pharmaops.proposals(proposal_id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL REFERENCES pharmaops.users(user_id),
  reviewer_role_id uuid NOT NULL REFERENCES pharmaops.roles(role_id),
  decision pharmaops.review_decision NOT NULL DEFAULT 'pending',
  rationale text,
  validation_report_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pharmaops.approvals (
  approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  proposal_id uuid REFERENCES pharmaops.proposals(proposal_id),
  release_id text,
  approval_type text NOT NULL CHECK (
    approval_type IN (
      'domain',
      'compliance',
      'release_manager',
      'data_governance',
      'security',
      'exception'
    )
  ),
  approved_object_type text NOT NULL,
  approved_object_id text NOT NULL,
  actor_user_id uuid REFERENCES pharmaops.users(user_id),
  actor_service_account_id uuid REFERENCES pharmaops.service_accounts(service_account_id),
  actor_role_id uuid NOT NULL REFERENCES pharmaops.roles(role_id),
  decision pharmaops.review_decision NOT NULL,
  rationale text NOT NULL,
  validation_report_id text,
  before_artifact_hash text,
  after_artifact_hash text,
  audit_event_id uuid,
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approvals_one_actor CHECK (
    (actor_user_id IS NOT NULL AND actor_service_account_id IS NULL)
    OR
    (actor_user_id IS NULL AND actor_service_account_id IS NOT NULL)
  )
);

CREATE TABLE pharmaops.review_queues (
  review_queue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  queue_key text NOT NULL,
  display_name text NOT NULL,
  owning_role_id uuid REFERENCES pharmaops.roles(role_id),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, queue_key)
);

CREATE TABLE pharmaops.review_queue_items (
  review_queue_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  review_queue_id uuid NOT NULL REFERENCES pharmaops.review_queues(review_queue_id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES pharmaops.proposals(proposal_id),
  priority integer NOT NULL DEFAULT 100,
  risk_level text NOT NULL DEFAULT 'standard' CHECK (risk_level IN ('low', 'standard', 'high', 'critical')),
  assigned_to_user_id uuid REFERENCES pharmaops.users(user_id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'blocked', 'cancelled')),
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pharmaops.comments (
  comment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  proposal_id uuid REFERENCES pharmaops.proposals(proposal_id),
  review_id uuid REFERENCES pharmaops.reviews(review_id),
  parent_comment_id uuid REFERENCES pharmaops.comments(comment_id),
  body text NOT NULL,
  created_by_user_id uuid REFERENCES pharmaops.users(user_id),
  created_by_service_account_id uuid REFERENCES pharmaops.service_accounts(service_account_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT comments_one_creator CHECK (
    (created_by_user_id IS NOT NULL AND created_by_service_account_id IS NULL)
    OR
    (created_by_user_id IS NULL AND created_by_service_account_id IS NOT NULL)
  )
);

CREATE TABLE pharmaops.jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  environment pharmaops.environment_name NOT NULL,
  job_type text NOT NULL,
  status pharmaops.job_status NOT NULL DEFAULT 'queued',
  idempotency_key text NOT NULL,
  queue_name text NOT NULL,
  run_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_name text,
  source_version text,
  connector_id text,
  connector_version text,
  source_snapshot_digest text,
  parser_version text,
  normalization_ruleset_version text,
  release_id text,
  requested_by_user_id uuid REFERENCES pharmaops.users(user_id),
  requested_by_service_account_id uuid REFERENCES pharmaops.service_accounts(service_account_id),
  locked_by text,
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  failure_reason text,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, environment, idempotency_key),
  CONSTRAINT jobs_one_requester CHECK (
    (requested_by_user_id IS NOT NULL AND requested_by_service_account_id IS NULL)
    OR
    (requested_by_user_id IS NULL AND requested_by_service_account_id IS NOT NULL)
  )
);

CREATE TABLE pharmaops.job_events (
  job_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  job_id uuid NOT NULL REFERENCES pharmaops.jobs(job_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pharmaops.release_metadata (
  release_metadata_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  environment pharmaops.environment_name NOT NULL,
  release_id text NOT NULL,
  semantic_version text NOT NULL,
  status pharmaops.release_status NOT NULL DEFAULT 'draft',
  release_candidate_id text,
  previous_release_id text,
  active_from timestamptz,
  active_to timestamptz,
  manifest_uri text,
  manifest_digest text NOT NULL,
  ontology_digest text,
  shape_digest text,
  source_version_pins jsonb NOT NULL DEFAULT '[]'::jsonb,
  included_graphs jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_report_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  changelog_uri text,
  artifact_hashes jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_event_range jsonb NOT NULL DEFAULT '{}'::jsonb,
  rollback_target_release_id text,
  created_by_user_id uuid REFERENCES pharmaops.users(user_id),
  created_by_service_account_id uuid REFERENCES pharmaops.service_accounts(service_account_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, environment, release_id),
  CONSTRAINT release_one_creator CHECK (
    (created_by_user_id IS NOT NULL AND created_by_service_account_id IS NULL)
    OR
    (created_by_user_id IS NULL AND created_by_service_account_id IS NOT NULL)
  )
);

CREATE TABLE pharmaops.audit_events (
  audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL REFERENCES pharmaops.tenants(tenant_id),
  environment pharmaops.environment_name NOT NULL,
  actor_user_id uuid REFERENCES pharmaops.users(user_id),
  actor_service_account_id uuid REFERENCES pharmaops.service_accounts(service_account_id),
  actor_role_key text NOT NULL,
  actor_type pharmaops.principal_type NOT NULL,
  source_ip_or_client_id text,
  correlation_id text NOT NULL,
  request_id text,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  resource_version text,
  workflow_state_before text,
  workflow_state_after text,
  release_id text,
  source_system text,
  source_version text,
  action text NOT NULL,
  decision text,
  rationale text,
  policy_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifact_hash text,
  outcome pharmaops.audit_outcome NOT NULL,
  failure_reason text,
  impersonation_or_break_glass_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  retention_class text,
  legal_hold boolean NOT NULL DEFAULT false,
  schema_version text NOT NULL DEFAULT 'audit.v1',
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_one_actor CHECK (
    (actor_type = 'human' AND actor_user_id IS NOT NULL AND actor_service_account_id IS NULL)
    OR
    (actor_type = 'service_account' AND actor_service_account_id IS NOT NULL AND actor_user_id IS NULL)
  )
);

CREATE TRIGGER audit_events_prevent_update
BEFORE UPDATE ON pharmaops.audit_events
FOR EACH ROW EXECUTE FUNCTION pharmaops.prevent_audit_mutation();

CREATE TRIGGER audit_events_prevent_delete
BEFORE DELETE ON pharmaops.audit_events
FOR EACH ROW EXECUTE FUNCTION pharmaops.prevent_audit_mutation();

REVOKE UPDATE, DELETE ON pharmaops.audit_events FROM PUBLIC;

CREATE TRIGGER approvals_prevent_self_approval
BEFORE INSERT OR UPDATE ON pharmaops.approvals
FOR EACH ROW EXECUTE FUNCTION pharmaops.prevent_self_approval();

CREATE TRIGGER role_assignments_enforce_privileged_second_approval
BEFORE INSERT OR UPDATE ON pharmaops.role_assignments
FOR EACH ROW EXECUTE FUNCTION pharmaops.enforce_privileged_role_assignment();

CREATE TRIGGER break_glass_sessions_enforce_controls
BEFORE INSERT OR UPDATE ON pharmaops.break_glass_sessions
FOR EACH ROW EXECUTE FUNCTION pharmaops.enforce_break_glass_controls();

CREATE INDEX tenants_status_idx ON pharmaops.tenants(status);
CREATE INDEX users_tenant_status_idx ON pharmaops.users(tenant_id, status);
CREATE INDEX service_accounts_tenant_env_status_idx ON pharmaops.service_accounts(tenant_id, environment, status);
CREATE INDEX role_assignments_tenant_principal_idx ON pharmaops.role_assignments(tenant_id, principal_type, user_id, service_account_id);
CREATE INDEX role_assignments_tenant_env_role_idx ON pharmaops.role_assignments(tenant_id, environment, role_id);
CREATE INDEX security_change_requests_tenant_status_idx ON pharmaops.security_change_requests(tenant_id, status, change_type);
CREATE INDEX service_account_scopes_tenant_account_idx ON pharmaops.service_account_scopes(tenant_id, service_account_id, environment);
CREATE INDEX service_account_export_grants_tenant_status_idx ON pharmaops.service_account_export_grants(tenant_id, service_account_id, status);
CREATE INDEX break_glass_sessions_tenant_status_idx ON pharmaops.break_glass_sessions(tenant_id, status, environment);
CREATE INDEX proposals_tenant_status_idx ON pharmaops.proposals(tenant_id, environment, lifecycle_status);
CREATE INDEX proposals_semantic_object_idx ON pharmaops.proposals(tenant_id, semantic_object_type, semantic_object_id);
CREATE INDEX reviews_tenant_proposal_idx ON pharmaops.reviews(tenant_id, proposal_id, decision);
CREATE INDEX approvals_tenant_release_idx ON pharmaops.approvals(tenant_id, release_id, approval_type);
CREATE INDEX review_queue_items_tenant_status_idx ON pharmaops.review_queue_items(tenant_id, status, priority);
CREATE INDEX comments_tenant_proposal_idx ON pharmaops.comments(tenant_id, proposal_id);
CREATE INDEX jobs_tenant_env_status_idx ON pharmaops.jobs(tenant_id, environment, status, queue_name);
CREATE INDEX job_events_tenant_job_idx ON pharmaops.job_events(tenant_id, job_id, created_at);
CREATE INDEX release_metadata_tenant_status_idx ON pharmaops.release_metadata(tenant_id, environment, status);
CREATE INDEX audit_events_tenant_time_idx ON pharmaops.audit_events(tenant_id, occurred_at DESC);
CREATE INDEX audit_events_tenant_type_idx ON pharmaops.audit_events(tenant_id, event_type, occurred_at DESC);
CREATE INDEX audit_events_resource_idx ON pharmaops.audit_events(tenant_id, resource_type, resource_id);
CREATE INDEX audit_events_correlation_idx ON pharmaops.audit_events(correlation_id);
CREATE INDEX audit_events_release_idx ON pharmaops.audit_events(tenant_id, release_id);

CREATE TRIGGER tenants_set_updated_at BEFORE UPDATE ON pharmaops.tenants FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON pharmaops.users FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER service_accounts_set_updated_at BEFORE UPDATE ON pharmaops.service_accounts FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER role_assignments_set_updated_at BEFORE UPDATE ON pharmaops.role_assignments FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER security_change_requests_set_updated_at BEFORE UPDATE ON pharmaops.security_change_requests FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER service_account_scopes_set_updated_at BEFORE UPDATE ON pharmaops.service_account_scopes FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER service_account_export_grants_set_updated_at BEFORE UPDATE ON pharmaops.service_account_export_grants FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER break_glass_sessions_set_updated_at BEFORE UPDATE ON pharmaops.break_glass_sessions FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER proposals_set_updated_at BEFORE UPDATE ON pharmaops.proposals FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON pharmaops.reviews FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER review_queues_set_updated_at BEFORE UPDATE ON pharmaops.review_queues FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER review_queue_items_set_updated_at BEFORE UPDATE ON pharmaops.review_queue_items FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER comments_set_updated_at BEFORE UPDATE ON pharmaops.comments FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON pharmaops.jobs FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();
CREATE TRIGGER release_metadata_set_updated_at BEFORE UPDATE ON pharmaops.release_metadata FOR EACH ROW EXECUTE FUNCTION pharmaops.set_updated_at();

ALTER TABLE pharmaops.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.service_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.security_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.service_account_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.service_account_export_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.break_glass_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.review_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.review_queue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.release_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaops.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenants_tenant_isolation ON pharmaops.tenants
  USING (pharmaops.allow_cross_tenant() OR tenant_id = pharmaops.current_tenant_id())
  WITH CHECK (pharmaops.allow_cross_tenant() OR tenant_id = pharmaops.current_tenant_id());

CREATE POLICY users_tenant_isolation ON pharmaops.users
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY service_accounts_tenant_isolation ON pharmaops.service_accounts
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY role_assignments_tenant_isolation ON pharmaops.role_assignments
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY security_change_requests_tenant_isolation ON pharmaops.security_change_requests
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY service_account_scopes_tenant_isolation ON pharmaops.service_account_scopes
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY service_account_export_grants_tenant_isolation ON pharmaops.service_account_export_grants
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY break_glass_sessions_tenant_isolation ON pharmaops.break_glass_sessions
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY proposals_tenant_isolation ON pharmaops.proposals
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY reviews_tenant_isolation ON pharmaops.reviews
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY approvals_tenant_isolation ON pharmaops.approvals
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY review_queues_tenant_isolation ON pharmaops.review_queues
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY review_queue_items_tenant_isolation ON pharmaops.review_queue_items
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY comments_tenant_isolation ON pharmaops.comments
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY jobs_tenant_isolation ON pharmaops.jobs
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY job_events_tenant_isolation ON pharmaops.job_events
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY release_metadata_tenant_isolation ON pharmaops.release_metadata
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

CREATE POLICY audit_events_tenant_isolation ON pharmaops.audit_events
  USING (pharmaops.tenant_visible(tenant_id))
  WITH CHECK (pharmaops.tenant_visible(tenant_id));

INSERT INTO pharmaops.roles (role_key, display_name, description, is_privileged) VALUES
  ('viewer', 'Viewer', 'Read authorized released or assigned workbench content.', false),
  ('contributor', 'Contributor', 'Propose changes, comments, and evidence additions.', false),
  ('curator', 'Curator', 'Create and edit governed semantic proposals and prepare them for review.', false),
  ('domain_approver', 'Domain approver', 'Approve or reject domain-scoped governed changes.', true),
  ('compliance_reviewer', 'Compliance reviewer', 'Review validation evidence, auditability, release controls, and compliance gates.', true),
  ('release_manager', 'Release manager', 'Stage, promote, certify, export, and roll back releases after required approvals.', true),
  ('data_engineer', 'Data engineer', 'Configure and run authorized connectors, ingestion jobs, normalization jobs, and source refreshes.', true),
  ('platform_admin', 'Platform admin', 'Manage tenant configuration, environment settings, users, operational jobs, and non-security administration.', true),
  ('security_admin', 'Security admin', 'Manage identity, RBAC policy, security configuration, secret references, break-glass procedures, and privileged audit access.', true),
  ('service_account', 'Service account', 'Execute narrowly scoped automated actions.', false);

INSERT INTO pharmaops.permissions (permission_key, description, is_privileged) VALUES
  ('semantic.read.released', 'Read authorized released semantic assets.', false),
  ('semantic.read.working', 'Read authorized working or staging proposals.', false),
  ('proposal.create', 'Create semantic change proposals.', false),
  ('proposal.update_own_draft', 'Update own draft proposal before submission.', false),
  ('proposal.edit_governed', 'Edit governed entity, mapping, relationship, or evidence proposal.', false),
  ('proposal.submit', 'Submit proposal to review.', false),
  ('proposal.approve_domain', 'Approve or reject domain-scoped proposal.', true),
  ('compliance.review_gate', 'Review compliance evidence and gate readiness.', true),
  ('release.stage', 'Stage release candidate.', true),
  ('release.promote', 'Promote release to production.', true),
  ('release.rollback', 'Roll back release.', true),
  ('export.release_package', 'Export release package with provenance.', true),
  ('audit.search', 'Search audit events according to role permissions.', true),
  ('audit.export', 'Export audit events.', true),
  ('source.configure', 'Configure source connector.', true),
  ('job.run_connector', 'Run connector or normalization job.', false),
  ('tenant.manage', 'Manage tenants and environment settings.', true),
  ('user.manage', 'Manage user accounts.', true),
  ('role.assign_non_privileged', 'Assign non-privileged roles.', true),
  ('role.assign_privileged', 'Assign privileged roles with second approver.', true),
  ('rbac.manage_policy', 'Manage RBAC policies with second approver.', true),
  ('secret.manage_reference', 'Manage secret references and rotation policy.', true),
  ('break_glass.activate', 'Activate approved break-glass access with expiry.', true),
  ('service_account.export_grant', 'Manage scoped service-account export grants.', true);

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'semantic.read.released',
  'semantic.read.working',
  'proposal.create',
  'proposal.update_own_draft',
  'proposal.submit'
)
WHERE r.role_key = 'contributor';

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'semantic.read.released',
  'semantic.read.working',
  'proposal.create',
  'proposal.update_own_draft',
  'proposal.edit_governed',
  'proposal.submit'
)
WHERE r.role_key = 'curator';

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN ('semantic.read.released')
WHERE r.role_key = 'viewer';

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'semantic.read.released',
  'semantic.read.working',
  'proposal.approve_domain',
  'audit.search'
)
WHERE r.role_key = 'domain_approver';

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'semantic.read.released',
  'semantic.read.working',
  'compliance.review_gate',
  'audit.search',
  'audit.export'
)
WHERE r.role_key = 'compliance_reviewer';

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'semantic.read.released',
  'semantic.read.working',
  'release.stage',
  'release.promote',
  'release.rollback',
  'export.release_package',
  'audit.search'
)
WHERE r.role_key = 'release_manager';

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'semantic.read.released',
  'semantic.read.working',
  'source.configure',
  'job.run_connector'
)
WHERE r.role_key = 'data_engineer';

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'semantic.read.released',
  'semantic.read.working',
  'tenant.manage',
  'user.manage',
  'role.assign_non_privileged',
  'source.configure',
  'job.run_connector',
  'audit.search'
)
WHERE r.role_key = 'platform_admin';

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'semantic.read.released',
  'semantic.read.working',
  'role.assign_privileged',
  'rbac.manage_policy',
  'secret.manage_reference',
  'break_glass.activate',
  'service_account.export_grant',
  'audit.search',
  'audit.export',
  'export.release_package'
)
WHERE r.role_key = 'security_admin';

INSERT INTO pharmaops.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM pharmaops.roles r
JOIN pharmaops.permissions p ON p.permission_key IN (
  'semantic.read.released',
  'semantic.read.working',
  'proposal.create',
  'proposal.update_own_draft',
  'proposal.edit_governed',
  'proposal.submit',
  'job.run_connector',
  'export.release_package'
)
WHERE r.role_key = 'service_account';

COMMIT;
