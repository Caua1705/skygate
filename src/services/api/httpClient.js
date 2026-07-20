import { APP_CONFIG, getApiBaseUrl } from '../../app/config/appConfig.js';

export class SkyGateApiError extends Error {
  constructor(message, { kind = 'http', status = 0, body = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SkyGateApiError';
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

async function readBody(response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export function createHttpClient({ baseUrl = getApiBaseUrl, timeoutMs = APP_CONFIG.api.timeoutMs } = {}) {
  return {
    async request(path, options = {}) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      const signal = options.signal
        ? AbortSignal.any ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
        : controller.signal;
      let response;
      try {
        response = await fetch(`${baseUrl()}${path}`, {
          ...options,
          signal,
          headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        });
      } catch (cause) {
        const kind = cause?.name === 'AbortError' ? 'timeout' : 'network';
        throw new SkyGateApiError(kind === 'timeout' ? 'A requisição demorou demais.' : 'Não foi possível conectar à API.', { kind, cause });
      } finally {
        window.clearTimeout(timeout);
      }
      if (!response.ok) {
        const body = await readBody(response);
        const kind = response.status === 422 ? 'validation' : response.status === 404 ? 'not_found' : response.status >= 500 ? 'server' : 'http';
        throw new SkyGateApiError(`API error ${response.status}`, { kind, status: response.status, body });
      }
      if (response.status === 204) return null;
      try { return await response.json(); } catch (cause) {
        throw new SkyGateApiError('Resposta inválida da API.', { kind: 'invalid_response', status: response.status, cause });
      }
    },
  };
}

export const httpClient = createHttpClient();
