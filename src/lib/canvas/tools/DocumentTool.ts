import { Tool } from './Tool';
import type { CanvasRenderer } from '../core/CanvasRenderer';
import { addObject, selectOne, startEditingDocument } from '../../actions.svelte';
import { createId } from '../utils/ids';
import type { DocumentData } from '../../state.svelte';

const DOC_WIDTH  = 360;
const DOC_HEIGHT = Math.round(DOC_WIDTH * 297 / 210);

export class DocumentTool extends Tool {
  readonly id = 'document';

  onPointerDown(e: PointerEvent, engine: CanvasRenderer): void {
    const world = engine.screenToWorld(e.clientX, e.clientY);
    const id = createId('doc');
    const data: DocumentData = {
      type: 'document',
      id,
      x: world.x - DOC_WIDTH / 2,
      y: world.y - DOC_HEIGHT / 2,
      content: '# New Document\n\nStart writing here.\n\n---\n\n',
    };
    addObject(data);
    selectOne(id);
    startEditingDocument(id);
    engine.setTool('select');
  }
}
