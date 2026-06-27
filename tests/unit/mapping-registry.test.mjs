import assert from "node:assert/strict";
import test from "node:test";

import {
  MAPPING_ACTIONS,
  assertCanGovernMappingCandidate
} from "../../services/mapping-workflow/src/index.js";
import {
  MappingRegistry,
  MappingRegistryError,
  buildGovernedDecisionBinding,
  digestValue,
  extractCandidateMappings,
  mappingEvidenceDigest,
  mappingRegistryPersistedSchema
} from "../../services/mapping-registry/src/index.js";

test("mapping registry creates and queries working-state mappings by entity, vocabulary, status, and release", () => {
  const registry = testRegistry();
  const created = registry.createMapping({
    tenantId: "acme",
    mapping: validMapping(),
    actor: "user:curator-1",
    correlationId: "corr:create-1"
  });

  assert.equal(created.mapping.mapping_id, "pharmmap:map-p3-000001");
  assert.equal(created.mapping.release_id, null);
  assert.equal(created.working_state, "working");
  assert.equal(mappingRegistryPersistedSchema.mapping_object_schema_id, "https://pharmaops.example/schema/mapping-object.schema.json");

  assert.equal(registry.queryMappings({ tenantId: "acme", entityId: "chembl:CHEMBL25" }).length, 1);
  assert.equal(registry.queryMappings({ tenantId: "acme", vocabulary: "PubChem" }).length, 1);
  assert.equal(registry.queryMappings({ tenantId: "acme", status: "proposed" }).length, 1);
  assert.equal(registry.queryMappings({ tenantId: "acme", releaseId: null }).length, 1);
  assert.equal(registry.queryMappings({ tenantId: "acme", releaseId: "2026.0.0" }).length, 0);

  const audit = registry.listAuditEvents({ tenantId: "acme", mappingId: "pharmmap:map-p3-000001" });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "mapping.create");
});

test("mapping registry rejects release writes and mappings missing source or target vocabulary versions", () => {
  const registry = testRegistry();

  assert.throws(
    () => registry.createMapping({
      tenantId: "acme",
      mapping: { ...validMapping(), review_status: "released", release_id: "pharmrelset:2026.0.0" },
      actor: "user:curator-1"
    }),
    /release_id must be null/
  );

  const missingVersion = validMapping();
  delete missingVersion.target_vocabulary_version;
  assert.throws(
    () => registry.createMapping({ tenantId: "acme", mapping: missingVersion, actor: "user:curator-1" }),
    /target_vocabulary_version/
  );
});

test("mapping registry creates proposed candidates from normalization output and flags duplicates without merging", () => {
  const registry = testRegistry();
  const first = registry.createCandidateMappingsFromNormalization({
    tenantId: "acme",
    normalizationOutput: {
      normalization_run_id: "norm:1",
      candidate_mappings: [validCandidateMapping({ mapping_id: "pharmmap:map-p3-000010" })]
    },
    actor: "service:normalization",
    correlationId: "corr:norm-1"
  });
  const duplicate = registry.createCandidateMappingsFromNormalization({
    tenantId: "acme",
    normalizationOutput: {
      normalized_outputs: [
        {
          candidate_mappings: [validCandidateMapping({ mapping_id: "pharmmap:map-p3-000011" })]
        }
      ]
    },
    actor: "service:normalization",
    correlationId: "corr:norm-2"
  });

  assert.equal(first.created.length, 1);
  assert.equal(first.rejected.length, 0);
  assert.equal(first.created[0].mapping.review_status, "proposed");
  assert.equal(duplicate.created.length, 1);
  assert.equal(duplicate.created[0].registry_metadata.duplicate_of, "pharmmap:map-p3-000010");
  assert.equal(duplicate.created[0].registry_metadata.duplicate_status, "flagged_duplicate_not_merged");
  assert.equal(registry.queryMappings({ tenantId: "acme", entityId: "chembl:CHEMBL25" }).length, 2);
});

test("mapping registry preserves workflow-owned candidate metadata outside the mapping object", () => {
  const registry = testRegistry();
  const result = registry.createCandidateMappingsFromNormalization({
    tenantId: "tenant-a",
    normalizationOutput: {
      proposals: [
        {
          mapping_proposals: [
            validCandidateMapping({
              mapping_id: "pharmmap:workflow-metadata",
              candidate_id: "candidate:workflow-metadata",
              tenant_id: "tenant-a",
              environment: "test",
              workflow_status: "staged_for_release",
              confidence_source: "deterministic_identifier_match",
              duplicate_status: "flag_only_do_not_merge",
              duplicate_candidate_flags: ["same_source_target_predicate"],
              scoring_signals: { identifier_exact: true },
              release_evidence_refs: [{ evidence_id: "pharmev:release-proof", evidence_role: "validation_evidence" }],
              validation_report_refs: [{ validation_run_id: "validation:p3", result: "passed" }]
            })
          ]
        }
      ]
    },
    actor: "service:normalization"
  });

  assert.equal(result.created.length, 1);
  const record = result.created[0];
  assert.equal(record.mapping.review_status, "proposed");
  assert.equal("workflow_status" in record.mapping, false);
  assert.equal(record.registry_metadata.workflow_status, "staged_for_release");
  assert.equal(record.registry_metadata.candidate_metadata.candidate_id, "candidate:workflow-metadata");
  assert.equal(record.registry_metadata.candidate_metadata.confidence_source, "deterministic_identifier_match");
  assert.deepEqual(record.registry_metadata.candidate_metadata.duplicate_candidate_flags, ["same_source_target_predicate"]);
  assert.deepEqual(record.registry_metadata.candidate_metadata.release_evidence_refs, [
    { evidence_id: "pharmev:release-proof", evidence_role: "validation_evidence" }
  ]);
  assert.deepEqual(record.registry_metadata.candidate_metadata.validation_report_refs, [
    { validation_run_id: "validation:p3", result: "passed" }
  ]);
});

test("candidate creation rejects fabricated confidence, approved status, and released candidates", () => {
  const registry = testRegistry();
  const noConfidence = validCandidateMapping({ mapping_id: "pharmmap:bad-confidence" });
  delete noConfidence.confidence_score;
  const approved = validCandidateMapping({ mapping_id: "pharmmap:bad-approved", review_status: "approved" });
  const released = validCandidateMapping({
    mapping_id: "pharmmap:bad-release",
    release_id: "pharmrelset:2026.0.0"
  });

  const result = registry.createCandidateMappingsFromNormalization({
    tenantId: "acme",
    normalizationOutput: { candidate_mappings: [noConfidence, approved, released] },
    actor: "service:normalization"
  });

  assert.equal(result.created.length, 0);
  assert.equal(result.rejected.length, 3);
  assert.ok(result.rejected.some((item) => /confidence_score/.test(item.error)));
  assert.ok(result.rejected.some((item) => /proposed\/draft/.test(item.error)));
  assert.ok(result.rejected.some((item) => /release_id/.test(item.error)));
});

test("P3-RT-001 direct registry create cannot self-approve governed mappings", () => {
  const registry = testRegistry();

  assert.throws(
    () => registry.createMapping({
      tenantId: "acme",
      mapping: validMapping({
        mapping_id: "pharmmap:bypass-create-approved",
        review_status: "approved",
        reviewed_by: "user:viewer-1"
      }),
      actor: "user:viewer-1",
      correlationId: "corr:p3-rt-001-create-approved"
    }),
    MappingRegistryError
  );
  assert.equal(registry.getMapping({
    tenantId: "acme",
    mappingId: "pharmmap:bypass-create-approved",
    includeDeleted: true
  }), null);
});

test("P3-RT-001 direct registry update cannot patch governed review, release, deprecation, or supersession state", () => {
  const registry = testRegistry();
  registry.createMapping({
    tenantId: "acme",
    mapping: validMapping({ mapping_id: "pharmmap:direct-governance-target" }),
    actor: "user:curator-1"
  });

  for (const patch of [
    { review_status: "approved", reviewed_by: "user:viewer-1" },
    { review_status: "rejected", reviewed_by: "user:viewer-1" },
    { reviewed_by: "user:viewer-1" },
    { release_id: "pharmrelset:2026.0.0" }
  ]) {
    assert.throws(
      () => registry.updateMapping({
        tenantId: "acme",
        mappingId: "pharmmap:direct-governance-target",
        patch,
        actor: "user:viewer-1",
        correlationId: "corr:p3-rt-001-update"
      }),
      MappingRegistryError
    );
  }

  assert.throws(
    () => registry.deprecateMapping({
      tenantId: "acme",
      mappingId: "pharmmap:direct-governance-target",
      actor: "user:viewer-1",
      reason: "direct deprecation bypass"
    }),
    MappingRegistryError
  );
  assert.throws(
    () => registry.supersedeMapping({
      tenantId: "acme",
      mappingId: "pharmmap:direct-governance-target",
      replacementMapping: validMapping({ mapping_id: "pharmmap:direct-supersession-replacement" }),
      actor: "user:viewer-1",
      reason: "direct supersession bypass"
    }),
    MappingRegistryError
  );

  const current = registry.getMapping({ tenantId: "acme", mappingId: "pharmmap:direct-governance-target" });
  assert.equal(current.mapping.review_status, "proposed");
  assert.equal(current.mapping.reviewed_by, null);
  assert.equal(current.mapping.release_id, null);
  assert.equal(current.registry_metadata.deprecation, null);
  assert.equal(current.registry_metadata.superseded_by, null);
});

test("P3-RT-001 governed registry decision is required, candidate-bound, fresh, and audited", () => {
  const registry = testRegistry();
  const created = registry.createMapping({
    tenantId: "tenant-a",
    mapping: validMapping({
      mapping_id: "pharmmap:governed-approval-target",
      source_entity_id: "chembl:CHEMBL25",
      target_entity_id: "pharment:compound/aspirin",
      target_vocabulary: "PharmaOps",
      target_vocabulary_version: "working-2026-06-27",
      target_license_policy_id: "license-policy:pharmaops-working",
      created_by: "user:normalizer",
      provenance: {
        actor: "service:normalization",
        timestamp: "2026-06-27T03:30:00.000Z",
        source: "ChEMBL",
        source_version: "34",
        audit_event_id: "audit:normalization-1"
      }
    }),
    actor: "service:normalization",
    correlationId: "corr:p3-rt-001-create-proposed",
    registryMetadata: {
      candidate_metadata: registryCandidateFixture({
        candidate_id: "candidate:governed-approval-target",
        mapping_id: "pharmmap:governed-approval-target"
      })
    }
  });
  const candidate = registryCandidateFixture({
    candidate_id: "candidate:governed-approval-target",
    mapping_id: "pharmmap:governed-approval-target"
  });
  const decision = assertCanGovernMappingCandidate({
    actor: actors.curator,
    candidate,
    action: MAPPING_ACTIONS.approve,
    tenant_id: "tenant-a",
    environment: "test",
    rationale: "Exact governed candidate approval.",
    correlation_id: "corr:p3-rt-001-approve"
  });
  const governedDecision = signedGovernedDecision({
    record: created,
    decision,
    action: MAPPING_ACTIONS.approve,
    actorRoleKey: "curator",
    auditEventType: "mapping_candidate_approved",
    previousReviewStatus: "proposed",
    nextReviewStatus: "approved",
    rationale: "Exact governed candidate approval.",
    correlationId: "corr:p3-rt-001-approve"
  });

  for (const authorizationDecision of [
    null,
    { ...governedDecision, signature: "" },
    { ...governedDecision, actor_user_id: "user:viewer-1" },
    { ...governedDecision, candidate_id: "candidate:other" },
    { ...governedDecision, tenant_id: "tenant-b" },
    signedGovernedDecision({
      record: created,
      decision,
      action: MAPPING_ACTIONS.approve,
      actorRoleKey: "curator",
      auditEventType: "mapping_candidate_approved",
      previousReviewStatus: "proposed",
      nextReviewStatus: "approved",
      rationale: "Exact governed candidate approval.",
      correlationId: "corr:p3-rt-001-approve",
      expiresAt: "2026-06-27T03:29:59.000Z"
    })
  ]) {
    assert.throws(
      () => registry.applyGovernedTransition({
        tenantId: "tenant-a",
        mappingId: "pharmmap:governed-approval-target",
        transition: "approve",
        authorizationDecision,
        auditContext: {
          actor_user_id: "user:curator-1",
          rationale: "Exact governed candidate approval.",
          correlation_id: "corr:p3-rt-001-approve"
        }
      }),
      MappingRegistryError
    );
  }

  const approved = registry.applyGovernedTransition({
    tenantId: "tenant-a",
    mappingId: "pharmmap:governed-approval-target",
    transition: "approve",
    authorizationContext: { governedDecision },
    auditContext: {
      actor_user_id: "user:curator-1",
      rationale: "Exact governed candidate approval.",
      correlation_id: "corr:p3-rt-001-approve"
    }
  });

  assert.equal(approved.mapping.review_status, "approved");
  assert.equal(approved.mapping.reviewed_by, "user:curator-1");
  assert.equal(approved.registry_metadata.authorization_context.governedDecision.candidate_id, "candidate:governed-approval-target");
  assert.equal(approved.registry_metadata.authorization_context.governedDecision.action, MAPPING_ACTIONS.approve);
  assert.ok(approved.registry_metadata.authorization_context.audit_event_id);
  assert.equal(registry.listAuditEvents({ tenantId: "tenant-a", mappingId: "pharmmap:governed-approval-target" }).at(-1).action, "mapping.governed.approve");

  assert.throws(
    () => registry.applyGovernedTransition({
      tenantId: "tenant-a",
      mappingId: "pharmmap:governed-approval-target",
      transition: "approve",
      authorizationContext: { governedDecision },
      auditContext: {
        actor_user_id: "user:curator-1",
        rationale: "Replay should fail.",
        correlation_id: "corr:p3-rt-001-approve-replay"
      }
    }),
    MappingRegistryError
  );
});

test("mapping registry updates and soft-deletes with audit while blocking direct deprecation and supersession", () => {
  const registry = testRegistry();
  registry.createMapping({ tenantId: "acme", mapping: validMapping(), actor: "user:curator-1" });
  const updated = registry.updateMapping({
    tenantId: "acme",
    mappingId: "pharmmap:map-p3-000001",
    patch: { predicate: "closeMatch", confidence_score: 0.82, confidence_band: "medium" },
    actor: "user:curator-2"
  });

  assert.equal(updated.mapping.predicate, "closeMatch");

  assert.throws(
    () => registry.deprecateMapping({
      tenantId: "acme",
      mappingId: "pharmmap:map-p3-000001",
      actor: "user:curator-3",
      reason: "source vocabulary issued replacement term"
    }),
    /governed transition/
  );
  assert.throws(
    () => registry.supersedeMapping({
      tenantId: "acme",
      mappingId: "pharmmap:map-p3-000001",
      replacementMapping: validMapping({ mapping_id: "pharmmap:map-p3-000002" }),
      actor: "user:curator-3",
      reason: "source vocabulary issued replacement term"
    }),
    /governed transition/
  );

  const deleted = registry.deleteMapping({
    tenantId: "acme",
    mappingId: "pharmmap:map-p3-000001",
    actor: "user:curator-4",
    reason: "withdrawn before review"
  });
  assert.ok(deleted.registry_metadata.deleted_at);
  assert.equal(registry.getMapping({ tenantId: "acme", mappingId: "pharmmap:map-p3-000001" }), null);
  assert.equal(registry.getMapping({ tenantId: "acme", mappingId: "pharmmap:map-p3-000001", includeDeleted: true }).mapping.mapping_id, "pharmmap:map-p3-000001");

  const audit = registry.listAuditEvents({ tenantId: "acme" });
  assert.deepEqual(audit.map((event) => event.action), [
    "mapping.create",
    "mapping.update",
    "mapping.delete"
  ]);
});

test("mapping registry creates structured side-by-side diffs from working state and proposal payloads", () => {
  const registry = testRegistry();
  const created = registry.createMapping({
    tenantId: "acme",
    mapping: validMapping(),
    actor: "user:curator-1",
    correlationId: "corr:create-diff-target"
  });
  const proposedMapping = {
    ...created.mapping,
    predicate: "closeMatch",
    source_vocabulary_version: "35",
    confidence_score: 0.82,
    confidence_band: "medium",
    evidence_ids: ["pharmev:evidence-p4-000002"],
    provenance_id: "pharmprov:mapping/p4-proposal-000002",
    provenance: {
      ...created.mapping.provenance,
      source_version: "35",
      audit_event_id: "audit:proposal-p4-000002"
    },
    curation_note: "source vocabulary advanced to ChEMBL 35"
  };
  delete proposedMapping.disclaimer_ids;

  const diff = registry.createDiff({
    tenantId: "acme",
    mappingId: "pharmmap:map-p3-000001",
    proposalId: "proposal:p4-diff-000001",
    correlationId: "corr:p4-diff-1",
    proposalPayload: {
      proposed_mapping: proposedMapping
    }
  });

  assert.equal(diff.object_type, "mapping");
  assert.equal(diff.object_id, "pharmmap:map-p3-000001");
  assert.equal(diff.proposal_id, "proposal:p4-diff-000001");
  assert.equal(diff.sides.current.vocabulary_versions.source_vocabulary_version, "34");
  assert.equal(diff.sides.proposed.vocabulary_versions.source_vocabulary_version, "35");
  assert.equal(diff.sides.current.provenance.source_audit_event_id, "audit:fixture-p3-000001");
  assert.equal(diff.sides.proposed.provenance.source_audit_event_id, "audit:proposal-p4-000002");
  assert.equal(diff.summary.counts.added, 1);
  assert.equal(diff.summary.counts.removed, 1);
  assert.ok(diff.summary.counts.changed >= 5);

  const sourceVersionField = diff.fields.find((field) => field.path === "source_vocabulary_version");
  assert.equal(sourceVersionField.change_type, "changed");
  assert.deepEqual(sourceVersionField.before, { present: true, value: "34" });
  assert.deepEqual(sourceVersionField.after, { present: true, value: "35" });
  assert.equal(sourceVersionField.current_context.provenance_id, "pharmprov:mapping/p3-000001");
  assert.equal(sourceVersionField.proposed_context.provenance_id, "pharmprov:mapping/p4-proposal-000002");

  const addedField = diff.fields.find((field) => field.path === "curation_note");
  assert.equal(addedField.change_type, "added");
  assert.deepEqual(addedField.before, { present: false, value: null });
  assert.equal(addedField.after.value, "source vocabulary advanced to ChEMBL 35");

  const removedField = diff.fields.find((field) => field.path === "disclaimer_ids");
  assert.equal(removedField.change_type, "removed");
  assert.deepEqual(removedField.after, { present: false, value: null });

  const preview = registry.diffPreview({
    actor: { user_id: "user:curator-1", tenant_id: "acme" },
    correlation_id: "corr:p4-diff-preview-1",
    proposal: {
      tenant_id: "acme",
      proposal_id: "proposal:p4-diff-preview-000001",
      proposal_type: "mapping",
      semantic_object_type: "mapping",
      semantic_object_id: "pharmmap:map-p3-000001",
      payload: {
        predicate: "closeMatch",
        confidence_score: 0.82,
        confidence_band: "medium"
      },
      provenance: {
        provenance_id: "pharmprov:mapping/p4-preview-000001",
        source: "curator-entry",
        source_version: "working-2026-06-27",
        evidence_ids: ["pharmev:evidence-p4-preview-000001"],
        audit_event_id: "audit:proposal-p4-preview-000001"
      }
    }
  });
  assert.equal(preview.object_type, "mapping");
  assert.equal(preview.object_id, "pharmmap:map-p3-000001");
  assert.equal(preview.proposal_id, "proposal:p4-diff-preview-000001");
  assert.equal(preview.sides.proposed.provenance.provenance_id, "pharmprov:mapping/p4-preview-000001");
  assert.ok(preview.summary.changed_paths.includes("predicate"));
});

test("mapping registry exports provenance-preserving mapping manifests", () => {
  const registry = testRegistry();
  const record = registry.createMapping({
    tenantId: "tenant-a",
    mapping: validMapping({
      mapping_id: "pharmmap:p4-export-000001",
      provenance_id: "pharmprov:mapping/p4-export-000001",
      evidence_ids: ["pharmev:evidence-p4-export-000001"],
      evidence_refs: [
        {
          evidence_id: "pharmev:evidence-p4-export-000001",
          evidence_role: "supports",
          required_for_release: true
        }
      ]
    }),
    actor: "user:curator-1",
    correlationId: "corr:p4-export-create",
    registryMetadata: {
      workflow_status: "staged_for_release",
      candidate_metadata: registryCandidateFixture({
        candidate_id: "candidate:p4-export-000001",
        mapping_id: "pharmmap:p4-export-000001",
        release_evidence_refs: [{ validation_run_id: "validation:p4-export", evidence_package_uri: "s3://fixture/p4-export.json" }],
        validation_report_refs: [{ validation_run_id: "validation:p4-export", result: "passed" }]
      })
    }
  });

  const exported = registry.exportMappings({
    tenantId: "tenant-a",
    mappingIds: [record.mapping.mapping_id],
    releaseContext: {
      release_id: "pharmrelset:2026.06.p4",
      release_candidate_id: "pharmrelcand:p4-000001",
      generated_by: "service:mapping-registry"
    },
    exportId: "export:p4-000001"
  });

  assert.equal(exported.export_id, "export:p4-000001");
  assert.equal(exported.tenant_id, "tenant-a");
  assert.equal(exported.record_count, 1);
  assert.equal(exported.release_context.release_id, "pharmrelset:2026.06.p4");
  assert.match(exported.manifest_digest, /^sha256:/);

  const item = exported.mappings[0];
  assert.deepEqual(item.canonical_ids, {
    mapping_id: "pharmmap:p4-export-000001",
    source_entity_id: "chembl:CHEMBL25",
    target_entity_id: "pubchem:CID2244",
    predicate: "exactMatch"
  });
  assert.equal(item.source.vocabulary, "ChEMBL");
  assert.equal(item.source.vocabulary_version, "34");
  assert.equal(item.target.vocabulary, "PubChem");
  assert.equal(item.target.vocabulary_version, "2026-06-01");
  assert.equal(item.provenance_id, "pharmprov:mapping/p4-export-000001");
  assert.equal(item.provenance.audit_event_id, "audit:fixture-p3-000001");
  assert.deepEqual(item.evidence.evidence_ids, ["pharmev:evidence-p4-export-000001"]);
  assert.deepEqual(item.evidence.release_evidence_refs, [
    { validation_run_id: "validation:p4-export", evidence_package_uri: "s3://fixture/p4-export.json" }
  ]);
  assert.equal(item.registry_metadata.candidate_id, "candidate:p4-export-000001");
  assert.equal(item.registry_metadata.workflow_status, "staged_for_release");
  assert.deepEqual(item.audit_linkage.registry_audit_event_ids, record.registry_metadata.audit_event_ids);
});

test("candidate mapping extraction accepts direct, normalized output, and batch shapes", () => {
  const direct = { candidate_mappings: [validCandidateMapping()] };
  const nested = { normalized_outputs: [{ candidate_mappings: [validCandidateMapping({ mapping_id: "pharmmap:nested" })] }] };
  const p301 = {
    proposals: [
      {
        entity_proposal: { candidate_id: "candidate:p3-01" },
        mapping_proposals: [validCandidateMapping({ mapping_id: "pharmmap:p3-01" })]
      }
    ]
  };

  assert.equal(extractCandidateMappings(direct).length, 1);
  assert.equal(extractCandidateMappings(nested).length, 1);
  assert.equal(extractCandidateMappings(p301).length, 1);
  assert.equal(extractCandidateMappings([direct, nested, p301]).length, 3);
});

function testRegistry() {
  let id = 0;
  return new MappingRegistry({
    clock: () => new Date("2026-06-27T03:30:00.000Z"),
    idFactory: () => `evt-${++id}`,
    governedDecisionVerifier: ({ decision, decision_binding }) =>
      decision.signature === testDecisionSignature(decision_binding)
  });
}

function validCandidateMapping(overrides = {}) {
  return validMapping({
    mapping_id: "pharmmap:map-p3-candidate-000001",
    created_by: "service:normalization",
    reviewed_by: null,
    review_status: "proposed",
    release_id: null,
    ...overrides
  });
}

function validMapping(overrides = {}) {
  return {
    mapping_id: "pharmmap:map-p3-000001",
    source_entity_id: "chembl:CHEMBL25",
    target_entity_id: "pubchem:CID2244",
    predicate: "exactMatch",
    source_vocabulary: "ChEMBL",
    source_vocabulary_version: "34",
    target_vocabulary: "PubChem",
    target_vocabulary_version: "2026-06-01",
    source_license_classification: "open_with_attribution",
    source_license_policy_id: "license-policy:chembl-34",
    target_license_classification: "open_with_attribution",
    target_license_policy_id: "license-policy:pubchem-2026-06-01",
    data_sensitivity: "public",
    materialization_policy: "materialize",
    permitted_uses: ["ingest", "normalize", "curate", "search", "evidence", "export", "release"],
    export_restrictions: ["attribution_required"],
    disclaimer_ids: ["source_terms:chembl"],
    legal_approval_id: null,
    retention_class: "public_source_snapshot",
    license_status: "valid",
    confidence_score: 0.98,
    confidence_band: "high",
    evidence_ids: ["pharmev:evidence-p3-000001"],
    evidence_refs: [
      {
        evidence_id: "pharmev:evidence-p3-000001",
        evidence_role: "supports",
        required_for_release: true
      }
    ],
    provenance_id: "pharmprov:mapping/p3-000001",
    created_by: "user:curator-1",
    reviewed_by: null,
    review_status: "proposed",
    release_id: null,
    provenance: {
      actor: "user:curator-1",
      timestamp: "2026-06-27T03:30:00.000Z",
      source: "ChEMBL",
      source_version: "34",
      audit_event_id: "audit:fixture-p3-000001"
    },
    ...overrides
  };
}

const actors = {
  curator: {
    user_id: "user:curator-1",
    role_keys: ["curator"],
    tenant_id: "tenant-a",
    environment: "test"
  }
};

function registryCandidateFixture(overrides = {}) {
  return {
    candidate_id: "candidate:governed-approval-target",
    mapping_id: "pharmmap:governed-approval-target",
    tenant_id: "tenant-a",
    environment: "test",
    review_status: "proposed",
    workflow_status: "queued_high_confidence",
    created_by_user_id: "user:normalizer",
    created_by_service_account_id: null,
    service_account_owner_user_id: null,
    source_entity_id: "chembl:CHEMBL25",
    target_entity_id: "pharment:compound/aspirin",
    predicate: "exactMatch",
    source_vocabulary: "ChEMBL",
    source_vocabulary_version: "34",
    target_vocabulary: "PharmaOps",
    target_vocabulary_version: "working-2026-06-27",
    source_license_policy_id: "license-policy:chembl-34",
    target_license_policy_id: "license-policy:pharmaops-working",
    license_status: "valid",
    permitted_uses: ["ingest", "normalize", "curate", "evidence", "release"],
    confidence_score: 0.98,
    confidence_band: "high",
    confidence_source: "deterministic_identifier_and_label_score",
    provenance_id: "pharmprov:mapping/000001",
    provenance: {
      actor: "service:normalization",
      timestamp: "2026-06-27T03:30:00.000Z",
      source: "ChEMBL",
      source_version: "34",
      audit_event_id: "audit:normalization-1"
    },
    evidence_ids: ["pharmev:evidence-2026-000001"],
    evidence_refs: [{ evidence_id: "pharmev:evidence-2026-000001", evidence_role: "supports" }],
    release_evidence_refs: [{ validation_run_id: "validation-map-1", evidence_package_uri: "s3://fixture/evidence.json" }],
    validation_report_refs: [{ validation_run_id: "validation-map-1", result: "passed" }],
    duplicate_status: "not_duplicate",
    release_id: null,
    ...overrides
  };
}

function signedGovernedDecision({
  record,
  decision,
  action,
  actorRoleKey,
  auditEventType,
  previousReviewStatus,
  nextReviewStatus,
  rationale,
  correlationId,
  releaseId = null,
  issuedAt = "2026-06-27T03:29:00.000Z",
  expiresAt = "2026-06-27T03:31:00.000Z"
}) {
  const value = {
    decision_id: `decision:${action}:${record.mapping.mapping_id}:${correlationId}:${releaseId ?? "none"}`,
    decision: "allow",
    action,
    actor_user_id: decision.actor_user_id,
    actor_role_key: actorRoleKey,
    tenant_id: record.tenant_id,
    environment: record.registry_metadata.candidate_metadata.environment,
    candidate_id: record.registry_metadata.candidate_metadata.candidate_id,
    mapping_id: record.mapping.mapping_id,
    previous_review_status: previousReviewStatus,
    next_review_status: nextReviewStatus,
    release_id: releaseId,
    rationale_digest: digestValue(rationale),
    evidence_digest: mappingEvidenceDigest(record),
    provenance_id: record.mapping.provenance_id,
    source_vocabulary_version: record.mapping.source_vocabulary_version,
    target_vocabulary_version: record.mapping.target_vocabulary_version,
    duplicate_status: record.registry_metadata.candidate_metadata.duplicate_status ?? null,
    audit_event_id: `audit:${action}:${record.mapping.mapping_id}`,
    correlation_id: correlationId,
    issued_at: issuedAt,
    expires_at: expiresAt,
    audit_event_type: auditEventType
  };
  value.decision_binding = buildGovernedDecisionBinding(value);
  value.signature = testDecisionSignature(value.decision_binding);
  return value;
}

function testDecisionSignature(decisionBinding) {
  return digestValue(`test-governed-decision-signature:${decisionBinding}`);
}
