import { canvas, type ObjectData } from './state.svelte';
import { db } from './db';
import { activeProjectId } from './projects.svelte';
import type { objectCreateInput, objectUpdateInput } from './db-gen';

// Backend-backed persistence for canvas objects. The in-memory `canvas.objects`
// runes stay the source of truth for the session; mutations are mirrored to the
// muse data plane by a debounced, diff-based sync.

export const syncStatus = $state({ pending: 0, error: null as string | null, ready: false });

// Fields promoted to real columns; everything else lives in `payload`.
const COLUMN_KEYS = new Set(['id', 'type', 'x', 'y', 'parentId', 'zIndex']);
// Transient UI flags we never persist.
const TRANSIENT_KEYS = new Set(['expanded', 'loading']);

interface Row {
	type: string;
	x?: number;
	y?: number;
	parent_id?: string;
	z_index?: number;
	payload: Record<string, unknown>;
}

function toRow(o: ObjectData): Row {
	const snap = $state.snapshot(o) as Record<string, unknown>;
	const payload: Record<string, unknown> = {};
	for (const key of Object.keys(snap)) {
		if (COLUMN_KEYS.has(key) || TRANSIENT_KEYS.has(key)) continue;
		payload[key] = snap[key];
	}
	const row: Row = { type: snap.type as string, payload };
	if (typeof snap.x === 'number') row.x = snap.x;
	if (typeof snap.y === 'number') row.y = snap.y;
	if (typeof snap.parentId === 'string') row.parent_id = snap.parentId;
	if (typeof snap.zIndex === 'number') row.z_index = snap.zIndex;
	return row;
}

function fromRow(row: Record<string, unknown>): ObjectData {
	const payload = (row.payload as Record<string, unknown>) ?? {};
	const o: Record<string, unknown> = { id: row.id, type: row.type, ...payload };
	if (row.x != null) o.x = row.x;
	if (row.y != null) o.y = row.y;
	if (row.parent_id != null) o.parentId = row.parent_id;
	if (row.z_index != null) o.zIndex = row.z_index;
	return o as ObjectData;
}

// Stable fingerprint of the persisted shape, used to detect changes.
function fingerprint(row: Row): string {
	return JSON.stringify([row.type, row.x, row.y, row.parent_id, row.z_index, row.payload]);
}

// Last value we know the backend holds, keyed by object id.
const lastSynced = new Map<string, string>();

// ── Hydrate ──────────────────────────────────────────────────────────────────

const OBJECT_SELECTION = {
	id: true,
	type: true,
	x: true,
	y: true,
	parent_id: true,
	z_index: true,
	payload: true
} as const;

export async function hydrate(): Promise<void> {
	const projectId = activeProjectId();
	const filter = projectId ? { project_id: projectId } : undefined;
	const data = await db.query({
		objects: { __args: { limit: 100000, filter: filter as never }, ...OBJECT_SELECTION }
	});
	const rows = (data.objects ?? []) as Record<string, unknown>[];
	canvas.objects = rows.map(fromRow);
	lastSynced.clear();
	for (const o of canvas.objects) {
		lastSynced.set(o.id, fingerprint(toRow(o)));
	}
	syncStatus.ready = true;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

// option<T> columns reject NULL — only include set values in the input.
function toInput(row: Row): Record<string, unknown> {
	const input: Record<string, unknown> = {
		type: row.type,
		payload: row.payload,
		updated_at: new Date().toISOString()
	};
	if (row.x !== undefined) input.x = row.x;
	if (row.y !== undefined) input.y = row.y;
	if (row.parent_id !== undefined) input.parent_id = row.parent_id;
	if (row.z_index !== undefined) input.z_index = row.z_index;
	// Stamp every object with the project it belongs to so per-project hydrate
	// queries can scope by it. All in-memory objects belong to the active project.
	const projectId = activeProjectId();
	if (projectId) input.project_id = projectId;
	return input;
}

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

async function flush(): Promise<void> {
	if (flushing) {
		scheduleSync();
		return;
	}
	flushing = true;
	try {
		const current = new Map<string, Row>();
		for (const o of canvas.objects) current.set(o.id, toRow(o));

		const creates: Array<[string, Row]> = [];
		const updates: Array<[string, Row]> = [];
		const deletes: string[] = [];

		for (const [id, row] of current) {
			const fp = fingerprint(row);
			const prev = lastSynced.get(id);
			if (prev === undefined) creates.push([id, row]);
			else if (prev !== fp) updates.push([id, row]);
		}
		for (const id of lastSynced.keys()) {
			if (!current.has(id)) deletes.push(id);
		}

		if (creates.length === 0 && updates.length === 0 && deletes.length === 0) return;

		syncStatus.pending = creates.length + updates.length + deletes.length;
		syncStatus.error = null;

		for (const [id, row] of creates) {
			await db.mutation({ createObject: { __args: { id, input: toInput(row) as unknown as objectCreateInput }, id: true } });
			lastSynced.set(id, fingerprint(row));
			syncStatus.pending--;
		}
		for (const [id, row] of updates) {
			await db.mutation({ updateObject: { __args: { id, input: toInput(row) as unknown as objectUpdateInput }, id: true } });
			lastSynced.set(id, fingerprint(row));
			syncStatus.pending--;
		}
		for (const id of deletes) {
			await db.mutation({ deleteObject: { __args: { id } } });
			lastSynced.delete(id);
			syncStatus.pending--;
		}
	} catch (e) {
		// Leave lastSynced untouched for failed ops so the next flush retries them.
		syncStatus.error = e instanceof Error ? e.message : 'sync failed';
		scheduleSync();
	} finally {
		flushing = false;
	}
}

/** Best-effort final flush on page unload. */
export function flushNow(): void {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	void flush();
}

/** Records a row as already-synced (used by migration to avoid re-pushing). */
export function markSynced(o: ObjectData): void {
	lastSynced.set(o.id, fingerprint(toRow(o)));
}

/**
 * Creates objects on the backend directly (used by one-time migration before
 * hydrate). Tolerates per-object failures (e.g. an id that already exists) so a
 * partial re-run doesn't abort.
 */
export async function pushObjects(objects: ObjectData[]): Promise<number> {
	let created = 0;
	for (const o of objects) {
		const row = toRow(o);
		try {
			await db.mutation({ createObject: { __args: { id: o.id, input: toInput(row) as unknown as objectCreateInput }, id: true } });
			lastSynced.set(o.id, fingerprint(row));
			created++;
		} catch (e) {
			console.error('[migrate] push failed for', o.id, e);
		}
	}
	return created;
}
