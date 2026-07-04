<script lang="ts">
	import StackIcon from 'phosphor-svelte/lib/StackIcon';
	import { projects, activeProject } from '$lib/projects.svelte';
	import { ui } from '$lib/state.svelte';

	const name = $derived(activeProject()?.name ?? 'Project');
</script>

<button
	data-tour="projects"
	class="absolute right-16 bottom-5 z-30 flex h-10 max-w-52 items-center gap-2 rounded-2xl border px-3 shadow-lg transition-all focus:outline-none active:scale-95
		{ui.projectPanelOpen
		? 'border-primary bg-primary text-primary-content'
		: 'border-base-300 bg-base-100 text-base-content hover:bg-base-200'}"
	title="Projects"
	onclick={() => (ui.projectPanelOpen = !ui.projectPanelOpen)}
>
	<StackIcon size={17} weight="fill" class="shrink-0 text-accent" />
	<span class="truncate text-sm font-medium">{name}</span>
	{#if projects.list.length > 1}
		<span class="shrink-0 text-xs opacity-50">{projects.list.length}</span>
	{/if}
</button>
