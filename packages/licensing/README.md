# @pharmaops/licensing

Runtime policy helpers generated from `DATA_LICENSE_REGISTER.md`.

Use `evaluateLicensePolicy` to classify a source record and compute downstream
permissions. Use `assertIngestionPolicy` as the fail-closed ingestion boundary
before raw persistence, normalization, AI processing, export, or release routing.
Call the same function again with `finalObject: true` on the final emitted
normalized object. The returned decision object is the authoritative
`policy_decision` to stamp on that output.

The package enforces the Phase 2 data-governance gate:

- unknown or blocked license classification blocks ingestion;
- federated-only sources cannot be materialized;
- restricted licensed materialization requires explicit approval;
- PHI/PII cannot flow to AI-eligible paths without approved policy;
- openFDA FAERS records carry mandatory non-causal disclaimer metadata.
- final emitted FAERS/openFDA records are blocked if the non-causal disclaimer
  was dropped during normalization.
