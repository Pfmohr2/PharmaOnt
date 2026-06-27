import assert from "node:assert/strict";
import test from "node:test";

import {
  PhaseBRelationshipAssertionApi,
  RelationshipAssertionApiError,
  createRelationshipAssertionRouteAdapters
} from "../../services/api/src/index.js";

test("RelationshipAssertion API create enforces RBAC, tenant scope, validation, and store-only persistence", async () => {
  const store = new FakeRelationshipAssertionStore();
  const api = new PhaseBRelationshipAssertionApi({ relationshipAssertionStore: store, clock: fixedClock });

  const response = await api.createRelationshipAssertion({
    principal: curatorPrincipal(),
    assertion: validRelationshipAssertion()
  });

  assert.equal(response.schema_version, "semantic-bridge.relationship-assertion-api.v1");
  assert.equal(response.relationship_assertion_id, "ra:test:1");
  assert.equal(response.relationship_assertion.assertion_type, "relationship");
  assert.equal(response.relationship_assertion.relationship_assertion_type, "human_curated");
  assert.equal(response.authorization_filtered, true);
  assert.equal(response.audit_event_id, "audit:store:1");
  assert.equal(store.createCalls.length, 1);
  assert.equal(store.rawInsertCalls.length, 0, "API must not bypass RelationshipAssertionStore");

  await assert.rejects(
    () => api.createRelationshipAssertion({ principal: viewerPrincipal(), assertion: validRelationshipAssertion() }),
    (error) => error instanceof RelationshipAssertionApiError && error.code === "relationship_assertion_write_role_required"
  );

  await assert.rejects(
    () => api.createRelationshipAssertion({ principal: serviceAccountPrincipal(), assertion: validRelationshipAssertion() }),
    (error) => error instanceof RelationshipAssertionApiError && error.code === "service_account_write_denied"
  );

  await assert.rejects(
    () => api.createRelationshipAssertion({
      principal: curatorPrincipal(),
      assertion: validRelationshipAssertion({ tenant_id: "other-tenant" })
    }),
    (error) => error instanceof RelationshipAssertionApiError && error.code === "relationship_assertion_tenant_mismatch"
  );

  await assert.rejects(
    () => api.createRelationshipAssertion({
      principal: curatorPrincipal(),
      assertion: validRelationshipAssertion({ evidence_refs: [] })
    }),
    (error) =>
      error instanceof RelationshipAssertionApiError &&
      error.code === "relationship_assertion_contract_invalid" &&
      error.details.errors.some((message) => message.includes("/evidence_refs"))
  );
});

test("RelationshipAssertion API reads through authz filter and preserves evidence/provenance refs", async () => {
  const api = new PhaseBRelationshipAssertionApi({
    relationshipAssertionStore: new FakeRelationshipAssertionStore(),
    resolveRelationshipAssertionById: async () => ({
      assertion: releasedRelationshipAssertion(),
      artifact_hash: "sha256:test"
    }),
    clock: fixedClock
  });

  const response = await api.getRelationshipAssertion({
    principal: viewerPrincipal({ release_id: "release:test" }),
    relationshipAssertionId: "ra:test:1",
    request: { release_id: "release:test" }
  });

  assert.equal(response.authorization_filtered, true);
  assert.equal(response.relationship_assertion.relationship_assertion_id, "ra:test:1");
  assert.equal(response.relationship_assertion.provenance_id, "pharmprov:relationship/test/1");
  assert.deepEqual(response.relationship_assertion.evidence_refs.map((ref) => ref.evidence_id), ["pharmev:test:1"]);

  const crossTenantApi = new PhaseBRelationshipAssertionApi({
    relationshipAssertionStore: new FakeRelationshipAssertionStore(),
    resolveRelationshipAssertionById: async () => ({ assertion: releasedRelationshipAssertion({ tenant_id: "other-tenant" }) })
  });
  await assert.rejects(
    () => crossTenantApi.getRelationshipAssertion({
      principal: viewerPrincipal({ release_id: "release:test" }),
      relationshipAssertionId: "ra:test:1",
      request: { release_id: "release:test" }
    }),
    (error) => error instanceof RelationshipAssertionApiError && error.code === "relationship_assertion_not_visible"
  );
});

test("RelationshipAssertion API entity list defaults to released-only and requires explicit working authorization", async () => {
  const rows = [
    { assertion: releasedRelationshipAssertion({ relationship_assertion_id: "ra:released" }) },
    { assertion: validRelationshipAssertion({ relationship_assertion_id: "ra:working", review_status: "approved" }) }
  ];
  const api = new PhaseBRelationshipAssertionApi({
    relationshipAssertionStore: new FakeRelationshipAssertionStore(),
    resolveRelationshipsByEntityId: async () => rows,
    clock: fixedClock
  });

  const releasedOnly = await api.listEntityRelationships({
    principal: viewerPrincipal({ release_id: "release:test" }),
    entityId: "pharment:compound/aspirin",
    request: { release_id: "release:test" }
  });
  assert.equal(releasedOnly.authorization_filtered, true);
  assert.deepEqual(releasedOnly.relationships.map((row) => row.relationship_assertion_id), ["ra:released"]);

  await assert.rejects(
    () => api.listEntityRelationships({
      principal: viewerPrincipal(),
      entityId: "pharment:compound/aspirin",
      request: { include_working: true }
    }),
    (error) => error instanceof RelationshipAssertionApiError && error.code === "relationship_working_scope_denied"
  );

  const withWorking = await api.listEntityRelationships({
    principal: curatorPrincipal(),
    entityId: "pharment:compound/aspirin",
    request: { include_working: true }
  });
  assert.deepEqual(withWorking.relationships.map((row) => row.relationship_assertion_id), ["ra:released", "ra:working"]);
});

test("RelationshipAssertion API patch builds a full candidate and blocks workflow transition fields", async () => {
  const store = new FakeRelationshipAssertionStore();
  const api = new PhaseBRelationshipAssertionApi({
    relationshipAssertionStore: store,
    resolveRelationshipAssertionById: async () => ({ assertion: validRelationshipAssertion() }),
    clock: fixedClock
  });

  const response = await api.patchRelationshipAssertion({
    principal: curatorPrincipal(),
    relationshipAssertionId: "ra:test:1",
    patch: { known_limitations: ["curator-added limitation"] }
  });
  assert.equal(response.action, "patch");
  assert.equal(store.createCalls.length, 1);
  assert.deepEqual(store.createCalls[0].assertion.known_limitations, ["curator-added limitation"]);
  assert.equal(store.createCalls[0].assertion.updated_at, "2026-06-27T16:00:00.000Z");

  await assert.rejects(
    () => api.patchRelationshipAssertion({
      principal: curatorPrincipal(),
      relationshipAssertionId: "ra:test:1",
      patch: { review_status: "released" }
    }),
    (error) => error instanceof RelationshipAssertionApiError && error.code === "relationship_assertion_patch_field_blocked"
  );
});

test("RelationshipAssertion route adapters call service methods with expected path/body/query fields", async () => {
  const api = new PhaseBRelationshipAssertionApi({
    relationshipAssertionStore: new FakeRelationshipAssertionStore(),
    resolveRelationshipAssertionById: async () => ({ assertion: releasedRelationshipAssertion() }),
    resolveRelationshipsByEntityId: async () => [{ assertion: releasedRelationshipAssertion() }],
    clock: fixedClock
  });
  const routes = createRelationshipAssertionRouteAdapters(api);

  assert.equal(typeof routes["POST /relationship-assertions"], "function");
  assert.equal(typeof routes["POST /relationship-assertions/{id}/submit"], "function");
  assert.equal(typeof routes["POST /relationship-assertions/{id}/approve"], "function");
  assert.equal(typeof routes["POST /relationship-assertions/{id}/reject"], "function");
  assert.equal(typeof routes["POST /relationship-assertions/{id}/deprecate"], "function");
  const created = await routes["POST /relationship-assertions"]({
    principal: curatorPrincipal(),
    body: validRelationshipAssertion()
  });
  assert.equal(created.relationship_assertion_id, "ra:test:1");

  const fetched = await routes["GET /relationship-assertions/{id}"]({
    principal: viewerPrincipal({ release_id: "release:test" }),
    params: { id: "ra:test:1" },
    query: { release_id: "release:test" }
  });
  assert.equal(fetched.relationship_assertion.relationship_assertion_id, "ra:test:1");

  const listed = await routes["GET /entities/{id}/relationships"]({
    principal: viewerPrincipal({ release_id: "release:test" }),
    params: { id: "pharment:compound/aspirin" },
    query: { release_id: "release:test" }
  });
  assert.equal(listed.total, 1);
});

test("RelationshipAssertion workflow endpoints call transition engine and propagate audit IDs", async () => {
  const store = new FakeRelationshipAssertionStore();
  const fixtures = new Map([
    ["ra:submit", validRelationshipAssertion({
      relationship_assertion_id: "ra:submit",
      review_status: "draft",
      reviewed_by: null,
      reviewed_at: null
    })],
    ["ra:approve", validRelationshipAssertion({
      relationship_assertion_id: "ra:approve",
      review_status: "in_review",
      reviewed_by: null,
      reviewed_at: null
    })],
    ["ra:reject", validRelationshipAssertion({
      relationship_assertion_id: "ra:reject",
      review_status: "in_review",
      reviewed_by: null,
      reviewed_at: null
    })],
    ["ra:deprecate", validRelationshipAssertion({
      relationship_assertion_id: "ra:deprecate",
      review_status: "approved"
    })]
  ]);
  const api = new PhaseBRelationshipAssertionApi({
    relationshipAssertionStore: store,
    resolveRelationshipAssertionById: async ({ relationshipAssertionId }) => ({
      assertion: fixtures.get(relationshipAssertionId),
      graph_name: "graph:tenant:tenant-a:relationships:working"
    }),
    clock: fixedClock
  });

  const submitted = await api.submitRelationshipAssertion({
    principal: curatorPrincipal(),
    relationshipAssertionId: "ra:submit"
  });
  const approved = await api.approveRelationshipAssertion({
    principal: reviewerPrincipal({ step_up_authenticated: true }),
    relationshipAssertionId: "ra:approve",
    decision: { rationale: "Evidence and license gates are ready." }
  });
  const rejected = await api.rejectRelationshipAssertion({
    principal: reviewerPrincipal(),
    relationshipAssertionId: "ra:reject",
    decision: { rationale: "Evidence does not support the assertion." }
  });
  const deprecated = await api.deprecateRelationshipAssertion({
    principal: stewardPrincipal(),
    relationshipAssertionId: "ra:deprecate",
    decision: { rationale: "Superseded by a newer assertion." }
  });

  assert.deepEqual(store.transitionCalls.map((call) => call.transition), ["submit", "approve", "reject", "deprecate"]);
  assert.equal(submitted.relationship_assertion.review_status, "in_review");
  assert.equal(approved.relationship_assertion.review_status, "approved");
  assert.equal(rejected.relationship_assertion.review_status, "rejected");
  assert.equal(deprecated.relationship_assertion.review_status, "deprecated");
  assert.equal(approved.audit_event_id, "audit:transition:approve");
  assert.equal(store.transitionCalls[1].actorRoleKey, "domain_approver");
  assert.equal(store.transitionCalls[1].stepUpAuthenticated, true);
});

test("RelationshipAssertion approve requires real step-up and returns sanitized transition errors", async () => {
  const store = new FakeRelationshipAssertionStore();
  const api = new PhaseBRelationshipAssertionApi({
    relationshipAssertionStore: store,
    resolveRelationshipAssertionById: async () => ({
      assertion: validRelationshipAssertion({
        relationship_assertion_id: "ra:approve-step-up",
        review_status: "in_review",
        reviewed_by: null,
        reviewed_at: null
      })
    }),
    clock: fixedClock
  });

  await assert.rejects(
    () => api.approveRelationshipAssertion({
      principal: reviewerPrincipal(),
      relationshipAssertionId: "ra:approve-step-up"
    }),
    (error) =>
      error instanceof RelationshipAssertionApiError &&
      error.code === "relationship_assertion_transition_denied" &&
      error.status === 403 &&
      error.details.errors.some((message) => message.includes("step-up")) &&
      !error.details.errors.join("\n").includes("\n    at ")
  );
  assert.equal(store.transitionCalls.length, 1);
  assert.equal(store.transitionCalls[0].stepUpAuthenticated, false);
});

test("RelationshipAssertion workflow denies non-reviewer, causal/safety general reviewer, and service-account attempts", async () => {
  const store = new FakeRelationshipAssertionStore();
  const api = new PhaseBRelationshipAssertionApi({
    relationshipAssertionStore: store,
    resolveRelationshipAssertionById: async ({ relationshipAssertionId }) => ({
      assertion: relationshipAssertionId === "ra:safety"
        ? safetyRelationshipAssertion({
          relationship_assertion_id: "ra:safety",
          review_status: "in_review",
          reviewed_by: null,
          reviewed_at: null
        })
        : validRelationshipAssertion({
          relationship_assertion_id: relationshipAssertionId,
          review_status: "in_review",
          reviewed_by: null,
          reviewed_at: null
        })
    }),
    clock: fixedClock
  });

  await assert.rejects(
    () => api.rejectRelationshipAssertion({
      principal: viewerPrincipal(),
      relationshipAssertionId: "ra:reject-denied"
    }),
    (error) => error instanceof RelationshipAssertionApiError && error.code === "relationship_assertion_transition_denied"
  );

  await assert.rejects(
    () => api.approveRelationshipAssertion({
      principal: reviewerPrincipal({ step_up_authenticated: true }),
      relationshipAssertionId: "ra:safety"
    }),
    (error) =>
      error instanceof RelationshipAssertionApiError &&
      error.code === "relationship_assertion_transition_denied" &&
      error.details.errors.some((message) => message.includes("causal-safety"))
  );

  await assert.rejects(
    () => api.approveRelationshipAssertion({
      principal: serviceAccountPrincipal({ role_keys: ["domain_approver"] }),
      relationshipAssertionId: "ra:service-denied"
    }),
    (error) => error instanceof RelationshipAssertionApiError && error.code === "service_account_workflow_denied"
  );

  assert.equal(store.transitionCalls.length, 2, "service-account denial must not call the transition engine");
  assert.equal(store.transitionCalls[0].actorRoleKey, "viewer");
  assert.equal(store.transitionCalls[1].actorRoleKey, "domain_approver");
});

test("RelationshipAssertion causal/safety approver role is passed through without spoofing", async () => {
  const store = new FakeRelationshipAssertionStore();
  const api = new PhaseBRelationshipAssertionApi({
    relationshipAssertionStore: store,
    resolveRelationshipAssertionById: async () => ({
      assertion: safetyRelationshipAssertion({
        relationship_assertion_id: "ra:safety-approve",
        review_status: "in_review",
        reviewed_by: null,
        reviewed_at: null
      })
    }),
    clock: fixedClock
  });

  const response = await api.approveRelationshipAssertion({
    principal: reviewerPrincipal({
      role_keys: ["domain_approver", "causal_safety_approver"],
      step_up_authenticated: true
    }),
    relationshipAssertionId: "ra:safety-approve"
  });

  assert.equal(response.relationship_assertion.review_status, "approved");
  assert.equal(store.transitionCalls[0].actorRoleKey, "causal_safety_approver");
});

class FakeRelationshipAssertionStore {
  constructor() {
    this.createCalls = [];
    this.transitionCalls = [];
    this.rawInsertCalls = [];
  }

  async createRelationshipAssertion(args) {
    this.createCalls.push(structuredClone(args));
    return {
      graphName: `graph:tenant:${args.tenantId}:relationships:working`,
      relationship_assertion_id: args.assertion.relationship_assertion_id,
      schemaValidation: { valid: true, errors: [] },
      shaclValidation: { valid: true, errors: [] },
      auditEvent: { audit_event_id: "audit:store:1" }
    };
  }

  async transitionRelationshipAssertion(args) {
    this.transitionCalls.push(structuredClone(args));
    const { currentAssertion, transition, actor, actorRoleKey, stepUpAuthenticated } = args;
    assertFakeTransitionAllowed({ transition, actorRoleKey, stepUpAuthenticated, currentAssertion });
    const assertion = structuredClone(currentAssertion);
    assertion.updated_at = "2026-06-27T16:00:00.000Z";
    assertion.provenance = {
      ...(assertion.provenance ?? {}),
      actor,
      activity: `relationship_assertion.${transition}`,
      method: "workflow_transition_engine",
      time: "2026-06-27T16:00:00.000Z"
    };
    if (transition === "submit") {
      assertion.review_status = "in_review";
    } else if (transition === "approve") {
      assertion.review_status = "approved";
      assertion.reviewed_by = actor;
      assertion.reviewed_at = "2026-06-27T16:00:00.000Z";
    } else if (transition === "reject") {
      assertion.review_status = "rejected";
      assertion.reviewed_by = actor;
      assertion.reviewed_at = "2026-06-27T16:00:00.000Z";
    } else if (transition === "deprecate") {
      assertion.review_status = "deprecated";
    }
    return {
      graphName: args.graphName ?? `graph:tenant:${args.tenantId}:relationships:working`,
      relationship_assertion_id: assertion.relationship_assertion_id,
      transition,
      assertion,
      auditEvent: { audit_event_id: `audit:transition:${transition}` }
    };
  }
}

function curatorPrincipal(overrides = {}) {
  return {
    principal_type: "human",
    user_id: "user:curator-1",
    tenant_id: "tenant-a",
    environment: "test",
    role_keys: ["curator"],
    ...overrides
  };
}

function viewerPrincipal(overrides = {}) {
  return {
    principal_type: "human",
    user_id: "user:viewer-1",
    tenant_id: "tenant-a",
    environment: "test",
    role_keys: ["viewer"],
    ...overrides
  };
}

function reviewerPrincipal(overrides = {}) {
  return {
    principal_type: "human",
    user_id: "user:reviewer-1",
    tenant_id: "tenant-a",
    environment: "test",
    role_keys: ["domain_approver"],
    ...overrides
  };
}

function stewardPrincipal(overrides = {}) {
  return {
    principal_type: "human",
    user_id: "user:steward-1",
    tenant_id: "tenant-a",
    environment: "test",
    role_keys: ["data_steward"],
    ...overrides
  };
}

function serviceAccountPrincipal(overrides = {}) {
  return {
    principal_type: "service_account",
    service_account_id: "service:connector",
    tenant_id: "tenant-a",
    environment: "test",
    role_keys: ["service_account"],
    ...overrides
  };
}

function fixedClock() {
  return new Date("2026-06-27T16:00:00.000Z");
}

function validRelationshipAssertion(overrides = {}) {
  const base = {
    schema_version: "semantic-bridge.relationship-assertion.v1",
    relationship_assertion_id: "ra:test:1",
    tenant_id: "tenant-a",
    environment: "test",
    source_entity_id: "pharment:compound/aspirin",
    target_entity_id: "pharment:target/PTGS1",
    predicate: "compound_has_target",
    relationship_class: "mechanistic",
    assertion_type: "human_curated",
    directionality: "directed",
    polarity: "positive",
    evidence_refs: [
      {
        evidence_id: "pharmev:test:1",
        evidence_role: "supports",
        source_name: "ChEMBL",
        source_version: "34",
        source_record_id: "chembl:CHEMBL25",
        source_span_ids: ["span:1"],
        evidence_type: "source_record",
        required_for_release: true
      }
    ],
    source_record_ids: ["chembl:CHEMBL25"],
    source_names: ["ChEMBL"],
    source_versions: ["34"],
    confidence: {
      confidence_score: 0.91,
      confidence_band: "high",
      confidence_source: "reviewer_decision",
      calibration_id: null,
      fabricated: false,
      confidence_rationale: "Curated source evidence."
    },
    review_status: "approved",
    reviewed_by: "user:reviewer-1",
    reviewed_at: "2026-06-27T12:00:00.000Z",
    release_context: {
      release_id: null,
      scope: "working",
      included_in_release: false,
      release_candidate_id: null
    },
    data_license: {
      license_status: "valid",
      license_classification: "open_with_attribution",
      license_policy_id: "license-policy:chembl-34",
      permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "release"],
      export_restrictions: ["attribution_required"],
      data_sensitivity: "public"
    },
    known_limitations: [],
    warnings: [],
    blocked_rationale: null,
    validation_report_ids: [],
    created_by: "user:curator-1",
    created_at: "2026-06-27T12:00:00.000Z",
    updated_at: "2026-06-27T12:00:00.000Z",
    provenance_id: "pharmprov:relationship/test/1",
    provenance: {
      actor: "user:curator-1",
      activity: "relationship_assertion_created",
      method: "manual_curation",
      source: {
        source_name: "ChEMBL",
        source_version: "34"
      },
      time: "2026-06-27T12:00:00.000Z",
      audit_event_id: "audit:relationship:test:1"
    }
  };
  return dropUndefined(deepMerge(base, overrides));
}

function releasedRelationshipAssertion(overrides = {}) {
  return validRelationshipAssertion(deepMerge({
    review_status: "released",
    release_context: {
      release_id: "release:test",
      scope: "release",
      included_in_release: true,
      release_candidate_id: "release-candidate:test"
    },
    validation_report_ids: ["validation:relationship:test:1"]
  }, overrides));
}

function safetyRelationshipAssertion(overrides = {}) {
  return validRelationshipAssertion(deepMerge({
    relationship_class: "safety",
    predicate: "product_has_adverse_event",
    secondary_relationship_tags: ["causal_sensitive"],
    causal_claim_status: "causal_review_approved",
    warnings: ["reviewed causal safety context"],
    known_limitations: ["Causal interpretation requires safety-review context."]
  }, overrides));
}

function assertFakeTransitionAllowed({ transition, actorRoleKey, stepUpAuthenticated, currentAssertion }) {
  if (transition === "submit") {
    assertFakeRole(actorRoleKey, ["curator", "relationship_curator", "relationship_editor", "data_engineer", "platform_admin"], "submit requires relationship curator/editor role");
    return;
  }
  if (transition === "approve") {
    assertFakeRole(actorRoleKey, ["curator", "domain_approver", "compliance_reviewer", "platform_admin", "causal_safety_approver", "safety_approver"], "approve requires reviewer role");
    if (!stepUpAuthenticated) {
      throw fakeTransitionError("approve requires step-up authentication\n    at internalTransitionEngine");
    }
    if (isSafetyOrCausalSensitive(currentAssertion) && !["causal_safety_approver", "safety_approver"].includes(actorRoleKey)) {
      throw fakeTransitionError("safety or causal_sensitive relationship approval requires causal-safety approver role");
    }
    return;
  }
  if (transition === "reject") {
    assertFakeRole(actorRoleKey, ["curator", "domain_approver", "compliance_reviewer", "platform_admin", "causal_safety_approver", "safety_approver"], "reject requires reviewer role");
    return;
  }
  if (transition === "deprecate") {
    assertFakeRole(actorRoleKey, ["data_steward", "curator", "domain_approver", "compliance_reviewer", "platform_admin"], "deprecate requires reviewer or steward role");
  }
}

function assertFakeRole(actorRoleKey, allowedRoles, message) {
  if (!allowedRoles.includes(actorRoleKey)) {
    throw fakeTransitionError(`${message}; received ${actorRoleKey ?? "none"}`);
  }
}

function fakeTransitionError(message) {
  const error = new Error(message);
  error.name = "RelationshipAssertionTransitionError";
  error.details = { errors: [message] };
  return error;
}

function isSafetyOrCausalSensitive(assertion) {
  return assertion.relationship_class === "safety" ||
    assertion.secondary_relationship_tags?.includes("causal_sensitive");
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
