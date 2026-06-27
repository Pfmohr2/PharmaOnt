export class ConnectorPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConnectorPolicyError";
    this.retryable = false;
  }
}

export class ConnectorRetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConnectorRetryableError";
    this.retryable = true;
  }
}
