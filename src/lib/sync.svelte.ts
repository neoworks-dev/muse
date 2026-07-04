import { canvas, type ObjectData } from './state.svelte';
import { activeProjectId } from './projects.svelte';
import { idbGet, idbPut, migrateOldObjects } from './storage.svelte';

// Local persistence for the canvas. The in-memory `canvas.objects` runes stay
// the source of truth for the session; changes are written to IndexedDB by a
// debounced flush, one snapshot per project.

export const syncStatus = $state({ error: null as string | null, ready: false });
export const saveStatus = $state({ saving: false, savedAt: 0 });

// Transient UI flags we never persist.
const TRANSIENT_KEYS = new Set(['expanded', 'loading']);

interface CanvasSnapshot {
	version: number;
	objects: Record<string, unknown>[];
	camera?: { x: number; y: number; zoom: number };
	folderStack?: string[];
}

export function canvasKey(projectId: string | null): string {
	return `project:${projectId ?? 'default'}:canvas`;
}

function snapshotObjects(): Record<string, unknown>[] {
	const objects = $state.snapshot(canvas.objects) as unknown as Record<string, unknown>[];
	return objects.map((object) => {
		const persisted: Record<string, unknown> = {};
		for (const key of Object.keys(object)) {
			if (TRANSIENT_KEYS.has(key)) continue;
			persisted[key] = object[key];
		}
		return persisted;
	});
}

// ── Hydrate ──────────────────────────────────────────────────────────────────

export async function hydrate(): Promise<void> {
	syncStatus.ready = false;
	cancelPendingFlush();

	const key = canvasKey(activeProjectId());
	let snap = await idbGet<CanvasSnapshot>(key);
	if (!snap) {
		snap = await importLegacyRoot();
	}

	canvas.objects = snap ? (snap.objects as unknown as ObjectData[]) : [];
	if (snap?.camera) {
		canvas.camera = { ...snap.camera };
	}
	if (Array.isArray(snap?.folderStack)) {
		canvas.folderStack = [...snap.folderStack];
	}
	syncStatus.ready = true;
}

// The pre-projects app stored one canvas blob under "root". Import it into the
// first project that hydrates without a snapshot; the old blob stays in place
// as a backup.
async function importLegacyRoot(): Promise<CanvasSnapshot | null> {
	const raw = await idbGet<CanvasSnapshot>('root');
	if (!raw || !Array.isArray(raw.objects)) return null;
	return {
		version: 3,
		objects: migrateOldObjects(raw.objects) as unknown as Record<string, unknown>[],
		camera: raw.camera,
		folderStack: raw.folderStack
	};
}

// ── Flush ────────────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
const DEBOUNCE_MS = 1500;

export function scheduleSync(): void {
	if (!syncStatus.ready) return;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => {
		timer = null;
		void flush();
	}, DEBOUNCE_MS);
}

function cancelPendingFlush(): void {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
}

async function flush(): Promise<void> {
	if (flushing) {
		scheduleSync();
		return;
	}
	flushing = true;
	saveStatus.saving = true;
	try {
		const snap: CanvasSnapshot = {
			version: 3,
			objects: snapshotObjects(),
			camera: { ...$state.snapshot(canvas.camera) },
			folderStack: [...canvas.folderStack]
		};
		await idbPut(canvasKey(activeProjectId()), snap);
		saveStatus.savedAt = Date.now();
		syncStatus.error = null;
	} catch (e) {
		syncStatus.error = e instanceof Error ? e.message : 'save failed';
		scheduleSync();
	} finally {
		flushing = false;
		saveStatus.saving = false;
	}
}

/** Flushes immediately (page unload, project switch). */
export async function flushNow(): Promise<void> {
	cancelPendingFlush();
	if (!syncStatus.ready) return;
	await flush();
}
