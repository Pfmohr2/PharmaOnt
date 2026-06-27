import { readFile } from "node:fs/promises";
import { ConnectorBase } from "./base-connector.js";

export class FixtureConnector extends ConnectorBase {
  constructor({ fixturePath, metadata, ...options }) {
    super({ metadata, ...options });
    this.fixturePath = fixturePath;
  }

  async fetch() {
    return {
      raw: await readFile(this.fixturePath, "utf8"),
      content_type: "application/json",
      source_uri: this.fixturePath
    };
  }

  async parse({ raw }) {
    const payload = JSON.parse(raw);
    return {
      records: payload.records.map((record) => ({
        ...record,
        source_record_uri: record.source_record_uri ?? null,
        warnings: record.warnings ?? []
      })),
      next_cursor: payload.next_cursor ?? null
    };
  }

  async normalizeRecord({ sourceRecord }) {
    const evidenceId = `fixture-evidence:${sourceRecord.source_record_id}`;
    const provenanceId = `fixture-provenance:${sourceRecord.source_record_id}`;
    return {
      normalized_record: {
        source_id: sourceRecord.source_record_id,
        label: sourceRecord.label,
        entity_class: sourceRecord.entity_class,
        identifiers: sourceRecord.identifiers ?? []
      },
      candidate_entities: [
        {
          candidate_id: `candidate:${sourceRecord.source_record_id}`,
          entity_class: sourceRecord.entity_class ?? "other",
          source_label: sourceRecord.label,
          source_identifiers: sourceRecord.identifiers ?? [],
          raw_source_identifiers: sourceRecord.raw_identifiers ?? [],
          preferred_identifier_hint: sourceRecord.identifiers?.[0] ?? null,
          synonyms: sourceRecord.synonyms ?? [],
          confidence_score: 0.99,
          evidence_ids: [evidenceId],
          evidence_refs: [
            {
              evidence_id: evidenceId,
              evidence_role: "supports",
              required_for_release: true
            }
          ],
          provenance_id: provenanceId,
          warnings: sourceRecord.warnings ?? [],
          provenance: {
            source_record_id: sourceRecord.source_record_id,
            source_record_uri: sourceRecord.source_record_uri ?? null
          }
        }
      ],
      candidate_relationships: [],
      candidate_mappings: [],
      warnings: sourceRecord.disclaimer_ids?.map((id) => `source_disclaimer:${id}`) ?? [],
      evidence_flags: sourceRecord.evidence_flags ?? {},
      disclaimer_ids: sourceRecord.disclaimer_ids ?? []
    };
  }
}
