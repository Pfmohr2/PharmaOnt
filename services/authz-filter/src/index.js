const READ_RELEASED_ROLES = Object.freeze([
  "viewer",
  "contributor",
  "curator",
  "domain_approver",
  "compliance_reviewer",
  "release_manager",
  "data_engineer",
  "platform_admin",
  "security_admin",
  "service_account"
]);

const READ_WORKING_ROLES = Object.freeze([
  "contributor",
  "curator",
  "domain_approver",
  "compliance_reviewer",
  "release_manager",
  "data_engineer",
  "platform_admin",
  "security_admin"
]);

const EXPORT_ROLES = Object.freeze(["compliance_reviewer", "release_manager", "security_admin"]);

const ASSERTION_TYPE_ROLES = Object.freeze({
  canonical: READ_RELEASED_ROLES,
  approved: READ_RELEASED_ROLES,
  released: READ_RELEASED_ROLES,
  evidence: READ_RELEASED_ROLES,
  relationship: READ_RELEASED_ROLES,
  mapping: READ_RELEASED_ROLES,
  synonym: READ_RELEASED_ROLES,
  model_suggested: ["contributor", "curator", "domain_approver", "data_engineer", "security_admin"],
  restricted_evidence: ["curator", "domain_approver", "compliance_reviewer", "security_admin"]
});

const RELEASED_STATES = new Set(["approved", "released", "active", "published"]);
const WORKING_RELEASE_IDS = new Set(["working", "draft", "preview", "candidate", "release_candidate"]);
const ACTION_USE = Object.freeze({
  read: "search",
  search: "search",
  export: "export"
});

export class AuthorizationFilterError extends Error {
  constructor(message = "authorization filter denied request") {
    super(message);
    this.name = "AuthorizationFilterError";
  }
}

export function filterAuthorizedResults({ principal, results, action = "read", releaseContext = null } = {}) {
  assertPrincipal(principal);
  if (!Array.isArray(results)) {
    throw new AuthorizationFilterError("candidate result set must be an array");
  }
  return results.filter((result) => isResultAuthorized({ principal, result, action, releaseContext }));
}

export function filterAuthorizedResponse({ principal, response, action = "read", releaseContext = null } = {}) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new AuthorizationFilterError("response object is required");
  }
  const sourceResults = Array.isArray(response.results) ? response.results : [];
  const results = filterAuthorizedResults({ principal, results: sourceResults, action, releaseContext });
  return {
    ...response,
    results,
    total: results.length,
    authorization_filtered: true
  };
}

export function isResultAuthorized({ principal, result, action = "read", releaseContext = null } = {}) {
  try {
    assertPrincipal(principal);
    assertResultShape(result);
    const roles = roleSet(principal);
    const tenantId = valueOf(result, "tenant_id", "tenantId");
    const environment = valueOf(result, "environment", "env");
    if (tenantId !== principal.tenant_id || environment !== principal.environment) {
      return false;
    }
    if (!hasAllowedUse(result, action)) {
      return false;
    }
    if (!hasVisibleAssertionType(result, roles)) {
      return false;
    }
    if (!hasRoleVisibility(result, roles)) {
      return false;
    }
    if (!hasReleaseVisibility({ principal, result, roles, action, releaseContext })) {
      return false;
    }
    if (action === "export" && !hasExportGrant(principal, result, roles)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function assertResultFilterApplied(response) {
  if (!response || response.authorization_filtered !== true) {
    throw new AuthorizationFilterError("server-side authorization filter was not applied");
  }
  return true;
}

export function isExportRegulatedResultComplete(result) {
  return missingExportRegulatedFields(result).length === 0;
}

export function missingExportRegulatedFields(result) {
  const missing = [];
  for (const field of ["id", "tenant_id", "environment", "release_id", "provenance_id", "artifact_hash", "license_status", "license_policy_id"]) {
    if (!nonEmpty(valueOf(result, field))) {
      missing.push(field);
    }
  }
  if (!nonEmpty(result?.license_classification ?? result?.license?.classification ?? result?.license?.license_classification)) {
    missing.push("license_classification");
  }
  if (requiresVocabularyVersions(result)) {
    for (const field of ["source_vocabulary_version", "target_vocabulary_version"]) {
      if (!nonEmpty(valueOf(result, field))) {
        missing.push(field);
      }
    }
  }
  return missing;
}

function assertPrincipal(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    throw new AuthorizationFilterError("principal is required");
  }
  assertNonEmpty(principal.tenant_id, "principal.tenant_id");
  assertNonEmpty(principal.environment, "principal.environment");
  if (!Array.isArray(principal.role_keys) || principal.role_keys.length === 0) {
    throw new AuthorizationFilterError("principal.role_keys is required");
  }
}

function assertResultShape(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new AuthorizationFilterError("candidate result must be an object");
  }
  assertNonEmpty(valueOf(result, "tenant_id", "tenantId"), "result.tenant_id");
  assertNonEmpty(valueOf(result, "environment", "env"), "result.environment");
}

function hasAllowedUse(result, action) {
  if (result.license_status === "blocked" || result.license_status === "pending_review") {
    return false;
  }
  const requiredUse = ACTION_USE[action] ?? action;
  const permittedUses = arrayOf(result.permitted_uses ?? result.license?.permitted_uses);
  if (permittedUses.length > 0 && !permittedUses.includes(requiredUse)) {
    return false;
  }
  if (action === "export") {
    const restrictions = arrayOf(result.export_restrictions ?? result.license?.export_restrictions);
    if (restrictions.includes("contains_phi_or_pii") || restrictions.includes("export_prohibited")) {
      return false;
    }
  }
  return true;
}

function hasVisibleAssertionType(result, roles) {
  const assertionType = String(result.assertion_type ?? result.assertionType ?? result.result_type ?? "canonical");
  const allowed = ASSERTION_TYPE_ROLES[assertionType] ?? null;
  if (!allowed) {
    return false;
  }
  return intersects(roles, allowed);
}

function hasRoleVisibility(result, roles) {
  const allowedRoles = arrayOf(
    result.visibility_roles ??
    result.allowed_roles ??
    result.required_roles ??
    result.authorization?.visibility_roles
  );
  return allowedRoles.length === 0 || intersects(roles, allowedRoles);
}

function hasReleaseVisibility({ principal, result, roles, action, releaseContext }) {
  const releaseId = valueOf(result, "release_id", "releaseId");
  const releaseState = String(result.release_status ?? result.lifecycle_status ?? result.review_status ?? "");
  const releaseGraph = String(result.release_graph ?? result.graph_name ?? "");
  const working = isWorkingResult({ releaseId, releaseState, releaseGraph });
  const allowedReleaseIds = arrayOf(principal.allowed_release_ids ?? principal.release_ids);
  const requestedReleaseId = releaseContext?.release_id ?? principal.release_id ?? null;

  if (working) {
    return action !== "export" && intersects(roles, READ_WORKING_ROLES);
  }
  if (releaseId && requestedReleaseId && releaseId !== requestedReleaseId) {
    return false;
  }
  if (releaseId && allowedReleaseIds.length > 0 && !allowedReleaseIds.includes("*") && !allowedReleaseIds.includes(releaseId)) {
    return false;
  }
  if (releaseState && !RELEASED_STATES.has(releaseState)) {
    return intersects(roles, READ_WORKING_ROLES);
  }
  return intersects(roles, READ_RELEASED_ROLES);
}

function hasExportGrant(principal, result, roles) {
  if (!intersects(roles, EXPORT_ROLES)) {
    return false;
  }
  const releaseId = valueOf(result, "release_id", "releaseId");
  if (!releaseId || WORKING_RELEASE_IDS.has(String(releaseId))) {
    return false;
  }
  if (principal.principal_type === "service_account") {
    const grant = principal.export_grant;
    return Boolean(
      grant &&
      grant.tenant_id === principal.tenant_id &&
      grant.environment === principal.environment &&
      grant.release_id === releaseId &&
      grant.active === true
    );
  }
  return true;
}

function isWorkingResult({ releaseId, releaseState, releaseGraph }) {
  if (!releaseId) {
    return true;
  }
  if (WORKING_RELEASE_IDS.has(String(releaseId))) {
    return true;
  }
  if (releaseGraph.includes(":working:") || releaseGraph.includes(":staging:")) {
    return true;
  }
  return Boolean(releaseState) && !RELEASED_STATES.has(releaseState);
}

function roleSet(principal) {
  return new Set(principal.role_keys.map(String));
}

function intersects(roles, allowedRoles) {
  return allowedRoles.some((role) => roles.has(role));
}

function arrayOf(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [String(value)];
}

function valueOf(value, ...keys) {
  for (const key of keys) {
    if (value?.[key] !== undefined && value[key] !== null) {
      return value[key];
    }
  }
  return undefined;
}

function assertNonEmpty(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new AuthorizationFilterError(`${fieldName} is required`);
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

function requiresVocabularyVersions(result) {
  const assertionType = String(result?.assertion_type ?? result?.assertionType ?? result?.result_type ?? "canonical");
  return ["mapping", "synonym", "relationship", "canonical", "approved", "released"].includes(assertionType);
}
