export interface NamespaceDefinition {
  name: string;
  iriPrefix: string;
  preferred?: boolean;
  licenseRestricted?: boolean;
}

export interface ParsedCurie {
  prefix: string;
  localId: string;
  namespace: NamespaceDefinition;
}

export const namespaceRegistry: Readonly<Record<string, NamespaceDefinition>>;

export function getNamespace(prefix: string): NamespaceDefinition | null;
export function listPrefixes(): string[];
export function parseCurie(curie: string): ParsedCurie;
export function validateCurie(curie: string): boolean;
export function expandCurie(curie: string): string;
export function compactIri(iri: string): string;
export function isAbsoluteIri(value: string): boolean;
export function validateNamespaceRegistry(
  candidate?: Record<string, NamespaceDefinition>
): { valid: boolean; errors: string[] };
