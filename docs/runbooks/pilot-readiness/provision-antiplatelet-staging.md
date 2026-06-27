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

## Required Validation

```powershell
node --test tests/ops/pilot-provisioning.test.mjs tests/security/authz-filter.test.mjs
npm test
```

There are no `lint` or `typecheck` scripts in `package.json` at the time of this runbook. Add and run them before productionizing this path.
