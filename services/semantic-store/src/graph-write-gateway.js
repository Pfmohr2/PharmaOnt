import { GraphWritePolicyError, assertGraphWritePolicy, classifyNamedGraph } from "./named-graphs.js";

export class GraphWriteGateway {
  constructor({ fusekiClient, capability = null, actor = "semantic-store" }) {
    this.raw = fusekiClient;
    this.capability = capability;
    this.actor = actor;
  }

  async ping(...args) {
    return this.raw.ping(...args);
  }

  async query(...args) {
    return this.raw.query(...args);
  }

  async getGraph(...args) {
    return this.raw.getGraph(...args);
  }

  async graphHasTriples(...args) {
    return this.raw.graphHasTriples(...args);
  }

  async putGraph(graphName, turtle) {
    this.assertWriteAllowed({ graphName, operation: "put graph" });
    if (typeof this.raw.putGraph === "function") {
      return this.raw.putGraph(graphName, turtle, { capability: this.capability, actor: this.actor });
    }
    if (typeof this.raw.insertTurtle === "function") {
      return this.raw.insertTurtle(graphName, turtle, { capability: this.capability, actor: this.actor });
    }
    throw new Error("graph write gateway requires putGraph or insertTurtle support");
  }

  async insertTurtle(graphName, turtle) {
    this.assertWriteAllowed({ graphName, operation: "insert turtle" });
    if (typeof this.raw.insertTurtle === "function") {
      return this.raw.insertTurtle(graphName, turtle, { capability: this.capability, actor: this.actor });
    }
    const existing = typeof this.raw.getGraph === "function" ? await this.raw.getGraph(graphName) : "";
    const next = [existing.trim(), turtle.trim()].filter(Boolean).join("\n\n");
    return this.raw.putGraph(graphName, next, { capability: this.capability, actor: this.actor });
  }

  async clearGraph(graphName) {
    this.assertWriteAllowed({ graphName, operation: "clear graph" });
    if (typeof this.raw.clearGraph === "function") {
      return this.raw.clearGraph(graphName, { capability: this.capability, actor: this.actor });
    }
    if (typeof this.raw.putGraph === "function") {
      return this.raw.putGraph(graphName, "", { capability: this.capability, actor: this.actor });
    }
    throw new Error("graph write gateway requires clearGraph or putGraph support");
  }

  async copyGraph(sourceGraph, targetGraph) {
    this.assertWriteAllowed({ graphName: targetGraph, operation: "copy graph" });
    if (typeof this.raw.copyGraph === "function") {
      return this.raw.copyGraph(sourceGraph, targetGraph, { capability: this.capability, actor: this.actor });
    }
    const sourceTurtle = await this.raw.getGraph(sourceGraph);
    return this.raw.putGraph(targetGraph, sourceTurtle, { capability: this.capability, actor: this.actor });
  }

  async update(sparql) {
    const graphs = tenantGraphsInSparql(sparql);
    if (graphs.length === 0) {
      throw new GraphWritePolicyError("SPARQL update requires an explicit tenant-scoped graph write target", {
        reason: "missing_graph_write_target",
        sparql
      });
    }
    for (const graphName of graphs) {
      this.assertWriteAllowed({ graphName, operation: "sparql update" });
    }
    return this.raw.update(sparql, { capability: this.capability, actor: this.actor });
  }

  assertWriteAllowed({ graphName, operation }) {
    const graph = classifyNamedGraph(graphName);
    assertGraphWritePolicy({
      tenantId: graph.tenantId,
      graphName,
      capability: this.capability,
      operation,
      kind: graph.kind
    });
  }
}

export function createGraphWriteGateway(options) {
  if (options?.fusekiClient instanceof GraphWriteGateway) {
    return options.fusekiClient;
  }
  return new GraphWriteGateway(options);
}

function tenantGraphsInSparql(sparql) {
  return [...String(sparql ?? "").matchAll(/<([^>]+)>/g)]
    .map((match) => match[1])
    .filter((iri) => /^graph:tenant:/.test(iri));
}
