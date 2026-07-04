<script lang="ts">
	import GearIcon from 'phosphor-svelte/lib/GearIcon';

	let { onOpenSettings }: { onOpenSettings: () => void } = $props();
</script>

<div
	class="absolute top-3 right-3 z-30 flex items-center gap-1 rounded-2xl border border-base-300 bg-base-100 px-1.5 py-1.5 shadow-lg"
>
	<!-- Settings -->
	<button
		class="flex h-7 w-7 items-center justify-center rounded-xl text-base-content/40 transition-all duration-150 hover:bg-base-200 hover:text-base-content active:scale-90 focus:outline-none"
		aria-label="Settings"
		title="Settings"
		onclick={onOpenSettings}
	>
		<GearIcon size={15} weight="regular" />
	</button>
</div>
