export const CLINICALTRIALS_API_VERSION = "ClinicalTrials.gov API v2";
export const CLINICALTRIALS_SNAPSHOT_DATE = "2026-06-27";
export const CLINICALTRIALS_SOURCE_VERSION = `${CLINICALTRIALS_API_VERSION}; snapshot=${CLINICALTRIALS_SNAPSHOT_DATE}`;
export const CLINICALTRIALS_LICENSE_CLASSIFICATION = "open_with_attribution";

const SOURCE_BASE_URI = "https://clinicaltrials.gov/study/";

export function parseClinicalTrialsPayload(raw) {
  const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  const studies = Array.isArray(payload?.studies) ? payload.studies : [];
  return {
    api_version: payload.source_api_version ?? CLINICALTRIALS_API_VERSION,
    snapshot_date: payload.snapshot_date ?? CLINICALTRIALS_SNAPSHOT_DATE,
    records: studies.map((study, index) => toSourceRecord(study, index)),
    next_cursor: payload.nextPageToken ?? null
  };
}

export function normalizeClinicalTrialRecord(record) {
  if (!record.source_record_id) {
    throw new Error("ClinicalTrials.gov record missing NCT ID");
  }
  if (!record.source_version) {
    throw new Error("ClinicalTrials.gov record missing pinned source_version");
  }

  const nctId = record.source_record_id;
  const conditionLabels = record.conditions;
  const interventionLabels = record.interventions.map((intervention) => intervention.name).filter(Boolean);
  const evidenceId = `pharmev:clinicaltrials/${nctId}`;
  const provenanceId = `pharmprov:clinicaltrials/${nctId}`;
  const evidenceRefs = [
    {
      evidence_id: evidenceId,
      evidence_role: "source_only",
      required_for_release: true
    }
  ];

  return {
    nct_id: nctId,
    title: record.brief_title,
    label: record.brief_title,
    entity_class: "clinical_trial",
    source_version: record.source_version,
    api_version: record.api_version,
    snapshot_date: record.snapshot_date,
    overall_status: record.overall_status,
    phase: record.phase,
    conditions: conditionLabels,
    interventions: record.interventions,
    has_results: record.has_results,
    contains_phi_or_pii: record.contains_phi_or_pii,
    pii_flags: record.pii_flags,
    identifiers: [`nct:${nctId}`],
    evidence_ids: [evidenceId],
    evidence_refs: evidenceRefs,
    provenance_id: provenanceId,
    candidate_entities: [
      {
        candidate_id: `candidate:trial:${nctId}`,
        entity_class: "trial",
        source_label: record.brief_title,
        source_identifiers: [`nct:${nctId}`],
        raw_source_identifiers: [nctId],
        preferred_identifier_hint: `nct:${nctId}`,
        synonyms: [],
        confidence_score: 1,
        evidence_ids: [evidenceId],
        evidence_refs: evidenceRefs,
        provenance_id: provenanceId,
        review_status: "proposed"
      }
    ],
    candidate_relationships: [
      ...conditionLabels.map((condition, index) => ({
        candidate_id: `candidate:relationship:${nctId}:condition:${index + 1}`,
        subject_ref: `nct:${nctId}`,
        predicate_hint: "trial_studies_condition",
        object_ref: condition,
        relationship_source_text: condition,
        confidence_score: 0.8,
        evidence_ids: [evidenceId],
        evidence_refs: [{ ...evidenceRefs[0], evidence_role: "supports" }],
        provenance_id: provenanceId,
        review_status: "proposed"
      })),
      ...interventionLabels.map((intervention, index) => ({
        candidate_id: `candidate:relationship:${nctId}:intervention:${index + 1}`,
        subject_ref: `nct:${nctId}`,
        predicate_hint: "trial_uses_intervention",
        object_ref: intervention,
        relationship_source_text: intervention,
        confidence_score: 0.8,
        evidence_ids: [evidenceId],
        evidence_refs: [{ ...evidenceRefs[0], evidence_role: "supports" }],
        provenance_id: provenanceId,
        review_status: "proposed"
      }))
    ],
    candidate_mappings: []
  };
}

function toSourceRecord(study, index) {
  const protocol = study?.protocolSection ?? {};
  const identification = protocol.identificationModule ?? {};
  const status = protocol.statusModule ?? {};
  const conditions = protocol.conditionsModule?.conditions ?? [];
  const interventions = protocol.armsInterventionsModule?.interventions ?? [];
  const phases = protocol.designModule?.phases ?? [];
  const nctId = identification.nctId ?? "";
  const piiFlags = detectContactPii(protocol);

  return {
    source_record_id: nctId,
    source_record_uri: nctId ? `${SOURCE_BASE_URI}${nctId}` : null,
    source_retrieved_at: `${CLINICALTRIALS_SNAPSHOT_DATE}T00:00:00.000Z`,
    source_version: CLINICALTRIALS_SOURCE_VERSION,
    source_version_strategy: "retrieval_timestamp",
    license_classification: CLINICALTRIALS_LICENSE_CLASSIFICATION,
    raw_artifact: study,
    raw_artifact_content_type: "application/json",
    raw_record: study,
    api_version: CLINICALTRIALS_API_VERSION,
    snapshot_date: CLINICALTRIALS_SNAPSHOT_DATE,
    brief_title: identification.briefTitle ?? (nctId || `ClinicalTrials.gov record ${index + 1}`),
    overall_status: status.overallStatus ?? "UNKNOWN",
    phase: phases[0] ?? "NOT_APPLICABLE",
    conditions,
    interventions,
    has_results: Boolean(study?.hasResults),
    contains_phi_or_pii: piiFlags.length > 0,
    pii_flags: piiFlags,
    disclaimer_ids: ["source_limit:clinicaltrials_registry_context"],
    warnings: piiFlags.length > 0 ? [`clinicaltrials_contact_pii_detected:${piiFlags.join(",")}`] : [],
    retrieval_context: {
      api_version: CLINICALTRIALS_API_VERSION,
      snapshot_date: CLINICALTRIALS_SNAPSHOT_DATE,
      fixture_record_index: index
    }
  };
}

function detectContactPii(protocol) {
  const flags = [];
  const contacts = protocol.contactsLocationsModule ?? {};
  if (Array.isArray(contacts.centralContacts) && contacts.centralContacts.length > 0) {
    flags.push("central_contacts");
  }
  if (Array.isArray(contacts.overallOfficials) && contacts.overallOfficials.some((official) => official?.name)) {
    flags.push("overall_official_names");
  }
  return flags;
}
