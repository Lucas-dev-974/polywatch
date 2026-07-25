import { createBackendClient } from '@polywatch/core';
import { config } from './config.js';

const { postBackendJson, postBackendAlert } = createBackendClient({
  backendUrl: config.backendUrl,
  serviceToken: config.serviceToken,
});

export { postBackendJson, postBackendAlert };
export { BACKEND_HTTP_TIMEOUT_MS } from '@polywatch/core';