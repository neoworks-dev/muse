import { Graphics } from 'pixi.js';
import { Tool } from './Tool';
import type { CanvasRenderer } from '../core/CanvasRenderer';
import { canvas } from '../../state.svelte';
import { addObject, selectOne } from '../../actions.svelte';
import { createId } from '../utils/ids';
import type { LinkData, NoteData } from '../../state.svelte';

type Point = { x: number; y: number };

export class LinkTool extends Tool {
  readonly id = 'link';
  private _sourceId: string | null = null;
  private _sourceCenter: Point | null = null;
  private _dragPoint: Point | null = null;
  private _overlay: Graphics | null = null;
  private _engine: CanvasRenderer | null = null;

  override onAttach(engine: CanvasRenderer): void {
    this._engine = engine;
    this._overlay = new Graphics();
    this._overlay.zIndex = 9999;
    this._overlay.eventMode = 'none';
    engine.app.stage.addChild(this._overlay);
  }

  override onDetach(): void {
    this._overlay?.clear();
    this._overlay?.destroy();
    this._overlay = null;
    this._engine = null;
  }

  onPointerDown(e: PointerEvent, engine: CanvasRenderer): void {
    const hitId = engine.hitTest(e.clientX, e.clientY);
    if (!hitId) { this._reset(); return; }

    const obj = canvas.objects.find(o => o.id === hitId);
    if (!obj || obj.type === 'link') { this._reset(); return; }

    this._sourceId = hitId;
    // Calculate approximate center
    const o = obj as { x: number; y: number };
    let w = 200, h = 100;
    if (obj.type === 'document') { w = 360; h = Math.round(360 * 297 / 210); }
    else if (obj.type === 'folder') { w = 340; h = 250; }
    else if (obj.type === 'media') {
      w = (obj as import('../../state.svelte').MediaData).w ?? 320;
      h = (obj as import('../../state.svelte').MediaData).h ?? 240;
    }
    this._sourceCenter = { x: o.x + w / 2, y: o.y + h / 2 };
    this._dragPoint = engine.screenToWorld(e.clientX, e.clientY);
    selectOne(hitId);
  }

  onPointerMove(e: PointerEvent, engine: CanvasRenderer): void {
    if (!this._sourceId) return;
    this._dragPoint = engine.screenToWorld(e.clientX, e.clientY);
    this._drawOverlay();
  }

  onPointerUp(e: PointerEvent, engine: CanvasRenderer): void {
    if (!this._sourceId) return;

    const hitId = engine.hitTest(e.clientX, e.clientY);
    const destId = hitId && hitId !== this._sourceId
      && canvas.objects.find(o => o.id === hitId)?.type !== 'link'
      ? hitId : null;

    if (destId) {
      this._createLink(this._sourceId, destId);
      selectOne(destId);
    } else {
      const world = engine.screenToWorld(e.clientX, e.clientY);
      const noteId = createId('note');
      const noteData: NoteData = {
        type: 'note',
        id: noteId,
        x: world.x - 180,
        y: world.y - 60,
        body: '',
      };
      addObject(noteData);
      this._createLink(this._sourceId, noteId);
      selectOne(noteId);
    }

    this._reset();
  }

  private _createLink(fromId: string, toId: string): void {
    const exists = canvas.objects.some(
      o => o.type === 'link' && (o as LinkData).fromId === fromId && (o as LinkData).toId === toId
    );
    if (!exists) {
      const data: LinkData = {
        type: 'link',
        id: createId('link'),
        fromId,
        toId,
        label: 'context',
        direction: 'forward',
      };
      addObject(data);
    }
  }

  private _drawOverlay(): void {
    if (!this._overlay || !this._sourceCenter || !this._dragPoint || !this._engine) return;
    const g = this._overlay;
    const s = this._engine.worldToScreen(this._sourceCenter.x, this._sourceCenter.y);
    const e = this._engine.worldToScreen(this._dragPoint.x, this._dragPoint.y);
    const dx = e.x - s.x;
    const dy = e.y - s.y;
    const ca = { x: s.x + dx * 0.35, y: s.y + dy * 0.1 - 40 };
    const cb = { x: s.x + dx * 0.65, y: s.y + dy * 0.9 + 40 };

    g.clear();
    g.setStrokeStyle({ width: 2, color: 0x6060ff, alpha: 0.6, cap: 'round' });
    g.moveTo(s.x, s.y).bezierCurveTo(ca.x, ca.y, cb.x, cb.y, e.x, e.y).stroke();

    const angle = Math.atan2(e.y - cb.y, e.x - cb.x);
    const sz = 10;
    g.setFillStyle({ color: 0x6060ff, alpha: 0.6 });
    g.moveTo(e.x, e.y)
      .lineTo(e.x - sz * Math.cos(angle - Math.PI / 6), e.y - sz * Math.sin(angle - Math.PI / 6))
      .lineTo(e.x - sz * Math.cos(angle + Math.PI / 6), e.y - sz * Math.sin(angle + Math.PI / 6))
      .closePath()
      .fill();
  }

  private _reset(): void {
    this._sourceId = null;
    this._sourceCenter = null;
    this._dragPoint = null;
    this._overlay?.clear();
  }
}
