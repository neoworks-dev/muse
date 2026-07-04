<script lang="ts">
	import FloatingWindow from './FloatingWindow.svelte';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import type { BookmarkData } from '$lib/state.svelte';

	let {
		bookmark,
		origin,
		storageKey,
		onClose
	}: {
		bookmark: BookmarkData;
		origin?: { x: number; y: number; w: number; h: number };
		storageKey?: string;
		onClose: () => void;
	} = $props();

	let open = $state(true);

	$effect(() => {
		if (!open) setTimeout(onClose, 400);
	});
</script>

<FloatingWindow bind:open {origin} width={960} height={680} center zIndex={60} storageKey={storageKey ?? `bookmark:${bookmark.url}:win`}>
	{#snippet children(win)}
		<div
			class="flex h-full flex-col"
			onpointermove={win.moveDrag}
			onpointerup={win.endDrag}
		>
			<!-- Title bar -->
			<div
				class="flex h-10 shrink-0 cursor-grab select-none items-center gap-2 border-b border-base-200 px-3 active:cursor-grabbing"
				onpointerdown={win.startDrag}
				role="toolbar"
				tabindex="-1"
			>
				{#if bookmark.favicon}
					<img src={bookmark.favicon} alt="" class="h-4 w-4 shrink-0 rounded-sm" />
				{/if}
				<span class="min-w-0 flex-1 truncate text-sm font-medium">{bookmark.title}</span>
				{#if bookmark.domain}
					<span class="hidden shrink-0 text-xs text-base-content/40 md:block"
						>{bookmark.domain}</span
					>
				{/if}
				<button
					class="btn btn-ghost btn-xs shrink-0 gap-1"
					onclick={() => window.open(bookmark.url, '_blank', 'noopener,noreferrer')}
					onpointerdown={(e) => e.stopPropagation()}
					title="Open in system browser"
				>
					<ArrowSquareOutIcon size={14} />
					Browser
				</button>
				<button
					class="btn btn-ghost btn-xs btn-square shrink-0"
					onclick={() => (open = false)}
					onpointerdown={(e) => e.stopPropagation()}
					aria-label="Close"
				>
					<XIcon size={16} />
				</button>
			</div>

			<!-- webview bypasses X-Frame-Options/CORP that block iframes in Electron -->
			<webview
				src={bookmark.url}
				style="flex:1; width:100%; height:100%; min-height:0;"
				allowpopups
			></webview>
		</div>
	{/snippet}
</FloatingWindow>
