import createSdk, { neoworksUrls } from '@neoworks-dev/sdk';
import type { TokenSet, TokenStorage } from '@neoworks-dev/sdk';

// muse is a static SPA / Electron renderer with no server, so token refresh is
// direct-to-auth-server and the refresh token must be readable by JS. A
// localStorage-backed store persists tokens across reloads in both browser and
// Electron. (Cookie storage doesn't persist meaningfully under app://.)
class LocalStorageTokenStorage implements TokenStorage {
	private readonly key = 'muse:tokens';

	save(tokens: TokenSet): void {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(this.key, JSON.stringify(tokens));
	}

	load(): TokenSet | null {
		if (typeof localStorage === 'undefined') return null;
		const raw = localStorage.getItem(this.key);
		if (!raw) return null;
		try {
			return JSON.parse(raw) as TokenSet;
		} catch {
			return null;
		}
	}

	clear(): void {
		if (typeof localStorage === 'undefined') return;
		localStorage.removeItem(this.key);
	}
}

const env = import.meta.env;

// All service URLs derive from one base domain (dev: neoworks.localhost,
// prod: neoworks.dev). Per-service VITE_*_URL overrides still win when set.
const urls = neoworksUrls({
	baseDomain: env.VITE_BASE_DOMAIN,
	scheme: env.VITE_BASE_SCHEME
});

/** OAuth/auth server origin — also where the Vault iframe is served from. */
export const oauthUrl: string = env.VITE_AUTH_URL ?? urls.oauth;
export const apiUrl: string = env.VITE_API_URL ?? urls.api;
export const assetsUrl: string = env.VITE_ASSETS_URL ?? urls.assets;
export const clientId: string = env.VITE_CLIENT_ID ?? 'muse';

function redirectUri(): string {
	if (typeof window === 'undefined') return '';
	return `${window.location.origin}/auth/callback`;
}

export const sdk = createSdk({
	url: oauthUrl,
	apiUrl,
	assetsUrl,
	clientId,
	redirectUri: redirectUri(),
	scopes: ['openid', 'email', 'profile'],
	storage: new LocalStorageTokenStorage()
});

/** The muse client database's generated GraphQL data plane. */
export const museDb = sdk.dataPlane('muse');

export interface UserInfo {
	sub: string;
	email?: string;
}

/** Fetches the signed-in user's identity from the OIDC userinfo endpoint. */
export async function fetchUserInfo(): Promise<UserInfo | null> {
	const token = await sdk.auth.getAccessToken();
	if (!token) return null;
	const res = await fetch(`${oauthUrl}/oauth/userinfo`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) return null;
	return (await res.json()) as UserInfo;
}
