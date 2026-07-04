import type { ObjectData } from '../../state.svelte';
import type { CanvasRenderer } from '../core/CanvasRenderer';
import { NoteRenderer }       from './NoteRenderer';
import { DocumentRenderer }   from './DocumentRenderer';
import { FolderRenderer }     from './FolderRenderer';
import { LinkRenderer }       from './LinkRenderer';
import { MediaRenderer }      from './MediaRenderer';
import { StrokeRenderer }     from './StrokeRenderer';
import { BookmarkRenderer }   from './BookmarkRenderer';
import { BaseObjectRenderer } from '../core/BaseObjectRenderer';

export function createRenderer(data: ObjectData, engine: CanvasRenderer): BaseObjectRenderer {
  switch (data.type) {
    case 'note':     return new NoteRenderer(data);
    case 'document': return new DocumentRenderer(data);
    case 'folder':   return new FolderRenderer(data, engine);
    case 'link':     return new LinkRenderer(data);
    case 'media':    return new MediaRenderer(data, engine);
    case 'stroke':   return new StrokeRenderer(data);
    case 'bookmark': return new BookmarkRenderer(data);
  }
}
