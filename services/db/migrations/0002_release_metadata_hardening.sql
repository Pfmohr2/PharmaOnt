BEGIN;

ALTER TABLE pharmaops.release_metadata
  ALTER COLUMN manifest_uri SET NOT NULL;

ALTER TABLE pharmaops.release_metadata
  ADD CONSTRAINT release_metadata_manifest_digest_format CHECK (
    manifest_digest ~ '^sha256:[a-f0-9]{64}$'
  );

ALTER TABLE pharmaops.release_metadata
  ADD CONSTRAINT release_metadata_promoted_rows_have_evidence CHECK (
    status NOT IN ('candidate', 'validated', 'approved', 'active')
    OR (
      jsonb_typeof(source_version_pins) = 'array'
      AND jsonb_array_length(source_version_pins) > 0
      AND jsonb_typeof(included_graphs) = 'array'
      AND jsonb_array_length(included_graphs) > 0
      AND jsonb_typeof(validation_report_refs) = 'array'
      AND jsonb_array_length(validation_report_refs) > 0
      AND jsonb_typeof(approval_trace) = 'array'
      AND jsonb_array_length(approval_trace) > 0
      AND jsonb_typeof(artifact_hashes) = 'object'
      AND artifact_hashes <> '{}'::jsonb
      AND jsonb_typeof(audit_event_range) = 'object'
      AND audit_event_range ? 'first'
      AND audit_event_range ? 'last'
      AND coalesce(nullif(audit_event_range->>'first', ''), '') <> ''
      AND coalesce(nullif(audit_event_range->>'last', ''), '') <> ''
    )
  );

REVOKE INSERT, UPDATE, DELETE ON pharmaops.release_metadata FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharmaops_app') THEN
    REVOKE INSERT, UPDATE, DELETE ON pharmaops.release_metadata FROM pharmaops_app;
    GRANT SELECT ON pharmaops.release_metadata TO pharmaops_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharmaops_release_workflow') THEN
    GRANT SELECT, INSERT ON pharmaops.release_metadata TO pharmaops_release_workflow;
    REVOKE UPDATE, DELETE ON pharmaops.release_metadata FROM pharmaops_release_workflow;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharmaops_release_manager') THEN
    GRANT SELECT ON pharmaops.release_metadata TO pharmaops_release_manager;
    REVOKE INSERT, UPDATE, DELETE ON pharmaops.release_metadata FROM pharmaops_release_manager;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharmaops_security_audit_export') THEN
    GRANT SELECT ON pharmaops.release_metadata TO pharmaops_security_audit_export;
    REVOKE INSERT, UPDATE, DELETE ON pharmaops.release_metadata FROM pharmaops_security_audit_export;
  END IF;
END $$;

COMMIT;
