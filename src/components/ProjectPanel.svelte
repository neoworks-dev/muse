<script lang="ts">
	import FloatingWindow from './FloatingWindow.svelte';
	import { FloatingScrollbar } from '@neoworks-dev/ui';
	import StackIcon from 'phosphor-svelte/lib/StackIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import {
		projects,
		createProject,
		renameProject,
		deleteProject,
		switchProject
	} from '$lib/projects.svelte';
	import { ui } from '$lib/state.svelte';

	let open = $state(true);
	let newName = $state('');
	let busy = $state(false);
	let editingId = $state<string | null>(null);
	let editName = $state('');

	$effect(() => {
		if (!open) setTimeout(() => (ui.projectPanelOpen = false), 300);
	});

	async function add() {
		const name = newName.trim();
		if (!name || busy) return;
		busy = true;
		try {
			await createProject(name);
			newName = '';
		} finally {
			busy = false;
		}
	}

	async function select(id: string) {
		if (busy || id === projects.activeId) return;
		busy = true;
		try {
			await switchProject(id);
		} finally {
			busy = false;
		}
	}

	function startRename(id: string, current: string) {
		editingId = id;
		editName = current;
	}

	async function commitRename() {
		const id = editingId;
		const name = editName.trim();
		editingId = null;
		if (!id || !name) return;
		await renameProject(id, name);
	}

	async function remove(id: string) {
		if (projects.list.length <= 1 || busy) return;
		busy = true;
		try {
			await deleteProject(id);
		} finally {
			busy = false;
		}
	}
</script>

<FloatingWindow bind:open width={360} height={460} minheight={300} x={999999} storageKey="projects:win">
	{#snippet children(win)}
		<div class="flex h-full flex-col" onpointermove={win.moveDrag} onpointerup={win.endDrag}>
			<!-- Title bar -->
			<div
				class="flex h-10 shrink-0 cursor-grab items-center gap-2 border-b border-base-200 px-3 select-none active:cursor-grabbing"
				onpointerdown={win.startDrag}
				role="toolbar"
				tabindex="-1"
			>
				<StackIcon size={14} weight="fill" class="text-accent" />
				<span class="flex-1 text-sm font-semibold">Projects</span>
				<button
					class="btn btn-ghost btn-xs btn-circle text-base-content/50"
					onclick={() => (open = false)}
					onpointerdown={(e) => e.stopPropagation()}
					aria-label="Close"
				>
					<XIcon size={15} weight="bold" />
				</button>
			</div>

			<!-- Project list -->
			<FloatingScrollbar class="min-h-0 flex-1">
				<div class="space-y-1 px-3 py-3">
					{#each projects.list as project (project.id)}
						{@const active = project.id === projects.activeId}
						<div
							class="group flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors
								{active
								? 'border-accent/40 bg-accent/10'
								: 'border-transparent bg-base-200 hover:bg-base-300'}"
						>
							{#if editingId === project.id}
								<input
									class="flex-1 bg-transparent text-sm text-base-content outline-none"
									bind:value={editName}
									onkeydown={(e) => {
										if (e.key === 'Enter') commitRename();
										if (e.key === 'Escape') editingId = null;
									}}
									autofocus
								/>
								<button
									class="text-base-content/50 hover:text-base-content"
									onclick={commitRename}
									aria-label="Save name"
								>
									<CheckIcon size={15} weight="bold" />
								</button>
							{:else}
								<button
									class="flex flex-1 items-center gap-2 text-left"
									onclick={() => select(project.id)}
								>
									<span
										class="h-2 w-2 shrink-0 rounded-full {active
											? 'bg-accent'
											: 'bg-base-content/20'}"
									></span>
									<span class="truncate text-sm {active ? 'font-semibold' : ''}">{project.name}</span>
								</button>
								<button
									class="text-base-content/30 opacity-0 transition group-hover:opacity-100 hover:text-base-content"
									onclick={() => startRename(project.id, project.name)}
									aria-label="Rename project"
								>
									<PencilSimpleIcon size={14} />
								</button>
								{#if projects.list.length > 1}
									<button
										class="text-base-content/30 opacity-0 transition group-hover:opacity-100 hover:text-error"
										onclick={() => remove(project.id)}
										aria-label="Delete project"
									>
										<TrashIcon size={14} />
									</button>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			</FloatingScrollbar>

			<!-- New project -->
			<div class="flex shrink-0 items-center gap-2 border-t border-base-200 px-3 py-3">
				<input
					class="flex-1 rounded-xl border border-base-300 bg-base-200 px-3 py-2 text-sm text-base-content placeholder-base-content/30 outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
					placeholder="New project name…"
					bind:value={newName}
					onkeydown={(e) => {
						if (e.key === 'Enter') add();
					}}
				/>
				<button
					class="btn btn-sm btn-primary gap-1"
					disabled={!newName.trim() || busy}
					onclick={add}
				>
					<PlusIcon size={15} weight="bold" /> Add
				</button>
			</div>
		</div>
	{/snippet}
</FloatingWindow>
