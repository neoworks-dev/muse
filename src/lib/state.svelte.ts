import type { ToolId, ContextMenuItem } from './canvas/core/types';
import type { EditorAnnot } from './editor-types';

export type LinkDirection = 'forward' | 'backward' | 'both' | 'none';
export interface StrokePoint { x: number; y: number; pressure: number; }

export type BrushType = 'pen' | 'pencil' | 'marker';
export type ShapeType = 'line' | 'box' | 'oval';
export type DrawToolKind = BrushType | ShapeType;

export type NoteData     = { type: 'note';     id: string; x: number; y: number; body: string; parentId?: string; zIndex?: number; };
export type DocumentData = { type: 'document'; id: string; x: number; y: number; content: string; title?: string; parentId?: string; zIndex?: number; };
export type FolderData   = { type: 'folder';   id: string; x: number; y: number; title: string; expanded?: boolean; parentId?: string; zIndex?: number; };
export type LinkData     = { type: 'link';     id: string; fromId: string; toId: string; label: string; direction: LinkDirection; };
export type MediaData    = { type: 'media';    id: string; x: number; y: number; src: string; mediaType: 'image' | 'video' | 'gif' | 'pdf'; w?: number; h?: number; parentId?: string; zIndex?: number; manifest?: import('./media').MediaManifest; };
export type StrokeData   = { type: 'stroke';   id: string; points: StrokePoint[]; color: string; width: number; brush?: BrushType; closed?: boolean; parentId?: string; };
export type BookmarkData = { type: 'bookmark'; id: string; x: number; y: number; url: string; title: string; description?: string; favicon?: string; imageUrl?: string; domain?: string; loading?: boolean; parentId?: string; zIndex?: number; };
export type ObjectData   = NoteData | DocumentData | FolderData | LinkData | MediaData | StrokeData | BookmarkData;

export const canvas = $state({
  objects:     [] as ObjectData[],
  selection:   [] as string[],
  camera:      { x: 0, y: 0, zoom: 1 },
  folderStack: [] as string[],
});

export const ui = $state({
  activeTool:         'select' as ToolId,
  aiChatOpen:         false,
  settingsOpen:       false,
  openDocumentIds:    [] as string[],
  editingNoteId:      null as string | null,
  editingLinkId:      null as string | null,
  proposedDoc:        null as string | null,
  docAnnots:          [] as EditorAnnot[],
  contextMenu:        null as { items: ContextMenuItem[]; x: number; y: number } | null,
  sketchMode:         false,
  folderTitle:        'Home',
  openFolderId:       null as string | null,
  drawTool:           'pen' as DrawToolKind,
  drawColor:          '#24282a',
  radialMenu:         null as { x: number; y: number } | null,
  openBookmarkIds:    [] as string[],
  openPdfIds:         [] as string[],
  commandPaletteOpen: false,
  projectPanelOpen:   false,
  // Transient canvas cursor override (pan/drag/resize) consumed by CustomCursor.
  // '' = fall back to the tool/default cursor. Values: grab | grabbing |
  // resize-ew | resize-ns | resize-nwse | resize-nesw.
  cursorTransient:    '' as string,
});

// History (replaces UndoRedoManager)
type Snapshot = { objects: ObjectData[]; selection: string[]; folderStack: string[]; };
const _stack: Snapshot[] = [];
export const histState = $state({ index: -1, size: 0 });
const MAX = 100;

export function pushHistory() {
  const snap: Snapshot = {
    objects: $state.snapshot(canvas.objects) as ObjectData[],
    selection: [...canvas.selection],
    folderStack: [...canvas.folderStack],
  };
  _stack.splice(histState.index + 1);
  _stack.push(snap);
  if (_stack.length > MAX) _stack.shift(); else histState.index++;
  histState.size = _stack.length;
}

function applySnapshot(snap: Snapshot) {
  canvas.objects     = structuredClone(snap.objects);
  canvas.selection   = [...snap.selection];
  canvas.folderStack = [...snap.folderStack];
}

export function undo() {
  if (histState.index > 0) applySnapshot(_stack[--histState.index]);
}
export function redo() {
  if (histState.index < histState.size - 1) applySnapshot(_stack[++histState.index]);
}

// Helpers
export function getObject(id: string): ObjectData | undefined {
  return canvas.objects.find(o => o.id === id);
}

export function currentScope(): string | null {
  return canvas.folderStack.at(-1) ?? null;
}

export function visibleObjects(): ObjectData[] {
  const scope = currentScope();
  const openId = ui.openFolderId;
  return canvas.objects.filter(o => {
    if (o.type === 'link') {
      // links show only at current scope when their endpoints are visible
      return true;
    }
    const parentId = ('parentId' in o ? o.parentId : undefined) ?? null;
    if (parentId === scope) return true;
    // An inline-opened folder also reveals its children as a grid on the canvas.
    if (openId && parentId === openId) return true;
    return false;
  });
}
