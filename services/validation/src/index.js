import { createHash } from "node:crypto";

export const VALIDATION_SEVERITIES = Object.freeze({
  CRITICAL: "critical",
  WARNING: "warning"
});

export const VALIDATION_STATUS = Object.freeze({
  PASS: "pass",
  WARNING: "warning",
  FAIL: "fail"
});

export const CRITICAL_RULES = Object.freeze([
  "required_provenance",
  "required_evidence",
  "mapping_source_target_versions",
  "confidence_not_fabricated",
  "faers_non_causal",
  "tenant_boundary",
  "release_approval_state",
  "release_candidate_evidence_package",
  "validation_evidence_resolved"
]);

const APPROVED_REVIEW_STATUSES = new Set(["approved"]);
const RELEASE_READY_WORKFLOW_STATUSES = new Set(["approved", "staged_for_release", "release_candidate"]);
const FAERS_SOURCES = ["faers", "openfda", "openfda faers"];
const CAUSAL_TERMS = [
  "causal",
  "causes",
  "caused_by",
  "causation",
  "incidence",
  "prevalence",
  "risk_ratio",
  "relative_risk",
  "attributable",
  "product_fault"
];
const FAERS_ALLOWED_CLAIM_TYPES = new Set(["association", "descriptive", "signal", "safety_signal"]);

export class ValidationError extends Error {
  constructor(message, result) {
    super(message);
    this.name = "ValidationError";
    this.result = result;
    this.findings = result.findings;
  }
}

export function validate(proposalOrRelease, options = {}) {
  const context = {
    expectedTenantId: options.expectedTenantId ?? options.tenantId ?? proposalOrRelease?.tenant_id ?? null,
    releaseMode: Boolean(options.releaseMode),
    rulesetVersion: options.rulesetVersion ?? "phase4.validation-preview.v1"
  };
  const target = clone(proposalOrRelease);
  const findings = [];

  if (!isObject(target)) {
    findings.push(finding({
      ruleId: "input_object_required",
      severity: VALIDATION_SEVERITIES.CRITICAL,
      message: "Validation target must be an object.",
      path: "$"
    }));
    return buildResult(findings, context);
  }

  if (isReleaseCandidate(target)) {
    validateReleaseCandidateObject(target, findings, { ...context, releaseMode: true });
  } else {
    validateGovernedItem(target, findings, context, "$");
  }

  return buildResult(findings, context);
}

export function validateProposal(proposal, options = {}) {
  return validate(proposal, { ...options, releaseMode: false });
}

export function validateReleaseCandidate(releaseCandidate, options = {}) {
  return validate(releaseCandidate, { ...options, releaseMode: true });
}

export function validationPreview({ proposal, actor = null, correlation_id = null, phase = "validation" } = {}) {
  const validationTarget = normalizeProposalEnvelope(proposal, { actor, correlation_id, phase });
  const result = validate(validationTarget, {
    expectedTenantId: proposal?.tenant_id ?? actor?.tenant_id ?? null,
    releaseMode: phase === "stage_release"
  });
  return {
    status: result.status === VALIDATION_STATUS.FAIL
      ? "failed"
      : result.status === VALIDATION_STATUS.WARNING ? "warning" : "passed",
    critical_failures: result.summary.critical,
    warnings: result.summary.warning,
    validation_report_id: `validation:${phase}:${proposal?.proposal_id ?? "unknown"}`,
    findings: result.findings
  };
}

export function assertNoCriticalFailures(proposalOrRelease, options = {}) {
  const result = validate(proposalOrRelease, options);
  if (result.blocking) {
    throw new ValidationError("critical validation failures block release", result);
  }
  return result;
}

export async function resolveValidationEvidence(releaseCandidate, options = {}) {
  const context = validationEvidenceContext(releaseCandidate, options);
  const findings = [];
  const resolved_validation_runs = [];

  if (!isObject(releaseCandidate) || !isReleaseCandidate(releaseCandidate)) {
    findings.push(validationEvidenceFinding({
      message: "Validation evidence resolution requires a release candidate.",
      path: "$"
    }));
    return buildResult(findings, { rulesetVersion: options.rulesetVersion ?? "phase4.validation-evidence.v1" });
  }

  const refs = [
    ...arrayOf(releaseCandidate.validation_report_refs),
    ...arrayOf(releaseCandidate.validation_evidence)
  ];
  if (refs.length === 0) {
    findings.push(validationEvidenceFinding({
      message: "Release candidate must reference immutable validation-run records.",
      path: "$.validation_report_refs"
    }));
    return withResolvedRuns(buildResult(findings, { rulesetVersion: options.rulesetVersion ?? "phase4.validation-evidence.v1" }), resolved_validation_runs);
  }

  if (typeof options.resolveValidationRun !== "function") {
    findings.push(validationEvidenceFinding({
      message: "Release validation evidence resolver is required and must fail closed when absent.",
      path: "$.validation_report_refs"
    }));
    return withResolvedRuns(buildResult(findings, { rulesetVersion: options.rulesetVersion ?? "phase4.validation-evidence.v1" }), resolved_validation_runs);
  }

  for (const [index, ref] of refs.entries()) {
    const path = `$.validation_report_refs[${index}]`;
    const validationRunId = ref?.validation_run_id ?? ref?.validation_report_id ?? ref?.id;
    if (!hasText(validationRunId)) {
      findings.push(validationEvidenceFinding({
        message: "Validation report reference must include validation_run_id.",
        path,
        validationRunId: null
      }));
      continue;
    }

    const record = await options.resolveValidationRun({
      validation_run_id: validationRunId,
      tenant_id: context.tenant_id,
      environment: context.environment,
      release_id: context.release_id,
      release_candidate_id: context.release_candidate_id,
      subject_type: context.subject_type,
      subject_id: context.subject_id,
      input_payload_digest: context.input_payload_digest,
      item_ids: context.item_ids
    });

    if (!isObject(record)) {
      findings.push(validationEvidenceFinding({
        message: "Validation run was not found in immutable validation evidence store.",
        path,
        validationRunId
      }));
      continue;
    }

    resolved_validation_runs.push(summarizeValidationRun(record));
    validateValidationRunBinding(record, context, findings, path, validationRunId);
    await validateValidationRunOutcome(record, context, findings, path, validationRunId, options);
  }

  return withResolvedRuns(
    buildResult(findings, { rulesetVersion: options.rulesetVersion ?? "phase4.validation-evidence.v1" }),
    resolved_validation_runs
  );
}

export async function assertResolvedValidationEvidence(releaseCandidate, options = {}) {
  const result = await resolveValidationEvidence(releaseCandidate, options);
  if (result.blocking) {
    throw new ValidationError("critical validation evidence blocks release", result);
  }
  return result;
}

function validateReleaseCandidateObject(releaseCandidate, findings, context) {
  const path = "$";
  const items = getReleaseItems(releaseCandidate);
  const releaseId = releaseCandidate.release_candidate_id ?? releaseCandidate.release_id ?? releaseCandidate.id ?? null;
  const tenantId = context.expectedTenantId ?? releaseCandidate.tenant_id ?? null;

  if (!hasNonEmpty(releaseCandidate.changelog)) {
    findings.push(finding({
      ruleId: "release_candidate_evidence_package",
      message: "Release candidate must include a changelog.",
      path: `${path}.changelog`,
      objectType: "release_candidate",
      objectId: releaseId
    }));
  }
  if (!hasNonEmpty(releaseCandidate.artifact_hashes)) {
    findings.push(finding({
      ruleId: "release_candidate_evidence_package",
      message: "Release candidate must include artifact hashes.",
      path: `${path}.artifact_hashes`,
      objectType: "release_candidate",
      objectId: releaseId
    }));
  }
  if (!hasNonEmpty(releaseCandidate.validation_evidence) && !hasNonEmpty(releaseCandidate.validation_report_refs)) {
    findings.push(finding({
      ruleId: "release_candidate_evidence_package",
      message: "Release candidate must include validation evidence or validation report references.",
      path: `${path}.validation_evidence`,
      objectType: "release_candidate",
      objectId: releaseId
    }));
  }
  if (!hasNonEmpty(releaseCandidate.source_version_pins)) {
    findings.push(finding({
      ruleId: "release_candidate_evidence_package",
      message: "Release candidate must include source-version pins.",
      path: `${path}.source_version_pins`,
      objectType: "release_candidate",
      objectId: releaseId
    }));
  }
  if (!hasNonEmpty(releaseCandidate.approval_trace)) {
    findings.push(finding({
      ruleId: "release_candidate_evidence_package",
      message: "Release candidate must include approval trace.",
      path: `${path}.approval_trace`,
      objectType: "release_candidate",
      objectId: releaseId
    }));
  }
  if (!items.length) {
    findings.push(finding({
      ruleId: "release_candidate_evidence_package",
      message: "Release candidate must include at least one governed item.",
      path: `${path}.items`,
      objectType: "release_candidate",
      objectId: releaseId
    }));
  }

  items.forEach((item, index) => {
    validateGovernedItem(item, findings, {
      ...context,
      expectedTenantId: tenantId,
      releaseMode: true
    }, `${path}.items[${index}]`);
  });
}

function validateGovernedItem(input, findings, context, path) {
  const { item, metadata } = unwrapItem(input);
  const objectType = getObjectType(item);
  const objectId = getObjectId(item, metadata);

  if (!hasProvenance(item, metadata)) {
    findings.push(finding({
      ruleId: "required_provenance",
      message: "Governed assertion must include provenance.",
      path: `${path}.provenance_id`,
      objectType,
      objectId
    }));
  }

  if (!hasEvidence(item, metadata)) {
    findings.push(finding({
      ruleId: "required_evidence",
      message: "Governed assertion must include supporting evidence.",
      path: `${path}.evidence_refs`,
      objectType,
      objectId
    }));
  }

  if (isMapping(item, objectType)) {
    if (!hasText(item.source_vocabulary_version)) {
      findings.push(finding({
        ruleId: "mapping_source_target_versions",
        message: "Mapping must include source vocabulary version.",
        path: `${path}.source_vocabulary_version`,
        objectType,
        objectId
      }));
    }
    if (!hasText(item.target_vocabulary_version)) {
      findings.push(finding({
        ruleId: "mapping_source_target_versions",
        message: "Mapping must include target vocabulary version.",
        path: `${path}.target_vocabulary_version`,
        objectType,
        objectId
      }));
    }
  }

  validateConfidence(item, findings, { path, objectType, objectId });
  validateFaersClaim(item, findings, { path, objectType, objectId });
  validateTenantBoundary(input, item, findings, { ...context, path, objectType, objectId });

  if (context.releaseMode) {
    validateReleaseState(item, metadata, findings, { path, objectType, objectId });
  }
}

function validateConfidence(item, findings, detail) {
  const score = item.confidence_score ?? item.confidence?.score;
  const band = item.confidence_band ?? item.confidence?.band;
  const confidenceSource = item.confidence_source ?? item.confidence?.source ?? null;
  const fabricated = item.confidence?.is_fabricated === true
    || item.fabricated_confidence === true
    || String(confidenceSource ?? "").toLowerCase() === "fabricated";

  if (fabricated || typeof score !== "number" || Number.isNaN(score) || score < 0 || score > 1 || !hasText(band)) {
    findings.push(finding({
      ruleId: "confidence_not_fabricated",
      message: "Confidence must be explicit, bounded from 0 to 1, banded, and not fabricated.",
      path: `${detail.path}.confidence_score`,
      objectType: detail.objectType,
      objectId: detail.objectId
    }));
    return;
  }

  if (score < 0.7 || String(band).toLowerCase() === "low") {
    findings.push(finding({
      ruleId: "confidence_low",
      severity: VALIDATION_SEVERITIES.WARNING,
      message: "Low confidence should be reviewed before promotion.",
      path: `${detail.path}.confidence_score`,
      objectType: detail.objectType,
      objectId: detail.objectId,
      blocksRelease: false
    }));
  }
}

function validateFaersClaim(item, findings, detail) {
  if (!usesFaers(item)) {
    return;
  }

  const claimType = String(item.claim_type ?? item.assertion_type ?? "").toLowerCase();
  const predicate = String(item.predicate ?? item.relationship_type ?? item.claim ?? "").toLowerCase();
  const text = `${claimType} ${predicate} ${String(item.description ?? item.label ?? "")}`.toLowerCase();
  const causal = CAUSAL_TERMS.some((term) => text.includes(term));
  const allowed = FAERS_ALLOWED_CLAIM_TYPES.has(claimType);
  const hasDisclaimer = hasFaersDisclaimer(item);

  if (causal || !allowed || !hasDisclaimer) {
    findings.push(finding({
      ruleId: "faers_non_causal",
      message: "FAERS/openFDA safety data must remain non-causal and carry source limitations with evidence.",
      path: `${detail.path}.disclaimer_ids`,
      objectType: detail.objectType,
      objectId: detail.objectId
    }));
  }
}

function validateTenantBoundary(input, item, findings, detail) {
  const expected = detail.expectedTenantId;
  const tenantFields = collectTenantRefs(input, item);

  for (const ref of tenantFields) {
    if (expected && ref.tenantId && ref.tenantId !== expected) {
      findings.push(finding({
        ruleId: "tenant_boundary",
        message: `Cross-tenant reference ${ref.tenantId} cannot be validated in tenant ${expected}.`,
        path: ref.path ? `${detail.path}.${ref.path}` : detail.path,
        objectType: detail.objectType,
        objectId: detail.objectId
      }));
    }
  }

  const uniqueTenants = [...new Set(tenantFields.map((ref) => ref.tenantId).filter(Boolean))];
  if (!expected && uniqueTenants.length > 1) {
    findings.push(finding({
      ruleId: "tenant_boundary",
      message: "Governed item contains references to multiple tenants.",
      path: detail.path,
      objectType: detail.objectType,
      objectId: detail.objectId
    }));
  }
}

function validateReleaseState(item, metadata, findings, detail) {
  const reviewStatus = item.review_status ?? metadata.review_status ?? null;
  const workflowStatus = item.workflow_status ?? metadata.workflow_status ?? metadata.candidate_metadata?.workflow_status ?? null;

  if (!APPROVED_REVIEW_STATUSES.has(reviewStatus) || !hasText(item.reviewed_by ?? metadata.reviewed_by)) {
    findings.push(finding({
      ruleId: "release_approval_state",
      message: "Release candidate item must be reviewed and approved before staging or packaging.",
      path: `${detail.path}.review_status`,
      objectType: detail.objectType,
      objectId: detail.objectId
    }));
  }

  if (workflowStatus && !RELEASE_READY_WORKFLOW_STATUSES.has(workflowStatus)) {
    findings.push(finding({
      ruleId: "release_approval_state",
      message: "Release candidate item is not in a release-ready workflow state.",
      path: `${detail.path}.workflow_status`,
      objectType: detail.objectType,
      objectId: detail.objectId
    }));
  }
}

function normalizeProposalEnvelope(proposal, { actor, correlation_id, phase }) {
  if (!isObject(proposal)) {
    return proposal;
  }
  const payload = isObject(proposal.payload) ? proposal.payload : {};
  const provenance = isObject(proposal.provenance) ? proposal.provenance : {};
  const proposalType = proposal.proposal_type ?? proposal.object_type ?? payload.object_type;

  return {
    ...payload,
    object_type: normalizeProposalType(proposalType),
    proposal_id: proposal.proposal_id ?? payload.proposal_id,
    tenant_id: proposal.tenant_id ?? payload.tenant_id,
    environment: proposal.environment ?? payload.environment,
    provenance_id: proposal.provenance_id ?? provenance.provenance_id ?? provenance.id,
    provenance: {
      ...provenance,
      id: provenance.id ?? provenance.provenance_id,
      actor: provenance.actor ?? provenance.created_by ?? actor?.user_id,
      timestamp: provenance.timestamp ?? provenance.created_at ?? proposal.created_at,
      source: provenance.source ?? proposal.source ?? payload.source,
      source_version: provenance.source_version ?? proposal.source_version ?? payload.source_version,
      correlation_id
    },
    evidence_ids: proposal.evidence_ids ?? payload.evidence_ids ?? provenance.evidence_ids,
    evidence_refs: proposal.evidence_refs ?? payload.evidence_refs ?? provenance.evidence_refs,
    confidence_score: proposal.confidence_score ?? payload.confidence_score,
    confidence_band: proposal.confidence_band ?? payload.confidence_band,
    confidence_source: proposal.confidence_source ?? payload.confidence_source,
    review_status: proposal.review_status ?? reviewStatusForProposalState(proposal.state),
    reviewed_by: proposal.reviewed_by ?? proposal.decided_by_user_id ?? proposal.staged_by_user_id,
    workflow_status: proposal.workflow_status ?? workflowStatusForProposalState(proposal.state, phase),
    release_id: proposal.release_id ?? payload.release_id
  };
}

function normalizeProposalType(proposalType) {
  if (proposalType === "evidence-link") {
    return "evidence_link";
  }
  return proposalType ?? "assertion";
}

function reviewStatusForProposalState(state) {
  if (state === "approved" || state === "staged-for-release") {
    return "approved";
  }
  if (state === "rejected") {
    return "rejected";
  }
  return "proposed";
}

function workflowStatusForProposalState(state, phase) {
  if (state === "staged-for-release") {
    return "staged_for_release";
  }
  if (state === "approved" && phase === "stage_release") {
    return "approved";
  }
  return state ? state.replaceAll("-", "_") : phase;
}

function validationEvidenceContext(releaseCandidate, options) {
  return {
    tenant_id: options.expectedTenantId ?? options.tenantId ?? releaseCandidate?.tenant_id ?? null,
    environment: options.environment ?? releaseCandidate?.environment ?? null,
    release_id: options.releaseId ?? releaseCandidate?.release_id ?? null,
    release_candidate_id: options.releaseCandidateId ?? releaseCandidate?.release_candidate_id ?? releaseCandidate?.id ?? null,
    subject_type: options.subjectType ?? "release_candidate",
    subject_id: options.subjectId ?? releaseCandidate?.release_candidate_id ?? releaseCandidate?.id ?? null,
    input_payload_digest: options.inputPayloadDigest ?? digestValue(releaseCandidate),
    now: options.now ?? options.clock?.().toISOString?.() ?? new Date().toISOString(),
    item_ids: getReleaseItems(releaseCandidate ?? {}).map((item, index) => {
      const unwrapped = unwrapItem(item);
      return getObjectId(unwrapped.item, unwrapped.metadata) ?? `item:${index + 1}`;
    })
  };
}

function validateValidationRunBinding(record, context, findings, path, validationRunId) {
  for (const [field, expected] of [
    ["tenant_id", context.tenant_id],
    ["environment", context.environment],
    ["release_id", context.release_id],
    ["release_candidate_id", context.release_candidate_id],
    ["subject_type", context.subject_type],
    ["subject_id", context.subject_id],
    ["input_payload_digest", context.input_payload_digest]
  ]) {
    if (hasText(expected) && hasText(record[field]) && record[field] !== expected) {
      findings.push(validationEvidenceFinding({
        message: `Validation run ${validationRunId} ${field} does not match release candidate.`,
        path: `${path}.${field}`,
        validationRunId
      }));
    }
  }

  for (const requiredField of ["subject_type", "subject_id", "input_payload_digest", "ruleset_version", "report_digest"]) {
    if (!hasText(record[requiredField])) {
      findings.push(validationEvidenceFinding({
        message: `Validation run must include ${requiredField}.`,
        path: `${path}.${requiredField}`,
        validationRunId
      }));
    }
  }

  if (record.immutable !== true && record.is_immutable !== true && !hasText(record.immutable_record_id)) {
    findings.push(validationEvidenceFinding({
      message: "Validation run must be an immutable persisted record.",
      path: `${path}.immutable`,
      validationRunId
    }));
  }

  if (!hasText(record.signature) && !hasText(record.immutable_storage_digest)) {
    findings.push(validationEvidenceFinding({
      message: "Validation run must include signature or immutable storage digest.",
      path: `${path}.signature`,
      validationRunId
    }));
  }

  if (record.integrity_valid === false || record.signature_valid === false || record.report_digest_valid === false) {
    findings.push(validationEvidenceFinding({
      message: "Validation run integrity check failed.",
      path: `${path}.integrity`,
      validationRunId
    }));
  }

  if (record.stale === true || hasText(record.superseded_by) || isExpired(record.expires_at ?? record.valid_until, context.now)) {
    findings.push(validationEvidenceFinding({
      message: "Validation run is stale, expired, or superseded.",
      path: `${path}.expires_at`,
      validationRunId
    }));
  }

  const recordItemIds = arrayOf(record.item_ids ?? record.itemIds);
  if (context.item_ids.length > 0 && recordItemIds.length === 0) {
    findings.push(validationEvidenceFinding({
      message: "Validation run must be bound to release candidate item IDs.",
      path: `${path}.item_ids`,
      validationRunId
    }));
  } else if (recordItemIds.length > 0 && !sameSet(recordItemIds, context.item_ids)) {
    findings.push(validationEvidenceFinding({
      message: "Validation run item binding does not match release candidate items.",
      path: `${path}.item_ids`,
      validationRunId
    }));
  }
}

async function validateValidationRunOutcome(record, context, findings, path, validationRunId, options) {
  const status = String(record.status ?? record.result ?? "").toLowerCase();
  const criticalFindings = validationRunCriticalFindings(record);
  const criticalCount = Number(record.summary?.critical ?? record.critical_failures ?? record.critical_count ?? criticalFindings.length);
  const passed = status === "pass" || status === "passed" || status === "success";

  if (passed && criticalCount === 0) {
    return;
  }

  if (criticalCount === 0 && !passed) {
    findings.push(validationEvidenceFinding({
      message: `Validation run ${validationRunId} did not pass.`,
      path: `${path}.status`,
      validationRunId
    }));
    return;
  }

  const waived = await allCriticalFindingsWaived({
    validationRunId,
    criticalFindings,
    context,
    options
  });
  if (!waived) {
    findings.push(validationEvidenceFinding({
      message: `Validation run ${validationRunId} has unresolved critical findings in immutable evidence.`,
      path: `${path}.findings`,
      validationRunId
    }));
  }
}

async function allCriticalFindingsWaived({ validationRunId, criticalFindings, context, options }) {
  if (typeof options.resolveValidationWaiver !== "function") {
    return false;
  }
  const findingsToWaive = criticalFindings.length > 0
    ? criticalFindings
    : [{ finding_id: `${validationRunId}:critical`, rule_id: "unknown_critical" }];

  for (const criticalFinding of findingsToWaive) {
    const waiver = await options.resolveValidationWaiver({
      validation_run_id: validationRunId,
      finding_id: criticalFinding.finding_id ?? criticalFinding.id ?? null,
      rule_id: criticalFinding.rule_id ?? criticalFinding.ruleId ?? null,
      tenant_id: context.tenant_id,
      environment: context.environment,
      release_id: context.release_id,
      release_candidate_id: context.release_candidate_id
    });
    if (!verifiedWaiver(waiver, validationRunId, criticalFinding, context)) {
      return false;
    }
  }
  return true;
}

function verifiedWaiver(waiver, validationRunId, criticalFinding, context) {
  if (!isObject(waiver)) {
    return false;
  }
  const findingId = criticalFinding.finding_id ?? criticalFinding.id ?? null;
  const ruleId = criticalFinding.rule_id ?? criticalFinding.ruleId ?? null;
  return waiver.validation_run_id === validationRunId
    && (findingId === null || waiver.finding_id === findingId)
    && (ruleId === null || waiver.rule_id === ruleId)
    && waiver.approved === true
    && waiver.audited === true
    && hasText(waiver.audit_event_id)
    && (!hasText(context.tenant_id) || waiver.tenant_id === context.tenant_id)
    && (!hasText(context.environment) || waiver.environment === context.environment)
    && (!hasText(context.release_id) || waiver.release_id === context.release_id)
    && (!hasText(context.release_candidate_id) || waiver.release_candidate_id === context.release_candidate_id);
}

function validationRunCriticalFindings(record) {
  return arrayOf(record.findings).filter((item) =>
    String(item?.severity ?? "").toLowerCase() === VALIDATION_SEVERITIES.CRITICAL
    || item?.blocks_release === true
  );
}

function summarizeValidationRun(record) {
  return {
    validation_run_id: record.validation_run_id ?? record.validation_report_id ?? record.id ?? null,
    status: record.status ?? record.result ?? null,
    critical: Number(record.summary?.critical ?? record.critical_failures ?? record.critical_count ?? validationRunCriticalFindings(record).length),
    immutable_record_id: record.immutable_record_id ?? null
  };
}

function validationEvidenceFinding({ message, path, validationRunId }) {
  return finding({
    ruleId: "validation_evidence_resolved",
    message,
    path,
    objectType: "validation_run",
    objectId: validationRunId
  });
}

function withResolvedRuns(result, resolvedValidationRuns) {
  return {
    ...result,
    resolved_validation_runs: resolvedValidationRuns
  };
}

function sameSet(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function isExpired(expiresAt, now) {
  if (!hasText(expiresAt)) {
    return false;
  }
  const expiresMs = Date.parse(expiresAt);
  const nowMs = Date.parse(now);
  return Number.isFinite(expiresMs) && Number.isFinite(nowMs) && expiresMs <= nowMs;
}

function buildResult(findings, context) {
  const critical = findings.filter((item) => item.severity === VALIDATION_SEVERITIES.CRITICAL).length;
  const warning = findings.filter((item) => item.severity === VALIDATION_SEVERITIES.WARNING).length;
  return {
    status: critical > 0 ? VALIDATION_STATUS.FAIL : warning > 0 ? VALIDATION_STATUS.WARNING : VALIDATION_STATUS.PASS,
    findings,
    blocking: findings.some((item) => item.severity === VALIDATION_SEVERITIES.CRITICAL && item.blocks_release),
    summary: { critical, warning },
    ruleset_version: context.rulesetVersion
  };
}

function finding({
  ruleId,
  severity = VALIDATION_SEVERITIES.CRITICAL,
  message,
  path,
  objectType = null,
  objectId = null,
  blocksRelease = severity === VALIDATION_SEVERITIES.CRITICAL
}) {
  return {
    rule_id: ruleId,
    severity,
    message,
    path,
    object_type: objectType,
    object_id: objectId,
    blocks_release: blocksRelease
  };
}

function isReleaseCandidate(item) {
  if (!isObject(item)) {
    return false;
  }
  const kind = String(item.kind ?? item.type ?? item.object_type ?? "").toLowerCase();
  return kind === "release_candidate"
    || kind === "release-candidate"
    || hasText(item.release_candidate_id)
    || Array.isArray(item.items)
    || Array.isArray(item.proposals)
    || Array.isArray(item.mappings)
    || Array.isArray(item.relationships)
    || Array.isArray(item.evidence_links);
}

function getReleaseItems(releaseCandidate) {
  return [
    ...arrayOf(releaseCandidate.items),
    ...arrayOf(releaseCandidate.proposals),
    ...arrayOf(releaseCandidate.mappings),
    ...arrayOf(releaseCandidate.relationships),
    ...arrayOf(releaseCandidate.evidence_links)
  ];
}

function unwrapItem(input) {
  if (isObject(input.mapping)) {
    return { item: input.mapping, metadata: input.registry_metadata ?? input.metadata ?? {} };
  }
  if (isObject(input.proposal)) {
    return { item: input.proposal, metadata: input.metadata ?? {} };
  }
  return { item: input, metadata: input.registry_metadata ?? input.metadata ?? {} };
}

function getObjectType(item) {
  if (hasText(item.object_type)) {
    return item.object_type;
  }
  if (hasText(item.proposal_type)) {
    return item.proposal_type;
  }
  if (isMapping(item)) {
    return "mapping";
  }
  if (hasText(item.relationship_id) || hasText(item.relationship_type)) {
    return "relationship";
  }
  if (hasText(item.synonym) || hasText(item.synonym_id)) {
    return "synonym";
  }
  if (hasText(item.evidence_link_id)) {
    return "evidence_link";
  }
  return "assertion";
}

function getObjectId(item, metadata) {
  return item.mapping_id
    ?? item.proposal_id
    ?? item.relationship_id
    ?? item.synonym_id
    ?? item.evidence_link_id
    ?? item.assertion_id
    ?? metadata.candidate_id
    ?? item.id
    ?? null;
}

function isMapping(item, objectType = null) {
  return objectType === "mapping"
    || hasText(item.mapping_id)
    || (hasText(item.source_entity_id) && hasText(item.target_entity_id) && hasText(item.predicate));
}

function hasProvenance(item, metadata) {
  return hasText(item.provenance_id)
    || hasText(metadata.provenance_id)
    || hasText(item.provenance?.id)
    || (hasText(item.provenance?.actor) && hasText(item.provenance?.timestamp) && hasText(item.provenance?.source));
}

function hasEvidence(item, metadata) {
  return hasNonEmpty(item.evidence_refs)
    || hasNonEmpty(item.evidence_ids)
    || hasNonEmpty(item.evidence)
    || hasNonEmpty(metadata.evidence_refs)
    || hasNonEmpty(metadata.release_evidence_refs)
    || hasNonEmpty(metadata.candidate_metadata?.release_evidence_refs);
}

function usesFaers(item) {
  const values = [
    item.source,
    item.source_name,
    item.source_system,
    item.source_vocabulary,
    item.provenance?.source,
    ...arrayOf(item.evidence_refs).flatMap((ref) => [
      ref.source,
      ref.source_name,
      ref.source_system,
      ref.database,
      ref.disclaimer_id,
      ref.disclaimer
    ]),
    ...arrayOf(item.source_refs).flatMap((ref) => [ref.source, ref.source_name, ref.source_system, ref.database])
  ];

  return values.some((value) => {
    const normalized = String(value ?? "").toLowerCase();
    return FAERS_SOURCES.some((source) => normalized.includes(source));
  });
}

function hasFaersDisclaimer(item) {
  const values = [
    ...arrayOf(item.disclaimer_ids),
    ...arrayOf(item.limitations),
    ...arrayOf(item.evidence_refs).flatMap((ref) => [
      ref.disclaimer_id,
      ref.disclaimer,
      ...(Array.isArray(ref.disclaimer_ids) ? ref.disclaimer_ids : [])
    ])
  ].map((value) => String(value ?? "").toLowerCase());

  return values.some((value) =>
    value.includes("faers")
    && (value.includes("non-causal") || value.includes("non causal") || value.includes("causality"))
  );
}

function collectTenantRefs(input, item) {
  const refs = [];
  pushTenant(refs, "tenant_id", input.tenant_id);
  pushTenant(refs, "tenant_id", item.tenant_id);
  pushTenant(refs, "source_tenant_id", item.source_tenant_id);
  pushTenant(refs, "target_tenant_id", item.target_tenant_id);
  pushTenant(refs, "registry_metadata.tenant_id", input.registry_metadata?.tenant_id);

  arrayOf(item.references).forEach((ref, index) => pushTenant(refs, `references[${index}].tenant_id`, ref.tenant_id));
  arrayOf(item.evidence_refs).forEach((ref, index) => pushTenant(refs, `evidence_refs[${index}].tenant_id`, ref.tenant_id));
  arrayOf(item.source_refs).forEach((ref, index) => pushTenant(refs, `source_refs[${index}].tenant_id`, ref.tenant_id));

  return refs;
}

function pushTenant(refs, path, tenantId) {
  if (hasText(tenantId)) {
    refs.push({ path, tenantId });
  }
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmpty(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isObject(value)) {
    return Object.keys(value).length > 0;
  }
  return hasText(value);
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function digestValue(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortForJson(value))).digest("hex")}`;
}

function sortForJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortForJson(item)]));
  }
  return value;
}
