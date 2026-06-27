export const CONFIDENCE_BANDS = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  BLOCKED: "blocked"
});

const SCORE_WEIGHTS = Object.freeze({
  lexical: 0.24,
  identifier: 0.34,
  ontology: 0.16,
  sourceTrust: 0.14,
  corroboration: 0.12
});

const SOURCE_TRUST_SCORES = Object.freeze({
  chembl: 0.92,
  uniprot: 0.95,
  "clinicaltrials.gov": 0.82,
  clinicaltrials: 0.82,
  "pubmed / europe pmc": 0.86,
  pubmed: 0.86,
  "openfda faers": 0.65
});

export function scoreCandidate({ mention, candidate, sourceName }) {
  const lexical = lexicalScore(mention, candidate);
  const identifier = identifierScore(mention, candidate);
  const ontology = ontologyScore(mention, candidate);
  const sourceTrust = sourceTrustScore(sourceName);
  const corroboration = corroborationScore(candidate);
  const confidenceScore = roundScore(
    (lexical.score * SCORE_WEIGHTS.lexical) +
    (identifier.score * SCORE_WEIGHTS.identifier) +
    (ontology.score * SCORE_WEIGHTS.ontology) +
    (sourceTrust.score * SCORE_WEIGHTS.sourceTrust) +
    (corroboration.score * SCORE_WEIGHTS.corroboration)
  );

  return {
    confidence_score: confidenceScore,
    confidence_band: confidenceBand(confidenceScore),
    signals: {
      lexical,
      identifier,
      ontology,
      source_trust: sourceTrust,
      cross_source_corroboration: corroboration,
      model_probability: {
        score: null,
        fired: false,
        rationale: "No model probability supplied; deterministic MVP baseline does not fabricate ML confidence."
      },
      historical_human_validation: {
        score: null,
        fired: false,
        rationale: "No historical human validation signal supplied in MVP fixture."
      },
      review_override_rate: {
        score: null,
        fired: false,
        rationale: "No review override-rate calibration supplied in MVP fixture."
      }
    }
  };
}

export function confidenceBand(score) {
  if (score >= 0.85) return CONFIDENCE_BANDS.HIGH;
  if (score >= 0.6) return CONFIDENCE_BANDS.MEDIUM;
  if (score >= 0) return CONFIDENCE_BANDS.LOW;
  return CONFIDENCE_BANDS.BLOCKED;
}

function lexicalScore(mention, candidate) {
  const label = normalizeText(mention.label);
  const preferred = normalizeText(candidate.preferred_label);
  const synonyms = (candidate.synonyms ?? []).map(normalizeText).filter(Boolean);
  if (label && label === preferred) {
    return { score: 1, fired: true, rationale: "source label exactly matches canonical preferred label" };
  }
  if (label && synonyms.includes(label)) {
    return { score: 0.94, fired: true, rationale: "source label matches canonical synonym" };
  }
  const mentionSynonyms = (mention.synonyms ?? []).map(normalizeText).filter(Boolean);
  if (mentionSynonyms.some((synonym) => synonym === preferred || synonyms.includes(synonym))) {
    return { score: 0.9, fired: true, rationale: "source synonym overlaps canonical label or synonym" };
  }
  if (label && preferred && (label.includes(preferred) || preferred.includes(label))) {
    return { score: 0.62, fired: true, rationale: "source label partially overlaps canonical preferred label" };
  }
  return { score: 0, fired: false, rationale: "no lexical or synonym match" };
}

function identifierScore(mention, candidate) {
  const mentionIds = new Set((mention.external_ids ?? []).map(identifierKey));
  const candidateIds = new Set((candidate.external_ids ?? []).map(identifierKey));
  const overlap = [...mentionIds].filter((id) => candidateIds.has(id));
  if (overlap.length > 0) {
    return {
      score: 1,
      fired: true,
      matched_identifiers: overlap,
      rationale: "source external identifier matches canonical external identifier"
    };
  }
  return { score: 0, fired: false, matched_identifiers: [], rationale: "no identifier match" };
}

function ontologyScore(mention, candidate) {
  if (mention.entity_class && candidate.entity_class && mention.entity_class === candidate.entity_class) {
    return { score: 1, fired: true, rationale: "source entity class satisfies canonical ontology class" };
  }
  if (!mention.entity_class || !candidate.entity_class) {
    return { score: 0.5, fired: false, rationale: "ontology class missing on source or candidate" };
  }
  return { score: 0, fired: false, rationale: "source entity class conflicts with canonical ontology class" };
}

function sourceTrustScore(sourceName) {
  const key = normalizeText(sourceName);
  const score = SOURCE_TRUST_SCORES[key] ?? 0.6;
  return {
    score,
    fired: true,
    rationale: `source trust baseline for ${sourceName ?? "unknown source"}`
  };
}

function corroborationScore(candidate) {
  const sources = new Set((candidate.external_ids ?? []).map((entry) => entry.source_name ?? entry.vocabulary).filter(Boolean));
  const explicit = Array.isArray(candidate.corroborating_sources) ? candidate.corroborating_sources.length : 0;
  const count = Math.max(sources.size, explicit);
  if (count >= 2) {
    return { score: 1, fired: true, source_count: count, rationale: "candidate has cross-source corroboration" };
  }
  if (count === 1) {
    return { score: 0.55, fired: true, source_count: count, rationale: "candidate has one source-backed identifier" };
  }
  return { score: 0, fired: false, source_count: 0, rationale: "no corroborating source signal" };
}

export function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function identifierKey(entry) {
  return `${normalizeText(entry.vocabulary)}:${normalizeText(entry.id)}`;
}

function roundScore(value) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}
