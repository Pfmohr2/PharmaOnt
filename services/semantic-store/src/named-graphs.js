export const GRAPH_FAMILIES = Object.freeze({
  workingCanonical: "data:canonical:working",
  workingMappings: "mappings:working",
  workingEvidence: "evidence:working",
  stagingAiSuggestions: "ai-suggestions:staging",
  validation: "validation",
  source: "source",
  release: "release"
});

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
  if (!/^graph:tenant:[A-Za-z0-9_-]+:.+:working$/.test(graphName)) {
    throw new Error(`semantic writes are restricted to tenant working graphs; received ${graphName}`);
  }
}

export function assertReleaseGraph(graphName) {
  if (!/^graph:tenant:[A-Za-z0-9_-]+:release:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(graphName)) {
    throw new Error(`release snapshots require tenant-scoped release graph names; received ${graphName}`);
  }
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
