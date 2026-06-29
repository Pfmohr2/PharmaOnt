#!/usr/bin/env node
/*
  Staging-only pilot DATA demonstration harness ("Path A — demo seed").

  Usage:
    node scripts/demo-pilot-data.mjs            # default principal = curator
    node scripts/demo-pilot-data.mjs viewer     # act as a different pilot role

  What this proves
  ----------------
  The runbook Day-1 checks (search aspirin / acetylsalicylic acid / CHEMBL25 /
  PTGS1 / PTGS2, open an entity, inspect evidence) require DATA in the governed
  store that the search index reads from. Real ingestion only produces
  *candidates* (see services/ingestion/src/job-runner.js, which explicitly blocks
  graph writes); governed entities normally arrive via the curation/promotion
  path (EntityStore -> Fuseki + SHACL). This harness SEEDS a small governed
  store-state in memory and drives the REAL search service
  (services/search/src/index.js) through its REAL authorization chokepoint
  (services/authz-filter/src/index.js). It stands up no Fuseki, writes no graph,
  persists nothing.

  Data provenance (honest labelling)
  ----------------------------------
  - Aspirin / CHEMBL25 fields are read from the REAL shipped pilot fixture
    connectors/chembl/fixtures/chembl-molecule-activities-CHEMBL_34.json.
  - PTGS1 / PTGS2 targets and the aspirin->COX relationships are CURATED DEMO
    records. NOTE: the shipped UniProt fixture
    connectors/uniprot/fixtures/uniprotkb-proteins-2026_02.json contains EGFR
    (P00533) and Insulin (P01308), NOT the antiplatelet COX targets the runbook
    searches for. That fixture/runbook mismatch is a real gap for the actual
    pilot dataset and is flagged at the end of this run.
*/

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PILOT_ENVIRONMENT,
  PILOT_TENANT_ID,
  buildAntiplateletStagingProvisioningPlan
} from "../services/ops/src/pilot-provisioning.js";
import {
  createSearchIndexService,
  indexGovernedRecords
} from "../services/search/src/index.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DAY1_QUERIES = ["aspirin", "acetylsalicylic acid", "CHEMBL25", "PTGS1", "PTGS2"];

// ---------------------------------------------------------------------------
// 1. Build the 8 pilot principals from the real provisioning plan.
// ---------------------------------------------------------------------------
const plan = buildAntiplateletStagingProvisioningPlan({ mode: "dry-run" });
const principals = plan.human_principals.map((principal) => ({
  label: principal.principal_id.split(":").at(-1),
  role: principal.primary_role_key,
  actor: {
    user_id: principal.principal_id,
    principal_type: "human_placeholder",
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    role_keys: principal.role_keys,
    allowed_release_ids: []
  }
}));

const requestedRole = process.argv[2] ?? "curator";
const acting =
  principals.find((p) => p.role === requestedRole) ??
  principals.find((p) => p.label === requestedRole) ??
  principals.find((p) => p.role === "curator");

// ---------------------------------------------------------------------------
// 2. Seed the governed store-state (working-graph scope, staging tenant).
// ---------------------------------------------------------------------------
const aspirin = buildAspirinFromFixture();
const ptgs1 = curatedTarget({
  id: "pharment:target/PTGS1",
  label: "Prostaglandin G/H synthase 1 (COX-1)",
  gene: "PTGS1",
  uniprot: "P23219",
  synonyms: ["COX-1", "PTGS1", "Cyclooxygenase-1", "Prostaglandin H2 synthase 1"]
});
const ptgs2 = curatedTarget({
  id: "pharment:target/PTGS2",
  label: "Prostaglandin G/H synthase 2 (COX-2)",
  gene: "PTGS2",
  uniprot: "P35354",
  synonyms: ["COX-2", "PTGS2", "Cyclooxygenase-2", "Prostaglandin H2 synthase 2"]
});

const evidencePtgs1 = curatedEvidence({
  id: "pharmev:aspirin-ptgs1",
  label: "Aspirin irreversibly acetylates COX-1 (PTGS1)",
  snippet:
    "Aspirin irreversibly acetylates Ser529 of prostaglandin G/H synthase 1 (COX-1, PTGS1), the basis of its antiplatelet effect."
});
const evidencePtgs2 = curatedEvidence({
  id: "pharmev:aspirin-ptgs2",
  label: "Aspirin inhibits COX-2 (PTGS2)",
  snippet:
    "Aspirin inhibits prostaglandin G/H synthase 2 (COX-2, PTGS2) with lower potency than COX-1."
});

const relAspirinPtgs1 = curatedRelationship({
  id: "ra:aspirin-ptgs1",
  label: "Aspirin inhibits PTGS1 (COX-1)",
  subject: aspirin.object_id,
  predicate: "inhibits",
  object: ptgs1.object_id,
  identifiers: ["PTGS1", "COX-1"],
  evidence: evidencePtgs1
});
const relAspirinPtgs2 = curatedRelationship({
  id: "ra:aspirin-ptgs2",
  label: "Aspirin inhibits PTGS2 (COX-2)",
  subject: aspirin.object_id,
  predicate: "inhibits",
  object: ptgs2.object_id,
  identifiers: ["PTGS2", "COX-2"],
  evidence: evidencePtgs2
});

const storeState = {
  compounds: [aspirin],
  targets: [ptgs1, ptgs2],
  mappings: [
    curatedMapping({
      id: "mapping:chembl25-pubchem2244",
      label: "CHEMBL25 exact match PubChem CID2244",
      source_id: "chembl:CHEMBL25",
      target_id: "pubchem:CID2244"
    })
  ],
  relationship_assertions: [relAspirinPtgs1, relAspirinPtgs2],
  evidence: [evidencePtgs1, evidencePtgs2]
};

const service = createSearchIndexService({
  documents: indexGovernedRecords(storeState)
});

// ---------------------------------------------------------------------------
// 3. Run the demonstration.
// ---------------------------------------------------------------------------
console.log("Pilot DATA demo  (Path A — in-memory governed-store seed)");
console.log(`tenant=${PILOT_TENANT_ID}  environment=${PILOT_ENVIRONMENT}  scope=working-graph`);
console.log(`acting as: ${acting.label} (role=${acting.role})`);
console.log("");
console.log("Seeded entities:");
console.log("  - compound  Aspirin            (chembl:CHEMBL25)        [from real ChEMBL fixture]");
console.log("  - target    PTGS1 / COX-1       (uniprot:P23219)        [curated demo]");
console.log("  - target    PTGS2 / COX-2       (uniprot:P35354)        [curated demo]");
console.log("  - relation  Aspirin inhibits PTGS1, Aspirin inhibits PTGS2   [curated demo]");
console.log("");

// 3a. Day-1 searches as the acting principal.
console.log("=== Day-1 searches ===");
for (const q of DAY1_QUERIES) {
  const response = service.search({ principal: acting.actor, query: { q } });
  console.log(`\nsearch "${q}"  -> ${response.total} hit(s)`);
  for (const hit of response.results) {
    const reason = hit.match_reasons[0];
    console.log(
      `  - ${pad(hit.object_type, 12)} ${pad(hit.display_label ?? hit.object_id, 34)}` +
        ` score=${hit.score}  via ${reason?.reason_type}:${reason?.matched_value ?? ""}`
    );
  }
}

// 3b. "Open the entity page" for aspirin.
console.log("\n=== Open entity page: Aspirin ===");
const aspirinHit = service.search({ principal: acting.actor, query: { q: "CHEMBL25" } }).results[0];
if (aspirinHit) {
  console.log(`  label:        ${aspirinHit.display_label}`);
  console.log(`  definition:   ${aspirinHit.definition ?? "(none)"}`);
  console.log(`  identifiers:  ${(aspirinHit.identifiers ?? []).join(", ")}`);
  console.log(`  synonyms:     ${(aspirinHit.synonyms ?? []).map((s) => s.value).join(", ")}`);
  console.log(`  source:       ${(aspirinHit.sources ?? []).join(", ")}`);
} else {
  console.log("  (aspirin not visible to this role in working scope)");
}

// 3c. "Inspect evidence" for the aspirin->PTGS1 relationship.
console.log("\n=== Inspect evidence: Aspirin -> PTGS1 ===");
const relHit = service.search({ principal: acting.actor, query: { q: "PTGS1" } }).results
  .find((r) => r.object_type === "relationship");
const evidenceSource = relHit ?? evidencePtgs1;
const refs = relHit?.evidence_refs?.length ? relHit.evidence_refs : indexGovernedRecords({ evidence: [evidencePtgs1] });
for (const ev of refs) {
  console.log(`  - [${ev.evidence_id ?? ev.object_id}] ${ev.snippet ?? ev.display_label}`);
  console.log(`      source: ${ev.source_name ?? "ChEMBL"}  (ChEMBL CHEMBL_34 / curated)`);
}

// 3d. Role-visibility contrast on a single query.
console.log("\n=== Who can see the working pilot data? (search \"aspirin\") ===");
for (const p of principals) {
  const total = service.search({ principal: p.actor, query: { q: "aspirin" } }).total;
  const verdict = total > 0 ? `${total} hit(s)` : "no access (working scope)";
  console.log(`  - ${pad(p.label, 30)} ${pad(p.role, 20)} ${verdict}`);
}

// ---------------------------------------------------------------------------
// 4. Honest caveats.
// ---------------------------------------------------------------------------
console.log("\nNotes");
console.log("  - This is a DEMO SEED, not real ingestion: data is in-memory, no Fuseki, no graph write.");
console.log("  - Aspirin/CHEMBL25 come from the real ChEMBL CHEMBL_34 fixture; PTGS1/PTGS2 + relationships are curated demo records.");
console.log("  - FIXTURE GAP: the shipped UniProt 2026_02 fixture contains EGFR (P00533) + Insulin (P01308), NOT PTGS1/PTGS2.");
console.log("    The real pilot dataset needs antiplatelet COX targets added before Day-1 PTGS1/PTGS2 searches work on ingested data.");
console.log("  - viewer (pilot-support) and expert_reviewer see nothing here because the pilot is working-graph-only and");
console.log("    READ_WORKING_ROLES excludes them — correct behaviour, not a bug. They gain read access once data is RELEASED.");

// ===========================================================================
// Helpers
// ===========================================================================
function buildAspirinFromFixture() {
  const fixturePath = resolve(repoRoot, "connectors/chembl/fixtures/chembl-molecule-activities-CHEMBL_34.json");
  const payload = JSON.parse(readFileSync(fixturePath, "utf8"));
  const molecules = payload?.molecule_response?.molecules ?? [];
  const mol = molecules.find((m) => m.molecule_chembl_id === "CHEMBL25") ?? molecules[0] ?? {};
  const synValues = (mol.molecule_synonyms ?? []).map((s) => s.molecule_synonym).filter(Boolean);
  const synonyms = uniqueStrings([...synValues, "ASA"]).map((value, i) => ({
    synonym_id: `synonym:aspirin-${i}`,
    value,
    source: "ChEMBL",
    evidence_id: "evidence:aspirin-chembl-label"
  }));
  const atc = (mol.atc_classifications ?? []).map((code) => `atc:${code}`);
  const inchiKey = mol.molecule_structures?.standard_inchi_key;
  return {
    id: "pharment:compound/aspirin",
    object_id: "pharment:compound/aspirin",
    object_type: "compound",
    entity_type: "compound",
    assertion_id: "assertion:compound-aspirin",
    assertion_type: "canonical",
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    release_id: null,
    lifecycle_status: "in_review",
    review_status: "in_review",
    permitted_uses: ["search"],
    license_status: "valid",
    license_classification: "open_with_attribution",
    preferred_label: titleCase(mol.pref_name ?? "Aspirin"),
    display_label: titleCase(mol.pref_name ?? "Aspirin"),
    definition: `${titleCase(mol.pref_name ?? "Aspirin")} (${mol.molecule_properties?.full_molformula ?? "C9H8O4"}); ${mol.indication_class ?? "Analgesic; Anti-Inflammatory; Antipyretic"}; antiplatelet via COX inhibition.`,
    identifiers: uniqueStrings([
      "chembl:CHEMBL25",
      "CHEMBL25",
      mol.molecule_chembl_id,
      "pubchem:CID2244",
      ...atc,
      inchiKey ? `inchikey:${inchiKey}` : null
    ]),
    synonyms,
    mappings: [
      {
        mapping_id: "mapping:chembl25-pubchem2244",
        source_id: "chembl:CHEMBL25",
        target_id: "pubchem:CID2244",
        mapping_type: "exactMatch",
        source: "ChEMBL"
      }
    ],
    evidence_refs: [
      {
        evidence_id: "evidence:aspirin-chembl-label",
        source_name: "ChEMBL",
        source_version: "CHEMBL_34",
        snippet: `ChEMBL ${mol.molecule_chembl_id ?? "CHEMBL25"} preferred name ${mol.pref_name ?? "ASPIRIN"}; synonyms ${synValues.join(", ")}.`
      }
    ],
    source_name: "ChEMBL",
    source_version: "CHEMBL_34"
  };
}

function curatedTarget({ id, label, gene, uniprot, synonyms }) {
  return {
    id,
    object_id: id,
    object_type: "target",
    entity_type: "target",
    assertion_id: `assertion:${gene.toLowerCase()}`,
    assertion_type: "canonical",
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    release_id: null,
    lifecycle_status: "in_review",
    review_status: "in_review",
    permitted_uses: ["search"],
    license_status: "valid",
    license_classification: "open_with_attribution",
    preferred_label: label,
    display_label: label,
    definition: `${label}; aspirin pharmacological target.`,
    identifiers: uniqueStrings([`uniprot:${uniprot}`, uniprot, `gene:${gene}`, gene]),
    synonyms: synonyms.map((value, i) => ({
      synonym_id: `synonym:${gene.toLowerCase()}-${i}`,
      value,
      source: "Manual curation (demo)",
      evidence_id: null
    })),
    source_name: "UniProt",
    source_version: "2026_02"
  };
}

function curatedRelationship({ id, label, subject, predicate, object, identifiers, evidence }) {
  return {
    id,
    relationship_assertion_id: id,
    object_type: "relationship",
    assertion_type: "relationship",
    relationship_assertion_type: "human_curated",
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    release_id: null,
    lifecycle_status: "in_review",
    review_status: "in_review",
    causal_claim_status: "not_causal",
    permitted_uses: ["search"],
    license_status: "valid",
    display_label: label,
    subject_id: subject,
    source_entity_id: subject,
    predicate,
    object_id: object,
    target_entity_id: object,
    identifiers: uniqueStrings([id, ...identifiers]),
    provenance_id: `pharmprov:relationship/${id}`,
    evidence_refs: [
      {
        evidence_id: evidence.evidence_id,
        evidence_role: "supports",
        source_name: "ChEMBL",
        source_version: "CHEMBL_34",
        snippet: evidence.snippet
      }
    ],
    source_name: "ChEMBL"
  };
}

function curatedMapping({ id, label, source_id, target_id }) {
  return {
    id,
    mapping_id: id,
    object_type: "mapping",
    assertion_type: "mapping",
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    release_id: null,
    lifecycle_status: "in_review",
    review_status: "in_review",
    permitted_uses: ["search"],
    license_status: "valid",
    display_label: label,
    source_entity_id: source_id,
    target_entity_id: target_id,
    mapping_type: "exactMatch",
    source_name: "ChEMBL",
    source_version: "CHEMBL_34"
  };
}

function curatedEvidence({ id, label, snippet }) {
  return {
    id,
    evidence_id: id,
    object_type: "evidence",
    assertion_type: "evidence",
    tenant_id: PILOT_TENANT_ID,
    environment: PILOT_ENVIRONMENT,
    release_id: null,
    lifecycle_status: "in_review",
    review_status: "in_review",
    permitted_uses: ["search"],
    license_status: "valid",
    display_label: label,
    snippet,
    source_name: "ChEMBL",
    source_version: "CHEMBL_34"
  };
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

function titleCase(value) {
  return String(value)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function pad(value, width) {
  return String(value ?? "").padEnd(width);
}
