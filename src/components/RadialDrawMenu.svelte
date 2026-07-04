<script lang="ts">
  import { ui, type DrawToolKind } from '../lib/state.svelte';
  import type { Component } from 'svelte';
  import PenNibIcon from 'phosphor-svelte/lib/PenNibIcon';
  import PencilIcon from 'phosphor-svelte/lib/PencilIcon';
  import HighlighterIcon from 'phosphor-svelte/lib/HighlighterIcon';
  import LineSegmentIcon from 'phosphor-svelte/lib/LineSegmentIcon';
  import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
  import CircleIcon from 'phosphor-svelte/lib/CircleIcon';
  import EraserIcon from 'phosphor-svelte/lib/EraserIcon';

  let { x, y, onClose }: { x: number; y: number; onClose: () => void } = $props();

  // Donut geometry. Tool wedges live in the ring between RI and RO; the colour
  // hub fills the hole.
  const RO = 92; // outer radius
  const RI = 42; // inner radius (colour hub edge)
  const ICON_R = (RI + RO) / 2;
  const VIEW = RO * 2;
  const CENTER = RO;

  type MenuTool =
    | { kind: 'draw'; id: DrawToolKind; label: string; Icon: Component }
    | { kind: 'erase'; label: string; Icon: Component };

  const TOOLS: MenuTool[] = [
    { kind: 'draw', id: 'pen', label: 'Pen', Icon: PenNibIcon },
    { kind: 'draw', id: 'pencil', label: 'Pencil', Icon: PencilIcon },
    { kind: 'draw', id: 'marker', label: 'Marker', Icon: HighlighterIcon },
    { kind: 'draw', id: 'line', label: 'Line', Icon: LineSegmentIcon },
    { kind: 'draw', id: 'box', label: 'Box', Icon: SquareIcon },
    { kind: 'draw', id: 'oval', label: 'Oval', Icon: CircleIcon },
    { kind: 'erase', label: 'Eraser', Icon: EraserIcon }
  ];
  const SEG = 360 / TOOLS.length;

  let mode = $state<'tools' | 'color'>('tools');
  let lightness = $state(50);
  let lastHue = $state(0);
  let lastSat = $state(0);
  let picked = $state(false);
  let wheelEl: HTMLDivElement | undefined = $state();

  function isActive(tool: MenuTool): boolean {
    if (tool.kind === 'erase') return ui.activeTool === 'erase';
    return ui.activeTool === 'draw' && ui.drawTool === tool.id;
  }

  function polar(angleDeg: number, r: number) {
    const a = (angleDeg * Math.PI) / 180;
    return { x: CENTER + Math.cos(a) * r, y: CENTER + Math.sin(a) * r };
  }

  // Donut wedge path for tool segment i, centred on its icon angle.
  function wedgePath(index: number): string {
    const center = -90 + index * SEG;
    const start = center - SEG / 2;
    const end = center + SEG / 2;
    const oStart = polar(start, RO);
    const oEnd = polar(end, RO);
    const iStart = polar(start, RI);
    const iEnd = polar(end, RI);
    return [
      `M ${iStart.x} ${iStart.y}`,
      `L ${oStart.x} ${oStart.y}`,
      `A ${RO} ${RO} 0 0 1 ${oEnd.x} ${oEnd.y}`,
      `L ${iEnd.x} ${iEnd.y}`,
      `A ${RI} ${RI} 0 0 0 ${iStart.x} ${iStart.y}`,
      'Z'
    ].join(' ');
  }

  function iconPos(index: number) {
    return polar(-90 + index * SEG, ICON_R);
  }

  function selectTool(tool: MenuTool) {
    if (tool.kind === 'erase') {
      ui.activeTool = 'erase';
    } else {
      ui.drawTool = tool.id;
      ui.activeTool = 'draw';
    }
    onClose();
  }

  function hslToHex(h: number, s: number, l: number): string {
    s /= 100;
    l /= 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const color = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return Math.round(255 * color)
        .toString(16)
        .padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  function pickFromWheel(e: PointerEvent) {
    if (!wheelEl) return;
    const rect = wheelEl.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = e.clientX - rect.left - cx;
    const dy = e.clientY - rect.top - cy;
    const radius = Math.min(1, Math.hypot(dx, dy) / cx);
    let hue = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (hue < 0) hue += 360;
    lastHue = hue;
    lastSat = Math.round(radius * 100);
    picked = true;
    ui.drawColor = hslToHex(lastHue, lastSat, lightness);
  }

  function applyLightness() {
    if (picked) ui.drawColor = hslToHex(lastHue, lastSat, lightness);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window on:keydown={onKeydown} />

<!-- backdrop closes on outside click -->
<div
  class="fixed inset-0 z-[60]"
  role="presentation"
  onpointerdown={onClose}
  oncontextmenu={(e) => {
    e.preventDefault();
    onClose();
  }}
></div>

<div class="fixed z-[61] -translate-x-1/2 -translate-y-1/2" style="left: {x}px; top: {y}px;">
  {#if mode === 'tools'}
    <div class="relative drop-shadow-xl" style="width: {VIEW}px; height: {VIEW}px;">
      <svg width={VIEW} height={VIEW} viewBox="0 0 {VIEW} {VIEW}" role="menu">
        <!-- tool wedges -->
        {#each TOOLS as tool, i (tool.label)}
          {@const active = isActive(tool)}
          <path
            d={wedgePath(i)}
            class="cursor-pointer transition-colors {active
              ? 'fill-[#c8e02a] stroke-[#c8e02a]'
              : 'fill-white/95 stroke-black/10 hover:fill-[#f3f7d8] dark:fill-neutral-800/95 dark:stroke-white/10 dark:hover:fill-neutral-700'}"
            stroke-width="1"
            role="menuitem"
            aria-label={tool.label}
            tabindex="0"
            onpointerdown={(e) => {
              e.stopPropagation();
              selectTool(tool);
            }}
          ></path>
        {/each}

        <!-- centre colour hub -->
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RI - 6}
          class="cursor-pointer fill-white/95 stroke-black/10 dark:fill-neutral-800/95 dark:stroke-white/10"
          stroke-width="1"
          role="menuitem"
          aria-label="Colour"
          tabindex="0"
          onpointerdown={(e) => {
            e.stopPropagation();
            mode = 'color';
          }}
        ></circle>
        <circle cx={CENTER} cy={CENTER} r={RI - 22} fill={ui.drawColor} class="pointer-events-none stroke-black/20" stroke-width="1"></circle>
      </svg>

      <!-- phosphor icons overlay the wedges, non-interactive -->
      {#each TOOLS as tool, i (tool.label + '-icon')}
        {@const p = iconPos(i)}
        {@const active = isActive(tool)}
        <div
          class="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 {active
            ? 'text-neutral-900'
            : 'text-neutral-700 dark:text-neutral-200'}"
          style="left: {p.x}px; top: {p.y}px;"
        >
          <tool.Icon size={24} weight="duotone" />
        </div>
      {/each}
    </div>
  {:else}
    <!-- rainbow colour wheel, centred on the same point -->
    <div class="relative grid place-items-center">
      <div
        bind:this={wheelEl}
        class="h-64 w-64 cursor-crosshair rounded-full border border-black/10 shadow-xl dark:border-white/10"
        style="background:
          radial-gradient(circle at center, white 0%, rgba(255,255,255,0) 70%),
          conic-gradient(from 90deg, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%));"
        role="slider"
        aria-label="Hue and saturation"
        aria-valuenow={lightness}
        tabindex="0"
        onpointerdown={(e) => {
          e.stopPropagation();
          pickFromWheel(e);
        }}
        onpointermove={(e) => {
          if (e.buttons === 1) pickFromWheel(e);
        }}
      >
        <!-- lightness overlays -->
        <div
          class="pointer-events-none absolute inset-0 rounded-full"
          style="background: black; opacity: {(50 - lightness) / 50 > 0 ? (50 - lightness) / 50 : 0};"
        ></div>
        <div
          class="pointer-events-none absolute inset-0 rounded-full"
          style="background: white; opacity: {(lightness - 50) / 50 > 0 ? (lightness - 50) / 50 : 0};"
        ></div>

        <!-- centre swatch + back -->
        <button
          type="button"
          class="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-black/10 bg-white/90 shadow-lg backdrop-blur dark:border-white/10 dark:bg-neutral-800/90"
          title="Back"
          onpointerdown={(e) => {
            e.stopPropagation();
            mode = 'tools';
          }}
        >
          <span class="h-6 w-6 rounded-full border border-black/20 shadow-inner" style="background: {ui.drawColor};"></span>
        </button>
      </div>

      <!-- lightness slider floats below -->
      <input
        type="range"
        min="0"
        max="100"
        bind:value={lightness}
        class="absolute top-full mt-3 h-2 w-48 cursor-pointer"
        title="Lightness"
        oninput={applyLightness}
        onpointerdown={(e) => e.stopPropagation()}
      />
    </div>
  {/if}
</div>
