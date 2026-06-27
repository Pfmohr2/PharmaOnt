import assert from "node:assert/strict";
import test from "node:test";

import {
  compactIri,
  expandCurie,
  getNamespace,
  listPrefixes,
  parseCurie,
  validateCurie,
  validateNamespaceRegistry
} from "../src/index.js";

test("registry contains Phase 1 required prefixes", () => {
  const prefixes = listPrefixes();
  for (const prefix of ["chembl", "uniprot", "mesh", "mondo", "rxnorm", "nct", "pmid", "doi", "pharm", "pharmmap"]) {
    assert.ok(prefixes.includes(prefix), `missing ${prefix}`);
  }
});

test("validates the bundled namespace registry", () => {
  assert.deepEqual(validateNamespaceRegistry(), { valid: true, errors: [] });
});

test("parses and expands known CURIEs", () => {
  assert.deepEqual(parseCurie("chembl:CHEMBL25").prefix, "chembl");
  assert.equal(expandCurie("pharm:MappingAssertion"), "https://w3id.org/pharmaops/ontology/core#MappingAssertion");
  assert.equal(expandCurie("pharmrel:term_maps_to_standard"), "https://w3id.org/pharmaops/ontology/relationship#term_maps_to_standard");
  assert.equal(expandCurie("nct:NCT00000102"), "https://clinicaltrials.gov/study/NCT00000102");
  assert.equal(expandCurie("mondo:0004975"), "http://purl.obolibrary.org/obo/MONDO_0004975");
});

test("compacts registered IRIs back to CURIEs", () => {
  assert.equal(compactIri("https://pubmed.ncbi.nlm.nih.gov/12345678"), "pmid:12345678");
  assert.equal(compactIri("https://pharmaops.example/id/mapping/map-2026-000001"), "pharmmap:map-2026-000001");
});

test("rejects unknown prefixes and malformed CURIEs", () => {
  assert.equal(validateCurie("unknown:123"), false);
  assert.equal(validateCurie("not-a-curie"), false);
  assert.throws(() => expandCurie("unknown:123"), /Unknown CURIE prefix/);
});

test("marks restricted namespaces for license-aware downstream policy", () => {
  assert.equal(getNamespace("meddra").licenseRestricted, true);
  assert.equal(getNamespace("snomed").licenseRestricted, true);
});
