export class MemoryMappingCandidateStore {
  constructor(candidates = []) {
    this.candidates = new Map(candidates.map((candidate) => [candidate.candidate_id, structuredClone(candidate)]));
  }

  get(candidateId) {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) {
      throw new Error("mapping candidate not found");
    }
    return structuredClone(candidate);
  }

  put(candidate) {
    this.candidates.set(candidate.candidate_id, structuredClone(candidate));
    return this.get(candidate.candidate_id);
  }

  list() {
    return [...this.candidates.values()].map((candidate) => structuredClone(candidate));
  }
}

export class MemoryReleaseStagingStore {
  constructor() {
    this.entries = [];
  }

  stage(entry) {
    const staged = Object.freeze(structuredClone(entry));
    this.entries.push(staged);
    return staged;
  }

  list() {
    return [...this.entries];
  }
}
