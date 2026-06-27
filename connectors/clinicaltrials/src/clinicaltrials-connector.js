import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ConnectorBase, ConnectorRetryableError } from "../../../packages/connector-sdk/src/index.js";
import { stableDigest } from "../../../services/ingestion/src/index.js";
import {
  CLINICALTRIALS_API_VERSION,
  CLINICALTRIALS_LICENSE_CLASSIFICATION,
  CLINICALTRIALS_SNAPSHOT_DATE,
  CLINICALTRIALS_SOURCE_VERSION,
  normalizeClinicalTrialRecord,
  parseClinicalTrialsPayload
} from "./parser.js";

export const clinicalTrialsConnectorMetadata = Object.freeze({
  connector_name: "clinicaltrials_gov",
  connector_version: "0.1.0",
  parser_version: "clinicaltrials-v2-parser.v1",
  normalization_ruleset_version: "clinicaltrials-normalizer.v1",
  source_name: "ClinicalTrials.gov",
  source_version: CLINICALTRIALS_SOURCE_VERSION,
  source_version_strategy: "retrieval_timestamp",
  license_classification: CLINICALTRIALS_LICENSE_CLASSIFICATION,
  materialization_policy: "materialize",
  sensitivity_classification: "public",
  retention_class: "public_source_snapshot",
  raw_artifact_policy: "persist",
  ai_use_policy: "allowed_with_attribution",
  disclaimer_ids: ["source_limit:clinicaltrials_registry_context"],
  permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
  export_restrictions: ["attribution_required"],
  source_terms_uri: "https://clinicaltrials.gov/data-api/about-api"
});

export class ClinicalTrialsGovConnector extends ConnectorBase {
  constructor({
    fixturePath = new URL("../fixtures/clinicaltrials-gov-v2-studies.json", import.meta.url),
    failFetchAttempts = 0,
    includeInvalidRecords = true,
    metadata = clinicalTrialsConnectorMetadata,
    ...options
  } = {}) {
    super({ metadata, ...options });
    this.fixturePath = fixturePath;
    this.failFetchAttempts = failFetchAttempts;
    this.includeInvalidRecords = includeInvalidRecords;
    this.fetchAttempts = 0;
    this.id = metadata.connector_name;
    this.connectorId = metadata.connector_name;
    this.name = metadata.connector_name;
    this.version = metadata.connector_version;
    this.sourceName = metadata.source_name;
    this.sourceVersion = metadata.source_version;
    this.parserVersion = metadata.parser_version;
    this.normalizationRulesetVersion = metadata.normalization_ruleset_version;
    this.sourceSnapshotDigest = stableDigest({
      api_version: CLINICALTRIALS_API_VERSION,
      snapshot_date: CLINICALTRIALS_SNAPSHOT_DATE,
      fixture_path: fileURLToPath(this.fixturePath)
    });
    this.sourcePolicy = metadata.source_name;
    this.requestedUses = ["ingest", "persist_raw", "materialize", "normalize"];
    this.legalApprovalId = null;
    this.aiPolicyApproved = false;
  }

  async fetch() {
    this.fetchAttempts += 1;
    if (this.fetchAttempts <= this.failFetchAttempts) {
      throw new ConnectorRetryableError("ClinicalTrials.gov fixture source temporarily unavailable");
    }
    return {
      raw: await readFile(this.fixturePath, "utf8"),
      content_type: "application/json",
      source_uri: this.fixturePath.href
    };
  }

  async parse({ raw }) {
    const parsed = parseClinicalTrialsPayload(raw);
    return {
      records: this.includeInvalidRecords ? parsed.records : parsed.records.filter((record) => record.source_record_id),
      next_cursor: parsed.next_cursor
    };
  }

  async normalizeRecord(input) {
    const sourceRecord = input?.sourceRecord ?? input;
    const normalized = normalizeClinicalTrialRecord(sourceRecord);
    return {
      contains_phi_or_pii: sourceRecord.contains_phi_or_pii,
      pii_flags: sourceRecord.pii_flags,
      normalized_record: normalized,
      candidate_entities: normalized.candidate_entities,
      candidate_relationships: normalized.candidate_relationships,
      candidate_mappings: normalized.candidate_mappings,
      warnings: [
        ...(sourceRecord.warnings ?? []),
        ...(sourceRecord.contains_phi_or_pii ? ["clinicaltrials_embedded_contact_pii_flagged_for_policy_gate"] : [])
      ],
      disclaimer_ids: sourceRecord.disclaimer_ids ?? []
    };
  }

  async *fetchRecords() {
    this.fetchAttempts += 1;
    if (this.fetchAttempts <= this.failFetchAttempts) {
      throw new ConnectorRetryableError("ClinicalTrials.gov fixture source temporarily unavailable");
    }
    const raw = await readFile(this.fixturePath, "utf8");
    const parsed = parseClinicalTrialsPayload(raw);
    for (const record of parsed.records) {
      yield record;
    }
  }
}

export function createClinicalTrialsGovConnector(options = {}) {
  return new ClinicalTrialsGovConnector(options);
}
