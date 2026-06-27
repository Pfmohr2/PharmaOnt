import { readFile } from "node:fs/promises";

import { ConnectorBase, sha256 } from "../../../packages/connector-sdk/src/index.js";
import { DEFAULT_SOURCE_POLICIES } from "../../../packages/licensing/src/index.js";
import { buildChemblNormalizedRecord, parseChemblPayload } from "./parser.js";

export const CHEMBL_SOURCE_VERSION = "CHEMBL_34";
export const CHEMBL_CONNECTOR_ID = "chembl";

export function chemblMetadata({ sourceVersion = CHEMBL_SOURCE_VERSION } = {}) {
  assertSourceVersion(sourceVersion);
  const policy = DEFAULT_SOURCE_POLICIES.chembl;
  return {
    connector_name: "chembl",
    connector_version: "0.1.0",
    parser_version: "chembl-parser.v1",
    normalization_ruleset_version: "chembl-compound-normalizer.v1",
    source_name: "ChEMBL",
    source_version: sourceVersion,
    source_version_strategy: "release",
    license_classification: policy.license_classification,
    materialization_policy: policy.materialization_policy,
    sensitivity_classification: policy.sensitivity_classification,
    retention_class: policy.retention_class,
    raw_artifact_policy: policy.raw_artifact_policy,
    ai_use_policy: policy.ai_use_policy,
    disclaimer_ids: policy.disclaimer_ids,
    permitted_uses: policy.permitted_uses,
    export_restrictions: policy.export_restrictions,
    source_terms_uri: "https://chembl.gitbook.io/chembl-interface-documentation/downloads"
  };
}

export class ChemblConnector extends ConnectorBase {
  constructor({
    fixturePath = null,
    fixturePayload = null,
    sourceVersion = CHEMBL_SOURCE_VERSION,
    sourceSnapshotDigest = null,
    failFetchAttempts = 0,
    clock = () => new Date(),
    ...options
  } = {}) {
    assertSourceVersion(sourceVersion);
    const metadata = options.metadata ?? chemblMetadata({ sourceVersion });
    super({ ...options, metadata, clock });
    this.id = CHEMBL_CONNECTOR_ID;
    this.connectorId = CHEMBL_CONNECTOR_ID;
    this.name = "chembl";
    this.version = metadata.connector_version;
    this.sourceName = metadata.source_name;
    this.sourceVersion = metadata.source_version;
    this.sourceSnapshotDigest = sourceSnapshotDigest ?? sha256(`ChEMBL|${metadata.source_version}|fixture`);
    this.parserVersion = metadata.parser_version;
    this.normalizationRulesetVersion = metadata.normalization_ruleset_version;
    this.sourcePolicy = DEFAULT_SOURCE_POLICIES.chembl;
    this.requestedUses = ["ingest", "persist_raw", "materialize", "normalize"];
    this.fixturePath = fixturePath;
    this.fixturePayload = fixturePayload;
    this.failFetchAttempts = failFetchAttempts;
    this.fetchAttempts = 0;
    this.clock = clock;
  }

  async fetch() {
    this.fetchAttempts += 1;
    if (this.fetchAttempts <= this.failFetchAttempts) {
      throw new Error("transient ChEMBL fixture fetch failure");
    }
    if (this.fixturePayload) {
      return {
        raw: this.fixturePayload,
        content_type: "application/json",
        source_uri: "memory://chembl-fixture"
      };
    }
    if (!this.fixturePath) {
      throw new Error("ChEMBL connector requires fixturePath for offline execution");
    }
    return {
      raw: await readFile(this.fixturePath, "utf8"),
      content_type: "application/json",
      source_uri: this.fixturePath.href ?? String(this.fixturePath)
    };
  }

  async parse({ raw }) {
    const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      records: parseChemblPayload(payload, {
        sourceVersion: this.metadata.source_version,
        retrievedAt: this.clock().toISOString()
      }),
      next_cursor: payload?.molecule_response?.page_meta?.next ?? null
    };
  }

  async normalizeRecord(input) {
    const sourceRecord = input?.sourceRecord ?? input;
    const normalized = buildChemblNormalizedRecord(sourceRecord);
    return input?.sourceRecord ? normalized : normalized.normalized_record;
  }

  async *fetchRecords() {
    const fetched = await this.fetch();
    const parsed = await this.parse({ raw: fetched.raw });
    for (const sourceRecord of parsed.records) {
      const normalized = buildChemblNormalizedRecord(sourceRecord);
      yield {
        source_name: this.metadata.source_name,
        source_version: this.metadata.source_version,
        source_record_id: sourceRecord.source_record_id,
        source_record_uri: sourceRecord.source_record_uri,
        source_retrieved_at: sourceRecord.source_retrieved_at,
        license_classification: this.metadata.license_classification,
        materialization_policy: this.metadata.materialization_policy,
        sensitivity_classification: this.metadata.sensitivity_classification,
        retention_class: this.metadata.retention_class,
        raw_artifact_policy: this.metadata.raw_artifact_policy,
        source_version_strategy: this.metadata.source_version_strategy,
        ai_use_policy: this.metadata.ai_use_policy,
        permitted_uses: this.metadata.permitted_uses,
        export_restrictions: this.metadata.export_restrictions,
        disclaimer_ids: this.metadata.disclaimer_ids,
        raw_artifact: sourceRecord.raw_record,
        normalized_record: normalized.normalized_record,
        candidate_entities: normalized.candidate_entities,
        candidate_relationships: normalized.candidate_relationships,
        candidate_mappings: normalized.candidate_mappings,
        warnings: normalized.warnings,
        provenance: {
          source_name: this.metadata.source_name,
          source_version: this.metadata.source_version,
          source_record_id: sourceRecord.source_record_id,
          source_record_uri: sourceRecord.source_record_uri,
          connector_name: this.metadata.connector_name,
          connector_version: this.metadata.connector_version,
          parser_version: this.metadata.parser_version,
          normalization_ruleset_version: this.metadata.normalization_ruleset_version,
          source_terms_uri: this.metadata.source_terms_uri
        }
      };
    }
  }
}

function assertSourceVersion(sourceVersion) {
  if (typeof sourceVersion !== "string" || sourceVersion.trim().length === 0) {
    throw new Error("ChEMBL source_version must be pinned before connector execution");
  }
}
