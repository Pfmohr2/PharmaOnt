import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { FusekiClient } from "../../services/semantic-store/src/fuseki-client.js";
import { tenantWorkingGraph } from "../../services/semantic-store/src/named-graphs.js";

test("B11 NO-GO repro: relationship graph capability factory must not be directly importable", async () => {
  const namedGraphs = await import("../../services/semantic-store/src/named-graphs.js");
  let capabilityModule = null;
  try {
    capabilityModule = await import("../../services/semantic-store/src/relationship-graph-capability.js");
  } catch {
    capabilityModule = null;
  }

  assert.equal(
    "createRelationshipGraphWriteCapability" in namedGraphs,
    false,
    "non-store callers must not be able to import the relationship graph capability factory"
  );
  assert.equal(
    "relationshipAssertionStoreGraphWriteCapability" in namedGraphs,
    false,
    "non-store callers must not be able to import the relationship graph capability instance"
  );
  assert.equal(
    "registerRelationshipGraphWriteCapability" in namedGraphs,
    false,
    "non-store callers must not be able to import any relationship graph capability registration function"
  );
  assert.equal(
    Boolean(capabilityModule?.RELATIONSHIP_GRAPH_WRITE_CAPABILITY),
    false,
    "non-store callers must not be able to import the relationship graph capability singleton"
  );

  const store = namedGraphs.createGovernedRelationshipAssertionStore({
    fusekiClient: {
      getGraph: async () => "",
      insertTurtle: async () => {}
    },
    shaclRunner: {
      validateTurtle: () => ({ valid: true, errors: [] })
    }
  });
  assert.equal(
    store.relationshipGraphWriteCapability,
    undefined,
    "the safe store factory must not expose its registered capability as a public property"
  );
  assert.equal(
    Object.getOwnPropertyNames(store).includes("relationshipGraphWriteCapability"),
    false,
    "the safe store factory must not leak the registered capability through own properties"
  );
  assert.equal(
    store.fuseki,
    undefined,
    "the safe store factory must not expose a capability-bearing graph gateway as a public property"
  );
  assert.equal(
    Object.getOwnPropertyNames(store).includes("fuseki"),
    false,
    "the safe store factory must not leak a capability-bearing graph gateway through own properties"
  );
});

test("B11 NO-GO repro: non-store caller must not mint a capability that authorizes direct Fuseki writes", async () => {
  const graphName = tenantWorkingGraph("acme", "relationships");
  const fetchCalls = [];
  const client = new FusekiClient({
    fetchImpl: async (url, init = {}) => {
      fetchCalls.push({ url: String(url), method: init.method ?? "GET" });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "",
        json: async () => ({ boolean: false })
      };
    }
  });
  const forgedCapability = Object.freeze({ owner: "RelationshipAssertionStore" });

  await assert.rejects(
    () => client.putGraph(graphName, "<s> <p> <o> .", { capability: forgedCapability }),
    /relationship graph|reserved|governed|RelationshipAssertionStore/i
  );
  assert.equal(fetchCalls.length, 0, "forged capability must fail before any network write");
});

test("B11 NO-GO repro: non-store caller must not import the singleton capability and write directly", async () => {
  const graphName = tenantWorkingGraph("acme", "relationships");
  const fetchCalls = [];
  const client = new FusekiClient({
    fetchImpl: async (url, init = {}) => {
      fetchCalls.push({ url: String(url), method: init.method ?? "GET" });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "",
        json: async () => ({ boolean: false })
      };
    }
  });
  let capabilityModule = null;
  try {
    capabilityModule = await import("../../services/semantic-store/src/relationship-graph-capability.js");
  } catch {
    capabilityModule = null;
  }

  await assert.rejects(
    () => client.putGraph(graphName, "<s> <p> <o> .", {
      capability: capabilityModule?.RELATIONSHIP_GRAPH_WRITE_CAPABILITY
    }),
    /relationship graph|reserved|governed|RelationshipAssertionStore/i
  );
  assert.equal(fetchCalls.length, 0, "imported singleton capability must fail before any network write");
});

test("B11 NO-GO repro: non-store caller must not spoof stack-gated capability registration", async () => {
  const graphName = tenantWorkingGraph("acme", "relationships");
  const fetchCalls = [];
  const client = new FusekiClient({
    fetchImpl: async (url, init = {}) => {
      fetchCalls.push({ url: String(url), method: init.method ?? "GET" });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "",
        json: async () => ({ boolean: false })
      };
    }
  });
  const spoofRoot = mkdtempSync(join(tmpdir(), "b11-stack-gate-"));
  const spoofModulePath = join(spoofRoot, "not-real-relationship-assertion-store.js");
  const namedGraphsUrl = pathToFileURL(resolve("services/semantic-store/src/named-graphs.js")).href;
  const forgedCapability = Object.freeze({ owner: "not-relationship-store" });
  writeFileSync(spoofModulePath, `
import { registerRelationshipGraphWriteCapability } from ${JSON.stringify(namedGraphsUrl)};
export function registerForgedCapability() {
  return registerRelationshipGraphWriteCapability(Object.freeze({ owner: "not-relationship-store" }));
}
`);
  await assert.rejects(
    () => import(pathToFileURL(spoofModulePath).href),
    /registerRelationshipGraphWriteCapability|export/i,
    "there must be no exported registration function for a spoofed file name to call"
  );

  await assert.rejects(
    () => client.putGraph(graphName, "<s> <p> <o> .", {
      capability: forgedCapability
    }),
    /relationship graph|reserved|governed|RelationshipAssertionStore/i
  );
  assert.equal(fetchCalls.length, 0, "stack-spoofed capability must fail before any network write");
});
