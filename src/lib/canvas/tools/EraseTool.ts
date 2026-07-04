import { Tool } from './Tool';
import type { CanvasRenderer } from '../core/CanvasRenderer';
import { canvas, pushHistory } from '../../state.svelte';
import { removeObjectsSilent } from '../../actions.svelte';
import type { StrokeData } from '../../state.svelte';

export class EraseTool extends Tool {
  readonly id = 'erase';
  private _erasing = false;

  onPointerDown(e: PointerEvent, engine: CanvasRenderer): void {
    pushHistory();
    this._erasing = true;
    this._erase(e, engine);
  }

  onPointerMove(e: PointerEvent, engine: CanvasRenderer): void {
    if (!this._erasing) return;
    this._erase(e, engine);
  }

  onPointerUp(_e: PointerEvent, _engine: CanvasRenderer): void {
    this._erasing = false;
  }

  private _erase(e: PointerEvent, engine: CanvasRenderer): void {
    const world = engine.screenToWorld(e.clientX, e.clientY);
    const radius = 18 / canvas.camera.zoom;
    const toRemove: string[] = [];

    for (const obj of canvas.objects) {
      if (obj.type !== 'stroke') continue;
      const stroke = obj as StrokeData;
      if (this._strokeHit(stroke, world.x, world.y, radius)) {
        toRemove.push(stroke.id);
      }
    }

    if (toRemove.length > 0) removeObjectsSilent(toRemove);
  }

  // Hit any segment, not just vertices — shapes like the box only store corner
  // points, so a vertex-only test could erase them at the origin alone.
  private _strokeHit(stroke: StrokeData, x: number, y: number, radius: number): boolean {
    const pts = stroke.points;
    if (pts.length === 1) {
      return Math.hypot(pts[0].x - x, pts[0].y - y) <= radius;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      if (distToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= radius) {
        return true;
      }
    }
    return false;
  }
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
