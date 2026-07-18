import { httpClient } from './httpClient.js';

export function calculateRoute(payload, options) {
  return httpClient.request('/routes/calculate', {
    ...options,
    method: 'POST',
    body: JSON.stringify({ ...payload, persist_session: payload.persist_session ?? false }),
  });
}
