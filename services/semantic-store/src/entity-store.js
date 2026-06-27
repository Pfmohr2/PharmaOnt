import { randomUUID } from "node:crypto";
import { assertWritableWorkingGraph, tenantWorkingGraph } from "./named-graphs.js";

const PREFIXES = `@prefix pharm: <https://w3id.org/pharmaops/ontology/core#> .
@prefix pharment: <https://example.pharmaops.local/tenant/acme/entity/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;

export class EntityStore {
  constructor({ fusekiClient, shaclRunner }) {
    this.fuseki = fusekiClient;
    this.shaclRunner = shaclRunner;
  }

  async createCanonicalEntity({
    tenantId,
    entityId = `entity-${randomUUID()}`,
    entityType,
    preferredLabel,
    sourceName = "manual",
    sourceVersion = "not_applicable",
    actor = "service_account:semantic-store",
    environment = "test"
  }) {
    const graphName = tenantWorkingGraph(tenantId, "data:canonical");
    assertWritableWorkingGraph(graphName);
    const subject = `https://example.pharmaops.local/tenant/${tenantId}/entity/${encodeURIComponent(entityId)}`;
    const turtle = entityTurtle({
      subject,
      tenantId,
      entityId,
      entityType,
      preferredLabel,
      sourceName,
      sourceVersion,
      actor,
      environment,
      graphName
    });
    const validation = this.shaclRunner.validateTurtle(turtle, { fixtureName: `${entityId}.ttl` });
    if (!validation.valid) {
      throw new Error(`entity failed SHACL validation: ${validation.errors.join("; ")}`);
    }
    await this.fuseki.insertTurtle(graphName, turtle);
    return { graphName, subject, entityId, validation };
  }

  async getCanonicalEntity({ tenantId, entityId }) {
    const graphName = tenantWorkingGraph(tenantId, "data:canonical");
    const canonicalId = `pharment:${entityId}`;
    const result = await this.fuseki.query(`
PREFIX pharm: <https://w3id.org/pharmaops/ontology/core#>
SELECT ?s ?entityType ?preferredLabel ?lifecycleStatus
WHERE {
  GRAPH <${graphName}> {
    ?s pharm:canonicalId "${escapeString(canonicalId)}" ;
       pharm:entityType ?entityType ;
       pharm:preferredLabel ?preferredLabel ;
       pharm:lifecycleStatus ?lifecycleStatus .
  }
}
LIMIT 1`);
    const row = result.results?.bindings?.[0];
    if (!row) {
      return null;
    }
    return {
      subject: row.s.value,
      entityId,
      entityType: row.entityType.value,
      preferredLabel: row.preferredLabel.value,
      lifecycleStatus: row.lifecycleStatus.value,
      graphName
    };
  }
}

export function entityTurtle({
  subject,
  tenantId,
  entityId,
  entityType,
  preferredLabel,
  sourceName,
  sourceVersion,
  actor,
  environment,
  graphName
}) {
  const now = new Date().toISOString();
  const provenanceId = `pharmprov:${entityId}`;
  const auditEventId = `audit:${entityId}`;
  return `${PREFIXES}

<${subject}>
    a pharm:${entityType} ;
    pharm:canonicalId "pharment:${escapeLiteral(entityId)}" ;
    pharm:entityType "${escapeLiteral(entityType)}" ;
    pharm:preferredLabel "${escapeLiteral(preferredLabel)}" ;
    pharm:lifecycleStatus "approved" ;
    pharm:releaseMembership "${escapeLiteral(graphName)}" ;
    pharm:hasProvenance [
        a pharm:ProvenanceRecord ;
        pharm:provenanceId "${escapeLiteral(provenanceId)}" ;
        pharm:activityType "import" ;
        pharm:activityId "activity:${escapeLiteral(entityId)}" ;
        pharm:methodType "manual_edit" ;
        pharm:confidenceType "reviewer_decision" ;
        pharm:environmentName "${escapeLiteral(environment)}" ;
        pharm:tenantId "${escapeLiteral(tenantId)}" ;
        pharm:releaseStatus "not_released" ;
        pharm:auditEventId "${escapeLiteral(auditEventId)}" ;
        pharm:actor "${escapeLiteral(actor)}" ;
        pharm:sourceName "${escapeLiteral(sourceName)}" ;
        pharm:sourceVersion "${escapeLiteral(sourceVersion)}" ;
        pharm:generatedAtTime "${now}"^^xsd:dateTime
    ] .`;
}

function escapeLiteral(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeString(value) {
  return escapeLiteral(value);
}
