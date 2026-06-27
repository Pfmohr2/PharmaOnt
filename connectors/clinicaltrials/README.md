# ClinicalTrials.gov Connector

Phase 2 public connector implemented on the shared connector SDK and ingestion runtime.

- Source: ClinicalTrials.gov API v2 fixture.
- Pinned source version: `ClinicalTrials.gov API v2; snapshot=2026-06-27`.
- License classification: `open_with_attribution`.
- Raw artifacts: persisted content-addressed through `services/ingestion`.
- Normalized records: trial records keyed by NCT ID with conditions, interventions, phase, status, evidence refs, provenance ID, and PII flags for contact/official names.

Tests do not use live network calls; they run against `fixtures/clinicaltrials-gov-v2-studies.json`.
