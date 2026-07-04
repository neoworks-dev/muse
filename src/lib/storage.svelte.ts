import { canvas } from './state.svelte';
import type { ObjectData } from './state.svelte';

// ── IDB adapter (same as old StorageController) ──────────────────────────────

const DB_NAME = 'muse';
const STORE   = 'kv';
const KEY     = 'root';

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => { _db = req.result; resolve(req.result); };
    req.onerror   = () => reject(req.error);
  });
}

async function idbSave(key: string, data: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function idbLoad(key: string): Promise<unknown | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

// ── Data migration: flatten old FolderObject.childData format ────────────────

export function migrateOldObjects(rawObjects: Record<string, unknown>[]): ObjectData[] {
  const result: ObjectData[] = [];

  for (const raw of rawObjects) {
    const type = raw.type as string;

    if (type === 'folder') {
      const folder: Record<string, unknown> = { ...raw };
      const childData = Array.isArray(folder.childData) ? (folder.childData as Record<string, unknown>[]) : [];

      // Convert old FolderData format to new FolderData
      const folderData: import('./state.svelte').FolderData = {
        type:   'folder',
        id:     raw.id as string,
        x:      (raw.x as number) ?? 0,
        y:      (raw.y as number) ?? 0,
        title:  (raw.title as string) ?? 'Folder',
        parentId: raw.parentId as string | undefined,
        zIndex: raw.zIndex as number | undefined,
      };
      result.push(folderData);

      // Flatten children — give them parentId = folder.id
      if (childData.length > 0) {
        const children = migrateOldObjects(childData).map(child => ({
          ...child,
          parentId: folder.id as string,
        }));
        result.push(...children);
      }
    } else if (type === 'note') {
      result.push({
        type:     'note',
        id:       raw.id as string,
        x:        (raw.x as number) ?? 0,
        y:        (raw.y as number) ?? 0,
        body:     (raw.body as string) ?? '',
        parentId: raw.parentId as string | undefined,
        zIndex:   raw.zIndex as number | undefined,
      });
    } else if (type === 'document') {
      // old key was 'markdown', new key is 'content'
      result.push({
        type:     'document',
        id:       raw.id as string,
        x:        (raw.x as number) ?? 0,
        y:        (raw.y as number) ?? 0,
        content:  ((raw.content ?? raw.markdown) as string) ?? '',
        title:    raw.title as string | undefined,
        parentId: raw.parentId as string | undefined,
        zIndex:   raw.zIndex as number | undefined,
      });
    } else if (type === 'link') {
      // old keys: fromObjectId / toObjectId
      result.push({
        type:      'link',
        id:        raw.id as string,
        fromId:    ((raw.fromId ?? raw.fromObjectId) as string) ?? '',
        toId:      ((raw.toId ?? raw.toObjectId) as string) ?? '',
        label:     (raw.label as string) ?? 'context',
        direction: ((raw.direction as import('./state.svelte').LinkDirection) ?? 'forward'),
      });
    } else if (type === 'media') {
      result.push({
        type:      'media',
        id:        raw.id as string,
        x:         (raw.x as number) ?? 0,
        y:         (raw.y as number) ?? 0,
        src:       (raw.src as string) ?? '',
        mediaType: ((raw.mediaType as 'image' | 'video') ?? 'image'),
        w:         (raw.width ?? raw.w) as number | undefined,
        h:         (raw.height ?? raw.h) as number | undefined,
        parentId:  raw.parentId as string | undefined,
        zIndex:    raw.zIndex as number | undefined,
      });
    } else if (type === 'bookmark') {
      result.push({
        type:        'bookmark',
        id:          raw.id as string,
        x:           (raw.x as number) ?? 0,
        y:           (raw.y as number) ?? 0,
        url:         (raw.url as string) ?? '',
        title:       (raw.title as string) ?? '',
        description: raw.description as string | undefined,
        favicon:     raw.favicon as string | undefined,
        imageUrl:    raw.imageUrl as string | undefined,
        domain:      raw.domain as string | undefined,
        parentId:    raw.parentId as string | undefined,
        zIndex:      raw.zIndex as number | undefined,
      });
    } else if (type === 'stroke') {
      result.push({
        type:   'stroke',
        id:     raw.id as string,
        points: ((raw.points as import('./state.svelte').StrokePoint[]) ?? []),
        color:  typeof raw.color === 'number'
          ? '#' + (raw.color as number).toString(16).padStart(6, '0')
          : ((raw.color as string) ?? '#24282a'),
        width:    ((raw.strokeWidth ?? raw.width) as number) ?? 4,
        brush:    raw.brush as import('./state.svelte').BrushType | undefined,
        closed:   raw.closed as boolean | undefined,
        parentId: raw.parentId as string | undefined,
      });
    }
  }

  return result;
}

// ── Persisted data shape ───────────────────────────────────────────────────────

type PersistedData = {
  version: number;
  objects: Record<string, unknown>[];
  camera?: { x: number; y: number; zoom: number };
  folderStack?: string[];
};

// ── Save status ───────────────────────────────────────────────────────────────

export const saveStatus = $state({ saving: false, savedAt: 0 });

// ── Generic IDB helpers (exported for other modules) ─────────────────────────

export async function idbGet<T>(key: string): Promise<T | null> {
  const v = await idbLoad(key);
  return v as T | null;
}

export async function idbPut(key: string, value: unknown): Promise<void> {
  await idbSave(key, value);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function load(): Promise<boolean> {
  try {
    const raw = await idbLoad(KEY);
    if (!raw) return false;
    const data = raw as PersistedData;
    if (!Array.isArray(data.objects)) return false;

    canvas.objects = migrateOldObjects(data.objects);
    if (data.camera) {
      canvas.camera = { ...data.camera };
    }
    if (Array.isArray(data.folderStack)) {
      canvas.folderStack = [...data.folderStack];
    }
    return true;
  } catch (err) {
    console.error('[storage] load error', err);
    return false;
  }
}

export async function flush(): Promise<void> {
  saveStatus.saving = true;
  try {
    const data: PersistedData = {
      version: 2,
      objects: $state.snapshot(canvas.objects) as unknown as Record<string, unknown>[],
      camera:  { ...$state.snapshot(canvas.camera) },
      folderStack: [...canvas.folderStack],
    };
    await idbSave(KEY, data);
    saveStatus.savedAt = Date.now();
  } catch (err) {
    console.error('[storage] flush error', err);
  } finally {
    saveStatus.saving = false;
  }
}

let _timer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 2000;

export function markDirty(): void {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    _timer = null;
    flush().catch(console.error);
  }, DEBOUNCE_MS);
}
