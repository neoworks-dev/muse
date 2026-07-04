import { Container, Ticker } from 'pixi.js';
import type { ObjectData } from '../../state.svelte';
import { easeOutBack, easeOutCubic, easeInCubic } from '../utils/easing';

export abstract class BaseObjectRenderer {
  abstract container: Container;

  protected _animating = false;
  protected _selected  = false;

  // Spawn animation state
  private _spawnScale = 0.78;
  private _spawnDone  = false;

  // Exit animation state
  private _exiting = false;

  static readonly SPAWN_DURATION = 380;

  /** Called once after creation. Runs spawn animation. */
  spawn(): void {
    this._spawnScale = 0.78;
    this.container.scale.set(0.78);
    this.container.alpha = 0;
    this._animating = true;

    const start = performance.now();
    const tick = () => {
      if (this._exiting) { Ticker.shared.remove(tick); return; }
      const t = Math.min(1, (performance.now() - start) / BaseObjectRenderer.SPAWN_DURATION);
      this._spawnScale = 0.78 + 0.22 * easeOutBack(t);
      this.container.scale.set(this._spawnScale);
      this.container.alpha = Math.min(1, t * 3);
      if (t >= 1) {
        this._spawnScale = 1;
        this.container.scale.set(1);
        this.container.alpha = 1;
        this._spawnDone = true;
        this._animating = false;
        Ticker.shared.remove(tick);
      }
    };
    Ticker.shared.add(tick);
  }

  /** Called every frame with latest data. Should be cheap. */
  abstract sync(data: ObjectData, selection: string[]): void;

  /** Hit-test at world coordinates. */
  hitTest(wx: number, wy: number): boolean {
    const bounds = this.getScreenBounds();
    if (!bounds) return false;
    // Bounds are in world space (stored as world coords in our implementation)
    return wx >= bounds.x && wx <= bounds.x + bounds.w &&
           wy >= bounds.y && wy <= bounds.y + bounds.h;
  }

  /** Returns world-space bounding box { x, y, w, h }. */
  getScreenBounds(): { x: number; y: number; w: number; h: number } | null {
    const c = this.container;
    if (!c.parent) return null;
    const lb = c.getLocalBounds();
    const s = c.scale.x;
    return {
      x: c.x + (lb.x - c.pivot.x) * s,
      y: c.y + (lb.y - c.pivot.y) * s,
      w: lb.width * s,
      h: lb.height * s,
    };
  }

  /** Animate exit, then destroy container. */
  exit(onDone?: () => void): void {
    this._exiting = true;
    this.container.eventMode = 'none';
    const start = performance.now();
    const dur = 200;
    const startAlpha = this.container.alpha;
    const startScaleX = this.container.scale.x;
    const startScaleY = this.container.scale.y;

    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / dur);
      const exitScale = 1 - 0.3 * easeInCubic(t);
      this.container.scale.set(startScaleX * exitScale, startScaleY * exitScale);
      this.container.alpha = startAlpha * (1 - t);
      if (t >= 1) {
        Ticker.shared.remove(tick);
        onDone?.();
      }
    };
    Ticker.shared.add(tick);
  }

  /** Tween container position to (tx, ty). */
  protected tweenPositionTo(tx: number, ty: number, dur = 320): void {
    const sx = this.container.x;
    const sy = this.container.y;
    if (Math.hypot(tx - sx, ty - sy) < 0.5) {
      this.container.x = tx;
      this.container.y = ty;
      return;
    }
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / dur);
      const e = easeOutCubic(t);
      this.container.x = sx + (tx - sx) * e;
      this.container.y = sy + (ty - sy) * e;
      if (t >= 1) Ticker.shared.remove(tick);
    };
    Ticker.shared.add(tick);
  }

  /** Apply hover-scale effect: s = 1 + 0.015 * hoverT */
  protected applyHoverScale(hoverT: number): void {
    const base = this._spawnDone ? 1 : this._spawnScale;
    const s = base * (1 + 0.015 * hoverT);
    this.container.scale.set(s);
  }
}
