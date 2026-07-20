export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export const $ = id => document.getElementById(id);


export const root = document.getElementById('app');
