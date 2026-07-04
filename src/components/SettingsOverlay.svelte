<script lang="ts">
	import FloatingWindow from './FloatingWindow.svelte';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import KeyIcon from 'phosphor-svelte/lib/KeyIcon';
	import GearIcon from 'phosphor-svelte/lib/GearIcon';
	import SunIcon from 'phosphor-svelte/lib/SunIcon';
	import MoonIcon from 'phosphor-svelte/lib/MoonIcon';
	import { loadSettings, saveSettings, type AiProvider, type SearchProvider, type AppSettings } from '$lib/settings';
	import { theme, toggleTheme } from '$lib/theme.svelte';
	import { FloatingScrollbar } from '@neoworks-dev/ui';
	import ModelPicker from './ModelPicker.svelte';

	let { onClose }: { onClose: () => void } = $props();

	const PROVIDERS: { id: AiProvider; label: string; cli: string }[] = [
		{ id: 'claude-code', label: 'Claude Code', cli: 'claude' },
		{ id: 'codex',       label: 'Codex',       cli: 'codex' },
		{ id: 'opencode',    label: 'opencode',    cli: 'opencode' },
	];

	const SEARCH_PROVIDERS: { id: SearchProvider; label: string; note: string }[] = [
		{ id: 'jina',    label: 'Jina AI',  note: 'Free tier, API key required' },
		{ id: 'brave',   label: 'Brave',    note: 'Free tier, API key required' },
		{ id: 'tavily',  label: 'Tavily',   note: 'Free tier, API key required' },
		{ id: 'searxng', label: 'SearXNG',  note: 'Self-hosted' },
		{ id: 'none',    label: 'Disabled', note: '' },
	];

	let settings: AppSettings = $state(loadSettings());
	let saved = $state(false);
	let open = $state(true);

	$effect(() => {
		if (!open) setTimeout(onClose, 400);
	});

	const searchNote = $derived(SEARCH_PROVIDERS.find((p) => p.id === settings.searchProvider)?.note ?? '');

	function selectProvider(id: AiProvider) {
		settings.aiProvider = id;
		settings.model = '';
	}

	function commit() {
		saveSettings(settings);
		saved = true;
		setTimeout(() => { saved = false; }, 1800);
	}
</script>

<FloatingWindow bind:open width={480} height={620} center minheight={400} storageKey="settings:win">
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
				<GearIcon size={14} weight="bold" class="text-base-content/50" />
				<span class="flex-1 text-sm font-semibold">Settings</span>
				<button
					class="btn btn-ghost btn-xs btn-circle text-base-content/50"
					onclick={() => (open = false)}
					onpointerdown={(e) => e.stopPropagation()}
					aria-label="Close"
				>
					<XIcon size={15} weight="bold" />
				</button>
			</div>

			<!-- Scrollable content -->
			<FloatingScrollbar class="min-h-0 flex-1">
				<div class="space-y-6 px-5 py-5">
					<!-- Appearance -->
					<section>
						<p class="mb-3 text-xs font-semibold uppercase tracking-widest text-base-content/40">Appearance</p>
						<div class="flex items-center justify-between rounded-xl bg-base-200 px-4 py-3">
							<div class="flex items-center gap-2 text-sm text-base-content/70">
								{#if theme.mode === 'dark'}
									<MoonIcon size={16} weight="regular" />
								{:else}
									<SunIcon size={16} weight="regular" />
								{/if}
								<span>{theme.mode === 'dark' ? 'Dark' : 'Light'} mode</span>
							</div>
							<button
								class="btn btn-sm btn-ghost gap-2"
								onclick={() => toggleTheme()}
							>
								Switch to {theme.mode === 'dark' ? 'light' : 'dark'}
							</button>
						</div>
					</section>

					<!-- AI Provider -->
					<section>
						<p class="mb-3 text-xs font-semibold uppercase tracking-widest text-base-content/40">AI Provider</p>

						<!-- Provider tabs -->
						<div class="mb-4 flex gap-1 rounded-xl bg-base-200 p-1">
							{#each PROVIDERS as p}
								<button
									class="flex-1 rounded-lg py-1.5 text-xs font-medium transition-all duration-150
										{settings.aiProvider === p.id
											? 'bg-primary text-primary-content shadow-sm'
											: 'text-base-content/50 hover:text-base-content'}"
									onclick={() => selectProvider(p.id)}
								>
									{p.label}
								</button>
							{/each}
						</div>

						<p class="mb-3 rounded-xl bg-base-200 px-4 py-3 text-xs leading-relaxed text-base-content/60">
							Uses the local <code class="font-mono">{PROVIDERS.find((p) => p.id === settings.aiProvider)?.cli}</code> CLI
							and its login — no API key needed. Make sure it is installed and you are signed in.
						</p>

						<!-- Model -->
						<div class="mb-3">
							<span class="mb-1.5 block text-xs text-base-content/50">Model</span>
							<ModelPicker
								bind:value={settings.model}
								provider={settings.aiProvider}
								placeholder="CLI default model"
							/>
						</div>

						<!-- OpenAI key for DALL-E -->
						<label class="mt-3 block">
							<span class="mb-1.5 flex items-center gap-1.5 text-xs text-base-content/50">
								<KeyIcon size={12} weight="bold" /> OpenAI Key <span class="text-base-content/30">(for image generation)</span>
							</span>
							<input
								type="password"
								bind:value={settings.openaiApiKey}
								placeholder="sk-…"
								spellcheck="false"
								autocomplete="off"
								class="w-full rounded-xl border border-base-300 bg-base-200 px-3 py-2.5 text-sm text-base-content placeholder-base-content/30 outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
							/>
						</label>

						<!-- Image generation model -->
						<label class="mt-3 block">
							<span class="mb-1.5 block text-xs text-base-content/50">Image Generation Model</span>
							<input
								type="text"
								bind:value={settings.imageModel}
								placeholder="dall-e-3"
								spellcheck="false"
								class="w-full rounded-xl border border-base-300 bg-base-200 px-3 py-2.5 text-sm text-base-content placeholder-base-content/30 outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
							/>
							<p class="mt-1 text-[13px] text-base-content/30">dall-e-3 (default) or dall-e-2</p>
						</label>

						<!-- Web search -->
						<div class="mt-3">
							<p class="mb-1.5 text-xs text-base-content/50">Web Search</p>
							<div class="flex flex-wrap gap-1.5">
								{#each SEARCH_PROVIDERS as p}
									<button
										class="rounded-lg border px-3 py-1 text-xs transition-colors {settings.searchProvider === p.id ? 'border-primary/40 bg-primary/10 text-primary' : 'border-base-300 bg-base-200 text-base-content/60 hover:text-base-content'}"
										onclick={() => (settings.searchProvider = p.id)}
									>
										{p.label}
									</button>
								{/each}
							</div>
							{#if searchNote}
								<p class="mt-1 text-[13px] text-base-content/30">{searchNote}</p>
							{/if}
							{#if settings.searchProvider === 'jina' || settings.searchProvider === 'brave' || settings.searchProvider === 'tavily'}
								<input
									type="password"
									bind:value={settings.searchApiKey}
									placeholder={settings.searchProvider === 'brave' ? 'BSA…' : settings.searchProvider === 'tavily' ? 'tvly-…' : 'jina_…'}
									spellcheck="false"
									class="mt-2 w-full rounded-xl border border-base-300 bg-base-200 px-3 py-2.5 text-sm text-base-content placeholder-base-content/30 outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
								/>
							{:else if settings.searchProvider === 'searxng'}
								<input
									type="text"
									bind:value={settings.searxngUrl}
									placeholder="http://localhost:8080"
									spellcheck="false"
									class="mt-2 w-full rounded-xl border border-base-300 bg-base-200 px-3 py-2.5 text-sm text-base-content placeholder-base-content/30 outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
								/>
							{/if}
						</div>

						<!-- Vim mode -->
						<label class="mt-4 flex cursor-pointer items-center gap-3">
							<input type="checkbox" bind:checked={settings.vimMode} class="toggle toggle-sm toggle-primary" />
							<span class="text-sm text-base-content/70">Vim mode in document editor</span>
						</label>
					</section>
				</div>
			</FloatingScrollbar>

			<!-- Footer -->
			<div class="flex shrink-0 items-center justify-end gap-3 border-t border-base-200 px-5 py-4">
				<button
					class="btn btn-ghost btn-sm text-base-content/50"
					onclick={() => (open = false)}
				>
					Cancel
				</button>
				<button
					class="btn btn-sm {saved ? 'btn-success' : 'btn-primary'}"
					onclick={commit}
				>
					{saved ? 'Saved!' : 'Save'}
				</button>
			</div>
		</div>
	{/snippet}
</FloatingWindow>
