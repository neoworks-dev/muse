import type { CanvasRenderer } from '../core/CanvasRenderer';

export abstract class Tool {
  abstract readonly id: string;

  onAttach?(engine: CanvasRenderer): void;
  onDetach?(): void;
  onPointerDown(_e: PointerEvent, _engine: CanvasRenderer): void {}
  onPointerMove(_e: PointerEvent, _engine: CanvasRenderer): void {}
  onPointerUp(_e: PointerEvent, _engine: CanvasRenderer): void {}
  onDoubleClick?(_e: PointerEvent, _engine: CanvasRenderer): void;
  onContextMenu?(_e: PointerEvent, _engine: CanvasRenderer): void;
}
