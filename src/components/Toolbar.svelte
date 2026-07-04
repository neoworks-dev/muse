<script lang="ts">
	import CursorIcon from 'phosphor-svelte/lib/CursorIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import PencilLineIcon from 'phosphor-svelte/lib/PencilLineIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import LinkIcon from 'phosphor-svelte/lib/LinkIcon';

	type Tool = 'select' | 'draw' | 'erase' | 'link' | 'folder' | 'image' | 'document' | 'sketch';

	let {
		activeTool,
		onSelectTool,
		selectedCount = 0,
		onGroupFolder
	}: {
		activeTool: Tool;
		onSelectTool: (tool: Tool) => void;
		selectedCount?: number;
		onGroupFolder?: () => void;
	} = $props();

	const tools = [
		{ id: 'select', icon: CursorIcon, label: 'Select' },
		{ id: 'draw', icon: PencilSimpleIcon, label: 'Draw' },
		{ id: 'link', icon: LinkIcon, label: 'Link' },
		{ id: 'sketch', icon: PencilLineIcon, label: 'Sketch to AI' }
	] satisfies {
		id: Tool;
		icon: typeof CursorIcon;
		label: string;
	}[];
</script>

<div
	data-tour="toolbar"
	class="border-base-300 bg-base-100 absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 flex-row items-center gap-0.5 rounded-2xl border p-1.5 shadow-lg"
>
	{#each tools as tool}
		<button
			class="
				text-base-content/40 hover:bg-base-200 hover:text-base-content relative
				flex h-9 w-9
				items-center
				justify-center rounded-xl transition-all
				duration-150 ease-out
				focus:outline-none
				active:scale-90
				{activeTool === tool.id ? 'bg-primary/10 text-primary' : ''}
			"
			aria-label={tool.label}
			title={tool.label}
			onclick={() => onSelectTool(tool.id)}
		>
			{@render tool.icon({}, { size: 18, weight: activeTool === tool.id ? 'fill' : 'regular' })}
		</button>
	{/each}

	{#if selectedCount > 1}
		<div class="bg-base-300 my-0.5 h-px w-6"></div>
		<button
			class="
				text-success hover:bg-success/10 relative flex
				h-9 w-9 items-center
				justify-center
				rounded-xl transition-all duration-150
				ease-out
				focus:outline-none
				active:scale-90
			"
			aria-label="Group into Folder"
			title="Group into Folder ({selectedCount} items)"
			onclick={() => onGroupFolder?.()}
		>
			<FolderIcon size={18} weight="fill" />
		</button>
	{/if}

</div>
