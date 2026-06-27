# services/export

RDF, JSON-LD, TSV/CSV, validation report, and release package generation.

Exports must be generated from immutable release snapshots and include release ID, provenance, source versions, license metadata, and artifact hashes.

## Phase 5 Export Authorization

Export paths must call `buildAuthorizedExport` from `services/export/src/index.js`.

The export boundary applies `services/authz-filter` with `action: "export"`, so working results, cross-tenant results, results outside the requested release context, blocked licenses, non-exportable source material, and principals without export authority are dropped server-side before a manifest is generated.

Each exported row must also prove regulated export fields before it can leave the backend:

- `id`
- `tenant_id`
- `environment`
- `release_id`
- `provenance_id`
- `artifact_hash`
- `license_status`
- `license_classification`
- `license_policy_id`
- `source_vocabulary_version` and `target_vocabulary_version` for mapping, synonym, relationship, canonical, approved, or released assertion rows

Rows missing required regulated fields are dropped fail-closed and counted in `invalid_record_count`.

`manifest_digest` binds canonical sorted exported row content, not only row identifiers. Any change to provenance, source or target vocabulary versions, artifact hash, license policy, release context, or other governed export fields changes the row content hash and manifest digest.

The export boundary does not return authorization-hidden counts such as `filtered_count`. Hidden-only scopes and truly empty scopes are indistinguishable to callers except for visible invalid authorized rows counted in `invalid_record_count`.
