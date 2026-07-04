import { Application, Container, Graphics } from 'pixi.js';
import { canvas, ui, visibleObjects, undo, redo, type ObjectData } from '../../state.svelte';
import { scheduleSync } from '../../sync.svelte';
import { removeObjects, selectOne, startEditingDocument, startEditingNote, startEditingLink, enterFolder, closeOpenFolder } from '../../actions.svelte';
import { BaseObjectRenderer } from './BaseObjectRenderer';
import { createRenderer } from '../objects/rendererFactory';
import { zoomAt } from '../utils/view';
import type { Tool } from '../tools/Tool';
import type { ToolId, ContextMenuItem } from './types';

export class CanvasRenderer {
  app!: Application;
  stage!: Container;

  private renderers = new Map<string, BaseObjectRenderer>();
  private _activeTool: Tool | null = null;
  private tools = new Map<string, Tool>();

  private _pointers = new Map<number, { x: number; y: number }>();
  private _pinch: { startDistance: number; startZoom: number; worldMid: { x: number; y: number } } | null = null;
  private _midPan: { pointerId: number; sx: number; sy: number; cx: number; cy: number } | null = null;

  /** Callbacks for context menu, etc. */
  backgroundMenuProvider: ((world: { x: number; y: number }) => ContextMenuItem[]) | null = null;

  get sketchMode(): boolean { return ui.sketchMode; }
  get isEditing(): boolean {
    return ui.editingNoteId !== null || ui.editingLinkId !== null;
  }

  // ── screen dimensions ─────────────────────────────────────────────────────
  get screenWidth(): number  { return this.app?.screen.width  ?? window.innerWidth;  }
  get screenHeight(): number { return this.app?.screen.height ?? window.innerHeight; }

  async init(el: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({
      resizeTo: el,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    el.appendChild(this.app.canvas);
    (this.app.canvas as HTMLCanvasElement).style.touchAction = 'none';

    this.stage = this.app.stage;
    this.stage.sortableChildren = true;

    this.app.ticker.add(() => this.tick());
    this.setupPointerEvents();
    this.setupKeyboardEvents();

    // Activate the default tool (select)
    this.setTool(ui.activeTool);
  }

  destroy(): void {
    window.removeEventListener('keydown', this._onKeyDown);
    this.app.destroy(true);
  }

  // ── Tools ─────────────────────────────────────────────────────────────────

  registerTool(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  get currentToolId(): string | null {
    return this._activeTool?.id ?? null;
  }

  setTool(id: ToolId | string): void {
    this._activeTool?.onDetach?.();
    this._activeTool = this.tools.get(id) ?? null;
    this._activeTool?.onAttach?.(this);
    ui.activeTool = id as ToolId;
    ui.sketchMode = id === 'sketch';
  }

  // ── Tick loop ─────────────────────────────────────────────────────────────

  private tick(): void {
    this.syncObjects();
    this.syncCamera();
  }

  private syncObjects(): void {
    const visible = visibleObjects();
    const visibleIds = new Set(visible.map(o => o.id));

    // Remove renderers for objects no longer visible
    for (const [id, r] of this.renderers) {
      if (!visibleIds.has(id)) {
        r.exit(() => {
          if (r.container.parent) r.container.parent.removeChild(r.container);
        });
        this.renderers.delete(id);
      }
    }

    // Add / sync all visible objects
    for (const data of visible) {
      if (!this.renderers.has(data.id)) {
        const r = createRenderer(data, this);
        this.renderers.set(data.id, r);
        this.stage.addChild(r.container);
        r.spawn();
      }
      this.renderers.get(data.id)!.sync(data, canvas.selection);
    }
  }

  private syncCamera(): void {
    const { x, y, zoom } = canvas.camera;
    this.stage.x = x;
    this.stage.y = y;
    this.stage.scale.set(zoom);
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - canvas.camera.x) / canvas.camera.zoom,
      y: (sy - canvas.camera.y) / canvas.camera.zoom,
    };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: wx * canvas.camera.zoom + canvas.camera.x,
      y: wy * canvas.camera.zoom + canvas.camera.y,
    };
  }

  panBy(dx: number, dy: number): void {
    canvas.camera.x += dx;
    canvas.camera.y += dy;
  }

  applyWheelZoom(clientX: number, clientY: number, deltaY: number): void {
    zoomAt(clientX, clientY, canvas.camera.zoom * Math.exp(-deltaY * 0.001), canvas.camera);
  }

  // ── Renderer access ───────────────────────────────────────────────────────

  getRenderer(id: string): BaseObjectRenderer | undefined {
    return this.renderers.get(id);
  }

  /** World-space bounding box of a renderer. */
  getObjectWorldBounds(id: string): { x: number; y: number; w: number; h: number } | null {
    return this.renderers.get(id)?.getScreenBounds() ?? null;
  }

  // ── Hit test ──────────────────────────────────────────────────────────────

  hitTest(sx: number, sy: number): string | null {
    const world = this.screenToWorld(sx, sy);
    const visible = visibleObjects();
    for (let i = visible.length - 1; i >= 0; i--) {
      const obj = visible[i];
      const r = this.renderers.get(obj.id);
      if (r && r.hitTest(world.x, world.y)) return obj.id;
    }
    return null;
  }

  // ── Scene capture for sketch overlay ─────────────────────────────────────

  captureScene(padding = 80): { dataUrl: string; camera: { x: number; y: number; zoom: number } } | null {
    const objects = visibleObjects().filter(o => o.type !== 'link' && o.type !== 'stroke');
    if (!objects.length) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of objects) {
      const b = this.getObjectWorldBounds(obj.id);
      if (!b) continue;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }

    if (!isFinite(minX)) return null;

    const contentW  = maxX - minX + padding * 2;
    const contentH  = maxY - minY + padding * 2;
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const zoom = Math.min(sw / contentW, sh / contentH, 2);
    const capCamera = {
      zoom,
      x: (sw - contentW * zoom) / 2 - (minX - padding) * zoom,
      y: (sh - contentH * zoom) / 2 - (minY - padding) * zoom,
    };

    const saved = { ...canvas.camera };
    canvas.camera.x = capCamera.x; canvas.camera.y = capCamera.y; canvas.camera.zoom = capCamera.zoom;
    this.syncCamera();
    this.app.renderer.render(this.app.stage);
    const dataUrl = (this.app.canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.85);
    canvas.camera.x = saved.x; canvas.camera.y = saved.y; canvas.camera.zoom = saved.zoom;
    this.syncCamera();

    return { dataUrl, camera: capCamera };
  }

  /** Capture the current visible viewport exactly as-is (no camera manipulation). */
  screenshotViewport(): string {
    this.app.renderer.render(this.app.stage);
    return (this.app.canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.85);
  }

  // ── Pointer events ────────────────────────────────────────────────────────

  private setupPointerEvents(): void {
    const el = this.app.canvas as HTMLCanvasElement;

    el.addEventListener('pointerdown', (e) => {
      if (this.isEditing || ui.sketchMode) return;
      el.setPointerCapture(e.pointerId);

      if (e.button === 1) {
        this._midPan = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, cx: canvas.camera.x, cy: canvas.camera.y };
        ui.cursorTransient = 'grabbing';
        return;
      }

      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 2) { this._startPinch(); return; }

      this._activeTool?.onPointerDown(e, this);
    });

    el.addEventListener('pointermove', (e) => {
      if (this._midPan && e.pointerId === this._midPan.pointerId) {
        canvas.camera.x = this._midPan.cx + (e.clientX - this._midPan.sx);
        canvas.camera.y = this._midPan.cy + (e.clientY - this._midPan.sy);
        return;
      }
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 2) { this._updatePinch(); return; }
      if (ui.sketchMode || this.isEditing) return;
      this._activeTool?.onPointerMove(e, this);
    });

    el.addEventListener('pointerup', (e) => {
      if (this._midPan && e.pointerId === this._midPan.pointerId) {
        this._midPan = null; ui.cursorTransient = ''; return;
      }
      this._pointers.delete(e.pointerId);
      this._pinch = null;
      if (!ui.sketchMode && !this.isEditing) {
        this._activeTool?.onPointerUp(e, this);
      }
    });

    el.addEventListener('pointercancel', (e) => {
      this._pointers.delete(e.pointerId);
      if (this._midPan?.pointerId === e.pointerId) { this._midPan = null; ui.cursorTransient = ''; }
      this._pinch = null;
    });

    el.addEventListener('contextmenu', this._onContextMenu);
    el.addEventListener('wheel', this._onWheel, { passive: false });
    el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    el.addEventListener('dblclick', (e) => {
      if (ui.sketchMode || this.isEditing) return;
      this._activeTool?.onDoubleClick?.(e as unknown as PointerEvent, this);
    });
  }

  private _onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();

    // In draw/erase mode, right-click opens the radial brush/colour menu instead.
    if (ui.activeTool === 'draw' || ui.activeTool === 'erase') {
      ui.radialMenu = { x: e.clientX, y: e.clientY };
      return;
    }

    const world = this.screenToWorld(e.clientX, e.clientY);
    const hitId = this.hitTest(e.clientX, e.clientY);

    let items: ContextMenuItem[];
    if (hitId && canvas.selection.length > 1 && canvas.selection.includes(hitId)) {
      const count = canvas.selection.length;
      items = [
        {
          kind: 'action',
          label: `Delete ${count} items`,
          icon: 'trash',
          shortcut: '⌫',
          action: () => removeObjects([...canvas.selection]),
        }
      ];
    } else if (hitId) {
      items = this._getObjectContextMenu(hitId, e);
    } else {
      items = this.backgroundMenuProvider?.(world) ?? [];
    }
    ui.contextMenu = { items, x: e.clientX, y: e.clientY };
  };

  private _getObjectContextMenu(id: string, e: MouseEvent): ContextMenuItem[] {
    const obj = canvas.objects.find(o => o.id === id);
    if (!obj) return [];

    const fakeEvent = new PointerEvent('contextmenu', {
      clientX: e.clientX, clientY: e.clientY,
      pointerId: 1, bubbles: true, cancelable: true,
    });
    this._activeTool?.onContextMenu?.(fakeEvent, this);

    // Return default context menu per type
    const baseItems: ContextMenuItem[] = [];
    if (obj.type !== 'stroke' && obj.type !== 'link') {
      if (obj.type === 'document' || obj.type === 'note') {
        baseItems.push({
          kind: 'action',
          label: obj.type === 'document' ? 'Open Editor' : 'Edit',
          icon: obj.type === 'document' ? 'article' : 'pencil',
          shortcut: '↵',
          action: () => {
            if (obj.type === 'document') {
              startEditingDocument(id);
            } else {
              startEditingNote(id);
            }
          }
        });
        baseItems.push({ kind: 'separator' });
      }
      if (obj.type === 'folder') {
        baseItems.push({
          kind: 'action',
          label: 'Enter Folder',
          icon: 'folder-open',
          shortcut: '↵',
          action: () => enterFolder(id),
        });
        baseItems.push({ kind: 'separator' });
      }
    }
    if (obj.type === 'link') {
      baseItems.push({
        kind: 'action', label: 'Edit Label', icon: 'tag', shortcut: '↵',
        action: () => startEditingLink(id),
      });
      baseItems.push({ kind: 'separator' });
    }
    baseItems.push({
      kind: 'action', label: 'Delete', icon: 'trash', shortcut: '⌫',
      action: () => removeObjects([id]),
    });
    return baseItems;
  }

  private _onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, canvas.camera.zoom * Math.exp(-e.deltaY * 0.001), canvas.camera);
  };

  private _startPinch(): void {
    const [a, b] = [...this._pointers.values()];
    if (!a || !b) return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this._pinch = {
      startDistance: Math.hypot(a.x - b.x, a.y - b.y),
      startZoom: canvas.camera.zoom,
      worldMid: this.screenToWorld(mid.x, mid.y),
    };
  }

  private _updatePinch(): void {
    if (!this._pinch) { this._startPinch(); return; }
    const [a, b] = [...this._pointers.values()];
    if (!a || !b) return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const nextZoom = Math.min(4, Math.max(0.25, this._pinch.startZoom * (dist / this._pinch.startDistance)));
    canvas.camera.zoom = nextZoom;
    canvas.camera.x = mid.x - this._pinch.worldMid.x * nextZoom;
    canvas.camera.y = mid.y - this._pinch.worldMid.y * nextZoom;
  }

  private setupKeyboardEvents(): void {
    window.addEventListener('keydown', this._onKeyDown);
  }

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (this.isEditing) return;
    // Don't steal shortcuts while typing in any text field (document editors, etc.)
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && active !== document.documentElement) {
      const tag = active.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || active.isContentEditable) return;
      if (active.closest('.cm-editor')) return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); scheduleSync(); return; }
    if (mod && (e.key === 'Z' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); scheduleSync(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const ids = [...canvas.selection];
      if (!ids.length) return;
      removeObjects(ids);
    }
    if (e.key === 'Escape') {
      closeOpenFolder();
      selectOne(null);
    }
  };
}
