export type MappingPredicate =
  | "exactMatch"
  | "closeMatch"
  | "broadMatch"
  | "narrowMatch"
  | "relatedMatch"
  | "replacedBy"
  | "hasDbXref"
  | "notMatch"
  | "uncertainMatch"
  | "requiresReview";

export type LicenseClassification =
  | "open_materializable"
  | "open_with_attribution"
  | "licensed_federated"
  | "licensed_materializable_with_restrictions"
  | "internal_confidential"
  | "contains_phi_or_pii"
  | "blocked_pending_legal_review";

export type MappingReviewStatus = "draft" | "proposed" | "approved" | "rejected" | "deprecated" | "released";
export type LicenseStatus = "valid" | "restricted" | "blocked" | "pending_review" | "not_required";
export type ConfidenceBand = "high" | "medium" | "low" | "blocked";

export interface MappingObject {
  mapping_id: string;
  source_entity_id: string;
  target_entity_id: string;
  predicate: MappingPredicate;
  source_vocabulary: string;
  source_vocabulary_version: string;
  target_vocabulary: string;
  target_vocabulary_version: string;
  source_license_classification: LicenseClassification;
  source_license_policy_id: string;
  target_license_classification: LicenseClassification;
  target_license_policy_id: string;
  data_sensitivity: "public" | "restricted_public" | "licensed" | "internal_confidential" | "phi_pii" | "unknown";
  materialization_policy: "materialize" | "federate" | "stream" | "redact_then_materialize" | "block";
  permitted_uses: string[];
  export_restrictions: string[];
  disclaimer_ids: string[];
  legal_approval_id: string | null;
  retention_class: string;
  license_status: LicenseStatus;
  confidence_score: number;
  confidence_band: ConfidenceBand;
  evidence_ids: string[];
  evidence_refs: EvidenceRef[];
  provenance_id: string;
  created_by: string;
  reviewed_by: string | null;
  review_status: MappingReviewStatus;
  release_id: string | null;
  provenance: Record<string, unknown>;
}

export interface EvidenceRef {
  evidence_id: string;
  evidence_role: "supports" | "contradicts" | "context" | "source_only" | "validation_evidence" | "approval_evidence";
  required_for_release?: boolean;
}

export const mappingPredicates: readonly MappingPredicate[];
export const licenseClassifications: readonly LicenseClassification[];
export const mappingReviewStatuses: readonly MappingReviewStatus[];
export const mappingObjectRequiredFields: readonly string[];
export const mappingObjectSchemaContract: Readonly<Record<string, unknown>>;
export const relationshipAssertionSchemaContract: Readonly<Record<string, unknown>>;
export const relationshipAssertionSchemaSource: "docs/semantic-bridge/contracts/relationship-assertion.schema.json";
export const relationshipAssertionValidator: (value: unknown) => boolean;
export function validateMappingObjectShape(value: unknown): { valid: boolean; errors: string[] };
export function validateRelationshipAssertionContract(value: unknown): { valid: boolean; errors: string[] };
