import { sdk, fetchUserInfo, type UserInfo } from './sdk';
import { ensureVault } from './media';

export const auth = $state({
	ready: false,
	authenticated: false,
	user: null as UserInfo | null
});

/** Checks existing tokens and loads the user profile. Call once on app mount. */
export async function initAuth(): Promise<void> {
	try {
		auth.authenticated = await sdk.auth.isAuthenticated();
		if (auth.authenticated) {
			auth.user = await fetchUserInfo();
		}
	} catch {
		auth.authenticated = false;
		auth.user = null;
	} finally {
		auth.ready = true;
	}
}

/**
 * Logs in via a popup (PKCE) so the canvas isn't torn down by a full redirect,
 * then surfaces the Vault immediately so the user can unlock encryption. Falls
 * back to a full-page redirect if the popup is blocked.
 */
export async function login(): Promise<void> {
	const { url, verifier, state } = await sdk.auth.getAuthorizationUrl();

	const popup = window.open(url, 'nw-login', popupFeatures());
	if (!popup) {
		await sdk.auth.login(); // redirect fallback
		return;
	}

	try {
		const code = await waitForCode(state, popup);
		await sdk.auth.exchangeCode(code, verifier);
	} finally {
		try {
			popup.close();
		} catch {
			/* ignore */
		}
	}

	await initAuth();
	// Surface the Vault right away (don't block on the user unlocking it).
	void ensureVault();
}

function popupFeatures(): string {
	const w = 480;
	const h = 720;
	const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
	const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
	return `popup=1,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)}`;
}

function waitForCode(expectedState: string, popup: Window): Promise<string> {
	return new Promise((resolve, reject) => {
		const onMessage = (e: MessageEvent) => {
			if (e.origin !== window.location.origin) return;
			const data = e.data;
			if (!data || data.type !== 'nw-auth') return;
			if (data.state !== expectedState) return;
			cleanup();
			resolve(data.code as string);
		};
		const poll = setInterval(() => {
			if (popup.closed) {
				cleanup();
				reject(new Error('login cancelled'));
			}
		}, 500);
		function cleanup() {
			window.removeEventListener('message', onMessage);
			clearInterval(poll);
		}
		window.addEventListener('message', onMessage);
	});
}

export async function logout(): Promise<void> {
	await sdk.auth.logout();
	auth.authenticated = false;
	auth.user = null;
	if (typeof localStorage !== 'undefined') {
		localStorage.removeItem('muse:provisioned');
	}
	if (typeof window !== 'undefined') {
		window.location.reload();
	}
}
