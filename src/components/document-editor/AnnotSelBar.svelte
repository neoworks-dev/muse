<!--
  AnnotSelBar — floating toolbar that appears over a text selection.

  Rendered at a fixed screen position derived from the selection's coordinates.
  The `data-sel-bar` attribute is read by the parent's pointer-down handler to
  distinguish clicks inside the bar from clicks that should dismiss it.
-->
<script lang="ts">
	import NotePencilIcon from 'phosphor-svelte/lib/NotePencilIcon';

	let {
		selBar,
		onAnnotate
	}: {
		/** Position and document range of the current selection; `null` hides the bar. */
		selBar: { from: number; to: number; x: number; y: number } | null;
		/** Called when the user clicks "Annotate". */
		onAnnotate: () => void;
	} = $props();
</script>

{#if selBar}
	<div
		class="pointer-events-auto absolute z-60 flex items-center rounded-lg bg-stone-900 px-1 py-1 shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
		style="left: {selBar.x}px; top: {selBar.y}px; transform: translate(-50%, calc(-100% - 8px));"
		onpointerdown={(e) => e.stopPropagation()}
		data-sel-bar
		role="toolbar"
	>
		<button
			class="flex cursor-pointer items-center gap-1 rounded-md border-none bg-transparent px-2 py-1 text-[0.72rem] font-medium whitespace-nowrap text-stone-300 transition-colors hover:bg-white/10 hover:text-white"
			onclick={onAnnotate}
		>
			<NotePencilIcon size={12} weight="bold" /> Annotate
		</button>
	</div>
{/if}
