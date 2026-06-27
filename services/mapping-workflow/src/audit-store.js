export class MemoryAuditEventStore {
  constructor() {
    this.events = [];
  }

  append(event) {
    const immutable = deepFreeze(structuredClone(event));
    this.events.push(immutable);
    return immutable;
  }

  list() {
    return [...this.events];
  }

  forCandidate(candidateId) {
    return this.events.filter((event) => event.candidate_id === candidateId);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}
