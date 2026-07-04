<script lang="ts">
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import ArrowLineUpIcon from 'phosphor-svelte/lib/ArrowLineUpIcon';
	import ArrowLineDownIcon from 'phosphor-svelte/lib/ArrowLineDownIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import ArticleIcon from 'phosphor-svelte/lib/ArticleIcon';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import ArrowsLeftRightIcon from 'phosphor-svelte/lib/ArrowsLeftRightIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import TagIcon from 'phosphor-svelte/lib/TagIcon';
	import type { ContextMenuItem } from '$lib/canvas/core/types';

	const ICONS: Record<string, unknown> = {
		pencil: PencilSimpleIcon,
		trash: TrashIcon,
		'arrow-line-up': ArrowLineUpIcon,
		'arrow-line-down': ArrowLineDownIcon,
		'folder-open': FolderOpenIcon,
		article: ArticleIcon,
		'arrow-right': ArrowRightIcon,
		'arrow-left': ArrowLeftIcon,
		'arrows-lr': ArrowsLeftRightIcon,
		minus: MinusIcon,
		tag: TagIcon
	};

	let {
		items,
		x,
		y,
		onClose
	}: {
		items: ContextMenuItem[];
		x: number;
		y: number;
		onClose: () => void;
	} = $props();

	let menuEl: HTMLDivElement | undefined;

	let left = $state(x);
	let top = $state(y);

	$effect(() => {
		if (!menuEl) return;
		const rect = menuEl.getBoundingClientRect();
		left = x + rect.width  > window.innerWidth  ? window.innerWidth  - rect.width  - 8 : x;
		top  = y + rect.height > window.innerHeight ? window.innerHeight - rect.height - 8 : y;
	});

	function handleAction(item: ContextMenuItem & { kind: 'action' }) {
		item.action();
		onClose();
	}
</script>

<!-- Backdrop -->
<div class="fixed inset-0 z-40" onpointerdown={onClose} role="presentation" />

<!-- Menu -->
<div
	bind:this={menuEl}
	class="fixed z-50 min-w-[180px] rounded-xl border border-base-200 bg-base-100 py-1.5 shadow-xl"
	style="left: {left}px; top: {top}px; transform-origin: top left;"
	transition:scale={{ start: 0.88, duration: 160, easing: cubicOut }}
	role="menu"
>
	{#each items as item}
		{#if item.kind === 'separator'}
			<div class="my-1 h-px bg-base-200"></div>
		{:else}
			{@const Icon = item.icon ? ICONS[item.icon] : null}
			<button
				class="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-base-content hover:bg-base-200 {item.icon === 'trash' ? 'text-error hover:bg-error/10' : ''}"
				role="menuitem"
				onpointerdown={() => handleAction(item)}
			>
				<span class="flex w-4 shrink-0 items-center justify-center text-base-content/40">
					{#if Icon}
						<svelte:component this={Icon} size={14} weight="bold" />
					{/if}
				</span>
				<span class="flex-1">{item.label}</span>
				{#if item.shortcut}
					<kbd class="ml-4 shrink-0 font-mono text-[13px] text-base-content/30">{item.shortcut}</kbd>
				{/if}
			</button>
		{/if}
	{/each}
</div>
