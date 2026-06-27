import { createHash } from "node:crypto";

export function stableJson(value) {
  return JSON.stringify(sortForJson(value));
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex")}`;
}

function sortForJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortForJson(nested)])
    );
  }
  return value;
}
