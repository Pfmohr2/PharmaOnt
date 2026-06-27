# Provision Antiplatelet Staging Pilot

Audience: platform administrators, security administrators, release managers, connector operators, and pilot support.

This runbook provisions the staging-only shell for the aspirin antiplatelet pilot tenant. It creates deterministic local provisioning state for `tenant-pilot-antiplatelet`; it does not create controlled-production resources, secrets, approvals, release candidates, released graphs, export packages, or login mappings.

## Scope

- Tenant: `tenant-pilot-antiplatelet`
- Display name: `Aspirin Antiplatelet Pilot`
- Environment: `staging`
- Graph scope: working graph only
- Controlled production: disabled and not creatable by this path
- Enabled source entitlements: ChEMBL `CHEMBL_34`, UniProt `2026_02`
- Disabled sources: FAERS/openFDA by default, internal PHI/PII prohibited

## Environment Variables

No secrets are required.

- `PHARMAOPS_PILOT_PROVISION_OUT`: optional output path for generated state. Default: `.generated/pilot-provisioning/tenant-pilot-antiplatelet.staging.json`
- `PHARMAOPS_PROVISION_ACTOR`: optional audit actor identifier. Default: `user:platform-admin:pilot-provisioner`

## Dry Run

```powershell
npm run provision:pilot:staging -- --dry-run
```

The dry run prints the canonical provisioning plan and plan digest. It writes nothing.

## Apply

```powershell
npm run provision:pilot:staging -- --apply
```

Apply writes the deterministic staging state to `PHARMAOPS_PILOT_PROVISION_OUT` or the default output path. Re-running apply is idempotent: the same tenant, environment, human placeholders, service accounts, entitlements, denies, and audit event IDs are rewritten without duplicate grants.

## Verify

```powershell
npm run provision:pilot:staging -- --verify
```

Verify checks the generated state for:

- one active tenant and exactly one `staging` environment;
- no controlled-production environment or creatable controlled-production flag;
- one primary role per human placeholder;
- source entitlements limited to ChEMBL `CHEMBL_34` and UniProt `2026_02`;
- FAERS/openFDA disabled and internal PHI/PII prohibited;
- service accounts scoped only to connector, source, license, job, metrics, raw artifact, normalized record, and working-candidate actions;
- explicit service-account denies for approvals, feedback, release and release-candidate actions, export packages, RBAC management, and break-glass;
- audit events for the provisioning changes.

## Rollback

```powershell
npm run provision:pilot:staging -- --rollback
```

Rollback removes only the generated staging provisioning state file. It does not touch production resources, release metadata, release manifests, export packages, secrets, or identity provider configuration.

## Day-1 Access Checks

1. Confirm SSO/login-to-principal mapping for each placeholder before granting access.
2. Confirm each human principal has exactly one primary role and is scoped to `tenant-pilot-antiplatelet` and `staging`.
3. Confirm the domain approver cannot approve proposals submitted by the same principal.
4. Confirm service accounts cannot record human feedback, approve or reject proposals, stage or promote releases, create export packages, manage RBAC, or activate break-glass.
5. Confirm ChEMBL and UniProt connector jobs carry connector ID, connector version, source version, license policy ID, and correlation context.
6. Confirm FAERS/openFDA stays disabled until a separate pilot decision and non-causal evidence policy review.
7. Confirm no internal PHI/PII source is enabled.

## User Onboarding

After staging provisioning is applied, tenant administrators can map approved SSO identities onto the existing placeholder principals. SSO remains authentication-only: roster `issuer` + `subject` proves who the user is, while the mapped placeholder principal decides tenant, environment, role, source entitlements, and actions.

Roster template:

```powershell
docs/runbooks/pilot-readiness/pilot-onboarding-roster.template.json
```

Required roster fields:

- `issuer` and `subject`: stable external identity key. Do not use email as the key.
- `email` and `display_name`: display and audit metadata only.
- `principal_id`: one existing `tenant-pilot-antiplatelet` / `staging` human placeholder principal.
- `training_acknowledgments`: all required sessions with `status = acknowledged`.
- `day1_access_confirmation`: confirmation that the user can complete the expected pilot checks and cannot see out-of-scope sources, actions, or hidden unauthorized counts.

Required training sessions:

- `system_and_governance_basics`
- `curator_workflow`
- `expert_review_and_approval`
- `release_and_export`

### Dry Run Onboarding

```powershell
npm run onboard:pilot:staging -- --roster docs/runbooks/pilot-readiness/pilot-onboarding-roster.template.json
```

Dry run validates the roster and reports `mapped_users`, `unmapped_users`, `missing_acknowledgments`, and `missing_day1_confirmations`. It does not mutate the provisioning state.

### Apply Onboarding

```powershell
npm run onboard:pilot:staging -- --apply --roster path/to/approved-roster.json
```

Apply activates valid mappings idempotently:

- creates an SSO mapping using issuer+subject hash;
- changes the placeholder principal from `placeholder_pending_sso_mapping` to `active`;
- records training acknowledgments;
- records Day-1 access confirmations;
- emits audit events for SSO mapping activation, principal activation, training acknowledgment, and Day-1 confirmation.

Re-running apply with the same roster rewrites the same canonical state without duplicate mappings, acknowledgments, confirmations, or audit events.

### Verify Onboarding

```powershell
npm run onboard:pilot:staging -- --verify
```

Verification output includes:

```json
{
  "verification": {
    "tenant_id": "tenant-pilot-antiplatelet",
    "environment": "staging",
    "mapped_user_count": 2,
    "unmapped_users": [],
    "missing_acknowledgments": [],
    "missing_day1_confirmations": [],
    "audit_event_count": 8,
    "controls": {
      "staging_only": true,
      "no_controlled_prod": true,
      "sso_authentication_only": true,
      "no_rbac_model_change": true,
      "no_service_account_sso": true
    },
    "ok": true,
    "errors": []
  }
}
```

### Day-1 User Confirmation

Record the following per mapped user:

1. Search succeeds for `aspirin`, `acetylsalicylic acid`, `CHEMBL25`, `PTGS1`, and `PTGS2`.
2. The user can open an entity page.
3. The user can inspect evidence.
4. The user sees only actions expected for the mapped principal role.
5. The user sees no hidden unauthorized counts.
6. The user cannot access out-of-scope sources or actions.
7. Controlled production is not visible or accessible.

Do not map service accounts through this onboarding path. Do not map users to controlled production. Do not add roles, source entitlements, export grants, release privileges, RBAC management, or break-glass through roster claims.

## Required Validation

```powershell
node --test tests/ops/pilot-provisioning.test.mjs tests/security/authz-filter.test.mjs
node --test tests/ops/pilot-onboarding.test.mjs
npm test
```

There are no `lint` or `typecheck` scripts in `package.json` at the time of this runbook. Add and run them before productionizing this path.
