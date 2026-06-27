import assert from "node:assert/strict";
import test from "node:test";

import {
  compactIri,
  expandCurie,
  parseCurie,
  validateCurie,
  validateNamespaceRegistry
} from "../../packages/pharma-identifiers/src/index.js";

test("CURIE parser accepts registered PharmaOps and source prefixes", () => {
  assert.deepEqual(parseCurie("pharmmap:map-2026-000001").prefix, "pharmmap");
  assert.equal(expandCurie("pmid:12345678"), "https://pubmed.ncbi.nlm.nih.gov/12345678");
  assert.equal(compactIri("https://pharmaops.example/id/evidence/evidence-2026-000001"), "pharmev:evidence-2026-000001");
});

test("CURIE parser rejects malformed or unknown identifiers before release validation", () => {
  for (const value of ["unknown:123", "no-prefix", "chembl:", "chembl: CHEMBL25"]) {
    assert.equal(validateCurie(value), false, `${value} should not validate`);
  }
});

test("namespace registry remains deterministic for Phase 1 fixtures", () => {
  assert.deepEqual(validateNamespaceRegistry(), { valid: true, errors: [] });
});
