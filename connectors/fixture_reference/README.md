# Fixture Reference Connector

The Phase 2 reference connector lives in `packages/connector-sdk/src/fixture-connector.js` with fixture data at `packages/connector-sdk/fixtures/fixture-source.json`.

It proves the SDK mechanics without implementing a real source connector:

- no network access
- source-version-pinned fixture metadata
- raw artifact persistence before parsing
- normalized candidate entity output
- idempotent replay by source snapshot digest and source record ID
- checkpoint update after emitted records

Real connectors for ChEMBL, UniProt, ClinicalTrials.gov, PubMed/Europe PMC, openFDA FAERS, and internal templates should subclass `ConnectorBase` and keep the same handoff contract.
