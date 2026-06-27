# services/ai-curation

Phase 6 AI-assisted curation service contract. This service produces suggestion candidates only. It does not approve, publish, merge duplicates, write release graphs, or route workflow tasks.

## Published schema

- `schemas/suggestion-candidate.schema.json`
- Schema version: `ai-suggestion-candidate.v1`
- Assertion type: `model_suggested`
- Lifecycle and review status: `proposed`
- Release membership: `release_id: null`, `governance.release_eligible: false`, `governance.released_graph_target: null`

## Candidate types

The engine emits schema-valid candidates for:

1. `document_entity_extraction` - extracted entity mentions with source spans.
2. `entity_linking` - candidate canonical links with scores and evidence.
3. `synonym` - synonym proposals for an existing entity.
4. `relationship` - proposed relationships with evidence and claim type.
5. `duplicate` - duplicate flags only; merge is explicitly disallowed.

Every candidate carries:

- `suggestion_id` equal to `candidate_id` for API/workflow compatibility
- `proposal_type` mapped to proposal workflow types (`mapping`, `synonym`, `relationship`, `evidence-link`)
- `payload` with `assertion_type`, `evidence_refs`, and `source_spans` for `ProposalWorkflowService.submitAiSuggestion`
- `model.model_id`, `model.model_version`, and `model.prompt_version`
- Top-level `model_name`, `model_version`, and `prompt_version` aliases
- A real numeric `score` from the caller or model result
- `confidence_score`, `confidence_band`, and `confidence_source`
- `confidence.source: calibrated_model_score`
- Calibration metadata including `calibration_id`, `calibration_version`, `calibration_method`, `sample_size`, and `metrics_source`
- At least one `evidence_refs[]` entry
- At least one `source_spans[]` entry with source offsets, quoted text, and evidence linkage
- `provenance_id`, provenance actor/method/source/time, and an audit event id
- `duplicate_status` and `rationale`
- Distinct AI suggestion governance flags for UI/API/workflow consumers

## Governance boundaries

AI suggestions are never approved facts. The service sets `auto_publish: false`, `requires_human_review: true`, and `release_eligible: false` for every candidate. Downstream API, workflow, and UI surfaces must preserve the `model_suggested` badge and visually separate these candidates from approved or released assertions.

Duplicate suggestions are flags only. The schema requires `governance.duplicate_policy: flag_only_never_merge` and `candidate_payload.merge_allowed: false` for duplicate candidates.

FAERS/openFDA evidence is non-causal. Relationship generation rejects causal FAERS/openFDA claims, and FAERS evidence refs carry the non-causal disclaimer and source limitation text forward.

## Module API

```js
import {
  AiCurationEngine,
  assertSuggestionCandidate,
  validateSuggestionCandidate,
  suggestionCandidateSchema
} from "./src/index.js";
```

Strict validator import surface for API/workflow consumers:

```js
import {
  validateSuggestionCandidate,
  assertSuggestionCandidate
} from "../../ai-curation/src/index.js";
```

`validateSuggestionCandidate(candidate)` returns `{ valid, errors }` for `ai-suggestion-candidate.v1`. It validates required model/prompt/calibration metadata, top-level and nested evidence refs/source spans, release-ineligible governance, non-fabricated confidence, duplicate flag-only policy, FAERS non-causal safety, and rejects nested `payload`/`candidate_payload` status or release overrides. `assertSuggestionCandidate(candidate)` throws `AiCurationError` with `details.errors` for fail-closed call sites.

Construct the engine with explicit model and calibration metadata:

```js
const engine = new AiCurationEngine({
  model: {
    model_id: "curation-baseline",
    model_version: "2026-06-27",
    prompt_version: "p6-ai-curation-v1"
  },
  calibration: {
    calibration_id: "cal:p6-baseline",
    calibration_version: "2026-06-27",
    calibration_method: "heldout-review-set",
    sample_size: 120,
    metrics_source: "phase6-calibration-report"
  }
});
```

The engine fails closed if model metadata, prompt version, score, evidence, source spans, or calibration metadata are missing.
