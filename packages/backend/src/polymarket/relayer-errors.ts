function relayerErrorFromHttpDetail(detail: string): Error | null {
  const normalized = detail.toLowerCase();
  if (normalized.includes('deadline too soon')) {
    return new Error('relayer_deadline_too_soon');
  }
  return null;
}

function relayerErrorFromHttpPayload(payload: {
  status?: number;
  statusText?: string;
  data?: unknown;
}): Error | null {
  if (payload.status == null) return null;

  let detail = payload.statusText ?? String(payload.status);
  if (typeof payload.data === 'string' && payload.data) {
    detail = payload.data;
  } else if (payload.data && typeof payload.data === 'object') {
    const body = payload.data as { error?: string; message?: string };
    detail = body.message ?? body.error ?? JSON.stringify(payload.data);
  }

  const mapped = relayerErrorFromHttpDetail(detail);
  if (mapped) return mapped;
  return new Error(`relayer_http_${payload.status}:${detail}`);
}

export function normalizeRelayerError(err: unknown): Error {
  if (err instanceof Error) {
    if (err.message.startsWith('{')) {
      try {
        const payload = JSON.parse(err.message) as {
          status?: number;
          statusText?: string;
          data?: unknown;
        };
        const mapped = relayerErrorFromHttpPayload(payload);
        if (mapped) return mapped;
      } catch {
        // fall through
      }
    }

    const msg = err.message.toLowerCase();
    if (msg.includes('config is not supported on the chainid')) {
      return new Error('relayer_config_error');
    }
    if (msg.includes('econnrefused') || msg.includes('network')) {
      return new Error('relayer_network_error');
    }

    const status = (err as { response?: { status?: number; data?: { error?: string } } })
      .response?.status;
    if (status != null) {
      const detail = (err as { response?: { data?: { error?: string; message?: string } } })
        .response?.data;
      const suffix = detail?.message ?? detail?.error ?? String(status);
      const mapped = relayerErrorFromHttpDetail(suffix);
      if (mapped) return mapped;
      return new Error(`relayer_http_${status}:${suffix}`);
    }

    return err;
  }

  return new Error('relayer_unknown_error');
}
