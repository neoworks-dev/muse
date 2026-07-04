import { Container, Graphics, Sprite, Text, TextStyle, Texture, ImageSource, Ticker } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';
import { BaseObjectRenderer } from '../core/BaseObjectRenderer';
import type { ObjectData, BookmarkData } from '../../state.svelte';

export const BOOKMARK_W = 320;
const IMG_H  = 160;
const PAD    = 14;
const RADIUS = 12;
const FONT   = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';

export class BookmarkRenderer extends BaseObjectRenderer {
  readonly container: Container;

  private _gfx: Graphics;
  private _shadow: DropShadowFilter;
  private _imgSprite: Sprite;
  private _imgMask: Graphics;
  private _faviconSprite: Sprite;
  private _domainText: Text;
  private _titleText: Text;
  private _descText: Text;

  private _cardH = 96;
  private _hasImg = false;
  private _hasFav = false;

  private _lastTitle = '';
  private _lastDesc  = '';
  private _lastFav   = '';
  private _lastImg   = '';
  private _lastSel   = false;

  private _data: BookmarkData | null = null;
  private _hoverT = 0;
  private _hoverTarget = 0;
  private _hoverAnim = false;

  constructor(data: BookmarkData) {
    super();
    this._data = data;

    this.container = new Container();
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';

    this._shadow = new DropShadowFilter({
      offset: { x: 0, y: 3 },
      blur: 7,
      alpha: 0.08,
      color: 0x1e2328,
    });

    this._gfx = new Graphics();
    this._gfx.filters = [this._shadow];
    this.container.addChild(this._gfx);

    this._imgSprite = new Sprite();
    this._imgSprite.visible = false;
    this.container.addChild(this._imgSprite);

    this._imgMask = new Graphics();
    this.container.addChild(this._imgMask);
    this._imgSprite.mask = this._imgMask;

    this._faviconSprite = new Sprite();
    this._faviconSprite.visible = false;
    this.container.addChild(this._faviconSprite);

    this._domainText = new Text({
      text: data.domain || hostname(data.url),
      style: new TextStyle({ fontFamily: FONT, fontSize: 11, fill: 0x9ca3af }),
    });
    this.container.addChild(this._domainText);

    this._titleText = new Text({
      text: clamp(data.title, 120),
      style: new TextStyle({
        fontFamily: FONT, fontSize: 14, fontWeight: '600', fill: 0x111827,
        wordWrap: true, wordWrapWidth: BOOKMARK_W - PAD * 2,
      }),
    });
    this.container.addChild(this._titleText);

    this._descText = new Text({
      text: clamp(data.description ?? '', 200),
      style: new TextStyle({
        fontFamily: FONT, fontSize: 12, fill: 0x6b7280,
        wordWrap: true, wordWrapWidth: BOOKMARK_W - PAD * 2,
        leading: 2,
      }),
    });
    this.container.addChild(this._descText);

    this.container.on('pointerenter', () => { this._hoverTarget = 1; this._startHoverTick(); });
    this.container.on('pointerleave', () => { this._hoverTarget = 0; this._startHoverTick(); });

    this._rebuildLayout(data, false);
    this.container.pivot.set(BOOKMARK_W / 2, this._cardH / 2);
    this.container.position.set(data.x + BOOKMARK_W / 2, data.y + this._cardH / 2);

    if (data.favicon)  this._loadFavicon(data.favicon);
    if (data.imageUrl) this._loadOgImage(data.imageUrl);
  }

  private _startHoverTick(): void {
    if (this._hoverAnim) return;
    this._hoverAnim = true;
    const tick = () => {
      const diff = this._hoverTarget - this._hoverT;
      if (Math.abs(diff) < 0.002) {
        this._hoverT = this._hoverTarget;
        Ticker.shared.remove(tick);
        this._hoverAnim = false;
      } else {
        this._hoverT += diff * 0.14;
      }
      if (!this._lastSel) {
        this._shadow.blur   = 7 + 4 * this._hoverT;
        this._shadow.offset = { x: 0, y: 3 + 2 * this._hoverT };
        this._shadow.alpha  = 0.08 + 0.03 * this._hoverT;
      }
    };
    Ticker.shared.add(tick);
  }

  private _rebuildLayout(data: BookmarkData, selected: boolean): void {
    const hasImg = this._hasImg;
    const hasFav = this._hasFav;
    const contentY = hasImg ? IMG_H : 0;

    // Row 1: favicon + domain
    const row1Y = contentY + PAD;
    if (hasFav) {
      this._faviconSprite.position.set(PAD, row1Y);
      this._faviconSprite.visible = true;
      this._domainText.position.set(PAD + 20, row1Y + 1);
    } else {
      this._faviconSprite.visible = false;
      this._domainText.position.set(PAD, row1Y);
    }
    const row1H = Math.max(16, this._domainText.height);

    // Title
    this._titleText.text = clamp(data.title, 120);
    this._titleText.position.set(PAD, row1Y + row1H + 5);

    // Description
    const hasDesc = !!(data.description?.trim());
    this._descText.visible = hasDesc;
    if (hasDesc) {
      this._descText.text = clamp(data.description!, 220);
      this._descText.position.set(PAD, row1Y + row1H + 5 + this._titleText.height + 5);
    }

    const bottomPad = PAD;
    const contentBottom = hasDesc
      ? row1Y + row1H + 5 + this._titleText.height + 5 + this._descText.height + bottomPad
      : row1Y + row1H + 5 + this._titleText.height + bottomPad;

    this._cardH = hasImg ? Math.max(IMG_H + 80, contentBottom) : Math.max(72, contentBottom);

    // Card background
    const g = this._gfx;
    g.clear();
    g.roundRect(0, 0, BOOKMARK_W, this._cardH, RADIUS);
    g.fill({ color: 0xffffff });
    g.roundRect(0.5, 0.5, BOOKMARK_W - 1, this._cardH - 1, RADIUS);
    g.stroke({ width: 1, color: 0xe5e7eb });

    if (selected) {
      g.roundRect(-1, -1, BOOKMARK_W + 2, this._cardH + 2, RADIUS + 1);
      g.stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
      this._shadow.alpha  = 0.05;
      this._shadow.blur   = 6;
      this._shadow.offset = { x: 0, y: 2 };
    } else if (!this._hoverAnim) {
      this._shadow.alpha  = 0.08;
      this._shadow.blur   = 7;
      this._shadow.offset = { x: 0, y: 3 };
    }

    if (hasImg) {
      // Separator between image and content
      g.rect(0, IMG_H, BOOKMARK_W, 1);
      g.fill({ color: 0xf3f4f6 });

      // Clip image to exactly IMG_H — rounded rect at all corners looks clean
      this._imgMask.clear();
      this._imgMask.roundRect(0, 0, BOOKMARK_W, IMG_H, RADIUS);
      this._imgMask.fill({ color: 0xffffff });
    }
  }

  private _updatePivot(): void {
    const tlx = this.container.x - this.container.pivot.x;
    const tly = this.container.y - this.container.pivot.y;
    this.container.pivot.set(BOOKMARK_W / 2, this._cardH / 2);
    this.container.position.set(tlx + BOOKMARK_W / 2, tly + this._cardH / 2);
  }

  private async _loadFavicon(src: string): Promise<void> {
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      if (this.container.destroyed) return;
      this._faviconSprite.texture = new Texture({ source: new ImageSource({ resource: img }) });
      this._faviconSprite.width  = 16;
      this._faviconSprite.height = 16;
      this._hasFav = true;
      if (this._data) { this._rebuildLayout(this._data, this._lastSel); this._updatePivot(); }
    } catch {}
  }

  private async _loadOgImage(rawUrl: string): Promise<void> {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // webSecurity: false in Electron bypasses CORS
      img.src = rawUrl;
      await img.decode();
      if (this.container.destroyed) return;

      // Cover-fill: scale to fill BOOKMARK_W × IMG_H
      const nw = img.naturalWidth  || BOOKMARK_W;
      const nh = img.naturalHeight || IMG_H;
      const scale = Math.max(BOOKMARK_W / nw, IMG_H / nh);
      const sw = nw * scale;
      const sh = nh * scale;

      this._imgSprite.texture = new Texture({ source: new ImageSource({ resource: img }) });
      this._imgSprite.width   = sw;
      this._imgSprite.height  = sh;
      this._imgSprite.x       = (BOOKMARK_W - sw) / 2;
      this._imgSprite.y       = (IMG_H - sh) / 2;
      this._imgSprite.visible = true;
      this._hasImg = true;

      if (this._data) { this._rebuildLayout(this._data, this._lastSel); this._updatePivot(); }
    } catch {}
  }

  sync(data: ObjectData, selection: string[]): void {
    if (data.type !== 'bookmark') return;
    const bm = data as BookmarkData;
    const selected = selection.includes(bm.id);
    this._data = bm;

    if (bm.favicon && bm.favicon !== this._lastFav) {
      this._lastFav = bm.favicon;
      this._loadFavicon(bm.favicon);
    }
    if (bm.imageUrl && bm.imageUrl !== this._lastImg) {
      this._lastImg = bm.imageUrl;
      this._loadOgImage(bm.imageUrl);
    }

    if (
      bm.title !== this._lastTitle ||
      (bm.description ?? '') !== this._lastDesc ||
      selected !== this._lastSel
    ) {
      this._rebuildLayout(bm, selected);
      this._updatePivot();
      this._lastTitle = bm.title;
      this._lastDesc  = bm.description ?? '';
      this._lastSel   = selected;
    }

    const targetX = bm.x + BOOKMARK_W / 2;
    const targetY = bm.y + this._cardH / 2;
    if (Math.abs(this.container.x - targetX) > 0.5 || Math.abs(this.container.y - targetY) > 0.5) {
      this.container.x = targetX;
      this.container.y = targetY;
    }
  }

  get cardWidth():  number { return BOOKMARK_W; }
  get cardHeight(): number { return this._cardH; }
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
