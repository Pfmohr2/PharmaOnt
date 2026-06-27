# UniProt Connector

Phase 2 Round B reference connector for UniProt protein records.

Scope:

- Fixture-backed only; committed tests do not call the live UniProt API.
- Parses UniProtKB JSON-shaped `results` entries.
- Emits normalized protein records keyed by UniProt accession.
- Pins `source_version` to UniProt release `2026_02`.
- Uses `license_classification: open_with_attribution` from `DATA_LICENSE_REGISTER.md` and `packages/licensing`.
- Runs as both a `ConnectorBase` subclass and a `services/ingestion` connector object.

The fixture at `fixtures/uniprotkb-proteins-2026_02.json` contains EGFR and insulin records plus one intentionally malformed record without `primaryAccession` for dead-letter coverage.

The connector emits candidate protein entities only. It does not approve governed facts, export packages, or write released graphs.
