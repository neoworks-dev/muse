import { Graphics, Ticker, type Filter } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';
import { Tool } from './Tool';
import type { CanvasRenderer } from '../core/CanvasRenderer';
import { canvas, ui, visibleObjects, pushHistory } from '../../state.svelte';
import { scheduleSync } from '../../sync.svelte';
import {
	selectOne,
	selectMany,
	startEditingDocument,
	startEditingNote,
	startEditingLink,
	toggleFolderOpen,
	closeOpenFolder,
	arrangeOpenFolder,
	canFileInto,
	startViewingBookmark,
	openPdf
} from '../../actions.svelte';
import type { MediaData } from '../../state.svelte';
import { MediaRenderer } from '../objects/MediaRenderer';
import type { ResizeHandle } from '../objects/MediaRenderer';
import { themeMode } from '../theme-colors';

// Resize handle → CustomCursor transient kind (two axes + two diagonals).
const HANDLE_TRANSIENT: Record<ResizeHandle, string> = {
	n: 'resize-ns', s: 'resize-ns', e: 'resize-ew', w: 'resize-ew',
	nw: 'resize-nwse', se: 'resize-nwse', ne: 'resize-nesw', sw: 'resize-nesw'
};

const DRAG_THRESHOLD = 5;

type State =
	| { kind: 'idle' }
	| {
			kind: 'pending';
			targetId: string;
			startSx: number;
			startSy: number;
			startOx: number;
			startOy: number;
	  }
	| {
			kind: 'dragging';
			startSx: number;
			startSy: number;
			objects: Array<{ id: string; ox: number; oy: number }>;
			// Open-folder grid children that ride along when their folder is dragged.
			follow: Array<{ id: string; ox: number; oy: number }>;
	  }
	| { kind: 'rubber'; worldX0: number; worldY0: number; worldX1: number; worldY1: number }
	| {
			kind: 'resizing';
			mediaId: string;
			handle: ResizeHandle;
			startWorldX: number;
			startWorldY: number;
	  };

export class MultiSelectTool extends Tool {
	readonly id = 'select';
	private _state: State = { kind: 'idle' };
	private _overlay!: Graphics;
	private _engine: CanvasRenderer | null = null;
	private _lastClickId = '';
	private _lastClickTime = 0;

	// Per-dragged-item visual feedback: a temporary drop shadow plus an animated
	// scale, eased toward a target so filing-in (shrink, settle) and pulling-out
	// (grow, lift) share the same smooth, reversible motion.
	private _dragFx = new Map<
		string,
		{
			shadow: DropShadowFilter;
			savedFilters: unknown;
			scale: number;
			scaleTarget: number;
			shAlpha: number;
			shAlphaTarget: number;
			shBlur: number;
			shBlurTarget: number;
			shOffsetY: number;
			shOffsetYTarget: number;
		}
	>();
	private _dragFxRunning = false;

	private static readonly DROP_MARGIN = 60; // how "near" a folder card counts as filing in
	private static readonly REGION_MARGIN = 40; // slack around the open grid before it counts as out
	private static readonly SCALE_IN = 0.85; // gentle shrink when it will drop into a folder
	private static readonly SCALE_OUT = 1.08; // slight grow when it will pop out of a folder

	override onAttach(engine: CanvasRenderer): void {
		this._engine = engine;
		this._overlay = new Graphics();
		this._overlay.zIndex = 10000;
		this._overlay.eventMode = 'none';
		engine.app.stage.addChild(this._overlay);
	}

	override onDetach(): void {
		this._endDragFx(this._engine);
		this._overlay?.clear();
		this._overlay?.destroy();
		this._engine = null;
	}

	onPointerDown(e: PointerEvent, engine: CanvasRenderer): void {
		console.log(e);
		if (e.button !== 0) return;
		const sx = e.clientX,
			sy = e.clientY;
		const hitId = engine.hitTest(sx, sy);

		// Check resize handle on selected MediaObject
		if (hitId && canvas.selection.includes(hitId)) {
			const r = engine.getRenderer(hitId);
			if (r instanceof MediaRenderer) {
				const world = engine.screenToWorld(sx, sy);
				const handle = r.getHandleAt(world.x, world.y);
				if (handle) {
					pushHistory();
					r.beginResize();
					this._state = {
						kind: 'resizing',
						mediaId: hitId,
						handle,
						startWorldX: world.x,
						startWorldY: world.y
					};
					ui.cursorTransient = HANDLE_TRANSIENT[handle];
					return;
				}
			}
		}

		if (hitId) {
			const alreadyInMulti = canvas.selection.length > 1 && canvas.selection.includes(hitId);
			if (!alreadyInMulti) selectOne(hitId);

			const obj = canvas.objects.find((o) => o.id === hitId);
			const ox = obj && 'x' in obj ? (obj as { x: number }).x : 0;
			const oy = obj && 'y' in obj ? (obj as { y: number }).y : 0;
			this._state = {
				kind: 'pending',
				targetId: hitId,
				startSx: sx,
				startSy: sy,
				startOx: ox,
				startOy: oy
			};
		} else {
			selectMany([]);
			closeOpenFolder();
			const world = engine.screenToWorld(sx, sy);
			this._state = {
				kind: 'rubber',
				worldX0: world.x,
				worldY0: world.y,
				worldX1: world.x,
				worldY1: world.y
			};
		}
	}

	onPointerMove(e: PointerEvent, engine: CanvasRenderer): void {
		const sx = e.clientX,
			sy = e.clientY;

		if (this._state.kind === 'resizing') {
			const world = engine.screenToWorld(sx, sy);
			const { mediaId, handle, startWorldX, startWorldY } = this._state;
			const r = engine.getRenderer(mediaId);
			if (r instanceof MediaRenderer) {
				r.applyResize(handle, world.x - startWorldX, world.y - startWorldY, e.shiftKey);
			}
			return;
		}

		if (this._state.kind === 'pending') {
			const dx = sx - this._state.startSx;
			const dy = sy - this._state.startSy;
			if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
				pushHistory();
				const { targetId } = this._state;
				const ids = canvas.selection.includes(targetId) ? canvas.selection : [targetId];
				const objects = ids
					.map((id) => {
						const o = canvas.objects.find((obj) => obj.id === id);
						if (!o || !('x' in o)) return null;
						return { id, ox: (o as { x: number }).x, oy: (o as { y: number }).y };
					})
					.filter(Boolean) as Array<{ id: string; ox: number; oy: number }>;
				const follow = this._collectFollowers(ids);
				this._state = {
					kind: 'dragging',
					startSx: this._state.startSx,
					startSy: this._state.startSy,
					objects,
					follow
				};
				ui.cursorTransient = 'grabbing';
				this._beginDragFx(engine);
			}
		}

		if (this._state.kind === 'dragging') {
			const { objects, startSx, startSy } = this._state;
			const dx = (sx - startSx) / canvas.camera.zoom;
			const dy = (sy - startSy) / canvas.camera.zoom;
			for (const { id, ox, oy } of objects) {
				const o = canvas.objects.find((obj) => obj.id === id);
				if (o && 'x' in o) {
					(o as { x: number; y: number }).x = ox + dx;
					(o as { x: number; y: number }).y = oy + dy;
				}
			}
			// Grid children of a dragged open folder ride along with the same delta.
			for (const { id, ox, oy } of this._state.follow) {
				const o = canvas.objects.find((obj) => obj.id === id);
				if (o && 'x' in o) {
					(o as { x: number; y: number }).x = ox + dx;
					(o as { x: number; y: number }).y = oy + dy;
				}
			}
			this._updateDragCues(engine);
		}

		if (this._state.kind === 'rubber') {
			const world = engine.screenToWorld(sx, sy);
			this._state.worldX1 = world.x;
			this._state.worldY1 = world.y;
			this._drawRubberBand(engine);
			this._updateRubberBandSelection(engine);
		}

		// Handle proximity cursor
		if (this._state.kind === 'idle' || this._state.kind === 'pending') {
			const world = engine.screenToWorld(sx, sy);
			let cursor = '';
			for (const id of canvas.selection) {
				const r = engine.getRenderer(id);
				if (r instanceof MediaRenderer) {
					const handle = r.updateHandleProximity(world.x, world.y);
					if (handle) cursor = HANDLE_TRANSIENT[handle];
				}
			}
			ui.cursorTransient = cursor;
		}
	}

	onPointerUp(e: PointerEvent, engine: CanvasRenderer): void {
		if (this._state.kind === 'resizing') {
			ui.cursorTransient = '';
			this._state = { kind: 'idle' };
			scheduleSync();
			return;
		}

		if (this._state.kind === 'pending') {
			const { targetId } = this._state;
			const obj = canvas.objects.find((o) => o.id === targetId);
			if (obj) {
				if (obj.type === 'document') startEditingDocument(targetId);
				else if (obj.type === 'note') startEditingNote(targetId);
				else if (obj.type === 'link') startEditingLink(targetId);
				else if (obj.type === 'folder') toggleFolderOpen(targetId);
				else if (obj.type === 'media' && (obj as MediaData).mediaType === 'pdf') openPdf(targetId);
				else if (obj.type === 'bookmark') {
					const now = Date.now();
					if (this._lastClickId === targetId && now - this._lastClickTime < 350) {
						startViewingBookmark(targetId);
						this._lastClickId = '';
						this._lastClickTime = 0;
						this._state = { kind: 'idle' };
						return;
					}
				}
			}
			this._lastClickId = targetId;
			this._lastClickTime = Date.now();
		}

		if (this._state.kind === 'dragging') {
			this._commitDragDrop(engine);
			this._endDragFx(engine);
			ui.cursorTransient = '';
			this._state = { kind: 'idle' };
			scheduleSync();
			return;
		}

		if (this._state.kind === 'rubber') {
			this._overlay.clear();
		}

		this._state = { kind: 'idle' };
	}

	// ── Drag in / out of folders ──────────────────────────────────────────────

	/** Grid children that should ride along when their open folder is in the drag set. */
	private _collectFollowers(draggedIds: string[]): Array<{ id: string; ox: number; oy: number }> {
		const openId = ui.openFolderId;
		if (!openId || !draggedIds.includes(openId)) return [];
		const dragged = new Set(draggedIds);
		const followers: Array<{ id: string; ox: number; oy: number }> = [];
		for (const o of canvas.objects) {
			if (dragged.has(o.id) || !('x' in o)) continue;
			const parentId = ('parentId' in o ? (o as { parentId?: string }).parentId : undefined) ?? null;
			if (parentId === openId) {
				followers.push({ id: o.id, ox: (o as { x: number }).x, oy: (o as { y: number }).y });
			}
		}
		return followers;
	}

	private _objectCenter(engine: CanvasRenderer, id: string): { x: number; y: number } {
		const b = engine.getObjectWorldBounds(id);
		if (b) return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
		const o = canvas.objects.find((obj) => obj.id === id) as { x?: number; y?: number } | undefined;
		return { x: o?.x ?? 0, y: o?.y ?? 0 };
	}

	/** Topmost folder whose card (plus a margin) contains the point, excluding the dragged ids. */
	private _folderDropTargetAt(
		engine: CanvasRenderer,
		wx: number,
		wy: number,
		exclude: Set<string>
	): string | null {
		const folders = visibleObjects().filter((o) => o.type === 'folder' && !exclude.has(o.id));
		for (let i = folders.length - 1; i >= 0; i--) {
			const b = engine.getObjectWorldBounds(folders[i].id);
			if (!b) continue;
			const m = MultiSelectTool.DROP_MARGIN;
			if (wx >= b.x - m && wx <= b.x + b.w + m && wy >= b.y - m && wy <= b.y + b.h + m) {
				return folders[i].id;
			}
		}
		return null;
	}

	/** Bounding box (with slack) of an open folder's card and its laid-out grid items. */
	private _openFolderRegion(
		engine: CanvasRenderer,
		exclude: Set<string>
	): { x: number; y: number; w: number; h: number } | null {
		const openId = ui.openFolderId;
		if (!openId) return null;

		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		const include = (b: { x: number; y: number; w: number; h: number } | null) => {
			if (!b) return;
			minX = Math.min(minX, b.x);
			minY = Math.min(minY, b.y);
			maxX = Math.max(maxX, b.x + b.w);
			maxY = Math.max(maxY, b.y + b.h);
		};

		include(engine.getObjectWorldBounds(openId));
		for (const o of visibleObjects()) {
			if (o.type === 'link') continue;
			const parentId = ('parentId' in o ? (o as { parentId?: string }).parentId : undefined) ?? null;
			if (parentId !== openId || exclude.has(o.id)) continue;
			include(engine.getObjectWorldBounds(o.id));
		}

		if (!isFinite(minX)) return null;
		const m = MultiSelectTool.REGION_MARGIN;
		return { x: minX - m, y: minY - m, w: maxX - minX + m * 2, h: maxY - minY + m * 2 };
	}

	/** Single source of truth for what a drop will do — used by both the cue and the commit. */
	private _resolveDrop(
		engine: CanvasRenderer,
		id: string,
		exclude: Set<string>
	): { mode: 'in' | 'out' | 'none'; targetFolder: string | null } {
		const obj = canvas.objects.find((o) => o.id === id);
		if (!obj || !('x' in obj)) return { mode: 'none', targetFolder: null };

		const currentParent = ('parentId' in obj ? (obj as { parentId?: string }).parentId : undefined) ?? null;
		const center = this._objectCenter(engine, id);

		const openId = ui.openFolderId;
		const region = openId ? this._openFolderRegion(engine, exclude) : null;
		const inRegion =
			region !== null &&
			center.x >= region.x &&
			center.x <= region.x + region.w &&
			center.y >= region.y &&
			center.y <= region.y + region.h;

		// Filing into the open folder: dropping anywhere near its card or its grid items.
		if (openId && currentParent !== openId && inRegion && canFileInto(id, openId)) {
			return { mode: 'in', targetFolder: openId };
		}

		// Filing into any folder by dropping on its card (covers closed folders too).
		const fileTarget = this._folderDropTargetAt(engine, center.x, center.y, exclude);
		if (fileTarget !== null && fileTarget !== currentParent && canFileInto(id, fileTarget)) {
			return { mode: 'in', targetFolder: fileTarget };
		}

		// Leaving: only once the item exits the open folder's reserved grid region.
		if (openId && currentParent === openId && !inRegion) {
			return { mode: 'out', targetFolder: null };
		}

		return { mode: 'none', targetFolder: null };
	}

	private _updateDragCues(engine: CanvasRenderer): void {
		if (this._state.kind !== 'dragging') return;
		const exclude = new Set(this._state.objects.map((o) => o.id));
		for (const id of exclude) {
			const fx = this._dragFx.get(id);
			if (!fx) continue;
			const { mode } = this._resolveDrop(engine, id, exclude);
			if (mode === 'in') {
				fx.scaleTarget = MultiSelectTool.SCALE_IN;
				fx.shAlphaTarget = 0.05;
				fx.shBlurTarget = 6;
				fx.shOffsetYTarget = 2;
			} else if (mode === 'out') {
				fx.scaleTarget = MultiSelectTool.SCALE_OUT;
				fx.shAlphaTarget = 0.3;
				fx.shBlurTarget = 14;
				fx.shOffsetYTarget = 16;
			} else {
				fx.scaleTarget = 1;
				fx.shAlphaTarget = 0;
				fx.shBlurTarget = 6;
				fx.shOffsetYTarget = 0;
			}
		}
	}

	private _beginDragFx(engine: CanvasRenderer): void {
		if (this._state.kind !== 'dragging') return;
		for (const { id } of this._state.objects) {
			const renderer = engine.getRenderer(id);
			if (!renderer) continue;
			const shadow = new DropShadowFilter({ offset: { x: 0, y: 0 }, blur: 6, alpha: 0, color: 0x000000 });
			const savedFilters = renderer.container.filters;
			const existing = Array.isArray(savedFilters) ? savedFilters : savedFilters ? [savedFilters] : [];
			renderer.container.filters = [...existing, shadow];
			this._dragFx.set(id, {
				shadow,
				savedFilters,
				scale: renderer.container.scale.x,
				scaleTarget: 1,
				shAlpha: 0,
				shAlphaTarget: 0,
				shBlur: 6,
				shBlurTarget: 6,
				shOffsetY: 0,
				shOffsetYTarget: 0
			});
		}
		if (!this._dragFxRunning) {
			this._dragFxRunning = true;
			Ticker.shared.add(this._dragFxTick);
		}
	}

	private _dragFxTick = (): void => {
		if (this._state.kind !== 'dragging') return;
		const k = 0.12; // slow, smooth easing toward the target
		for (const { id } of this._state.objects) {
			const fx = this._dragFx.get(id);
			if (!fx) continue;
			const renderer = this._engine?.getRenderer(id);
			if (!renderer) continue;
			fx.scale += (fx.scaleTarget - fx.scale) * k;
			fx.shAlpha += (fx.shAlphaTarget - fx.shAlpha) * k;
			fx.shBlur += (fx.shBlurTarget - fx.shBlur) * k;
			fx.shOffsetY += (fx.shOffsetYTarget - fx.shOffsetY) * k;
			renderer.container.scale.set(fx.scale);
			fx.shadow.alpha = fx.shAlpha;
			fx.shadow.blur = fx.shBlur;
			fx.shadow.offset = { x: 0, y: fx.shOffsetY };
		}
	};

	private _endDragFx(engine: CanvasRenderer | null): void {
		if (this._dragFxRunning) {
			Ticker.shared.remove(this._dragFxTick);
			this._dragFxRunning = false;
		}
		for (const [id, fx] of this._dragFx) {
			const renderer = engine?.getRenderer(id) ?? this._engine?.getRenderer(id);
			if (renderer) {
				renderer.container.scale.set(1);
				renderer.container.filters = Array.isArray(fx.savedFilters)
					? [...fx.savedFilters]
					: (fx.savedFilters as Filter | null);
			}
			fx.shadow.destroy();
		}
		this._dragFx.clear();
	}

	private _commitDragDrop(engine: CanvasRenderer): void {
		if (this._state.kind !== 'dragging') return;
		const ids = this._state.objects.map((o) => o.id);
		const idSet = new Set(ids);
		const scope = canvas.folderStack.at(-1) ?? null;
		const relayout = new Set<string>();
		const openId = ui.openFolderId;
		let changed = false;

		for (const id of ids) {
			const obj = canvas.objects.find((o) => o.id === id);
			if (!obj || !('x' in obj)) continue;
			const parent = ('parentId' in obj ? (obj as { parentId?: string }).parentId : undefined) ?? null;
			const { mode, targetFolder } = this._resolveDrop(engine, id, idSet);

			if (mode === 'in' && targetFolder) {
				(obj as { parentId?: string }).parentId = targetFolder;
				changed = true;
				if (openId === targetFolder) relayout.add(targetFolder);
			} else if (mode === 'out') {
				// Dragged out of its folder onto the open canvas; keep the drop position.
				(obj as { parentId?: string }).parentId = scope ?? undefined;
				changed = true;
				if (openId) relayout.add(openId); // reflow to close the gap left behind
			} else if (openId && parent === openId) {
				// Nudged but never left the folder — snap it back into its grid slot.
				relayout.add(openId);
			}
		}

		// Moving an open folder leaves its grid behind — re-anchor it to the card.
		if (ui.openFolderId && idSet.has(ui.openFolderId)) relayout.add(ui.openFolderId);

		for (const folderId of relayout) arrangeOpenFolder(folderId, false);
		if (changed) pushHistory();
	}

	private _drawRubberBand(_engine: CanvasRenderer): void {
		if (this._state.kind !== 'rubber') return;
		const { worldX0, worldY0, worldX1, worldY1 } = this._state;

		// Overlay lives inside the camera-transformed stage, so draw in world-space.
		// Compensate stroke width and corner radius so they appear constant on screen.
		const zoom = canvas.camera.zoom;
		const wx = Math.min(worldX0, worldX1);
		const wy = Math.min(worldY0, worldY1);
		const ww = Math.abs(worldX1 - worldX0);
		const wh = Math.abs(worldY1 - worldY0);

		const screenW = ww * zoom;
		const screenH = wh * zoom;
		const minScreenDim = Math.min(screenW, screenH);
		const radius = (minScreenDim < 20 ? 0 : Math.min(12, (minScreenDim - 20) / 5)) / zoom;

		// Neutral selection rectangle — light surfaces need a dark line, dark a light one.
		const neutral = themeMode() === 'dark' ? 0xffffff : 0x1a1a1a;
		const g = this._overlay;
		g.clear();
		g.roundRect(wx, wy, ww, wh, radius);
		g.fill({ color: neutral, alpha: 0.08 });
		g.roundRect(wx, wy, ww, wh, radius);
		g.setStrokeStyle({ width: 1.5 / zoom, color: neutral, alpha: 0.55 });
		g.stroke();
	}

	private _updateRubberBandSelection(engine: CanvasRenderer): void {
		if (this._state.kind !== 'rubber') return;
		const { worldX0, worldY0, worldX1, worldY1 } = this._state;
		const minX = Math.min(worldX0, worldX1);
		const maxX = Math.max(worldX0, worldX1);
		const minY = Math.min(worldY0, worldY1);
		const maxY = Math.max(worldY0, worldY1);

		const selected: string[] = [];
		for (const obj of visibleObjects()) {
			if (obj.type === 'link' || obj.type === 'stroke') continue;
			const b = engine.getObjectWorldBounds(obj.id);
			if (!b) continue;
			if (b.x < maxX && b.x + b.w > minX && b.y < maxY && b.y + b.h > minY) {
				selected.push(obj.id);
			}
		}
		selectMany(selected);
	}
}
