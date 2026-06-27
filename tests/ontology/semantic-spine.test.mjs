import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

import { validateSemanticTurtle } from "../../services/semantic-store/src/index.js";

const repoRoot = new URL("../..", import.meta.url);
const fixtureRoot = new URL("../../ontologies/fixtures/", import.meta.url);
const shapeFile = new URL("../../ontologies/shapes/pharmaops-shapes.ttl", import.meta.url);

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
  "pharm:ReleaseArtifact",
  "pharm:Biomarker",
  "pharm:Endpoint",
  "pharm:OrganizationSponsor"
];

test("Phase 1 SHACL file contains blocker shapes for entity, mapping, and provenance validation", () => {
  const shapes = readText(shapeFile);

  for (const shapeName of [
    "pharm:EntityRequiredLabelShape",
    "pharm:EntityTypeRequiredShape",
    "pharm:IdentifierFormatShape",
    "pharm:SourceProvenanceShape",
    "pharm:MappingCompletenessShape",
    "pharm:RelationshipCompletenessShape",
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
    assert.match(shapes, new RegExp(escapeRegExp(shapeName)), `missing ${shapeName}`);
  }

  assert.match(shapes, /pharm:sourceVocabularyVersion[\s\S]*sh:minCount 1/, "source vocabulary version is not a required mapping field");
  assert.match(shapes, /pharm:targetVocabularyVersion[\s\S]*sh:minCount 1/, "target vocabulary version is not a required mapping field");
  assert.match(shapes, /pharm:hasProvenance[\s\S]*sh:minCount 1/, "governed objects must require provenance");
  assert.match(shapes, /pharm:ModelSuggestedPublicationBlockerShape/, "model suggestions must have an explicit publication blocker shape");
  assert.match(shapes, /model_suggested[\s\S]*approved[\s\S]*staged[\s\S]*released|approved[\s\S]*staged[\s\S]*released[\s\S]*model_suggested/, "model suggestion blocker must mention release-ineligible states");
  assert.match(shapes, /model_suggested[\s\S]*releaseMembership|releaseMembership[\s\S]*model_suggested/, "model suggestion blocker must constrain release graph membership");
  assert.match(shapes, /hasRelationshipClass[\s\S]*safety[\s\S]*blocked/, "relationship class shape must enumerate Semantic Bridge classes");
  assert.match(shapes, /assertionType[\s\S]*system_generated/, "relationship assertion type shape must include system_generated");
  assert.match(shapes, /reviewStatus[\s\S]*deprecated[\s\S]*superseded/, "relationship review status shape must include deprecated and superseded states");
  assert.match(shapes, /IdentityMappingSeparationShape[\s\S]*mappingPredicate[\s\S]*relationshipPredicate/, "identity and vocabulary relationships must not collapse mapping assertions");
  assert.match(shapes, /pathContainsUnreviewedModelSuggestedEdge[\s\S]*pathConfidenceBand[\s\S]*high/, "path confidence shape must block high-confidence unreviewed model paths");
  assert.match(shapes, /usesRestrictedEvidence[\s\S]*hasRedactionPolicy[\s\S]*exportAuthorizationStatus/, "restricted evidence shape must require redaction and export metadata");
  for (const provenanceField of [
    "provenanceId",
    "activityType",
    "activityId",
    "methodType",
    "confidenceType",
    "environmentName",
    "tenantId",
    "releaseStatus",
    "auditEventId"
  ]) {
    assert.match(
      shapes,
      new RegExp(`pharm:${provenanceField}[\\s\\S]*sh:minCount 1`),
      `provenance shape must require pharm:${provenanceField}`
    );
  }
});

test("valid ontology fixtures satisfy semantic spine blocker checks", () => {
  for (const fixtureName of ["valid-core.ttl", "valid-relationship.ttl", "valid-semantic-bridge.ttl"]) {
    const result = validateSemanticFixture(readFixture(fixtureName), fixtureName);
    assert.deepEqual(result, { valid: true, errors: [] }, `${fixtureName} should validate`);
  }
});

test("entity fixture without preferred label fails loudly", () => {
  const fixtureName = "invalid-entity-missing-label.ttl";
  const result = validateSemanticFixture(readFixture(fixtureName), fixtureName);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes("requires pharm:preferredLabel")),
    `expected preferred label error, got ${result.errors.join("; ")}`
  );
});

test("mapping missing target vocabulary version fails loudly", () => {
  const fixtureName = "invalid-mapping-missing-target-version.ttl";
  const result = validateSemanticFixture(readFixture(fixtureName), fixtureName);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes("requires pharm:targetVocabularyVersion")),
    `expected target vocabulary version error, got ${result.errors.join("; ")}`
  );
});

test("assertion without provenance fails loudly", () => {
  const fixtureName = "invalid-assertion-missing-provenance.ttl";
  const result = validateSemanticFixture(readFixture(fixtureName), fixtureName);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes("requires pharm:hasProvenance")),
    `expected provenance error, got ${result.errors.join("; ")}`
  );
});

test("model suggested assertion cannot be approved or release-membered", () => {
  const fixtureName = "invalid-model-suggested-in-release.ttl";
  const result = validateSemanticFixture(readFixture(fixtureName), fixtureName);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes("model_suggested cannot be approved/staged/released")),
    `expected model_suggested lifecycle error, got ${result.errors.join("; ")}`
  );
  assert.ok(
    result.errors.some((error) => error.includes("model_suggested cannot be release-membered")),
    `expected model_suggested release graph error, got ${result.errors.join("; ")}`
  );
});

test("Semantic Bridge relationship missing class, evidence, review, license, or release context fails loudly", () => {
  const fixtureName = "invalid-relationship-missing-bridge-fields.ttl";
  const result = validateSemanticFixture(readFixture(fixtureName), fixtureName);

  assert.equal(result.valid, false);
  for (const requiredPredicate of [
    "pharm:hasRelationshipClass",
    "pharm:hasEvidence",
    "pharm:reviewStatus",
    "pharm:dataLicenseClass",
    "pharm:releaseId"
  ]) {
    assert.ok(
      result.errors.some((error) => error.includes(`requires ${requiredPredicate}`)),
      `expected ${requiredPredicate} error, got ${result.errors.join("; ")}`
    );
  }
});

test("Semantic Bridge high-confidence path with unreviewed model-suggested edge fails loudly", () => {
  const fixtureName = "invalid-path-high-confidence-model-suggested.ttl";
  const result = validateSemanticFixture(readFixture(fixtureName), fixtureName);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes("high confidence path cannot include unreviewed model_suggested edge")),
    `expected path confidence blocker, got ${result.errors.join("; ")}`
  );
});

test("release-ineligible mapping state fails loudly inside a release graph", () => {
  const fixtureName = "invalid-mapping-release-ineligible-state.ttl";
  const result = validateSemanticFixture(readFixture(fixtureName), fixtureName);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes("release graph requires lifecycleStatus approved, staged, or released")),
    `expected release-ineligible lifecycle error, got ${result.errors.join("; ")}`
  );
  assert.ok(
    result.errors.some((error) => error.includes("release graph requires reviewStatus approved or released")),
    `expected release-ineligible review error, got ${result.errors.join("; ")}`
  );
});

function validateSemanticFixture(ttl, fixtureName) {
  return validateSemanticTurtle(ttl, fixtureName);
  const errors = [];
  const subjects = parseSubjectBlocks(ttl);

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
        "pharm:assertionType",
        "pharm:confidenceScore",
        "pharm:hasEvidence"
      ]) {
        requirePredicate(subject, predicate, errors);
      }
    }

    if (hasObjectValue(subject, "pharm:assertionType", "model_suggested")) {
      if (hasObjectValue(subject, "pharm:lifecycleStatus", "approved") ||
          hasObjectValue(subject, "pharm:lifecycleStatus", "staged") ||
          hasObjectValue(subject, "pharm:lifecycleStatus", "released")) {
        errors.push(`${subject.id} model_suggested cannot be approved/staged/released`);
      }
      const releaseMembership = extractStringValue(subject, "pharm:releaseMembership");
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
  const pattern = new RegExp(`(?:^|[;\\n])\\s*${escapeRegExp(predicate)}\\s+`, "m");
  if (!pattern.test(subject.block)) {
    errors.push(`${subject.id} requires ${predicate}`);
  }
}

function hasObjectValue(subject, predicate, expectedValue) {
  const pattern = new RegExp(`(?:^|[;\\n])\\s*${escapeRegExp(predicate)}\\s+"?${escapeRegExp(expectedValue)}"?\\s*(?:;|\\.|$)`, "m");
  return pattern.test(subject.block);
}

function extractStringValue(subject, predicate) {
  const pattern = new RegExp(`(?:^|[;\\n])\\s*${escapeRegExp(predicate)}\\s+"([^"]+)"`, "m");
  return subject.block.match(pattern)?.[1] ?? null;
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

function getLiteralValue(subject, predicate) {
  const pattern = new RegExp(`(?:^|[;\\n])\\s*${escapeRegExp(predicate)}\\s+"([^"]+)"`, "m");
  return pattern.exec(subject.block)?.[1] ?? null;
}

function readFixture(fixtureName) {
  return readText(new URL(fixtureName, fixtureRoot));
}

function readText(url) {
  return readFileSync(url, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
