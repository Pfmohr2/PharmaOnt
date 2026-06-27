import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertGraphTenant, assertReleaseGraph, assertWritableWorkingGraph, tenantReleaseGraph } from "./named-graphs.js";
import { NoopReleaseLedger } from "./release-ledger.js";

export class ReleaseSnapshotService {
  constructor({
    fusekiClient,
    shaclRunner,
    releaseLedger = new NoopReleaseLedger(),
    manifestRoot = new URL("../../../services/semantic-store/release-packages/", import.meta.url)
  }) {
    this.fuseki = fusekiClient;
    this.shaclRunner = shaclRunner;
    this.releaseLedger = releaseLedger;
    this.manifestRoot = manifestRoot;
  }

  async createReleaseSnapshot({
    tenantId,
    releaseId,
    workingGraph,
    domain = "canonical",
    previousReleaseId = null,
    rollbackTargetReleaseId = previousReleaseId,
    sourceVersionPins = [],
    approvalTrace = [],
    validationReportRefs = [],
    auditEventRange = {},
    environment = "test",
    releaseCandidateId = null,
    ontologyDigest = null,
    shapeDigest = null,
    changelogUri = null,
    createdBy = "service_account:semantic-store",
    createdByUserId = null,
    createdByServiceAccountId = "00000000-0000-0000-0000-000000000001"
  }) {
    assertWritableWorkingGraph(workingGraph);
    assertGraphTenant(workingGraph, tenantId);
    assertRequiredReleaseEvidence({
      sourceVersionPins,
      approvalTrace,
      validationReportRefs,
      auditEventRange
    });
    assertOneCreator({ createdByUserId, createdByServiceAccountId });
    const releaseGraph = tenantReleaseGraph(tenantId, releaseId, domain);
    assertReleaseGraph(releaseGraph);

    if (await this.fuseki.graphHasTriples(releaseGraph)) {
      throw new Error(`release graph already exists and is immutable: ${releaseGraph}`);
    }

    await this.assertNoModelSuggestedPublication(workingGraph);
    const workingTurtle = await this.fuseki.getGraph(workingGraph);
    const validation = this.shaclRunner.validateTurtle(workingTurtle, { fixtureName: `${workingGraph}.ttl` });
    if (!validation.valid) {
      throw new Error(`working graph failed release validation: ${validation.errors.join("; ")}`);
    }
    assertSourceVersionReconciliation(workingTurtle, sourceVersionPins);

    const releaseGraphDigest = sha256(workingTurtle);
    const manifest = {
      schema_version: "release-package.v1",
      release_id: releaseId,
      manifest_id: `release-manifest:${releaseId}:${randomUUID()}`,
      tenant_id: tenantId,
      environment,
      created_at: new Date().toISOString(),
      created_by: createdBy,
      status: "candidate",
      semantic_version: releaseId,
      release_candidate_id: releaseCandidateId,
      previous_release_id: previousReleaseId,
      rollback_target_release_id: rollbackTargetReleaseId,
      ontology_digest: ontologyDigest,
      shape_digest: shapeDigest,
      included_graphs: [
        {
          graph_name: releaseGraph,
          source_graph_name: workingGraph,
          graph_role: domain,
          digest: releaseGraphDigest
        }
      ],
      source_version_pins: sourceVersionPins,
      validation_report_refs: validationReportRefs,
      changelog_uri: changelogUri,
      artifact_hashes: {
        [releaseGraph]: releaseGraphDigest
      },
      approval_trace: approvalTrace,
      audit_event_range: auditEventRange
    };
    const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestDigest = sha256(manifestBytes);
    const manifestUri = this.writeManifest(releaseId, manifestBytes);
    const storedManifestDigest = sha256(readFileSync(manifestUri, "utf8"));
    if (storedManifestDigest !== manifestDigest) {
      throw new Error(`release manifest digest mismatch: computed ${manifestDigest}, stored ${storedManifestDigest}`);
    }
    const releaseMetadataRecord = {
      release_id: releaseId,
      tenant_id: tenantId,
      environment,
      semantic_version: releaseId,
      status: "candidate",
      release_candidate_id: releaseCandidateId,
      previous_release_id: previousReleaseId,
      manifest_uri: manifestUri,
      manifest_digest: manifestDigest,
      ontology_digest: ontologyDigest,
      shape_digest: shapeDigest,
      source_version_pins: sourceVersionPins,
      included_graphs: manifest.included_graphs,
      validation_report_refs: validationReportRefs,
      changelog_uri: changelogUri,
      artifact_hashes: manifest.artifact_hashes,
      approval_trace: approvalTrace,
      audit_event_range: auditEventRange,
      rollback_target_release_id: rollbackTargetReleaseId,
      created_by_user_id: createdByUserId,
      created_by_service_account_id: createdByServiceAccountId
    };
    const persistedReleaseMetadataRecord = await this.releaseLedger.insertReleaseMetadata(releaseMetadataRecord);
    if (persistedReleaseMetadataRecord.manifest_digest !== manifestDigest) {
      throw new Error(`release ledger digest mismatch: manifest ${manifestDigest}, ledger ${persistedReleaseMetadataRecord.manifest_digest}`);
    }
    await this.fuseki.copyGraph(workingGraph, releaseGraph);
    return {
      release_id: releaseId,
      release_graph: releaseGraph,
      manifest_uri: manifestUri,
      manifest_digest: manifestDigest,
      artifact_hashes: manifest.artifact_hashes,
      release_metadata_record: persistedReleaseMetadataRecord
    };
  }

  async assertNoModelSuggestedPublication(graphName) {
    const result = await this.fuseki.query(`
PREFIX pharm: <https://w3id.org/pharmaops/ontology/core#>
ASK WHERE {
  GRAPH <${graphName}> {
    ?s ?p ?o .
    {
      ?s pharm:assertionType "model_suggested" .
    } UNION {
      ?s pharm:hasProvenance ?prov .
      ?prov pharm:methodType "model" .
    }
  }
}`);
    if (result.boolean) {
      throw new Error(`model_suggested or model-method assertions cannot enter release graph from ${graphName}`);
    }
  }

  writeManifest(releaseId, manifestBytes) {
    const rootPath = this.manifestRoot instanceof URL ? fileURLToPath(this.manifestRoot) : this.manifestRoot;
    const path = join(rootPath, `${releaseId}.manifest.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, manifestBytes, { flag: "wx" });
    return path;
  }
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function assertRequiredReleaseEvidence({
  sourceVersionPins,
  approvalTrace,
  validationReportRefs,
  auditEventRange
}) {
  if (!Array.isArray(sourceVersionPins) || sourceVersionPins.length === 0) {
    throw new Error("release snapshot requires at least one source version pin");
  }
  if (!Array.isArray(approvalTrace) || approvalTrace.length === 0) {
    throw new Error("release snapshot requires at least one approval trace entry");
  }
  if (!Array.isArray(validationReportRefs) || validationReportRefs.length === 0) {
    throw new Error("release snapshot requires at least one validation report reference");
  }
  if (!auditEventRange || typeof auditEventRange !== "object" || !auditEventRange.first || !auditEventRange.last) {
    throw new Error("release snapshot requires audit event range with first and last event identifiers");
  }
}

export function assertOneCreator({ createdByUserId, createdByServiceAccountId }) {
  const hasUser = Boolean(createdByUserId);
  const hasServiceAccount = Boolean(createdByServiceAccountId);
  if (hasUser === hasServiceAccount) {
    throw new Error("release metadata requires exactly one creator: created_by_user_id or created_by_service_account_id");
  }
}

export function assertSourceVersionReconciliation(turtle, sourceVersionPins) {
  const pins = new Set(sourceVersionPins.map((pin) => `${pin.source_name}\u0000${pin.source_version}`));
  const errors = [];
  const provenanceBlocks = [...turtle.matchAll(/pharm:hasProvenance\s+\[([\s\S]*?)\]\s*[.;]/g)].map((match) => match[1]);
  if (provenanceBlocks.length === 0) {
    errors.push("no provenance blocks found for released assertions");
  }

  for (const block of provenanceBlocks) {
    const provenanceId = literalFor(block, "pharm:provenanceId") ?? "unknown provenance";
    const sourceName = literalFor(block, "pharm:sourceName");
    const sourceVersion = literalFor(block, "pharm:sourceVersion");
    const requiredFields = [
      ["pharm:sourceName", sourceName],
      ["pharm:sourceVersion", sourceVersion],
      ["pharm:auditEventId", literalFor(block, "pharm:auditEventId")],
      ["pharm:actor", literalFor(block, "pharm:actor")],
      ["pharm:methodType", literalFor(block, "pharm:methodType")]
    ];
    for (const [field, value] of requiredFields) {
      if (!value) {
        errors.push(`${provenanceId} missing ${field}`);
      }
    }
    if (sourceName && sourceVersion && !pins.has(`${sourceName}\u0000${sourceVersion}`)) {
      errors.push(`${provenanceId} source ${sourceName}@${sourceVersion} is not covered by release source_version_pins`);
    }
  }

  const evidenceBlocks = blocksWithType(turtle, "pharm:DocumentEvidenceSource");
  for (const block of evidenceBlocks) {
    const evidenceId = literalFor(block, "pharm:evidenceId") ?? "unknown evidence";
    const sourceName = literalFor(block, "pharm:evidenceSourceName");
    const sourceVersion = literalFor(block, "pharm:evidenceSourceVersion");
    const requiredFields = [
      ["pharm:evidenceSourceName", sourceName],
      ["pharm:evidenceSourceVersion", sourceVersion],
      ["pharm:sourceRecordId", literalFor(block, "pharm:sourceRecordId")],
      ["pharm:licenseClassification", literalFor(block, "pharm:licenseClassification")],
      ["pharm:disclaimerId", literalFor(block, "pharm:disclaimerId")]
    ];
    for (const [field, value] of requiredFields) {
      if (!value) {
        errors.push(`${evidenceId} missing ${field}`);
      }
    }
    if (sourceName && sourceVersion && !pins.has(`${sourceName}\u0000${sourceVersion}`)) {
      errors.push(`${evidenceId} evidence source ${sourceName}@${sourceVersion} is not covered by release source_version_pins`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`source-version reconciliation failed: ${errors.join("; ")}`);
  }
}

function literalFor(turtleBlock, predicate) {
  return new RegExp(`${escapeRegExp(predicate)}\\s+"([^"]+)"`).exec(turtleBlock)?.[1] ?? null;
}

function blocksWithType(turtle, rdfType) {
  const blocks = [];
  const statements = turtle.split(/\n(?=[^\s][^\n]*\n\s+a\s+)/);
  for (const statement of statements) {
    if (new RegExp(`\\ba\\s+${escapeRegExp(rdfType)}\\b`).test(statement)) {
      blocks.push(statement);
    }
  }
  return blocks;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
