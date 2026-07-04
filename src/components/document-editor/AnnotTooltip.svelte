<!--
  AnnotTooltip — hover card for an inline document annotation.

  Two modes controlled by the `editMode` prop:

  View mode  — shows the annotation's quote and note with Edit / Remove actions.
  Edit mode  — shows a textarea pre-filled with `initialDraft`.  Saves on ↵,
               cancels on Escape.  Focuses the textarea automatically via a
               reactive `$effect`.

  The `data-annot-tooltip` attribute is read by the parent's pointer-down
  handler and by the tooltip's own `mouseleave` logic to prevent the debounced
  hide from firing while the pointer is inside.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import PencilIcon from 'phosphor-svelte/lib/PencilIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import type { EditorAnnot } from '$lib/editor-types';

	let {
		annotId,
		pos,
		ann,
		editMode,
		initialDraft,
		onMouseEnter,
		onMouseLeave,
		onStartEdit,
		onCommit,
		onCancel,
		onRemove,
	}: {
		/** Id of the active annotation; `null` or mismatched hides the tooltip. */
		annotId:      string | null;
		/** Fixed screen position for the tooltip card. */
		pos:          { x: number; y: number } | null;
		/** The resolved annotation record (looked up from `annotId` in the parent). */
		ann:          EditorAnnot | undefined;
		/** Whether the tooltip is in edit mode. */
		editMode:     boolean;
		/** Initial textarea value when edit mode activates. */
		initialDraft: string;
		onMouseEnter: () => void;
		onMouseLeave: () => void;
		/** Switches to edit mode. */
		onStartEdit:  () => void;
		/** Saves the local draft and closes the tooltip. */
		onCommit:     (note: string) => void;
		/** Discards edits and closes the tooltip. */
		onCancel:     () => void;
		/** Removes the annotation entirely. */
		onRemove:     (id: string) => void;
	} = $props();

	// ── Local edit state ──────────────────────────────────────────────────────

	/** Draft text owned entirely by this component; synced from `initialDraft` on edit-mode entry. */
	let localDraft = $state('');
	let textareaEl: HTMLTextAreaElement | undefined = $state();

	$effect(() => {
		if (editMode) {
			localDraft = initialDraft;
			tick().then(() => textareaEl?.focus());
		}
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommit(localDraft); }
		if (e.key === 'Escape')               { e.preventDefault(); onCancel(); }
	}
</script>

{#if annotId && pos && ann}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed z-[65] w-[230px] rounded-xl border border-violet-200 bg-white shadow-[0_8px_32px_rgba(109,40,217,0.14)] pointer-events-auto overflow-hidden"
		style="left: {pos.x}px; top: {pos.y}px; transform: translateX(-50%);"
		onmouseenter={onMouseEnter}
		onmouseleave={onMouseLeave}
		onpointerdown={(e) => e.stopPropagation()}
		data-annot-tooltip
		role="complementary"
	>
		{#if editMode}
			<div class="px-3 pt-2.5 pb-2.5">
				<div class="mb-2 text-[0.68rem] text-violet-500 italic overflow-hidden text-ellipsis whitespace-nowrap">
					"{ann.quote.length > 38 ? ann.quote.slice(0, 38) + '…' : ann.quote}"
				</div>
				<textarea
					bind:this={textareaEl}
					bind:value={localDraft}
					placeholder="Add a note… (↵ to save)"
					rows={2}
					class="box-border w-full resize-none rounded-lg border border-violet-200 bg-stone-50 px-2 py-1.5 font-[inherit] text-[0.75rem] leading-relaxed text-stone-800 outline-none focus:border-violet-500 focus:bg-white transition-colors"
					onkeydown={onKeydown}
				></textarea>
				<div class="mt-2 flex gap-1.5">
					<button
						class="flex-1 cursor-pointer rounded-lg border-none bg-violet-600 py-1 text-[0.7rem] font-semibold text-white hover:bg-violet-700 transition-colors"
						onclick={() => onCommit(localDraft)}
					>Save ↵</button>
					<button
						class="cursor-pointer rounded-lg border border-stone-200 bg-transparent px-3 py-1 text-[0.7rem] text-stone-500 hover:bg-stone-100 transition-colors"
						onclick={onCancel}
					>Cancel</button>
				</div>
			</div>
		{:else}
			<div class="px-3 pt-2.5 pb-2.5">
				{#if ann.note}
					<p class="m-0 mb-2 text-[0.75rem] leading-relaxed text-stone-800 whitespace-pre-wrap">{ann.note}</p>
					<div class="text-[0.67rem] text-violet-400 italic overflow-hidden text-ellipsis whitespace-nowrap border-t border-stone-100 pt-2 mb-2">
						"{ann.quote.length > 38 ? ann.quote.slice(0, 38) + '…' : ann.quote}"
					</div>
				{:else}
					<p class="m-0 mb-2 text-[0.72rem] text-stone-400 italic">No note yet</p>
				{/if}
				<div class="flex gap-1.5">
					<button
						class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 text-[0.7rem] font-medium cursor-pointer hover:bg-violet-100 transition-colors"
						onclick={onStartEdit}
					>
						<PencilIcon size={10} weight="bold" /> Edit
					</button>
					<button
						class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-stone-200 bg-white text-stone-500 text-[0.7rem] cursor-pointer hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
						onclick={() => onRemove(ann.id)}
					>
						<TrashIcon size={10} weight="bold" /> Remove
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}
