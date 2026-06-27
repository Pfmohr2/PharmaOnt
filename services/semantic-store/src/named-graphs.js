import { RelationshipAssertionStore } from "./relationship-assertion-store.js";

export const GRAPH_FAMILIES = Object.freeze({
  workingCanonical: "data:canonical:working",
  workingMappings: "mappings:working",
  workingEvidence: "evidence:working",
  stagingAiSuggestions: "ai-suggestions:staging",
  validation: "validation",
  source: "source",
  release: "release"
});

const GOVERNED_RELATIONSHIP_CAPABILITIES = new WeakSet();
const WORKING_DOMAINS = new Set(["data:canonical", "mappings", "evidence", "relationships"]);
const RELEASE_DOMAINS = new Set(["canonical", "mappings", "evidence", "relationships"]);
const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const DOMAIN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}(:[A-Za-z0-9][A-Za-z0-9_.-]{0,127})*$/;

export function tenantWorkingGraph(tenantId, domain = "data:canonical") {
  assertTenantId(tenantId);
  assertDomain(domain);
  return `graph:tenant:${tenantId}:${domain}:working`;
}

export function tenantAiSuggestionsGraph(tenantId) {
  assertTenantId(tenantId);
  return `graph:tenant:${tenantId}:ai-suggestions:staging`;
}

export function tenantSourceGraph(tenantId, sourceName, sourceVersion) {
  assertTenantId(tenantId);
  assertToken(sourceName, "sourceName");
  assertToken(sourceVersion, "sourceVersion");
  return `graph:tenant:${tenantId}:source:${sourceName}:${sourceVersion}`;
}

export function tenantValidationGraph(tenantId, validationRunId) {
  assertTenantId(tenantId);
  assertToken(validationRunId, "validationRunId");
  return `graph:tenant:${tenantId}:validation:${validationRunId}`;
}

export function tenantReleaseGraph(tenantId, releaseId, domain = "canonical") {
  assertTenantId(tenantId);
  assertToken(releaseId, "releaseId");
  assertToken(domain, "domain");
  return `graph:tenant:${tenantId}:release:${releaseId}:${domain}`;
}

export function assertWritableWorkingGraph(graphName) {
  let graph;
  try {
    graph = classifyNamedGraph(graphName);
  } catch {
    throw new Error(`semantic writes are restricted to tenant working graphs; received ${graphName}`);
  }
  if (graph.kind !== "working") {
    throw new Error(`semantic writes are restricted to tenant working graphs; received ${graphName}`);
  }
}

export function assertReleaseGraph(graphName) {
  let graph;
  try {
    graph = classifyNamedGraph(graphName);
  } catch {
    throw new Error(`release snapshots require tenant-scoped release graph names; received ${graphName}`);
  }
  if (graph.kind !== "release") {
    throw new Error(`release snapshots require tenant-scoped release graph names; received ${graphName}`);
  }
}

export function assertGraphWritePolicy({
  graphName,
  tenantId,
  capability = null,
  operation = "write",
  kind = "working"
}) {
  const graph = classifyNamedGraph(graphName);
  if (graph.tenantId !== tenantId) {
    throw new GraphWritePolicyError(`graph tenant mismatch: expected ${tenantId}, received ${graph.tenantId ?? "none"} from ${graphName}`, {
      reason: "tenant_mismatch",
      graph
    });
  }
  if (kind && graph.kind !== kind) {
    throw new GraphWritePolicyError(`${operation} requires tenant ${kind} graphs, received ${graph.kind} graph ${graphName}`, {
      reason: "graph_kind_mismatch",
      graph
    });
  }
  if (graph.governedOnly && !GOVERNED_RELATIONSHIP_CAPABILITIES.has(capability)) {
    throw new GraphWritePolicyError(`relationship graph family is reserved for RelationshipAssertionStore governed writes: ${graphName}`, {
      reason: "governed_relationship_graph_reserved",
      graph,
      operation
    });
  }
  return graph;
}

export function createGovernedRelationshipAssertionStore(deps = {}) {
  const capability = Object.freeze({ owner: "RelationshipAssertionStore" });
  GOVERNED_RELATIONSHIP_CAPABILITIES.add(capability);
  return new RelationshipAssertionStore({
    ...deps,
    relationshipGraphWriteCapability: capability
  });
}

export function classifyNamedGraph(graphName) {
  const workingMatch = /^graph:tenant:([^:]+):(.+):working$/.exec(String(graphName ?? ""));
  if (workingMatch) {
    const [, tenantId, rawDomain] = workingMatch;
    assertTenantId(tenantId);
    const domain = canonicalDomain(rawDomain);
    assertCanonicalDomain({ graphName, rawDomain, domain, allowedDomains: WORKING_DOMAINS, kind: "working" });
    return namedGraphClassification({ graphName, tenantId, kind: "working", domain });
  }

  const releaseMatch = /^graph:tenant:([^:]+):release:([^:]+):([^:]+)$/.exec(String(graphName ?? ""));
  if (releaseMatch) {
    const [, tenantId, releaseId, rawDomain] = releaseMatch;
    assertTenantId(tenantId);
    assertToken(releaseId, "releaseId");
    const domain = canonicalDomain(rawDomain);
    assertCanonicalDomain({ graphName, rawDomain, domain, allowedDomains: RELEASE_DOMAINS, kind: "release" });
    return namedGraphClassification({ graphName, tenantId, kind: "release", domain, releaseId });
  }

  throw new GraphWritePolicyError(`invalid tenant-scoped graph name: ${graphName}`, {
    reason: "invalid_graph_name",
    graphName
  });
}

export function tenantIdFromGraph(graphName) {
  return /^graph:tenant:([^:]+):/.exec(graphName)?.[1] ?? null;
}

export function assertGraphTenant(graphName, tenantId) {
  const graphTenantId = tenantIdFromGraph(graphName);
  if (graphTenantId !== tenantId) {
    throw new Error(`graph tenant mismatch: expected ${tenantId}, received ${graphTenantId ?? "none"} from ${graphName}`);
  }
}

export function isTenantScopedGraph(graphName) {
  return /^graph:tenant:[A-Za-z0-9_-]+:/.test(graphName);
}

export class GraphWritePolicyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "GraphWritePolicyError";
    this.status = details.reason === "governed_relationship_graph_reserved" ? 409 : 403;
    this.code = details.reason ?? "graph_write_policy_error";
    this.details = details;
  }
}

function namedGraphClassification({ graphName, tenantId, kind, domain, releaseId = null }) {
  const relationshipsFamily = domain === "relationships";
  return {
    graphName,
    tenantId,
    kind,
    domain,
    releaseId,
    governedOnly: relationshipsFamily,
    family: relationshipsFamily ? "relationships" : domain
  };
}

function canonicalDomain(rawDomain) {
  return String(rawDomain ?? "").toLowerCase();
}

function assertCanonicalDomain({ graphName, rawDomain, domain, allowedDomains, kind }) {
  if (rawDomain !== domain) {
    throw new GraphWritePolicyError(`relationship graph family near-miss or non-canonical graph domain is invalid: ${graphName}`, {
      reason: "non_canonical_graph_domain",
      graphName,
      rawDomain,
      domain,
      kind
    });
  }
  if (!allowedDomains.has(domain)) {
    const relationshipNearMiss = domain === "relationships" || domain.startsWith("relationships:");
    throw new GraphWritePolicyError(
      relationshipNearMiss
        ? `relationship graph family near-miss is invalid and reserved for governed writes: ${graphName}`
        : `unknown ${kind} graph domain is not registered: ${graphName}`,
      {
        reason: relationshipNearMiss ? "relationship_graph_near_miss" : "unknown_graph_domain",
        graphName,
        rawDomain,
        domain,
        kind
      }
    );
  }
}

function assertTenantId(tenantId) {
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new Error(`invalid tenant id for named graph: ${tenantId}`);
  }
}

function assertToken(value, fieldName) {
  if (!TOKEN_PATTERN.test(value)) {
    throw new Error(`invalid ${fieldName} for named graph: ${value}`);
  }
}

function assertDomain(value) {
  if (!DOMAIN_PATTERN.test(value)) {
    throw new Error(`invalid domain for named graph: ${value}`);
  }
}
