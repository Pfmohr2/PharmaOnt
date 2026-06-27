import { validateMappingObjectShape } from "../../../packages/contracts/src/index.js";
import { assertGraphTenant, assertWritableWorkingGraph, tenantWorkingGraph } from "./named-graphs.js";

const PREFIXES = `@prefix pharm: <https://w3id.org/pharmaops/ontology/core#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;

export class MappingStore {
  constructor({ fusekiClient, shaclRunner }) {
    this.fuseki = fusekiClient;
    this.shaclRunner = shaclRunner;
  }

  async createMapping({ tenantId, mapping, graphName = tenantWorkingGraph(tenantId, "mappings") }) {
    assertWritableWorkingGraph(graphName);
    assertGraphTenant(graphName, tenantId);
    const schemaValidation = validateMappingObjectShape(mapping);
    if (!schemaValidation.valid) {
      throw new Error(`mapping failed contract validation: ${schemaValidation.errors.join("; ")}`);
    }
    if (!mapping.source_vocabulary_version || !mapping.target_vocabulary_version) {
      throw new Error("mapping requires source and target vocabulary versions before persistence");
    }
    if (["blocked", "pending_review"].includes(mapping.license_status)) {
      throw new Error(`mapping license_status is not persistable for governed mapping write: ${mapping.license_status}`);
    }

    const turtle = mappingTurtle({ tenantId, mapping, graphName });
    const shaclValidation = this.shaclRunner.validateTurtle(turtle, { fixtureName: `${mapping.mapping_id}.ttl` });
    if (!shaclValidation.valid) {
      throw new Error(`mapping failed SHACL validation: ${shaclValidation.errors.join("; ")}`);
    }
    await this.fuseki.insertTurtle(graphName, turtle);
    return {
      graphName,
      mapping_id: mapping.mapping_id,
      schemaValidation,
      shaclValidation
    };
  }
}

export function mappingTurtle({ tenantId = "acme", mapping, graphName }) {
  const subject = iriForMapping(tenantId, mapping.mapping_id);
  const sourceEntity = iriForEntity(tenantId, mapping.source_entity_id);
  const targetEntity = iriForEntity(tenantId, mapping.target_entity_id);
  const evidenceIri = iriForEvidence(tenantId, mapping.evidence_ids[0]);
  return `${PREFIXES}

<${subject}>
    a pharm:MappingAssertion ;
    pharm:canonicalId "${escapeLiteral(mapping.mapping_id)}" ;
    pharm:entityType "MappingAssertion" ;
    pharm:preferredLabel "${escapeLiteral(mapping.mapping_id)} ${escapeLiteral(mapping.predicate)}" ;
    pharm:lifecycleStatus "approved" ;
    pharm:reviewStatus "${escapeLiteral(mapping.review_status)}" ;
    pharm:releaseMembership "${escapeLiteral(graphName)}" ;
    pharm:sourceEntity <${sourceEntity}> ;
    pharm:targetEntity <${targetEntity}> ;
    pharm:mappingPredicate "${escapeLiteral(mapping.predicate)}" ;
    pharm:sourceVocabulary "${escapeLiteral(mapping.source_vocabulary)}" ;
    pharm:sourceVocabularyVersion "${escapeLiteral(mapping.source_vocabulary_version)}" ;
    pharm:targetVocabulary "${escapeLiteral(mapping.target_vocabulary)}" ;
    pharm:targetVocabularyVersion "${escapeLiteral(mapping.target_vocabulary_version)}" ;
    pharm:confidenceScore ${Number(mapping.confidence_score).toFixed(2)} ;
    pharm:hasEvidence <${evidenceIri}> ;
    pharm:hasProvenance [
        a pharm:ProvenanceRecord ;
        pharm:provenanceId "${escapeLiteral(mapping.provenance_id)}" ;
        pharm:activityType "import" ;
        pharm:activityId "activity:${escapeLiteral(mapping.mapping_id)}" ;
        pharm:methodType "connector_transform" ;
        pharm:confidenceType "source_asserted" ;
        pharm:environmentName "test" ;
        pharm:tenantId "${escapeLiteral(tenantId)}" ;
        pharm:releaseStatus "not_released" ;
        pharm:auditEventId "${escapeLiteral(mapping.provenance?.audit_event_id ?? "audit:mapping-write")}" ;
        pharm:actor "${escapeLiteral(mapping.created_by)}" ;
        pharm:sourceName "${escapeLiteral(mapping.provenance?.source ?? mapping.source_vocabulary)}" ;
        pharm:sourceVersion "${escapeLiteral(mapping.provenance?.source_version ?? mapping.source_vocabulary_version)}" ;
        pharm:generatedAtTime "${new Date().toISOString()}"^^xsd:dateTime
    ] .`;
}

function iriForMapping(tenantId, value) {
  return `https://example.pharmaops.local/tenant/${encodeURIComponent(tenantId)}/mapping/${encodeURIComponent(value.replace(/^pharmmap:/, ""))}`;
}

function iriForEntity(tenantId, value) {
  return `https://example.pharmaops.local/tenant/${encodeURIComponent(tenantId)}/entity/${encodeURIComponent(value.replace(/^[^:]+:/, ""))}`;
}

function iriForEvidence(tenantId, value) {
  return `https://example.pharmaops.local/tenant/${encodeURIComponent(tenantId)}/evidence/${encodeURIComponent(value.replace(/^[^:]+:/, ""))}`;
}

function escapeLiteral(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
