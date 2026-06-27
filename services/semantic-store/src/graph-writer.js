import { assertGraphTenant, assertWritableWorkingGraph } from "./named-graphs.js";

export class SemanticGraphWriter {
  constructor({ fusekiClient, shaclRunner }) {
    this.fuseki = fusekiClient;
    this.shaclRunner = shaclRunner;
  }

  async insertValidatedWorkingTurtle({ tenantId, graphName, turtle, fixtureName = "inline.ttl" }) {
    assertWritableWorkingGraph(graphName);
    assertGraphTenant(graphName, tenantId);
    const validation = this.shaclRunner.validateTurtle(turtle, { fixtureName });
    if (!validation.valid) {
      throw new Error(`semantic graph write failed SHACL validation: ${validation.errors.join("; ")}`);
    }
    await this.fuseki.insertTurtle(graphName, turtle);
    return { graphName, validation };
  }

  async replaceValidatedWorkingGraph({ tenantId, graphName, turtle, fixtureName = "inline.ttl" }) {
    assertWritableWorkingGraph(graphName);
    assertGraphTenant(graphName, tenantId);
    const validation = this.shaclRunner.validateTurtle(turtle, { fixtureName });
    if (!validation.valid) {
      throw new Error(`semantic graph replacement failed SHACL validation: ${validation.errors.join("; ")}`);
    }
    await this.fuseki.putGraph(graphName, turtle);
    return { graphName, validation };
  }
}
