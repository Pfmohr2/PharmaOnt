import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import mappingObjectSchema from "./mapping-object.schema.json" with { type: "json" };
import relationshipAssertionSchema from "../../../docs/semantic-bridge/contracts/relationship-assertion.schema.json" with { type: "json" };

export const mappingPredicates = Object.freeze([
  "exactMatch",
  "closeMatch",
  "broadMatch",
  "narrowMatch",
  "relatedMatch",
  "replacedBy",
  "hasDbXref",
  "notMatch",
  "uncertainMatch",
  "requiresReview"
]);

export const licenseClassifications = Object.freeze([
  "open_materializable",
  "open_with_attribution",
  "licensed_federated",
  "licensed_materializable_with_restrictions",
  "internal_confidential",
  "contains_phi_or_pii",
  "blocked_pending_legal_review"
]);

export const mappingReviewStatuses = Object.freeze([
  "draft",
  "proposed",
  "approved",
  "rejected",
  "deprecated",
  "released"
]);

export const mappingObjectRequiredFields = Object.freeze(mappingObjectSchema.required);
export const mappingObjectSchemaContract = Object.freeze(mappingObjectSchema);
export const relationshipAssertionSchemaContract = Object.freeze(relationshipAssertionSchema);

const relationshipAssertionAjv = new Ajv2020({
  allErrors: true,
  strict: false
});
addFormats(relationshipAssertionAjv);

export const relationshipAssertionSchemaSource = "docs/semantic-bridge/contracts/relationship-assertion.schema.json";
export const relationshipAssertionValidator = relationshipAssertionAjv.compile(relationshipAssertionSchemaContract);

function formatAjvError(error) {
  const path = error.instancePath || "/";
  const detail = error.params?.missingProperty
    ? `${error.message}: ${error.params.missingProperty}`
    : error.message;
  return `${path} ${detail}`;
}

export function validateRelationshipAssertionContract(value) {
  const valid = relationshipAssertionValidator(value);
  return {
    valid,
    errors: valid ? [] : relationshipAssertionValidator.errors.map(formatAjvError)
  };
}

export function validateMappingObjectShape(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["Mapping object must be an object."] };
  }

  for (const field of mappingObjectRequiredFields) {
    if (!(field in value)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if ("predicate" in value && !mappingPredicates.includes(value.predicate)) {
    errors.push(`Invalid predicate: ${value.predicate}`);
  }
  if ("source_license_classification" in value && !licenseClassifications.includes(value.source_license_classification)) {
    errors.push(`Invalid source_license_classification: ${value.source_license_classification}`);
  }
  if ("target_license_classification" in value && !licenseClassifications.includes(value.target_license_classification)) {
    errors.push(`Invalid target_license_classification: ${value.target_license_classification}`);
  }
  if ("review_status" in value && !mappingReviewStatuses.includes(value.review_status)) {
    errors.push(`Invalid review_status: ${value.review_status}`);
  }
  if ("confidence_score" in value && (typeof value.confidence_score !== "number" || value.confidence_score < 0 || value.confidence_score > 1)) {
    errors.push("confidence_score must be a number from 0 to 1.");
  }
  if ("license_status" in value && ["blocked", "pending_review"].includes(value.license_status) && value.review_status === "released") {
    errors.push("Released mappings cannot have blocked or pending_review license_status.");
  }

  return { valid: errors.length === 0, errors };
}
