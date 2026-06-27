export function parseChemblPayload(payload, { sourceVersion, retrievedAt }) {
  if (!sourceVersion) {
    throw new Error("ChEMBL source_version is required before parsing");
  }
  const moleculeResponse = payload?.molecule_response ?? payload;
  const activityResponse = payload?.activity_response ?? { activities: [] };
  const molecules = Array.isArray(moleculeResponse?.molecules) ? moleculeResponse.molecules : [];
  const activities = Array.isArray(activityResponse?.activities) ? activityResponse.activities : [];
  const activitiesByMolecule = groupActivitiesByMolecule(activities);

  return molecules.map((molecule, index) => {
    const chemblId = stringOrEmpty(molecule.molecule_chembl_id);
    const sourceRecordUri = chemblId
      ? `https://www.ebi.ac.uk/chembl/api/data/molecule/${encodeURIComponent(chemblId)}.json`
      : null;
    return {
      source_record_id: chemblId,
      source_record_uri: sourceRecordUri,
      source_retrieved_at: retrievedAt,
      source_version: sourceVersion,
      label: stringOrNull(molecule.pref_name) ?? chemblId,
      entity_class: "compound",
      raw_record: {
        molecule,
        activities: activitiesByMolecule.get(chemblId) ?? []
      },
      molecule,
      activities: activitiesByMolecule.get(chemblId) ?? [],
      identifiers: chemblId ? [`chembl.compound:${chemblId}`] : [],
      synonyms: moleculeSynonyms(molecule),
      retrieval_context: {
        page: moleculeResponse?.page_meta?.next ? "paged" : "fixture",
        molecule_index: index,
        source_version: sourceVersion
      },
      warnings: []
    };
  });
}

export function buildChemblNormalizedRecord(sourceRecord) {
  const molecule = sourceRecord.molecule ?? sourceRecord.raw_record?.molecule ?? {};
  const activities = sourceRecord.activities ?? sourceRecord.raw_record?.activities ?? [];
  const chemblId = sourceRecord.source_record_id;
  const evidenceId = `chembl-evidence:${chemblId}`;
  const provenanceId = `chembl-provenance:${chemblId}`;
  const normalizedRecord = {
    source_id: chemblId,
    label: sourceRecord.label,
    entity_class: "compound",
    identifiers: sourceRecord.identifiers ?? [],
    synonyms: sourceRecord.synonyms ?? [],
    source_version: sourceRecord.source_version,
    license_classification: "open_with_attribution",
    materialization_policy: "materialize",
    sensitivity_classification: "public",
    retention_class: "public_source_snapshot",
    raw_artifact_policy: "persist",
    source_version_strategy: "release",
    ai_use_policy: "allowed_with_attribution",
    permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
    export_restrictions: ["attribution_required"],
    disclaimer_ids: ["source_terms:chembl"],
    contains_phi_or_pii: false,
    molecule_type: molecule.molecule_type ?? null,
    max_phase: molecule.max_phase ?? null,
    first_approval: molecule.first_approval ?? null,
    structures: {
      canonical_smiles: molecule.molecule_structures?.canonical_smiles ?? null,
      standard_inchi: molecule.molecule_structures?.standard_inchi ?? null,
      standard_inchi_key: molecule.molecule_structures?.standard_inchi_key ?? null
    },
    activity_summary: activities.map((activity) => ({
      activity_id: activity.activity_id ?? null,
      target_chembl_id: activity.target_chembl_id ?? null,
      target_pref_name: activity.target_pref_name ?? null,
      standard_type: activity.standard_type ?? null,
      standard_relation: activity.standard_relation ?? null,
      standard_value: activity.standard_value ?? null,
      standard_units: activity.standard_units ?? null,
      pchembl_value: activity.pchembl_value ?? null,
      assay_chembl_id: activity.assay_chembl_id ?? null,
      document_chembl_id: activity.document_chembl_id ?? null
    }))
  };

  return {
    normalized_record: normalizedRecord,
    candidate_entities: [
      {
        candidate_id: `candidate:chembl.compound:${chemblId}`,
        entity_class: "compound",
        source_label: sourceRecord.label,
        source_identifiers: sourceRecord.identifiers ?? [],
        raw_source_identifiers: [chemblId].filter(Boolean),
        preferred_identifier_hint: chemblId ? `chembl.compound:${chemblId}` : null,
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
        provenance: {
          source_name: "ChEMBL",
          source_version: sourceRecord.source_version,
          source_record_id: chemblId,
          source_record_uri: sourceRecord.source_record_uri ?? null
        }
      }
    ],
    candidate_relationships: activities
      .filter((activity) => activity.target_chembl_id)
      .map((activity) => ({
        relationship_id: `candidate:chembl.activity:${activity.activity_id ?? `${chemblId}:${activity.target_chembl_id}`}`,
        predicate: "has_activity_against",
        subject_identifier: `chembl.compound:${chemblId}`,
        object_identifier: `chembl.target:${activity.target_chembl_id}`,
        object_label: activity.target_pref_name ?? null,
        evidence_ids: [evidenceId],
        provenance_id: provenanceId,
        activity_context: {
          standard_type: activity.standard_type ?? null,
          standard_relation: activity.standard_relation ?? null,
          standard_value: activity.standard_value ?? null,
          standard_units: activity.standard_units ?? null,
          pchembl_value: activity.pchembl_value ?? null,
          assay_chembl_id: activity.assay_chembl_id ?? null,
          document_chembl_id: activity.document_chembl_id ?? null
        }
      })),
    candidate_mappings: [],
    warnings: sourceRecord.warnings ?? [],
    disclaimer_ids: ["source_terms:chembl"],
    evidence_flags: {
      disclaimer_ids: ["source_terms:chembl"],
      source_version_required: true
    }
  };
}

function groupActivitiesByMolecule(activities) {
  const grouped = new Map();
  for (const activity of activities) {
    const chemblId = stringOrEmpty(activity.molecule_chembl_id);
    if (!chemblId) {
      continue;
    }
    grouped.set(chemblId, [...(grouped.get(chemblId) ?? []), activity]);
  }
  return grouped;
}

function moleculeSynonyms(molecule) {
  const synonyms = Array.isArray(molecule.molecule_synonyms) ? molecule.molecule_synonyms : [];
  return [...new Set(synonyms.map((entry) => entry.molecule_synonym).filter(Boolean))];
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stringOrNull(value) {
  const normalized = stringOrEmpty(value);
  return normalized || null;
}
