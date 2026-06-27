import { createHash } from "node:crypto";

export function sha256(value) {
  return `sha256:${sha256Hex(value)}`;
}

export function sha256Hex(value) {
  return createHash("sha256").update(stringBytes(value)).digest("hex");
}

export function stableStringify(value) {
  return JSON.stringify(sortForJson(value));
}

function stringBytes(value) {
  if (typeof value === "string" || value instanceof Uint8Array) {
    return value;
  }
  return stableStringify(value);
}

function sortForJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortForJson(child)])
    );
  }
  return value;
}
