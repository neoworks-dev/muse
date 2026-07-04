<script lang="ts">
	import type { Snippet } from 'svelte';

	type Align = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

	let {
		trigger,
		children,
		align = 'bottom-left',
	}: {
		trigger: Snippet<[{ open: boolean; toggle: () => void; close: () => void }]>;
		children?: Snippet;
		align?: Align;
	} = $props();

	let open = $state(false);
	let el: HTMLDivElement | undefined;

	function toggle() { open = !open; }
	function close() { open = false; }

	function onWindowPointerDown(e: PointerEvent) {
		if (!open) return;
		if (!el?.contains(e.target as Node)) open = false;
	}

	const posClass: Record<Align, string> = {
		'bottom-left':  'top-full left-0 mt-1.5',
		'bottom-right': 'top-full right-0 mt-1.5',
		'top-left':     'bottom-full left-0 mb-1.5',
		'top-right':    'bottom-full right-0 mb-1.5',
	};
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="relative" bind:this={el}>
	{@render trigger({ open, toggle, close })}

	{#if open}
		<div
			class="absolute {posClass[align]} z-[70] min-w-[160px] rounded-xl border border-base-200 bg-base-100 py-1 shadow-lg"
		>
			{#if children}
				{@render children()}
			{/if}
		</div>
	{/if}
</div>
