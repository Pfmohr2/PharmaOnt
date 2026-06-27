import { ConnectorRetryableError } from "./errors.js";

export const defaultRetryPolicy = Object.freeze({
  max_attempts: 3,
  initial_delay_ms: 100,
  max_delay_ms: 1000,
  multiplier: 2
});

export function nextBackoffMs(attemptIndex, policy = defaultRetryPolicy) {
  const delay = policy.initial_delay_ms * (policy.multiplier ** Math.max(0, attemptIndex - 1));
  return Math.min(delay, policy.max_delay_ms);
}

export async function withRetry(operation, {
  retryPolicy = defaultRetryPolicy,
  sleep = async () => {}
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retryPolicy.max_attempts; attempt += 1) {
    try {
      return await operation({ attempt });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === retryPolicy.max_attempts) {
        throw error;
      }
      await sleep(nextBackoffMs(attempt, retryPolicy));
    }
  }
  throw lastError;
}

export function isRetryable(error) {
  return error instanceof ConnectorRetryableError || error?.retryable === true;
}
