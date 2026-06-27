# PharmaOps Explanation and Evidence Service

Phase 5 server-side explanation service for search hits and entity assertions.

## Interface

```js
import { ExplanationEvidenceService } from "./src/index.js";

const service = new ExplanationEvidenceService({
  resolveAssertion,
  resolveEvidence,
  resolveProvenance,
  resolveMatchReasons
});
```

- `explainSearchHit({ hit, tenant_id, environment, release_id })` returns a provenance-bound `why` object for a search hit.
- `evidenceForAssertion({ assertion_id, tenant_id, environment, release_id })` returns the evidence viewer payload for an assertion.

Resolvers must load authoritative server-side records. Search hit payloads and request bodies may carry IDs only; caller-supplied assertion type, evidence, provenance, match reasons, confidence, or release state are not trusted.

## Explanation Shape

Search explanations include:

- assertion summary with required `assertion_type`
- match reasons from the search/match-reason store: field, synonym, mapping, query term, score contribution
- source evidence objects with source name/version, snippets/spans, disclaimers, access policy, and integrity bindings
- provenance chain with actor, activity, source, method, release, and audit linkage
- source vocabulary versions from assertion, evidence, and provenance
- governance flags, including FAERS/openFDA non-causal handling and model-suggested distinction

## Fail-Closed Rules

The service rejects explanations when:

- assertion resolver returns no authoritative record
- assertion type is missing or invalid
- evidence or provenance is missing
- tenant, environment, or release scope does not match
- confidence is marked fabricated
- FAERS/openFDA evidence is used for causal, incidence, prevalence, comparative-risk, or product-fault claims
- evidence lacks source/version or integrity binding
- provenance lacks audit linkage
- search hit explanations have no authoritative match reasons
