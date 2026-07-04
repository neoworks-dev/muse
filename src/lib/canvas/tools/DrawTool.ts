import { Tool } from './Tool';
import type { CanvasRenderer } from '../core/CanvasRenderer';
import { canvas, ui } from '../../state.svelte';
import { addObject } from '../../actions.svelte';
import { createId } from '../utils/ids';
import type { StrokeData, StrokePoint, BrushType, ShapeType } from '../../state.svelte';

const BRUSH_WIDTH: Record<BrushType, number> = { pen: 4, pencil: 2, marker: 14 };

function isShape(tool: string): tool is ShapeType {
  return tool === 'line' || tool === 'box' || tool === 'oval';
}

export class DrawTool extends Tool {
  readonly id = 'draw';
  private _activeId: string | null = null;
  private _engine: CanvasRenderer | null = null;
  private _shapeStart: { x: number; y: number } | null = null;

  override onAttach(engine: CanvasRenderer): void {
    this._engine = engine;
  }

  override onDetach(): void {
    this._engine = null;
  }

  onPointerDown(e: PointerEvent, engine: CanvasRenderer): void {
    if (e.button !== 0) return;
    const world = engine.screenToWorld(e.clientX, e.clientY);
    const tool = ui.drawTool;
    const id = createId('stroke');
    const brush: BrushType = isShape(tool) ? 'pen' : tool;

    const data: StrokeData = {
      type: 'stroke',
      id,
      points: [{ x: world.x, y: world.y, pressure: e.pressure || 0.5 }],
      color: ui.drawColor,
      width: BRUSH_WIDTH[brush],
      brush,
      closed: tool === 'box' || tool === 'oval'
    };
    addObject(data);
    this._activeId = id;
    this._shapeStart = isShape(tool) ? { x: world.x, y: world.y } : null;
  }

  onPointerMove(e: PointerEvent, engine: CanvasRenderer): void {
    if (!this._activeId) return;
    const stroke = canvas.objects.find((o) => o.id === this._activeId) as StrokeData | undefined;
    if (!stroke) return;

    const world = engine.screenToWorld(e.clientX, e.clientY);

    if (this._shapeStart) {
      stroke.points = shapePoints(ui.drawTool as ShapeType, this._shapeStart, world);
      return;
    }

    const last = stroke.points.at(-1);
    if (last && Math.hypot(world.x - last.x, world.y - last.y) < 1) return;
    stroke.points.push({ x: world.x, y: world.y, pressure: e.pressure || 0.5 });
  }

  onPointerUp(_e: PointerEvent, _engine: CanvasRenderer): void {
    this._activeId = null;
    this._shapeStart = null;
  }
}

function pt(x: number, y: number): StrokePoint {
  return { x, y, pressure: 0.6 };
}

// Build the point list for a two-point shape dragged from `a` to `b`.
function shapePoints(shape: ShapeType, a: { x: number; y: number }, b: { x: number; y: number }): StrokePoint[] {
  if (shape === 'line') return [pt(a.x, a.y), pt(b.x, b.y)];

  if (shape === 'box') {
    return [pt(a.x, a.y), pt(b.x, a.y), pt(b.x, b.y), pt(a.x, b.y), pt(a.x, a.y)];
  }

  // oval — sample an ellipse inscribed in the drag rectangle
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  const points: StrokePoint[] = [];
  const segments = 48;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(pt(cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry));
  }
  return points;
}
