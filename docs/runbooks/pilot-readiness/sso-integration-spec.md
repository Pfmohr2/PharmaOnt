# Pilot SSO Integration Spec

Audience: identity administrators, platform administrators, security reviewers, tenant administrators, and pilot support.

This spec defines the authentication-only SSO integration for the aspirin antiplatelet pilot. SSO proves who signed in. It does not grant PharmaOps roles, source entitlements, service-account permissions, export access, break-glass access, or release authority. Authorization remains server-side principal-context authorization in `services/authz-filter/src/index.js` and the workflow-specific authorization modules.

## Scope

- Tenant: `tenant-pilot-antiplatelet`
- Environment: `staging`
- Target principals: the existing human placeholder principals provisioned by `provision-antiplatelet-staging.md`
- Principal status before mapping: `placeholder_pending_sso_mapping`
- Principal status after approved mapping: `active`
- Controlled production: out of scope and not mappable by this integration
- Service accounts: out of scope; service accounts must not authenticate through SSO

## Protocol

Default to OIDC Authorization Code flow with PKCE if the enterprise IdP supports it. Use SAML only when the enterprise standard requires SAML and security approves the assertion validation profile.

Required OIDC configuration:

- issuer URL;
- authorization endpoint;
- token endpoint;
- JWKS endpoint;
- client ID;
- redirect URI allowlist;
- requested scopes: `openid profile email`;
- token signing algorithms allowed by security;
- MFA claim or assurance reference claim used for pilot MFA checks;
- IdP session max age and recent-auth controls for step-up.

Required SAML configuration if SAML is used:

- entity ID;
- SSO endpoint;
- signing certificate metadata;
- assertion consumer service URL;
- NameID or immutable subject attribute;
- issuer value;
- MFA or assurance attribute;
- assertion lifetime, audience, recipient, and destination constraints.

Secrets such as client secrets, private keys, and signing certificates are configured in the deployment secret store. They must not be committed to this repository or recorded in the generated pilot provisioning state.

## Redirect URI

Use one staging redirect URI per deployed pilot frontend/API origin:

```text
https://<staging-pharmaops-host>/auth/sso/callback
```

Infra must confirm the final hostname. Local callback URIs are allowed only for developer test clients and must not be enabled for the pilot production IdP application.

## Required Claims

The stable external identity key is:

```text
external_identity_key = issuer + "\u0000" + subject
```

Use the OIDC `iss` and `sub` claims, or the SAML issuer and immutable NameID/subject attribute. Do not use email as the key.

Required authentication fields:

- `issuer`: trusted IdP issuer.
- `subject`: immutable per-user subject from the IdP.
- `audience`: PharmaOps SSO client ID or SAML service provider entity ID.
- `expires_at`: token/assertion expiry.
- `issued_at`: token/assertion issued time.
- `auth_time` or equivalent recent-auth timestamp when available.
- `amr`, `acr`, or equivalent MFA/assurance signal.
- `email`: display and audit metadata only.
- `display_name`: display and audit metadata only.

Optional claims and groups are eligibility signals only. They must not be translated directly into PharmaOps roles, scopes, source entitlements, release access, export access, or break-glass access.

## Token Or Assertion Validation

The backend validates every login callback before any principal lookup:

1. Verify issuer is on the staging IdP allowlist.
2. Verify signature using the configured JWKS or SAML signing certificate.
3. Verify audience matches the PharmaOps pilot SSO client.
4. Verify expiry, issued-at, not-before, recipient, destination, and nonce/state where applicable.
5. Verify the authorization code flow used PKCE for public clients.
6. Verify MFA evidence is present for all pilot users.
7. Extract issuer and subject.
8. Build `external_identity_key`.
9. Look up an active mapping to exactly one active human principal.
10. Build the PharmaOps principal context from the mapped principal record only.

The principal context passed into `services/authz-filter/src/index.js` must come from PharmaOps provisioning state:

```json
{
  "user_id": "principal:tenant-pilot-antiplatelet:staging:curator",
  "tenant_id": "tenant-pilot-antiplatelet",
  "environment": "staging",
  "role_keys": ["curator"],
  "principal_type": "human"
}
```

SSO claims may update display and audit metadata, but they must not mutate `role_keys`, `source_entitlement_ids`, `tenant_id`, `environment`, `principal_type`, or service-account grants.

## Mapping Table

Store mappings adjacent to the provisioned principal records, not in IdP claims. The mapping table is tenant and environment scoped.

Required shape:

```json
{
  "mapping_id": "sso-map:tenant-pilot-antiplatelet:staging:<digest>",
  "tenant_id": "tenant-pilot-antiplatelet",
  "environment": "staging",
  "issuer": "https://idp.example.com/",
  "subject": "00u123immutable",
  "external_identity_key_hash": "sha256:<issuer-subject-digest>",
  "principal_id": "principal:tenant-pilot-antiplatelet:staging:curator",
  "principal_status_before": "placeholder_pending_sso_mapping",
  "principal_status_after": "active",
  "email_at_mapping": "person@example.com",
  "display_name_at_mapping": "Person Example",
  "approved_by_principal_id": "principal:tenant-pilot-antiplatelet:staging:tenant-administrator",
  "second_approved_by_principal_id": "principal:tenant-pilot-antiplatelet:staging:compliance-security-reviewer",
  "status": "active",
  "created_at": "server-time",
  "disabled_at": null,
  "correlation_id": "corr:sso-map:<request-id>"
}
```

Constraints:

- One active issuer+subject mapping per tenant/environment.
- One active mapping per placeholder principal.
- Mapping target must be a human placeholder principal, not a service account.
- Mapping target must be scoped to `tenant-pilot-antiplatelet` and `staging`.
- Mapping must not target controlled production.
- Mapping approval requires tenant admin/security action with recent-auth step-up.
- Group claims may be recorded as eligibility evidence but must not be persisted as roles.

## Pending Mapping Request Flow

If no active mapping exists for a validated issuer+subject:

1. Create a pending mapping request.
2. Deny application access.
3. Return a non-sensitive pending-access message to the user.
4. Queue the request for tenant administrator and compliance/security review.
5. Emit an audit event.

Pending request shape:

```json
{
  "request_id": "sso-pending:tenant-pilot-antiplatelet:staging:<digest>",
  "tenant_id": "tenant-pilot-antiplatelet",
  "environment": "staging",
  "issuer": "https://idp.example.com/",
  "subject_hash": "sha256:<subject-digest>",
  "email_at_login": "person@example.com",
  "display_name_at_login": "Person Example",
  "requested_at": "server-time",
  "status": "pending_admin_mapping",
  "denied_access": true,
  "correlation_id": "corr:sso-login:<request-id>"
}
```

Do not expose whether another identity is already mapped to a target principal. Do not expose role, entitlement, hidden-result, or release-context details to unmapped users.

## Activation Flow

1. Tenant administrator or security reviewer opens the pending mapping queue.
2. Reviewer confirms the external identity from IdP metadata and helpdesk/onboarding evidence.
3. Reviewer selects exactly one existing placeholder principal.
4. Backend verifies the placeholder is `placeholder_pending_sso_mapping`, human, staging-scoped, and unmapped.
5. Reviewer completes step-up authentication.
6. Backend creates the mapping row.
7. Backend changes the principal status to `active`.
8. Backend emits mapping and principal activation audit events.
9. User signs in again.
10. User completes Day-1 access verification and training acknowledgment.

Activation must not alter the placeholder principal's role, source entitlements, tenant, environment, or restrictions. Role or entitlement changes are a separate governed workflow with step-up and audit.

## Disable And Deprovision

Disable a mapping when a user leaves the pilot, changes responsibility, fails access review, or the IdP subject is compromised.

Disable flow:

1. Tenant administrator or security reviewer selects the active mapping.
2. Reviewer completes step-up authentication.
3. Backend sets mapping status to `disabled`.
4. Backend records disabled reason and reviewer.
5. Backend changes the mapped principal status to `disabled` unless security explicitly remaps it through a new approval.
6. Backend invalidates active sessions and refresh tokens for that principal.
7. Backend emits mapping disabled, principal disabled, and session invalidation audit events.

Disabled users must fail closed at login and API authorization. Deprovisioning must not delete audit events.

## MFA And Step-Up Policy

MFA is required for every pilot SSO login. If the IdP does not provide a reliable MFA/assurance signal, backend access must remain denied until infra provides one.

Step-up or recent-auth is required for:

- SSO identity mapping approval or disablement;
- principal role changes;
- source entitlement changes;
- service-account scope changes;
- proposal approvals and rejections;
- release staging, release candidate creation, release promotion, and rollback;
- export preview that creates a job or export package;
- RBAC policy changes;
- break-glass request, approval, activation, and audit export.

Pilot support does not receive break-glass unless security explicitly approves a separate break-glass design.

Recommended recent-auth window: 10 minutes for privileged changes and release/export actions. Infra must confirm the final value based on IdP capability and enterprise policy.

## Audit Events

Audit events follow the pilot provisioning pattern: tenant, environment, actor, actor type, object ID, event type, status, and correlation ID. Events must not include raw tokens, assertions, secrets, or full unmapped subject values.

Required event types:

- `sso.login.validated`
- `sso.login.denied_no_mapping`
- `sso.login.denied_mfa_missing`
- `sso.login.denied_invalid_assertion`
- `sso.mapping_request.created`
- `sso.mapping.approved`
- `sso.mapping.denied`
- `sso.mapping.disabled`
- `sso.principal.activated`
- `sso.principal.disabled`
- `sso.step_up.required`
- `sso.step_up.satisfied`
- `sso.step_up.denied`
- `sso.session.invalidated`
- `sso.claims.ignored_for_authorization`

Required fields:

- `audit_event_id`
- `event_type`
- `tenant_id`
- `environment`
- `actor`
- `actor_type`
- `object_id`
- `principal_id`
- `issuer`
- `subject_hash`
- `mapping_id`
- `request_id`
- `decision`
- `reason`
- `correlation_id`
- `status`
- `created_at`

For denial events, record the denial reason without leaking hidden counts, roles, release IDs, source entitlements, or candidate details.

## Day-1 Access Verification

After activation, each pilot user must verify:

1. They can log in through SSO with MFA.
2. Their displayed tenant is `tenant-pilot-antiplatelet`.
3. Their displayed environment is `staging`.
4. Their role matches exactly one provisioned primary role.
5. They cannot access controlled production.
6. They can see only authorized working-scope pilot surfaces.
7. Privileged actions require recent-auth step-up.
8. Training acknowledgment is completed and audited.

Tenant administrators must retain the Day-1 verification result and training acknowledgment reference as audit metadata.

## Test Plan

Happy path:

- Valid OIDC/SAML login with MFA and an active issuer+subject mapping creates a principal context from the mapped principal record.
- The principal passes `services/authz-filter/src/index.js` only for its tenant, environment, role, release context, and source entitlements.

No mapping deny:

- Valid SSO login with no mapping creates one pending mapping request, denies app access, and emits `sso.login.denied_no_mapping` plus `sso.mapping_request.created`.
- Repeated logins for the same issuer+subject reuse or update the pending request without duplicate active mappings.

Group claim does not grant role:

- A token containing admin, release, security, or group claims does not change `role_keys`, `source_entitlement_ids`, tenant, environment, export grants, or break-glass state.
- Backend emits `sso.claims.ignored_for_authorization` when group claims are present.

Step-up:

- Privileged role/entitlement changes, approval, release, export-job creation, and break-glass attempts fail without recent-auth step-up.
- The same actions pass only after a valid step-up event and existing PharmaOps authorization.

Disable and deprovision:

- Disabled mappings fail closed at login.
- Existing sessions for the disabled principal are invalidated.
- Disabled principals cannot pass API authorization.

MFA:

- Login without MFA/assurance evidence is denied.
- Missing or ambiguous MFA claims do not fall back to email, group, or tenant allowlists.

Service accounts:

- Service-account principals cannot be mapped to SSO identities.
- Connector service-account explicit denies remain unchanged.

Controlled production:

- Mapping attempts to controlled production are rejected.
- No controlled-production principal, release context, or graph scope is created by this integration.

## Infra Decisions To Confirm

- Whether the enterprise IdP supports OIDC Authorization Code flow with PKCE; otherwise confirm SAML as the mandated fallback.
- Final staging issuer, metadata URL, client ID, redirect URI, and allowed signing algorithms.
- Exact immutable subject claim or SAML attribute; confirm it is stable across email/name changes.
- Exact MFA/assurance claim and acceptable values.
- Recent-auth or step-up mechanism and max age for privileged actions.
- Session lifetime, refresh-token policy, and session invalidation API.
- Helpdesk/onboarding evidence required before a tenant admin/security reviewer maps a pending request.
- Whether dual approval is required for all mappings or only privileged roles.
- Final audit sink and retention class for SSO login and mapping events.
