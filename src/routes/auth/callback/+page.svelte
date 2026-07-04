<script lang="ts">
	import { onMount } from 'svelte';
	import { sdk } from '$lib/sdk';

	let error = $state<string | null>(null);

	onMount(async () => {
		const params = new URL(window.location.href).searchParams;
		const code = params.get('code');
		const state = params.get('state');

		// Popup flow: relay the code to the opener (same origin) and close.
		if (code && window.opener && window.opener !== window) {
			window.opener.postMessage({ type: 'nw-auth', code, state }, window.location.origin);
			window.close();
			return;
		}

		// Full-page redirect fallback.
		try {
			await sdk.auth.handleCallback();
			window.location.replace('/');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Sign-in failed';
		}
	});
</script>

<div class="flex h-screen w-screen items-center justify-center bg-base-200 text-base-content">
	{#if error}
		<div class="flex flex-col items-center gap-3">
			<p class="text-error">{error}</p>
			<a href="/" class="btn btn-sm">Back</a>
		</div>
	{:else}
		<p class="opacity-60">Signing you in…</p>
	{/if}
</div>
