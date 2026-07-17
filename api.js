export const API_BASE_URL = 'http://212.85.0.237:8003';

const LOCAL_DEV_API_BASE_URL = 'http://127.0.0.1:8000';

function shouldUseLocalDevApi() {
  const isLocalFrontend = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return isLocalFrontend && localStorage.getItem('SKYGATE_USE_LOCAL_API') === 'true';
}

function getApiBase() {
  const explicitOverride = window.SKYGATE_API_BASE;
  const baseUrl = explicitOverride || (shouldUseLocalDevApi() ? LOCAL_DEV_API_BASE_URL : API_BASE_URL);
  return baseUrl.replace(/\/$/, '');
}

async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${getApiBase()}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch (cause) {
    throw new SkyGateApiError('Nao foi possivel conectar a API.', {
      kind: 'network',
      cause,
    });
  }

  if (!response.ok) {
    const body = await readResponseBody(response);
    const kind = response.status === 422
      ? 'validation'
      : response.status === 404
        ? 'not_found'
        : response.status >= 500
          ? 'server'
          : 'http';

    if (response.status === 422) {
      console.error('SkyGate API 422 response:', body);
    }

    throw new SkyGateApiError(`API error ${response.status}`, {
      kind,
      status: response.status,
      body,
    });
  }

  if (response.status === 204) return null;
  return response.json();
}

async function readResponseBody(response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class SkyGateApiError extends Error {
  constructor(message, { kind = 'http', status = 0, body = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SkyGateApiError';
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

export function getAirports() {
  return request('/airports');
}

export function getAirport(slug) {
  return request(`/airports/${encodeURIComponent(slug)}`);
}

export function getAirportMap(slug) {
  return request(`/airports/${encodeURIComponent(slug)}/map`);
}

export function calculateRoute(payload) {
  return request('/routes/calculate', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      persist_session: payload.persist_session ?? false,
    }),
  });
}