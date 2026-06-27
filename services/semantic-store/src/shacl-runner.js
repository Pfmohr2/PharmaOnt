import { readFileSync } from "node:fs";
import { Parser, Store } from "n3";

const RDF_TYPE_IRI = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const knownNamespaces = new Map([
  ["pharm", "https://w3id.org/pharmaops/ontology/core#"],
  ["pharmrel", "https://w3id.org/pharmaops/ontology/relationship#"],
  ["pharment", "https://example.pharmaops.local/tenant/acme/entity/"],
  ["pharmrelobj", "https://example.pharmaops.local/tenant/acme/relationship/"],
  ["pharmpath", "https://example.pharmaops.local/tenant/acme/path/"],
  ["pharmwarn", "https://example.pharmaops.local/tenant/acme/warning/"],
  ["pharmev", "https://example.pharmaops.local/tenant/acme/evidence/"],
  ["pharmmap", "https://example.pharmaops.local/tenant/acme/mapping/"],
  ["pharmprov", "https://example.pharmaops.local/tenant/acme/provenance/"]
]);

const governedTypes = [
  "pharm:Compound",
  "pharm:Protein",
  "pharm:Target",
  "pharm:Gene",
  "pharm:DiseaseCondition",
  "pharm:Trial",
  "pharm:ProductDrug",
  "pharm:AdverseEvent",
  "pharm:DocumentEvidenceSource",
  "pharm:VocabularyTerm",
  "pharm:MappingAssertion",
  "pharm:RelationshipAssertion",
  "pharm:RelationshipPath",
  "pharm:BridgeHypothesis",
  "pharm:PathQuery",
  "pharm:PathEvaluation",
  "pharm:WeakLinkAssessment",
  "pharm:RelationshipEvidence",
  "pharm:DomainBoundaryCrossing",
  "pharm:SafetyLimitation",
  "pharm:RelationshipWarning",
  "pharm:ReleaseArtifact",
  "pharm:Biomarker",
  "pharm:Endpoint",
  "pharm:OrganizationSponsor"
];

const relationshipClasses = new Set([
  "identity",
  "vocabulary_crosswalk",
  "hierarchical",
  "mechanistic",
  "clinical",
  "safety",
  "regulatory",
  "commercial",
  "operational",
  "evidence_support",
  "inferred",
  "hypothesis",
  "blocked"
]);

const assertionTypes = new Set(["asserted", "imported", "human_curated", "inferred", "model_suggested", "system_generated", "deprecated"]);
const confidenceBands = new Set(["high", "medium", "low", "blocked"]);
const evidenceStrengths = new Set(["strong", "moderate", "weak", "insufficient", "blocked"]);
const reviewStatuses = new Set(["draft", "proposed", "in_review", "approved", "rejected", "released", "deprecated", "superseded", "blocked"]);
const pathStatuses = new Set(["draft", "proposed", "in_review", "approved", "released", "blocked"]);
const booleanLiterals = new Set(["true", "false"]);
const exportAuthorizationStatuses = new Set(["authorized", "redacted", "blocked"]);
const clearedCausalClaimStatuses = new Set(["not_causal", "causal_review_approved"]);
const causalClaimStatuses = new Set([
  "not_causal",
  "causal_review_required",
  "causal_review_approved",
  "causal_prohibited",
  "blocked_overclaim"
]);
const licenseClasses = new Set([
  "open_materializable",
  "open_with_attribution",
  "licensed_federated",
  "licensed_materializable_with_restrictions",
  "internal_confidential",
  "contains_phi_or_pii",
  "blocked_pending_legal_review"
]);
const releaseBlockingLicenseClasses = new Set(["blocked_pending_legal_review"]);
const blockedExportAuthorizationStatuses = new Set(["blocked"]);
const relationshipAssertionLiteralGovernancePredicates = [
  "pharm:canonicalId",
  "pharm:entityType",
  "pharm:preferredLabel",
  "pharm:lifecycleStatus",
  "pharm:assertionType",
  "pharm:hasAssertionType",
  "pharm:hasRelationshipClass",
  "pharm:relationshipDirectionality",
  "pharm:relationshipPolarity",
  "pharm:confidenceScore",
  "pharm:confidenceBand",
  "pharm:hasEvidenceStrength",
  "pharm:reviewStatus",
  "pharm:reviewedBy",
  "pharm:reviewedAt",
  "pharm:dataLicenseClass",
  "pharm:releaseId",
  "pharm:validationReportId",
  "pharm:createdBy",
  "pharm:createdAt",
  "pharm:updatedAt",
  "pharm:hasCausalClaimStatus",
  "pharm:usesRestrictedEvidence",
  "pharm:exportAuthorizationStatus",
  "pharm:releaseMembership",
  "pharm:safetyLimitationId",
  "pharm:knownLimitation",
  "pharm:modelName",
  "pharm:modelVersion",
  "pharm:modelRationale",
  "pharm:blockedRationale",
  "pharm:hasRedactionPolicy"
];
const relationshipPathLiteralGovernancePredicates = [
  "pharm:canonicalId",
  "pharm:entityType",
  "pharm:preferredLabel",
  "pharm:lifecycleStatus",
  "pharm:releaseMembership",
  "pharm:hasPathConfidence",
  "pharm:pathConfidenceBand",
  "pharm:pathStatus",
  "pharm:releaseId",
  "pharm:validationReportId",
  "pharm:usesRestrictedEvidence",
  "pharm:pathContainsBlockedEdge",
  "pharm:pathContainsUnreviewedModelSuggestedEdge",
  "pharm:exportAuthorizationStatus",
  "pharm:blockedRationale",
  "pharm:hasRedactionPolicy"
];
const mappingAssertionLiteralGovernancePredicates = [
  "pharm:canonicalId",
  "pharm:entityType",
  "pharm:preferredLabel",
  "pharm:lifecycleStatus",
  "pharm:releaseMembership",
  "pharm:mappingPredicate",
  "pharm:sourceVocabulary",
  "pharm:sourceVocabularyVersion",
  "pharm:targetVocabulary",
  "pharm:targetVocabularyVersion",
  "pharm:confidenceScore",
  "pharm:reviewStatus"
];
const relationshipAssertionIriGovernancePredicates = [
  "pharm:relationshipSubject",
  "pharm:relationshipPredicate",
  "pharm:relationshipObject",
  "pharm:hasEvidence",
  "pharm:hasRelationshipWarning"
];
const relationshipPathIriGovernancePredicates = [
  "pharm:relationshipPathStart",
  "pharm:relationshipPathEnd",
  "pharm:relationshipPathEdge",
  "pharm:hasWeakestLink",
  "pharm:hasRelationshipWarning"
];
const mappingAssertionIriGovernancePredicates = [
  "pharm:sourceEntity",
  "pharm:targetEntity",
  "pharm:hasEvidence"
];
const allowedPredicatesByRelationshipClass = new Map([
  ["identity", ["same_as", "has_synonym", "has_external_identifier", "identity_replaced_by", "exactMatch"]],
  ["vocabulary_crosswalk", ["exactMatch", "closeMatch", "broadMatch", "narrowMatch", "relatedMatch", "replacedBy", "hasDbXref", "notMatch", "uncertainMatch", "requiresReview", "term_maps_to_standard", "regulatory_crosswalk_to"]],
  ["hierarchical", ["broader_than", "narrower_than", "parent_of", "child_of", "part_of", "has_part", "subclass_of"]],
  ["mechanistic", ["compound_has_target", "target_associated_with_disease", "mechanistically_related_to", "inhibits", "activates", "binds_target", "modulates_pathway"]],
  ["clinical", ["trial_studies_condition", "trial_uses_intervention", "trial_has_endpoint", "clinically_related_to", "associated_with_outcome", "biomarker_stratifies_response"]],
  ["safety", ["product_has_adverse_event", "safety_context_related_to", "has_reported_event_context", "label_mentions_safety_event", "safety_signal_for_investigation"]],
  ["regulatory", ["regulatory_crosswalk_to", "uses_submission_term", "label_contains_concept", "submission_codelist_maps_to", "controlled_term_for_context"]],
  ["commercial", ["commercially_related_to", "product_aligned_to_indication", "market_segment_for_population", "payer_concept_related_to"]],
  ["operational", ["operational_dependency_of", "dataset_feeds_dashboard", "api_consumer_uses_term", "workflow_depends_on_source", "downstream_uses_mapping"]],
  ["evidence_support", ["entity_supported_by_evidence", "assertion_supported_by_evidence", "evidence_supports_relationship", "evidence_contradicts_relationship", "evidence_context_for_relationship"]],
  ["inferred", ["inferred_from_path", "inferred_mechanistic_bridge", "inferred_clinical_bridge", "inferred_safety_context"]],
  ["hypothesis", ["hypothesis_bridge", "is_hypothesis_about", "may_relate_to_investigation", "accepted_for_investigation", "convertedToRelationshipAssertion"]],
  ["blocked", ["unsupported", "blocked", "notMatch", "contradicted_by_evidence", "license_blocked", "causal_claim_blocked", "access_blocked"]]
].map(([relationshipClass, predicates]) => [relationshipClass, new Set(predicates)]));

export class ShaclRunner {
  constructor({
    shapesPath = new URL("../../../ontologies/shapes/pharmaops-shapes.ttl", import.meta.url)
  } = {}) {
    this.shapesPath = shapesPath;
    this.shapesText = readFileSync(shapesPath, "utf8");
    assertPhase1ShapesPresent(this.shapesText);
  }

  validateTurtle(turtle, { fixtureName = "inline.ttl" } = {}) {
    return validateSemanticTurtle(turtle, fixtureName);
  }
}

export function validateSemanticTurtle(turtle, fixtureName = "inline.ttl") {
  const errors = [];
  let subjects;
  try {
    subjects = parseSubjectBlocks(turtle);
  } catch (error) {
    return {
      valid: false,
      errors: [`${fixtureName}: Turtle parse failed: ${error.message}`]
    };
  }
  const subjectsById = new Map();
  for (const subject of subjects) {
    for (const alias of subject.aliases ?? [subject.id]) {
      subjectsById.set(alias, subject);
    }
  }

  for (const subject of subjects) {
    if (!subject.types.some((type) => governedTypes.includes(type))) {
      continue;
    }

    requirePredicate(subject, "pharm:canonicalId", errors);
    requirePredicate(subject, "pharm:entityType", errors);
    requirePredicate(subject, "pharm:preferredLabel", errors);
    requirePredicate(subject, "pharm:lifecycleStatus", errors);
    requirePredicate(subject, "pharm:releaseMembership", errors);
    requirePredicate(subject, "pharm:hasProvenance", errors);

    if (subject.types.includes("pharm:MappingAssertion")) {
      requireLiteralGovernanceValues(subject, mappingAssertionLiteralGovernancePredicates, errors);
      requireIriGovernanceValues(subject, mappingAssertionIriGovernancePredicates, errors);
      for (const predicate of [
        "pharm:sourceEntity",
        "pharm:targetEntity",
        "pharm:mappingPredicate",
        "pharm:sourceVocabulary",
        "pharm:sourceVocabularyVersion",
        "pharm:targetVocabulary",
        "pharm:targetVocabularyVersion",
        "pharm:confidenceScore",
        "pharm:hasEvidence",
        "pharm:reviewStatus"
      ]) {
        requirePredicate(subject, predicate, errors);
      }
      requireReleaseEligibleMappingState(subject, errors);
    }

    if (subject.types.includes("pharm:RelationshipAssertion")) {
      requireLiteralGovernanceValues(subject, relationshipAssertionLiteralGovernancePredicates, errors);
      requireIriGovernanceValues(subject, relationshipAssertionIriGovernancePredicates, errors);
      for (const predicate of [
        "pharm:relationshipSubject",
        "pharm:relationshipPredicate",
        "pharm:relationshipObject",
        "pharm:hasRelationshipClass",
        "pharm:assertionType",
        "pharm:hasAssertionType",
        "pharm:relationshipDirectionality",
        "pharm:relationshipPolarity",
        "pharm:confidenceScore",
        "pharm:confidenceBand",
        "pharm:hasEvidenceStrength",
        "pharm:hasEvidence",
        "pharm:reviewStatus",
        "pharm:dataLicenseClass",
        "pharm:releaseId",
        "pharm:createdBy",
        "pharm:createdAt",
        "pharm:updatedAt"
      ]) {
        requirePredicate(subject, predicate, errors);
      }
      requireValueInSet(subject, "pharm:hasRelationshipClass", relationshipClasses, errors);
      requireValueInSet(subject, "pharm:assertionType", assertionTypes, errors);
      requireValueInSet(subject, "pharm:hasAssertionType", assertionTypes, errors);
      requireValueInSet(subject, "pharm:confidenceBand", confidenceBands, errors);
      requireValueInSet(subject, "pharm:hasEvidenceStrength", evidenceStrengths, errors);
      requireValueInSet(subject, "pharm:reviewStatus", reviewStatuses, errors);
      requireValueInSet(subject, "pharm:dataLicenseClass", licenseClasses, errors);
      requireValueInSet(subject, "pharm:hasCausalClaimStatus", causalClaimStatuses, errors);
      requireValueInSet(subject, "pharm:exportAuthorizationStatus", exportAuthorizationStatuses, errors);
      requireSingleGovernanceValue(subject, "pharm:hasRelationshipClass", errors);
      requireSingleGovernanceValue(subject, "pharm:relationshipPredicate", errors);
      requireSingleGovernanceValue(subject, "pharm:assertionType", errors);
      requireSingleGovernanceValue(subject, "pharm:hasAssertionType", errors);
      requireSingleGovernanceValue(subject, "pharm:confidenceBand", errors);
      requireSingleGovernanceValue(subject, "pharm:hasEvidenceStrength", errors);
      requireSingleGovernanceValue(subject, "pharm:reviewStatus", errors);
      requireSingleGovernanceValue(subject, "pharm:dataLicenseClass", errors);
      requireSingleGovernanceValue(subject, "pharm:hasCausalClaimStatus", errors);
      requireSingleGovernanceValue(subject, "pharm:exportAuthorizationStatus", errors);
      requireReviewedReleaseState(subject, errors);
      requireIdentityMappingSeparation(subject, errors);
      requireRelationshipPredicateMatrix(subject, errors);
      requireSafetyLimitations(subject, errors);
      requireCausalReview(subject, errors);
      requireBlockedRationale(subject, errors);
      requireRestrictedEvidenceMetadata(subject, errors);
    }

    if (subject.types.includes("pharm:RelationshipPath")) {
      requireLiteralGovernanceValues(subject, relationshipPathLiteralGovernancePredicates, errors);
      requireIriGovernanceValues(subject, relationshipPathIriGovernancePredicates, errors);
      for (const predicate of [
        "pharm:relationshipPathStart",
        "pharm:relationshipPathEnd",
        "pharm:relationshipPathEdge",
        "pharm:hasPathConfidence",
        "pharm:pathConfidenceBand",
        "pharm:hasWeakestLink",
        "pharm:pathStatus",
        "pharm:releaseId",
        "pharm:usesRestrictedEvidence"
      ]) {
        requirePredicate(subject, predicate, errors);
      }
      requireValueInSet(subject, "pharm:pathConfidenceBand", confidenceBands, errors);
      requireValueInSet(subject, "pharm:pathStatus", pathStatuses, errors);
      requireValueInSet(subject, "pharm:usesRestrictedEvidence", booleanLiterals, errors);
      requireValueInSet(subject, "pharm:exportAuthorizationStatus", exportAuthorizationStatuses, errors);
      requireSingleGovernanceValue(subject, "pharm:hasPathConfidence", errors);
      requireSingleGovernanceValue(subject, "pharm:pathConfidenceBand", errors);
      requireSingleGovernanceValue(subject, "pharm:pathStatus", errors);
      requireSingleGovernanceValue(subject, "pharm:releaseId", errors);
      requireSingleGovernanceValue(subject, "pharm:usesRestrictedEvidence", errors);
      requireSingleGovernanceValue(subject, "pharm:exportAuthorizationStatus", errors);
      requirePathConfidenceRules(subject, errors);
      requireReleasedPathRules(subject, errors, subjectsById);
      requireBlockedRationale(subject, errors);
      requireRestrictedEvidenceMetadata(subject, errors);
    }

    if (subject.types.includes("pharm:BridgeHypothesis")) {
      for (const predicate of [
        "pharm:isHypothesisAbout",
        "pharm:hasRelationshipWarning",
        "pharm:reviewStatus"
      ]) {
        requirePredicate(subject, predicate, errors);
      }
    }

    if (isModelSuggested(subject)) {
      if (hasObjectValue(subject, "pharm:lifecycleStatus", "approved") ||
          hasObjectValue(subject, "pharm:lifecycleStatus", "staged") ||
          hasObjectValue(subject, "pharm:lifecycleStatus", "released")) {
        errors.push(`${subject.id} model_suggested cannot be approved/staged/released`);
      }
      const releaseMembership = getLiteralValue(subject, "pharm:releaseMembership");
      if (/^graph:tenant:.+:release:.+/.test(releaseMembership ?? "")) {
        errors.push(`${subject.id} model_suggested cannot be release-membered`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.map((error) => `${fixtureName}: ${error}`)
  };
}

function assertPhase1ShapesPresent(shapes) {
  for (const shapeName of [
    "pharm:EntityRequiredLabelShape",
    "pharm:EntityTypeRequiredShape",
    "pharm:IdentifierFormatShape",
    "pharm:SourceProvenanceShape",
    "pharm:MappingCompletenessShape",
    "pharm:RelationshipCompletenessShape",
    "pharm:ModelSuggestedPublicationBlockerShape",
    "pharm:RelationshipClassValidityShape",
    "pharm:EvidenceRequirementsByRelationshipClassShape",
    "pharm:IdentityMappingSeparationShape",
    "pharm:RelationshipPredicateClassMatrixShape",
    "pharm:SafetyLimitationRequirementsShape",
    "pharm:CausalClaimRestrictionsShape",
    "pharm:ReviewStateRestrictionsShape",
    "pharm:ReleasedRelationshipRequirementsShape",
    "pharm:ReleasedRelationshipLicenseReviewerShape",
    "pharm:PathConfidenceConstraintsShape",
    "pharm:ReleasedPathEdgeDerivedRequirementsShape",
    "pharm:WeakestLinkRequirementsShape",
    "pharm:RestrictedEvidenceAccessMetadataShape",
    "pharm:HypothesisLabelingShape",
    "pharm:ReleasedPathRequirementsShape",
    "pharm:BlockedRelationshipRationaleShape"
  ]) {
    if (!shapes.includes(shapeName)) {
      throw new Error(`missing Phase 1 SHACL shape ${shapeName}`);
    }
  }
}

function parseSubjectBlocks(ttl) {
  const store = new Store(new Parser().parse(ttl));

  return store.getSubjects(null, null, null)
    .map((subjectTerm) => {
      const predicates = new Map();
      const predicateTerms = new Map();
      const aliases = subjectAliases(subjectTerm);

      for (const quad of store.getQuads(subjectTerm, null, null, null)) {
        const predicate = compactKnownIri(quad.predicate.value);
        const values = predicates.get(predicate) ?? [];
        values.push(termToRuleValue(quad.object));
        predicates.set(predicate, values);
        const terms = predicateTerms.get(predicate) ?? [];
        terms.push(termToRuleTerm(quad.object));
        predicateTerms.set(predicate, terms);
      }

      return {
        id: [...aliases][0],
        canonicalId: canonicalSubjectId(subjectTerm),
        aliases: [...aliases],
        predicates,
        predicateTerms,
        types: (predicates.get("rdf:type") ?? []).filter(Boolean)
      };
    });
}

function subjectAliases(term) {
  const aliases = new Set([canonicalSubjectId(term)]);
  if (term.termType === "NamedNode") {
    aliases.add(compactKnownIri(term.value));
    aliases.add(`<${term.value}>`);
  }
  return aliases;
}

function canonicalSubjectId(term) {
  return term.termType === "NamedNode" ? term.value : term.id;
}

function termToRuleValue(term) {
  if (term.termType === "Literal") {
    return `"${term.value}"`;
  }
  if (term.termType === "NamedNode") {
    return compactKnownIri(term.value);
  }
  return term.id ?? term.value;
}

function termToRuleTerm(term) {
  return {
    value: termToRuleValue(term),
    termType: term.termType
  };
}

function compactKnownIri(iri) {
  if (iri === RDF_TYPE_IRI) {
    return "rdf:type";
  }

  for (const [prefix, namespace] of knownNamespaces) {
    if (iri.startsWith(namespace)) {
      return `${prefix}:${iri.slice(namespace.length)}`;
    }
  }

  return iri;
}

function requirePredicate(subject, predicate, errors) {
  if (!hasPredicate(subject, predicate)) {
    errors.push(`${subject.id} requires ${predicate}`);
  }
}

function hasPredicate(subject, predicate) {
  return (subject.predicates.get(predicate) ?? []).length > 0;
}

function requireValueInSet(subject, predicate, allowedValues, errors) {
  for (const value of getLiteralValues(subject, predicate)) {
    if (!allowedValues.has(value)) {
      errors.push(`${subject.id} ${predicate} has unapproved value ${value}`);
    }
  }
}

function requireLiteralGovernanceValues(subject, predicates, errors) {
  for (const predicate of predicates) {
    for (const term of getObjectTerms(subject, predicate)) {
      if (term.termType !== "Literal") {
        errors.push(`${subject.id} ${predicate} requires literal object but found ${term.termType}`);
      }
    }
  }
}

function requireIriGovernanceValues(subject, predicates, errors) {
  for (const predicate of predicates) {
    for (const term of getObjectTerms(subject, predicate)) {
      if (term.termType !== "NamedNode") {
        errors.push(`${subject.id} ${predicate} requires IRI object but found ${term.termType}`);
      }
    }
  }
}

function hasObjectValue(subject, predicate, expectedValue) {
  return getObjectValues(subject, predicate).some((value) => normalizeObjectValue(value) === String(expectedValue));
}

function requireReleaseEligibleMappingState(subject, errors) {
  const releaseMembership = getLiteralValue(subject, "pharm:releaseMembership");
  if (!releaseMembership?.includes(":release:")) {
    return;
  }

  const lifecycleStatus = getLiteralValue(subject, "pharm:lifecycleStatus");
  if (!["approved", "staged", "released"].includes(lifecycleStatus)) {
    errors.push(`${subject.id} release graph requires lifecycleStatus approved, staged, or released`);
  }

  const reviewStatus = getLiteralValue(subject, "pharm:reviewStatus");
  if (!["approved", "released"].includes(reviewStatus)) {
    errors.push(`${subject.id} release graph requires reviewStatus approved or released`);
  }
}

function requireReviewedReleaseState(subject, errors) {
  const lifecycleStatusValues = getLiteralValues(subject, "pharm:lifecycleStatus");
  if (!lifecycleStatusValues.some((lifecycleStatus) => ["approved", "staged", "released"].includes(lifecycleStatus))) {
    return;
  }
  const reviewStatusValues = getLiteralValues(subject, "pharm:reviewStatus");
  if (!reviewStatusValues.some((reviewStatus) => ["approved", "released"].includes(reviewStatus))) {
    errors.push(`${subject.id} approved/staged/released relationship requires reviewStatus approved or released`);
  }
  requireNonEmptyLiteral(subject, "pharm:reviewedBy", errors);
  requireNonNullLiteral(subject, "pharm:reviewedAt", errors);

  if (lifecycleStatusValues.includes("released")) {
    if (getLiteralValues(subject, "pharm:releaseId").includes("not_released")) {
      errors.push(`${subject.id} released relationship requires releaseId other than not_released`);
    }
    requirePredicate(subject, "pharm:validationReportId", errors);
    for (const licenseClass of getLiteralValues(subject, "pharm:dataLicenseClass")) {
      if (releaseBlockingLicenseClasses.has(licenseClass)) {
        errors.push(`${subject.id} released relationship cannot use release-blocking license ${licenseClass}`);
      }
    }
    for (const exportAuthorizationStatus of getLiteralValues(subject, "pharm:exportAuthorizationStatus")) {
      if (blockedExportAuthorizationStatuses.has(exportAuthorizationStatus)) {
        errors.push(`${subject.id} released relationship cannot have blocked export authorization`);
      }
    }
  }
}

function requireIdentityMappingSeparation(subject, errors) {
  if (hasPredicate(subject, "pharm:mappingPredicate")) {
    errors.push(`${subject.id} RelationshipAssertion cannot use pharm:mappingPredicate`);
  }
}

function requireRelationshipPredicateMatrix(subject, errors) {
  const relationshipClasses = getLiteralValues(subject, "pharm:hasRelationshipClass");
  const relationshipPredicates = getTermValues(subject, "pharm:relationshipPredicate").map(normalizePredicateValue).filter(Boolean);
  if (relationshipClasses.length > 0 && hasPredicate(subject, "pharm:relationshipPredicate") && relationshipPredicates.length === 0) {
    errors.push(`${subject.id} pharm:relationshipPredicate requires IRI object for relationship predicate matrix`);
    return;
  }
  if (relationshipClasses.length === 0 || relationshipPredicates.length === 0) {
    return;
  }

  for (const relationshipClass of relationshipClasses) {
    const allowedPredicates = allowedPredicatesByRelationshipClass.get(relationshipClass);
    for (const relationshipPredicate of relationshipPredicates) {
      if (allowedPredicates && !allowedPredicates.has(relationshipPredicate)) {
        errors.push(`${subject.id} relationship_class ${relationshipClass} cannot use predicate ${relationshipPredicate}`);
      }
    }
  }
}

function requireSafetyLimitations(subject, errors) {
  if (!hasObjectValue(subject, "pharm:hasRelationshipClass", "safety")) {
    return;
  }
  requirePredicate(subject, "pharm:safetyLimitationId", errors);
  requirePredicate(subject, "pharm:knownLimitation", errors);
  requirePredicate(subject, "pharm:hasCausalClaimStatus", errors);
}

function requireCausalReview(subject, errors) {
  const causalClaimStatusValues = getLiteralValues(subject, "pharm:hasCausalClaimStatus")
    .filter((causalClaimStatus) => causalClaimStatuses.has(causalClaimStatus));
  if (causalClaimStatusValues.length === 0) {
    return;
  }
  for (const causalClaimStatus of causalClaimStatusValues) {
    if (hasReleaseEligibleState(subject) && !clearedCausalClaimStatuses.has(causalClaimStatus)) {
      errors.push(`${subject.id} causal_claim_status ${causalClaimStatus} blocks release until not_causal or causal_review_approved`);
    }
    if (causalClaimStatus === "causal_review_approved") {
      requireNonEmptyLiteral(subject, "pharm:reviewedBy", errors);
      requireNonNullLiteral(subject, "pharm:reviewedAt", errors);
      const reviewStatusValues = getLiteralValues(subject, "pharm:reviewStatus");
      if (!reviewStatusValues.some((reviewStatus) => ["approved", "released"].includes(reviewStatus))) {
        errors.push(`${subject.id} causal_review_approved requires reviewStatus approved or released`);
      }
    }
  }
}

function requireBlockedRationale(subject, errors) {
  const blocked = hasObjectValue(subject, "pharm:hasRelationshipClass", "blocked") ||
    hasObjectValue(subject, "pharm:confidenceBand", "blocked") ||
    hasObjectValue(subject, "pharm:pathConfidenceBand", "blocked") ||
    hasObjectValue(subject, "pharm:pathContainsBlockedEdge", "true");
  if (!blocked) {
    return;
  }
  requirePredicate(subject, "pharm:blockedRationale", errors);
  requirePredicate(subject, "pharm:hasRelationshipWarning", errors);
}

function requireRestrictedEvidenceMetadata(subject, errors) {
  if (!hasObjectValue(subject, "pharm:usesRestrictedEvidence", "true")) {
    return;
  }
  requirePredicate(subject, "pharm:hasRedactionPolicy", errors);
  requirePredicate(subject, "pharm:exportAuthorizationStatus", errors);
}

function requirePathConfidenceRules(subject, errors) {
  if (hasObjectValue(subject, "pharm:pathContainsUnreviewedModelSuggestedEdge", "true") &&
      hasObjectValue(subject, "pharm:pathConfidenceBand", "high")) {
    errors.push(`${subject.id} high confidence path cannot include unreviewed model_suggested edge`);
  }
}

function requireReleasedPathRules(subject, errors, subjectsById) {
  const edges = getTermValues(subject, "pharm:relationshipPathEdge")
    .map((edgeId) => subjectsById.get(edgeId))
    .filter(Boolean);

  if (hasObjectValue(subject, "pharm:pathConfidenceBand", "high")) {
    for (const edge of edges) {
      if (isModelSuggested(edge)) {
        errors.push(`${subject.id} high confidence path cannot include model_suggested edge ${edge.id}`);
      }
      if (!["approved", "released"].includes(getLiteralValue(edge, "pharm:reviewStatus"))) {
        errors.push(`${subject.id} high confidence path requires approved or released edge ${edge.id}`);
      }
      if (!hasObjectValue(edge, "pharm:confidenceBand", "high")) {
        errors.push(`${subject.id} high confidence path requires high-confidence edge ${edge.id}`);
      }
    }
  }

  if (hasObjectValue(subject, "pharm:pathConfidenceBand", "medium")) {
    for (const edge of edges) {
      if (hasObjectValue(edge, "pharm:confidenceBand", "low") || hasObjectValue(edge, "pharm:confidenceBand", "blocked")) {
        errors.push(`${subject.id} medium confidence path cannot include low or blocked edge ${edge.id}`);
      }
    }
  }

  if (!hasObjectValue(subject, "pharm:pathStatus", "released")) {
    return;
  }
  if (getLiteralValues(subject, "pharm:releaseId").includes("not_released")) {
    errors.push(`${subject.id} released path requires releaseId other than not_released`);
  }
  requirePredicate(subject, "pharm:validationReportId", errors);
  if (hasObjectValue(subject, "pharm:pathContainsBlockedEdge", "true")) {
    errors.push(`${subject.id} released path cannot include blocked edge`);
  }
  if (hasObjectValue(subject, "pharm:exportAuthorizationStatus", "blocked")) {
    errors.push(`${subject.id} released path cannot have blocked export authorization`);
  }
  for (const edge of edges) {
    if (isModelSuggested(edge)) {
      errors.push(`${subject.id} released path cannot include model_suggested edge ${edge.id}`);
    }
    if (!["approved", "released"].includes(getLiteralValue(edge, "pharm:reviewStatus"))) {
      errors.push(`${subject.id} released path requires approved or released edge ${edge.id}`);
    }
    if (hasObjectValue(edge, "pharm:confidenceBand", "blocked")) {
      errors.push(`${subject.id} released path cannot include blocked confidence edge ${edge.id}`);
    }
  }
}

function isModelSuggested(subject) {
  return hasObjectValue(subject, "pharm:assertionType", "model_suggested") ||
    hasObjectValue(subject, "pharm:hasAssertionType", "model_suggested");
}

function getLiteralValue(subject, predicate) {
  return getLiteralValues(subject, predicate)[0] ?? null;
}

function getLiteralValues(subject, predicate) {
  return getObjectValues(subject, predicate)
    .filter((value) => value.startsWith("\""))
    .map((value) => value.match(/^"([^"]*)"/)?.[1] ?? "")
    .filter((value) => value !== "");
}

function getTermValues(subject, predicate) {
  return getObjectTerms(subject, predicate)
    .filter((term) => term.termType === "NamedNode")
    .map((term) => term.value.trim().replace(/\s*\.$/, ""))
    .filter(Boolean);
}

function getObjectValues(subject, predicate) {
  return [...new Set(subject.predicates.get(predicate) ?? [])];
}

function getObjectTerms(subject, predicate) {
  return subject.predicateTerms.get(predicate) ?? [];
}

function normalizePredicateValue(value) {
  if (!value) {
    return null;
  }
  const trimmed = value.replace(/^"|"$/g, "").trim();
  if (trimmed.startsWith("pharmrel:")) {
    return trimmed.slice("pharmrel:".length);
  }
  return trimmed;
}

function requireNonEmptyLiteral(subject, predicate, errors) {
  const value = getLiteralValue(subject, predicate);
  if (!value || value.trim() === "" || value.trim().toLowerCase() === "null") {
    errors.push(`${subject.id} requires non-empty ${predicate}`);
  }
}

function requireNonNullLiteral(subject, predicate, errors) {
  const value = getLiteralValue(subject, predicate);
  if (!value || value.trim().toLowerCase() === "null") {
    errors.push(`${subject.id} requires non-null ${predicate}`);
  }
}

function hasReleaseEligibleState(subject) {
  return getLiteralValues(subject, "pharm:lifecycleStatus").some((value) => ["approved", "staged", "released"].includes(value)) ||
    getLiteralValues(subject, "pharm:reviewStatus").some((value) => ["approved", "released"].includes(value));
}

function requireSingleGovernanceValue(subject, predicate, errors) {
  const values = getObjectValues(subject, predicate);
  if (values.length > 1) {
    errors.push(`${subject.id} ${predicate} is single-cardinality governance metadata but has ${values.length} values`);
  }
}

function normalizeObjectValue(value) {
  const literal = value.match(/^"([^"]*)"/)?.[1];
  return literal ?? value.trim().replace(/\s*\.$/, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
