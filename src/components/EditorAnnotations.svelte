<script lang="ts">
	import { tick } from 'svelte';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import type { AnnotGroup, EditorAnnot } from '$lib/editor-types';

	let {
		annotGroups,
		editAnnotId = $bindable<string | null>(null),
		editDraft = $bindable(''),
		hoveredGroupId = $bindable<string | null>(null),
		chatOpen,
		chatWidth,
		onCommit,
		onCancel,
		onRemove
	}: {
		annotGroups: AnnotGroup[];
		editAnnotId: string | null;
		editDraft: string;
		hoveredGroupId: string | null;
		chatOpen: boolean;
		chatWidth: number;
		onCommit: () => void;
		onCancel: () => void;
		onRemove: (id: string) => void;
	} = $props();

	let eAnnotInputEl: HTMLTextAreaElement | undefined;

	// Auto-focus the textarea whenever we start editing an annotation
	$effect(() => {
		if (editAnnotId !== null) {
			tick().then(() => eAnnotInputEl?.focus());
		}
	});

	function groupIsExpanded(group: AnnotGroup): boolean {
		return hoveredGroupId === group.id || group.items.some((x) => x.ann.id === editAnnotId);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			onCommit();
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			onCancel();
		}
	}
</script>

<!-- z-[55] puts annotation cards above the overlay at z-50 -->
{#each annotGroups as group (group.id)}
	{@const expanded = groupIsExpanded(group)}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="pointer-events-none fixed z-[55] w-[220px] overflow-visible transition-[height] duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
		style="top: {group.baseY}px; {chatOpen
			? `right: ${chatWidth + 80}px`
			: 'right: 80px'}; height: {expanded ? (group.items.length - 1) * 76 + 60 : 32}px;"
		onmouseenter={() => (hoveredGroupId = group.id)}
		onmouseleave={() => (hoveredGroupId = null)}
		role="complementary"
		aria-label="Document annotation"
		data-annot-group
	>
		{#each group.items as { ann }, idx}
			<div
				class="group/card pointer-events-auto absolute top-0 left-0 w-[220px] overflow-hidden rounded-xl border border-violet-300 bg-purple-50 px-2.5 py-2 shadow-[0_2px_8px_rgba(109,40,217,0.12)] transition-[transform,box-shadow] duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:shadow-[0_4px_16px_rgba(109,40,217,0.18)]"
				style="transform: translateY({expanded ? idx * 76 : idx * 5}px); z-index: {editAnnotId ===
				ann.id
					? 100
					: group.items.length - idx};"
			>
				{#if editAnnotId === ann.id}
					<div
						class="mb-1.5 overflow-hidden text-[0.7rem] text-ellipsis whitespace-nowrap text-violet-600 italic"
					>
						{ann.quote.length > 40 ? ann.quote.slice(0, 40) + '…' : ann.quote}
					</div>
					<textarea
						bind:this={eAnnotInputEl}
						bind:value={editDraft}
						placeholder="Add a note… (↵ to save)"
						rows={2}
						class="box-border w-full resize-none rounded-md border border-violet-300 bg-white px-1.5 py-1 font-[inherit] text-[0.75rem] leading-relaxed text-stone-800 transition-colors outline-none focus:border-violet-600"
						onkeydown={onKeydown}
					></textarea>
					<div class="mt-1 flex gap-1.5">
						<button
							class="cursor-pointer rounded border-none bg-violet-600 px-2 py-0.5 text-[0.68rem] text-white transition-colors hover:bg-violet-700"
							onclick={onCommit}>Save ↵</button
						>
						<button
							class="cursor-pointer rounded border-none bg-transparent px-2 py-0.5 text-[0.68rem] text-stone-500 transition-colors hover:bg-stone-100"
							onclick={onCancel}>Cancel</button
						>
					</div>
				{:else}
					<div
						class="overflow-hidden pr-5 text-[0.72rem] font-medium text-ellipsis whitespace-nowrap text-violet-800"
					>
						{ann.note || '…'}
					</div>
					{#if expanded}
						<blockquote
							class="my-1.5 overflow-hidden border-none p-0 text-[0.7rem] leading-relaxed text-violet-600 italic"
							style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;"
						>
							{ann.quote}
						</blockquote>
						<p class="m-0 text-[0.75rem] leading-relaxed whitespace-pre-wrap text-stone-700">
							{ann.note}
						</p>
					{/if}
					<button
						class="absolute top-1 right-1 flex h-[1.1rem] w-[1.1rem] cursor-pointer items-center justify-center rounded border-none bg-transparent text-violet-300 opacity-0 transition-all group-hover/card:opacity-100 hover:bg-pink-100 hover:text-pink-700"
						onclick={() => onRemove(ann.id)}
						title="Remove annotation"
					>
						<XIcon size={10} weight="bold" />
					</button>
				{/if}
			</div>
		{/each}
	</div>
{/each}
