import { createHash } from "node:crypto";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value) {
  return JSON.stringify(sortForJson(value));
}

export function stableDigest(value) {
  return `sha256:${sha256(Buffer.isBuffer(value) || typeof value === "string" ? value : canonicalJson(value))}`;
}

export function materializeContent(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  return `${canonicalJson(value)}\n`;
}

function sortForJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortForJson(nested)])
    );
  }
  return value;
}
