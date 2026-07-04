import { Container, Graphics, Text, TextStyle, CanvasTextMetrics, Ticker } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';
import { BaseObjectRenderer } from '../core/BaseObjectRenderer';
import type { ObjectData, NoteData } from '../../state.svelte';
import { canvasPalette, themeMode, type CanvasPalette } from '../theme-colors';

export const NOTE_FONT_FAMILY = "'Caveat', 'Segoe Print', 'Comic Sans MS', cursive";
export const NOTE_FONT_SIZE = 22;
export const NOTE_LINE_HEIGHT = 26;
export const NOTE_PAD = 14;
export const NOTE_MAX_WIDTH = 480;
export const NOTE_MIN_WIDTH = 80;

const RADIUS = 10;

const _styleOpts = {
  fontFamily: NOTE_FONT_FAMILY,
  fontSize: NOTE_FONT_SIZE,
  fontWeight: '600' as const,
  fill: 'rgba(50, 45, 35, 0.9)',
  wordWrap: true,
  wordWrapWidth: NOTE_MAX_WIDTH - NOTE_PAD * 2,
  lineHeight: NOTE_LINE_HEIGHT,
  breakWords: false
};

function resolutionForZoom(zoom: number): number {
  const dpr = window.devicePixelRatio || 1;
  if (zoom <= 1) return dpr;
  if (zoom <= 2) return dpr * 2;
  return dpr * 4;
}

export class NoteRenderer extends BaseObjectRenderer {
  readonly container: Container;

  private _gfx: Graphics;
  private _textObj: Text;
  private _shadow: DropShadowFilter;
  private _cardW = NOTE_MIN_WIDTH;
  private _cardH = NOTE_LINE_HEIGHT + NOTE_PAD * 2;
  private _textRes = resolutionForZoom(1);
  private _lastBody = '';
  private _lastSelected = false;
  private _lastTheme = '';
  private _pal: CanvasPalette = canvasPalette();
  private _hoverT = 0;
  private _hoverTarget = 0;
  private _hoverAnimating = false;

  constructor(data: NoteData) {
    super();
    this.container = new Container();
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';

    this._shadow = new DropShadowFilter({
      offset: { x: 0, y: 4 },
      blur: 8,
      alpha: 0.10,
      color: 0x1e2328
    });

    this._gfx = new Graphics();
    this._gfx.filters = [this._shadow];
    this.container.addChild(this._gfx);

    this._textObj = new Text({
      text: '',
      style: new TextStyle(_styleOpts),
      resolution: this._textRes
    });
    this._textObj.position.set(NOTE_PAD, NOTE_PAD);
    this.container.addChild(this._textObj);

    this.container.on('pointerenter', () => {
      this._hoverTarget = 1;
      this._startHoverTick();
    });
    this.container.on('pointerleave', () => {
      this._hoverTarget = 0;
      this._startHoverTick();
    });

    Ticker.shared.add(this._trackZoom);
    this._rebuild(data.body, false);
    this._applyPosition(data);
  }

  private _trackZoom = (): void => {
    const zoom = this.container.parent?.scale.x ?? 1;
    const target = resolutionForZoom(zoom);
    if (target !== this._textRes) {
      this._textRes = target;
      this._textObj.resolution = target;
    }
  };

  private _startHoverTick(): void {
    if (this._hoverAnimating) return;
    this._hoverAnimating = true;
    const tick = () => {
      const diff = this._hoverTarget - this._hoverT;
      if (Math.abs(diff) < 0.002) {
        this._hoverT = this._hoverTarget;
        Ticker.shared.remove(tick);
        this._hoverAnimating = false;
      } else {
        this._hoverT += diff * 0.14;
      }
      this.applyHoverScale(Math.max(this._hoverT, this._lastSelected ? 1 : 0));
      if (!this._lastSelected) {
        this._shadow.blur = 8 + 4 * this._hoverT;
        this._shadow.offset = { x: 0, y: 4 + 3 * this._hoverT };
        this._shadow.alpha = 0.10 + 0.03 * this._hoverT;
      }
    };
    Ticker.shared.add(tick);
  }

  private _applyPosition(data: NoteData) {
    this.container.pivot.set(this._cardW / 2, this._cardH / 2);
    this.container.position.set(data.x + this._cardW / 2, data.y + this._cardH / 2);
  }

  private _rebuild(body: string, selected: boolean): void {
    this._pal = canvasPalette();
    const raw = body;
    const displayText = raw || ' ';

    const noWrapStyle = new TextStyle({ ..._styleOpts, wordWrap: false });
    const noWrapMetrics = CanvasTextMetrics.measureText(displayText, noWrapStyle);

    if (noWrapMetrics.width + NOTE_PAD * 2 <= NOTE_MAX_WIDTH) {
      this._cardW = Math.max(NOTE_MIN_WIDTH, Math.ceil(noWrapMetrics.width + NOTE_PAD * 2));
      this._cardH = Math.ceil(noWrapMetrics.height + NOTE_PAD * 2);
      this._textObj.style = new TextStyle({ ..._styleOpts, wordWrap: false });
    } else {
      const wrapStyle = new TextStyle({
        ..._styleOpts,
        wordWrap: true,
        wordWrapWidth: NOTE_MAX_WIDTH - NOTE_PAD * 2
      });
      const wrapMetrics = CanvasTextMetrics.measureText(displayText, wrapStyle);
      this._cardW = NOTE_MAX_WIDTH;
      this._cardH = Math.ceil(wrapMetrics.height + NOTE_PAD * 2);
      this._textObj.style = wrapStyle;
    }

    this._textObj.text = raw;
    this._textObj.style.fill = this._pal.noteText;

    const g = this._gfx;
    g.clear();
    g.roundRect(0, 0, this._cardW, this._cardH, RADIUS);
    g.fill({ color: this._pal.noteCard });

    const dark = themeMode() === 'dark';
    if (selected) {
      g.roundRect(-1, -1, this._cardW + 2, this._cardH + 2, RADIUS + 1);
      g.setStrokeStyle({ width: 2, color: dark ? 0x6f7a86 : 0xffffff, alpha: 0.85 });
      g.stroke();
      this._shadow.color = 0x232d32;
      this._shadow.alpha = 0.06;
      this._shadow.offset = { x: 0, y: 2 };
      this._shadow.blur = 7;
    } else {
      this._shadow.color = 0x1e2328;
      this._shadow.alpha = 0.10;
      this._shadow.offset = { x: 0, y: 4 };
      this._shadow.blur = 8;
    }

    this._textObj.position.set(NOTE_PAD, NOTE_PAD);
  }

  sync(data: ObjectData, selection: string[]): void {
    if (data.type !== 'note') return;
    const note = data as NoteData;
    const selected = selection.includes(note.id);

    const mode = themeMode();
    const bodyChanged  = note.body !== this._lastBody;
    const selChanged   = selected !== this._lastSelected;
    const themeChanged = mode !== this._lastTheme;

    if (bodyChanged || selChanged || themeChanged) {
      this._lastTheme = mode;
      this._rebuild(note.body, selected);
      // Update pivot + position when card size changes
      const tlx = this.container.x - this.container.pivot.x;
      const tly = this.container.y - this.container.pivot.y;
      this.container.pivot.set(this._cardW / 2, this._cardH / 2);
      this.container.x = tlx + this._cardW / 2;
      this.container.y = tly + this._cardH / 2;
      this._lastBody = note.body;
      this._lastSelected = selected;
    }

    // Sync position (world TL → pivot-space position)
    const targetX = note.x + this._cardW / 2;
    const targetY = note.y + this._cardH / 2;
    if (Math.abs(this.container.x - targetX) > 0.5 || Math.abs(this.container.y - targetY) > 0.5) {
      this.container.x = targetX;
      this.container.y = targetY;
    }
  }

  override exit(onDone?: () => void): void {
    Ticker.shared.remove(this._trackZoom);
    super.exit(onDone);
  }

  get cardWidth(): number { return this._cardW; }
  get cardHeight(): number { return this._cardH; }
}
