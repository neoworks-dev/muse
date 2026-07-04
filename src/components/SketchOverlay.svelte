<script lang="ts">
	import { onMount } from 'svelte';
	import ArrowUUpLeftIcon from 'phosphor-svelte/lib/ArrowUUpLeftIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTiltIcon';
	import MagicWandIcon from 'phosphor-svelte/lib/MagicWandIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import type { CanvasRenderer } from '$lib/canvas/core/CanvasRenderer';
	import { canvas } from '$lib/state.svelte';
	import type { SketchAction, SketchElement } from '$lib/sketch-types';
	import { loadSettings } from '$lib/settings';
	import { analyzeSketch } from '$lib/api/sketch';
	import { generateFromSketch } from '$lib/api/sketch-generate';

	let {
		engine,
		onClose,
		onExecuteActions,
		onPlaceImage,
		onSubmitToChat,
	}: {
		engine: CanvasRenderer;
		onClose: () => void;
		onExecuteActions: (actions: SketchAction[]) => void;
		onPlaceImage: (dataUrl: string, bounds: { x: number; y: number; w: number; h: number }) => void;
		onSubmitToChat?: (result: { dataUrl: string; reply: string; actions: SketchAction[] }) => void;
	} = $props();

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let vw = $state(window.innerWidth);
	let vh = $state(window.innerHeight);

	// ── Stroke types ──────────────────────────────────────────────────
	type Pt = { x: number; y: number; p: number };
	type Stroke = { pts: Pt[]; color: string; width: number };

	let strokes: Stroke[] = $state([]);
	let cur: Stroke | null = null; // mutated directly, read in RAF

	// ── Drawing tools ─────────────────────────────────────────────────
	let selColor = $state('#e63946');
	let selWidth = $state(3);

	const COLORS = ['#e63946', '#457b9d', '#2d6a4f', '#f4a261', '#f1faee', '#1d1d1b'];
	const WIDTHS: { v: number; label: string }[] = [
		{ v: 2, label: 'S' },
		{ v: 5, label: 'M' },
		{ v: 10, label: 'L' },
	];

	// ── Submission state ──────────────────────────────────────────────
	let submitting = $state(false);
	let submitError = $state('');
	let response: { reply: string; actions: SketchAction[] } | null = $state(null);
	let submittedElements: SketchElement[] = [];
	let errorTimer = 0;

	// ── Image generation state ─────────────────────────────────────────
	let generating = $state(false);
	let generatedImage: { dataUrl: string; prompt: string; bounds: { x: number; y: number; w: number; h: number } } | null = $state(null);

	/** World-space bounding box of all drawn strokes, with padding. */
	const sketchWorldBounds = $derived.by(() => {
		if (strokes.length === 0) return null;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const s of strokes) {
			for (const p of s.pts) {
				if (p.x < minX) minX = p.x;
				if (p.y < minY) minY = p.y;
				if (p.x > maxX) maxX = p.x;
				if (p.y > maxY) maxY = p.y;
			}
		}
		const pad = 24;
		return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
	});

	// ── Pointer tracking ──────────────────────────────────────────────
	const ptrs = new Map<number, { x: number; y: number }>();
	let drawPid = -1;
	let panPid = -1;
	let panLastX = 0;
	let panLastY = 0;
	let pinchLastDist = 0;
	let pinchMidX = 0;
	let pinchMidY = 0;

	let rafId = 0;

	onMount(() => {
		const onResize = () => {
			vw = window.innerWidth;
			vh = window.innerHeight;
		};
		window.addEventListener('resize', onResize);
		rafId = requestAnimationFrame(loop);
		return () => {
			window.removeEventListener('resize', onResize);
			cancelAnimationFrame(rafId);
			clearTimeout(errorTimer);
		};
	});

	// ── RAF rendering ─────────────────────────────────────────────────

	function loop() {
		if (canvasEl) {
			const ctx = canvasEl.getContext('2d')!;
			ctx.clearRect(0, 0, vw, vh);
			const all: Stroke[] = cur ? [...strokes, cur] : strokes;
			for (const s of all) renderStroke(ctx, s, false, 0, 0, 1);
		}
		rafId = requestAnimationFrame(loop);
	}

	/**
	 * @param atCap - if true, project world points using the capture camera (cx, cy, cz)
	 *               instead of the live engine camera
	 */
	function renderStroke(
		ctx: CanvasRenderingContext2D,
		s: Stroke,
		atCap: boolean,
		cx: number,
		cy: number,
		cz: number
	) {
		if (s.pts.length < 2) return;

		const toScreen = (wx: number, wy: number) =>
			atCap ? { x: wx * cz + cx, y: wy * cz + cy } : engine.worldToScreen(wx, wy);

		ctx.beginPath();
		ctx.strokeStyle = s.color;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		const p0 = toScreen(s.pts[0].x, s.pts[0].y);
		ctx.moveTo(p0.x, p0.y);
		for (let i = 1; i < s.pts.length; i++) {
			ctx.lineWidth = s.width * (s.pts[i].p || 1);
			const p = toScreen(s.pts[i].x, s.pts[i].y);
			ctx.lineTo(p.x, p.y);
		}
		ctx.stroke();
	}

	// ── Pointer handlers ─────────────────────────────────────────────

	function onPointerDown(e: PointerEvent) {
		e.preventDefault();
		ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (ptrs.size >= 2) {
			// Multi-touch: cancel any draw, set up pan/pinch state
			if (drawPid !== -1) {
				drawPid = -1;
				cur = null;
			}
			const [p1, p2] = [...ptrs.values()];
			pinchMidX = (p1.x + p2.x) / 2;
			pinchMidY = (p1.y + p2.y) / 2;
			pinchLastDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
			return;
		}

		if (e.button === 1) {
			// Middle mouse → pan
			panPid = e.pointerId;
			panLastX = e.clientX;
			panLastY = e.clientY;
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
			return;
		}

		if (e.button !== 0) return;
		if (response) return; // lock drawing while response panel is open

		drawPid = e.pointerId;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const world = engine.screenToWorld(e.clientX, e.clientY);
		cur = {
			pts: [{ x: world.x, y: world.y, p: e.pressure || 1 }],
			color: selColor,
			width: selWidth,
		};
	}

	function onPointerMove(e: PointerEvent) {
		e.preventDefault();
		ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (ptrs.size >= 2) {
			const [p1, p2] = [...ptrs.values()];
			const midX = (p1.x + p2.x) / 2;
			const midY = (p1.y + p2.y) / 2;
			engine.panBy(midX - pinchMidX, midY - pinchMidY);
			pinchMidX = midX;
			pinchMidY = midY;

			const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
			if (pinchLastDist > 0 && dist !== pinchLastDist) {
				// Convert distance ratio to a pseudo-deltaY for applyWheelZoom
				engine.applyWheelZoom(midX, midY, -Math.log(dist / pinchLastDist) * 1000);
			}
			pinchLastDist = dist;
			return;
		}

		if (e.pointerId === panPid) {
			engine.panBy(e.clientX - panLastX, e.clientY - panLastY);
			panLastX = e.clientX;
			panLastY = e.clientY;
			return;
		}

		if (e.pointerId === drawPid && cur) {
			const world = engine.screenToWorld(e.clientX, e.clientY);
			cur.pts.push({ x: world.x, y: world.y, p: e.pressure || 1 });
		}
	}

	function onPointerUp(e: PointerEvent) {
		e.preventDefault();
		ptrs.delete(e.pointerId);

		if (e.pointerId === panPid) {
			panPid = -1;
			return;
		}

		if (ptrs.size < 2) pinchLastDist = 0;

		if (e.pointerId === drawPid) {
			if (cur && cur.pts.length > 1) strokes = [...strokes, cur];
			cur = null;
			drawPid = -1;
		}
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		engine.applyWheelZoom(e.clientX, e.clientY, e.deltaY);
	}

	// ── Controls ──────────────────────────────────────────────────────

	function undo() {
		strokes = strokes.slice(0, -1);
	}

	function clear() {
		strokes = [];
		cur = null;
	}

	// ── Submit ────────────────────────────────────────────────────────

	async function submit() {
		if (submitting || strokes.length === 0) return;

		submitting = true;
		submitError = '';

		try {
			// Screenshot current viewport (no camera manipulation)
			const canvasImg = engine.screenshotViewport();

			// Composite sketch strokes over the viewport screenshot
			const sw = engine.app.screen.width;
			const sh = engine.app.screen.height;
			const tmp = document.createElement('canvas');
			tmp.width = sw;
			tmp.height = sh;
			const ctx = tmp.getContext('2d')!;
			const bg = new Image();
			bg.src = canvasImg;
			await new Promise<void>((res) => { bg.onload = () => res(); });
			// Scale physical-pixel image down to CSS-pixel canvas
			ctx.drawImage(bg, 0, 0, sw, sh);
			// Draw strokes using live camera (atCap=false → engine.worldToScreen)
			for (const s of strokes) renderStroke(ctx, s, false, 0, 0, 1);
			const sketchImg = tmp.toDataURL('image/jpeg', 0.9);

			const elements: SketchElement[] = canvas.objects
				.filter((o) => o.type !== 'link' && o.type !== 'stroke')
				.map((o) => {
					const b = engine.getObjectWorldBounds(o.id) ?? { x: 0, y: 0, w: 100, h: 100 };
					// Get text content for notes/documents
					let text = '';
					if (o.type === 'note') text = o.body;
					else if (o.type === 'document') text = o.content;
					else if (o.type === 'folder') text = o.title;
					return {
						id: o.id,
						type: o.type,
						label: text.split('\n')[0].slice(0, 60) || o.type,
						content: text.slice(0, 500),
						bounds: { x: b.x, y: b.y, w: b.w, h: b.h },
					};
				});

			submittedElements = elements;

			const result = await analyzeSketch({
				canvasImage: canvasImg,
				sketchImage: sketchImg,
				elements,
			});

			if (onSubmitToChat) {
				onSubmitToChat({ dataUrl: sketchImg, reply: result.reply, actions: result.actions });
				strokes = [];
				cur = null;
				onClose();
			} else {
				response = result;
			}
		} catch (err) {
			showError(err instanceof Error ? err.message : String(err));
		} finally {
			submitting = false;
		}
	}

	function showError(msg: string) {
		submitError = msg;
		clearTimeout(errorTimer);
		errorTimer = setTimeout(() => (submitError = ''), 6000) as unknown as number;
	}

	function applyActions() {
		if (!response) return;
		onExecuteActions(response.actions);
		onClose();
	}

	function dismissResponse() {
		response = null;
	}

	// ── Image generation ─────────────────────────────────────────────

	async function generate() {
		const bounds = sketchWorldBounds;
		if (generating || !bounds) return;
		const settings = loadSettings();
		if (!settings.openaiApiKey) {
			showError('OpenAI API key required for image generation — add it in Settings.');
			return;
		}

		generating = true;
		submitError = '';

		try {
			const captured = engine.captureScene();
			if (!captured) throw new Error('Canvas is empty.');
			const { dataUrl: canvasImg, camera: cap } = captured;

			const sw = engine.app.screen.width;
			const sh = engine.app.screen.height;
			const tmp = document.createElement('canvas');
			tmp.width = sw; tmp.height = sh;
			const ctx = tmp.getContext('2d')!;
			for (const s of strokes) renderStroke(ctx, s, true, cap.x, cap.y, cap.zoom);
			const sketchImg = tmp.toDataURL('image/png');

			const data = await generateFromSketch({
				openaiKey: settings.openaiApiKey,
				imageModel: settings.imageModel || 'dall-e-3',
				canvasImage: canvasImg,
				sketchImage: sketchImg,
				sketchBounds: bounds,
			});
			generatedImage = { dataUrl: data.imageDataUrl, prompt: data.prompt, bounds };
		} catch (err) {
			showError(err instanceof Error ? err.message : String(err));
		} finally {
			generating = false;
		}
	}

	function placeImage() {
		if (!generatedImage) return;
		onPlaceImage(generatedImage.dataUrl, generatedImage.bounds);
		generatedImage = null;
		onClose();
	}

	// ── Action display ────────────────────────────────────────────────

	function elementLabel(id: string): string {
		const el = submittedElements.find((e) => e.id === id);
		return el ? el.label || el.type : id.slice(0, 8);
	}

	function describeAction(action: SketchAction): string {
		switch (action.type) {
			case 'create_link':
				return `Link "${elementLabel(action.sourceId)}" → "${elementLabel(action.targetId)}"${action.label ? ` (${action.label})` : ''}`;
			case 'move_element':
				return `Move "${elementLabel(action.id)}" to (${Math.round(action.x)}, ${Math.round(action.y)})`;
			case 'group_elements':
				return `Group ${action.ids.length} elements → folder "${action.title}"`;
			case 'add_note':
				return `Add note: "${action.body.slice(0, 70)}${action.body.length > 70 ? '…' : ''}"`;
			default:
				return 'Unknown action';
		}
	}
</script>

<!-- Full-screen drawing canvas -->
<canvas
	bind:this={canvasEl}
	width={vw}
	height={vh}
	class="fixed inset-0 z-[15] touch-none"
	style="cursor: crosshair;"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onwheel={onWheel}
></canvas>

<!-- Toolbar strip -->
<div
	class="fixed top-3 left-1/2 z-[16] flex -translate-x-1/2 items-center gap-1.5 rounded-2xl border border-base-300 bg-base-100/96 px-3 py-2 shadow-lg backdrop-blur-sm"
>
	<!-- Color swatches -->
	{#each COLORS as c}
		<button
			class="h-[18px] w-[18px] flex-shrink-0 rounded-full ring-offset-[2px] ring-offset-base-100 transition-all {selColor === c
				? 'ring-2 ring-primary'
				: 'opacity-50 hover:opacity-90'}"
			style="background: {c}; border: 1px solid rgba(0,0,0,0.12);"
			onclick={() => (selColor = c)}
			aria-label="Color {c}"
		></button>
	{/each}

	<div class="mx-1 h-4 w-px bg-base-300"></div>

	<!-- Width buttons -->
	{#each WIDTHS as { v, label }}
		<button
			class="flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-bold transition-all {selWidth === v
				? 'bg-base-content/10 text-base-content'
				: 'text-base-content/40 hover:bg-base-content/8 hover:text-base-content'}"
			onclick={() => (selWidth = v)}
			aria-label="Width {label}"
		>{label}</button>
	{/each}

	<div class="mx-1 h-4 w-px bg-base-300"></div>

	<!-- Undo -->
	<button
		class="flex h-7 w-7 items-center justify-center rounded-full text-base-content/40 transition-all hover:bg-base-content/8 hover:text-base-content disabled:opacity-25"
		onclick={undo}
		disabled={strokes.length === 0}
		title="Undo last stroke"
	>
		<ArrowUUpLeftIcon size={14} />
	</button>

	<!-- Clear -->
	<button
		class="flex h-7 w-7 items-center justify-center rounded-full text-base-content/40 transition-all hover:bg-error/10 hover:text-error disabled:opacity-25"
		onclick={clear}
		disabled={strokes.length === 0}
		title="Clear all strokes"
	>
		<TrashIcon size={14} />
	</button>

	<div class="mx-1 h-4 w-px bg-base-300"></div>

	<!-- Generate image -->
	<button
		class="flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-all hover:bg-violet-500 active:scale-95 disabled:opacity-40"
		onclick={generate}
		disabled={generating || submitting || strokes.length === 0}
		title="Generate an image from this sketch"
	>
		{#if generating}
			<span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
			Generating…
		{:else}
			<MagicWandIcon size={12} weight="fill" />
			Generate Image
		{/if}
	</button>

	<!-- Send to AI -->
	<button
		class="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-content transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
		onclick={submit}
		disabled={submitting || generating || strokes.length === 0}
	>
		{#if submitting}
			<span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary-content border-t-transparent"></span>
			Analysing…
		{:else}
			<PaperPlaneTiltIcon size={12} weight="fill" />
			Send to AI
		{/if}
	</button>

	<div class="mx-1 h-4 w-px bg-base-300"></div>

	<!-- Exit sketch mode -->
	<button
		class="flex h-7 w-7 items-center justify-center rounded-full text-base-content/40 transition-all hover:bg-base-content/8 hover:text-base-content"
		onclick={onClose}
		title="Exit sketch mode"
	>
		<XIcon size={14} />
	</button>
</div>

<!-- Generated image preview -->
{#if generatedImage}
	<div
		class="fixed bottom-4 left-1/2 z-[17] w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-xl"
	>
		<img
			src={generatedImage.dataUrl}
			alt="AI generated"
			class="w-full object-cover"
			style="max-height: 260px;"
		/>
		<div class="px-4 py-2 text-[13px] italic leading-relaxed text-base-content/40">
			"{generatedImage.prompt}"
		</div>
		<div class="flex items-center justify-end gap-2 border-t border-base-200 px-4 py-3">
			<button
				class="rounded-full px-4 py-1.5 text-sm text-base-content/50 transition-all hover:bg-base-content/5 hover:text-base-content"
				onclick={() => (generatedImage = null)}
			>
				Discard
			</button>
			<button
				class="flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white transition-all hover:bg-violet-500 active:scale-95"
				onclick={placeImage}
			>
				<CheckIcon size={13} weight="bold" />
				Place on Canvas
			</button>
		</div>
	</div>
{/if}

<!-- Error toast -->
{#if submitError}
	<div
		class="fixed bottom-4 left-1/2 z-[17] -translate-x-1/2 rounded-xl border border-error/20 bg-error/10 px-4 py-2.5 text-sm text-error shadow-lg"
	>
		{submitError}
	</div>
{/if}

<!-- AI response panel -->
{#if response}
	<div
		class="fixed bottom-4 left-1/2 z-[17] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-xl"
	>
		{#if response.reply}
			<div class="border-b border-base-200 px-4 py-3 text-sm leading-relaxed text-base-content">
				{response.reply}
			</div>
		{/if}

		{#if response.actions.length > 0}
			<div class="px-4 pt-2.5 text-[13px] font-semibold uppercase tracking-widest text-base-content/40">
				{response.actions.length}
				{response.actions.length === 1 ? 'action' : 'actions'}
			</div>
			<div class="max-h-44 overflow-y-auto px-4 pb-2">
				{#each response.actions as action, i}
					<div class="flex items-start gap-2.5 py-1.5 text-sm text-base-content/80">
						<span
							class="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary"
						>{i + 1}</span>
						<span>{describeAction(action)}</span>
					</div>
				{/each}
			</div>
		{:else if !response.reply}
			<div class="px-4 py-3 text-sm text-base-content/40">No actions suggested.</div>
		{/if}

		<div class="flex items-center justify-end gap-2 border-t border-base-200 px-4 py-3">
			<button
				class="rounded-full px-4 py-1.5 text-sm text-base-content/50 transition-all hover:bg-base-content/5 hover:text-base-content"
				onclick={dismissResponse}
			>
				Dismiss
			</button>
			{#if response.actions.length > 0}
				<button
					class="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-content transition-all hover:opacity-90 active:scale-95"
					onclick={applyActions}
				>
					<CheckIcon size={13} weight="bold" />
					Apply
				</button>
			{/if}
		</div>
	</div>
{/if}
