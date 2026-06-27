# Aspirin Antiplatelet Pilot Onboarding Plan

## Scope

Pilot one bounded therapeutic area: **aspirin antiplatelet curation for COX/PTGS targets in cardiovascular secondary prevention**.

The pilot validates whether a small curator/reviewer/release-manager team can ingest public source data, normalize compounds and targets, review mappings and AI suggestions, inspect evidence, release a governed snapshot, search the workbench, and export a provenance-preserving manifest.

In-scope entities:

- Compound: aspirin / acetylsalicylic acid / ChEMBL CHEMBL25.
- Targets: PTGS1 / COX-1 and PTGS2 / COX-2 where source coverage is available.
- Relationships: compound-target and evidence-supported synonym/mapping assertions.
- Safety context: adverse-event evidence only when explicitly non-causal and source-limited.
- Documents: source records, labels/abstract snippets, and evidence artifacts needed to support assertions.

Out of scope:

- Full cardiovascular ontology expansion.
- Comparative efficacy, incidence, prevalence, or causal safety claims.
- More than one therapeutic area or product family.
- Automated approval/release of model-suggested content.

## Pilot Roles

| Role | Pilot responsibility | Required access |
| --- | --- | --- |
| Pilot sponsor | Owns scope, confirms go/no-go criteria, resolves business priority tradeoffs. | Read dashboards and release summaries. |
| Tenant administrator | Creates pilot tenant, users, roles, service-account grants, and source entitlements. | Admin role for pilot tenant only. |
| Connector operator | Runs source ingestion jobs and verifies source versions, checkpoints, raw artifacts, and dead letters. | Connector service-account owner plus observability read. |
| Curator | Reviews normalized entities, mappings, synonyms, relationships, and AI suggestions. | Curator role, workbench/search/review queue access. |
| Domain expert reviewer | Reviews low-confidence or high-risk suggestions and requests revisions. | Expert-review role, evidence and feedback access. |
| Domain approver | Approves or rejects governed proposals after validation and expert review. | Domain approver role; cannot approve own submissions. |
| Release manager | Creates release candidate, resolves validation evidence, publishes controlled release snapshot. | Release manager role with release-scoped permissions. |
| Compliance/security reviewer | Confirms source license, PII/PHI posture, audit trail, export restrictions, and no hidden-count leakage. | Read access to audit, policy, and validation evidence. |
| Pilot support | Handles user questions, triages blockers, and files P0/P1 defects. | Read access to run status, user guides, and issue log. |

## Environment Setup

1. Create a dedicated pilot tenant and environment:
   - Tenant: `tenant-pilot-antiplatelet`.
   - Environment: `staging` for dry run, then controlled production only after exit gates pass.
   - Release context: start in working graph only; publish one pilot release candidate after review.

2. Configure RBAC:
   - Assign users to one primary role each for the pilot.
   - Ensure domain approvers cannot approve their own submitted proposals.
   - Ensure service accounts cannot provide human feedback or approval.
   - Require break-glass use to produce an audit event and post-pilot review.

3. Configure source entitlements:
   - ChEMBL public source snapshot access.
   - UniProt public source snapshot access for PTGS target records.
   - Optional FAERS/openFDA safety context only if connector and policy gates are green.
   - No internal PHI/PII data in the first pilot run.

4. Pin source versions:
   - ChEMBL: `CHEMBL_34`.
   - UniProt: `2026_02` or the current approved pinned fixture/source version.
   - FAERS/openFDA: version/date of the approved public snapshot if included.
   - Record source-version pins in release metadata and export manifests.

5. Confirm operational dependencies:
   - Ingestion runtime and dead-letter store.
   - Normalization engine and mapping registry.
   - Proposal workflow and validation preview.
   - AI curation API/UI for suggestions and feedback.
   - Search/workbench API/UI.
   - Release manager and export boundary.
   - Audit event storage and observability pipeline.

## Source And Connector Setup

### Required Sources

1. ChEMBL
   - Connector path: `connectors/chembl/`.
   - Purpose: aspirin compound identity, synonyms, identifiers, source evidence.
   - Required records: CHEMBL25 plus activity/evidence references used by the pilot.
   - Required governance: source version, artifact hash, license policy, provenance, retention class, and source terms disclaimer.

2. UniProt
   - Connector path: `connectors/uniprot/`.
   - Purpose: PTGS target identity, synonyms, target identifiers.
   - Required records: PTGS1 and PTGS2 if available in the approved source slice.
   - Required governance: source version, artifact hash, license policy, provenance, source terms disclaimer.

### Optional Source

3. openFDA FAERS
   - Connector path: `connectors/openfda_faers/`.
   - Purpose: non-causal adverse-event context only.
   - Include only if the connector, policy, disclaimer, and search/workbench display paths are green.
   - Must render source limitations and non-causal disclaimer.
   - Must not support causation, incidence, prevalence, comparative risk, product fault, or prescribing conclusions.

## Onboarding Sequence

### Week 0: Readiness Check

1. Confirm no unresolved P0/P1 defects in pilot paths.
2. Confirm pilot source versions and entitlements.
3. Create tenant/users/roles/service accounts.
4. Run connector dry run against fixture or approved pilot source slice.
5. Validate dead-letter handling, replay idempotency, and source freshness metrics.
6. Verify workbench search returns only authorized visible results with no hidden counts.
7. Verify export preview preserves IDs, versions, provenance, license metadata, and hashes.

### Day 1: Admin And Source Setup

1. Tenant administrator creates pilot users and service-account grants.
2. Connector operator loads approved source configuration.
3. Connector operator runs ChEMBL and UniProt ingestion.
4. Curator verifies raw artifacts, normalized records, evidence refs, and provenance are visible in workbench.
5. Compliance/security reviewer verifies source license and export restrictions.

### Day 2: Curation Workflow

1. Curator reviews compound and target normalization candidates.
2. Curator reviews mappings, synonyms, and relationships.
3. Curator routes low-confidence or duplicate candidates to expert review.
4. Expert reviewer records accept/reject/revise feedback on AI suggestions.
5. Domain approver approves or rejects governed proposals after validation preview.
6. Compliance/security reviewer confirms no model-suggested assertion is released without governed human proof.

### Day 3: Release And Workbench Validation

1. Release manager creates a release candidate from approved/staged items only.
2. Validation evidence is resolved from immutable validation runs, not caller-supplied inline refs.
3. Release manager publishes a controlled pilot release snapshot.
4. Pilot users search aspirin/PTGS terms and inspect entity pages, evidence, explanations, graph neighborhood, and export preview.
5. Export is generated only for authorized release rows with required regulated fields.

### Day 4-5: Feedback And Exit Review

1. Collect curator/reviewer feedback using support log and KPI dashboard.
2. Review dead letters, blocked validations, hidden-count controls, and export invalid-record counts.
3. Sponsor signs go/no-go on extending pilot scope only after success criteria pass.
4. File P0/P1 defects for anything blocking real user value or regulated trust.

## Training Outline

### Session 1: System And Governance Basics

- Entity, mapping, relationship, evidence, and release concepts.
- Difference between approved/released assertions and model-suggested candidates.
- Why hidden authorization counts are never displayed.
- Why FAERS/openFDA evidence is non-causal.

### Session 2: Curator Workflow

- Search and entity page navigation.
- Evidence viewer and explanation panel.
- Proposal queue states and validation preview.
- Duplicate flag handling: flag and review, never merge automatically.
- AI suggestion cards: model version, prompt version, score, evidence, source spans, and feedback.

### Session 3: Expert Review And Approval

- Low-confidence routing and expert-review queue.
- Accept/reject/revise feedback.
- Feedback is audit/display data, not approval.
- Approval separation and self-approval restrictions.

### Session 4: Release And Export

- Release candidate creation.
- Validation evidence requirements.
- Export preview and manifest fields.
- Source version pins, provenance IDs, artifact hashes, license metadata, and row hashes.

## Pilot Entry Gates

- All source connectors in the pilot path pass fixture and dry-run checks.
- Pilot tenant RBAC and service-account grants are configured.
- Workbench and curation UIs render only server-filtered payloads.
- No unresolved P0/P1 defects in ingestion, normalization, workflow, authz, release, search, UI, or export paths.
- Pilot users complete training and can perform a scripted dry run.

## Pilot Exit Gates

- Pilot release snapshot created from approved/staged entries only.
- Export manifest generated with required provenance, license, source-version, and hash fields.
- All KPI targets in `success-criteria-kpis.md` are met or explicitly waived by sponsor plus compliance/security.
- No P0/P1 defects remain open.
- Sponsor, compliance/security reviewer, and release manager approve continuation or expansion decision.
