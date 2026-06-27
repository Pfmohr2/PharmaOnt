# connectors/chembl

Fixture-backed ChEMBL Phase 2 connector.

- Source version: `CHEMBL_34`
- Source name: `ChEMBL`
- License classification: `open_with_attribution`
- Source-version strategy: `release`
- Disclaimer: `source_terms:chembl`

The connector extends `ConnectorBase` for the SDK lifecycle and exposes
`fetchRecords()` for `services/ingestion` `runConnectorJob`. Tests use only the
committed fixture at `fixtures/chembl-molecule-activities-CHEMBL_34.json`; no
live ChEMBL network calls are made.

Run the connector-local test:

```bash
node --test connectors/chembl/test/chembl-connector.test.mjs
```
