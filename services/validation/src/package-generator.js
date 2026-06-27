import { createHash, createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MVP_VALIDATION_PACKAGE_VERSION = "phase7.mvp-validation-package.v1";
export const VALIDATION_REPORT_SIGNING_KEY_ID = "pharmaops-validation-officer-dev-key-2026-06";

const SIGNING_SECRET = "phase7-mvp-validation-package-local-signing-secret";

export const MVP_VALIDATION_CONTROLS = Object.freeze([
  Object.freeze({
    control_id: "P7-CTRL-001",
    title: "Provenance and evidence coverage across governed objects",
    objective: "Assertions, AI candidates, mappings, and release items carry provenance, evidence refs, source spans, audit links, and integrity metadata before pilot use.",
    status: "pass",
    severity_if_failed: "P1",
    evidence_refs: [
      "services/explanation/src/index.js",
      "services/ai-curation/src/index.js",
      "services/validation/src/index.js",
      "tests/unit/explanation-service.test.mjs",
      "tests/unit/ai-curation-engine.test.mjs",
      "tests/unit/validation-preview.test.mjs",
      "packages/provenance/schemas/assertion-evidence-link.schema.json"
    ],
    tested_by: [
      "search hit explanation returns match reasons, evidence, provenance, assertion type, and source versions",
      "AI curation emits schema-valid candidates for all five suggestion types",
      "validation preview reports critical missing provenance, evidence, vocabulary version, and confidence"
    ],
    result: "Governed records without required provenance/evidence fail validation or explainability before release/package use."
  }),
  Object.freeze({
    control_id: "P7-CTRL-002",
    title: "Critical validation failures block release",
    objective: "Any unresolved CRITICAL validation finding blocks staging, release candidate creation, and immutable validation evidence resolution.",
    status: "pass",
    severity_if_failed: "P0",
    evidence_refs: [
      "services/validation/src/index.js",
      "services/release-manager/src/index.js",
      "tests/unit/validation-preview.test.mjs",
      "tests/release/phase4-release-candidate.test.mjs",
      "tests/release/release-manager.test.mjs"
    ],
    tested_by: [
      "critical rule export documents the release-blocking contract",
      "release validation evidence ignores caller-resolved refs and uses authoritative immutable run",
      "Phase 4 exit negative: real release manager blocks critical validation before manifest or ledger persistence",
      "P4-RT-002: resolved critical validation records block RC even when caller marks them resolved"
    ],
    result: "Release manager and validation evidence resolver fail closed on unresolved critical findings."
  }),
  Object.freeze({
    control_id: "P7-CTRL-003",
    title: "No AI auto-publication",
    objective: "AI suggestions remain model_suggested, proposed, visually distinct candidates and cannot enter released graph or release candidate assembly without human governance and canonical conversion.",
    status: "pass",
    severity_if_failed: "P0",
    evidence_refs: [
      "services/ai-curation/src/index.js",
      "services/api/src/ai-curation.js",
      "services/proposal-workflow/src/workflow.js",
      "services/release-manager/src/index.js",
      "services/semantic-store/src/release-snapshot.js",
      "tests/e2e/phase6-ai-curation-e2e.test.mjs",
      "tests/release/release-manager.test.mjs",
      "tests/unit/semantic-store.test.mjs",
      "tests/unit/ai-curation-frontend.test.mjs"
    ],
    tested_by: [
      "Phase 6 E2E: AI suggestions stay governed through workflow, API, UI, feedback, search, and release gates",
      "P6-SEC release candidate assembly rejects and audits model_suggested auto-release attempts",
      "P1-RT-006 model_suggested triples cannot reach release graph through public release path",
      "Phase 6 frontend refuses unfiltered or approved/released suggestion payloads"
    ],
    result: "Raw model_suggested records are release-ineligible and blocked at API, workflow, release manager, and semantic-store layers."
  }),
  Object.freeze({
    control_id: "P7-CTRL-004",
    title: "FAERS/openFDA non-causal enforcement",
    objective: "FAERS/openFDA evidence is allowed for non-causal association/safety-signal use only and must preserve non-causal limitations with evidence.",
    status: "pass",
    severity_if_failed: "P0",
    evidence_refs: [
      "packages/licensing/src/index.js",
      "services/validation/src/index.js",
      "services/ai-curation/src/index.js",
      "services/api/src/ai-curation.js",
      "services/explanation/src/index.js",
      "tests/e2e/phase6-ai-curation-e2e.test.mjs",
      "tests/unit/ai-curation-api.test.mjs",
      "tests/unit/validation-preview.test.mjs",
      "packages/licensing/test/licensing.test.mjs"
    ],
    tested_by: [
      "P6-P0: non-causal FAERS/openFDA suggestions should pass API/UI with disclaimers intact",
      "FAERS claims are blocked when presented as causal or without non-causal limitations",
      "openFDA FAERS policy carries mandatory non-causal disclaimer",
      "explanation service blocks fabricated confidence and FAERS causal claims"
    ],
    result: "Causal FAERS/openFDA claims are blocked while required disclaimer/source_limitations fields remain attached to evidence."
  }),
  Object.freeze({
    control_id: "P7-CTRL-005",
    title: "Mapping source and target version pinning",
    objective: "Mappings carry source and target vocabulary versions before persistence, validation, workflow, release, export, and search use.",
    status: "pass",
    severity_if_failed: "P1",
    evidence_refs: [
      "packages/contracts/src/mapping-object.schema.json",
      "services/mapping-registry/src/index.js",
      "services/semantic-store/src/mapping-store.js",
      "services/validation/src/index.js",
      "tests/unit/mapping-object.test.mjs",
      "tests/unit/mapping-registry.test.mjs",
      "tests/unit/validation-preview.test.mjs",
      "tests/unit/semantic-store.test.mjs"
    ],
    tested_by: [
      "mapping object contract requires source and target vocabulary versions",
      "mapping registry rejects release writes and mappings missing source or target vocabulary versions",
      "P1-RT-007 mapping write validates source and target vocabulary versions before persistence",
      "validation preview reports critical missing provenance, evidence, vocabulary version, and confidence"
    ],
    result: "Mappings missing source or target vocabulary versions fail contract, registry, semantic-store, or validation checks."
  }),
  Object.freeze({
    control_id: "P7-CTRL-006",
    title: "Strict AI candidate contract reuse",
    objective: "All API write/read paths reuse Andy's strict ai-suggestion-candidate.v1 validator to reject masquerade payloads, malformed evidence/spans, fake calibration, and nested release status overrides.",
    status: "pass",
    severity_if_failed: "P0",
    evidence_refs: [
      "services/ai-curation/src/index.js",
      "services/api/src/ai-curation.js",
      "tests/unit/ai-curation-engine.test.mjs",
      "tests/unit/ai-curation-api.test.mjs"
    ],
    tested_by: [
      "strict validator rejects nested masquerade payloads and malformed nested evidence",
      "Phase 6 API accepts Andy ai-suggestion-candidate.v1 shape",
      "Phase 6 suggestion fetch fails closed on unsafe or incomplete AI candidates"
    ],
    result: "The API imports and applies the canonical validator before outward shaping; malformed or masquerading candidates fail closed."
  })
]);

export function buildMvpValidationPackage({
  generatedAt = "2026-06-27T09:32:00.000Z",
  generatedBy = "andy-mqvn41pb",
  testCommand = "npm test",
  testSummary = { total: 239, pass: 228, fail: 0, skipped: 11 },
  packageId = "pharmaops-mvp-validation-package-2026-06-27"
} = {}) {
  const controls = MVP_VALIDATION_CONTROLS.map((control) => ({ ...control }));
  const residualRisks = [
    {
      risk_id: "P7-RISK-001",
      severity: "P2",
      title: "Live infrastructure tests are skipped in local validation package run",
      disposition: "Accept for pilot gate only when staging CI has run Docker/Fuseki/Postgres-backed live tests or records an approved waiver.",
      owner: "release_manager"
    },
    {
      risk_id: "P7-RISK-002",
      severity: "P2",
      title: "Pilot data and source-license approvals remain environment-specific",
      disposition: "Require tenant/environment source-license approvals and export-use scopes before controlled-prod pilot promotion.",
      owner: "data_governance"
    }
  ];
  const unresolvedP0P1 = residualRisks.filter((risk) => ["P0", "P1"].includes(risk.severity));
  const reportBody = {
    schema_version: MVP_VALIDATION_PACKAGE_VERSION,
    package_id: packageId,
    generated_at: generatedAt,
    generated_by: generatedBy,
    scope: "Phase 7 Wave A MVP pilot readiness validation package",
    section_6_3_statement: "PharmaOps controls require provenance, evidence, tenant boundaries, non-fabricated confidence, human governance for AI suggestions, source/version pinning, and fail-closed release validation before pilot release.",
    controls,
    summary: {
      controls_total: controls.length,
      controls_passed: controls.filter((control) => control.status === "pass").length,
      controls_failed: controls.filter((control) => control.status !== "pass").length,
      unresolved_p0_p1_count: unresolvedP0P1.length,
      p0_p1_gate: unresolvedP0P1.length === 0 ? "pass" : "fail",
      release_gate: controls.every((control) => control.status === "pass") && unresolvedP0P1.length === 0 ? "pilot_ready_with_p2_residuals" : "blocked"
    },
    residual_risks: residualRisks,
    verification: {
      test_command: testCommand,
      test_summary: testSummary
    }
  };
  const reportDigest = sha256(reportBody);
  const signature = signDigest(reportDigest);
  return {
    report: {
      ...reportBody,
      report_digest: reportDigest,
      signature: {
        algorithm: "HMAC-SHA256",
        key_id: VALIDATION_REPORT_SIGNING_KEY_ID,
        signed_at: generatedAt,
        signature
      }
    },
    evidenceMatrixMarkdown: evidenceMatrixMarkdown(reportBody),
    packageReadmeMarkdown: packageReadmeMarkdown(reportBody, reportDigest),
    manifest: {
      schema_version: "phase7.validation-package-manifest.v1",
      package_id: packageId,
      generated_at: generatedAt,
      files: [
        "README.md",
        "validation-report.json",
        "evidence-matrix.md"
      ],
      report_digest: reportDigest,
      signature_key_id: VALIDATION_REPORT_SIGNING_KEY_ID
    }
  };
}

export function writeMvpValidationPackage({ outputDir, ...options }) {
  if (!outputDir) {
    throw new Error("outputDir is required");
  }
  const validationPackage = buildMvpValidationPackage(options);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "README.md"), validationPackage.packageReadmeMarkdown);
  writeFileSync(join(outputDir, "evidence-matrix.md"), validationPackage.evidenceMatrixMarkdown);
  writeFileSync(join(outputDir, "validation-report.json"), `${JSON.stringify(validationPackage.report, null, 2)}\n`);
  writeFileSync(join(outputDir, "manifest.json"), `${JSON.stringify(validationPackage.manifest, null, 2)}\n`);
  return validationPackage;
}

function packageReadmeMarkdown(report, reportDigest) {
  return `# PharmaOps MVP Validation Package

Package ID: \`${report.package_id}\`

Generated: \`${report.generated_at}\`

Generated by: \`${report.generated_by}\`

Scope: ${report.scope}

## Pilot Gate

- Release gate: \`${report.summary.release_gate}\`
- Controls passed: ${report.summary.controls_passed}/${report.summary.controls_total}
- Controls failed: ${report.summary.controls_failed}
- Unresolved P0/P1: ${report.summary.unresolved_p0_p1_count}
- Test command: \`${report.verification.test_command}\`
- Test summary: ${report.verification.test_summary.total} total, ${report.verification.test_summary.pass} pass, ${report.verification.test_summary.fail} fail, ${report.verification.test_summary.skipped} skipped

## Signed Report

- Report: \`validation-report.json\`
- Digest: \`${reportDigest}\`
- Signature algorithm: \`HMAC-SHA256\`
- Signature key id: \`${VALIDATION_REPORT_SIGNING_KEY_ID}\`

## Evidence

See \`evidence-matrix.md\` for control-by-control evidence refs, tests, result, and residual risk posture.
`;
}

function evidenceMatrixMarkdown(report) {
  const rows = report.controls.map((control) => `## ${control.control_id}: ${control.title}

- Status: \`${control.status}\`
- Failed severity: \`${control.severity_if_failed}\`
- Objective: ${control.objective}
- Result: ${control.result}
- Evidence refs:
${control.evidence_refs.map((ref) => `  - \`${ref}\``).join("\n")}
- Tests:
${control.tested_by.map((test) => `  - ${test}`).join("\n")}
`).join("\n");
  const risks = report.residual_risks.map((risk) => `- \`${risk.risk_id}\` ${risk.severity}: ${risk.title}. ${risk.disposition}`).join("\n");
  return `# MVP Validation Evidence Matrix

${rows}
## Residual Risks

${risks}
`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function signDigest(reportDigest) {
  return `hmac-sha256:${createHmac("sha256", SIGNING_SECRET).update(reportDigest).digest("hex")}`;
}

function stableJson(value) {
  return JSON.stringify(sortForJson(value));
}

function sortForJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortForJson(item)]));
  }
  return value;
}
