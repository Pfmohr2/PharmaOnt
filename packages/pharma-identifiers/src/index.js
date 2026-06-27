import registry from "./namespace-registry.json" with { type: "json" };

const PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const CURIE_PATTERN = /^([A-Za-z][A-Za-z0-9_.-]*):(.+)$/;

export const namespaceRegistry = Object.freeze(registry);

export function getNamespace(prefix) {
  return namespaceRegistry[prefix] ?? null;
}

export function listPrefixes() {
  return Object.keys(namespaceRegistry).sort();
}

export function parseCurie(curie) {
  if (typeof curie !== "string") {
    throw new TypeError("CURIE must be a string.");
  }

  const match = CURIE_PATTERN.exec(curie);
  if (!match) {
    throw new Error(`Invalid CURIE: ${curie}`);
  }

  const [, prefix, localId] = match;
  const namespace = getNamespace(prefix);
  if (!namespace) {
    throw new Error(`Unknown CURIE prefix: ${prefix}`);
  }
  if (localId.trim() !== localId || localId.length === 0) {
    throw new Error(`Invalid CURIE local ID: ${curie}`);
  }

  return { prefix, localId, namespace };
}

export function validateCurie(curie) {
  try {
    parseCurie(curie);
    return true;
  } catch {
    return false;
  }
}

export function expandCurie(curie) {
  const { localId, namespace } = parseCurie(curie);
  return `${namespace.iriPrefix}${encodeLocalId(localId)}`;
}

export function compactIri(iri) {
  if (!isAbsoluteIri(iri)) {
    throw new Error(`Invalid absolute IRI: ${iri}`);
  }

  const entries = Object.entries(namespaceRegistry)
    .sort((a, b) => b[1].iriPrefix.length - a[1].iriPrefix.length);
  for (const [prefix, namespace] of entries) {
    if (iri.startsWith(namespace.iriPrefix)) {
      const localId = decodeLocalId(iri.slice(namespace.iriPrefix.length));
      return `${prefix}:${localId}`;
    }
  }

  throw new Error(`IRI is not in the PharmaOps namespace registry: ${iri}`);
}

export function isAbsoluteIri(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/.test(value);
}

export function validateNamespaceRegistry(candidate = namespaceRegistry) {
  const errors = [];
  const seenIriPrefixes = new Map();

  for (const [prefix, namespace] of Object.entries(candidate)) {
    if (!PREFIX_PATTERN.test(prefix)) {
      errors.push(`Invalid prefix: ${prefix}`);
    }
    if (!namespace || typeof namespace.iriPrefix !== "string" || !isAbsoluteIri(namespace.iriPrefix)) {
      errors.push(`Invalid iriPrefix for prefix ${prefix}`);
      continue;
    }
    if (seenIriPrefixes.has(namespace.iriPrefix)) {
      errors.push(`Duplicate iriPrefix for ${prefix} and ${seenIriPrefixes.get(namespace.iriPrefix)}`);
    }
    seenIriPrefixes.set(namespace.iriPrefix, prefix);
  }

  return { valid: errors.length === 0, errors };
}

function encodeLocalId(localId) {
  if (localId.includes("/")) {
    return localId.split("/").map(encodeURIComponent).join("/");
  }
  return encodeURIComponent(localId);
}

function decodeLocalId(localId) {
  if (localId.includes("/")) {
    return localId.split("/").map(decodeURIComponent).join("/");
  }
  return decodeURIComponent(localId);
}
