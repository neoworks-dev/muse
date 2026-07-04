<script lang="ts">
	import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
	import CursorClickIcon from 'phosphor-svelte/lib/CursorClickIcon';
	import ClipboardIcon from 'phosphor-svelte/lib/ClipboardIcon';
	import StackIcon from 'phosphor-svelte/lib/StackIcon';
	import ToolboxIcon from 'phosphor-svelte/lib/ToolboxIcon';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import type { Component } from 'svelte';

	let { onClose }: { onClose: () => void } = $props();

	interface Step {
		target?: string;
		icon: Component;
		title: string;
		body: string;
	}

	// A guided walk-through: centered intro/teaching steps plus spotlight steps that
	// point at the real UI (matched via data-tour attributes).
	const steps: Step[] = [
		{
			icon: SparkleIcon,
			title: 'Welcome to Muse',
			body: 'An infinite canvas for notes, documents, media and ideas — with an AI copilot built in. Quick tour?'
		},
		{
			target: 'toolbar',
			icon: ToolboxIcon,
			title: 'Your tools',
			body: 'Switch between Select, Draw, Link and Sketch-to-AI down here. Select is for moving and grouping things.'
		},
		{
			icon: CursorClickIcon,
			title: 'Add things',
			body: 'Right-click anywhere on the canvas to drop a note, document or folder. Single-click an item to open it.'
		},
		{
			icon: ClipboardIcon,
			title: 'Paste media & links',
			body: 'Paste an image, GIF, video or PDF (⌘/Ctrl+V) to place it instantly. Paste a URL for a live bookmark.'
		},
		{
			target: 'projects',
			icon: StackIcon,
			title: 'Projects',
			body: 'Each project is its own canvas. Switch, create and rename them from this button.'
		},
		{
			target: 'ai',
			icon: SparkleIcon,
			title: 'AI copilot',
			body: 'Open the copilot to ask questions, generate content, and have it build or rearrange your canvas for you.'
		}
	];

	let index = $state(0);
	let closing = $state(false);
	let rect = $state<{ top: number; left: number; width: number; height: number } | null>(null);

	const step = $derived(steps[index]);
	const isLast = $derived(index === steps.length - 1);

	const PAD = 8;

	function measure() {
		const target = step.target;
		if (!target) {
			rect = null;
			return;
		}
		const el = document.querySelector(`[data-tour="${target}"]`);
		if (!el) {
			rect = null;
			return;
		}
		const r = el.getBoundingClientRect();
		rect = {
			top: r.top - PAD,
			left: r.left - PAD,
			width: r.width + PAD * 2,
			height: r.height + PAD * 2
		};
	}

	// Re-measure whenever the step changes or the window resizes.
	$effect(() => {
		void index;
		measure();
		const onResize = () => measure();
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});

	function next() {
		if (isLast) {
			dismiss();
			return;
		}
		index += 1;
	}

	function back() {
		if (index > 0) index -= 1;
	}

	function dismiss() {
		closing = true;
		setTimeout(onClose, 220);
	}

	// Card placement: centered when there's no target, otherwise tucked above or
	// below the highlighted element depending on which half it sits in.
	const CARD_W = 340;
	const cardStyle = $derived.by(() => {
		if (!rect) {
			return 'top: 50%; left: 50%; transform: translate(-50%, -50%);';
		}
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const cx = rect.left + rect.width / 2;
		const left = Math.max(16, Math.min(cx - CARD_W / 2, vw - CARD_W - 16));
		const below = rect.top + rect.height / 2 < vh / 2;
		if (below) {
			return `top: ${rect.top + rect.height + 16}px; left: ${left}px;`;
		}
		return `top: ${rect.top - 16}px; left: ${left}px; transform: translateY(-100%);`;
	});

	const Icon = $derived(step.icon);
</script>

<div class="fixed inset-0 z-[100] transition-opacity duration-200 {closing ? 'opacity-0' : 'opacity-100'}">
	<!-- Dim backdrop with a spotlight cut-out over the current target. -->
	{#if rect}
		<div
			class="pointer-events-none absolute rounded-2xl ring-2 ring-accent transition-all duration-300"
			style="top: {rect.top}px; left: {rect.left}px; width: {rect.width}px; height: {rect.height}px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.55);"
		></div>
	{:else}
		<div class="absolute inset-0 bg-black/55 backdrop-blur-sm"></div>
	{/if}

	<!-- Click-catcher so canvas stays inert during the tour. -->
	<div class="absolute inset-0" onclick={(e) => e.stopPropagation()} role="presentation"></div>

	<!-- Step card -->
	<div
		class="absolute w-[340px] max-w-[calc(100vw-32px)] rounded-3xl border border-base-300 bg-base-100 p-5 shadow-2xl transition-all duration-200 {closing
			? 'scale-95 opacity-0'
			: 'scale-100 opacity-100'}"
		style={cardStyle}
	>
		<div class="mb-3 flex items-center gap-3">
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-primary text-accent-content shadow"
			>
				<Icon size={20} weight="fill" />
			</div>
			<h2 class="text-base font-bold text-base-content">{step.title}</h2>
		</div>

		<p class="mb-5 text-sm leading-relaxed text-base-content/60">{step.body}</p>

		<div class="flex items-center justify-between">
			<!-- Progress dots -->
			<div class="flex items-center gap-1.5">
				{#each steps as _, i}
					<span
						class="h-1.5 rounded-full transition-all {i === index
							? 'w-4 bg-accent'
							: 'w-1.5 bg-base-content/20'}"
					></span>
				{/each}
			</div>

			<div class="flex items-center gap-2">
				{#if index === 0}
					<button class="btn btn-ghost btn-sm text-base-content/40" onclick={dismiss}>Skip</button>
				{:else}
					<button class="btn btn-ghost btn-sm text-base-content/50" onclick={back}>Back</button>
				{/if}
				<button class="btn btn-primary btn-sm gap-1" onclick={next}>
					{#if isLast}
						Start creating
					{:else}
						Next <ArrowRightIcon size={14} weight="bold" />
					{/if}
				</button>
			</div>
		</div>
	</div>
</div>
