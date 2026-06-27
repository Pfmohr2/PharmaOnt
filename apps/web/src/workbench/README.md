# Phase 5 Workbench Frontend Module

Framework-free workbench component/view-model layer for Phase 5.

The module renders only server-filtered Phase 5 API payloads with
`schema_version: "phase5.workbench-api.v1"` and `authorization_filtered: true`.
It does not infer hidden unauthorized counts, reconstruct search results,
or derive export eligibility from local rows. Export affordances surface only
server-returned preview/action state, including `invalid_record_count`,
`row_content_hashes`, and `manifest_digest`.

Exports:

- `renderWorkbenchShell`
- `renderSearchSurface`
- `renderEntityPage`
- `renderEvidenceViewer`
- `renderExplanationPanel`
- `renderGraphNeighborhood`
- `renderExportAffordance`
