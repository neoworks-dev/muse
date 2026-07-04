// Dynamic, client-only route: the OAuth provider redirects here with ?code=…
// Served via the SPA fallback (not prerendered).
export const ssr = false;
export const prerender = false;
