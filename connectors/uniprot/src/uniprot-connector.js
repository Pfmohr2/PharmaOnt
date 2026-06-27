import { readFile } from "node:fs/promises";

import { ConnectorBase, sha256 } from "../../../packages/connector-sdk/src/index.js";

export const UNIPROT_SOURCE_VERSION = "2026_02";
export const UNIPROT_LICENSE_CLASSIFICATION = "open_with_attribution";

export function uniprotMetadata({ sourceVersion = UNIPROT_SOURCE_VERSION } = {}) {
  return {
    connector_name: "uniprot",
    connector_version: "0.1.0",
    parser_version: "uniprot-json.v1",
    normalization_ruleset_version: "uniprot-protein-normalizer.v1",
    source_name: "UniProt",
    source_version: sourceVersion,
    source_version_strategy: "release",
    license_classification: UNIPROT_LICENSE_CLASSIFICATION,
    materialization_policy: "materialize",
    sensitivity_classification: "public",
    retention_class: "public_source_snapshot",
    raw_artifact_policy: "persist",
    ai_use_policy: "allowed_with_attribution",
    disclaimer_ids: ["source_terms:uniprot", "source_limit:reviewed_status"],
    permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
    export_restrictions: ["attribution_required"],
    source_terms_uri: "https://www.uniprot.org/help/license"
  };
}

export class UniProtConnector extends ConnectorBase {
  constructor({
    fixturePath,
    metadata = uniprotMetadata(),
    failFetchAttempts = 0,
    ...options
  }) {
    super({ metadata, ...options });
    this.fixturePath = fixturePath;
    this.failFetchAttempts = failFetchAttempts;
    this.fetchAttempts = 0;

    this.id = "uniprot";
    this.connectorId = "uniprot";
    this.name = metadata.connector_name;
    this.version = metadata.connector_version;
    this.parserVersion = metadata.parser_version;
    this.normalizationRulesetVersion = metadata.normalization_ruleset_version;
    this.sourceName = metadata.source_name;
    this.sourceVersion = metadata.source_version;
    this.sourceSnapshotDigest = `fixture:${metadata.source_version}`;
    this.sourcePolicy = "uniprot";
    this.requestedUses = ["ingest", "persist_raw", "materialize", "normalize"];
  }

  async fetch() {
    this.fetchAttempts += 1;
    if (this.fetchAttempts <= this.failFetchAttempts) {
      const error = new Error("temporary UniProt fixture fetch failure");
      error.retryable = true;
      throw error;
    }
    return {
      raw: await readFile(this.fixturePath, "utf8"),
      content_type: "application/json",
      source_uri: this.fixturePath.href ?? String(this.fixturePath)
    };
  }

  async parse({ raw }) {
    const payload = JSON.parse(raw);
    const sourceVersion = payload.release ?? this.metadata.source_version;
    if (!sourceVersion) {
      throw new Error("UniProt source_version is required");
    }
    const results = Array.isArray(payload.results) ? payload.results : [];
    return {
      records: results.map((entry) => this.toSourceRecord(entry, sourceVersion)),
      next_cursor: payload.nextCursor ?? null
    };
  }

  async normalizeRecord(input) {
    if (!input?.sourceRecord) {
      return input.normalized_record ?? normalizeUniProtEntry(input.raw_entry ?? input, input.source_version ?? this.sourceVersion);
    }
    const sourceRecord = input.sourceRecord;
    return {
      normalized_record: sourceRecord.normalized_record ?? normalizeUniProtEntry(sourceRecord.raw_entry ?? sourceRecord, sourceRecord.source_version ?? this.sourceVersion),
      candidate_entities: [
        proteinCandidate(sourceRecord.raw_entry ?? sourceRecord, sourceRecord.source_version ?? this.sourceVersion)
      ],
      candidate_relationships: [],
      candidate_mappings: [],
      warnings: sourceRecord.warnings ?? [],
      disclaimer_ids: this.metadata.disclaimer_ids
    };
  }

  async *fetchRecords({ checkpoint = null } = {}) {
    const fetched = await this.fetch();
    const parsed = await this.parse({ raw: fetched.raw });
    let resume = checkpoint == null;
    for (const record of parsed.records) {
      if (!resume) {
        if (record.source_record_id === checkpoint) {
          resume = true;
        }
        continue;
      }
      yield record;
    }
  }

  toSourceRecord(entry, sourceVersion) {
    const accession = entry.primaryAccession;
    return {
      source_name: this.metadata.source_name,
      source_version: sourceVersion,
      source_record_id: accession,
      source_record_uri: accession ? `https://www.uniprot.org/uniprotkb/${encodeURIComponent(accession)}/entry` : null,
      source_retrieved_at: entry.entryAudit?.lastAnnotationUpdateDate ?? "2026-06-27T00:00:00.000Z",
      license_classification: this.metadata.license_classification,
      source_policy: "uniprot",
      raw_artifact: entry,
      raw_entry: entry,
      normalized_record: accession ? normalizeUniProtEntry(entry, sourceVersion) : null,
      candidate_entities: accession ? [proteinCandidate(entry, sourceVersion)] : [],
      candidate_relationships: [],
      candidate_mappings: [],
      warnings: uniprotWarnings(entry),
      disclaimer_ids: this.metadata.disclaimer_ids,
      provenance: {
        source_name: this.metadata.source_name,
        source_version: sourceVersion,
        source_record_id: accession,
        connector_name: this.metadata.connector_name,
        connector_version: this.metadata.connector_version,
        parser_version: this.metadata.parser_version,
        normalization_ruleset_version: this.metadata.normalization_ruleset_version
      }
    };
  }
}

export function normalizeUniProtEntry(entry, sourceVersion = UNIPROT_SOURCE_VERSION) {
  const accession = entry.primaryAccession;
  const proteinName = entry.proteinDescription?.recommendedName?.fullName?.value ??
    entry.proteinDescription?.submissionNames?.[0]?.fullName?.value ??
    entry.uniProtkbId ??
    accession;
  return {
    entity_class: "protein",
    accession,
    uniprot_id: entry.uniProtkbId ?? null,
    recommended_name: proteinName,
    organism: {
      scientific_name: entry.organism?.scientificName ?? null,
      taxon_id: entry.organism?.taxonId ?? null
    },
    genes: geneNames(entry),
    sequence: {
      length: entry.sequence?.length ?? null,
      checksum: entry.sequence?.checksum ?? null,
      mol_weight: entry.sequence?.molWeight ?? null
    },
    cross_references: crossReferences(entry),
    reviewed: entry.entryType === "UniProtKB reviewed (Swiss-Prot)",
    source_version: sourceVersion
  };
}

export function proteinCandidate(entry, sourceVersion = UNIPROT_SOURCE_VERSION) {
  const normalized = normalizeUniProtEntry(entry, sourceVersion);
  const accession = normalized.accession;
  return {
    candidate_id: `uniprot:${accession}`,
    entity_class: "protein",
    source_label: normalized.recommended_name,
    source_identifiers: [`uniprot:${accession}`],
    raw_source_identifiers: [accession, normalized.uniprot_id].filter(Boolean),
    preferred_identifier_hint: `uniprot:${accession}`,
    synonyms: normalized.genes,
    confidence_score: normalized.reviewed ? 0.99 : 0.9,
    evidence_ids: [`uniprot-evidence:${accession}`],
    evidence_refs: [
      {
        evidence_id: `uniprot-evidence:${accession}`,
        evidence_role: "source_only",
        required_for_release: true
      }
    ],
    provenance_id: `uniprot-provenance:${accession}:${sourceVersion}`,
    warnings: normalized.reviewed ? [] : ["source_limit:uniprot_unreviewed"],
    provenance: {
      source_name: "UniProt",
      source_version: sourceVersion,
      source_record_id: accession,
      source_record_hash: sha256(entry)
    }
  };
}

function geneNames(entry) {
  return (entry.genes ?? []).flatMap((gene) => [
    gene.geneName?.value,
    ...(gene.synonyms ?? []).map((synonym) => synonym.value)
  ]).filter(Boolean);
}

function crossReferences(entry) {
  return (entry.uniProtKBCrossReferences ?? []).map((xref) => ({
    database: xref.database,
    id: xref.id,
    properties: Object.fromEntries((xref.properties ?? []).map((property) => [property.key, property.value]))
  }));
}

function uniprotWarnings(entry) {
  return entry.entryType === "UniProtKB reviewed (Swiss-Prot)" ? [] : ["source_limit:uniprot_unreviewed"];
}
