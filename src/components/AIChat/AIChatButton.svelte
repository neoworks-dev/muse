<script lang="ts">
	import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';

	let { open = false, onclick }: { open?: boolean; onclick: () => void } = $props();
</script>

<button
	data-tour="ai"
	class="absolute right-3 bottom-5 z-30 flex h-10 w-10 items-center justify-center rounded-2xl border shadow-lg transition-all focus:outline-none active:scale-90
		{open
		? 'border-primary bg-primary text-primary-content hover:bg-primary/90'
		: 'border-base-300 bg-base-100 text-primary hover:bg-base-200'}"
	title="AI Copilot"
	{onclick}
>
	<SparkleIcon size={18} weight="fill" />
</button>
