<script lang="ts">
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';

	let {
		chunks,
		onAccept,
		onReject,
	}: {
		chunks:   { fromB: number; y: number }[];
		onAccept: (fromB: number) => void;
		onReject: (fromB: number) => void;
	} = $props();
</script>

{#each chunks as chunk (chunk.fromB)}
	<div
		class="absolute right-2 z-10 flex items-center gap-1 pointer-events-auto"
		style="top: {chunk.y}px; transform: translateY(-50%);"
	>
		<button
			class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[0.7rem] font-semibold cursor-pointer border-none shadow-lg hover:bg-emerald-700 active:scale-95 transition-all whitespace-nowrap"
			onclick={() => onAccept(chunk.fromB)}
		>
			<CheckIcon size={11} weight="bold" /> Accept
		</button>
		<button
			class="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-200 bg-white text-stone-600 text-[0.7rem] font-semibold cursor-pointer shadow-lg hover:bg-stone-50 active:scale-95 transition-all whitespace-nowrap"
			onclick={() => onReject(chunk.fromB)}
		>
			<XIcon size={11} weight="bold" /> Reject
		</button>
	</div>
{/each}
