declare global {
  interface Window { __ASHARE_API_ORIGIN__?: string }
}
export function apiUrl(path: string) {
  const origin = typeof window === 'undefined' ? '' : (window.__ASHARE_API_ORIGIN__ || '');
  return `${origin.replace(/\/$/, '')}${path}`;
}
