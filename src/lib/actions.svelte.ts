import {
  canvas, ui, pushHistory, getObject,
  type ObjectData, type FolderData, type MediaData,
} from './state.svelte';
import { createId } from './canvas/utils/ids';
import { easeOutCubic, easeOutBack, easeInBack } from './canvas/utils/easing';
import { scheduleSync } from './sync.svelte';

export function addObject(data: ObjectData) {
  pushHistory();
  canvas.objects = [...canvas.objects, data];
  scheduleSync();
}

export function removeObjects(ids: string[]) {
  pushHistory();
  _removeObjects(ids);
}

export function removeObjectsSilent(ids: string[]) {
  _removeObjects(ids);
}

function _removeObjects(ids: string[]) {
  const s = new Set(ids);
  canvas.objects = canvas.objects.filter(o => {
    if (s.has(o.id)) return false;
    if (o.type === 'link' && (s.has(o.fromId) || s.has(o.toId))) return false;
    return true;
  });
  canvas.selection = canvas.selection.filter(id => !s.has(id));
  scheduleSync();
}

export function moveObject(id: string, x: number, y: number) {
  const o = canvas.objects.find(obj => obj.id === id);
  if (o && 'x' in o) {
    (o as ObjectData & { x: number; y: number }).x = x;
    (o as ObjectData & { x: number; y: number }).y = y;
    scheduleSync();
  }
}

export function updateObject(id: string, patch: Partial<ObjectData>) {
  const o = canvas.objects.find(obj => obj.id === id);
  if (o) {
    Object.assign(o, patch);
    scheduleSync();
  }
}

export function selectOne(id: string | null) { canvas.selection = id ? [id] : []; }
export function selectMany(ids: string[])     { canvas.selection = [...ids]; }

export function enterFolder(id: string) {
  canvas.folderStack = [...canvas.folderStack, id];
  canvas.selection = [];
  const folder = getObject(id);
  ui.folderTitle = folder && 'title' in folder ? (folder as { title: string }).title : 'Folder';
}

export function exitFolder() {
  canvas.folderStack = canvas.folderStack.slice(0, -1);
  canvas.selection = [];
  if (canvas.folderStack.length === 0) {
    ui.folderTitle = 'Home';
  } else {
    const parentId = canvas.folderStack.at(-1)!;
    const folder = getObject(parentId);
    ui.folderTitle = folder && 'title' in folder ? (folder as { title: string }).title : 'Folder';
  }
}

// ── Inline folder open ──────────────────────────────────────────────────────
// Opening a folder reveals its contents as a grid laid out to the right of the
// folder card (images on the top row, documents beneath, notes under that).
// This is distinct from enterFolder, which navigates into the folder scope.

const FOLDER_CARD_W = 340;
const FOLDER_CARD_H = 250;
const GRID_GAP = 60;  // space between the folder card and its grid
const CELL_GAP = 28;  // horizontal space between grid items
const ROW_GAP = 36;   // vertical space between grid rows

function gridRow(o: ObjectData): number {
  if (o.type === 'media') {
    const mediaType = (o as MediaData).mediaType;
    if (mediaType === 'image' || mediaType === 'gif' || mediaType === 'video') return 0;
    return 1; // pdf sits with documents
  }
  if (o.type === 'document' || o.type === 'bookmark') return 1;
  if (o.type === 'note') return 2;
  return 3; // nested folders and anything else
}

function approxSize(o: ObjectData): { w: number; h: number } {
  if (o.type === 'media')    return { w: (o as MediaData).w ?? 320, h: (o as MediaData).h ?? 240 };
  if (o.type === 'document') return { w: 360, h: 509 };
  if (o.type === 'bookmark') return { w: 320, h: 180 };
  if (o.type === 'folder')   return { w: FOLDER_CARD_W, h: FOLDER_CARD_H };
  if (o.type === 'note')     return { w: 240, h: 150 };
  return { w: 200, h: 140 };
}

function folderChildren(folderId: string): ObjectData[] {
  return canvas.objects.filter(
    o => o.type !== 'link' && 'parentId' in o && (o as { parentId?: string }).parentId === folderId
  );
}

type Positioned = ObjectData & { x: number; y: number };
type GridSlot = { child: Positioned; x: number; y: number; w: number; h: number };

function computeGridSlots(id: string): GridSlot[] {
  const folder = getObject(id);
  if (!folder || !('x' in folder)) return [];
  const originX = (folder as FolderData).x + FOLDER_CARD_W + GRID_GAP;
  const originY = (folder as FolderData).y;

  const rows: ObjectData[][] = [[], [], [], []];
  for (const child of folderChildren(id)) rows[gridRow(child)].push(child);

  const slots: GridSlot[] = [];
  let rowTop = originY;
  for (const row of rows) {
    if (row.length === 0) continue;
    let x = originX;
    let rowHeight = 0;
    for (const child of row) {
      const size = approxSize(child);
      slots.push({ child: child as Positioned, x, y: rowTop, w: size.w, h: size.h });
      x += size.w + CELL_GAP;
      rowHeight = Math.max(rowHeight, size.h);
    }
    rowTop += rowHeight + ROW_GAP;
  }
  return slots;
}

export function layoutOpenFolder(id: string) {
  for (const slot of computeGridSlots(id)) {
    slot.child.x = slot.x;
    slot.child.y = slot.y;
  }
}

let _emergeToken = 0;

// Open and close share one timing so close is the open animation reversed.
const FOLDER_ANIM_MS = 220;
const FOLDER_STAGGER_MS = 26;
const FOLDER_PORTAL_RISE = 28; // items spring through a point just above the card's top edge

function folderAnimSpan(count: number): number {
  return FOLDER_ANIM_MS + Math.max(0, count - 1) * FOLDER_STAGGER_MS;
}

// The point near the folder's top edge that items jump out of / back into.
function folderPortal(id: string, itemW: number): { x: number; y: number } {
  const folder = getObject(id) as FolderData;
  return { x: folder.x + FOLDER_CARD_W / 2 - itemW / 2, y: folder.y - FOLDER_PORTAL_RISE };
}

// Animate a folder's children into their grid slots. With fromCenter the items
// spring out of the folder's top edge (a little overshoot, like papers popping
// out); otherwise they slide from their current spot into the new slot.
export function arrangeOpenFolder(id: string, fromCenter: boolean) {
  const folder = getObject(id);
  if (!folder || !('x' in folder)) return;
  const slots = computeGridSlots(id);
  if (slots.length === 0) return;

  const items = slots.map((slot, index) => {
    const portal = folderPortal(id, slot.w);
    const startX = fromCenter ? portal.x : slot.child.x;
    const startY = fromCenter ? portal.y : slot.child.y;
    return {
      child: slot.child,
      startX,
      startY,
      targetX: slot.x,
      targetY: slot.y,
      delay: index * FOLDER_STAGGER_MS
    };
  });

  for (const item of items) {
    item.child.x = item.startX;
    item.child.y = item.startY;
  }

  const ease = fromCenter ? easeOutBack : easeOutCubic;
  const token = ++_emergeToken;
  const start = performance.now();

  const step = () => {
    if (token !== _emergeToken || ui.openFolderId !== id) return;
    const elapsed = performance.now() - start;
    let done = true;
    for (const item of items) {
      const local = Math.min(1, Math.max(0, (elapsed - item.delay) / FOLDER_ANIM_MS));
      const eased = ease(local);
      item.child.x = item.startX + (item.targetX - item.startX) * eased;
      item.child.y = item.startY + (item.targetY - item.startY) * eased;
      if (local < 1) done = false;
    }
    if (!done) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Canvas neighbours nudged aside to keep them visible while a folder is open,
// keyed by id -> original position so they can be restored on close.
const _pushedAside = new Map<string, { x: number; y: number }>();

function animatePositions(
  items: Array<{ child: Positioned; fromX: number; fromY: number; toX: number; toY: number }>,
  duration: number
) {
  if (items.length === 0) return;
  const start = performance.now();
  const step = () => {
    const eased = easeOutCubic(Math.min(1, (performance.now() - start) / duration));
    for (const item of items) {
      item.child.x = item.fromX + (item.toX - item.fromX) * eased;
      item.child.y = item.fromY + (item.toY - item.fromY) * eased;
    }
    if (eased < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function gridRegionBounds(id: string): { x: number; y: number; w: number; h: number } | null {
  const slots = computeGridSlots(id);
  if (slots.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const slot of slots) {
    minX = Math.min(minX, slot.x);
    minY = Math.min(minY, slot.y);
    maxX = Math.max(maxX, slot.x + slot.w);
    maxY = Math.max(maxY, slot.y + slot.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function pushNeighborsAside(id: string, duration: number) {
  const folder = getObject(id);
  const region = gridRegionBounds(id);
  if (!folder || !region) return;
  const scope = ('parentId' in folder ? (folder as { parentId?: string }).parentId : undefined) ?? null;
  const gap = 40;

  const items: Array<{ child: Positioned; fromX: number; fromY: number; toX: number; toY: number }> = [];
  for (const o of canvas.objects) {
    if (o.id === id || o.type === 'link' || !('x' in o)) continue;
    const parentId = ('parentId' in o ? (o as { parentId?: string }).parentId : undefined) ?? null;
    if (parentId !== scope) continue; // only same-scope canvas neighbours, not grid children
    const size = approxSize(o);
    const node = o as Positioned;
    const overlaps =
      node.x < region.x + region.w &&
      node.x + size.w > region.x &&
      node.y < region.y + region.h &&
      node.y + size.h > region.y;
    if (!overlaps) continue;
    if (!_pushedAside.has(o.id)) _pushedAside.set(o.id, { x: node.x, y: node.y });
    const shiftX = region.x + region.w + gap - node.x;
    items.push({ child: node, fromX: node.x, fromY: node.y, toX: node.x + shiftX, toY: node.y });
  }
  animatePositions(items, duration);
}

function restorePushedNeighbors(duration: number) {
  const items: Array<{ child: Positioned; fromX: number; fromY: number; toX: number; toY: number }> = [];
  for (const [oid, original] of _pushedAside) {
    const o = getObject(oid);
    if (o && 'x' in o) {
      const node = o as Positioned;
      items.push({ child: node, fromX: node.x, fromY: node.y, toX: original.x, toY: original.y });
    }
  }
  _pushedAside.clear();
  animatePositions(items, duration);
}

export function openFolder(id: string) {
  const folder = getObject(id);
  if (!folder || folder.type !== 'folder') return;
  // Switching straight from another open folder: hide it at once (no retract).
  if (ui.openFolderId && ui.openFolderId !== id) {
    const previous = getObject(ui.openFolderId);
    if (previous && previous.type === 'folder') (previous as FolderData).expanded = false;
    restorePushedNeighbors(FOLDER_ANIM_MS);
  }
  ui.openFolderId = id;
  (folder as FolderData).expanded = true;
  const span = folderAnimSpan(computeGridSlots(id).length);
  arrangeOpenFolder(id, true);
  pushNeighborsAside(id, span);
}

// Reverse of the open animation: children retract into the folder card, then the
// folder is marked closed once they have all arrived.
export function closeOpenFolder() {
  const id = ui.openFolderId;
  if (!id) return;

  const folder = getObject(id);
  if (!folder || !('x' in folder)) { ui.openFolderId = null; return; }
  if (folder.type === 'folder') (folder as FolderData).expanded = false;

  const slots = computeGridSlots(id);
  if (slots.length === 0) { _emergeToken++; ui.openFolderId = null; return; }

  const span = folderAnimSpan(slots.length);
  restorePushedNeighbors(span);

  // Reverse of the open: items jump from their slot straight back into the
  // folder's top edge (anticipation, then snap in), last-out retracts first.
  const lastIndex = slots.length - 1;
  const items = slots.map((slot, index) => {
    const portal = folderPortal(id, slot.w);
    return {
      child: slot.child,
      startX: slot.x,
      startY: slot.y,
      portalX: portal.x,
      portalY: portal.y,
      delay: (lastIndex - index) * FOLDER_STAGGER_MS
    };
  });

  const token = ++_emergeToken;
  const start = performance.now();

  const step = () => {
    if (token !== _emergeToken) return; // superseded by another open/close
    const elapsed = performance.now() - start;
    let done = true;
    for (const item of items) {
      const local = Math.min(1, Math.max(0, (elapsed - item.delay) / FOLDER_ANIM_MS));
      const eased = easeInBack(local);
      item.child.x = item.startX + (item.portalX - item.startX) * eased;
      item.child.y = item.startY + (item.portalY - item.startY) * eased;
      if (local < 1) done = false;
    }
    if (done) {
      if (ui.openFolderId === id) ui.openFolderId = null;
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function toggleFolderOpen(id: string) {
  if (ui.openFolderId === id) closeOpenFolder();
  else openFolder(id);
}

/** Guard against filing a folder into itself or one of its own descendants. */
export function canFileInto(objectId: string, folderId: string): boolean {
  if (objectId === folderId) return false;
  let current = getObject(folderId);
  const seen = new Set<string>();
  while (current && 'parentId' in current) {
    const parentId = (current as { parentId?: string }).parentId;
    if (!parentId || seen.has(parentId)) break;
    if (parentId === objectId) return false;
    seen.add(parentId);
    current = getObject(parentId);
  }
  return true;
}

export function startEditingDocument(id: string) {
  if (!ui.openDocumentIds.includes(id)) {
    ui.openDocumentIds = [...ui.openDocumentIds, id];
  }
}
export function commitDocumentEdit(id: string, content: string) {
  updateObject(id, { content } as Partial<ObjectData>);
  pushHistory();
  ui.openDocumentIds = ui.openDocumentIds.filter(x => x !== id);
}
export function cancelDocumentEdit(id: string) {
  ui.openDocumentIds = ui.openDocumentIds.filter(x => x !== id);
}

export function startEditingNote(id: string) { ui.editingNoteId = id; }
export function commitNoteEdit(id: string, body: string) {
  updateObject(id, { body } as Partial<ObjectData>);
  pushHistory();
  ui.editingNoteId = null;
}
export function cancelNoteEdit() { ui.editingNoteId = null; }

export function startViewingBookmark(id: string) {
  if (!ui.openBookmarkIds.includes(id)) ui.openBookmarkIds = [...ui.openBookmarkIds, id];
}
export function stopViewingBookmark(id: string) {
  ui.openBookmarkIds = ui.openBookmarkIds.filter(x => x !== id);
}

export function openPdf(id: string) {
  if (!ui.openPdfIds.includes(id)) ui.openPdfIds = [...ui.openPdfIds, id];
}
export function closePdf(id: string) {
  ui.openPdfIds = ui.openPdfIds.filter(x => x !== id);
}

export function startEditingLink(id: string) { ui.editingLinkId = id; }
export function commitLinkEdit(id: string, label: string) {
  updateObject(id, { label } as Partial<ObjectData>);
  pushHistory();
  ui.editingLinkId = null;
}
export function cancelLinkEdit() { ui.editingLinkId = null; }

/** Move multiple objects by screen-space delta (divided by zoom). */
export function moveObjects(ids: string[], dx: number, dy: number) {
  for (const id of ids) {
    const o = canvas.objects.find(obj => obj.id === id);
    if (o && 'x' in o) {
      (o as ObjectData & { x: number; y: number }).x += dx;
      (o as ObjectData & { x: number; y: number }).y += dy;
    }
  }
  scheduleSync();
}

/** Set tool — renderers/page watch ui.activeTool */
export function setActiveTool(id: import('./canvas/core/types').ToolId) {
  ui.activeTool = id;
  ui.sketchMode = id === 'sketch';
}

/** Group selected objects into a folder. */
export function groupSelectedIntoFolder(title = 'New Folder') {
  const ids = canvas.selection;
  if (ids.length < 2) return;

  pushHistory();

  let minX = Infinity, minY = Infinity;
  for (const id of ids) {
    const o = getObject(id);
    if (o && 'x' in o) {
      const obj = o as ObjectData & { x: number; y: number };
      minX = Math.min(minX, obj.x);
      minY = Math.min(minY, obj.y);
    }
  }

  const folderId = createId('folder');
  const scope = canvas.folderStack.at(-1) ?? null;

  // Move children under the new folder
  for (const id of ids) {
    const o = canvas.objects.find(obj => obj.id === id);
    if (o && 'parentId' in o) {
      (o as { parentId?: string }).parentId = folderId;
    } else if (o) {
      Object.assign(o, { parentId: folderId });
    }
  }

  // Remove dangling links between objects now in the folder (keep them inside)
  // Add the folder
  canvas.objects = [
    ...canvas.objects,
    {
      type: 'folder',
      id: folderId,
      x: minX,
      y: minY,
      title,
      parentId: scope ?? undefined,
    } satisfies import('./state.svelte').FolderData,
  ];

  canvas.selection = [folderId];
  scheduleSync();
}
