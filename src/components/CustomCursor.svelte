<script lang="ts">
  import { onMount } from 'svelte';
  import { ui } from '$lib/state.svelte';
  import { theme } from '$lib/theme.svelte';
  import type { Component } from 'svelte';
  import CursorIcon from 'phosphor-svelte/lib/CursorIcon';
  import CursorClickIcon from 'phosphor-svelte/lib/CursorClickIcon';
  import CursorTextIcon from 'phosphor-svelte/lib/CursorTextIcon';
  import HandIcon from 'phosphor-svelte/lib/HandIcon';
  import HandGrabbingIcon from 'phosphor-svelte/lib/HandGrabbingIcon';
  import ArrowsHorizontalIcon from 'phosphor-svelte/lib/ArrowsHorizontalIcon';
  import ArrowsVerticalIcon from 'phosphor-svelte/lib/ArrowsVerticalIcon';
  import PenNibIcon from 'phosphor-svelte/lib/PenNibIcon';
  import PencilIcon from 'phosphor-svelte/lib/PencilIcon';
  import HighlighterIcon from 'phosphor-svelte/lib/HighlighterIcon';
  import LineSegmentIcon from 'phosphor-svelte/lib/LineSegmentIcon';
  import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
  import CircleIcon from 'phosphor-svelte/lib/CircleIcon';
  import EraserIcon from 'phosphor-svelte/lib/EraserIcon';

  const SIZE = 22;

  type Anchor = 'tl' | 'center' | 'bl';
  type CursorSpec = { Icon: Component; weight: string; anchor: Anchor; rotate?: number };

  const SPECS: Record<string, CursorSpec> = {
    default: { Icon: CursorIcon, weight: 'fill', anchor: 'tl' },
    click: { Icon: CursorClickIcon, weight: 'fill', anchor: 'tl' },
    text: { Icon: CursorTextIcon, weight: 'regular', anchor: 'center' },
    grab: { Icon: HandIcon, weight: 'fill', anchor: 'center' },
    grabbing: { Icon: HandGrabbingIcon, weight: 'fill', anchor: 'center' },
    'resize-ew': { Icon: ArrowsHorizontalIcon, weight: 'bold', anchor: 'center' },
    'resize-ns': { Icon: ArrowsVerticalIcon, weight: 'bold', anchor: 'center' },
    'resize-nwse': { Icon: ArrowsHorizontalIcon, weight: 'bold', anchor: 'center', rotate: 45 },
    'resize-nesw': { Icon: ArrowsHorizontalIcon, weight: 'bold', anchor: 'center', rotate: -45 },
    erase: { Icon: EraserIcon, weight: 'duotone', anchor: 'bl' },
    'draw:pen': { Icon: PenNibIcon, weight: 'duotone', anchor: 'bl' },
    'draw:pencil': { Icon: PencilIcon, weight: 'duotone', anchor: 'bl' },
    'draw:marker': { Icon: HighlighterIcon, weight: 'duotone', anchor: 'bl' },
    'draw:line': { Icon: LineSegmentIcon, weight: 'bold', anchor: 'center' },
    'draw:box': { Icon: SquareIcon, weight: 'bold', anchor: 'center' },
    'draw:oval': { Icon: CircleIcon, weight: 'bold', anchor: 'center' }
  };

  const TEXT_SELECTOR =
    'input:not([type=button]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=submit]),textarea,[contenteditable=""],[contenteditable="true"]';

  // Position is mutated directly on the DOM node (no reactivity) so pointer
  // tracking never waits on a Svelte render. Only kind/pressed/visible are state.
  let posX = 0;
  let posY = 0;
  let pressed = $state(false);
  let wrapEl: HTMLDivElement | undefined = $state();

  let visible = $state(false);
  let kind = $state('default');
  let clickPulse = $state(0);

  const spec = $derived(SPECS[kind] ?? SPECS.default);
  const color = $derived(theme.mode === 'dark' ? '#e8eaed' : '#232d32');

  function anchorOffset(anchor: Anchor): { tx: number; ty: number } {
    if (anchor === 'center') return { tx: -SIZE / 2, ty: -SIZE / 2 };
    if (anchor === 'bl') return { tx: -2, ty: -(SIZE - 3) };
    return { tx: -2, ty: -2 };
  }

  function applyPosition() {
    if (!wrapEl) return;
    const off = anchorOffset((SPECS[kind] ?? SPECS.default).anchor);
    // translate3d keeps the node on its own compositor layer so it repaints
    // cheaply, independent of the canvas's main-thread work.
    wrapEl.style.transform = `translate3d(${posX + off.tx}px, ${posY + off.ty}px, 0)`;
  }

  function computeKind(target: Element | null): string {
    const overCanvas = target?.tagName === 'CANVAS';
    if (pressed) {
      if (ui.cursorTransient) return ui.cursorTransient;
      if (overCanvas) return drawKind();
      return 'click';
    }
    if (ui.cursorTransient) return ui.cursorTransient;
    if (overCanvas) return drawKind();
    if (target?.closest(TEXT_SELECTOR)) return 'text';
    return 'default';
  }

  function drawKind(): string {
    if (ui.activeTool === 'erase') return 'erase';
    if (ui.activeTool === 'draw') return `draw:${ui.drawTool}`;
    return 'default';
  }

  function refresh(target: Element | null) {
    const next = computeKind(target);
    if (next !== kind) kind = next;
    applyPosition();
  }

  onMount(() => {
    document.documentElement.classList.add('custom-cursor');

    // High-frequency, pre-coalescing position updates for lowest latency.
    const onRaw = (e: PointerEvent) => {
      posX = e.clientX;
      posY = e.clientY;
      applyPosition();
    };
    const onMove = (e: PointerEvent) => {
      posX = e.clientX;
      posY = e.clientY;
      if (!visible) visible = true;
      refresh(e.target as Element | null);
    };
    const onDown = (e: PointerEvent) => {
      pressed = true;
      clickPulse++;
      refresh(e.target as Element | null);
    };
    const onUp = (e: PointerEvent) => {
      pressed = false;
      refresh(e.target as Element | null);
    };
    const onLeave = () => (visible = false);
    const onEnter = () => (visible = true);

    window.addEventListener('pointerrawupdate', onRaw as EventListener, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointerenter', onEnter);

    return () => {
      document.documentElement.classList.remove('custom-cursor');
      window.removeEventListener('pointerrawupdate', onRaw as EventListener, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerenter', onEnter);
    };
  });

  // Re-evaluate when the canvas/tool cursor state changes without pointer motion.
  $effect(() => {
    void ui.cursorTransient;
    void ui.activeTool;
    void ui.drawTool;
    refresh(typeof document !== 'undefined' ? document.elementFromPoint(posX, posY) : null);
  });

  // Keep the node positioned once it (re)mounts.
  $effect(() => {
    if (visible && wrapEl) applyPosition();
  });
</script>

{#if visible}
  <div bind:this={wrapEl} class="pointer-events-none fixed left-0 top-0 z-[9999] will-change-transform">
    {#key kind === 'click' ? clickPulse : kind}
      <div
        class="origin-center drop-shadow-sm {kind === 'click' ? 'cursor-pop' : ''}"
        style="transform: rotate({spec.rotate ?? 0}deg) scale({pressed && kind !== 'click' ? 0.85 : 1}); transition: transform 90ms ease-out;"
      >
        <spec.Icon size={SIZE} weight={spec.weight} color={color} />
      </div>
    {/key}
  </div>
{/if}
