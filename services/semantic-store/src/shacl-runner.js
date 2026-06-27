import { readFileSync } from "node:fs";

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
const licenseClasses = new Set([
  "open_materializable",
  "open_with_attribution",
  "licensed_federated",
  "licensed_materializable_with_restrictions",
  "internal_confidential",
  "contains_phi_or_pii",
  "blocked_pending_legal_review"
]);

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
  const subjects = parseSubjectBlocks(turtle);

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
      requireReviewedReleaseState(subject, errors);
      requireIdentityMappingSeparation(subject, errors);
      requireSafetyLimitations(subject, errors);
      requireCausalReview(subject, errors);
      requireBlockedRationale(subject, errors);
      requireRestrictedEvidenceMetadata(subject, errors);
    }

    if (subject.types.includes("pharm:RelationshipPath")) {
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
      requirePathConfidenceRules(subject, errors);
      requireReleasedPathRules(subject, errors);
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
    "pharm:SafetyLimitationRequirementsShape",
    "pharm:CausalClaimRestrictionsShape",
    "pharm:ReviewStateRestrictionsShape",
    "pharm:ReleasedRelationshipRequirementsShape",
    "pharm:PathConfidenceConstraintsShape",
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
  const stripped = ttl
    .replace(/^\s*@prefix[\s\S]*?\.\s*$/gm, "")
    .replace(/#.*$/gm, "")
    .trim();

  return stripped
    .split(/\s*\.\s*(?=\n|$)/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const firstToken = block.match(/^(\S+)/)?.[1] ?? "(unknown)";
      const types = [...block.matchAll(/(?:^|\s|;)\s*a\s+([^;.\n]+)/g)]
        .flatMap((match) => match[1].trim().split(/\s*,\s*/))
        .map((type) => type.trim())
        .filter(Boolean);

      return { id: firstToken, block, types };
    });
}

function requirePredicate(subject, predicate, errors) {
  if (!hasPredicate(subject, predicate)) {
    errors.push(`${subject.id} requires ${predicate}`);
  }
}

function hasPredicate(subject, predicate) {
  const pattern = new RegExp(`(?:^|[;\\n])\\s*${escapeRegExp(predicate)}\\s+`, "m");
  return pattern.test(subject.block);
}

function requireValueInSet(subject, predicate, allowedValues, errors) {
  const value = getLiteralValue(subject, predicate);
  if (value && !allowedValues.has(value)) {
    errors.push(`${subject.id} ${predicate} has unapproved value ${value}`);
  }
}

function hasObjectValue(subject, predicate, expectedValue) {
  const pattern = new RegExp(`(?:^|[;\\n])\\s*${escapeRegExp(predicate)}\\s+"?${escapeRegExp(expectedValue)}"?\\s*(?:;|\\.|$)`, "m");
  return pattern.test(subject.block);
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
  const lifecycleStatus = getLiteralValue(subject, "pharm:lifecycleStatus");
  if (!["approved", "staged", "released"].includes(lifecycleStatus)) {
    return;
  }
  const reviewStatus = getLiteralValue(subject, "pharm:reviewStatus");
  if (!["approved", "released"].includes(reviewStatus)) {
    errors.push(`${subject.id} approved/staged/released relationship requires reviewStatus approved or released`);
  }
  requirePredicate(subject, "pharm:reviewedBy", errors);
  requirePredicate(subject, "pharm:reviewedAt", errors);

  if (lifecycleStatus === "released") {
    if (getLiteralValue(subject, "pharm:releaseId") === "not_released") {
      errors.push(`${subject.id} released relationship requires releaseId other than not_released`);
    }
    requirePredicate(subject, "pharm:validationReportId", errors);
  }
}

function requireIdentityMappingSeparation(subject, errors) {
  if (hasPredicate(subject, "pharm:mappingPredicate")) {
    errors.push(`${subject.id} RelationshipAssertion cannot use pharm:mappingPredicate`);
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
  if (!hasObjectValue(subject, "pharm:hasCausalClaimStatus", "approved_causal_claim")) {
    return;
  }
  if (!hasObjectValue(subject, "pharm:causalReviewStatus", "approved_causal_review")) {
    errors.push(`${subject.id} causal claims require approved causal review`);
  }
  requirePredicate(subject, "pharm:reviewedBy", errors);
  requirePredicate(subject, "pharm:reviewedAt", errors);
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

function requireReleasedPathRules(subject, errors) {
  if (!hasObjectValue(subject, "pharm:pathStatus", "released")) {
    return;
  }
  if (getLiteralValue(subject, "pharm:releaseId") === "not_released") {
    errors.push(`${subject.id} released path requires releaseId other than not_released`);
  }
  requirePredicate(subject, "pharm:validationReportId", errors);
  if (hasObjectValue(subject, "pharm:pathContainsBlockedEdge", "true")) {
    errors.push(`${subject.id} released path cannot include blocked edge`);
  }
  if (hasObjectValue(subject, "pharm:exportAuthorizationStatus", "blocked")) {
    errors.push(`${subject.id} released path cannot have blocked export authorization`);
  }
}

function isModelSuggested(subject) {
  return hasObjectValue(subject, "pharm:assertionType", "model_suggested") ||
    hasObjectValue(subject, "pharm:hasAssertionType", "model_suggested");
}

function getLiteralValue(subject, predicate) {
  const pattern = new RegExp(`(?:^|[;\\n])\\s*${escapeRegExp(predicate)}\\s+"([^"]+)"`, "m");
  return pattern.exec(subject.block)?.[1] ?? null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
