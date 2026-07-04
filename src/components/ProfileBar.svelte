<script lang="ts">
	import GearIcon from 'phosphor-svelte/lib/GearIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import { auth, logout } from '$lib/auth.svelte';

	let { onOpenSettings }: { onOpenSettings: () => void } = $props();

	const email = $derived(auth.user?.email ?? '');
	const initial = $derived(email ? email[0].toUpperCase() : '?');
</script>

<div
	class="absolute top-3 right-3 z-30 flex items-center gap-1 rounded-2xl border border-base-300 bg-base-100 px-1.5 py-1.5 shadow-lg"
>
	<!-- Avatar -->
	<div
		class="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-[13px] font-bold text-white select-none"
		title={email || 'Signed in'}
	>
		{initial}
	</div>

	<!-- Divider -->
	<div class="mx-1 h-4 w-px bg-base-300"></div>

	<!-- Settings -->
	<button
		class="flex h-7 w-7 items-center justify-center rounded-xl text-base-content/40 transition-all duration-150 hover:bg-base-200 hover:text-base-content active:scale-90 focus:outline-none"
		aria-label="Settings"
		title="Settings"
		onclick={onOpenSettings}
	>
		<GearIcon size={15} weight="regular" />
	</button>

	<!-- Logout -->
	<button
		class="flex h-7 w-7 items-center justify-center rounded-xl text-base-content/40 transition-all duration-150 hover:bg-base-200 hover:text-base-content active:scale-90 focus:outline-none"
		aria-label="Sign out"
		title="Sign out"
		onclick={logout}
	>
		<SignOutIcon size={15} weight="regular" />
	</button>
</div>
