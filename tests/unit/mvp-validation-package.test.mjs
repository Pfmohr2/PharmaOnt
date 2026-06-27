import assert from "node:assert/strict";
import test from "node:test";

import {
  MVP_VALIDATION_PACKAGE_VERSION,
  buildMvpValidationPackage
} from "../../services/validation/src/package-generator.js";

test("Phase 7 MVP validation package summarizes required pilot controls with no unresolved P0/P1", () => {
  const validationPackage = buildMvpValidationPackage();
  const report = validationPackage.report;

  assert.equal(report.schema_version, MVP_VALIDATION_PACKAGE_VERSION);
  assert.equal(report.summary.release_gate, "pilot_ready_with_p2_residuals");
  assert.equal(report.summary.unresolved_p0_p1_count, 0);
  assert.equal(report.summary.controls_failed, 0);
  assert.match(report.report_digest, /^sha256:/);
  assert.match(report.signature.signature, /^hmac-sha256:/);

  for (const title of [
    "Provenance and evidence coverage across governed objects",
    "Critical validation failures block release",
    "No AI auto-publication",
    "FAERS/openFDA non-causal enforcement",
    "Mapping source and target version pinning",
    "Strict AI candidate contract reuse"
  ]) {
    assert.ok(report.controls.some((control) => control.title === title && control.status === "pass"), `missing passing control ${title}`);
  }

  assert.ok(report.controls.some((control) => control.evidence_refs.includes("services/release-manager/src/index.js")));
  assert.ok(report.controls.some((control) => control.evidence_refs.includes("services/ai-curation/src/index.js")));
  assert.ok(report.controls.some((control) => control.evidence_refs.includes("services/validation/src/index.js")));
});
