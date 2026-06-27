import { createHash } from "node:crypto";
import { DataFactory, Parser, Store, Writer } from "n3";
import {
  relationshipAssertionSchemaContract,
  validateRelationshipAssertionContract
} from "../../../packages/contracts/src/index.js";
import { createGraphWriteGateway } from "./graph-write-gateway.js";
import {
  assertGraphTenant,
  assertGraphWritePolicy,
  tenantReleaseGraph,
  tenantWorkingGraph
} from "./named-graphs.js";

const CORE = "https://w3id.org/pharmaops/ontology/core#";
const REL = "https://w3id.org/pharmaops/ontology/relationship#";
const TENANT_BASE = "https://example.pharmaops.local/tenant/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const CREATE_ROLES = new Set(["contributor", "curator", "domain_approver", "data_engineer", "platform_admin"]);
const REVIEWER_ROLES = new Set(["curator", "domain_approver", "compliance_reviewer", "platform_admin"]);
const CAUSAL_SAFETY_APPROVER_ROLES = new Set(["causal_safety_approver", "safety_approver"]);
const STEWARD_ROLES = new Set(["data_steward", "curator", "domain_approver", "compliance_reviewer", "platform_admin"]);
const RELEASE_BLOCKING_LICENSE_STATUSES = new Set(["blocked", "pending_review"]);
const RELEASE_BLOCKING_LICENSE_CLASSES = new Set(["blocked_pending_legal_review"]);
const ALLOWED_TRANSITIONS = Object.freeze({
  submit: new Set(["draft", "proposed"]),
  approve: new Set(["in_review"]),
  reject: new Set(["draft", "proposed", "in_review"]),
  deprecate: new Set(["approved", "released", "in_review", "rejected", "superseded"]),
  update_evidence: new Set(["draft", "proposed", "in_review", "approved", "released"])
});
const CONFIDENCE_TO_EVIDENCE_STRENGTH = Object.freeze({
  high: "strong",
  medium: "moderate",
  low: "weak",
  blocked: "blocked"
});

const PREFIXES = `@prefix pharm: <${CORE}> .
@prefix pharmrel: <${REL}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;

export class RelationshipAssertionStore {
  #relationshipGraphWriteCapability;
  #fuseki;

  constructor({
    fusekiClient,
    shaclRunner,
    auditStore = new MemoryRelationshipAssertionAuditStore(),
    validateRelationshipAssertionShape = validateRelationshipAssertionContract,
    clock = () => new Date(),
    idFactory = defaultIdFactory,
    relationshipGraphWriteCapability = null
  }) {
    this.#relationshipGraphWriteCapability = relationshipGraphWriteCapability;
    this.#fuseki = createGraphWriteGateway({
      fusekiClient,
      capability: this.#relationshipGraphWriteCapability,
      actor: "relationship_assertion_store"
    });
    this.shaclRunner = shaclRunner;
    this.auditStore = auditStore;
    this.validateRelationshipAssertionShape = validateRelationshipAssertionShape;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async createRelationshipAssertion({
    tenantId,
    assertion,
    graphName = tenantWorkingGraph(tenantId, "relationships"),
    actorRoleKey,
    actor = assertion?.created_by ?? assertion?.provenance?.actor ?? "unknown"
  }) {
    assertRelationshipGraph({ tenantId, graphName, capability: this.#relationshipGraphWriteCapability });
    assertCreateRole(actorRoleKey);

    const schemaValidation = this.validateRelationshipAssertionShape(assertion);
    if (!schemaValidation.valid) {
      await this.appendAuditEvent({
        tenantId,
        assertion,
        actor,
        graphName,
        decision: "denied",
        eventType: "relationship_assertion.validation_failed",
        errors: schemaValidation.errors
      });
      throw new Error(`relationship assertion failed contract validation: ${schemaValidation.errors.join("; ")}`);
    }

    try {
      assertCreateState(assertion);
      assertEvidenceRequired(assertion);
      assertRelationshipScope({ tenantId, assertion });
      assertLicensePersistable(assertion);
    } catch (error) {
      await this.appendAuditEvent({
        tenantId,
        assertion,
        actor,
        graphName,
        decision: "denied",
        eventType: "relationship_assertion.validation_failed",
        errors: [error.message]
      });
      throw error;
    }

    const existingRelationshipAssertion = await this.relationshipAssertionSubjectExists({
      tenantId,
      relationshipAssertionId: assertion.relationship_assertion_id,
      graphName
    });
    if (existingRelationshipAssertion) {
      const error = new RelationshipAssertionConflictError(
        `relationship assertion conflict: relationship_assertion_id ${assertion.relationship_assertion_id} already exists`
      );
      await this.appendAuditEvent({
        tenantId,
        assertion,
        actor,
        graphName,
        decision: "denied",
        eventType: "relationship_assertion.create_conflict",
        errors: [error.message]
      });
      throw error;
    }

    const turtle = relationshipAssertionTurtle({ tenantId, assertion, graphName });
    const shaclValidation = this.shaclRunner.validateTurtle(turtle, {
      fixtureName: `${assertion.relationship_assertion_id}.ttl`
    });
    if (!shaclValidation.valid) {
      await this.appendAuditEvent({
        tenantId,
        assertion,
        actor,
        graphName,
        decision: "denied",
        eventType: "relationship_assertion.validation_failed",
        errors: shaclValidation.errors
      });
      throw new Error(`relationship assertion failed SHACL validation: ${shaclValidation.errors.join("; ")}`);
    }

    await this.#fuseki.insertTurtle(graphName, turtle);
    const auditEvent = await this.appendAuditEvent({
      tenantId,
      assertion,
      actor,
      graphName,
      decision: "created",
      eventType: "relationship_assertion.created",
      errors: []
    });
    return {
      graphName,
      relationship_assertion_id: assertion.relationship_assertion_id,
      turtle,
      schemaValidation,
      shaclValidation,
      auditEvent
    };
  }

  async transitionRelationshipAssertion({
    tenantId,
    currentAssertion,
    transition,
    decision = {},
    graphName = tenantWorkingGraph(tenantId, "relationships"),
    actor,
    actorRoleKey,
    stepUpAuthenticated = false
  }) {
    assertRelationshipGraph({ tenantId, graphName, capability: this.#relationshipGraphWriteCapability });
    const auditActor = actor ?? decision.actor ?? "unknown";
    let nextAssertion;
    try {
      nextAssertion = buildTransitionCandidate({
        currentAssertion,
        transition,
        decision,
        actor: auditActor,
        actorRoleKey,
        stepUpAuthenticated,
        now: this.clock().toISOString()
      });
      assertRelationshipScope({ tenantId, assertion: nextAssertion });
      assertEvidenceRequired(nextAssertion);
      assertBlockedRationale(nextAssertion);
      const schemaValidation = this.validateRelationshipAssertionShape(nextAssertion);
      if (!schemaValidation.valid) {
        throw new RelationshipAssertionTransitionError(
          `relationship assertion transition failed contract validation: ${schemaValidation.errors.join("; ")}`,
          { errors: schemaValidation.errors }
        );
      }
      const turtle = relationshipAssertionTurtle({ tenantId, assertion: nextAssertion, graphName });
      const shaclValidation = this.shaclRunner.validateTurtle(turtle, {
        fixtureName: `${nextAssertion.relationship_assertion_id}.${transition}.ttl`
      });
      if (!shaclValidation.valid) {
        throw new RelationshipAssertionTransitionError(
          `relationship assertion transition failed SHACL validation: ${shaclValidation.errors.join("; ")}`,
          { errors: shaclValidation.errors }
        );
      }
      await this.replaceRelationshipAssertionTurtle({
        tenantId,
        graphName,
        relationshipAssertionId: nextAssertion.relationship_assertion_id,
        turtle
      });
      const auditEvent = await this.appendAuditEvent({
        tenantId,
        assertion: nextAssertion,
        actor: auditActor,
        graphName,
        decision: transition,
        eventType: `relationship_assertion.${transition}`,
        errors: []
      });
      return {
        graphName,
        relationship_assertion_id: nextAssertion.relationship_assertion_id,
        transition,
        assertion: nextAssertion,
        turtle,
        shaclValidation,
        auditEvent
      };
    } catch (error) {
      const auditAssertion = nextAssertion ?? currentAssertion;
      await this.appendAuditEvent({
        tenantId,
        assertion: auditAssertion,
        actor: auditActor,
        graphName,
        decision: "denied",
        eventType: "relationship_assertion.transition_denied",
        errors: error.details?.errors ?? [error.message]
      });
      throw error;
    }
  }

  async attachRelationshipEvidence({
    tenantId,
    currentAssertion,
    evidenceRefs,
    graphName = tenantWorkingGraph(tenantId, "relationships"),
    actor,
    actorRoleKey
  }) {
    return this.updateRelationshipEvidence({
      tenantId,
      currentAssertion,
      evidenceRefs,
      mode: "attach",
      graphName,
      actor,
      actorRoleKey
    });
  }

  async replaceRelationshipEvidence({
    tenantId,
    currentAssertion,
    evidenceRefs,
    graphName = tenantWorkingGraph(tenantId, "relationships"),
    actor,
    actorRoleKey
  }) {
    return this.updateRelationshipEvidence({
      tenantId,
      currentAssertion,
      evidenceRefs,
      mode: "replace",
      graphName,
      actor,
      actorRoleKey
    });
  }

  async updateRelationshipEvidence({
    tenantId,
    currentAssertion,
    evidenceRefs,
    mode = "replace",
    graphName = tenantWorkingGraph(tenantId, "relationships"),
    actor,
    actorRoleKey
  }) {
    const normalizedEvidenceRefs = normalizeEvidenceRefs(evidenceRefs);
    const nextEvidenceRefs = mode === "attach"
      ? mergeEvidenceRefs(currentAssertion?.evidence_refs ?? [], normalizedEvidenceRefs)
      : normalizedEvidenceRefs;
    if (mode !== "attach" && mode !== "replace") {
      throw new RelationshipAssertionTransitionError(`unsupported evidence update mode: ${mode}`, {
        errors: [`unsupported evidence update mode: ${mode}`]
      });
    }
    return this.transitionRelationshipAssertion({
      tenantId,
      currentAssertion,
      transition: "update_evidence",
      decision: evidenceLineageDecision(nextEvidenceRefs),
      graphName,
      actor,
      actorRoleKey
    });
  }

  async buildRelationshipReleaseInclusion({
    tenantId,
    assertion,
    releaseId,
    releaseCandidateId,
    validationReportIds,
    releaseGraphName = tenantReleaseGraph(tenantId, releaseId, "relationships"),
    actor,
    actorRoleKey = "release_manager",
    stagedAt = this.clock().toISOString()
  }) {
    const auditActor = actor?.user_id ?? actor ?? "unknown";
    let releaseAssertion;
    try {
      if (actorRoleKey !== "release_manager") {
        throw transitionError(`release inclusion requires release_manager role; received ${actorRoleKey ?? "none"}`);
      }
      assertNonEmptyString(releaseId, "release_id");
      assertNonEmptyString(releaseCandidateId, "release_candidate_id");
      assertReleaseGraphTenant({
        tenantId,
        graphName: releaseGraphName,
        releaseId,
        capability: this.#relationshipGraphWriteCapability
      });
      releaseAssertion = buildReleaseAssertionCandidate({
        assertion,
        releaseId,
        releaseCandidateId,
        validationReportIds,
        actor: auditActor,
        now: stagedAt
      });
      assertRelationshipScope({ tenantId, assertion: releaseAssertion });
      assertCompleteEvidenceRefs(releaseAssertion.evidence_refs);
      assertReleaseInclusionEligible(releaseAssertion);
      const schemaValidation = this.validateRelationshipAssertionShape(releaseAssertion);
      if (!schemaValidation.valid) {
        throw transitionError(`relationship assertion release inclusion failed contract validation: ${schemaValidation.errors.join("; ")}`, {
          errors: schemaValidation.errors
        });
      }
      const turtle = relationshipAssertionTurtle({
        tenantId,
        assertion: releaseAssertion,
        graphName: releaseGraphName
      });
      const shaclValidation = this.shaclRunner.validateTurtle(turtle, {
        fixtureName: `${releaseAssertion.relationship_assertion_id}.release.ttl`
      });
      if (!shaclValidation.valid) {
        throw transitionError(`relationship assertion release inclusion failed SHACL validation: ${shaclValidation.errors.join("; ")}`, {
          errors: shaclValidation.errors
        });
      }
      const releaseArtifactHash = artifactHash(releaseAssertion);
      const auditEvent = await this.appendAuditEvent({
        tenantId,
        assertion: releaseAssertion,
        actor: auditActor,
        graphName: releaseGraphName,
        decision: "included",
        eventType: "relationship_assertion.release_inclusion",
        errors: []
      });
      const stagedEntry = {
        staging_id: `stage:relationship:${releaseAssertion.relationship_assertion_id}:${releaseCandidateId}`,
        proposal_id: releaseAssertion.relationship_assertion_id,
        proposal_type: "relationship",
        tenant_id: tenantId,
        environment: releaseAssertion.environment,
        release_id: releaseId,
        staged_by_user_id: auditActor,
        staged_by_role_key: "release_manager",
        audit_event_id: auditEvent.audit_event_id,
        payload_hash: releaseArtifactHash,
        validation_report_id: releaseAssertion.validation_report_ids[0]
      };
      return {
        release_graph_name: releaseGraphName,
        relationship_assertion_id: releaseAssertion.relationship_assertion_id,
        assertion: releaseAssertion,
        turtle,
        shaclValidation,
        validation_report_ids: [...releaseAssertion.validation_report_ids],
        auditEvent,
        staged_entry: stagedEntry,
        release_item: relationshipReleaseItem({
          tenantId,
          releaseAssertion,
          releaseId,
          releaseCandidateId,
          releaseGraphName,
          auditEvent,
          artifactHash: releaseArtifactHash,
          stagedEntry
        })
      };
    } catch (error) {
      await this.appendAuditEvent({
        tenantId,
        assertion: releaseAssertion ?? assertion,
        actor: auditActor,
        graphName: releaseGraphName,
        decision: "denied",
        eventType: "relationship_assertion.release_inclusion_denied",
        errors: error.details?.errors ?? [error.message]
      });
      throw error;
    }
  }

  async replaceRelationshipAssertionTurtle({ tenantId, graphName, relationshipAssertionId, turtle }) {
    if (typeof this.#fuseki.putGraph !== "function") {
      await this.#fuseki.insertTurtle(graphName, turtle);
      return;
    }
    const currentTurtle = typeof this.#fuseki.getGraph === "function"
      ? await this.#fuseki.getGraph(graphName)
      : "";
    const nextGraphTurtle = await replaceRelationshipAssertionInTurtle({
      currentTurtle,
      replacementTurtle: turtle,
      tenantId,
      relationshipAssertionId,
      graphName
    });
    await this.#fuseki.putGraph(graphName, nextGraphTurtle);
  }

  async getRelationshipAssertionById({
    tenantId,
    relationshipAssertionId,
    graphName = tenantWorkingGraph(tenantId, "relationships")
  }) {
    assertRelationshipGraph({ tenantId, graphName, capability: this.#relationshipGraphWriteCapability });
    const rows = await this.relationshipRows({ tenantId, graphName });
    return rows.find((row) =>
      row.relationship_assertion_id === relationshipAssertionId ||
      row.relationship_id === relationshipAssertionId ||
      row.id === relationshipAssertionId ||
      row.canonical_id === relationshipAssertionId
    ) ?? null;
  }

  async relationshipAssertionSubjectExists({
    tenantId,
    relationshipAssertionId,
    graphName = tenantWorkingGraph(tenantId, "relationships")
  }) {
    assertRelationshipGraph({ tenantId, graphName, capability: this.#relationshipGraphWriteCapability });
    const turtle = await this.#fuseki.getGraph(graphName);
    const store = parseTurtle(turtle, graphName);
    const subject = DataFactory.namedNode(relationshipIri(tenantId, relationshipAssertionId));
    return store.getQuads(subject, null, null, null).length > 0;
  }

  async listRelationshipAssertionsByEntityId({
    tenantId,
    entityId,
    graphName = tenantWorkingGraph(tenantId, "relationships")
  }) {
    assertRelationshipGraph({ tenantId, graphName, capability: this.#relationshipGraphWriteCapability });
    const rows = await this.relationshipRows({ tenantId, graphName });
    const wanted = normalizeEntityId(entityId);
    return rows.filter((row) =>
      normalizeEntityId(row.source_entity_id) === wanted ||
      normalizeEntityId(row.target_entity_id) === wanted ||
      row.source_entity_iri === entityIri(tenantId, entityId) ||
      row.target_entity_iri === entityIri(tenantId, entityId)
    );
  }

  async relationshipRows({ tenantId, graphName = tenantWorkingGraph(tenantId, "relationships") }) {
    assertRelationshipGraph({ tenantId, graphName, capability: this.#relationshipGraphWriteCapability });
    const turtle = await this.#fuseki.getGraph(graphName);
    const store = parseTurtle(turtle, graphName);
    return store
      .getQuads(null, RDF_TYPE, `${CORE}RelationshipAssertion`, null)
      .map((quad) => relationshipRowFromStore({ store, subject: quad.subject, tenantId, graphName }))
      .filter(Boolean);
  }

  async appendAuditEvent({ tenantId, assertion, actor, graphName, decision, eventType, errors }) {
    if (!this.auditStore || typeof this.auditStore.append !== "function") {
      throw new Error("RelationshipAssertionStore requires auditStore.append");
    }
    const relationshipAssertionId = assertion?.relationship_assertion_id ?? "unknown";
    const event = {
      audit_event_id: `audit:relationship:${this.idFactory()}`,
      event_type: eventType,
      tenant_id: tenantId,
      environment: assertion?.environment ?? "unknown",
      object_type: "relationship_assertion",
      object_id: relationshipAssertionId,
      graph_name: graphName,
      actor,
      decision,
      errors: errors ?? [],
      occurred_at: this.clock().toISOString()
    };
    const persisted = await this.auditStore.append(event);
    if (!persisted?.audit_event_id) {
      throw new Error("relationship assertion audit append did not return an audit_event_id");
    }
    return persisted;
  }
}

export class RelationshipAssertionConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RelationshipAssertionConflictError";
    this.status = 409;
    this.code = "relationship_assertion_conflict";
    this.details = details;
  }
}

export class MemoryRelationshipAssertionAuditStore {
  constructor(events = []) {
    this.events = events;
  }

  async append(event) {
    const persisted = structuredClone(event);
    this.events.push(persisted);
    return structuredClone(persisted);
  }

  list() {
    return this.events.map((event) => structuredClone(event));
  }
}

export class RelationshipAssertionTransitionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RelationshipAssertionTransitionError";
    this.details = details;
  }
}

export function relationshipAssertionTurtle({ tenantId = "acme", assertion, graphName }) {
  const relationshipId = assertion.relationship_assertion_id;
  const subject = relationshipIri(tenantId, relationshipId);
  const sourceEntity = entityIri(tenantId, assertion.source_entity_id);
  const targetEntity = entityIri(tenantId, assertion.target_entity_id);
  const predicate = relationshipPredicateIri(assertion.predicate);
  const releaseId = assertion.release_context?.release_id ?? "not_released";
  const lifecycleStatus = lifecycleStatusFor(assertion);
  const relationshipAssertionType = assertion.assertion_type;
  const confidence = assertion.confidence ?? {};
  const dataLicense = assertion.data_license ?? {};
  const provenance = assertion.provenance ?? {};
  const evidenceStrength = evidenceStrengthFor(assertion);
  const exportAuthorizationStatus = exportAuthorizationStatusFor(dataLicense);
  const usesRestrictedEvidence = usesRestrictedEvidenceFor(assertion);
  const preferredLabel = assertion.preferred_label ??
    `${assertion.relationship_class} ${localName(assertion.predicate)} relationship`;

  return `${PREFIXES}

<${subject}>
    a pharm:RelationshipAssertion ;
    pharm:canonicalId "${escapeLiteral(relationshipId)}" ;
    pharm:entityType "RelationshipAssertion" ;
    pharm:preferredLabel "${escapeLiteral(preferredLabel)}" ;
    pharm:lifecycleStatus "${escapeLiteral(lifecycleStatus)}" ;
    pharm:assertionType "${escapeLiteral(relationshipAssertionType)}" ;
    pharm:hasAssertionType "${escapeLiteral(relationshipAssertionType)}" ;
    pharm:hasRelationshipClass "${escapeLiteral(assertion.relationship_class)}" ;
    pharm:relationshipDirectionality "${escapeLiteral(assertion.directionality)}" ;
    pharm:relationshipPolarity "${escapeLiteral(assertion.polarity)}" ;
    pharm:confidenceScore ${Number(confidence.confidence_score).toFixed(2)} ;
    pharm:confidenceBand "${escapeLiteral(confidence.confidence_band)}" ;
    pharm:hasEvidenceStrength "${escapeLiteral(evidenceStrength)}" ;
    pharm:reviewStatus "${escapeLiteral(assertion.review_status)}" ;${optionalLiteralLine("pharm:reviewedBy", assertion.reviewed_by)}
${optionalDateLine("pharm:reviewedAt", assertion.reviewed_at)}
    pharm:dataLicenseClass "${escapeLiteral(dataLicense.license_classification)}" ;
    pharm:licenseStatus "${escapeLiteral(dataLicense.license_status)}" ;${optionalLiteralLine("pharm:licensePolicyId", dataLicense.license_policy_id)}
    pharm:releaseId "${escapeLiteral(releaseId)}" ;
${arrayLiteralLines("pharm:validationReportId", assertion.validation_report_ids)}
    pharm:createdBy "${escapeLiteral(assertion.created_by)}" ;
    pharm:createdAt "${escapeLiteral(assertion.created_at)}"^^xsd:dateTime ;
    pharm:updatedAt "${escapeLiteral(assertion.updated_at)}"^^xsd:dateTime ;${optionalLiteralLine("pharm:hasCausalClaimStatus", assertion.causal_claim_status)}
    pharm:usesRestrictedEvidence ${usesRestrictedEvidence} ;
    pharm:exportAuthorizationStatus "${escapeLiteral(exportAuthorizationStatus)}" ;
    pharm:releaseMembership "${escapeLiteral(graphName)}" ;
${arrayLiteralLines("pharm:sourceRecordId", assertion.source_record_ids)}
${arrayLiteralLines("pharm:sourceName", assertion.source_names)}
${arrayLiteralLines("pharm:sourceVersion", assertion.source_versions)}
${arrayLiteralLines("pharm:permittedUse", dataLicense.permitted_uses)}
${arrayLiteralLines("pharm:exportRestriction", dataLicense.export_restrictions)}
${arrayLiteralLines("pharm:knownLimitation", assertion.known_limitations)}
${optionalLiteralLine("pharm:blockedRationale", assertion.blocked_rationale)}
    pharm:relationshipSubject <${sourceEntity}> ;
    pharm:relationshipPredicate <${predicate}> ;
    pharm:relationshipObject <${targetEntity}> ;
${arrayIriLines("pharm:hasEvidence", assertion.evidence_refs?.map((evidence) => evidence.evidence_id), (value) => evidenceIri(tenantId, value))}
${arrayIriLines("pharm:hasRelationshipWarning", assertion.warnings, (value) => warningIri(tenantId, value))}
    pharm:artifactHash "${escapeLiteral(artifactHash(assertion))}" ;
    pharm:hasProvenance [
        a pharm:ProvenanceRecord ;
        pharm:provenanceId "${escapeLiteral(assertion.provenance_id)}" ;
        pharm:activityType "${escapeLiteral(provenance.activity ?? "relationship_assertion_write")}" ;
        pharm:activityId "activity:${escapeLiteral(relationshipId)}" ;
        pharm:methodType "${escapeLiteral(provenance.method ?? "relationship_assertion_store")}" ;
        pharm:confidenceType "${escapeLiteral(confidence.confidence_source ?? "source_asserted")}" ;
        pharm:environmentName "${escapeLiteral(assertion.environment)}" ;
        pharm:tenantId "${escapeLiteral(tenantId)}" ;
        pharm:releaseStatus "${escapeLiteral(releaseStatusFor(assertion))}" ;
        pharm:auditEventId "${escapeLiteral(provenance.audit_event_id)}" ;
        pharm:actor "${escapeLiteral(provenance.actor ?? assertion.created_by)}" ;
        pharm:sourceName "${escapeLiteral(provenance.source?.source_name ?? assertion.source_names?.[0])}" ;
        pharm:sourceVersion "${escapeLiteral(provenance.source?.source_version ?? assertion.source_versions?.[0])}" ;
        pharm:generatedAtTime "${escapeLiteral(provenance.time ?? assertion.updated_at)}"^^xsd:dateTime
    ] .`;
}

export function validateRelationshipAssertionObjectShape(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["RelationshipAssertion must be an object."] };
  }
  for (const field of relationshipAssertionSchemaContract.required ?? []) {
    if (!(field in value)) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  const defs = relationshipAssertionSchemaContract.$defs ?? {};
  requireEnum(value.relationship_class, defs.relationshipClass?.enum, "relationship_class", errors);
  requireEnum(value.predicate, predicateEnumForClass(value.relationship_class, defs), "predicate", errors);
  requireEnum(value.assertion_type, defs.assertionType?.enum, "assertion_type", errors);
  requireEnum(value.review_status, defs.reviewStatus?.enum, "review_status", errors);
  requireEnum(value.directionality, ["directed", "undirected", "bidirectional"], "directionality", errors);
  requireEnum(value.polarity, ["positive", "negative", "conflicting", "unknown"], "polarity", errors);
  requireArray(value.evidence_refs, "evidence_refs", errors);
  requireArray(value.source_names, "source_names", errors);
  requireArray(value.source_versions, "source_versions", errors);
  if (value.confidence) {
    const score = value.confidence.confidence_score;
    if (typeof score !== "number" || score < 0 || score > 1) {
      errors.push("confidence.confidence_score must be a number from 0 to 1.");
    }
    requireEnum(value.confidence.confidence_band, ["high", "medium", "low", "blocked"], "confidence.confidence_band", errors);
    if (value.confidence.fabricated !== false) {
      errors.push("confidence.fabricated must be false.");
    }
  }
  if (value.relationship_class === "safety" || value.secondary_relationship_tags?.includes("causal_sensitive")) {
    if (!value.causal_claim_status) {
      errors.push("causal_claim_status is required for safety or causal_sensitive assertions.");
    }
  }
  if (value.relationship_class === "blocked" && !value.blocked_rationale) {
    errors.push("blocked_rationale is required for blocked relationships.");
  }
  if (value.assertion_type === "model_suggested") {
    if (value.review_status === "approved" || value.review_status === "released") {
      errors.push("model_suggested relationship assertions cannot be approved or released.");
    }
    if (value.release_context?.scope !== "working" || value.release_context?.release_id !== null) {
      errors.push("model_suggested relationship assertions must remain in working scope.");
    }
  }
  if (value.review_status === "released") {
    if (value.assertion_type === "model_suggested") {
      errors.push("released relationship assertions cannot be model_suggested.");
    }
    if (!value.reviewed_by) {
      errors.push("released relationship assertions require reviewed_by.");
    }
    if (!value.reviewed_at) {
      errors.push("released relationship assertions require reviewed_at.");
    }
    if (!value.release_context?.release_id || value.release_context?.scope !== "release" || value.release_context?.included_in_release !== true) {
      errors.push("released relationship assertions require release scope, release_id, and included_in_release=true.");
    }
    if (!Array.isArray(value.validation_report_ids) || value.validation_report_ids.length === 0) {
      errors.push("released relationship assertions require validation_report_ids.");
    }
    if (RELEASE_BLOCKING_LICENSE_STATUSES.has(value.data_license?.license_status)) {
      errors.push(`released relationship assertions cannot use license_status ${value.data_license.license_status}.`);
    }
    if (RELEASE_BLOCKING_LICENSE_CLASSES.has(value.data_license?.license_classification)) {
      errors.push(`released relationship assertions cannot use license_classification ${value.data_license.license_classification}.`);
    }
    if (!value.data_license?.permitted_uses?.includes("release")) {
      errors.push("released relationship assertions require release in data_license.permitted_uses.");
    }
  }
  return { valid: errors.length === 0, errors };
}

function relationshipRowFromStore({ store, subject, tenantId, graphName }) {
  const relationshipAssertionId = literal(store, subject, "canonicalId") ?? localName(subject.value);
  const sourceEntityIri = iri(store, subject, "relationshipSubject");
  const targetEntityIri = iri(store, subject, "relationshipObject");
  const predicateIri = iri(store, subject, "relationshipPredicate");
  const sourceVersions = literals(store, subject, "sourceVersion");
  const sourceNames = literals(store, subject, "sourceName");
  const releaseId = literal(store, subject, "releaseId");
  const licensePolicyId = literal(store, subject, "licensePolicyId");
  const relationshipAssertionType = literal(store, subject, "assertionType");
  return {
    id: relationshipAssertionId,
    object_id: relationshipAssertionId,
    relationship_id: relationshipAssertionId,
    relationship_assertion_id: relationshipAssertionId,
    canonical_id: relationshipAssertionId,
    object_type: "relationship",
    result_type: "relationship",
    assertion_type: "relationship",
    relationship_assertion_type: relationshipAssertionType,
    tenant_id: tenantId,
    environment: provenanceLiteral(store, subject, "environmentName") ?? "unknown",
    graph_name: graphName,
    relationship_class: literal(store, subject, "hasRelationshipClass"),
    predicate: localName(predicateIri),
    predicate_iri: predicateIri,
    source_entity_id: entityIdFromIri(sourceEntityIri),
    source_entity_iri: sourceEntityIri,
    target_entity_id: entityIdFromIri(targetEntityIri),
    target_entity_iri: targetEntityIri,
    directionality: literal(store, subject, "relationshipDirectionality"),
    polarity: literal(store, subject, "relationshipPolarity"),
    confidence_score: numberOrNull(literal(store, subject, "confidenceScore")),
    confidence_band: literal(store, subject, "confidenceBand"),
    review_status: literal(store, subject, "reviewStatus"),
    lifecycle_status: literal(store, subject, "lifecycleStatus"),
    reviewed_by: literal(store, subject, "reviewedBy"),
    reviewed_at: literal(store, subject, "reviewedAt"),
    release_id: releaseId === "not_released" ? null : releaseId,
    provenance_id: provenanceLiteral(store, subject, "provenanceId"),
    artifact_hash: literal(store, subject, "artifactHash") ?? artifactHash({ relationship_assertion_id: relationshipAssertionId }),
    license_status: literal(store, subject, "licenseStatus"),
    license_classification: literal(store, subject, "dataLicenseClass"),
    license_policy_id: licensePolicyId ?? "not_required",
    permitted_uses: literals(store, subject, "permittedUse"),
    export_restrictions: literals(store, subject, "exportRestriction"),
    source_names: sourceNames,
    source_versions: sourceVersions,
    source_version: sourceVersions[0] ?? null,
    source_vocabulary_version: sourceVersions[0] ?? "unknown",
    target_vocabulary_version: sourceVersions.at(-1) ?? sourceVersions[0] ?? "unknown",
    evidence_refs: iris(store, subject, "hasEvidence").map((evidenceIriValue) => ({
      evidence_id: evidenceIdFromIri(evidenceIriValue)
    })),
    warning_ids: iris(store, subject, "hasRelationshipWarning").map((warningIriValue) => localName(warningIriValue)),
    audit_event_ids: provenanceLiterals(store, subject, "auditEventId")
  };
}

function parseTurtle(turtle, graphName) {
  const store = new Store();
  if (!turtle.trim()) {
    return store;
  }
  store.addQuads(new Parser({ baseIRI: graphName }).parse(turtle));
  return store;
}

async function replaceRelationshipAssertionInTurtle({
  currentTurtle,
  replacementTurtle,
  tenantId,
  relationshipAssertionId,
  graphName
}) {
  const store = parseTurtle(currentTurtle, graphName);
  const subject = DataFactory.namedNode(relationshipIri(tenantId, relationshipAssertionId));
  const provenanceNodes = store.getQuads(subject, `${CORE}hasProvenance`, null, null).map((quad) => quad.object);
  store.removeQuads(store.getQuads(subject, null, null, null));
  for (const provenanceNode of provenanceNodes) {
    store.removeQuads(store.getQuads(provenanceNode, null, null, null));
  }
  store.addQuads(new Parser({ baseIRI: graphName }).parse(replacementTurtle));
  return writeTurtle(store);
}

function writeTurtle(store) {
  const writer = new Writer({
    prefixes: {
      pharm: CORE,
      pharmrel: REL,
      xsd: "http://www.w3.org/2001/XMLSchema#"
    }
  });
  writer.addQuads(store.getQuads(null, null, null, null));
  return new Promise((resolve, reject) => {
    writer.end((error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function buildTransitionCandidate({
  currentAssertion,
  transition,
  decision,
  actor,
  actorRoleKey,
  stepUpAuthenticated,
  now
}) {
  if (!currentAssertion || typeof currentAssertion !== "object" || Array.isArray(currentAssertion)) {
    throw transitionError("currentAssertion is required");
  }
  if (!ALLOWED_TRANSITIONS[transition]) {
    throw transitionError(`unsupported relationship assertion transition: ${transition}`);
  }
  const currentStatus = currentAssertion.review_status;
  if (!ALLOWED_TRANSITIONS[transition].has(currentStatus)) {
    throw transitionError(`relationship assertion cannot ${transition} from ${currentStatus}`);
  }
  assertTransitionRole({ transition, actorRoleKey, stepUpAuthenticated, currentAssertion });

  const next = structuredClone(currentAssertion);
  next.updated_at = now;
  next.provenance = {
    ...(next.provenance ?? {}),
    actor,
    time: now,
    activity: `relationship_assertion.${transition}`,
    method: "workflow_transition_engine"
  };

  if (transition === "submit") {
    next.review_status = "in_review";
    return next;
  }

  if (transition === "approve") {
    assertApprovalEligible(next);
    if (next.assertion_type === "model_suggested") {
      throw transitionError("model_suggested relationship assertions cannot be approved or released directly");
    }
    next.review_status = "approved";
    next.reviewed_by = decision.reviewed_by ?? actor;
    next.reviewed_at = decision.reviewed_at ?? now;
    return next;
  }

  if (transition === "reject") {
    next.review_status = "rejected";
    next.reviewed_by = decision.reviewed_by ?? actor;
    next.reviewed_at = decision.reviewed_at ?? now;
    if (decision.rationale) {
      next.known_limitations = unique([...(next.known_limitations ?? []), decision.rationale]);
    }
    return next;
  }

  if (transition === "deprecate") {
    next.review_status = "deprecated";
    if (decision.rationale) {
      next.known_limitations = unique([...(next.known_limitations ?? []), decision.rationale]);
    }
    return next;
  }

  if (transition === "update_evidence") {
    if (!Array.isArray(decision.evidence_refs) || decision.evidence_refs.length === 0) {
      throw transitionError("update_evidence requires non-empty evidence_refs");
    }
    assertCompleteEvidenceRefs(decision.evidence_refs);
    next.evidence_refs = structuredClone(decision.evidence_refs);
    next.source_record_ids = decision.source_record_ids ?? unique(decision.evidence_refs.map((evidence) => evidence.source_record_id).filter(Boolean));
    next.source_names = decision.source_names ?? unique(decision.evidence_refs.map((evidence) => evidence.source_name).filter(Boolean));
    next.source_versions = decision.source_versions ?? unique(decision.evidence_refs.map((evidence) => evidence.source_version).filter(Boolean));
    if (["approved", "released"].includes(currentStatus)) {
      next.review_status = "in_review";
      next.reviewed_by = null;
      next.reviewed_at = null;
    }
    return next;
  }

  throw transitionError(`unsupported relationship assertion transition: ${transition}`);
}

function assertTransitionRole({ transition, actorRoleKey, stepUpAuthenticated, currentAssertion }) {
  if (transition === "submit" || transition === "update_evidence") {
    assertRole(actorRoleKey, CREATE_ROLES, `${transition} requires relationship curator/editor role`);
    return;
  }
  if (transition === "approve") {
    assertRole(actorRoleKey, new Set([...REVIEWER_ROLES, ...CAUSAL_SAFETY_APPROVER_ROLES]), "approve requires reviewer role");
    if (!stepUpAuthenticated) {
      throw transitionError("approve requires step-up authentication");
    }
    if (isSafetyOrCausalSensitive(currentAssertion) && !CAUSAL_SAFETY_APPROVER_ROLES.has(actorRoleKey)) {
      throw transitionError("safety or causal_sensitive relationship approval requires causal-safety approver role");
    }
    return;
  }
  if (transition === "reject") {
    assertRole(actorRoleKey, new Set([...REVIEWER_ROLES, ...CAUSAL_SAFETY_APPROVER_ROLES]), "reject requires reviewer role");
    return;
  }
  if (transition === "deprecate") {
    assertRole(actorRoleKey, STEWARD_ROLES, "deprecate requires reviewer or steward role");
  }
}

function assertRole(actorRoleKey, allowedRoles, message) {
  if (!allowedRoles.has(actorRoleKey)) {
    throw transitionError(`${message}; received ${actorRoleKey ?? "none"}`);
  }
}

function assertApprovalEligible(assertion) {
  assertEvidenceRequired(assertion);
  if (!Array.isArray(assertion.source_versions) || assertion.source_versions.length === 0) {
    throw transitionError("approval requires valid source_versions");
  }
  if (RELEASE_BLOCKING_LICENSE_STATUSES.has(assertion.data_license?.license_status)) {
    throw transitionError(`approval blocks license_status ${assertion.data_license.license_status}`);
  }
  if (RELEASE_BLOCKING_LICENSE_CLASSES.has(assertion.data_license?.license_classification)) {
    throw transitionError(`approval blocks license_classification ${assertion.data_license.license_classification}`);
  }
  assertBlockedRationale(assertion);
  if (isSafetyOrCausalSensitive(assertion)) {
    if (!assertion.causal_claim_status) {
      throw transitionError("approval requires causal_claim_status for safety or causal_sensitive assertions");
    }
    if (!Array.isArray(assertion.known_limitations) || assertion.known_limitations.length === 0) {
      throw transitionError("approval requires limitation metadata for safety or causal_sensitive assertions");
    }
    if (!Array.isArray(assertion.warnings) || assertion.warnings.length === 0) {
      throw transitionError("approval requires warning metadata for safety or causal_sensitive assertions");
    }
  }
}

function assertBlockedRationale(assertion) {
  if (assertion.relationship_class === "blocked" && !assertion.blocked_rationale) {
    throw transitionError("blocked relationship assertions require blocked_rationale");
  }
}

function isSafetyOrCausalSensitive(assertion) {
  return assertion.relationship_class === "safety" ||
    assertion.secondary_relationship_tags?.includes("causal_sensitive");
}

function transitionError(message, details = {}) {
  return new RelationshipAssertionTransitionError(message, {
    errors: [message],
    ...details
  });
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}

function assertRelationshipGraph({ tenantId, graphName, capability }) {
  assertGraphWritePolicy({
    tenantId,
    graphName,
    capability,
    operation: "relationship assertion write",
    kind: "working"
  });
  const expected = tenantWorkingGraph(tenantId, "relationships");
  if (graphName !== expected) {
    throw new Error(`relationship assertions require dedicated relationship working graph ${expected}; received ${graphName}`);
  }
}

function assertCreateRole(actorRoleKey) {
  if (!CREATE_ROLES.has(actorRoleKey)) {
    throw new Error(`relationship assertion create requires relationship curator/editor role; received ${actorRoleKey ?? "none"}`);
  }
}

function assertCreateState(assertion) {
  if (assertion.review_status === "released" || assertion.release_context?.scope === "release") {
    throw new Error("RelationshipAssertionStore create cannot directly create released assertions");
  }
}

function assertEvidenceRequired(assertion) {
  if (!Array.isArray(assertion.evidence_refs) || assertion.evidence_refs.length === 0) {
    throw new Error("relationship assertions require at least one evidence_ref");
  }
  assertCompleteEvidenceRefs(assertion.evidence_refs);
}

function assertRelationshipScope({ tenantId, assertion }) {
  if (assertion.tenant_id !== tenantId) {
    throw new Error(`relationship assertion tenant mismatch: expected ${tenantId}, received ${assertion.tenant_id}`);
  }
}

function assertLicensePersistable(assertion) {
  if (assertion.review_status === "released") {
    return;
  }
  if (RELEASE_BLOCKING_LICENSE_STATUSES.has(assertion.data_license?.license_status) && assertion.relationship_class !== "blocked") {
    throw new Error(`relationship assertion license_status is not persistable unless blocked: ${assertion.data_license.license_status}`);
  }
}

function normalizeEvidenceRefs(evidenceRefs) {
  assertCompleteEvidenceRefs(evidenceRefs);
  return structuredClone(evidenceRefs);
}

function mergeEvidenceRefs(existingEvidenceRefs, nextEvidenceRefs) {
  assertCompleteEvidenceRefs(existingEvidenceRefs);
  assertCompleteEvidenceRefs(nextEvidenceRefs);
  const byId = new Map();
  for (const evidenceRef of [...existingEvidenceRefs, ...nextEvidenceRefs]) {
    byId.set(evidenceRef.evidence_id, structuredClone(evidenceRef));
  }
  return [...byId.values()];
}

function evidenceLineageDecision(evidenceRefs) {
  return {
    evidence_refs: evidenceRefs,
    source_record_ids: unique(evidenceRefs.map((evidence) => evidence.source_record_id)),
    source_names: unique(evidenceRefs.map((evidence) => evidence.source_name)),
    source_versions: unique(evidenceRefs.map((evidence) => evidence.source_version))
  };
}

function assertCompleteEvidenceRefs(evidenceRefs) {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    throw new Error("relationship assertions require at least one evidence_ref");
  }
  evidenceRefs.forEach((evidenceRef, index) => {
    if (!evidenceRef || typeof evidenceRef !== "object" || Array.isArray(evidenceRef)) {
      throw new Error(`evidence_refs[${index}] must be an object`);
    }
    for (const field of ["evidence_id", "evidence_role", "source_name", "source_version", "source_record_id"]) {
      if (typeof evidenceRef[field] !== "string" || evidenceRef[field].trim().length === 0) {
        throw new Error(`evidence_refs[${index}].${field} is required`);
      }
    }
    if (!Array.isArray(evidenceRef.source_span_ids) || evidenceRef.source_span_ids.length === 0) {
      throw new Error(`evidence_refs[${index}].source_span_ids must include at least one source span id`);
    }
    if (evidenceRef.source_span_ids.some((spanId) => typeof spanId !== "string" || spanId.trim().length === 0)) {
      throw new Error(`evidence_refs[${index}].source_span_ids cannot include empty values`);
    }
  });
}

function buildReleaseAssertionCandidate({
  assertion,
  releaseId,
  releaseCandidateId,
  validationReportIds,
  actor,
  now
}) {
  if (!assertion || typeof assertion !== "object" || Array.isArray(assertion)) {
    throw transitionError("relationship assertion release inclusion requires assertion");
  }
  const reportIds = unique([
    ...arrayOf(validationReportIds),
    ...arrayOf(assertion.validation_report_ids)
  ]);
  const candidate = structuredClone(assertion);
  candidate.review_status = "released";
  candidate.release_context = {
    ...(candidate.release_context ?? {}),
    release_id: releaseId,
    scope: "release",
    included_in_release: true,
    release_candidate_id: releaseCandidateId
  };
  candidate.validation_report_ids = reportIds;
  candidate.updated_at = now;
  candidate.provenance = {
    ...(candidate.provenance ?? {}),
    actor,
    time: now,
    activity: "relationship_assertion.release_inclusion",
    method: "release_inclusion_adapter"
  };
  return candidate;
}

function assertReleaseInclusionEligible(assertion) {
  const errors = [];
  if (assertion.review_status !== "released") {
    errors.push("release inclusion requires review_status=released");
  }
  if (assertion.assertion_type === "model_suggested") {
    errors.push("release inclusion blocks model_suggested relationship assertions");
  }
  if (!assertion.reviewed_by) {
    errors.push("release inclusion requires reviewed_by");
  }
  if (!assertion.reviewed_at) {
    errors.push("release inclusion requires reviewed_at");
  }
  if (!assertion.release_context?.release_id || assertion.release_context.scope !== "release") {
    errors.push("release inclusion requires release scope and release_id");
  }
  if (assertion.release_context?.included_in_release !== true) {
    errors.push("release inclusion requires included_in_release=true");
  }
  if (!Array.isArray(assertion.validation_report_ids) || assertion.validation_report_ids.length === 0) {
    errors.push("release inclusion requires validation_report_ids");
  }
  if (!Array.isArray(assertion.source_versions) || assertion.source_versions.length === 0) {
    errors.push("release inclusion requires source-version lineage");
  }
  if (RELEASE_BLOCKING_LICENSE_STATUSES.has(assertion.data_license?.license_status)) {
    errors.push(`release inclusion blocks license_status ${assertion.data_license.license_status}`);
  }
  if (RELEASE_BLOCKING_LICENSE_CLASSES.has(assertion.data_license?.license_classification)) {
    errors.push(`release inclusion blocks license_classification ${assertion.data_license.license_classification}`);
  }
  if (!assertion.data_license?.license_classification) {
    errors.push("release inclusion requires license classification");
  }
  if (!assertion.data_license?.permitted_uses?.includes("release")) {
    errors.push("release inclusion requires release permitted use");
  }
  if (exportAuthorizationStatusFor(assertion.data_license ?? {}) === "blocked") {
    errors.push("release inclusion blocks export authorization");
  }
  if (errors.length > 0) {
    throw transitionError(`relationship assertion is not release eligible: ${errors.join("; ")}`, { errors });
  }
}

function relationshipReleaseItem({
  tenantId,
  releaseAssertion,
  releaseId,
  releaseCandidateId,
  releaseGraphName,
  auditEvent,
  artifactHash,
  stagedEntry
}) {
  return {
    id: releaseAssertion.relationship_assertion_id,
    object_id: releaseAssertion.relationship_assertion_id,
    object_type: "relationship",
    result_type: "relationship",
    proposal_id: releaseAssertion.relationship_assertion_id,
    proposal_type: "relationship",
    relationship_id: releaseAssertion.relationship_assertion_id,
    relationship_assertion_id: releaseAssertion.relationship_assertion_id,
    assertion_type: "relationship",
    relationship_assertion_type: releaseAssertion.assertion_type,
    tenant_id: tenantId,
    environment: releaseAssertion.environment,
    graph_name: releaseGraphName,
    release_id: releaseId,
    release_candidate_id: releaseCandidateId,
    release_context: structuredClone(releaseAssertion.release_context),
    review_status: releaseAssertion.review_status,
    reviewed_by: releaseAssertion.reviewed_by,
    reviewed_at: releaseAssertion.reviewed_at,
    relationship_class: releaseAssertion.relationship_class,
    predicate: releaseAssertion.predicate,
    source_entity_id: releaseAssertion.source_entity_id,
    target_entity_id: releaseAssertion.target_entity_id,
    directionality: releaseAssertion.directionality,
    polarity: releaseAssertion.polarity,
    evidence_refs: structuredClone(releaseAssertion.evidence_refs),
    source_record_ids: [...releaseAssertion.source_record_ids],
    source_names: [...releaseAssertion.source_names],
    source_versions: [...releaseAssertion.source_versions],
    source_version: releaseAssertion.source_versions[0],
    source_vocabulary_version: releaseAssertion.source_versions[0],
    target_vocabulary_version: releaseAssertion.source_versions.at(-1) ?? releaseAssertion.source_versions[0],
    validation_report_ids: [...releaseAssertion.validation_report_ids],
    validation_report_id: stagedEntry.validation_report_id,
    provenance_id: releaseAssertion.provenance_id,
    artifact_hash: artifactHash,
    payload_hash: artifactHash,
    license_status: releaseAssertion.data_license.license_status,
    license_classification: releaseAssertion.data_license.license_classification,
    license_policy_id: releaseAssertion.data_license.license_policy_id ?? "not_required",
    permitted_uses: [...releaseAssertion.data_license.permitted_uses],
    export_restrictions: [...(releaseAssertion.data_license.export_restrictions ?? [])],
    export_authorization_status: exportAuthorizationStatusFor(releaseAssertion.data_license),
    audit_event_ids: unique([releaseAssertion.provenance?.audit_event_id, auditEvent.audit_event_id])
  };
}

function assertReleaseGraphTenant({ tenantId, graphName, releaseId, capability }) {
  assertGraphWritePolicy({
    tenantId,
    graphName,
    capability,
    operation: "relationship release inclusion",
    kind: "release"
  });
  assertGraphTenant(graphName, tenantId);
  const expectedPrefix = `graph:tenant:${tenantId}:release:${releaseId}:`;
  if (!graphName.startsWith(expectedPrefix)) {
    throw transitionError(`relationship release inclusion requires release graph under ${expectedPrefix}; received ${graphName}`);
  }
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw transitionError(`relationship assertion release inclusion requires ${fieldName}`);
  }
}

function lifecycleStatusFor(assertion) {
  if (assertion.review_status === "released") return "released";
  if (assertion.review_status === "approved") return "approved";
  if (assertion.review_status === "deprecated") return "deprecated";
  if (assertion.review_status === "rejected") return "rejected";
  if (assertion.assertion_type === "model_suggested") return "draft";
  return "draft";
}

function releaseStatusFor(assertion) {
  if (assertion.release_context?.scope === "release") return "released";
  if (assertion.release_context?.scope === "release_candidate") return "release_candidate";
  return "not_released";
}

function evidenceStrengthFor(assertion) {
  return assertion.evidence_strength ??
    CONFIDENCE_TO_EVIDENCE_STRENGTH[assertion.confidence?.confidence_band] ??
    "insufficient";
}

function exportAuthorizationStatusFor(dataLicense) {
  if (dataLicense.license_status === "blocked") return "blocked";
  if (dataLicense.export_restrictions?.includes("contains_phi_or_pii")) return "blocked";
  if ((dataLicense.export_restrictions ?? []).length > 0) return "redacted";
  return "authorized";
}

function usesRestrictedEvidenceFor(assertion) {
  return Boolean(
    assertion.secondary_relationship_tags?.includes("restricted_evidence") ||
    assertion.warnings?.includes("contains_restricted_evidence") ||
    ["restricted", "licensed"].includes(assertion.data_license?.license_status) ||
    ["licensed", "internal_confidential", "phi_pii"].includes(assertion.data_license?.data_sensitivity)
  );
}

function requireEnum(value, allowed, fieldName, errors) {
  if (!allowed || !allowed.includes(value)) {
    errors.push(`Invalid ${fieldName}: ${value}`);
  }
}

function requireArray(value, fieldName, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${fieldName} must include at least one value.`);
  }
}

function predicateEnumForClass(relationshipClass, defs) {
  const key = {
    identity: "identityPredicate",
    vocabulary_crosswalk: "vocabularyCrosswalkPredicate",
    hierarchical: "hierarchicalPredicate",
    mechanistic: "mechanisticPredicate",
    clinical: "clinicalPredicate",
    safety: "safetyPredicate",
    regulatory: "regulatoryPredicate",
    commercial: "commercialPredicate",
    operational: "operationalPredicate",
    evidence_support: "evidenceSupportPredicate",
    inferred: "inferredPredicate",
    hypothesis: "hypothesisPredicate",
    blocked: "blockedPredicate"
  }[relationshipClass];
  return defs[key]?.enum ?? defs.relationshipPredicate?.enum;
}

function relationshipIri(tenantId, value) {
  return `${TENANT_BASE}${encodeURIComponent(tenantId)}/relationship/${encodeURIComponent(stripPrefix(value))}`;
}

function entityIri(tenantId, value) {
  if (String(value).startsWith("http://") || String(value).startsWith("https://")) return String(value);
  return `${TENANT_BASE}${encodeURIComponent(tenantId)}/entity/${encodeURIComponent(stripPrefix(value))}`;
}

function evidenceIri(tenantId, value) {
  if (String(value).startsWith("http://") || String(value).startsWith("https://")) return String(value);
  return `${TENANT_BASE}${encodeURIComponent(tenantId)}/evidence/${encodeURIComponent(stripPrefix(value))}`;
}

function warningIri(tenantId, value) {
  if (String(value).startsWith("http://") || String(value).startsWith("https://")) return String(value);
  return `${TENANT_BASE}${encodeURIComponent(tenantId)}/warning/${encodeURIComponent(stripPrefix(value))}`;
}

function relationshipPredicateIri(value) {
  const text = String(value);
  if (text.startsWith("http://") || text.startsWith("https://")) return text;
  return `${REL}${encodeURIComponent(stripPrefix(text))}`;
}

function stripPrefix(value) {
  return String(value).replace(/^[^:]+:/, "");
}

function normalizeEntityId(value) {
  return stripPrefix(decodeURIComponent(localName(value)));
}

function entityIdFromIri(value) {
  return value ? decodeURIComponent(localName(value)) : null;
}

function evidenceIdFromIri(value) {
  return value ? `pharmev:${decodeURIComponent(localName(value))}` : null;
}

function literal(store, subject, localPredicate) {
  return store.getQuads(subject, `${CORE}${localPredicate}`, null, null)[0]?.object.value ?? null;
}

function literals(store, subject, localPredicate) {
  return store.getQuads(subject, `${CORE}${localPredicate}`, null, null).map((quad) => quad.object.value);
}

function iri(store, subject, localPredicate) {
  return store.getQuads(subject, `${CORE}${localPredicate}`, null, null)[0]?.object.value ?? null;
}

function iris(store, subject, localPredicate) {
  return store.getQuads(subject, `${CORE}${localPredicate}`, null, null).map((quad) => quad.object.value);
}

function provenanceLiteral(store, subject, localPredicate) {
  return provenanceLiterals(store, subject, localPredicate)[0] ?? null;
}

function provenanceLiterals(store, subject, localPredicate) {
  return store
    .getQuads(subject, `${CORE}hasProvenance`, null, null)
    .flatMap((quad) => store.getQuads(quad.object, `${CORE}${localPredicate}`, null, null))
    .map((quad) => quad.object.value);
}

function optionalLiteralLine(predicate, value) {
  return value === null || value === undefined || value === "" ? "" : `
    ${predicate} "${escapeLiteral(value)}" ;`;
}

function optionalDateLine(predicate, value) {
  return value === null || value === undefined || value === "" ? "" : `    ${predicate} "${escapeLiteral(value)}"^^xsd:dateTime ;`;
}

function arrayLiteralLines(predicate, values = []) {
  return arrayOf(values).map((value) => `    ${predicate} "${escapeLiteral(value)}" ;`).join("\n");
}

function arrayIriLines(predicate, values = [], toIri) {
  return arrayOf(values).map((value) => `    ${predicate} <${toIri(value)}> ;`).join("\n");
}

function arrayOf(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined && item !== "") : [];
}

function localName(value) {
  const text = String(value ?? "");
  return text.split(/[\/#]/).pop() ?? text;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function artifactHash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortKeys(value))).digest("hex")}`;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

function escapeLiteral(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function defaultIdFactory() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
