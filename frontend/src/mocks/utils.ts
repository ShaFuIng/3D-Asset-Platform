// Small shared helpers for the mock API client.

let mockIdCounter = 0;

/** Generates a unique, human-readable fake id, e.g. "mock-job-3". */
export function createMockId(prefix: string): string {
  mockIdCounter += 1;
  return `mock-${prefix}-${mockIdCounter}`;
}

/**
 * Resolves after `ms` milliseconds, mirroring how a real fetch() would behave
 * when the caller aborts via AbortSignal (rejects with a DOMException named
 * "AbortError", matching the error shape the UI already handles).
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
