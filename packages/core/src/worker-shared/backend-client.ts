/**
 * Backend HTTP client utilities.
 *
 * These functions accept `{ backendUrl, serviceToken }` explicitly so they
 * have no dependency on any worker-specific config module. The worker passes
 * its own config values; future packages (e.g. crypto-algo) can pass theirs.
 */

export interface BackendClientConfig {
  backendUrl: string;
  serviceToken: string;
}

export const BACKEND_HTTP_TIMEOUT_MS = 5_000;

/**
 * Combine an external AbortSignal (if any) with an internal timeout into a
 * single signal. The returned signal aborts when either the timeout fires or
 * the external signal aborts.
 */
function combineTimeoutAndSignal(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Backend HTTP timeout', 'TimeoutError'));
  }, timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
      clearTimeout(timer);
      return { signal: controller.signal, cleanup: () => {} };
    }
    const onAbort = () => {
      clearTimeout(timer);
      controller.abort(externalSignal.reason);
    };
    externalSignal.addEventListener('abort', onAbort, { once: true });
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        externalSignal.removeEventListener('abort', onAbort);
      },
    };
  }

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

/**
 * Create backend-client functions bound to a specific config.
 * Usage: `const { postBackendJson, postBackendAlert } = createBackendClient({ backendUrl, serviceToken });`
 */
export function createBackendClient(clientConfig: BackendClientConfig) {
  function postBackendJson(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const { signal: combinedSignal, cleanup } = combineTimeoutAndSignal(
      signal,
      BACKEND_HTTP_TIMEOUT_MS,
    );

    return fetch(`${clientConfig.backendUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Token': clientConfig.serviceToken,
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    }).finally(cleanup);
  }

  /**
   * POST an alert to the backend, fire-and-forget style.
   * Uses the same timeout and auth as postBackendJson.
   * Errors are silently caught — the caller's log already covers failures.
   */
  function postBackendAlert(path: string, body: unknown): void {
    void postBackendJson(path, body).catch(() => {
      // Alert delivery is best-effort; failures are expected when the
      // backend is down and are handled by the caller's log.
    });
  }

  function getBackendJson(
    path: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const { signal: combinedSignal, cleanup } = combineTimeoutAndSignal(
      signal,
      BACKEND_HTTP_TIMEOUT_MS,
    );

    return fetch(`${clientConfig.backendUrl}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Token': clientConfig.serviceToken,
      },
      signal: combinedSignal,
    }).finally(cleanup);
  }

  return { postBackendJson, postBackendAlert, getBackendJson };
}