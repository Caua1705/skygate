/* ============================================================
   3. HELPERS
   ============================================================ */

export function asArray(v) {
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.items)) return v.items;
  if (Array.isArray(v?.data)) return v.data;
  if (Array.isArray(v?.airports)) return v.airports;
  if (Array.isArray(v?.nodes)) return v.nodes;
  return [];
}

export function first(...vals) {
  return vals.find(v => v !== undefined && v !== null && v !== '');
}

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function norm(v) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function fmtMin(m) { return String(Math.max(1, Math.round(Number(m) || 0))); }

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

