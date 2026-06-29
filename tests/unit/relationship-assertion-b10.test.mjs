import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateRelationshipAssertionContract } from "../../packages/contracts/src/index.js";
import {
  createGovernedRelationshipAssertionStore,
  MemoryRelationshipAssertionAuditStore,
  ShaclRunner,
  tenantWorkingGraph,
  validateSemanticTurtle
} from "../../services/semantic-store/src/index.js";

const b10Fixtures = JSON.parse(readFileSync(new URL("../fixtures/phase-b-relationship-assertions-b10.json", import.meta.url), "utf8"));
const ontologyFixtureRoot = new URL("../../ontologies/fixtures/", import.meta.url);
const graphName = tenantWorkingGraph("acme", "relationships");

test("B10 valid draft RelationshipAssertion writes, validates, audits, and reads", async () => {
  const fakeFuseki = new FakeFusekiClient();
  const auditStore = new MemoryRelationshipAssertionAuditStore();
  const shaclRunner = new TrackingShaclRunner();
  const store = createGovernedRelationshipAssertionStore({
    fusekiClient: fakeFuseki,
    shaclRunner,
    auditStore
  });
  const assertion = validRelationshipAssertion({
    relationship_assertion_id: "rel-b10-draft",
    review_status: "draft",
    reviewed_by: null,
    reviewed_at: null
  });

  assert.deepEqual(validateRelationshipAssertionContract(assertion), { valid: true, errors: [] });

  const result = await store.createRelationshipAssertion({
    tenantId: "acme",
    assertion,
    graphName,
    actorRoleKey: "curator",
    actor: "curator:b10"
  });

  assert.equal(result.relationship_assertion_id, "rel-b10-draft");
  assert.equal(result.shaclValidation.valid, true);
  assert.equal(shaclRunner.calls.length, 1);
  assert.equal(fakeFuseki.insertCalls.length, 1);
  assert.equal(auditStore.list().at(-1).event_type, "relationship_assertion.created");

  const byId = await store.getRelationshipAssertionById({
    tenantId: "acme",
    relationshipAssertionId: "rel-b10-draft",
    graphName
  });
  assert.equal(byId.relationship_assertion_id, "rel-b10-draft");
  assert.equal(byId.review_status, "draft");
  assert.equal(byId.source_versions[0], "2026-06-27");
  assert.equal(byId.authorization_filtered, undefined);

  const byEntity = await store.listRelationshipAssertionsByEntityId({
    tenantId: "acme",
    entityId: "compound-b10",
    graphName
  });
  assert.deepEqual(byEntity.map((row) => row.relationship_assertion_id), ["rel-b10-draft"]);
});

test("B10 valid approved assertion builds a released read/export item through release inclusion", async () => {
  const auditStore = new MemoryRelationshipAssertionAuditStore();
  const shaclRunner = new TrackingShaclRunner();
  const store = createGovernedRelationshipAssertionStore({
    fusekiClient: new FakeFusekiClient(),
    shaclRunner,
    auditStore
  });
  const assertion = validRelationshipAssertion({
    relationship_assertion_id: "rel-b10-release",
    review_status: "approved"
  });

  const result = await store.buildRelationshipReleaseInclusion({
    tenantId: "acme",
    assertion,
    releaseId: "b10-release",
    releaseCandidateId: "rc:b10",
    validationReportIds: ["validation:b10"],
    actor: { user_id: "user:release-manager" },
    actorRoleKey: "release_manager"
  });

  assert.equal(result.assertion.review_status, "released");
  assert.equal(result.shaclValidation.valid, true);
  assert.equal(shaclRunner.calls.length, 1);
  assert.equal(result.release_item.relationship_assertion_id, "rel-b10-release");
  assert.equal(result.release_item.release_id, "b10-release");
  assert.equal(result.release_item.export_authorization_status, "authorized");
  assert.deepEqual(result.release_item.source_versions, ["2026-06-27"]);
  assert.equal(auditStore.list().at(-1).event_type, "relationship_assertion.release_inclusion");
});

test("B10 RelationshipAssertion contract fixtures fail closed", () => {
  for (const entry of b10Fixtures.contractInvalidCases) {
    const assertion = fixtureAssertion(entry);
    const result = validateRelationshipAssertionContract(assertion);

    assert.equal(result.valid, false, `${entry.name} should fail contract validation`);
    assert.ok(
      result.errors.some((error) => error.includes(entry.expected)),
      `${entry.name} expected ${entry.expected}, got ${result.errors.join("; ")}`
    );
  }
});

test("B10 store rejects invalid writes before insert and audits validation failures", async () => {
  const cases = [
    {
      name: "missing evidence",
      assertion: validRelationshipAssertion({ relationship_assertion_id: "rel-b10-missing-evidence", evidence_refs: [] }),
      pattern: /evidence_refs|at least one evidence_ref/,
      expectShacl: false
    },
    {
      name: "safety assertion missing limitation metadata",
      assertion: validRelationshipAssertion({
        relationship_assertion_id: "rel-b10-safety-missing-limitations",
        relationship_class: "safety",
        predicate: "product_has_adverse_event",
        causal_claim_status: "not_causal",
        known_limitations: [],
        warnings: []
      }),
      pattern: /safetyLimitationId|knownLimitation/,
      expectShacl: true,
      bypassContract: true
    },
    {
      name: "genuine IRI evidence_support exactMatch matrix violation",
      assertion: validRelationshipAssertion({
        relationship_assertion_id: "rel-b10-matrix",
        relationship_class: "evidence_support",
        predicate: "pharmrel:exactMatch"
      }),
      pattern: /relationship_class evidence_support cannot use predicate exactMatch/,
      expectShacl: true,
      bypassContract: true
    }
  ];

  for (const entry of cases) {
    const fakeFuseki = new FakeFusekiClient();
    const auditStore = new MemoryRelationshipAssertionAuditStore();
    const shaclRunner = new TrackingShaclRunner();
    const store = createGovernedRelationshipAssertionStore({
      fusekiClient: fakeFuseki,
      shaclRunner,
      auditStore,
      validateRelationshipAssertionShape: entry.bypassContract ? () => ({ valid: true, errors: [] }) : undefined
    });

    await assert.rejects(
      () => store.createRelationshipAssertion({
        tenantId: "acme",
        assertion: entry.assertion,
        graphName,
        actorRoleKey: "curator",
        actor: "curator:b10"
      }),
      entry.pattern,
      entry.name
    );
    assert.equal(fakeFuseki.insertCalls.length, 0, `${entry.name} must not insert invalid Turtle`);
    assert.equal(shaclRunner.calls.length, entry.expectShacl ? 1 : 0, `${entry.name} SHACL call count`);
    assert.equal(auditStore.list().at(-1)?.event_type, "relationship_assertion.validation_failed");
  }
});

test("B10 release inclusion rejects missing release/export eligibility without staging", async () => {
  const cases = [
    ...b10Fixtures.releaseInvalidCases.map((entry) => ({
      name: entry.name,
      assertion: fixtureAssertion(entry),
      expected: entry.expected,
      validationReportIds: entry.validationReportIds
    })),
    {
      name: "released assertion missing reviewer",
      assertion: validRelationshipAssertion({ reviewed_by: null }),
      expected: "reviewed_by"
    },
    {
      name: "released assertion missing source version",
      assertion: validRelationshipAssertion({ source_versions: [] }),
      expected: "source-version lineage"
    }
  ];

  for (const entry of cases) {
    const fakeFuseki = new FakeFusekiClient();
    const auditStore = new MemoryRelationshipAssertionAuditStore();
    const store = createGovernedRelationshipAssertionStore({
      fusekiClient: fakeFuseki,
      shaclRunner: new TrackingShaclRunner(),
      auditStore
    });

    await assert.rejects(
      () => store.buildRelationshipReleaseInclusion({
        tenantId: "acme",
        assertion: entry.assertion,
        releaseId: "b10-release",
        releaseCandidateId: "rc:b10",
        validationReportIds: entry.validationReportIds ?? ["validation:b10"],
        actor: { user_id: "user:release-manager" },
        actorRoleKey: "release_manager"
      }),
      new RegExp(entry.expected),
      entry.name
    );
    assert.equal(fakeFuseki.insertCalls.length, 0);
    assert.equal(fakeFuseki.putGraphCalls.length, 0);
    assert.equal(auditStore.list().at(-1)?.event_type, "relationship_assertion.release_inclusion_denied");
  }
});

test("B10 non-IRI relationshipPredicate fixtures fail before matrix evaluation can be evaded", () => {
  for (const entry of b10Fixtures.semanticTurtleInvalidCases) {
    const result = validateSemanticTurtle(readOntologyFixture(entry.fixtureName), entry.fixtureName);

    assert.equal(result.valid, false, `${entry.fixtureName} should fail SHACL validation`);
    assert.ok(
      result.errors.some((error) => error.includes(entry.expected)),
      `expected ${entry.expected} in ${entry.fixtureName}, got ${result.errors.join("; ")}`
    );
  }
});

function fixtureAssertion(entry) {
  const assertion = deepMerge(validRelationshipAssertion({
    relationship_assertion_id: `rel-b10-${slug(entry.name)}`
  }), entry.overrides ?? {});
  for (const path of entry.removes ?? []) {
    removePath(assertion, path);
  }
  return assertion;
}

function validRelationshipAssertion(overrides = {}) {
  return deepMerge({
    schema_version: "semantic-bridge.relationship-assertion.v1",
    relationship_assertion_id: "rel-b10-valid",
    tenant_id: "acme",
    environment: "test",
    source_entity_id: "compound-b10",
    target_entity_id: "target-b10",
    predicate: "compound_has_target",
    relationship_class: "mechanistic",
    assertion_type: "human_curated",
    directionality: "directed",
    polarity: "positive",
    causal_claim_status: "not_causal",
    evidence_refs: [
      {
        evidence_id: "bridge-evidence-b10",
        evidence_role: "supports",
        source_name: "Semantic Bridge B10 fixture",
        source_version: "2026-06-27",
        source_record_id: "bridge-record-b10",
        source_span_ids: ["span:bridge-evidence-b10"],
        evidence_type: "source_record",
        required_for_release: true
      }
    ],
    source_record_ids: ["bridge-record-b10"],
    source_names: ["Semantic Bridge B10 fixture"],
    source_versions: ["2026-06-27"],
    confidence: {
      confidence_score: 0.86,
      confidence_band: "high",
      confidence_source: "reviewer_decision",
      calibration_id: null,
      fabricated: false,
      confidence_rationale: "B10 fixture evidence supports the relationship."
    },
    review_status: "approved",
    reviewed_by: "curator:b10",
    reviewed_at: "2026-06-27T16:15:00.000Z",
    release_context: {
      release_id: null,
      scope: "working",
      included_in_release: false,
      release_candidate_id: null
    },
    data_license: {
      license_status: "valid",
      license_classification: "open_materializable",
      license_policy_id: "license-policy:b10",
      permitted_uses: ["search", "evidence", "export", "release"],
      export_restrictions: [],
      data_sensitivity: "public"
    },
    known_limitations: ["B10 fixture only."],
    warnings: [],
    blocked_rationale: null,
    validation_report_ids: [],
    created_by: "curator:b10",
    created_at: "2026-06-27T16:14:00.000Z",
    updated_at: "2026-06-27T16:15:00.000Z",
    provenance_id: "pharmprov:b10",
    provenance: {
      actor: "curator:b10",
      activity: "relationship_assertion_created",
      method: "manual_curation",
      source: {
        source_name: "Semantic Bridge B10 fixture",
        source_version: "2026-06-27"
      },
      time: "2026-06-27T16:15:00.000Z",
      audit_event_id: "audit:b10"
    }
  }, overrides);
}

function readOntologyFixture(name) {
  return readFileSync(new URL(name, ontologyFixtureRoot), "utf8");
}

function deepMerge(base, overrides) {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function removePath(value, path) {
  const segments = path.split(".");
  const key = segments.pop();
  const parent = segments.reduce((cursor, segment) => cursor?.[segment], value);
  if (parent && key) {
    delete parent[key];
  }
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

class FakeFusekiClient {
  constructor(graphs = new Map()) {
    this.graphs = graphs;
    this.insertCalls = [];
    this.putGraphCalls = [];
  }

  async getGraph(graphName) {
    return this.graphs.get(graphName) ?? "";
  }

  async putGraph(graphName, turtle) {
    this.putGraphCalls.push({ graphName, turtle });
    this.graphs.set(graphName, turtle);
  }

  async insertTurtle(graphName, turtle) {
    this.insertCalls.push({ graphName, turtle });
    const existing = this.graphs.get(graphName) ?? "";
    this.graphs.set(graphName, [existing.trim(), turtle.trim()].filter(Boolean).join("\n\n"));
  }
}

class TrackingShaclRunner extends ShaclRunner {
  constructor() {
    super();
    this.calls = [];
  }

  validateTurtle(turtle, options) {
    this.calls.push({ turtle, options });
    return super.validateTurtle(turtle, options);
  }
}
