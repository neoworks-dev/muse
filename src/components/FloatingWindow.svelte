<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { cubicIn } from 'svelte/easing';
	import type { Snippet } from 'svelte';
	import { claimTop, releaseTop, isTopWindow } from '$lib/window-stack.svelte';
	import { fade } from 'svelte/transition';

	function popOut(_node: Element) {
		if (origin && !fullscreen) {
			const winCx = wx + ww / 2;
			const winCy = wy + wh / 2;
			const originCx = origin.x + origin.w / 2;
			const originCy = origin.y + origin.h / 2;
			const dx = originCx - winCx;
			const dy = originCy - winCy;
			const sx = origin.w / ww;
			const sy = origin.h / wh;
			return {
				duration: 200,
				css: (t: number) => {
					// t: 1→0  |  ease-out: fast start, slow arrival at origin
					const p = t * t * t;
					return `
						opacity: ${t};
						transform: translate(${dx * (1 - p)}px, ${dy * (1 - p)}px)
						           scale(${sx + (1 - sx) * p}, ${sy + (1 - sy) * p});
						border-radius: 16px;
					`;
				}
			};
		}
		return {
			duration: 200,
			easing: cubicIn,
			css: (t: number) => `
				opacity: ${t};
				transform: scale(${0.96 + 0.04 * t}) translateY(${(1 - t) * 6}px);
			`
		};
	}

	type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

	export interface WindowActions {
		fullscreen: boolean;
		windowRadius: string;
		startDrag: (e: PointerEvent) => void;
		moveDrag: (e: PointerEvent) => void;
		endDrag: () => void;
		toggleFullscreen: () => void;
	}

	let {
		open = $bindable(true),
		x = 80,
		y = 100,
		width = 460,
		height = 580,
		minwidth = 300,
		minheight = 280,
		center = false,
		zIndex = 55,
		origin,
		storageKey,
		children
	}: {
		open?: boolean;
		x?: number;
		y?: number;
		width?: number;
		height?: number;
		minwidth?: number;
		minheight?: number;
		center?: boolean;
		zIndex?: number;
		origin?: { x: number; y: number; w: number; h: number };
		storageKey?: string;
		children: Snippet<[WindowActions]>;
	} = $props();

	const SNAP = 16;
	const _wid = Math.random().toString(36).slice(2, 10);

	function _loadSaved() {
		if (!storageKey) return null;
		const raw = localStorage.getItem(storageKey);
		if (!raw) return null;
		if (raw === '0' || raw === '1') return { fs: +raw } as { x?: number; y?: number; w?: number; h?: number; fs?: number };
		try { return JSON.parse(raw) as { x?: number; y?: number; w?: number; h?: number; fs?: number }; }
		catch { return null; }
	}

	const _saved = _loadSaved();

	// svelte-ignore state_referenced_locally
	let wx = $state(_saved?.x ?? x);
	// svelte-ignore state_referenced_locally
	let wy = $state(_saved?.y ?? y);
	// svelte-ignore state_referenced_locally
	let ww = $state(_saved?.w ?? width);
	// svelte-ignore state_referenced_locally
	let wh = $state(_saved?.h ?? height);
	let fullscreen = $state(!!_saved?.fs);
	let _myZ = $state(zIndex);
	let placed = _saved?.x !== undefined;

	function _saveState() {
		if (!storageKey) return;
		localStorage.setItem(storageKey, JSON.stringify({ x: wx, y: wy, w: ww, h: wh, fs: fullscreen ? 1 : 0 }));
	}

	let innerEl: HTMLDivElement | undefined = $state();
	let animApplied = false;

	let snapped = $state({ n: false, s: false, e: false, w: false });

	const windowRadius = $derived.by(() => {
		if (fullscreen) return '0';
		const R = 12;
		const tl = snapped.n || snapped.w ? 0 : R;
		const tr = snapped.n || snapped.e ? 0 : R;
		const br = snapped.s || snapped.e ? 0 : R;
		const bl = snapped.s || snapped.w ? 0 : R;
		return `${tl}px ${tr}px ${br}px ${bl}px`;
	});

	$effect(() => {
		if (open) {
			untrack(() => {
				_myZ = claimTop(_wid);
			});
		} else {
			untrack(() => releaseTop(_wid));
		}
	});

	$effect(() => {
		if (open && !placed) {
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			if (center) {
				wx = Math.max(20, (vw - ww) / 2);
				wy = Math.max(20, (vh - wh) / 2);
			} else {
				wx = Math.max(20, Math.min(x, vw - ww - 20));
				wy = Math.max(20, Math.min(vh - wh - 80, vh - wh - 20));
			}
			placed = true;
		}
	});


	// Trigger entry animation whenever innerEl first appears (works whether open
	// starts true or false — onMount would only fire once at component mount).
	$effect(() => {
		if (!innerEl) {
			animApplied = false; // reset so it replays if window is closed & reopened
			return;
		}
		if (animApplied) return;
		animApplied = true;

		// Wait one tick so the placement $effect has settled wx/wy/ww/wh.
		tick().then(() => {
			if (!innerEl) return;
			if (origin) {
				const winCx = wx + ww / 2;
				const winCy = wy + wh / 2;
				const originCx = origin.x + origin.w / 2;
				const originCy = origin.y + origin.h / 2;
				innerEl.style.setProperty('--sw-dx', `${originCx - winCx}px`);
				innerEl.style.setProperty('--sw-dy', `${originCy - winCy}px`);
				innerEl.style.setProperty('--sw-sx', `${origin.w / ww}`);
				innerEl.style.setProperty('--sw-sy', `${origin.h / wh}`);
				innerEl.classList.add('win-swoosh');
			} else {
				innerEl.classList.add('win-pop-in');
			}
			// Pin opacity once the entry animation ends. The animation's `both` fill
			// only holds opacity while its class is present, but toggling fullscreen
			// makes Svelte rewrite className and drop that class — which would revert
			// to the inline opacity:0 and hide the window.
			innerEl.addEventListener(
				'animationend',
				() => {
					if (innerEl) innerEl.style.opacity = '1';
				},
				{ once: true }
			);
		});
	});

	const windowStyle = $derived(
		fullscreen
			? { left: '0', top: '0', width: '100vw', height: '100vh' }
			: { left: `${wx}px`, top: `${wy}px`, width: `${ww}px`, height: `${wh}px` }
	);

	// ── Drag ──────────────────────────────────────────────────────────────
	let dragging = false;
	let dsx = 0,
		dsy = 0,
		dwx = 0,
		dwy = 0;

	function startDrag(e: PointerEvent) {
		if (fullscreen) return;
		if ((e.target as HTMLElement).closest('button')) return;
		dragging = true;
		dsx = e.clientX;
		dsy = e.clientY;
		dwx = wx;
		dwy = wy;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function moveDrag(e: PointerEvent) {
		if (!dragging) return;
		let nx = dwx + e.clientX - dsx;
		let ny = dwy + e.clientY - dsy;
		const vw = window.innerWidth,
			vh = window.innerHeight;
		if (nx < SNAP) nx = 0;
		else if (nx + ww > vw - SNAP) nx = vw - ww;
		if (ny < SNAP) ny = 0;
		else if (ny + wh > vh - SNAP) ny = vh - wh;
		wx = nx;
		wy = ny;
		snapped = { w: nx === 0, e: nx + ww === vw, n: ny === 0, s: ny + wh === vh };
	}
	function endDrag() {
		dragging = false;
		_saveState();
	}

	// ── Resize ────────────────────────────────────────────────────────────
	const handles: { edge: Edge; cls: string }[] = [
		{ edge: 'nw', cls: 'top-0 left-0 h-4 w-4 cursor-nw-resize' },
		{ edge: 'ne', cls: 'top-0 right-0 h-4 w-4 cursor-ne-resize' },
		{ edge: 'sw', cls: 'bottom-0 left-0 h-4 w-4 cursor-sw-resize' },
		{ edge: 'se', cls: 'bottom-0 right-0 h-4 w-4 cursor-se-resize' },
		{ edge: 'n', cls: 'top-0 left-4 right-4 h-[5px] cursor-n-resize' },
		{ edge: 's', cls: 'bottom-0 left-4 right-4 h-[5px] cursor-s-resize' },
		{ edge: 'w', cls: 'left-0 top-4 bottom-4 w-[5px] cursor-w-resize' },
		{ edge: 'e', cls: 'right-0 top-4 bottom-4 w-[5px] cursor-e-resize' }
	];

	let rEdge: Edge | null = $state(null);
	let hoveredEdge: Edge | null = $state(null);
	let rsx = 0,
		rsy = 0,
		rwx = 0,
		rwy = 0,
		rww = 0,
		rwh = 0;

	const glowEdge = $derived(rEdge ?? hoveredEdge);

	const glowShadow = $derived.by(() => {
		const e = glowEdge as string | null;
		if (!e) return 'none';
		const c = 'color-mix(in oklch, var(--color-primary) 45%, transparent)';
		const parts: string[] = [];
		if (e.includes('n')) parts.push(`0 -6px 14px -2px ${c}`);
		if (e.includes('s')) parts.push(`0 6px 14px -2px ${c}`);
		if (e.includes('e')) parts.push(`6px 0 14px -2px ${c}`);
		if (e.includes('w')) parts.push(`-6px 0 14px -2px ${c}`);
		return parts.join(', ');
	});

	function startResize(e: PointerEvent, edge: Edge) {
		if (fullscreen) return;
		e.stopPropagation();
		rEdge = edge;
		rsx = e.clientX;
		rsy = e.clientY;
		rwx = wx;
		rwy = wy;
		rww = ww;
		rwh = wh;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function moveResize(e: PointerEvent) {
		if (!rEdge) return;
		const dx = e.clientX - rsx,
			dy = e.clientY - rsy;
		const vw = window.innerWidth,
			vh = window.innerHeight;
		let nx = rwx,
			ny = rwy,
			nw = rww,
			nh = rwh;
		if (rEdge.includes('e')) {
			nw = Math.max(minwidth, rww + dx);
			if (nx + nw > vw - SNAP) nw = vw - nx;
		}
		if (rEdge.includes('s')) {
			nh = Math.max(minheight, rwh + dy);
			if (ny + nh > vh - SNAP) nh = vh - ny;
		}
		if (rEdge.includes('w')) {
			nw = Math.max(minwidth, rww - dx);
			nx = rwx + (rww - nw);
			if (nx < SNAP) {
				nw = rwx + rww;
				nx = 0;
			}
		}
		if (rEdge.includes('n')) {
			nh = Math.max(minheight, rwh - dy);
			ny = rwy + (rwh - nh);
			if (ny < SNAP) {
				nh = rwy + rwh;
				ny = 0;
			}
		}
		wx = nx;
		wy = ny;
		ww = nw;
		wh = nh;
		snapped = { w: nx === 0, e: nx + nw === vw, n: ny === 0, s: ny + nh === vh };
	}
	function endResize() {
		rEdge = null;
		_saveState();
	}

	function toggleFullscreen() {
		fullscreen = !fullscreen;
		_saveState();
	}

	onMount(() => {
		// Clamp a restored position to the current viewport
		if (_saved?.x !== undefined) {
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			wx = Math.max(0, Math.min(wx, vw - ww));
			wy = Math.max(0, Math.min(wy, vh - wh));
		}

		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape' && !e.defaultPrevented && open && isTopWindow(_wid)) {
				e.preventDefault();
				open = false;
			}
		}
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			releaseTop(_wid);
		};
	});
</script>

{#if open}
	<div
		out:popOut
		class="fixed"
		style:z-index={_myZ}
		style:left={windowStyle.left}
		style:top={windowStyle.top}
		style:width={windowStyle.width}
		style:height={windowStyle.height}
		onpointerdown={() => {
			_myZ = claimTop(_wid);
		}}
		role="presentation"
	>
		{#if !fullscreen && glowEdge}
			<div
				in:fade={{ duration: 200 }}
				out:fade={{ duration: 200 }}
				class="glow-edge pointer-events-none absolute inset-0 z-20"
				style:border-radius={windowRadius}
				style:box-shadow={glowShadow}
			></div>
		{/if}

		{#if !fullscreen}
			{#each handles as h}
				<div
					class="absolute z-10 {h.cls}"
					onpointerdown={(e) => startResize(e, h.edge)}
					onpointermove={moveResize}
					onpointerup={endResize}
					onpointerenter={() => (hoveredEdge = h.edge)}
					onpointerleave={() => (hoveredEdge = null)}
					role="presentation"
				/>
			{/each}
		{/if}

		<div
			bind:this={innerEl}
			class="bg-base-100 absolute inset-0 flex flex-col shadow-xl {fullscreen
				? ''
				: 'border-base-200 border'}"
			style:border-radius={fullscreen ? '0' : windowRadius}
			style:opacity="0"
		>
			{@render children({
				fullscreen,
				windowRadius,
				startDrag,
				moveDrag,
				endDrag,
				toggleFullscreen
			})}
		</div>
	</div>
{/if}

<style>
	@keyframes glow-pulse {
		0%,
		100% {
			opacity: 0.6;
		}
		50% {
			opacity: 1;
		}
	}
	.glow-edge {
		animation: glow-pulse 1.1s ease-in-out infinite;
	}

	/* easeOutExpo — fast start, heavy deceleration */
	@keyframes win-pop-in {
		from {
			opacity: 0;
			transform: scale(0.92) translateY(12px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	.win-pop-in {
		animation: win-pop-in 300ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	@keyframes win-swoosh {
		from {
			opacity: 0.3;
			transform: translate(var(--sw-dx), var(--sw-dy)) scale(var(--sw-sx), var(--sw-sy));
			border-radius: 16px;
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	.win-swoosh {
		animation: win-swoosh 380ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}
</style>
