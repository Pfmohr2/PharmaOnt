export type LicenseClassification =
  | "open_materializable"
  | "open_with_attribution"
  | "licensed_federated"
  | "licensed_materializable_with_restrictions"
  | "internal_confidential"
  | "contains_phi_or_pii"
  | "blocked_pending_legal_review";

export type MaterializationPolicy = "materialize" | "federate" | "stream" | "redact_then_materialize" | "block";
export type AiUsePolicy = "allowed" | "allowed_with_attribution" | "deidentified_only" | "private_approved_only" | "prohibited";

export class PolicyViolation extends Error {
  constructor(message: string, details?: unknown);
  details?: unknown;
}

export const LICENSE_CLASSIFICATIONS: readonly LicenseClassification[];
export const DEFAULT_SOURCE_POLICIES: Readonly<Record<string, object>>;

export function getSourcePolicy(source: string | object): object;
export function evaluateLicensePolicy(input: {
  source: string | object;
  record?: object;
  requestedUses?: string[];
  aiPolicyApproved?: boolean;
  legalApprovalId?: string | null;
  finalObject?: boolean;
}): object;
export function assertIngestionPolicy(input: {
  source: string | object;
  record?: object;
  requestedUses?: string[];
  aiPolicyApproved?: boolean;
  legalApprovalId?: string | null;
  finalObject?: boolean;
}): object;
