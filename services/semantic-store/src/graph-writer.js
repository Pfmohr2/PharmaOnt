import { GraphWritePolicyError, assertGraphWritePolicy } from "./named-graphs.js";
import { createGraphWriteGateway } from "./graph-write-gateway.js";

export class SemanticGraphWriter {
  constructor({ fusekiClient, shaclRunner, auditStore = null, clock = () => new Date(), idFactory = defaultIdFactory }) {
    this.fuseki = createGraphWriteGateway({ fusekiClient, actor: "semantic_graph_writer" });
    this.shaclRunner = shaclRunner;
    this.auditStore = auditStore;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async insertValidatedWorkingTurtle({ tenantId, graphName, turtle, fixtureName = "inline.ttl" }) {
    await this.assertWriterPolicy({ tenantId, graphName, operation: "insert" });
    const validation = this.shaclRunner.validateTurtle(turtle, { fixtureName });
    if (!validation.valid) {
      throw new Error(`semantic graph write failed SHACL validation: ${validation.errors.join("; ")}`);
    }
    await this.fuseki.insertTurtle(graphName, turtle);
    return { graphName, validation };
  }

  async replaceValidatedWorkingGraph({ tenantId, graphName, turtle, fixtureName = "inline.ttl" }) {
    await this.assertWriterPolicy({ tenantId, graphName, operation: "replace" });
    const validation = this.shaclRunner.validateTurtle(turtle, { fixtureName });
    if (!validation.valid) {
      throw new Error(`semantic graph replacement failed SHACL validation: ${validation.errors.join("; ")}`);
    }
    await this.fuseki.putGraph(graphName, turtle);
    return { graphName, validation };
  }

  async assertWriterPolicy({ tenantId, graphName, operation }) {
    try {
      assertGraphWritePolicy({
        tenantId,
        graphName,
        operation,
        kind: "working"
      });
    } catch (error) {
      await this.appendDeniedAudit({ tenantId, graphName, operation, error });
      throw error instanceof GraphWritePolicyError
        ? new SemanticGraphWriterConflictError(error.message, error.details)
        : error;
    }
  }

  async appendDeniedAudit({ tenantId, graphName, operation, error }) {
    if (!this.auditStore || typeof this.auditStore.append !== "function") {
      return;
    }
    await this.auditStore.append({
      audit_event_id: `audit:semantic-graph-writer:${this.idFactory()}`,
      event_type: "semantic_graph_writer.relationship_graph_write_denied",
      tenant_id: tenantId,
      environment: "unknown",
      object_type: "semantic_graph",
      object_id: graphName,
      graph_name: graphName,
      actor: "semantic_graph_writer",
      action: operation,
      decision: "denied",
      errors: [error.message],
      occurred_at: this.clock().toISOString()
    });
  }
}

export class SemanticGraphWriterConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SemanticGraphWriterConflictError";
    this.status = 409;
    this.code = "semantic_graph_writer_conflict";
    this.details = details;
  }
}

function defaultIdFactory() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
