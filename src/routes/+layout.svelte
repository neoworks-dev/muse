<script lang="ts">
	import './layout.css';
	import { theme, applyTheme } from '$lib/theme.svelte';

	let { children } = $props();

	// Mirror the active theme onto <html data-theme> on mount and whenever it changes.
	$effect(() => {
		theme.mode;
		applyTheme();
	});
</script>

{@render children()}
