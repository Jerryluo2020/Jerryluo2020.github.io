declare global {
  interface Window { __ASHARE_API_ORIGIN__?: string }
}
export function apiUrl(path: string) {
  const origin = typeof window === 'undefined' ? '' : (window.__ASHARE_API_ORIGIN__ || '');
  return `${origin.replace(/\/$/, '')}${path}`;
}
let transport: ((path: string, init?: RequestInit) => Promise<Response>) | undefined;
export function setApiTransport(value: NonNullable<typeof transport>) { transport = value; }
export function apiFetch(path: string, init?: RequestInit) {
  return transport ? transport(path, init) : fetch(apiUrl(path), init);
}
