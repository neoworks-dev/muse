<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { theme, applyTheme } from '$lib/theme.svelte';
	import { auth, initAuth } from '$lib/auth.svelte';
	import LoginGate from '../components/LoginGate.svelte';

	let { children } = $props();

	// Mirror the active theme onto <html data-theme> on mount and whenever it changes.
	$effect(() => {
		theme.mode;
		applyTheme();
	});

	onMount(initAuth);

	// The OAuth callback route handles its own redirect; never gate it.
	const isCallback = $derived(page.url.pathname.startsWith('/auth/callback'));
</script>

{#if isCallback}
	{@render children()}
{:else if !auth.ready}
	<div class="flex h-screen w-screen items-center justify-center bg-base-200 text-base-content">
		<p class="opacity-50">Loading…</p>
	</div>
{:else if !auth.authenticated}
	<LoginGate />
{:else}
	{@render children()}
{/if}
