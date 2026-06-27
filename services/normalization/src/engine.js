import { createHash } from "node:crypto";

import { validateMappingObjectShape } from "../../../packages/contracts/src/index.js";
import { confidenceBand, normalizeText, scoreCandidate } from "./scoring.js";

export const NORMALIZATION_STAGES = Object.freeze([
  "parse_source_record",
  "detect_entity_mentions",
  "generate_candidate_canonical_ids",
  "generate_candidate_external_ids",
  "score_lexical_match",
  "score_identifier_match",
  "apply_ontology_constraints",
  "check_source_trust",
  "check_cross_source_corroboration",
  "create_candidate_mapping_or_entity_proposal",
  "route_to_review"
]);

const DEFAULT_TARGET_VOCABULARY = "PharmaOps";
const DEFAULT_TARGET_VOCABULARY_VERSION = "working";

export class NormalizationEngine {
  constructor({
    canonicalIndex = { canonical_entities: [] },
    targetVocabulary = DEFAULT_TARGET_VOCABULARY,
    targetVocabularyVersion = DEFAULT_TARGET_VOCABULARY_VERSION,
    clock = () => new Date()
  } = {}) {
    this.canonicalIndex = normalizeCanonicalIndex(canonicalIndex);
    this.targetVocabulary = targetVocabulary;
    this.targetVocabularyVersion = targetVocabularyVersion;
    this.clock = clock;
  }

  normalize(record, options = {}) {
    const parsed = parseSourceRecord(record);
    const mentions = detectEntityMentions(parsed);
    const proposals = [];
    const stageTrace = [stage("parse_source_record", {
      source_name: parsed.source_name,
      source_version: parsed.source_version,
      source_record_id: parsed.source_record_id
    })];

    for (const mention of mentions) {
      const candidateExternalIds = generateCandidateExternalIds(mention);
      const ranked = this.rankCandidates({ mention: { ...mention, external_ids: candidateExternalIds }, parsed });
      const duplicateFlags = detectDuplicateCandidates(ranked);
      const reviewRoute = routeToReview(ranked[0], duplicateFlags);
      const evidence = evidenceFor({ parsed, mention, ranked, duplicateFlags });
      const entityProposal = buildEntityProposal({
        parsed,
        mention,
        ranked,
        duplicateFlags,
        reviewRoute,
        evidence,
        now: this.clock().toISOString()
      });
      const mappingProposals = ranked.map((rankedCandidate, index) => buildMappingProposal({
        parsed,
        mention,
        rankedCandidate,
        rank: index + 1,
        duplicateFlags,
        evidence,
        targetVocabulary: this.targetVocabulary,
        targetVocabularyVersion: this.targetVocabularyVersion,
        now: this.clock().toISOString()
      }));
      proposals.push({
        mention_id: mention.mention_id,
        entity_proposal: entityProposal,
        mapping_proposals: mappingProposals,
        duplicate_candidate_flags: duplicateFlags,
        review_route: reviewRoute,
        ranking: ranked.map(({ candidate, scoring, rank }) => ({
          rank,
          canonical_id: candidate.canonical_id,
          confidence_score: scoring.confidence_score,
          confidence_band: scoring.confidence_band,
          predicate: predicateForScore(scoring.confidence_score),
          signals: scoring.signals
        }))
      });
      stageTrace.push(
        stage("detect_entity_mentions", { mention_id: mention.mention_id, entity_class: mention.entity_class, label: mention.label }),
        stage("generate_candidate_canonical_ids", { count: ranked.length, canonical_ids: ranked.map((entry) => entry.candidate.canonical_id) }),
        stage("generate_candidate_external_ids", { external_ids: candidateExternalIds }),
        stage("score_lexical_match", { scores: ranked.map((entry) => entry.scoring.signals.lexical.score) }),
        stage("score_identifier_match", { scores: ranked.map((entry) => entry.scoring.signals.identifier.score) }),
        stage("apply_ontology_constraints", { scores: ranked.map((entry) => entry.scoring.signals.ontology.score) }),
        stage("check_source_trust", { scores: ranked.map((entry) => entry.scoring.signals.source_trust.score) }),
        stage("check_cross_source_corroboration", { scores: ranked.map((entry) => entry.scoring.signals.cross_source_corroboration.score) }),
        stage("create_candidate_mapping_or_entity_proposal", {
          entity_proposal_id: entityProposal.proposal_id,
          mapping_count: mappingProposals.length
        }),
        stage("route_to_review", { review_route: reviewRoute })
      );
    }

    return {
      normalization_run_id: options.runId ?? `normrun:${hashStable({ source_record_id: parsed.source_record_id, source_version: parsed.source_version })}`,
      source_name: parsed.source_name,
      source_version: parsed.source_version,
      source_record_id: parsed.source_record_id,
      review_status: "proposed",
      auto_publish: false,
      stage_trace: orderStageTrace(stageTrace),
      proposals,
      warnings: parsed.warnings
    };
  }

  rankCandidates({ mention, parsed }) {
    const candidates = this.canonicalIndex.canonical_entities
      .filter((candidate) => ontologyCompatible(mention, candidate))
      .map((candidate) => ({
        candidate,
        scoring: scoreCandidate({ mention, candidate, sourceName: parsed.source_name })
      }))
      .filter(({ scoring }) => scoring.signals.lexical.fired || scoring.signals.identifier.fired)
      .sort((a, b) => b.scoring.confidence_score - a.scoring.confidence_score)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    if (candidates.length > 0) {
      return candidates;
    }

    const generated = generatedCandidate(mention, parsed);
    return [{
      candidate: generated,
      scoring: {
        confidence_score: 0.35,
        confidence_band: confidenceBand(0.35),
        signals: {
          lexical: { score: 0, fired: false, rationale: "no canonical lexical match" },
          identifier: { score: 0, fired: false, matched_identifiers: [], rationale: "no canonical identifier match" },
          ontology: { score: mention.entity_class ? 1 : 0.5, fired: Boolean(mention.entity_class), rationale: "new entity proposal preserves source entity class" },
          source_trust: scoreCandidate({ mention, candidate: generated, sourceName: parsed.source_name }).signals.source_trust,
          cross_source_corroboration: { score: 0, fired: false, source_count: 0, rationale: "new entity proposal has no cross-source corroboration yet" },
          model_probability: { score: null, fired: false, rationale: "No model probability supplied; deterministic MVP baseline does not fabricate ML confidence." },
          historical_human_validation: { score: null, fired: false, rationale: "No historical human validation signal supplied in MVP fixture." },
          review_override_rate: { score: null, fired: false, rationale: "No review override-rate calibration supplied in MVP fixture." }
        }
      },
      rank: 1,
      generated: true
    }];
  }
}

export function normalizeSourceRecord(record, options = {}) {
  return new NormalizationEngine(options).normalize(record, options);
}

export function parseSourceRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("normalization source record must be an object");
  }
  if (!record.source_version) {
    throw new Error("normalization source record requires source_version");
  }
  if (!record.source_record_id) {
    throw new Error("normalization source record requires source_record_id");
  }
  const normalized = record.normalized_record ?? record;
  return {
    ...record,
    normalized_record: normalized,
    source_name: record.source_name ?? normalized.source_name ?? "unknown",
    source_version: record.source_version ?? normalized.source_version,
    source_record_id: record.source_record_id ?? normalized.source_id,
    source_record_uri: record.source_record_uri ?? normalized.source_record_uri ?? null,
    label: record.label ?? normalized.label ?? normalized.recommended_name ?? normalized.title ?? record.source_record_id,
    entity_class: record.entity_class ?? normalized.entity_class ?? record.candidate_entities?.[0]?.entity_class ?? "other",
    identifiers: unique([...(record.identifiers ?? []), ...(normalized.identifiers ?? []), ...(record.candidate_entities?.[0]?.source_identifiers ?? [])]),
    synonyms: unique([...(record.synonyms ?? []), ...(normalized.synonyms ?? []), ...(record.candidate_entities?.[0]?.synonyms ?? [])]),
    warnings: record.warnings ?? []
  };
}

export function detectEntityMentions(parsed) {
  return [{
    mention_id: `mention:${hashStable({ source: parsed.source_name, version: parsed.source_version, id: parsed.source_record_id })}`,
    source_record_id: parsed.source_record_id,
    label: parsed.label,
    entity_class: parsed.entity_class,
    identifiers: parsed.identifiers,
    synonyms: parsed.synonyms,
    source_record_uri: parsed.source_record_uri
  }];
}

export function generateCandidateExternalIds(mention) {
  return unique(mention.identifiers ?? [])
    .map(parseIdentifier)
    .filter((entry) => entry.id);
}

function buildEntityProposal({ parsed, mention, ranked, duplicateFlags, reviewRoute, evidence, now }) {
  const top = ranked[0];
  const canonicalId = top.candidate.canonical_id;
  return {
    proposal_id: `entity-proposal:${hashStable({ source: parsed.source_name, version: parsed.source_version, record: parsed.source_record_id, canonicalId })}`,
    proposal_type: top.generated ? "new_canonical_entity_candidate" : "canonical_entity_match_candidate",
    candidate_canonical_id: canonicalId,
    entity_class: mention.entity_class,
    source_label: mention.label,
    source_identifiers: generateCandidateExternalIds(mention),
    synonyms: mention.synonyms,
    confidence_score: top.scoring.confidence_score,
    confidence_band: top.scoring.confidence_band,
    evidence_ids: evidence.evidence_ids,
    evidence_refs: evidence.evidence_refs,
    provenance_id: evidence.provenance_id,
    provenance: evidence.provenance,
    review_status: "proposed",
    release_id: null,
    auto_publish: false,
    duplicate_candidate_flags: duplicateFlags,
    review_route: reviewRoute,
    created_by: "service:normalization",
    created_at: now
  };
}

function buildMappingProposal({
  parsed,
  mention,
  rankedCandidate,
  rank,
  duplicateFlags,
  evidence,
  targetVocabulary,
  targetVocabularyVersion,
  now
}) {
  const candidate = rankedCandidate.candidate;
  const score = rankedCandidate.scoring.confidence_score;
  const sourceVocabulary = sourceVocabularyFor(parsed, mention);
  const sourceEntityId = sourceEntityIdFor(parsed, mention);
  const targetLicense = candidate.license_classification ?? parsed.license_classification ?? "open_with_attribution";
  const mapping = {
    mapping_id: `mapping-candidate:${hashStable({ sourceEntityId, target: candidate.canonical_id, predicate: predicateForScore(score) })}`,
    source_entity_id: sourceEntityId,
    target_entity_id: candidate.canonical_id,
    predicate: predicateForScore(score),
    source_vocabulary: sourceVocabulary,
    source_vocabulary_version: parsed.source_version,
    target_vocabulary: targetVocabulary,
    target_vocabulary_version: candidate.vocabulary_version ?? targetVocabularyVersion,
    source_license_classification: parsed.license_classification ?? "open_with_attribution",
    source_license_policy_id: parsed.license_policy_id ?? `${sourceVocabulary}:license-policy:${parsed.source_version}`,
    target_license_classification: targetLicense,
    target_license_policy_id: candidate.license_policy_id ?? `${targetVocabulary}:license-policy:${candidate.vocabulary_version ?? targetVocabularyVersion}`,
    data_sensitivity: parsed.sensitivity_classification ?? "public",
    materialization_policy: parsed.materialization_policy ?? "materialize",
    permitted_uses: parsed.permitted_uses ?? ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
    export_restrictions: parsed.export_restrictions ?? ["attribution_required"],
    disclaimer_ids: parsed.disclaimer_ids ?? [],
    legal_approval_id: parsed.legal_approval_id ?? null,
    retention_class: parsed.retention_class ?? "public_source_snapshot",
    license_status: "valid",
    confidence_score: score,
    confidence_band: rankedCandidate.scoring.confidence_band,
    evidence_ids: evidence.evidence_ids,
    evidence_refs: evidence.evidence_refs,
    provenance_id: evidence.provenance_id,
    created_by: "service:normalization",
    reviewed_by: null,
    review_status: "proposed",
    release_id: null,
    provenance: evidence.provenance,
    proposal_rank: rank,
    review_route: routeToReview(rankedCandidate, duplicateFlags),
    duplicate_candidate_flags: duplicateFlags,
    scoring_signals: rankedCandidate.scoring.signals,
    auto_publish: false,
    created_at: now
  };
  const validation = validateMappingObjectShape(mapping);
  if (!validation.valid) {
    throw new Error(`candidate mapping failed contract validation: ${validation.errors.join("; ")}`);
  }
  return mapping;
}

function evidenceFor({ parsed, mention, ranked, duplicateFlags }) {
  const evidenceId = `pharmev:normalization/${hashStable({ source: parsed.source_name, version: parsed.source_version, id: parsed.source_record_id, mention: mention.mention_id })}`;
  const provenanceId = `pharmprov:normalization/${hashStable({ evidenceId })}`;
  return {
    evidence_ids: [evidenceId],
    evidence_refs: [{ evidence_id: evidenceId, evidence_role: "supports", required_for_release: true }],
    provenance_id: provenanceId,
    provenance: {
      actor: "service:normalization",
      timestamp: parsed.source_retrieved_at ?? new Date().toISOString(),
      source: parsed.source_name,
      source_version: parsed.source_version,
      source_record_id: parsed.source_record_id,
      source_record_uri: parsed.source_record_uri ?? null,
      audit_event_id: `audit:normalization:${hashStable({ evidenceId, top: ranked[0]?.candidate?.canonical_id })}`,
      method: "deterministic_identifier_synonym_baseline",
      confidence: ranked[0]?.scoring ?? null,
      duplicate_candidate_flags: duplicateFlags
    }
  };
}

function detectDuplicateCandidates(ranked) {
  if (ranked.length < 2) {
    return [];
  }
  const [first, second] = ranked;
  const nearTie = Math.abs(first.scoring.confidence_score - second.scoring.confidence_score) <= 0.05;
  const sharedIdentifiers = intersection(
    (first.candidate.external_ids ?? []).map(identifierKey),
    (second.candidate.external_ids ?? []).map(identifierKey)
  );
  const sameLabel = normalizeText(first.candidate.preferred_label) === normalizeText(second.candidate.preferred_label);
  const flags = [];
  if (nearTie || sharedIdentifiers.length > 0 || sameLabel) {
    flags.push({
      flag_type: "possible_duplicate_candidate",
      candidate_ids: [first.candidate.canonical_id, second.candidate.canonical_id],
      reason: nearTie ? "top candidates have near-tie confidence" : sharedIdentifiers.length > 0 ? "top candidates share external identifiers" : "top candidates share normalized preferred label",
      action: "flag_only_do_not_merge"
    });
  }
  return flags;
}

function routeToReview(rankedCandidate, duplicateFlags) {
  if (duplicateFlags.length > 0) return "duplicate_resolution_review";
  if (!rankedCandidate) return "domain_expert_review";
  if (rankedCandidate.scoring.confidence_band === "high") return "steward_review";
  return "domain_expert_review";
}

function predicateForScore(score) {
  if (score >= 0.88) return "exactMatch";
  if (score >= 0.7) return "closeMatch";
  if (score >= 0.45) return "uncertainMatch";
  return "requiresReview";
}

function normalizeCanonicalIndex(index) {
  return {
    canonical_entities: (index?.canonical_entities ?? []).map((entity) => ({
      ...entity,
      synonyms: entity.synonyms ?? [],
      external_ids: (entity.external_ids ?? []).map((external) => ({
        vocabulary: external.vocabulary,
        id: external.id,
        version: external.version ?? entity.vocabulary_version ?? DEFAULT_TARGET_VOCABULARY_VERSION,
        source_name: external.source_name ?? external.vocabulary
      }))
    }))
  };
}

function ontologyCompatible(mention, candidate) {
  return !mention.entity_class || !candidate.entity_class || mention.entity_class === candidate.entity_class;
}

function generatedCandidate(mention, parsed) {
  const slug = normalizeText(mention.label || parsed.source_record_id).replace(/\s+/g, "-") || "unknown";
  return {
    canonical_id: `pharment:${mention.entity_class || "entity"}/candidate-${slug}`,
    entity_class: mention.entity_class,
    preferred_label: mention.label,
    synonyms: mention.synonyms ?? [],
    external_ids: generateCandidateExternalIds(mention),
    vocabulary_version: DEFAULT_TARGET_VOCABULARY_VERSION,
    license_classification: parsed.license_classification ?? "open_with_attribution"
  };
}

function sourceVocabularyFor(parsed, mention) {
  const id = generateCandidateExternalIds(mention)[0];
  return id?.vocabulary ?? parsed.source_name ?? "unknown";
}

function sourceEntityIdFor(parsed, mention) {
  const id = generateCandidateExternalIds(mention)[0];
  return id ? `${id.vocabulary}:${id.id}` : `${parsed.source_name}:${parsed.source_record_id}`;
}

function parseIdentifier(identifier) {
  if (typeof identifier === "object" && identifier !== null) {
    return {
      vocabulary: identifier.vocabulary ?? identifier.prefix ?? "unknown",
      id: identifier.id ?? identifier.value ?? "",
      version: identifier.version ?? null
    };
  }
  const value = String(identifier ?? "");
  const [prefixRaw, ...rest] = value.split(":");
  const id = rest.join(":");
  const vocabulary = prefixRaw.includes(".") ? prefixRaw.split(".")[0] : prefixRaw;
  return { vocabulary, id, version: null };
}

function stage(name, details = {}) {
  return { stage: name, status: "completed", details };
}

function orderStageTrace(trace) {
  const ordered = [];
  for (const stageName of NORMALIZATION_STAGES) {
    ordered.push(...trace.filter((entry) => entry.stage === stageName));
  }
  return ordered;
}

function identifierKey(entry) {
  return `${normalizeText(entry.vocabulary)}:${normalizeText(entry.id)}`;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

function intersection(a, b) {
  const set = new Set(b);
  return a.filter((value) => set.has(value));
}

function hashStable(value) {
  return createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex").slice(0, 24);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
