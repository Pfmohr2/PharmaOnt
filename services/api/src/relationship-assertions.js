import { validateRelationshipAssertionContract } from "../../../packages/contracts/src/index.js";
import { executeAuthorizedQuery } from "./query-boundary.js";

export const PHASEB_RELATIONSHIP_ASSERTION_API_VERSION = "semantic-bridge.relationship-assertion-api.v1";

const CREATE_ROLES = new Set(["curator", "relationship_curator", "relationship_editor", "data_engineer", "platform_admin"]);
const READ_WORKING_ROLES = new Set(["curator", "domain_approver", "compliance_reviewer", "release_manager", "data_engineer", "platform_admin", "security_admin"]);
const REVIEWER_ROLES = new Set(["curator", "domain_approver", "compliance_reviewer", "platform_admin"]);
const CAUSAL_SAFETY_APPROVER_ROLES = new Set(["causal_safety_approver", "safety_approver"]);
const STEWARD_ROLES = new Set(["data_steward", "curator", "domain_approver", "compliance_reviewer", "platform_admin"]);
const WORKFLOW_TRANSITIONS = new Set(["submit", "approve", "reject", "deprecate"]);
const EVIDENCE_LINEAGE_PATCH_FIELDS = new Set(["evidence_refs", "source_record_ids", "source_names", "source_versions"]);
const PATCH_BLOCKED_FIELDS = new Set([
  "schema_version",
  "relationship_assertion_id",
  "tenant_id",
  "environment",
  "assertion_type",
  "review_status",
  "reviewed_by",
  "reviewed_at",
  "release_context",
  "validation_report_ids",
  "created_by",
  "created_at",
  "provenance_id"
]);

export class RelationshipAssertionApiError extends Error {
  constructor(message, { code = "relationship_assertion_api_error", status = 400, details = {} } = {}) {
    super(message);
    this.name = "RelationshipAssertionApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class PhaseBRelationshipAssertionApi {
  constructor({
    relationshipAssertionStore,
    resolveRelationshipAssertionById = null,
    resolveRelationshipsByEntityId = null,
    validateRelationshipAssertion = validateRelationshipAssertionContract,
    clock = () => new Date(),
    idFactory = defaultIdFactory
  } = {}) {
    if (!relationshipAssertionStore || typeof relationshipAssertionStore.createRelationshipAssertion !== "function") {
      throw new RelationshipAssertionApiError("relationshipAssertionStore.createRelationshipAssertion is required", { status: 500 });
    }
    this.relationshipAssertionStore = relationshipAssertionStore;
    this.resolveRelationshipAssertionById = resolveRelationshipAssertionById;
    this.resolveRelationshipsByEntityId = resolveRelationshipsByEntityId;
    this.validateRelationshipAssertion = validateRelationshipAssertion;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async createRelationshipAssertion({ principal, assertion } = {}) {
    assertPrincipal(principal);
    assertHumanWritePrincipal(principal);
    assertCreateRole(principal);
    assertObject(assertion, "assertion");
    assertPrincipalScope(principal, assertion);
    const validation = this.validateRelationshipAssertion(assertion);
    if (!validation.valid) {
      throw validationError(validation.errors);
    }

    const result = await this.persistThroughStore({
      principal,
      assertion,
      action: "create"
    });

    return writeResponse({
      principal,
      generatedAt: this.clock().toISOString(),
      action: "create",
      assertion: {
        ...assertion,
        audit_event_id: result.auditEvent?.audit_event_id ?? assertion.provenance?.audit_event_id ?? null,
        graph_name: result.graphName ?? null
      },
      storeResult: result
    });
  }

  async getRelationshipAssertion({ principal, relationshipAssertionId, request = {} } = {}) {
    assertPrincipal(principal);
    assertText(relationshipAssertionId, "relationshipAssertionId");
    const row = await this.loadRelationshipAssertion({ principal, relationshipAssertionId });
    if (!row) {
      throw new RelationshipAssertionApiError("relationship assertion not found", {
        code: "relationship_assertion_not_found",
        status: 404,
        details: { relationship_assertion_id: relationshipAssertionId }
      });
    }
    const releaseContext = releaseContextFor(principal, request);
    const boundary = await executeAuthorizedQuery({
      principal,
      query: { relationship_assertion_id: relationshipAssertionId, release_context: releaseContext },
      candidateResults: [apiRow(row)],
      releaseContext
    });
    if (boundary.results.length !== 1) {
      throw new RelationshipAssertionApiError("relationship assertion is not visible in the requested scope", {
        code: "relationship_assertion_not_visible",
        status: 404,
        details: { relationship_assertion_id: relationshipAssertionId }
      });
    }
    return {
      schema_version: PHASEB_RELATIONSHIP_ASSERTION_API_VERSION,
      generated_at: this.clock().toISOString(),
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      relationship_assertion: apiRow(boundary.results[0]),
      authorization_filtered: true
    };
  }

  async patchRelationshipAssertion({ principal, relationshipAssertionId, patch } = {}) {
    assertPrincipal(principal);
    assertHumanWritePrincipal(principal);
    assertCreateRole(principal);
    assertText(relationshipAssertionId, "relationshipAssertionId");
    assertObject(patch, "patch");
    assertPatchAllowed(patch);

    const current = await this.loadRelationshipAssertion({ principal, relationshipAssertionId });
    if (!current) {
      throw new RelationshipAssertionApiError("relationship assertion not found", {
        code: "relationship_assertion_not_found",
        status: 404,
        details: { relationship_assertion_id: relationshipAssertionId }
      });
    }
    const currentAssertion = canonicalAssertionFrom(current);
    assertPrincipalScope(principal, currentAssertion);

    if (hasEvidenceLineageChange(currentAssertion, patch)) {
      assertEvidencePatchOnly(patch);
      const result = await this.updateEvidenceThroughStore({
        tenantId: principal.tenant_id,
        currentAssertion,
        evidenceRefs: patch.evidence_refs ?? currentAssertion.evidence_refs,
        graphName: graphNameFrom(current, currentAssertion),
        actor: actorFor(principal),
        actorRoleKey: writeRoleFor(principal)
      });
      const evidenceAssertion = result.assertion ?? result.relationship_assertion ?? currentAssertion;
      return writeResponse({
        principal,
        generatedAt: this.clock().toISOString(),
        action: "patch",
        assertion: {
          ...evidenceAssertion,
          audit_event_id: result.auditEvent?.audit_event_id ?? evidenceAssertion.provenance?.audit_event_id ?? null,
          graph_name: result.graphName ?? graphNameFrom(current, currentAssertion) ?? null
        },
        storeResult: result
      });
    }

    const nextAssertion = dropUndefined(deepMerge(currentAssertion, {
      ...patch,
      updated_at: patch.updated_at ?? this.clock().toISOString()
    }));
    assertPrincipalScope(principal, nextAssertion);
    const validation = this.validateRelationshipAssertion(nextAssertion);
    if (!validation.valid) {
      throw validationError(validation.errors);
    }

    const result = await this.persistThroughStore({
      principal,
      assertion: nextAssertion,
      action: "patch"
    });

    return writeResponse({
      principal,
      generatedAt: this.clock().toISOString(),
      action: "patch",
      assertion: {
        ...nextAssertion,
        audit_event_id: result.auditEvent?.audit_event_id ?? nextAssertion.provenance?.audit_event_id ?? null,
        graph_name: result.graphName ?? null
      },
      storeResult: result
    });
  }

  async submitRelationshipAssertion({ principal, relationshipAssertionId, decision = {} } = {}) {
    return this.runRelationshipAssertionTransition({
      principal,
      relationshipAssertionId,
      transition: "submit",
      decision
    });
  }

  async approveRelationshipAssertion({ principal, relationshipAssertionId, decision = {} } = {}) {
    return this.runRelationshipAssertionTransition({
      principal,
      relationshipAssertionId,
      transition: "approve",
      decision
    });
  }

  async rejectRelationshipAssertion({ principal, relationshipAssertionId, decision = {} } = {}) {
    return this.runRelationshipAssertionTransition({
      principal,
      relationshipAssertionId,
      transition: "reject",
      decision
    });
  }

  async deprecateRelationshipAssertion({ principal, relationshipAssertionId, decision = {} } = {}) {
    return this.runRelationshipAssertionTransition({
      principal,
      relationshipAssertionId,
      transition: "deprecate",
      decision
    });
  }

  async listEntityRelationships({ principal, entityId, request = {} } = {}) {
    assertPrincipal(principal);
    assertText(entityId, "entityId");
    const includeWorking = request.include_working === true || request.includeWorking === true || request.scope === "working";
    if (includeWorking) {
      assertWorkingReadRole(principal);
    }
    const rows = await this.loadRelationshipsByEntityId({ principal, entityId });
    const candidates = rows.map(apiRow).filter((row) => includeWorking || isReleasedRow(row));
    const releaseContext = includeWorking
      ? { release_id: null, scope: "working" }
      : releaseContextFor(principal, request);
    const boundary = await executeAuthorizedQuery({
      principal,
      query: {
        entity_id: entityId,
        include_working: includeWorking,
        release_context: releaseContext
      },
      candidateResults: candidates,
      releaseContext
    });
    return {
      schema_version: PHASEB_RELATIONSHIP_ASSERTION_API_VERSION,
      generated_at: this.clock().toISOString(),
      tenant_id: principal.tenant_id,
      environment: principal.environment,
      entity_id: entityId,
      release_context: releaseContext,
      relationships: boundary.results.map(apiRow),
      total: boundary.results.length,
      authorization_filtered: true,
      policy_notice: includeWorking
        ? "Working relationship rows are filtered by tenant, environment, role, release, and source entitlements."
        : "Relationship rows default to released scope; working rows require include_working=true and authorization."
    };
  }

  async persistThroughStore({ principal, assertion, action }) {
    try {
      return await this.relationshipAssertionStore.createRelationshipAssertion({
        tenantId: principal.tenant_id,
        assertion,
        actorRoleKey: writeRoleFor(principal),
        actor: principal.user_id ?? principal.actor ?? assertion.created_by,
        apiAction: action
      });
    } catch (error) {
      throw storeError(error);
    }
  }

  async loadRelationshipAssertion({ principal, relationshipAssertionId }) {
    if (typeof this.resolveRelationshipAssertionById === "function") {
      return this.resolveRelationshipAssertionById({ principal, relationshipAssertionId });
    }
    if (typeof this.relationshipAssertionStore.getRelationshipAssertionById === "function") {
      return this.relationshipAssertionStore.getRelationshipAssertionById({
        tenantId: principal.tenant_id,
        relationshipAssertionId
      });
    }
    throw new RelationshipAssertionApiError("relationship assertion read resolver is required", { status: 500 });
  }

  async loadRelationshipsByEntityId({ principal, entityId }) {
    if (typeof this.resolveRelationshipsByEntityId === "function") {
      const rows = await this.resolveRelationshipsByEntityId({ principal, entityId });
      return arrayOfRows(rows, "resolveRelationshipsByEntityId");
    }
    if (typeof this.relationshipAssertionStore.listRelationshipAssertionsByEntityId === "function") {
      const rows = await this.relationshipAssertionStore.listRelationshipAssertionsByEntityId({
        tenantId: principal.tenant_id,
        entityId
      });
      return arrayOfRows(rows, "relationshipAssertionStore.listRelationshipAssertionsByEntityId");
    }
    throw new RelationshipAssertionApiError("entity relationship read resolver is required", { status: 500 });
  }

  async runRelationshipAssertionTransition({ principal, relationshipAssertionId, transition, decision = {} }) {
    assertPrincipal(principal);
    assertWorkflowTransition(transition);
    assertText(relationshipAssertionId, "relationshipAssertionId");
    assertObject(decision, "decision");
    assertHumanWorkflowPrincipal(principal, transition);

    const current = await this.loadRelationshipAssertion({ principal, relationshipAssertionId });
    if (!current) {
      throw new RelationshipAssertionApiError("relationship assertion not found", {
        code: "relationship_assertion_not_found",
        status: 404,
        details: { relationship_assertion_id: relationshipAssertionId }
      });
    }
    const currentAssertion = canonicalAssertionFrom(current);
    assertPrincipalScope(principal, currentAssertion);

    const result = await this.transitionThroughStore({
      tenantId: principal.tenant_id,
      currentAssertion,
      transition,
      decision,
      graphName: graphNameFrom(current, currentAssertion),
      actor: actorFor(principal),
      actorRoleKey: workflowRoleFor(principal, transition, currentAssertion),
      stepUpAuthenticated: transition === "approve" ? stepUpAuthenticatedFor(principal) : false
    });

    const nextAssertion = result.assertion ?? result.relationship_assertion ?? currentAssertion;
    return writeResponse({
      principal,
      generatedAt: this.clock().toISOString(),
      action: transition,
      assertion: {
        ...nextAssertion,
        audit_event_id: result.auditEvent?.audit_event_id ?? nextAssertion.provenance?.audit_event_id ?? null,
        graph_name: result.graphName ?? graphNameFrom(current, currentAssertion) ?? null
      },
      storeResult: result
    });
  }

  async transitionThroughStore(args) {
    if (typeof this.relationshipAssertionStore.transitionRelationshipAssertion !== "function") {
      throw new RelationshipAssertionApiError("relationshipAssertionStore.transitionRelationshipAssertion is required", { status: 500 });
    }
    try {
      return await this.relationshipAssertionStore.transitionRelationshipAssertion(args);
    } catch (error) {
      throw transitionStoreError(error);
    }
  }

  async updateEvidenceThroughStore(args) {
    if (typeof this.relationshipAssertionStore.updateRelationshipEvidence !== "function") {
      throw new RelationshipAssertionApiError("relationshipAssertionStore.updateRelationshipEvidence is required", { status: 500 });
    }
    try {
      return await this.relationshipAssertionStore.updateRelationshipEvidence(args);
    } catch (error) {
      throw transitionStoreError(error);
    }
  }
}

export function createPhaseBRelationshipAssertionApi(dependencies) {
  return new PhaseBRelationshipAssertionApi(dependencies);
}

export function createRelationshipAssertionRouteAdapters(api) {
  return {
    "POST /relationship-assertions": (context) =>
      api.createRelationshipAssertion({ principal: context.principal, assertion: context.body ?? context.assertion }),
    "GET /relationship-assertions/{id}": (context) =>
      api.getRelationshipAssertion({
        principal: context.principal,
        relationshipAssertionId: context.params?.id ?? context.relationshipAssertionId,
        request: context.query ?? context.request ?? {}
      }),
    "PATCH /relationship-assertions/{id}": (context) =>
      api.patchRelationshipAssertion({
        principal: context.principal,
        relationshipAssertionId: context.params?.id ?? context.relationshipAssertionId,
        patch: context.body ?? context.patch
      }),
    "POST /relationship-assertions/{id}/submit": (context) =>
      api.submitRelationshipAssertion({
        principal: context.principal,
        relationshipAssertionId: context.params?.id ?? context.relationshipAssertionId,
        decision: context.body ?? context.decision ?? {}
      }),
    "POST /relationship-assertions/{id}/approve": (context) =>
      api.approveRelationshipAssertion({
        principal: context.principal,
        relationshipAssertionId: context.params?.id ?? context.relationshipAssertionId,
        decision: context.body ?? context.decision ?? {}
      }),
    "POST /relationship-assertions/{id}/reject": (context) =>
      api.rejectRelationshipAssertion({
        principal: context.principal,
        relationshipAssertionId: context.params?.id ?? context.relationshipAssertionId,
        decision: context.body ?? context.decision ?? {}
      }),
    "POST /relationship-assertions/{id}/deprecate": (context) =>
      api.deprecateRelationshipAssertion({
        principal: context.principal,
        relationshipAssertionId: context.params?.id ?? context.relationshipAssertionId,
        decision: context.body ?? context.decision ?? {}
      }),
    "GET /entities/{id}/relationships": (context) =>
      api.listEntityRelationships({
        principal: context.principal,
        entityId: context.params?.id ?? context.entityId,
        request: context.query ?? context.request ?? {}
      })
  };
}

function writeResponse({ principal, generatedAt, action, assertion, storeResult }) {
  return {
    schema_version: PHASEB_RELATIONSHIP_ASSERTION_API_VERSION,
    generated_at: generatedAt,
    tenant_id: principal.tenant_id,
    environment: principal.environment,
    action,
    relationship_assertion_id: assertion.relationship_assertion_id,
    relationship_assertion: apiRow(assertion),
    graph_name: storeResult.graphName ?? assertion.graph_name ?? null,
    audit_event_id: storeResult.auditEvent?.audit_event_id ?? assertion.audit_event_id ?? null,
    authorization_filtered: true
  };
}

function apiRow(row) {
  const source = row.assertion ?? row.source_assertion ?? row.source ?? row;
  const dataLicense = source.data_license ?? row.data_license ?? {};
  const releaseContext = source.release_context ?? row.release_context ?? {};
  return {
    ...row,
    id: row.id ?? source.relationship_assertion_id ?? source.relationship_id ?? row.relationship_assertion_id ?? row.relationship_id,
    object_id: row.object_id ?? source.relationship_assertion_id ?? row.relationship_assertion_id ?? row.id,
    object_type: row.object_type ?? "relationship",
    result_type: row.result_type ?? "relationship",
    assertion_type: "relationship",
    relationship_assertion_type: source.assertion_type ?? row.relationship_assertion_type ?? row.assertion_type,
    relationship_assertion_id: source.relationship_assertion_id ?? row.relationship_assertion_id ?? row.relationship_id,
    tenant_id: source.tenant_id ?? row.tenant_id,
    environment: source.environment ?? row.environment,
    review_status: source.review_status ?? row.review_status,
    lifecycle_status: row.lifecycle_status ?? source.review_status ?? row.review_status,
    release_id: releaseContext.release_id ?? row.release_id ?? null,
    license_status: dataLicense.license_status ?? row.license_status,
    license_classification: dataLicense.license_classification ?? row.license_classification,
    license_policy_id: dataLicense.license_policy_id ?? row.license_policy_id ?? "not_required",
    permitted_uses: dataLicense.permitted_uses ?? row.permitted_uses ?? [],
    export_restrictions: dataLicense.export_restrictions ?? row.export_restrictions ?? [],
    evidence_refs: source.evidence_refs ?? row.evidence_refs ?? [],
    provenance_id: source.provenance_id ?? row.provenance_id ?? null,
    audit_event_ids: row.audit_event_ids ?? [source.provenance?.audit_event_id ?? row.audit_event_id].filter(Boolean),
    source_names: source.source_names ?? row.source_names ?? [],
    source_versions: source.source_versions ?? row.source_versions ?? [],
    source_version: row.source_version ?? source.source_versions?.[0] ?? null,
    source: row.source ?? source
  };
}

function canonicalAssertionFrom(row) {
  const assertion = row.assertion ?? row.source_assertion ?? (row.schema_version === "semantic-bridge.relationship-assertion.v1" ? row : null);
  if (!assertion || typeof assertion !== "object" || Array.isArray(assertion)) {
    throw new RelationshipAssertionApiError("patch requires a full RelationshipAssertion object from the read resolver", {
      code: "relationship_assertion_patch_requires_full_object",
      status: 500
    });
  }
  return structuredClone(assertion);
}

function assertPrincipal(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    throw new RelationshipAssertionApiError("principal is required", { code: "principal_required", status: 401 });
  }
  assertText(principal.tenant_id, "principal.tenant_id");
  assertText(principal.environment, "principal.environment");
  if (!Array.isArray(principal.role_keys) || principal.role_keys.length === 0) {
    throw new RelationshipAssertionApiError("principal.role_keys is required", { code: "principal_roles_required", status: 403 });
  }
}

function assertHumanWritePrincipal(principal) {
  if (isServiceAccountPrincipal(principal)) {
    throw new RelationshipAssertionApiError("service accounts cannot create or patch relationship assertions", {
      code: "service_account_write_denied",
      status: 403
    });
  }
}

function assertHumanWorkflowPrincipal(principal, transition) {
  if (isServiceAccountPrincipal(principal)) {
    throw new RelationshipAssertionApiError(`service accounts cannot ${transition} relationship assertions`, {
      code: "service_account_workflow_denied",
      status: 403,
      details: { transition }
    });
  }
}

function isServiceAccountPrincipal(principal) {
  return principal.principal_type === "service_account" || principal.role_keys.includes("service_account");
}

function assertCreateRole(principal) {
  if (!principal.role_keys.some((role) => CREATE_ROLES.has(role))) {
    throw new RelationshipAssertionApiError("relationship assertion write requires relationship curator/editor role", {
      code: "relationship_assertion_write_role_required",
      status: 403
    });
  }
}

function assertWorkflowTransition(transition) {
  if (!WORKFLOW_TRANSITIONS.has(transition)) {
    throw new RelationshipAssertionApiError("unsupported relationship assertion workflow transition", {
      code: "relationship_assertion_transition_unsupported",
      status: 400,
      details: { transition }
    });
  }
}

function assertWorkingReadRole(principal) {
  if (!principal.role_keys.some((role) => READ_WORKING_ROLES.has(role))) {
    throw new RelationshipAssertionApiError("working relationship rows require explicit internal read authorization", {
      code: "relationship_working_scope_denied",
      status: 403
    });
  }
}

function assertPrincipalScope(principal, assertion) {
  if (assertion.tenant_id !== principal.tenant_id) {
    throw new RelationshipAssertionApiError("relationship assertion tenant does not match principal", {
      code: "relationship_assertion_tenant_mismatch",
      status: 403
    });
  }
  if (assertion.environment !== principal.environment) {
    throw new RelationshipAssertionApiError("relationship assertion environment does not match principal", {
      code: "relationship_assertion_environment_mismatch",
      status: 403
    });
  }
}

function assertPatchAllowed(patch) {
  for (const field of Object.keys(patch)) {
    if (PATCH_BLOCKED_FIELDS.has(field)) {
      throw new RelationshipAssertionApiError(`PATCH cannot change ${field}; use the governed workflow transition for review/release state`, {
        code: "relationship_assertion_patch_field_blocked",
        status: 400,
        details: { field }
      });
    }
  }
}

function assertEvidencePatchOnly(patch) {
  const mixedField = Object.keys(patch).find((field) => !EVIDENCE_LINEAGE_PATCH_FIELDS.has(field));
  if (mixedField) {
    throw new RelationshipAssertionApiError("PATCH evidence/source lineage changes must be submitted separately from other mutable fields", {
      code: "relationship_assertion_patch_evidence_mixed_fields",
      status: 400,
      details: { field: mixedField }
    });
  }
}

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RelationshipAssertionApiError(`${name} must be an object`, { code: `${name}_invalid`, status: 400 });
  }
}

function assertText(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new RelationshipAssertionApiError(`${fieldName} is required`, { code: "required_field_missing", status: 400, details: { field: fieldName } });
  }
}

function validationError(errors) {
  return new RelationshipAssertionApiError("relationship assertion validation failed", {
    code: "relationship_assertion_contract_invalid",
    status: 400,
    details: { errors: sanitizeErrors(errors) }
  });
}

function storeError(error) {
  const message = String(error?.message ?? error ?? "relationship assertion persistence failed");
  if (error?.name === "RelationshipAssertionConflictError" || error?.status === 409 || message.includes("already exists") || message.includes("conflict")) {
    return new RelationshipAssertionApiError("relationship assertion conflict", {
      code: "relationship_assertion_conflict",
      status: 409,
      details: { errors: sanitizeErrors(error?.details?.errors ?? [message]) }
    });
  }
  if (message.includes("contract validation") || message.includes("SHACL validation") || message.includes("validation")) {
    return new RelationshipAssertionApiError("relationship assertion validation failed", {
      code: "relationship_assertion_validation_failed",
      status: 400,
      details: { errors: sanitizeErrors([message]) }
    });
  }
  if (message.includes("role") || message.includes("tenant") || message.includes("graph")) {
    return new RelationshipAssertionApiError("relationship assertion write denied", {
      code: "relationship_assertion_write_denied",
      status: 403,
      details: { errors: sanitizeErrors([message]) }
    });
  }
  return new RelationshipAssertionApiError("relationship assertion persistence failed", {
    code: "relationship_assertion_persistence_failed",
    status: 500,
    details: { errors: sanitizeErrors([message]) }
  });
}

function transitionStoreError(error) {
  if (error?.name === "RelationshipAssertionTransitionError") {
    const message = String(error.message ?? "relationship assertion transition denied");
    const status = message.includes("contract validation") || message.includes("SHACL validation") || message.includes("validation") ? 400 : 403;
    return new RelationshipAssertionApiError("relationship assertion workflow transition denied", {
      code: "relationship_assertion_transition_denied",
      status,
      details: { errors: sanitizeErrors(error.details?.errors ?? [message]) }
    });
  }
  return storeError(error);
}

function sanitizeErrors(errors = []) {
  return errors.map((error) => String(error).replace(/\s+at\s+.*$/gs, "").slice(0, 500));
}

function isReleasedRow(row) {
  const releaseId = row.release_id ?? row.release_context?.release_id ?? null;
  const status = row.review_status ?? row.lifecycle_status ?? null;
  return Boolean(releaseId) && ["released", "active", "published"].includes(String(status));
}

function releaseContextFor(principal, request) {
  const releaseId = request.release_id ?? request.releaseId ?? request.release_context?.release_id ?? principal.release_id ?? null;
  return {
    release_id: releaseId,
    scope: releaseId ? "release" : "working"
  };
}

function writeRoleFor(principal) {
  return principal.role_keys.find((role) => CREATE_ROLES.has(role)) ?? principal.role_keys[0];
}

function hasEvidenceLineageChange(currentAssertion, patch) {
  return [...EVIDENCE_LINEAGE_PATCH_FIELDS].some((field) =>
    Object.prototype.hasOwnProperty.call(patch, field) &&
    !sameJsonValue(currentAssertion[field], patch[field])
  );
}

function sameJsonValue(left, right) {
  return JSON.stringify(sortJson(left ?? null)) === JSON.stringify(sortJson(right ?? null));
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function workflowRoleFor(principal, transition, assertion) {
  if (transition === "submit") {
    return principal.role_keys.find((role) => CREATE_ROLES.has(role)) ?? principal.role_keys[0];
  }
  if (transition === "approve") {
    if (isSafetyOrCausalSensitive(assertion)) {
      return principal.role_keys.find((role) => CAUSAL_SAFETY_APPROVER_ROLES.has(role)) ??
        principal.role_keys.find((role) => REVIEWER_ROLES.has(role)) ??
        principal.role_keys[0];
    }
    return principal.role_keys.find((role) => REVIEWER_ROLES.has(role)) ??
      principal.role_keys.find((role) => CAUSAL_SAFETY_APPROVER_ROLES.has(role)) ??
      principal.role_keys[0];
  }
  if (transition === "reject") {
    return principal.role_keys.find((role) => REVIEWER_ROLES.has(role)) ??
      principal.role_keys.find((role) => CAUSAL_SAFETY_APPROVER_ROLES.has(role)) ??
      principal.role_keys[0];
  }
  if (transition === "deprecate") {
    return principal.role_keys.find((role) => STEWARD_ROLES.has(role)) ?? principal.role_keys[0];
  }
  return principal.role_keys[0];
}

function actorFor(principal) {
  return principal.user_id ?? principal.actor ?? principal.service_account_id ?? "unknown";
}

function stepUpAuthenticatedFor(principal) {
  return principal.step_up_authenticated === true ||
    principal.stepUpAuthenticated === true ||
    principal.auth_context?.step_up_authenticated === true ||
    principal.authContext?.stepUpAuthenticated === true;
}

function graphNameFrom(row, assertion) {
  return row.graph_name ?? row.graphName ?? assertion.graph_name ?? assertion.graphName ?? undefined;
}

function isSafetyOrCausalSensitive(assertion) {
  return assertion.relationship_class === "safety" ||
    assertion.secondary_relationship_tags?.includes("causal_sensitive");
}

function arrayOfRows(value, resolverName) {
  if (!Array.isArray(value)) {
    throw new RelationshipAssertionApiError(`${resolverName} must return an array`, { status: 500 });
  }
  return value;
}

function deepMerge(base, overrides) {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === "object" && !Array.isArray(value) && merged[key] && typeof merged[key] === "object" && !Array.isArray(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function dropUndefined(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    } else {
      dropUndefined(value[key]);
    }
  }
  return value;
}

function defaultIdFactory() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
