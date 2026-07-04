import { Container, Graphics, Sprite, Texture, ImageSource, VideoSource, CanvasSource, Ticker } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';
import { BaseObjectRenderer } from '../core/BaseObjectRenderer';
import type { ObjectData, MediaData } from '../../state.svelte';
import type { CanvasRenderer } from '../core/CanvasRenderer';
import { easeOutCubic } from '../utils/easing';
import { updateObject } from '../../actions.svelte';
import { isMediaSentinel, resolveMediaUrl } from '../../media';

const MAX_W = 480;
const MAX_H = 360;
const RADIUS = 12;
const MIN_DIM = 80;

const INSET = 14;
const HIT_LOCAL = 22;
const HANDLE_DOT_R = 5;
const FADE_START = 75;
const FADE_FULL = 32;

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize', w: 'w-resize',
  e: 'e-resize', sw: 'sw-resize', s: 's-resize', se: 'se-resize'
};

export class MediaRenderer extends BaseObjectRenderer {
  readonly container: Container;

  private _gfx: Graphics;
  private _sprite: Sprite;
  private _mask: Graphics;
  private _handleGfx: Graphics;
  private _shadow: DropShadowFilter;
  private _cardW: number;
  private _cardH: number;
  private _videoEl: HTMLVideoElement | null = null;
  private _gifImg: HTMLImageElement | null = null;
  private _gifSource: CanvasSource | null = null;
  private _gifTick: (() => void) | null = null;
  private _gifPlaying = false;
  private _resizeStart: { w: number; h: number; tlx: number; tly: number } | null = null;
  private _handleAlphas: Partial<Record<ResizeHandle, number>> = {};
  private _lastSelected = false;
  private _lastW = 0;
  private _lastH = 0;
  private _hoverT = 0;
  private _hoverTarget = 0;
  private _hoverAnimating = false;
  private _objectId = '';
  private _engine: CanvasRenderer;

  // Animated resize (undo/redo)
  private _sizeAnim: {
    startW: number; startH: number; startTlx: number; startTly: number;
    endW: number; endH: number; endTlx: number; endTly: number;
    start: number; dur: number;
  } | null = null;
  private _sizeTickActive = false;

  constructor(data: MediaData, engine: CanvasRenderer) {
    super();
    this._engine = engine;
    this._objectId = data.id;
    this._cardW = data.w ?? MAX_W;
    this._cardH = data.h ?? MAX_H;

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

    this._sprite = new Sprite();
    this._sprite.visible = false;
    this.container.addChild(this._sprite);

    this._mask = new Graphics();
    this.container.addChild(this._mask);
    this._sprite.mask = this._mask;

    this._handleGfx = new Graphics();
    this._handleGfx.eventMode = 'none';
    this.container.addChild(this._handleGfx);

    this.container.on('pointerenter', () => {
      this._hoverTarget = 1;
      this._startHoverTick();
      this._startGif();
    });
    this.container.on('pointerleave', () => {
      this._hoverTarget = 0;
      this._startHoverTick();
      if (!this._lastSelected) this._stopGif();
    });

    this._rebuild();

    if (data.mediaType === 'video') {
      this._loadVideo(data.src);
    } else if (data.mediaType === 'gif') {
      this._loadGif(data.src);
    } else if (data.mediaType === 'pdf') {
      this._loadPdf(data.src);
    } else {
      this._loadImageSrc(data);
    }
  }

  // Resolve encrypted-media sentinels (media:{id}) via the Vault before loading.
  private async _loadImageSrc(data: MediaData): Promise<void> {
    if (isMediaSentinel(data.src) && data.manifest) {
      try {
        const url = await resolveMediaUrl(data.manifest);
        if (this.container.destroyed) return;
        await this._loadImage(url);
      } catch {
        // placeholder remains
      }
      return;
    }
    await this._loadImage(data.src);
  }

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
      if (!this._lastSelected) {
        this._shadow.blur = 8 + 4 * this._hoverT;
        this._shadow.offset = { x: 0, y: 4 + 3 * this._hoverT };
        this._shadow.alpha = 0.10 + 0.03 * this._hoverT;
      }
    };
    Ticker.shared.add(tick);
  }

  private _rebuildDraw(): void {
    const w = this._cardW, h = this._cardH;
    const g = this._gfx;
    g.clear();
    g.roundRect(0, 0, w, h, RADIUS);
    g.fill({ color: 0x1a1a1a });
    if (this._lastSelected) {
      g.roundRect(-1, -1, w + 2, h + 2, RADIUS + 1);
      g.stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
    }
    this._mask.clear();
    this._mask.roundRect(0, 0, w, h, RADIUS);
    this._mask.fill({ color: 0xffffff });
    this._sprite.width = w;
    this._sprite.height = h;
    this._drawHandles();
  }

  private _rebuild(): void {
    this._rebuildDraw();
    const w = this._cardW, h = this._cardH;
    const tlx = this.container.x - this.container.pivot.x;
    const tly = this.container.y - this.container.pivot.y;
    this.container.pivot.set(w / 2, h / 2);
    this.container.position.set(tlx + w / 2, tly + h / 2);
  }

  private _getHandlePositions(): Record<ResizeHandle, [number, number]> {
    const w = this._cardW, h = this._cardH, I = INSET;
    return {
      nw: [I, I], n: [w / 2, I], ne: [w - I, I], e: [w - I, h / 2],
      se: [w - I, h - I], s: [w / 2, h - I], sw: [I, h - I], w: [I, h / 2]
    };
  }

  private _drawHandles(): void {
    const g = this._handleGfx;
    g.clear();
    if (!this._lastSelected) return;
    const positions = this._getHandlePositions();
    for (const [handle, [hx, hy]] of Object.entries(positions) as [ResizeHandle, [number, number]][]) {
      const alpha = this._handleAlphas[handle] ?? 0;
      if (alpha <= 0) continue;
      g.circle(hx, hy, HANDLE_DOT_R);
      g.fill({ color: 0x1a1a1a, alpha });
      g.circle(hx, hy, HANDLE_DOT_R);
      g.stroke({ width: 2, color: 0xffffff, alpha, cap: 'round' });
    }
  }

  updateHandleProximity(wx: number, wy: number): ResizeHandle | null {
    if (!this._lastSelected) return null;
    const localX = this.container.pivot.x + (wx - this.container.x) / this.container.scale.x;
    const localY = this.container.pivot.y + (wy - this.container.y) / this.container.scale.y;
    const positions = this._getHandlePositions();
    let hovered: ResizeHandle | null = null;
    let minDist = Infinity;
    let dirty = false;

    for (const [handle, [hx, hy]] of Object.entries(positions) as [ResizeHandle, [number, number]][]) {
      const dist = Math.hypot(localX - hx, localY - hy);
      const newAlpha = dist <= FADE_FULL ? 1 : dist >= FADE_START ? 0 : 1 - (dist - FADE_FULL) / (FADE_START - FADE_FULL);
      const rh = handle as ResizeHandle;
      const prev = this._handleAlphas[rh] ?? 0;
      if (Math.abs(newAlpha - prev) > 0.005) { this._handleAlphas[rh] = newAlpha; dirty = true; }
      if (dist < minDist && newAlpha > 0) { minDist = dist; hovered = rh; }
    }
    if (dirty) this._drawHandles();
    return hovered;
  }

  getHandleAt(wx: number, wy: number): ResizeHandle | null {
    if (!this._lastSelected) return null;
    const localX = this.container.pivot.x + (wx - this.container.x) / this.container.scale.x;
    const localY = this.container.pivot.y + (wy - this.container.y) / this.container.scale.y;
    const positions = this._getHandlePositions();
    for (const [handle, [hx, hy]] of Object.entries(positions) as [ResizeHandle, [number, number]][]) {
      if (Math.hypot(localX - hx, localY - hy) < HIT_LOCAL) return handle;
    }
    return null;
  }

  beginResize(): void {
    const tlx = this.container.x - this.container.pivot.x;
    const tly = this.container.y - this.container.pivot.y;
    this._resizeStart = { w: this._cardW, h: this._cardH, tlx, tly };
  }

  applyResize(handle: ResizeHandle, dwWorld: number, dhWorld: number, shiftKey = false): void {
    if (!this._resizeStart) return;
    const { w: w0, h: h0, tlx: tlx0, tly: tly0 } = this._resizeStart;
    const brx0 = tlx0 + w0;
    const bry0 = tly0 + h0;
    let newW = w0, newH = h0, newTlx = tlx0, newTly = tly0;

    switch (handle) {
      case 'se': newW = Math.max(MIN_DIM, w0 + dwWorld); newH = Math.max(MIN_DIM, h0 + dhWorld); break;
      case 'sw': newW = Math.max(MIN_DIM, w0 - dwWorld); newH = Math.max(MIN_DIM, h0 + dhWorld); newTlx = brx0 - newW; break;
      case 'ne': newW = Math.max(MIN_DIM, w0 + dwWorld); newH = Math.max(MIN_DIM, h0 - dhWorld); newTly = bry0 - newH; break;
      case 'nw': newW = Math.max(MIN_DIM, w0 - dwWorld); newH = Math.max(MIN_DIM, h0 - dhWorld); newTlx = brx0 - newW; newTly = bry0 - newH; break;
      case 'n': newH = Math.max(MIN_DIM, h0 - dhWorld); newTly = bry0 - newH; break;
      case 's': newH = Math.max(MIN_DIM, h0 + dhWorld); break;
      case 'e': newW = Math.max(MIN_DIM, w0 + dwWorld); break;
      case 'w': newW = Math.max(MIN_DIM, w0 - dwWorld); newTlx = brx0 - newW; break;
    }

    if (shiftKey && ['nw','ne','sw','se'].includes(handle)) {
      const ar = w0 / h0;
      const wScale = Math.abs(newW - w0) / w0;
      const hScale = Math.abs(newH - h0) / h0;
      if (wScale >= hScale) {
        const ch = Math.max(MIN_DIM, newW / ar);
        if (handle === 'nw' || handle === 'ne') newTly = bry0 - ch;
        newH = ch;
      } else {
        const cw = Math.max(MIN_DIM, newH * ar);
        if (handle === 'nw' || handle === 'sw') newTlx = brx0 - cw;
        newW = cw;
      }
    }

    this._cardW = newW;
    this._cardH = newH;
    this.container.pivot.set(newW / 2, newH / 2);
    this.container.position.set(newTlx + newW / 2, newTly + newH / 2);
    this._rebuildDraw();

    // Update state
    updateObject(this._objectId, { w: newW, h: newH, x: newTlx, y: newTly } as Partial<MediaData>);
  }

  private _fitDimensions(nw: number, nh: number): void {
    const scale = Math.min(1, MAX_W / nw, MAX_H / nh);
    this._cardW = Math.round(nw * scale);
    this._cardH = Math.round(nh * scale);
  }

  private async _loadImage(src: string): Promise<void> {
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      if (this.container.destroyed) return;
      this._fitDimensions(img.naturalWidth, img.naturalHeight);
      const source = new ImageSource({ resource: img });
      this._sprite.texture = new Texture({ source });
      this._sprite.visible = true;
      this._rebuild();
      updateObject(this._objectId, { w: this._cardW, h: this._cardH } as Partial<MediaData>);
    } catch {
      // placeholder remains
    }
  }

  private _loadVideo(src: string): void {
    const video = document.createElement('video');
    video.src = src; video.loop = true; video.muted = true; video.playsInline = true;
    this._videoEl = video;
    video.addEventListener('loadedmetadata', () => {
      if (this.container.destroyed) return;
      this._fitDimensions(video.videoWidth || MAX_W, video.videoHeight || MAX_H);
      // Create VideoSource after loadedmetadata so load() sees isValid=true and never calls video.load()
      const source = new VideoSource({ resource: video, autoPlay: false });
      this._sprite.texture = new Texture({ source });
      this._sprite.visible = true;
      this._rebuild();
      if (this._lastSelected) video.play().catch(() => {});
      updateObject(this._objectId, { w: this._cardW, h: this._cardH } as Partial<MediaData>);
    });
  }

  private _loadGif(src: string): void {
    const img = new Image();
    // opacity:0.001 keeps element painted so Chrome advances GIF frames (visibility:hidden stops them)
    img.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0.001;pointer-events:none;';
    document.body.appendChild(img);
    img.onload = () => {
      if (this.container.destroyed) { img.remove(); return; }
      const offscreen = document.createElement('canvas');
      offscreen.width = img.naturalWidth;
      offscreen.height = img.naturalHeight;
      const ctx = offscreen.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const source = new CanvasSource({ resource: offscreen });
      this._sprite.texture = new Texture({ source });
      this._gifImg = img;
      this._gifSource = source;
      this._fitDimensions(img.naturalWidth, img.naturalHeight);
      this._sprite.visible = true;
      this._rebuild();
      updateObject(this._objectId, { w: this._cardW, h: this._cardH } as Partial<MediaData>);
      this._gifTick = () => {
        if (this.container.destroyed) { this._stopGif(); return; }
        ctx.clearRect(0, 0, offscreen.width, offscreen.height);
        ctx.drawImage(img, 0, 0);
        source.update();
      };
      if (this._hoverTarget > 0 || this._lastSelected) this._startGif();
    };
    img.src = src;
  }

  private _startGif(): void {
    if (this._gifPlaying || !this._gifTick) return;
    this._gifPlaying = true;
    Ticker.shared.add(this._gifTick);
  }

  private _stopGif(): void {
    if (!this._gifPlaying || !this._gifTick) return;
    this._gifPlaying = false;
    Ticker.shared.remove(this._gifTick);
    // Redraw current frame so texture isn't stale
    if (this._gifImg && this._gifSource) {
      const src = this._gifSource.resource as HTMLCanvasElement;
      const ctx = src.getContext('2d')!;
      ctx.clearRect(0, 0, src.width, src.height);
      ctx.drawImage(this._gifImg, 0, 0);
      this._gifSource.update();
    }
  }

  private async _loadPdf(src: string): Promise<void> {
    try {
      const pdfjs = await import('pdfjs-dist');
      const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      // Decode data URL to ArrayBuffer without re-fetching
      const base64 = src.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const pdf = await pdfjs.getDocument({ data: bytes }).promise;
      if (this.container.destroyed) return;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise;
      if (this.container.destroyed) return;
      this._fitDimensions(canvas.width, canvas.height);
      const source = new CanvasSource({ resource: canvas });
      this._sprite.texture = new Texture({ source });
      this._sprite.visible = true;
      this._rebuild();
      updateObject(this._objectId, { w: this._cardW, h: this._cardH } as Partial<MediaData>);
    } catch {
      // placeholder remains
    }
  }

  private _sizeTick = (): void => {
    const a = this._sizeAnim;
    if (!a) { Ticker.shared.remove(this._sizeTick); this._sizeTickActive = false; return; }
    const t = Math.min(1, (performance.now() - a.start) / a.dur);
    const e = easeOutCubic(t);
    this._cardW = a.startW + (a.endW - a.startW) * e;
    this._cardH = a.startH + (a.endH - a.startH) * e;
    const tlx = a.startTlx + (a.endTlx - a.startTlx) * e;
    const tly = a.startTly + (a.endTly - a.startTly) * e;
    this.container.pivot.set(this._cardW / 2, this._cardH / 2);
    this.container.position.set(tlx + this._cardW / 2, tly + this._cardH / 2);
    this._rebuildDraw();
    if (t >= 1) { this._sizeAnim = null; Ticker.shared.remove(this._sizeTick); this._sizeTickActive = false; this._rebuild(); }
  };

  sync(data: ObjectData, selection: string[]): void {
    if (data.type !== 'media') return;
    const media = data as MediaData;
    const selected = selection.includes(media.id);
    const w = media.w ?? this._cardW;
    const h = media.h ?? this._cardH;

    if (selected !== this._lastSelected) {
      if (!selected) { this._handleAlphas = {}; this._resizeStart = null; }
      this._lastSelected = selected;
      this._rebuildDraw();
      if (selected) {
        this._shadow.color = 0x232d32; this._shadow.alpha = 0.06;
        this._shadow.blur = 7; this._shadow.offset = { x: 0, y: 2 };
        this._videoEl?.play().catch(() => {});
        this._startGif();
      } else {
        this._shadow.color = 0x1e2328; this._shadow.alpha = 0.10;
        this._shadow.blur = 8; this._shadow.offset = { x: 0, y: 4 };
        this._videoEl?.pause();
        if (this._hoverTarget === 0) this._stopGif();
      }
    }

    // Sync size if changed externally
    if (w !== this._lastW || h !== this._lastH) {
      this._cardW = w; this._cardH = h;
      this._rebuild();
      this._lastW = w; this._lastH = h;
    }

    // Sync position
    const targetX = media.x + this._cardW / 2;
    const targetY = media.y + this._cardH / 2;
    if (Math.abs(this.container.x - targetX) > 0.5 || Math.abs(this.container.y - targetY) > 0.5) {
      this.container.x = targetX;
      this.container.y = targetY;
    }
  }

  override exit(onDone?: () => void): void {
    if (this._videoEl) { this._videoEl.pause(); this._videoEl.src = ''; this._videoEl = null; }
    this._stopGif();
    this._gifImg?.remove();
    this._gifImg = null; this._gifSource = null; this._gifTick = null;
    super.exit(onDone);
  }

  get cardWidth(): number  { return this._cardW; }
  get cardHeight(): number { return this._cardH; }
}
