import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  JsonFileReleaseLedger,
  MappingStore,
  MemoryRelationshipAssertionAuditStore,
  PostgresReleaseLedger,
  ReleaseSnapshotService,
  SemanticGraphWriter,
  ShaclRunner,
  createGovernedRelationshipAssertionStore,
  relationshipAssertionTurtle,
  assertGraphTenant,
  assertReleaseGraph,
  assertWritableWorkingGraph,
  tenantReleaseGraph,
  tenantWorkingGraph,
  validateSemanticTurtle
} from "../../services/semantic-store/src/index.js";
import * as publicSemanticStore from "../../services/semantic-store/src/index.js";

const fixtureRoot = new URL("../../ontologies/fixtures/", import.meta.url);

test("named graph policy permits tenant working and release graphs only in the right paths", () => {
  assert.equal(tenantWorkingGraph("acme", "data:canonical"), "graph:tenant:acme:data:canonical:working");
  assert.equal(tenantReleaseGraph("acme", "2026.0.0", "canonical"), "graph:tenant:acme:release:2026.0.0:canonical");
  assert.doesNotThrow(() => assertWritableWorkingGraph("graph:tenant:acme:data:canonical:working"));
  assert.doesNotThrow(() => assertReleaseGraph("graph:tenant:acme:release:2026.0.0:canonical"));
  assert.doesNotThrow(() => assertGraphTenant("graph:tenant:acme:data:canonical:working", "acme"));
  assert.throws(() => assertGraphTenant("graph:tenant:other:data:canonical:working", "acme"), /tenant mismatch/);
  assert.throws(() => assertWritableWorkingGraph("graph:data:canonical:working"), /tenant working graphs/);
  assert.throws(() => assertReleaseGraph("graph:tenant:acme:data:canonical:working"), /release graph/);
});

test("Phase 1 SHACL runner rejects model-suggested release fixture", () => {
  const runner = new ShaclRunner();
  const invalid = readFixture("invalid-model-suggested-in-release.ttl");
  const result = runner.validateTurtle(invalid, { fixtureName: "invalid-model-suggested-in-release.ttl" });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("model_suggested cannot be approved/staged/released")));
  assert.ok(result.errors.some((error) => error.includes("model_suggested cannot be release-membered")));
});

test("Phase 1 SHACL runner accepts valid core fixture", () => {
  const result = validateSemanticTurtle(readFixture("valid-core.ttl"), "valid-core.ttl");
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("Semantic Bridge SHACL runner accepts governed relationship path fixture", () => {
  const result = validateSemanticTurtle(readFixture("valid-semantic-bridge.ttl"), "valid-semantic-bridge.ttl");
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("Semantic Bridge SHACL runner rejects incomplete relationship assertions", () => {
  const result = validateSemanticTurtle(
    readFixture("invalid-relationship-missing-bridge-fields.ttl"),
    "invalid-relationship-missing-bridge-fields.ttl"
  );

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes("requires pharm:hasRelationshipClass")),
    `expected relationship class error, got ${result.errors.join("; ")}`
  );
  assert.ok(
    result.errors.some((error) => error.includes("requires pharm:hasEvidence")),
    `expected evidence error, got ${result.errors.join("; ")}`
  );
  assert.ok(
    result.errors.some((error) => error.includes("requires pharm:reviewStatus")),
    `expected review status error, got ${result.errors.join("; ")}`
  );
  assert.ok(
    result.errors.some((error) => error.includes("requires pharm:dataLicenseClass")),
    `expected license error, got ${result.errors.join("; ")}`
  );
  assert.ok(
    result.errors.some((error) => error.includes("requires pharm:releaseId")),
    `expected release context error, got ${result.errors.join("; ")}`
  );
});

test("Semantic Bridge SHACL runner rejects high confidence paths with unreviewed model-suggested edges", () => {
  const result = validateSemanticTurtle(
    readFixture("invalid-path-high-confidence-model-suggested.ttl"),
    "invalid-path-high-confidence-model-suggested.ttl"
  );

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes("high confidence path cannot include unreviewed model_suggested edge")),
    `expected path confidence blocker, got ${result.errors.join("; ")}`
  );
});

test("Semantic Bridge SHACL runner rejects Creed P0 taxonomy counterexamples", () => {
  const cases = [
    {
      fixtureName: "invalid-sb-p0-001-class-predicate-matrix.ttl",
      expected: "relationship_class evidence_support cannot use predicate exactMatch"
    },
    {
      fixtureName: "invalid-sb-p0-002-released-path-model-edge.ttl",
      expected: "released path cannot include model_suggested edge"
    },
    {
      fixtureName: "invalid-sb-p0-003-causal-status-drift.ttl",
      expected: "pharm:hasCausalClaimStatus has unapproved value causal_claim_reviewed"
    },
    {
      fixtureName: "invalid-sb-p0-004-released-blocked-license-null-reviewer.ttl",
      expected: "released relationship cannot use release-blocking license blocked_pending_legal_review"
    },
    {
      fixtureName: "invalid-sb-p0-004-released-blocked-license-null-reviewer.ttl",
      expected: "requires non-empty pharm:reviewedBy"
    }
  ];

  for (const { fixtureName, expected } of cases) {
    const result = validateSemanticTurtle(readFixture(fixtureName), fixtureName);

    assert.equal(result.valid, false, `${fixtureName} should fail validation`);
    assert.ok(
      result.errors.some((error) => error.includes(expected)),
      `expected ${expected} in ${fixtureName}, got ${result.errors.join("; ")}`
    );
  }
});

test("Semantic Bridge SHACL runner rejects RT-005 object-list smuggling counterexamples", () => {
  const cases = [
    {
      fixtureName: "invalid-sb-rt-005-p0-001-class-list-smuggling.ttl",
      expected: "relationship_class evidence_support cannot use predicate exactMatch"
    },
    {
      fixtureName: "invalid-sb-rt-005-p0-001-class-list-smuggling.ttl",
      expected: "pharm:hasRelationshipClass is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-005-p0-002-path-edge-assertion-type-list-smuggling.ttl",
      expected: "released path cannot include model_suggested edge"
    },
    {
      fixtureName: "invalid-sb-rt-005-p0-002-path-edge-assertion-type-list-smuggling.ttl",
      expected: "pharm:assertionType is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-005-p0-003-causal-status-list-smuggling.ttl",
      expected: "pharm:hasCausalClaimStatus has unapproved value causal_claim_reviewed"
    },
    {
      fixtureName: "invalid-sb-rt-005-p0-003-causal-status-list-smuggling.ttl",
      expected: "pharm:hasCausalClaimStatus is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-005-p0-004-license-list-smuggling.ttl",
      expected: "released relationship cannot use release-blocking license blocked_pending_legal_review"
    },
    {
      fixtureName: "invalid-sb-rt-005-p0-004-license-list-smuggling.ttl",
      expected: "pharm:dataLicenseClass is single-cardinality governance metadata but has 2 values"
    }
  ];

  for (const { fixtureName, expected } of cases) {
    const result = validateSemanticTurtle(readFixture(fixtureName), fixtureName);

    assert.equal(result.valid, false, `${fixtureName} should fail validation`);
    assert.ok(
      result.errors.some((error) => error.includes(expected)),
      `expected ${expected} in ${fixtureName}, got ${result.errors.join("; ")}`
    );
  }
});

test("Semantic Bridge SHACL runner rejects RT-006 cross-line object-list smuggling counterexamples", () => {
  const cases = [
    {
      fixtureName: "invalid-sb-rt-006-p0-001-cross-line-class-list-smuggling.ttl",
      expected: "relationship_class evidence_support cannot use predicate exactMatch"
    },
    {
      fixtureName: "invalid-sb-rt-006-p0-001-cross-line-class-list-smuggling.ttl",
      expected: "pharm:hasRelationshipClass is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-006-p0-002-cross-line-path-edge-assertion-type-smuggling.ttl",
      expected: "released path cannot include model_suggested edge"
    },
    {
      fixtureName: "invalid-sb-rt-006-p0-002-cross-line-path-edge-assertion-type-smuggling.ttl",
      expected: "pharm:assertionType is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-006-p0-002-cross-line-path-edge-assertion-type-smuggling.ttl",
      expected: "pharm:hasAssertionType is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-006-p0-003-cross-line-causal-status-smuggling.ttl",
      expected: "pharm:hasCausalClaimStatus has unapproved value causal_claim_reviewed"
    },
    {
      fixtureName: "invalid-sb-rt-006-p0-003-cross-line-causal-status-smuggling.ttl",
      expected: "pharm:hasCausalClaimStatus is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-006-p0-004-cross-line-license-smuggling.ttl",
      expected: "released relationship cannot use release-blocking license blocked_pending_legal_review"
    },
    {
      fixtureName: "invalid-sb-rt-006-p0-004-cross-line-license-smuggling.ttl",
      expected: "pharm:dataLicenseClass is single-cardinality governance metadata but has 2 values"
    }
  ];

  for (const { fixtureName, expected } of cases) {
    const result = validateSemanticTurtle(readFixture(fixtureName), fixtureName);

    assert.equal(result.valid, false, `${fixtureName} should fail validation`);
    assert.ok(
      result.errors.some((error) => error.includes(expected)),
      `expected ${expected} in ${fixtureName}, got ${result.errors.join("; ")}`
    );
  }
});

test("Semantic Bridge SHACL runner rejects RT-007 split-subject graph smuggling counterexamples", () => {
  const cases = [
    {
      fixtureName: "invalid-sb-rt-007-p0-001-split-subject-class-smuggling.ttl",
      expected: "relationship_class evidence_support cannot use predicate exactMatch"
    },
    {
      fixtureName: "invalid-sb-rt-007-p0-001-split-subject-class-smuggling.ttl",
      expected: "pharm:hasRelationshipClass is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-007-p0-003-split-subject-causal-status-smuggling.ttl",
      expected: "pharm:hasCausalClaimStatus has unapproved value causal_claim_reviewed"
    },
    {
      fixtureName: "invalid-sb-rt-007-p0-003-split-subject-causal-status-smuggling.ttl",
      expected: "pharm:hasCausalClaimStatus is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-007-p0-004-split-subject-license-smuggling.ttl",
      expected: "released relationship cannot use release-blocking license blocked_pending_legal_review"
    },
    {
      fixtureName: "invalid-sb-rt-007-p0-004-split-subject-license-smuggling.ttl",
      expected: "pharm:dataLicenseClass is single-cardinality governance metadata but has 2 values"
    }
  ];

  for (const { fixtureName, expected } of cases) {
    const result = validateSemanticTurtle(readFixture(fixtureName), fixtureName);

    assert.equal(result.valid, false, `${fixtureName} should fail validation`);
    assert.ok(
      result.errors.some((error) => error.includes(expected)),
      `expected ${expected} in ${fixtureName}, got ${result.errors.join("; ")}`
    );
  }
});

test("Semantic Bridge SHACL runner rejects RT-008 prefixed-vs-IRI subject smuggling counterexamples", () => {
  const cases = [
    {
      fixtureName: "invalid-sb-rt-008-p0-001-prefixed-iri-class-smuggling.ttl",
      expected: "relationship_class evidence_support cannot use predicate exactMatch"
    },
    {
      fixtureName: "invalid-sb-rt-008-p0-001-prefixed-iri-class-smuggling.ttl",
      expected: "pharm:hasRelationshipClass is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-008-p0-002-prefixed-iri-path-edge-assertion-type-smuggling.ttl",
      expected: "released path cannot include model_suggested edge"
    },
    {
      fixtureName: "invalid-sb-rt-008-p0-002-prefixed-iri-path-edge-assertion-type-smuggling.ttl",
      expected: "pharm:assertionType is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-008-p0-002-prefixed-iri-path-edge-assertion-type-smuggling.ttl",
      expected: "pharm:hasAssertionType is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-008-p0-003-prefixed-iri-causal-status-smuggling.ttl",
      expected: "pharm:hasCausalClaimStatus has unapproved value causal_claim_reviewed"
    },
    {
      fixtureName: "invalid-sb-rt-008-p0-003-prefixed-iri-causal-status-smuggling.ttl",
      expected: "pharm:hasCausalClaimStatus is single-cardinality governance metadata but has 2 values"
    },
    {
      fixtureName: "invalid-sb-rt-008-p0-004-prefixed-iri-license-smuggling.ttl",
      expected: "released relationship cannot use release-blocking license blocked_pending_legal_review"
    },
    {
      fixtureName: "invalid-sb-rt-008-p0-004-prefixed-iri-license-smuggling.ttl",
      expected: "pharm:dataLicenseClass is single-cardinality governance metadata but has 2 values"
    }
  ];

  for (const { fixtureName, expected } of cases) {
    const result = validateSemanticTurtle(readFixture(fixtureName), fixtureName);

    assert.equal(result.valid, false, `${fixtureName} should fail validation`);
    assert.ok(
      result.errors.some((error) => error.includes(expected)),
      `expected ${expected} in ${fixtureName}, got ${result.errors.join("; ")}`
    );
  }
});

test("Semantic Bridge SHACL runner rejects RT-009 mid-file prefix redeclaration smuggling", () => {
  const fixtureName = "invalid-sb-rt-009-p0-001-prefix-redeclaration-class-smuggling.ttl";
  const cases = [
    "relationship_class evidence_support cannot use predicate exactMatch",
    "pharm:hasRelationshipClass is single-cardinality governance metadata but has 2 values"
  ];

  const result = validateSemanticTurtle(readFixture(fixtureName), fixtureName);

  assert.equal(result.valid, false, `${fixtureName} should fail validation`);
  for (const expected of cases) {
    assert.ok(
      result.errors.some((error) => error.includes(expected)),
      `expected ${expected} in ${fixtureName}, got ${result.errors.join("; ")}`
    );
  }
});

test("Semantic Bridge SHACL runner rejects RT-010 non-literal governance objects", () => {
  const cases = [
    {
      fixtureName: "invalid-sb-rt-010-p0-001-class-collection-smuggling.ttl",
      expected: "pharm:hasRelationshipClass requires literal object but found BlankNode"
    },
    {
      fixtureName: "invalid-sb-rt-010-p0-001-class-blank-node-smuggling.ttl",
      expected: "pharm:hasRelationshipClass requires literal object but found BlankNode"
    },
    {
      fixtureName: "invalid-sb-rt-010-p0-002-path-edge-assertion-type-collection-smuggling.ttl",
      expected: "pharm:assertionType requires literal object but found BlankNode"
    },
    {
      fixtureName: "invalid-sb-rt-010-p0-002-path-edge-assertion-type-collection-smuggling.ttl",
      expected: "pharm:hasAssertionType requires literal object but found BlankNode"
    },
    {
      fixtureName: "invalid-sb-rt-010-p0-003-causal-status-blank-node-smuggling.ttl",
      expected: "pharm:hasCausalClaimStatus requires literal object but found BlankNode"
    },
    {
      fixtureName: "invalid-sb-rt-010-p0-004-license-collection-smuggling.ttl",
      expected: "pharm:dataLicenseClass requires literal object but found BlankNode"
    }
  ];

  for (const { fixtureName, expected } of cases) {
    const result = validateSemanticTurtle(readFixture(fixtureName), fixtureName);

    assert.equal(result.valid, false, `${fixtureName} should fail validation`);
    assert.ok(
      result.errors.some((error) => error.includes(expected)),
      `expected ${expected} in ${fixtureName}, got ${result.errors.join("; ")}`
    );
  }
});

test("Semantic Bridge SHACL runner rejects RT-011 non-IRI governance objects", () => {
  const cases = [
    {
      fixtureName: "invalid-sb-rt-011-p0-001-relationship-predicate-literal.ttl",
      expected: "pharm:relationshipPredicate requires IRI object but found Literal"
    },
    {
      fixtureName: "invalid-sb-rt-011-p0-001-relationship-predicate-literal.ttl",
      expected: "pharm:relationshipPredicate requires IRI object for relationship predicate matrix"
    },
    {
      fixtureName: "invalid-sb-rt-011-p0-001-relationship-predicate-blank-node.ttl",
      expected: "pharm:relationshipPredicate requires IRI object but found BlankNode"
    },
    {
      fixtureName: "invalid-sb-rt-011-p0-001-relationship-predicate-collection.ttl",
      expected: "pharm:relationshipPredicate requires IRI object but found BlankNode"
    },
    {
      fixtureName: "invalid-sb-rt-011-relationship-subject-literal.ttl",
      expected: "pharm:relationshipSubject requires IRI object but found Literal"
    },
    {
      fixtureName: "invalid-sb-p0-001-class-predicate-matrix.ttl",
      expected: "relationship_class evidence_support cannot use predicate exactMatch"
    }
  ];

  for (const { fixtureName, expected } of cases) {
    const result = validateSemanticTurtle(readFixture(fixtureName), fixtureName);

    assert.equal(result.valid, false, `${fixtureName} should fail validation`);
    assert.ok(
      result.errors.some((error) => error.includes(expected)),
      `expected ${expected} in ${fixtureName}, got ${result.errors.join("; ")}`
    );
  }
});

test("release snapshot skeleton copies validated working graph and emits ADR-0002 record", async () => {
  const workingGraph = tenantWorkingGraph("acme", "data:canonical");
  const releaseGraph = tenantReleaseGraph("acme", "2026.0.0-test", "canonical");
  const fakeFuseki = new FakeFusekiClient(new Map([[workingGraph, readFixture("valid-core.ttl")]]));
  const manifestRoot = mkdtempSync(join(tmpdir(), "pharmaops-release-"));
  const service = new ReleaseSnapshotService({
    fusekiClient: fakeFuseki,
    shaclRunner: new ShaclRunner(),
    releaseLedger: new JsonFileReleaseLedger({ ledgerPath: join(manifestRoot, "release-ledger.jsonl") }),
    manifestRoot
  });

  const result = await service.createReleaseSnapshot({
    tenantId: "acme",
    releaseId: "2026.0.0-test",
    workingGraph,
    sourceVersionPins: validSourceVersionPins(),
    approvalTrace: [{ role: "release_manager", actor: "fixture", decision: "approved" }],
    validationReportRefs: [{ validation_run_id: "validation-fixture", result: "passed" }],
    auditEventRange: { first: "audit:1", last: "audit:2" }
  });

  assert.equal(result.release_graph, releaseGraph);
  assert.match(result.manifest_digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.release_metadata_record.manifest_digest, result.manifest_digest);
  assert.equal(result.release_metadata_record.tenant_id, "acme");
  assert.equal(result.release_metadata_record.environment, "test");
  assert.equal(result.release_metadata_record.created_by_service_account_id, "00000000-0000-0000-0000-000000000001");
  assert.equal(result.release_metadata_record.created_by_user_id, null);
  assert.equal(result.release_metadata_record.rollback_target_release_id, null);
  assert.ok(existsSync(result.manifest_uri));
  assert.equal(fakeFuseki.graphs.get(releaseGraph), fakeFuseki.graphs.get(workingGraph));

  const manifest = JSON.parse(readFileSync(result.manifest_uri, "utf8"));
  assert.equal(manifest.release_id, "2026.0.0-test");
  assert.equal(manifest.manifest_digest, undefined);
  assert.equal(manifest.included_graphs[0].source_graph_name, workingGraph);
  assert.equal(`sha256:${cryptoHash(readFileSync(result.manifest_uri, "utf8"))}`, result.manifest_digest);
});

test("release snapshot refuses model-suggested assertions before copying", async () => {
  const workingGraph = tenantWorkingGraph("acme", "data:canonical");
  const fakeFuseki = new FakeFusekiClient(new Map([[workingGraph, readFixture("invalid-model-suggested-in-release.ttl")]]));
  const service = new ReleaseSnapshotService({
    fusekiClient: fakeFuseki,
    shaclRunner: new ShaclRunner(),
    manifestRoot: mkdtempSync(join(tmpdir(), "pharmaops-release-"))
  });

  await assert.rejects(
    () => service.createReleaseSnapshot({
      tenantId: "acme",
      releaseId: "blocked-model",
      workingGraph,
      sourceVersionPins: validSourceVersionPins(),
      approvalTrace: [{ role: "release_manager", actor: "fixture", decision: "approved" }],
      validationReportRefs: [{ validation_run_id: "validation-fixture", result: "passed" }],
      auditEventRange: { first: "audit:1", last: "audit:2" }
    }),
    /model_suggested/
  );
});

test("release snapshot rejects tenant mismatch before copying", async () => {
  const workingGraph = tenantWorkingGraph("tenantb", "data:canonical");
  const fakeFuseki = new FakeFusekiClient(new Map([[workingGraph, readFixture("valid-core.ttl")]]));
  const service = new ReleaseSnapshotService({
    fusekiClient: fakeFuseki,
    shaclRunner: new ShaclRunner(),
    manifestRoot: mkdtempSync(join(tmpdir(), "pharmaops-release-"))
  });

  await assert.rejects(
    () => service.createReleaseSnapshot({
      tenantId: "tenanta",
      releaseId: "tenant-mismatch",
      workingGraph,
      sourceVersionPins: validSourceVersionPins(),
      approvalTrace: [{ role: "release_manager", actor: "fixture", decision: "approved" }],
      validationReportRefs: [{ validation_run_id: "validation-fixture", result: "passed" }],
      auditEventRange: { first: "audit:1", last: "audit:2" }
    }),
    /tenant mismatch/
  );
  assert.equal(fakeFuseki.graphs.has(tenantReleaseGraph("tenanta", "tenant-mismatch", "canonical")), false);
});

test("release snapshot requires source pins, approval trace, validation reports, and audit range", async () => {
  const workingGraph = tenantWorkingGraph("acme", "data:canonical");
  const fakeFuseki = new FakeFusekiClient(new Map([[workingGraph, readFixture("valid-core.ttl")]]));
  const service = new ReleaseSnapshotService({
    fusekiClient: fakeFuseki,
    shaclRunner: new ShaclRunner(),
    manifestRoot: mkdtempSync(join(tmpdir(), "pharmaops-release-"))
  });

  await assert.rejects(
    () => service.createReleaseSnapshot({ tenantId: "acme", releaseId: "missing-evidence", workingGraph }),
    /source version pin/
  );
  await assert.rejects(
    () => service.createReleaseSnapshot({
      tenantId: "acme",
      releaseId: "missing-approval",
      workingGraph,
      sourceVersionPins: validSourceVersionPins(),
      validationReportRefs: [{ validation_run_id: "validation-fixture", result: "passed" }],
      auditEventRange: { first: "audit:1", last: "audit:2" }
    }),
    /approval trace/
  );
  await assert.rejects(
    () => service.createReleaseSnapshot({
      tenantId: "acme",
      releaseId: "missing-validation",
      workingGraph,
      sourceVersionPins: validSourceVersionPins(),
      approvalTrace: [{ role: "release_manager", actor: "fixture", decision: "approved" }],
      auditEventRange: { first: "audit:1", last: "audit:2" }
    }),
    /validation report/
  );
  await assert.rejects(
    () => service.createReleaseSnapshot({
      tenantId: "acme",
      releaseId: "missing-audit-range",
      workingGraph,
      sourceVersionPins: validSourceVersionPins(),
      approvalTrace: [{ role: "release_manager", actor: "fixture", decision: "approved" }],
      validationReportRefs: [{ validation_run_id: "validation-fixture", result: "passed" }]
    }),
    /audit event range/
  );
  await assert.rejects(
    () => service.createReleaseSnapshot({
      tenantId: "acme",
      releaseId: "missing-creator",
      workingGraph,
      sourceVersionPins: validSourceVersionPins(),
      approvalTrace: [{ role: "release_manager", actor: "fixture", decision: "approved" }],
      validationReportRefs: [{ validation_run_id: "validation-fixture", result: "passed" }],
      auditEventRange: { first: "audit:1", last: "audit:2" },
      createdByServiceAccountId: null
    }),
    /exactly one creator/
  );
});

test("P1-RT-006 raw Fuseki mutation client is not reachable through public semantic-store exports", () => {
  assert.equal("FusekiClient" in publicSemanticStore, false);
});

test("P1-RT-006 direct write into release graph fails through public guarded writer", async () => {
  const writer = new SemanticGraphWriter({
    fusekiClient: new FakeFusekiClient(),
    shaclRunner: new ShaclRunner()
  });

  await assert.rejects(
    () => writer.insertValidatedWorkingTurtle({
      tenantId: "acme",
      graphName: tenantReleaseGraph("acme", "2026.0.0-direct", "canonical"),
      turtle: readFixture("valid-core.ttl")
    }),
    /working graphs/
  );
});

test("P1-RT-006 cross-tenant write fails through public guarded writer", async () => {
  const writer = new SemanticGraphWriter({
    fusekiClient: new FakeFusekiClient(),
    shaclRunner: new ShaclRunner()
  });

  await assert.rejects(
    () => writer.insertValidatedWorkingTurtle({
      tenantId: "acme",
      graphName: tenantWorkingGraph("other", "data:canonical"),
      turtle: readFixture("valid-core.ttl")
    }),
    /tenant mismatch/
  );
});

test("SemanticGraphWriter rejects reserved relationship graph writes before persistence", async () => {
  const graphName = tenantWorkingGraph("acme", "relationships");
  const fakeFuseki = new FakeFusekiClient();
  const auditStore = new MemoryRelationshipAssertionAuditStore();
  const writer = new SemanticGraphWriter({
    fusekiClient: fakeFuseki,
    shaclRunner: new ShaclRunner(),
    auditStore,
    idFactory: sequenceIdFactory("rt003-writer")
  });
  const original = relationshipAssertionTurtle({
    tenantId: "acme",
    graphName,
    assertion: validRelationshipAssertion()
  });

  await assert.rejects(
    () => writer.insertValidatedWorkingTurtle({
      tenantId: "acme",
      graphName,
      turtle: original,
      fixtureName: "rt004-reserved-insert.ttl"
    }),
    /relationship graph family is reserved/
  );
  assert.equal(fakeFuseki.insertCalls.length, 0);
  assert.equal(auditStore.list().at(-1).event_type, "semantic_graph_writer.relationship_graph_write_denied");
});

test("Central graph policy rejects relationship graph near-misses and non-governed stores", async () => {
  for (const graphName of [
    "graph:tenant:acme:Relationships:working",
    "graph:tenant:acme:relationships:shadow:working"
  ]) {
    const fakeFuseki = new FakeFusekiClient();
    const writer = new SemanticGraphWriter({
      fusekiClient: fakeFuseki,
      shaclRunner: new ShaclRunner()
    });

    await assert.rejects(
      () => writer.replaceValidatedWorkingGraph({
        tenantId: "acme",
        graphName,
        turtle: relationshipAssertionTurtle({
          tenantId: "acme",
          graphName,
          assertion: validRelationshipAssertion()
        }),
        fixtureName: "rt004-near-miss-replace.ttl"
      }),
      /relationship graph|reserved|invalid/i
    );
    assert.equal(fakeFuseki.putGraphCalls.length, 0);
  }

  const graphName = tenantWorkingGraph("acme", "relationships");
  const fakeFuseki = new FakeFusekiClient();
  const auditStore = new MemoryRelationshipAssertionAuditStore();
  const mappingStore = new MappingStore({
    fusekiClient: fakeFuseki,
    shaclRunner: new ShaclRunner(),
    auditStore,
    idFactory: sequenceIdFactory("rt004-mapping")
  });

  await assert.rejects(
    () => mappingStore.createMapping({
      tenantId: "acme",
      graphName,
      mapping: validMappingObject()
    }),
    /relationship graph family is reserved/
  );
  assert.equal(fakeFuseki.insertCalls.length, 0);
  assert.equal(auditStore.list().at(-1).event_type, "mapping_store.graph_write_denied");

  const store = createGovernedRelationshipAssertionStore({
    fusekiClient: fakeFuseki,
    shaclRunner: new ShaclRunner(),
    auditStore: new MemoryRelationshipAssertionAuditStore(),
    idFactory: sequenceIdFactory("rt004-relationship")
  });
  const result = await store.createRelationshipAssertion({
    tenantId: "acme",
    assertion: validRelationshipAssertion(),
    graphName,
    actorRoleKey: "curator"
  });
  assert.equal(result.relationship_assertion_id, "rel-b2b3-000001");
  assert.equal(fakeFuseki.insertCalls.length, 1);
});

test("P1-RT-006 model_suggested triples cannot reach release graph through public release path", async () => {
  const workingGraph = tenantWorkingGraph("acme", "data:canonical");
  const releaseGraph = tenantReleaseGraph("acme", "blocked-model-public", "canonical");
  const fakeFuseki = new FakeFusekiClient(new Map([[workingGraph, readFixture("invalid-model-suggested-in-release.ttl")]]));
  const service = new ReleaseSnapshotService({
    fusekiClient: fakeFuseki,
    shaclRunner: new ShaclRunner(),
    manifestRoot: mkdtempSync(join(tmpdir(), "pharmaops-release-"))
  });

  await assert.rejects(
    () => service.createReleaseSnapshot({
      tenantId: "acme",
      releaseId: "blocked-model-public",
      workingGraph,
      sourceVersionPins: validSourceVersionPins(),
      approvalTrace: [{ role: "release_manager", actor: "fixture", decision: "approved" }],
      validationReportRefs: [{ validation_run_id: "validation-fixture", result: "passed" }],
      auditEventRange: { first: "audit:1", last: "audit:2" }
    }),
    /model_suggested/
  );
  assert.equal(fakeFuseki.graphs.has(releaseGraph), false);
});

test("P1-RT-007 mapping write validates source and target vocabulary versions before persistence", async () => {
  const graphName = tenantWorkingGraph("acme", "mappings");
  const fakeFuseki = new FakeFusekiClient();
  const store = new MappingStore({
    fusekiClient: fakeFuseki,
    shaclRunner: new ShaclRunner()
  });
  const mapping = validMappingObject();

  const result = await store.createMapping({ tenantId: "acme", mapping, graphName });
  assert.equal(result.mapping_id, mapping.mapping_id);
  assert.equal(fakeFuseki.graphs.has(graphName), true);

  const invalid = { ...mapping };
  delete invalid.target_vocabulary_version;
  await assert.rejects(
    () => store.createMapping({ tenantId: "acme", mapping: invalid, graphName }),
    /target_vocabulary_version/
  );

  const missingSourceVersion = { ...mapping };
  delete missingSourceVersion.source_vocabulary_version;
  await assert.rejects(
    () => store.createMapping({ tenantId: "acme", mapping: missingSourceVersion, graphName }),
    /source_vocabulary_version/
  );
});

test("Phase B RelationshipAssertionStore validates, writes, audits, and reads relationship rows", async () => {
  const graphName = tenantWorkingGraph("acme", "relationships");
  const fakeFuseki = new FakeFusekiClient();
  const auditStore = new MemoryRelationshipAssertionAuditStore();
  const shaclRunner = new TrackingShaclRunner();
  const store = createGovernedRelationshipAssertionStore({
    fusekiClient: fakeFuseki,
    shaclRunner,
    auditStore,
    idFactory: sequenceIdFactory("b2b3-audit")
  });
  const assertion = validRelationshipAssertion();

  const result = await store.createRelationshipAssertion({
    tenantId: "acme",
    assertion,
    graphName,
    actorRoleKey: "curator",
    actor: "curator:semantic-bridge-fixture"
  });

  assert.equal(result.relationship_assertion_id, assertion.relationship_assertion_id);
  assert.equal(result.shaclValidation.valid, true);
  assert.equal(shaclRunner.calls.length, 1, "every write must run validateSemanticTurtle through ShaclRunner");
  assert.equal(fakeFuseki.insertCalls.length, 1);
  assert.equal(fakeFuseki.insertCalls[0].graphName, graphName);
  assert.match(fakeFuseki.insertCalls[0].turtle, /pharm:relationshipPredicate <https:\/\/w3id\.org\/pharmaops\/ontology\/relationship#compound_has_target>/);
  assert.equal(auditStore.list().at(-1).event_type, "relationship_assertion.created");

  const byId = await store.getRelationshipAssertionById({
    tenantId: "acme",
    relationshipAssertionId: assertion.relationship_assertion_id,
    graphName
  });
  assert.equal(byId.relationship_assertion_id, assertion.relationship_assertion_id);
  assert.equal(byId.assertion_type, "relationship");
  assert.equal(byId.relationship_assertion_type, "human_curated");
  assert.equal(byId.relationship_class, "mechanistic");
  assert.equal(byId.predicate, "compound_has_target");
  assert.equal(byId.tenant_id, "acme");
  assert.equal(byId.environment, "test");
  assert.equal(byId.license_status, "valid");
  assert.equal(byId.license_classification, "open_materializable");
  assert.equal(byId.license_policy_id, "license-policy:semantic-bridge-fixture");
  assert.equal(byId.permitted_uses.includes("release"), true);
  assert.equal(byId.evidence_refs[0].evidence_id, "pharmev:bridge-evidence-000001");
  assert.match(byId.artifact_hash, /^sha256:[a-f0-9]{64}$/);

  const byEntity = await store.listRelationshipAssertionsByEntityId({
    tenantId: "acme",
    entityId: "compound-bridge-fixture",
    graphName
  });
  assert.deepEqual(byEntity.map((row) => row.relationship_assertion_id), [assertion.relationship_assertion_id]);
});

test("Phase B RelationshipAssertionStore rejects SHACL-invalid writes before insert and audits denial", async () => {
  const graphName = tenantWorkingGraph("acme", "relationships");
  const fakeFuseki = new FakeFusekiClient();
  const auditStore = new MemoryRelationshipAssertionAuditStore();
  const shaclRunner = new TrackingShaclRunner();
  const store = createGovernedRelationshipAssertionStore({
    fusekiClient: fakeFuseki,
    shaclRunner,
    auditStore,
    idFactory: sequenceIdFactory("b2b3-denied"),
    validateRelationshipAssertionShape: () => ({ valid: true, errors: [] })
  });
  const assertion = {
    ...validRelationshipAssertion(),
    relationship_class: "evidence_support",
    predicate: "exactMatch"
  };

  await assert.rejects(
    () => store.createRelationshipAssertion({
      tenantId: "acme",
      assertion,
      graphName,
      actorRoleKey: "curator",
      actor: "curator:semantic-bridge-fixture"
    }),
    /relationship_class evidence_support cannot use predicate exactMatch/
  );

  assert.equal(shaclRunner.calls.length, 1, "SHACL validation must run before rejecting candidate Turtle");
  assert.equal(fakeFuseki.insertCalls.length, 0, "SHACL-invalid relationship assertions must not be inserted");
  assert.equal(fakeFuseki.graphs.has(graphName), false);
  const audit = auditStore.list();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].event_type, "relationship_assertion.validation_failed");
  assert.equal(audit[0].decision, "denied");
  assert.ok(audit[0].errors.some((error) => error.includes("relationship_class evidence_support cannot use predicate exactMatch")));
});

test("Phase B RelationshipAssertionStore rejects duplicate create IDs before appending RDF", async () => {
  const graphName = tenantWorkingGraph("acme", "relationships");
  const fakeFuseki = new FakeFusekiClient();
  const auditStore = new MemoryRelationshipAssertionAuditStore();
  const store = createGovernedRelationshipAssertionStore({
    fusekiClient: fakeFuseki,
    shaclRunner: new TrackingShaclRunner(),
    auditStore,
    idFactory: sequenceIdFactory("b11-conflict")
  });

  await store.createRelationshipAssertion({
    tenantId: "acme",
    assertion: validRelationshipAssertion(),
    graphName,
    actorRoleKey: "curator",
    actor: "curator:semantic-bridge-fixture"
  });

  await assert.rejects(
    () => store.createRelationshipAssertion({
      tenantId: "acme",
      assertion: validRelationshipAssertion({
        evidence_refs: [
          {
            evidence_id: "bridge-evidence-duplicate",
            evidence_role: "supports",
            source_name: "B11 duplicate source",
            source_version: "2026-06-28",
            source_record_id: "record-duplicate",
            source_span_ids: ["span:duplicate"],
            evidence_type: "source_record",
            required_for_release: true
          }
        ],
        source_record_ids: ["record-duplicate"],
        source_names: ["B11 duplicate source"],
        source_versions: ["2026-06-28"]
      }),
      graphName,
      actorRoleKey: "curator",
      actor: "curator:semantic-bridge-fixture"
    }),
    (error) => error.name === "RelationshipAssertionConflictError" && error.status === 409
  );

  assert.equal(fakeFuseki.insertCalls.length, 1);
  assert.equal(auditStore.list().at(-1).event_type, "relationship_assertion.create_conflict");
  const row = await store.getRelationshipAssertionById({
    tenantId: "acme",
    relationshipAssertionId: "rel-b2b3-000001",
    graphName
  });
  assert.deepEqual(row.evidence_refs.map((evidence) => evidence.evidence_id), ["pharmev:bridge-evidence-000001"]);
  assert.deepEqual(row.source_versions, ["2026-06-27"]);
});

test("Phase B RelationshipAssertionStore requires the dedicated relationships working graph", async () => {
  const store = createGovernedRelationshipAssertionStore({
    fusekiClient: new FakeFusekiClient(),
    shaclRunner: new TrackingShaclRunner(),
    auditStore: new MemoryRelationshipAssertionAuditStore()
  });

  await assert.rejects(
    () => store.createRelationshipAssertion({
      tenantId: "acme",
      assertion: validRelationshipAssertion(),
      graphName: tenantWorkingGraph("acme", "mappings"),
      actorRoleKey: "curator"
    }),
    /dedicated relationship working graph/
  );
});

test("Phase B relationship workflow engine allows submit, approve, reject, and deprecate transitions", async () => {
  const cases = [
    {
      transition: "submit",
      current: validRelationshipAssertion({ review_status: "proposed", reviewed_by: null, reviewed_at: null }),
      actorRoleKey: "curator",
      expectedStatus: "in_review"
    },
    {
      transition: "approve",
      current: validRelationshipAssertion({ review_status: "in_review", reviewed_by: null, reviewed_at: null }),
      actorRoleKey: "domain_approver",
      stepUpAuthenticated: true,
      expectedStatus: "approved",
      assertResult(assertion) {
        assert.equal(assertion.reviewed_by, "user:workflow");
        assert.equal(assertion.reviewed_at, "2026-06-27T18:10:00.000Z");
      }
    },
    {
      transition: "reject",
      current: validRelationshipAssertion({ review_status: "in_review", reviewed_by: null, reviewed_at: null }),
      actorRoleKey: "domain_approver",
      decision: { rationale: "Insufficient evidence." },
      expectedStatus: "rejected"
    },
    {
      transition: "deprecate",
      current: validRelationshipAssertion({ review_status: "approved", release_context: { release_id: null, scope: "working", included_in_release: false, release_candidate_id: null } }),
      actorRoleKey: "data_steward",
      decision: { rationale: "Superseded by newer evidence." },
      expectedStatus: "deprecated",
      assertResult(assertion, current) {
        assert.equal(assertion.provenance_id, current.provenance_id);
        assert.deepEqual(assertion.release_context, current.release_context);
      }
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
      clock: () => new Date("2026-06-27T18:10:00.000Z"),
      idFactory: sequenceIdFactory(`b5-${entry.transition}`)
    });

    const result = await store.transitionRelationshipAssertion({
      tenantId: "acme",
      currentAssertion: entry.current,
      transition: entry.transition,
      actor: "user:workflow",
      actorRoleKey: entry.actorRoleKey,
      stepUpAuthenticated: entry.stepUpAuthenticated ?? false,
      decision: entry.decision ?? {}
    });

    assert.equal(result.assertion.review_status, entry.expectedStatus);
    assert.equal(shaclRunner.calls.length, 1, `${entry.transition} must validate full candidate Turtle`);
    assert.equal(fakeFuseki.putGraphCalls.length, 1, `${entry.transition} must persist through graph replacement`);
    assert.equal(auditStore.list().at(-1).event_type, `relationship_assertion.${entry.transition}`);
    entry.assertResult?.(result.assertion, entry.current);
  }
});

test("Phase B relationship workflow engine denies invalid state transitions and audits them", async () => {
  const cases = [
    { transition: "submit", current: validRelationshipAssertion({ review_status: "approved" }), actorRoleKey: "curator", pattern: /cannot submit from approved/ },
    { transition: "approve", current: validRelationshipAssertion({ review_status: "draft", reviewed_by: null, reviewed_at: null }), actorRoleKey: "domain_approver", stepUpAuthenticated: true, pattern: /cannot approve from draft/ },
    { transition: "reject", current: validRelationshipAssertion({ review_status: "approved" }), actorRoleKey: "domain_approver", pattern: /cannot reject from approved/ },
    { transition: "deprecate", current: validRelationshipAssertion({ review_status: "draft", reviewed_by: null, reviewed_at: null }), actorRoleKey: "data_steward", pattern: /cannot deprecate from draft/ }
  ];

  for (const entry of cases) {
    const fakeFuseki = new FakeFusekiClient();
    const auditStore = new MemoryRelationshipAssertionAuditStore();
    const store = createGovernedRelationshipAssertionStore({
      fusekiClient: fakeFuseki,
      shaclRunner: new TrackingShaclRunner(),
      auditStore,
      idFactory: sequenceIdFactory(`b5-denied-${entry.transition}`)
    });

    await assert.rejects(
      () => store.transitionRelationshipAssertion({
        tenantId: "acme",
        currentAssertion: entry.current,
        transition: entry.transition,
        actor: "user:workflow",
        actorRoleKey: entry.actorRoleKey,
        stepUpAuthenticated: entry.stepUpAuthenticated ?? false
      }),
      entry.pattern
    );
    assert.equal(fakeFuseki.putGraphCalls.length, 0);
    assert.equal(auditStore.list().at(-1).event_type, "relationship_assertion.transition_denied");
  }
});

test("Phase B relationship workflow engine blocks model_suggested direct approval", async () => {
  const store = createGovernedRelationshipAssertionStore({
    fusekiClient: new FakeFusekiClient(),
    shaclRunner: new TrackingShaclRunner(),
    auditStore: new MemoryRelationshipAssertionAuditStore()
  });

  await assert.rejects(
    () => store.transitionRelationshipAssertion({
      tenantId: "acme",
      currentAssertion: validRelationshipAssertion({
        assertion_type: "model_suggested",
        review_status: "in_review",
        reviewed_by: null,
        reviewed_at: null
      }),
      transition: "approve",
      actor: "user:reviewer",
      actorRoleKey: "domain_approver",
      stepUpAuthenticated: true
    }),
    /model_suggested relationship assertions cannot be approved or released directly/
  );
});

test("Phase B relationship workflow engine requires causal-safety approval metadata and role", async () => {
  const safetyAssertion = validRelationshipAssertion({
    relationship_class: "safety",
    predicate: "product_has_adverse_event",
    review_status: "in_review",
    reviewed_by: null,
    reviewed_at: null,
    causal_claim_status: undefined,
    known_limitations: [],
    warnings: []
  });

  await assert.rejects(
    () => relationshipWorkflowStore().transitionRelationshipAssertion({
      tenantId: "acme",
      currentAssertion: { ...safetyAssertion, causal_claim_status: "not_causal", known_limitations: ["FAERS is spontaneous-report context only."], warnings: ["contains_safety_non_causal_limitation"] },
      transition: "approve",
      actor: "user:reviewer",
      actorRoleKey: "domain_approver",
      stepUpAuthenticated: true
    }),
    /requires causal-safety approver role/
  );

  await assert.rejects(
    () => relationshipWorkflowStore().transitionRelationshipAssertion({
      tenantId: "acme",
      currentAssertion: safetyAssertion,
      transition: "approve",
      actor: "user:safety",
      actorRoleKey: "causal_safety_approver",
      stepUpAuthenticated: true
    }),
    /requires causal_claim_status/
  );
});

test("Phase B relationship workflow engine requires blocked rationale", async () => {
  await assert.rejects(
    () => relationshipWorkflowStore().transitionRelationshipAssertion({
      tenantId: "acme",
      currentAssertion: validRelationshipAssertion({
        relationship_class: "blocked",
        predicate: "blocked",
        review_status: "proposed",
        reviewed_by: null,
        reviewed_at: null,
        blocked_rationale: null
      }),
      transition: "submit",
      actor: "user:curator",
      actorRoleKey: "curator"
    }),
    /blocked relationship assertions require blocked_rationale/
  );
});

test("Phase B relationship workflow engine demotes approved assertions when evidence changes", async () => {
  const store = relationshipWorkflowStore();
  const result = await store.transitionRelationshipAssertion({
    tenantId: "acme",
    currentAssertion: validRelationshipAssertion({ review_status: "approved" }),
    transition: "update_evidence",
    actor: "user:curator",
    actorRoleKey: "curator",
    decision: {
      evidence_refs: [
        {
          evidence_id: "bridge-evidence-000002",
          evidence_role: "supports",
          source_name: "Semantic Bridge fixture",
          source_version: "2026-06-28",
          source_record_id: "bridge-evidence-000002",
          source_span_ids: ["span:bridge-evidence-000002"],
          evidence_type: "source_record",
          required_for_release: true
        }
      ]
    }
  });

  assert.equal(result.assertion.review_status, "in_review");
  assert.equal(result.assertion.reviewed_by, null);
  assert.equal(result.assertion.reviewed_at, null);
  assert.deepEqual(result.assertion.source_versions, ["2026-06-28"]);
  assert.equal(result.shaclValidation.valid, true);
});

test("Phase B evidence attachment preserves evidence lineage fields", async () => {
  const store = relationshipWorkflowStore();
  const result = await store.attachRelationshipEvidence({
    tenantId: "acme",
    currentAssertion: validRelationshipAssertion({ review_status: "in_review", reviewed_by: null, reviewed_at: null }),
    actor: "user:curator",
    actorRoleKey: "curator",
    evidenceRefs: [
      {
        evidence_id: "bridge-evidence-000002",
        evidence_role: "contradicts",
        source_name: "Semantic Bridge adjudication",
        source_version: "2026-06-29",
        source_record_id: "bridge-record-000002",
        source_span_ids: ["span:bridge-evidence-000002:a", "span:bridge-evidence-000002:b"],
        source_limitations: ["case report context"],
        disclaimer_ids: ["source_terms:bridge-adjudication"],
        evidence_type: "source_record",
        required_for_release: false
      }
    ]
  });

  const attached = result.assertion.evidence_refs.find((evidence) => evidence.evidence_id === "bridge-evidence-000002");
  assert.deepEqual(attached, {
    evidence_id: "bridge-evidence-000002",
    evidence_role: "contradicts",
    source_name: "Semantic Bridge adjudication",
    source_version: "2026-06-29",
    source_record_id: "bridge-record-000002",
    source_span_ids: ["span:bridge-evidence-000002:a", "span:bridge-evidence-000002:b"],
    source_limitations: ["case report context"],
    disclaimer_ids: ["source_terms:bridge-adjudication"],
    evidence_type: "source_record",
    required_for_release: false
  });
  assert.deepEqual(result.assertion.source_names, ["Semantic Bridge fixture", "Semantic Bridge adjudication"]);
  assert.deepEqual(result.assertion.source_versions, ["2026-06-27", "2026-06-29"]);
  assert.deepEqual(result.assertion.source_record_ids, ["bridge-evidence-000001", "bridge-record-000002"]);
  assert.equal(result.shaclValidation.valid, true);
});

test("Phase B evidence replacement rejects empty or incomplete evidence shells", async () => {
  const store = relationshipWorkflowStore();

  await assert.rejects(
    () => store.replaceRelationshipEvidence({
      tenantId: "acme",
      currentAssertion: validRelationshipAssertion({ review_status: "in_review", reviewed_by: null, reviewed_at: null }),
      actor: "user:curator",
      actorRoleKey: "curator",
      evidenceRefs: []
    }),
    /at least one evidence_ref/
  );

  await assert.rejects(
    () => store.replaceRelationshipEvidence({
      tenantId: "acme",
      currentAssertion: validRelationshipAssertion({ review_status: "in_review", reviewed_by: null, reviewed_at: null }),
      actor: "user:curator",
      actorRoleKey: "curator",
      evidenceRefs: [{
        evidence_id: "bridge-evidence-empty-shell",
        evidence_role: "supports",
        source_name: "Semantic Bridge fixture",
        source_version: "2026-06-29",
        source_record_id: "bridge-evidence-empty-shell",
        source_span_ids: []
      }]
    }),
    /source_span_ids must include/
  );
});

test("Phase B evidence replacement demotes approved assertions through the update_evidence path", async () => {
  const store = relationshipWorkflowStore();
  const result = await store.replaceRelationshipEvidence({
    tenantId: "acme",
    currentAssertion: validRelationshipAssertion({ review_status: "approved" }),
    actor: "user:curator",
    actorRoleKey: "curator",
    evidenceRefs: [
      {
        evidence_id: "bridge-evidence-000003",
        evidence_role: "supports",
        source_name: "Semantic Bridge replacement",
        source_version: "2026-06-30",
        source_record_id: "bridge-record-000003",
        source_span_ids: ["span:bridge-evidence-000003"],
        evidence_type: "source_record",
        required_for_release: true
      }
    ]
  });

  assert.equal(result.transition, "update_evidence");
  assert.equal(result.assertion.review_status, "in_review");
  assert.equal(result.assertion.reviewed_by, null);
  assert.equal(result.assertion.reviewed_at, null);
  assert.deepEqual(result.assertion.source_versions, ["2026-06-30"]);
});

test("Phase B release inclusion admits eligible assertions and validates release-bound Turtle", async () => {
  const auditStore = new MemoryRelationshipAssertionAuditStore();
  const shaclRunner = new TrackingShaclRunner();
  const store = createGovernedRelationshipAssertionStore({
    fusekiClient: new FakeFusekiClient(),
    shaclRunner,
    auditStore,
    idFactory: sequenceIdFactory("b7-release")
  });
  const result = await store.buildRelationshipReleaseInclusion({
    tenantId: "acme",
    assertion: validRelationshipAssertion({ review_status: "approved" }),
    releaseId: "2026.0.0",
    releaseCandidateId: "rc-2026.0.0",
    validationReportIds: ["validation:relationship:release:1"],
    actor: { user_id: "user:release-manager" },
    actorRoleKey: "release_manager"
  });

  assert.equal(result.assertion.review_status, "released");
  assert.deepEqual(result.assertion.release_context, {
    release_id: "2026.0.0",
    scope: "release",
    included_in_release: true,
    release_candidate_id: "rc-2026.0.0"
  });
  assert.deepEqual(result.validation_report_ids, ["validation:relationship:release:1"]);
  assert.equal(shaclRunner.calls.length, 1);
  assert.match(shaclRunner.calls[0].turtle, /pharm:reviewStatus "released"/);
  assert.match(shaclRunner.calls[0].turtle, /pharm:releaseId "2026\.0\.0"/);
  assert.match(shaclRunner.calls[0].turtle, /pharm:validationReportId "validation:relationship:release:1"/);
  assert.equal(result.release_graph_name, tenantReleaseGraph("acme", "2026.0.0", "relationships"));
  assert.equal(result.staged_entry.staged_by_role_key, "release_manager");
  assert.equal(result.staged_entry.validation_report_id, "validation:relationship:release:1");
  assert.equal(result.release_item.relationship_assertion_id, "rel-b2b3-000001");
  assert.equal(result.release_item.assertion_type, "relationship");
  assert.equal(result.release_item.relationship_assertion_type, "human_curated");
  assert.deepEqual(result.release_item.source_versions, ["2026-06-27"]);
  assert.equal(auditStore.list().at(-1).event_type, "relationship_assertion.release_inclusion");
});

test("Phase B release inclusion rejects ineligible assertions and audits denial", async () => {
  const auditStore = new MemoryRelationshipAssertionAuditStore();
  const shaclRunner = new TrackingShaclRunner();
  const store = createGovernedRelationshipAssertionStore({
    fusekiClient: new FakeFusekiClient(),
    shaclRunner,
    auditStore
  });

  await assert.rejects(
    () => store.buildRelationshipReleaseInclusion({
      tenantId: "acme",
      assertion: validRelationshipAssertion({
        assertion_type: "model_suggested",
        review_status: "in_review",
        reviewed_by: null,
        reviewed_at: null
      }),
      releaseId: "2026.0.0",
      releaseCandidateId: "rc-2026.0.0",
      validationReportIds: ["validation:relationship:release:1"],
      actor: { user_id: "user:release-manager" },
      actorRoleKey: "release_manager"
    }),
    /model_suggested/
  );
  assert.equal(shaclRunner.calls.length, 0);
  assert.equal(auditStore.list().at(-1).event_type, "relationship_assertion.release_inclusion_denied");
});

test("P1-RT-008 release snapshot persists ledger row and fails closed on digest mismatch", async () => {
  const workingGraph = tenantWorkingGraph("acme", "data:canonical");
  const releaseGraph = tenantReleaseGraph("acme", "digest-mismatch", "canonical");
  const fakeFuseki = new FakeFusekiClient(new Map([[workingGraph, readFixture("valid-core.ttl")]]));
  const manifestRoot = mkdtempSync(join(tmpdir(), "pharmaops-release-"));
  const records = [];
  const releaseLedger = {
    async insertReleaseMetadata(record) {
      records.push(record);
      return { ...record, manifest_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
    }
  };
  const service = new ReleaseSnapshotService({
    fusekiClient: fakeFuseki,
    shaclRunner: new ShaclRunner(),
    releaseLedger,
    manifestRoot
  });

  await assert.rejects(
    () => service.createReleaseSnapshot({
      tenantId: "acme",
      releaseId: "digest-mismatch",
      workingGraph,
      sourceVersionPins: validSourceVersionPins(),
      approvalTrace: [{ role: "release_manager", actor: "fixture", decision: "approved" }],
      validationReportRefs: [{ validation_run_id: "validation-fixture", result: "passed" }],
      auditEventRange: { first: "audit:1", last: "audit:2" }
    }),
    /ledger digest mismatch/
  );
  assert.equal(records.length, 1);
  assert.equal(fakeFuseki.graphs.has(releaseGraph), false);
});

test("P1-RT-009 ledger digest mismatch leaves zero release graph triples", async () => {
  const workingGraph = tenantWorkingGraph("acme", "data:canonical");
  const releaseGraph = tenantReleaseGraph("acme", "atomic-digest-mismatch", "canonical");
  const fakeFuseki = new FakeFusekiClient(new Map([[workingGraph, readFixture("valid-core.ttl")]]));
  const service = new ReleaseSnapshotService({
    fusekiClient: fakeFuseki,
    shaclRunner: new ShaclRunner(),
    releaseLedger: {
      async insertReleaseMetadata(record) {
        return { ...record, manifest_digest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" };
      }
    },
    manifestRoot: mkdtempSync(join(tmpdir(), "pharmaops-release-"))
  });

  await assert.rejects(
    () => service.createReleaseSnapshot({
      tenantId: "acme",
      releaseId: "atomic-digest-mismatch",
      workingGraph,
      sourceVersionPins: validSourceVersionPins(),
      approvalTrace: [{ role: "release_manager", actor: "fixture", decision: "approved" }],
      validationReportRefs: [{ validation_run_id: "validation-fixture", result: "passed" }],
      auditEventRange: { first: "audit:1", last: "audit:2" }
    }),
    /ledger digest mismatch/
  );
  assert.equal(await fakeFuseki.graphHasTriples(releaseGraph), false);
  assert.deepEqual(releaseGraphsWithTriples(fakeFuseki), []);
});

test("release snapshot blocks unreconciled per-assertion source versions before release graph exposure", async () => {
  const workingGraph = tenantWorkingGraph("acme", "data:canonical");
  const releaseGraph = tenantReleaseGraph("acme", "unreconciled-source", "canonical");
  const fakeFuseki = new FakeFusekiClient(new Map([[workingGraph, readFixture("valid-core.ttl")]]));
  const service = new ReleaseSnapshotService({
    fusekiClient: fakeFuseki,
    shaclRunner: new ShaclRunner(),
    manifestRoot: mkdtempSync(join(tmpdir(), "pharmaops-release-"))
  });

  await assert.rejects(
    () => service.createReleaseSnapshot({
      tenantId: "acme",
      releaseId: "unreconciled-source",
      workingGraph,
      sourceVersionPins: [{ source_name: "Fixture source", source_version: "2026-06-27" }],
      approvalTrace: [{ role: "release_manager", actor: "fixture", decision: "approved" }],
      validationReportRefs: [{ validation_run_id: "validation-fixture", result: "passed" }],
      auditEventRange: { first: "audit:1", last: "audit:2" }
    }),
    /source-version reconciliation failed/
  );
  assert.equal(await fakeFuseki.graphHasTriples(releaseGraph), false);
});

test("PostgresReleaseLedger inserts canonical release_metadata using supplied transaction client", async () => {
  const record = validReleaseMetadataRecord();
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      return { rows: [{ ...record, release_metadata_id: "00000000-0000-0000-0000-000000000999" }] };
    }
  };
  const ledger = new PostgresReleaseLedger({
    client,
    releaseWorkflowServiceAccountId: record.created_by_service_account_id
  });

  const persisted = await ledger.insertReleaseMetadata(record);

  assert.equal(persisted.release_metadata_id, "00000000-0000-0000-0000-000000000999");
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /INSERT INTO pharmaops\.release_metadata/);
  assert.match(queries[0].text, /RETURNING tenant_id, environment, release_id/);
  assert.equal(queries[0].values[0], record.tenant_id);
  assert.equal(queries[0].values[7], record.manifest_uri);
  assert.equal(queries[0].values[8], record.manifest_digest);
  assert.equal(queries[0].values[11], JSON.stringify(record.source_version_pins));
  assert.equal(queries[0].values[17], JSON.stringify(record.audit_event_range));

  await assert.rejects(
    () => ledger.insertReleaseMetadata({
      ...record,
      created_by_user_id: "00000000-0000-0000-0000-000000000111",
      created_by_service_account_id: null
    }),
    /service account path/
  );
});

class FakeFusekiClient {
  constructor(graphs = new Map()) {
    this.graphs = graphs;
    this.insertCalls = [];
    this.putGraphCalls = [];
  }

  async graphHasTriples(graphName) {
    return Boolean(this.graphs.get(graphName)?.trim());
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

  async copyGraph(sourceGraph, targetGraph) {
    this.graphs.set(targetGraph, this.graphs.get(sourceGraph) ?? "");
  }

  async query(sparql) {
    const graphName = sparql.match(/GRAPH <([^>]+)>/)?.[1];
    const turtle = this.graphs.get(graphName) ?? "";
    return {
      boolean: /pharm:assertionType\s+"model_suggested"/.test(turtle) ||
        /pharm:methodType\s+"model"/.test(turtle)
    };
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

function readFixture(name) {
  return readFileSync(new URL(name, fixtureRoot), "utf8");
}

function cryptoHash(value) {
  // Local helper avoids making the service hash implementation part of the test oracle.
  return createHash("sha256").update(value).digest("hex");
}

function releaseGraphsWithTriples(fakeFuseki) {
  return [...fakeFuseki.graphs.entries()]
    .filter(([graphName, turtle]) => /^graph:tenant:[^:]+:release:/.test(graphName) && turtle.trim())
    .map(([graphName]) => graphName);
}

function validSourceVersionPins() {
  return [
    { source_name: "Fixture source", source_version: "2026-06-27" },
    { source_name: "PubMed fixture", source_version: "2026-06-27" },
    { source_name: "ChEMBL fixture", source_version: "34" },
    { source_name: "UniProt fixture", source_version: "2026_02" },
    { source_name: "manual fixture curation", source_version: "2026-06-27" }
  ];
}

function validReleaseMetadataRecord() {
  return {
    release_id: "2026.0.0-postgres",
    tenant_id: "00000000-0000-0000-0000-000000000123",
    environment: "test",
    semantic_version: "2026.0.0-postgres",
    status: "candidate",
    release_candidate_id: "rc-2026.0.0-postgres",
    previous_release_id: null,
    manifest_uri: "s3://pharmaops-test/releases/2026.0.0-postgres/manifest.json",
    manifest_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ontology_digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    shape_digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    source_version_pins: validSourceVersionPins(),
    included_graphs: [
      {
        graph_name: tenantReleaseGraph("acme", "2026.0.0-postgres", "canonical"),
        source_graph_name: tenantWorkingGraph("acme", "data:canonical"),
        graph_role: "canonical",
        digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      }
    ],
    validation_report_refs: [{ validation_run_id: "validation-fixture", result: "passed" }],
    changelog_uri: "s3://pharmaops-test/releases/2026.0.0-postgres/changelog.md",
    artifact_hashes: {
      [tenantReleaseGraph("acme", "2026.0.0-postgres", "canonical")]:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    },
    approval_trace: [{ role: "release_manager", actor: "fixture", decision: "approved" }],
    audit_event_range: { first: "audit:1", last: "audit:2" },
    rollback_target_release_id: null,
    created_by_user_id: null,
    created_by_service_account_id: "00000000-0000-0000-0000-000000000001"
  };
}

function validMappingObject() {
  return {
    mapping_id: "pharmmap:map-2026-000001",
    source_entity_id: "chembl:CHEMBL25",
    target_entity_id: "pubchem:CID2244",
    predicate: "exactMatch",
    source_vocabulary: "ChEMBL",
    source_vocabulary_version: "34",
    target_vocabulary: "PubChem",
    target_vocabulary_version: "2026-06-01",
    source_license_classification: "open_with_attribution",
    source_license_policy_id: "license-policy:chembl-34",
    target_license_classification: "open_with_attribution",
    target_license_policy_id: "license-policy:pubchem-2026-06-01",
    data_sensitivity: "public",
    materialization_policy: "materialize",
    permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
    export_restrictions: ["attribution_required"],
    disclaimer_ids: ["source_terms:chembl"],
    legal_approval_id: null,
    retention_class: "public_source_snapshot",
    license_status: "valid",
    confidence_score: 0.99,
    confidence_band: "high",
    evidence_ids: ["pharmev:evidence-2026-000001"],
    evidence_refs: [
      {
        evidence_id: "pharmev:evidence-2026-000001",
        evidence_role: "supports",
        required_for_release: true
      }
    ],
    provenance_id: "pharmprov:mapping/000001",
    created_by: "service:normalization",
    reviewed_by: "user:curator-1",
    review_status: "approved",
    release_id: null,
    provenance: {
      actor: "service:normalization",
      timestamp: "2026-06-27T01:20:00.000Z",
      source: "ChEMBL",
      source_version: "34",
      audit_event_id: "audit:evt-1"
    }
  };
}

function validRelationshipAssertion(overrides = {}) {
  return {
    schema_version: "semantic-bridge.relationship-assertion.v1",
    relationship_assertion_id: "rel-b2b3-000001",
    tenant_id: "acme",
    environment: "test",
    source_entity_id: "compound-bridge-fixture",
    target_entity_id: "target-bridge-fixture",
    predicate: "compound_has_target",
    relationship_class: "mechanistic",
    assertion_type: "human_curated",
    directionality: "directed",
    polarity: "positive",
    causal_claim_status: "not_causal",
    evidence_refs: [
      {
        evidence_id: "bridge-evidence-000001",
        evidence_role: "supports",
        source_name: "Semantic Bridge fixture",
        source_version: "2026-06-27",
        source_record_id: "bridge-evidence-000001",
        source_span_ids: ["span:bridge-evidence-000001"],
        evidence_type: "source_record",
        required_for_release: true
      }
    ],
    source_record_ids: ["bridge-evidence-000001"],
    source_names: ["Semantic Bridge fixture"],
    source_versions: ["2026-06-27"],
    confidence: {
      confidence_score: 0.82,
      confidence_band: "high",
      confidence_source: "source_asserted",
      calibration_id: null,
      fabricated: false,
      confidence_rationale: "Fixture evidence supports the relationship."
    },
    review_status: "approved",
    reviewed_by: "curator:semantic-bridge-fixture",
    reviewed_at: "2026-06-27T11:23:00Z",
    release_context: {
      release_id: null,
      scope: "working",
      included_in_release: false,
      release_candidate_id: null
    },
    data_license: {
      license_status: "valid",
      license_classification: "open_materializable",
      license_policy_id: "license-policy:semantic-bridge-fixture",
      permitted_uses: ["search", "evidence", "export", "release"],
      export_restrictions: [],
      data_sensitivity: "public"
    },
    known_limitations: ["association only"],
    warnings: [],
    validation_report_ids: [],
    created_by: "curator:semantic-bridge-fixture",
    created_at: "2026-06-27T11:22:00Z",
    updated_at: "2026-06-27T11:23:00Z",
    provenance_id: "pharmprov:valid-semantic-bridge-rel",
    provenance: {
      actor: "curator:semantic-bridge-fixture",
      activity: "approve",
      method: "reviewer_decision",
      source: {
        source_name: "Semantic Bridge fixture",
        source_version: "2026-06-27"
      },
      time: "2026-06-27T11:23:00Z",
      audit_event_id: "audit:valid-semantic-bridge-rel"
    },
    ...overrides
  };
}

function sequenceIdFactory(prefix) {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function relationshipWorkflowStore() {
  return createGovernedRelationshipAssertionStore({
    fusekiClient: new FakeFusekiClient(),
    shaclRunner: new TrackingShaclRunner(),
    auditStore: new MemoryRelationshipAssertionAuditStore(),
    idFactory: sequenceIdFactory("b5-workflow")
  });
}
