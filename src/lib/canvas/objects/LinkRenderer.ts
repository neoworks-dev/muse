import { Container, Graphics, Text, TextStyle, Ticker } from 'pixi.js';
import { BaseObjectRenderer } from '../core/BaseObjectRenderer';
import type { ObjectData, LinkData } from '../../state.svelte';
import { canvas } from '../../state.svelte';
import { getEdgePoint } from '../utils/geometry';

type Point = { x: number; y: number };

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';

export class LinkRenderer extends BaseObjectRenderer {
  readonly container: Container;

  private _gfx: Graphics;
  private _pillBg: Graphics;
  private _pillText: Text;

  /** World-space midpoint for external UI (link label overlay). */
  labelWorldPosition: Point | null = null;

  private _lastLabel = '';
  private _lastDirection = '';
  private _lastSelected = false;
  private _frameTickId: (() => void) | null = null;

  constructor(data: LinkData) {
    super();
    this.container = new Container();
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    // Links sit behind everything
    this.container.zIndex = -100;

    this._gfx = new Graphics();
    this.container.addChild(this._gfx);

    this._pillBg = new Graphics();
    this.container.addChild(this._pillBg);

    this._pillText = new Text({
      text: data.label,
      style: new TextStyle({ fontFamily: FONT, fontSize: 12, fill: 'rgba(80, 70, 112, 0.9)' }),
    });
    this._pillText.anchor.set(0.5);
    this.container.addChild(this._pillText);

    // Start per-frame update for live endpoint tracking
    this._frameTickId = () => this._tickRedraw();
    Ticker.shared.add(this._frameTickId);
  }

  private _tickRedraw(): void {
    // Find current data in canvas state
    const d = canvas.objects.find(o => o.type === 'link' && (o as LinkData).fromId === this._lastFromId) as LinkData | undefined;
    if (d) {
      this._redrawFromState(d, canvas.selection.includes(d.id));
    }
  }

  private _lastFromId = '';
  private _lastToId   = '';

  private _getObjBounds(id: string): { x: number; y: number; width: number; height: number } | null {
    const obj = canvas.objects.find(o => o.id === id);
    if (!obj || !('x' in obj)) return null;
    const o = obj as ObjectData & { x: number; y: number };
    // Get renderer bounds from CanvasRenderer — we'll use a simplified approach
    // based on the data w/h that we track
    let w = 200, h = 100;
    if (obj.type === 'note') {
      w = 200; h = 60;
    } else if (obj.type === 'document') {
      w = 360; h = Math.round(360 * 297 / 210);
    } else if (obj.type === 'folder') {
      w = 340; h = 250;
    } else if (obj.type === 'media') {
      w = (obj as import('../../state.svelte').MediaData).w ?? 320;
      h = (obj as import('../../state.svelte').MediaData).h ?? 240;
    } else if (obj.type === 'bookmark') {
      w = 320;
      h = 200;
    }
    return { x: o.x, y: o.y, width: w, height: h };
  }

  private _redrawFromState(data: LinkData, selected: boolean): void {
    const fromBounds = this._getObjBounds(data.fromId);
    const toBounds   = this._getObjBounds(data.toId);
    if (!fromBounds || !toBounds) return;

    const fromC = { x: fromBounds.x + fromBounds.width / 2, y: fromBounds.y + fromBounds.height / 2 };
    const toC   = { x: toBounds.x   + toBounds.width / 2,   y: toBounds.y   + toBounds.height / 2   };

    const start = getEdgePoint(fromBounds, toC);
    const end   = getEdgePoint(toBounds,   fromC);

    const dx = toC.x - fromC.x;
    const dy = toC.y - fromC.y;
    const len = Math.hypot(dx, dy) || 1;
    const ndx = dx / len;
    const ndy = dy / len;
    const tension = Math.min(len * 0.42, 160);
    const ca = { x: start.x + ndx * tension, y: start.y + ndy * tension };
    const cb = { x: end.x   - ndx * tension, y: end.y   - ndy * tension };

    this.labelWorldPosition = { x: (fromC.x + toC.x) / 2, y: (fromC.y + toC.y) / 2 };

    const lineColor  = selected ? 0x6060ff : 0x645a82;
    const lineAlpha  = selected ? 0.9 : 0.38;
    const arrowColor = selected ? 0x6060ff : 0x645a82;
    const arrowAlpha = selected ? 0.85 : 0.55;

    const g = this._gfx;
    g.clear();

    g.setStrokeStyle({ width: 2, color: lineColor, alpha: lineAlpha, cap: 'round' });
    this._dashedBezier(g, start, ca, cb, end);

    if (data.direction === 'forward' || data.direction === 'both') {
      this._arrowHead(g, cb, end, arrowColor, arrowAlpha);
    }
    if (data.direction === 'backward' || data.direction === 'both') {
      this._arrowHead(g, ca, start, arrowColor, arrowAlpha);
    }

    const mid = this.labelWorldPosition;
    const tw = this._pillText.width;
    const pillW = tw + 16;
    const pillH = 24;

    this._pillBg.clear();
    this._pillBg.roundRect(mid.x - pillW / 2, mid.y - pillH / 2, pillW, pillH, pillH / 2);
    this._pillBg.fill({ color: selected ? 0xeeedfF : 0xf5f3ff, alpha: selected ? 0.96 : 0.92 });
    this._pillBg.roundRect(mid.x - pillW / 2, mid.y - pillH / 2, pillW, pillH, pillH / 2);
    this._pillBg.stroke({ width: selected ? 1.5 : 1, color: selected ? 0x6366f1 : 0x8273b4, alpha: selected ? 0.55 : 0.28 });

    this._pillText.text = data.label;
    this._pillText.position.set(mid.x, mid.y + 1);
    (this._pillText.style as TextStyle).fill = selected ? 0x4f46e5 : 0x504670;
  }

  private _dashedBezier(g: Graphics, s: Point, ca: Point, cb: Point, e: Point): void {
    const steps = 40;
    const dashLen = 8;
    const gapLen = 8;
    const total = dashLen + gapLen;
    let drawing = true;
    let accumLen = 0;
    let px = s.x, py = s.y;

    g.moveTo(px, py);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const nx = mt * mt * mt * s.x + 3 * mt * mt * t * ca.x + 3 * mt * t * t * cb.x + t * t * t * e.x;
      const ny = mt * mt * mt * s.y + 3 * mt * mt * t * ca.y + 3 * mt * t * t * cb.y + t * t * t * e.y;
      const segLen = Math.hypot(nx - px, ny - py);

      accumLen += segLen;
      const phase = accumLen % total;

      if (drawing) {
        if (phase < dashLen) {
          g.lineTo(nx, ny);
        } else {
          g.lineTo(nx, ny);
          drawing = false;
        }
      } else {
        if (phase >= dashLen) {
          g.moveTo(nx, ny);
        } else {
          g.moveTo(nx, ny);
          drawing = true;
        }
      }
      px = nx; py = ny;
    }
    g.stroke();
  }

  private _arrowHead(g: Graphics, from: Point, to: Point, color: number, alpha: number): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const sz = 10;
    g.moveTo(to.x, to.y);
    g.lineTo(to.x - sz * Math.cos(angle - Math.PI / 6), to.y - sz * Math.sin(angle - Math.PI / 6));
    g.lineTo(to.x - sz * Math.cos(angle + Math.PI / 6), to.y - sz * Math.sin(angle + Math.PI / 6));
    g.closePath();
    g.fill({ color, alpha });
  }

  sync(data: ObjectData, selection: string[]): void {
    if (data.type !== 'link') return;
    const link = data as LinkData;
    const selected = selection.includes(link.id);

    this._lastFromId = link.fromId;
    this._lastToId   = link.toId;
    this._lastLabel  = link.label;
    this._lastDirection = link.direction;
    this._lastSelected  = selected;

    this._redrawFromState(link, selected);
  }

  override spawn(): void {
    // Links don't animate spawn
    this.container.alpha = 1;
  }

  override exit(onDone?: () => void): void {
    if (this._frameTickId) {
      Ticker.shared.remove(this._frameTickId);
      this._frameTickId = null;
    }
    super.exit(onDone);
  }

  override hitTest(wx: number, wy: number): boolean {
    // Simple hit test: check if near the midpoint
    if (!this.labelWorldPosition) return false;
    const mid = this.labelWorldPosition;
    return Math.hypot(wx - mid.x, wy - mid.y) < 30;
  }
}
