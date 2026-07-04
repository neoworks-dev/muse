import {
  Container, Graphics, Sprite, Text, TextStyle, Texture, ImageSource, Ticker,
} from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';
import { BaseObjectRenderer } from '../core/BaseObjectRenderer';
import {
  canvas, type ObjectData, type FolderData, type MediaData,
  type DocumentData, type NoteData, type BookmarkData,
} from '../../state.svelte';
import type { CanvasRenderer } from '../core/CanvasRenderer';
import { canvasPalette, themeMode, type CanvasPalette } from '../theme-colors';

// Landscape folder card.
const CARD_W = 340;
const CARD_H = 250;
const RADIUS = 18;

// Folder tab geometry — the tab is the raised upper-left portion; the body top
// steps down to the right, where the back panel and contents peek through.
const TAB_RISE = 26;
const TAB_W = 196;
const STEP = 28;
const BACK_EXT = 7; // back panel pokes out this far on the right

// Peeking item thumbnails.
const THUMB_W = 72;
const THUMB_H = 94;
const THUMB_R = 8;

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';

const TYPE_ORDER: Record<string, number> = { media: 0, document: 1, note: 2, bookmark: 3, folder: 4 };

function typeInitial(type: string): string {
  if (type === 'media')    return 'I';
  if (type === 'document') return 'D';
  if (type === 'note')     return 'N';
  if (type === 'bookmark') return 'B';
  if (type === 'folder')   return 'F';
  return '?';
}

// Front cover outline: rounded body with a raised tab on the upper-left.
function traceFolderFront(g: Graphics): void {
  const w = CARD_W;
  const h = CARD_H;
  const r = RADIUS;

  g.moveTo(r, 0);
  g.lineTo(TAB_W - STEP, 0);
  g.bezierCurveTo(TAB_W - STEP / 2, 0, TAB_W - STEP / 2, TAB_RISE, TAB_W, TAB_RISE);
  g.lineTo(w - r, TAB_RISE);
  g.arcTo(w, TAB_RISE, w, TAB_RISE + r, r);
  g.lineTo(w, h - r);
  g.arcTo(w, h, w - r, h, r);
  g.lineTo(r, h);
  g.arcTo(0, h, 0, h - r, r);
  g.lineTo(0, r);
  g.arcTo(0, 0, r, 0, r);
  g.closePath();
}

export class FolderRenderer extends BaseObjectRenderer {
  readonly container: Container;

  private readonly _w: number;
  private readonly _h: number;
  private _shadow: DropShadowFilter;
  private _backGfx: Graphics;
  private _thumbLayer: Container;
  private _frontGfx: Graphics;
  private _frontShadow: DropShadowFilter;
  private _chipLayer: Container;
  private _pillText: Text;
  private _titleText: Text;
  private _countText: Text;
  private _textRes = window.devicePixelRatio || 1;
  private _lastTitle = '';
  private _lastExpanded: boolean | undefined = undefined;
  private _lastSelected = false;
  private _lastChildKey = '';
  private _lastTheme = '';
  private _pal: CanvasPalette = canvasPalette();
  private _disposed = false;

  private _hoverT = 0;
  private _hoverTarget = 0;
  private _hoverAnimating = false;

  // Open-progress: 0 closed, 1 fully open. Drives the front cover lifting forward.
  private _openT = 0;
  private _openTarget = 0;
  private _openAnimating = false;

  constructor(data: FolderData, _engine: CanvasRenderer) {
    super();
    this._w = CARD_W;
    this._h = CARD_H;

    this.container = new Container();
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';

    this._shadow = new DropShadowFilter({
      offset: { x: 0, y: 4 },
      blur: 8,
      alpha: 0.10,
      color: 0x1e2328,
    });

    // Back panel — carries the shadow for the whole folder silhouette.
    this._backGfx = new Graphics();
    this._backGfx.filters = [this._shadow];
    this.container.addChild(this._backGfx);

    // Real item thumbnails peeking out of the top.
    this._thumbLayer = new Container();
    this.container.addChild(this._thumbLayer);

    // Front cover with the tab. Pivots from its bottom edge so it can tilt and
    // lift forward when the folder opens, like lifting the flap of a real folder.
    this._frontGfx = new Graphics();
    this._frontShadow = new DropShadowFilter({
      offset: { x: 0, y: 0 },
      blur: 5,
      alpha: 0,
      color: this._pal.shadow,
    });
    this._frontGfx.filters = [this._frontShadow];
    this._frontGfx.pivot.set(CARD_W / 2, CARD_H);
    this._frontGfx.position.set(CARD_W / 2, CARD_H);
    this.container.addChild(this._frontGfx);

    // Item-type chips along the bottom of the front.
    this._chipLayer = new Container();
    this.container.addChild(this._chipLayer);

    this._pillText = new Text({
      text: 'Folder',
      style: new TextStyle({ fontFamily: FONT, fontSize: 12, fill: 0x7c8794, fontWeight: '500' }),
    });
    this._pillText.position.set(26, 112);
    this.container.addChild(this._pillText);

    this._titleText = new Text({
      text: '',
      style: new TextStyle({ fontFamily: FONT, fontSize: 26, fontWeight: '700', fill: 0x232b33 }),
    });
    this._titleText.position.set(26, 132);
    this.container.addChild(this._titleText);

    this._countText = new Text({
      text: '',
      style: new TextStyle({ fontFamily: FONT, fontSize: 13, fill: 0x8a949f }),
    });
    this._countText.position.set(26, 168);
    this.container.addChild(this._countText);

    this.container.on('pointerenter', () => {
      this._hoverTarget = 1;
      this._startHoverTick();
    });
    this.container.on('pointerleave', () => {
      this._hoverTarget = 0;
      this._startHoverTick();
    });

    Ticker.shared.add(this._trackZoom);

    this.container.pivot.set(this._w / 2, this._h / 2);
    this.container.position.set(data.x + this._w / 2, data.y + this._h / 2);
    this._rebuild(data, false);

    this._openT = (data.expanded ?? false) ? 1 : 0;
    this._openTarget = this._openT;
    this._lastExpanded = data.expanded ?? false;
    this._applyOpen(this._openT);
  }

  // Fold the front cover down around its bottom edge — it foreshortens (scaleY
  // collapses) and tucks down, like folding the flap of a real folder open.
  private _applyOpen(t: number): void {
    const drop = 6 * t;
    const foldY = 1 - 0.16 * t;
    this._frontGfx.position.set(CARD_W / 2, CARD_H + drop);
    this._frontGfx.scale.set(1, foldY);
    this._frontShadow.alpha = 0.10 * t;
    this._frontShadow.offset = { x: 0, y: 3 * t };
    this._thumbLayer.alpha = 1 - t;
    this._chipLayer.alpha = 1 - t;
  }

  private _startOpenTick(): void {
    if (this._openAnimating) return;
    this._openAnimating = true;
    const tick = () => {
      if (this._disposed) {
        Ticker.shared.remove(tick);
        this._openAnimating = false;
        return;
      }
      const diff = this._openTarget - this._openT;
      if (Math.abs(diff) < 0.002) {
        this._openT = this._openTarget;
        this._applyOpen(this._openT);
        Ticker.shared.remove(tick);
        this._openAnimating = false;
      } else {
        this._openT += diff * 0.16;
        this._applyOpen(this._openT);
      }
    };
    Ticker.shared.add(tick);
  }

  private _trackZoom = (): void => {
    const zoom = this.container.parent?.scale.x ?? 1;
    const dpr  = window.devicePixelRatio || 1;
    const target = zoom <= 1 ? dpr : zoom <= 2 ? dpr * 2 : dpr * 4;
    if (target !== this._textRes) {
      this._textRes = target;
      this._pillText.resolution  = target;
      this._titleText.resolution = target;
      this._countText.resolution = target;
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

  private _getChildren(data: FolderData): ObjectData[] {
    return (canvas.objects as ObjectData[]).filter(
      o => o.type !== 'link' && ('parentId' in o) && (o as { parentId?: string }).parentId === data.id
    );
  }

  // A stable signature of the children so we only rebuild thumbnails when the
  // contained set actually changes.
  private _childKey(children: ObjectData[]): string {
    return children.map(c => `${c.type}:${c.id}`).join('|');
  }

  private _thumbBaseColor(type: string): number {
    if (type === 'media')    return this._pal.mediaThumb;
    if (type === 'note')     return this._pal.noteThumb;
    if (type === 'folder')   return this._pal.folderThumb;
    return this._pal.page; // document, bookmark
  }

  // Builds a small render of a single contained item.
  private _buildThumb(child: ObjectData): Container {
    const c = new Container();

    const card = new Graphics();
    card.roundRect(0, 0, THUMB_W, THUMB_H, THUMB_R);
    card.fill({ color: this._thumbBaseColor(child.type) });
    card.roundRect(0, 0, THUMB_W, THUMB_H, THUMB_R);
    card.setStrokeStyle({ width: 1, color: this._pal.thumbBorder, alpha: 0.9 });
    card.stroke();
    c.addChild(card);

    if (child.type === 'media') {
      this._fillMediaThumb(c, child as MediaData);
    } else if (child.type === 'document') {
      this._fillDocumentThumb(c, child as DocumentData);
    } else if (child.type === 'note') {
      this._fillNoteThumb(c, child as NoteData);
    } else if (child.type === 'bookmark') {
      this._fillBookmarkThumb(c, child as BookmarkData);
    }

    c.pivot.set(THUMB_W / 2, THUMB_H / 2);
    return c;
  }

  private _fillMediaThumb(c: Container, media: MediaData): void {
    if (!media.src || media.mediaType === 'pdf') return;
    const sprite = new Sprite();
    const mask = new Graphics();
    mask.roundRect(1, 1, THUMB_W - 2, THUMB_H - 2, THUMB_R - 1);
    mask.fill({ color: 0xffffff });
    sprite.mask = mask;
    c.addChild(sprite);
    c.addChild(mask);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (this._disposed || sprite.destroyed) return;
      sprite.texture = new Texture({ source: new ImageSource({ resource: img }) });
      const scale = Math.max(THUMB_W / sprite.texture.width, THUMB_H / sprite.texture.height);
      sprite.scale.set(scale);
      sprite.position.set((THUMB_W - sprite.width) / 2, (THUMB_H - sprite.height) / 2);
    };
    img.src = media.src;
  }

  private _fillDocumentThumb(c: Container, doc: DocumentData): void {
    const title = new Text({
      text: doc.title?.trim() || 'Untitled',
      style: new TextStyle({
        fontFamily: FONT, fontSize: 9, fontWeight: '600', fill: this._pal.pageText,
        wordWrap: true, wordWrapWidth: THUMB_W - 16,
      }),
    });
    title.position.set(8, 9);
    c.addChild(title);

    const lines = new Graphics();
    for (let i = 0; i < 5; i++) {
      const y = 34 + i * 11;
      lines.roundRect(8, y, THUMB_W - 16 - (i === 4 ? 18 : 0), 3, 1.5);
    }
    lines.fill({ color: this._pal.pageRule });
    c.addChild(lines);
  }

  private _fillNoteThumb(c: Container, note: NoteData): void {
    const body = note.body?.trim() || '';
    const text = new Text({
      text: body.slice(0, 60),
      style: new TextStyle({
        fontFamily: FONT, fontSize: 9, fill: themeMode() === 'dark' ? 0xd8cfa0 : 0x6b6024,
        wordWrap: true, wordWrapWidth: THUMB_W - 14,
        lineHeight: 12,
      }),
    });
    text.position.set(7, 8);
    c.addChild(text);
  }

  private _fillBookmarkThumb(c: Container, bookmark: BookmarkData): void {
    const dot = new Graphics();
    dot.roundRect(8, 8, THUMB_W - 16, 30, 5);
    dot.fill({ color: this._pal.folderBack });
    c.addChild(dot);

    const domain = new Text({
      text: bookmark.domain || bookmark.title || 'link',
      style: new TextStyle({
        fontFamily: FONT, fontSize: 8, fill: this._pal.folderPill,
        wordWrap: true, wordWrapWidth: THUMB_W - 14,
      }),
    });
    domain.position.set(7, 44);
    c.addChild(domain);
  }

  // Fan of peeking thumbnails in the top-right, rising above the folder top.
  private _rebuildThumbs(children: ObjectData[]): void {
    this._thumbLayer.removeChildren().forEach(t => t.destroy({ children: true }));
    if (children.length === 0) return;

    const fan = [
      { cx: CARD_W * 0.60, cy: 34, rot: -9 },
      { cx: CARD_W * 0.72, cy: 24, rot: -1 },
      { cx: CARD_W * 0.84, cy: 32, rot: 8 },
    ];
    const count = Math.min(children.length, fan.length);
    for (let i = count - 1; i >= 0; i--) {
      const thumb = this._buildThumb(children[i]);
      const cfg = fan[i];
      thumb.position.set(cfg.cx, cfg.cy);
      thumb.rotation = (cfg.rot * Math.PI) / 180;
      this._thumbLayer.addChild(thumb);
    }
  }

  // Item-type chips along the bottom, with a "+N" overflow chip.
  private _rebuildChips(children: ObjectData[]): void {
    this._chipLayer.removeChildren().forEach(t => t.destroy({ children: true }));
    if (children.length === 0) return;

    const sorted = [...children].sort(
      (a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)
    );
    const shown = Math.min(sorted.length, 3);
    const chipSize = 42;
    const gap = 10;
    const y = CARD_H - chipSize - 22;

    for (let i = 0; i < shown; i++) {
      const chip = this._buildChip(typeInitial(sorted[i].type), false);
      chip.position.set(26 + i * (chipSize + gap), y);
      this._chipLayer.addChild(chip);
    }

    const remaining = children.length - shown;
    if (remaining > 0) {
      const chip = this._buildChip(`+${remaining}`, true);
      chip.position.set(26 + shown * (chipSize + gap), y);
      this._chipLayer.addChild(chip);
    }
  }

  private _buildChip(label: string, overflow: boolean): Container {
    const chipSize = 42;
    const c = new Container();
    const g = new Graphics();
    g.roundRect(0, 0, chipSize, chipSize, 11);
    g.fill({ color: overflow ? this._pal.chipOverflowBg : this._pal.chipBg });
    g.roundRect(0, 0, chipSize, chipSize, 11);
    g.setStrokeStyle({ width: 1, color: this._pal.thumbBorder, alpha: 0.9 });
    g.stroke();
    c.addChild(g);

    const t = new Text({
      text: label,
      style: new TextStyle({
        fontFamily: FONT,
        fontSize: overflow ? 13 : 15,
        fontWeight: '600',
        fill: overflow ? this._pal.chipOverflowText : this._pal.chipText,
      }),
    });
    t.anchor.set(0.5);
    t.position.set(chipSize / 2, chipSize / 2);
    c.addChild(t);
    return c;
  }

  private _rebuild(data: FolderData, selected: boolean): void {
    this._pal = canvasPalette();
    const pal = this._pal;
    const w = this._w;
    const h = this._h;
    const expanded = data.expanded ?? false;
    const children = this._getChildren(data);
    const childCount = children.length;

    // Back panel — full silhouette, slightly wider so it pokes out on the right.
    const back = this._backGfx;
    back.clear();
    back.roundRect(0, 0, w + BACK_EXT, h, RADIUS);
    back.fill({ color: pal.folderBack });

    // Bookmark accent poking out the right edge.
    back.roundRect(w - 4, h * 0.52, 22, 70, 5);
    back.fill({ color: pal.accent });

    // Peek-thumbnails are always built; the open animation fades them out.
    this._rebuildThumbs(children);
    this._rebuildChips(children);

    // Front cover with the tab.
    const front = this._frontGfx;
    front.clear();
    traceFolderFront(front);
    front.fill({ color: pal.folderFront });

    if (selected) {
      back.roundRect(-1.5, -1.5, w + BACK_EXT + 3, h + 3, RADIUS + 1.5);
      back.setStrokeStyle({ width: 2, color: themeMode() === 'dark' ? 0x6f7a86 : 0xffffff, alpha: 0.95 });
      back.stroke();
      this._shadow.color  = 0x232d32;
      this._shadow.alpha  = 0.06;
      this._shadow.offset = { x: 0, y: 2 };
      this._shadow.blur   = 7;
    } else {
      this._shadow.color  = 0x1e2328;
      this._shadow.alpha  = 0.10;
      this._shadow.offset = { x: 0, y: 4 };
      this._shadow.blur   = 8;
    }

    this._pillText.style.fill = pal.folderPill;
    this._titleText.style.fill = pal.folderTitle;
    this._countText.style.fill = pal.folderCount;
    this._pillText.text = expanded ? 'Open folder' : 'Folder';
    this._titleText.text = data.title;
    this._countText.text = `${childCount} item${childCount !== 1 ? 's' : ''}`;
  }

  sync(data: ObjectData, selection: string[]): void {
    if (data.type !== 'folder') return;
    const folder = data as FolderData;
    const selected = selection.includes(folder.id);
    const expanded = folder.expanded ?? false;
    const childKey = this._childKey(this._getChildren(folder));
    const mode = themeMode();

    const needsRebuild = folder.title !== this._lastTitle
      || selected !== this._lastSelected
      || childKey !== this._lastChildKey
      || mode !== this._lastTheme;

    if (needsRebuild) {
      this._rebuild(folder, selected);
      this._lastTitle    = folder.title;
      this._lastSelected = selected;
      this._lastChildKey = childKey;
      this._lastTheme    = mode;
      // Rebuild resets the front transform and thumbnail alpha; restore open state.
      this._applyOpen(this._openT);
    }

    // Animate the cover lifting open / settling closed when the state flips.
    if (expanded !== this._lastExpanded) {
      this._lastExpanded = expanded;
      this._openTarget = expanded ? 1 : 0;
      this._pillText.text = expanded ? 'Open folder' : 'Folder';
      this._startOpenTick();
    }

    const targetX = folder.x + this._w / 2;
    const targetY = folder.y + this._h / 2;
    if (Math.abs(this.container.x - targetX) > 0.5 || Math.abs(this.container.y - targetY) > 0.5) {
      this.container.x = targetX;
      this.container.y = targetY;
    }
  }

  override exit(onDone?: () => void): void {
    this._disposed = true;
    Ticker.shared.remove(this._trackZoom);
    super.exit(onDone);
  }

  get cardWidth(): number  { return this._w; }
  get cardHeight(): number { return this._h; }
}
