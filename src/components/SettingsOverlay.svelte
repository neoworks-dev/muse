<script lang="ts">
	import FloatingWindow from './FloatingWindow.svelte';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import KeyIcon from 'phosphor-svelte/lib/KeyIcon';
	import GearIcon from 'phosphor-svelte/lib/GearIcon';
	import LinkSimpleIcon from 'phosphor-svelte/lib/LinkSimpleIcon';
	import SunIcon from 'phosphor-svelte/lib/SunIcon';
	import MoonIcon from 'phosphor-svelte/lib/MoonIcon';
	import { loadSettings, saveSettings, type AiProvider, type SearchProvider, type AppSettings } from '$lib/settings';
	import { theme, toggleTheme } from '$lib/theme.svelte';
	import { auth, login, logout } from '$lib/auth.svelte';
	import { FloatingScrollbar } from '@neoworks-dev/ui';
	import ModelPicker from './ModelPicker.svelte';

	let { onClose }: { onClose: () => void } = $props();

	const userEmail = $derived(auth.user?.email ?? '');
	const userInitial = $derived(userEmail ? userEmail[0].toUpperCase() : '?');

	const PROVIDERS: { id: AiProvider; label: string; placeholder: string; defaultModel: string }[] = [
		{ id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-…', defaultModel: 'claude-sonnet-4-6' },
		{ id: 'openai',    label: 'OpenAI',    placeholder: 'sk-…',     defaultModel: 'gpt-4o' },
		{ id: 'google',    label: 'Google',    placeholder: 'AIza…',    defaultModel: 'gemini-2.0-flash' },
		{ id: 'custom',    label: 'Custom',    placeholder: 'API key',  defaultModel: '' },
	];

	const SEARCH_PROVIDERS: { id: SearchProvider; label: string; note: string }[] = [
		{ id: 'jina',    label: 'Jina AI',  note: 'Free tier, API key required' },
		{ id: 'brave',   label: 'Brave',    note: 'Free tier, API key required' },
		{ id: 'tavily',  label: 'Tavily',   note: 'Free tier, API key required' },
		{ id: 'searxng', label: 'SearXNG',  note: 'Self-hosted' },
		{ id: 'none',    label: 'Disabled', note: '' },
	];

	let settings: AppSettings = $state(loadSettings());
	let showKey = $state(false);
	let saved = $state(false);
	let open = $state(true);

	$effect(() => {
		if (!open) setTimeout(onClose, 400);
	});

	const searchNote = $derived(SEARCH_PROVIDERS.find((p) => p.id === settings.searchProvider)?.note ?? '');

	function selectProvider(id: AiProvider) {
		const p = PROVIDERS.find((p) => p.id === id)!;
		settings.aiProvider = id;
		if (!settings.model) settings.model = p.defaultModel;
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

					<!-- Profile -->
					<section>
						<p class="mb-3 text-xs font-semibold uppercase tracking-widest text-base-content/40">Profile</p>
						<div class="flex items-center gap-3 rounded-xl bg-base-200 px-4 py-3">
							<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-xs font-bold text-white select-none">
								{userInitial}
							</div>
							{#if auth.authenticated && auth.user}
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm text-base-content">{userEmail || 'Signed in'}</p>
									<p class="text-xs text-base-content/40">Signed in</p>
								</div>
								<button class="btn btn-ghost btn-sm text-base-content/50" onclick={logout}>
									Sign out
								</button>
							{:else}
								<div class="min-w-0 flex-1">
									<p class="text-sm text-base-content">Not signed in</p>
									<p class="text-xs text-base-content/40">Sign in to sync and encrypt</p>
								</div>
								<button class="btn btn-sm btn-primary" onclick={login}>
									Sign in
								</button>
							{/if}
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

						<!-- API Key -->
						<label class="mb-3 block">
							<span class="mb-1.5 flex items-center gap-1.5 text-xs text-base-content/50">
								<KeyIcon size={12} weight="bold" /> API Key
							</span>
							<div class="flex items-center gap-2 rounded-xl border border-base-300 bg-base-200 px-3 py-2.5 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/20">
								<input
									type={showKey ? 'text' : 'password'}
									bind:value={settings.apiKey}
									placeholder={PROVIDERS.find((p) => p.id === settings.aiProvider)?.placeholder ?? ''}
									spellcheck="false"
									autocomplete="off"
									class="flex-1 bg-transparent text-sm text-base-content placeholder-base-content/30 outline-none"
								/>
								<button
									type="button"
									class="shrink-0 text-xs text-base-content/40 hover:text-base-content transition"
									onclick={() => (showKey = !showKey)}
								>
									{showKey ? 'Hide' : 'Show'}
								</button>
							</div>
						</label>

						<!-- Model -->
						<div class="mb-3">
							<span class="mb-1.5 block text-xs text-base-content/50">Model</span>
							<ModelPicker
								bind:value={settings.model}
								provider={settings.aiProvider}
								apiKey={settings.apiKey}
								customBaseUrl={settings.customBaseUrl}
								placeholder={PROVIDERS.find((p) => p.id === settings.aiProvider)?.defaultModel ?? 'Default model'}
							/>
						</div>

						<!-- Custom base URL -->
						{#if settings.aiProvider === 'custom'}
							<label class="block">
								<span class="mb-1.5 flex items-center gap-1.5 text-xs text-base-content/50">
									<LinkSimpleIcon size={12} weight="bold" /> Base URL
								</span>
								<input
									type="url"
									bind:value={settings.customBaseUrl}
									placeholder="https://your-endpoint/v1"
									spellcheck="false"
									class="w-full rounded-xl border border-base-300 bg-base-200 px-3 py-2.5 text-sm text-base-content placeholder-base-content/30 outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
								/>
							</label>
						{/if}

						<!-- OpenAI key for DALL-E -->
						{#if settings.aiProvider !== 'openai'}
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
						{/if}

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
