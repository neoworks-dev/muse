<script lang="ts">
	import { tick } from 'svelte';
	import { fetchModels, type ModelInfo } from '$lib/api/models';
	import type { AiProvider } from '$lib/settings';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';

	let {
		value = $bindable(''),
		provider,
		placeholder = 'Default model',
		class: cls = ''
	}: {
		value?: string;
		provider: AiProvider;
		placeholder?: string;
		class?: string;
	} = $props();

	let open = $state(false);
	let query = $state('');
	let models: ModelInfo[] = $state([]);
	let loading = $state(false);
	let fetchError = $state('');
	let fetched = $state(false);
	let wrapperEl: HTMLDivElement | undefined = $state();
	let searchEl: HTMLInputElement | undefined = $state();

	$effect(() => {
		provider;
		fetched = false;
		models = [];
		fetchError = '';
	});

	async function load() {
		if (fetched || loading) return;
		loading = true;
		fetchError = '';
		try {
			models = await fetchModels(provider);
			fetched = true;
		} catch (e) {
			fetchError = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function refresh() {
		fetched = false;
		models = [];
		fetchError = '';
		await load();
	}

	async function toggle() {
		open = !open;
		if (open) {
			load();
			await tick();
			searchEl?.focus();
		} else {
			query = '';
		}
	}

	function select(id: string) {
		value = id;
		open = false;
		query = '';
	}

	function onDocPointerDown(e: PointerEvent) {
		if (!open) return;
		if (wrapperEl?.contains(e.target as Node)) return;
		open = false;
		query = '';
	}

	const filtered = $derived(
		query.trim()
			? models.filter(
					(m) =>
						m.id.toLowerCase().includes(query.toLowerCase()) ||
						m.name.toLowerCase().includes(query.toLowerCase())
				)
			: models
	);

	const displayName = $derived(models.find((m) => m.id === value)?.name ?? (value || null));
</script>

<svelte:window onpointerdown={onDocPointerDown} />

<div bind:this={wrapperEl} class="relative {cls}">
	<button
		type="button"
		onclick={toggle}
		class="flex w-full items-center gap-2 rounded-xl border border-base-300 bg-base-200 px-3 py-2.5 text-left transition hover:border-base-content/20 focus:outline-none {open
			? 'border-primary/60 ring-1 ring-primary/20'
			: ''}"
	>
		<span class="flex-1 truncate text-sm {displayName ? 'text-base-content' : 'text-base-content/30'}">
			{displayName ?? placeholder}
		</span>
		{#if loading}
			<CircleNotchIcon size={13} class="shrink-0 animate-spin text-base-content/30" />
		{:else}
			<CaretDownIcon
				size={13}
				class="shrink-0 text-base-content/30 transition-transform {open ? 'rotate-180' : ''}"
			/>
		{/if}
	</button>

	{#if open}
		<div
			class="absolute top-full left-0 right-0 z-50 mt-1 flex max-h-64 flex-col overflow-hidden rounded-xl border border-base-200 bg-base-100 shadow-xl"
		>
			<!-- Search -->
			<div class="flex shrink-0 items-center gap-1 border-b border-base-200 px-2.5 py-1.5">
				<input
					bind:this={searchEl}
					bind:value={query}
					type="text"
					placeholder="Search models…"
					class="min-w-0 flex-1 bg-transparent text-[13px] text-base-content placeholder-base-content/30 outline-none"
				/>
				<button
					type="button"
					onclick={refresh}
					class="btn btn-ghost btn-xs btn-square text-base-content/30 hover:text-base-content disabled:opacity-30"
					title="Refresh list"
					disabled={loading}
				>
					<ArrowClockwiseIcon size={11} class={loading ? 'animate-spin' : ''} />
				</button>
			</div>

			<!-- List -->
			<div class="flex-1 overflow-y-auto">
				{#if loading && models.length === 0}
					<p class="px-3 py-4 text-center text-[13px] text-base-content/30">Loading models…</p>
				{:else if fetchError}
					<p class="px-3 py-2 text-[13px] text-error/70">{fetchError}</p>
				{:else if filtered.length === 0 && !query}
					<p class="px-3 py-4 text-center text-[13px] text-base-content/30">No models found</p>
				{:else if filtered.length === 0}
					<p class="px-3 py-4 text-center text-[13px] text-base-content/30">No matches for "{query}"</p>
				{:else}
					{#each filtered as m (m.id)}
						<button
							type="button"
							onclick={() => select(m.id)}
							class="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-base-200 {value === m.id ? 'bg-primary/10' : ''}"
						>
							<div class="min-w-0 flex-1">
								<p class="truncate text-[13px] font-medium leading-snug {value === m.id ? 'text-primary' : 'text-base-content/80'}">
									{m.name}
								</p>
								{#if m.id !== m.name}
									<p class="truncate text-[11px] leading-snug text-base-content/30">{m.id}</p>
								{/if}
								{#if m.description}
									<p class="mt-0.5 line-clamp-2 text-[11px] leading-snug {value === m.id ? 'text-primary/60' : 'text-base-content/40'}">
										{m.description}
									</p>
								{/if}
							</div>
							{#if value === m.id}
								<CheckIcon size={11} class="mt-0.5 shrink-0 text-primary" />
							{/if}
						</button>
					{/each}
				{/if}

				{#if query && !models.find((m) => m.id === query)}
					<div class="border-t border-base-200">
						<button
							type="button"
							onclick={() => select(query)}
							class="flex w-full items-center gap-1 px-3 py-2 text-left text-[13px] text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content/80"
						>
							Use "<span class="font-medium text-base-content/80">{query}</span>" as model ID
						</button>
					</div>
				{/if}
			</div>

			{#if value}
				<div class="shrink-0 border-t border-base-200">
					<button
						type="button"
						onclick={() => select('')}
						class="flex w-full items-center px-3 py-1.5 text-left text-[13px] text-base-content/40 transition-colors hover:bg-base-200 hover:text-base-content/70"
					>
						Reset to provider default
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
