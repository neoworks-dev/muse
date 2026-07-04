import { Container, Graphics } from 'pixi.js';
import { BaseObjectRenderer } from '../core/BaseObjectRenderer';
import type { ObjectData, StrokeData, StrokePoint, BrushType } from '../../state.svelte';

function colorToNumber(color: string): number {
  if (typeof color === 'string' && color.startsWith('#')) {
    return parseInt(color.slice(1), 16);
  }
  return 0x24282a;
}

// Per-brush look. Marker is wide and translucent; pencil is thin and a touch
// lighter; pen is the solid default.
function brushAlpha(brush: BrushType | undefined): number {
  if (brush === 'marker') return 0.4;
  if (brush === 'pencil') return 0.82;
  return 0.9;
}

export class StrokeRenderer extends BaseObjectRenderer {
  readonly container: Container;

  private _gfx: Graphics;
  private _lastSig = '';

  constructor(data: StrokeData) {
    super();
    this.container = new Container();
    this.container.eventMode = 'none';

    this._gfx = new Graphics();
    this.container.addChild(this._gfx);

    this._draw(data);
  }

  private _draw(stroke: StrokeData): void {
    const points = stroke.points;
    if (points.length < 2) return;

    const g = this._gfx;
    g.clear();
    g.setStrokeStyle({
      width: stroke.width,
      color: colorToNumber(stroke.color),
      alpha: brushAlpha(stroke.brush),
      cap: stroke.brush === 'marker' ? 'butt' : 'round',
      join: 'round'
    });

    g.moveTo(points[0].x, points[0].y);

    if (stroke.closed) {
      // Crisp polyline so boxes keep sharp corners; many-segment ovals read smooth.
      for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
      g.closePath();
    } else {
      // Freehand smoothing via midpoint quadratics.
      for (let i = 1; i < points.length - 1; i++) {
        const cur = points[i];
        const next = points[i + 1];
        g.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
      }
      const last = points.at(-1)!;
      g.lineTo(last.x, last.y);
    }
    g.stroke();
  }

  // Cheap geometry signature — shapes keep a constant point count while dragging,
  // so a count comparison alone would miss live edits.
  private _signature(stroke: StrokeData): string {
    const p = stroke.points;
    let acc = p.length;
    for (const pt of p) acc = acc * 31 + pt.x * 7.13 + pt.y * 3.97;
    return `${acc}:${stroke.color}:${stroke.width}:${stroke.brush}:${stroke.closed}`;
  }

  sync(data: ObjectData, _selection: string[]): void {
    if (data.type !== 'stroke') return;
    const stroke = data as StrokeData;
    const sig = this._signature(stroke);
    if (sig !== this._lastSig) {
      this._draw(stroke);
      this._lastSig = sig;
    }
  }

  override spawn(): void {
    this.container.alpha = 1;
  }

  override exit(onDone?: () => void): void {
    onDone?.();
  }

  override hitTest(_wx: number, _wy: number): boolean {
    // Never hit-test strokes in select tool (handled by erase tool directly)
    return false;
  }
}
