# Phase 6 AI Curation Frontend Module

Framework-free view-model layer for the Phase 6 AI suggestion UI.

The module renders only server-filtered `phase6.curation-api.v1` payloads.
Suggestions must be `model_suggested`, `lifecycle_status: "proposed"`,
`review_status: "proposed"`, and `release_id: null`.

The UI exposes `visible_count` only, never hidden authorization counts. Feedback
affordances target the server feedback endpoint and are display/audit workflow
actions only; they do not approve, release, merge duplicates, or infer security.

Exports:

- `renderAiSuggestionWorkspace`
- `renderSuggestionQueue`
- `renderSuggestionCard`
- `renderFeedbackAffordance`
- `renderFeedbackReceipt`
