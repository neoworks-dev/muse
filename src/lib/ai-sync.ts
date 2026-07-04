import { db } from './db';
import type { ai_threadCreateInput, ai_threadUpdateInput, ai_memoryCreateInput } from './db-gen';

// Backend persistence for AI chat threads + memories, mirroring the canvas
// sync: in-memory state is the source of truth, mutations are diffed and pushed
// to the ai_thread / ai_memory data-plane tables. The active thread id is
// per-device view state and stays in localStorage.

export interface ThreadRecord {
	id: string;
	name: string;
	[key: string]: unknown; // messages, parentThreadId, parentMsgIdx
}

export interface MemoryRecord {
	id: string;
	content: string;
	createdAt: number;
}

const ACTIVE_KEY = 'muse:ai-active-thread';

const threadSynced = new Map<string, string>();
const memorySynced = new Map<string, string>();
let ready = false;

function threadFingerprint(t: ThreadRecord): string {
	const { id, ...rest } = t;
	void id;
	return JSON.stringify(rest);
}

function threadInput(t: ThreadRecord): Record<string, unknown> {
	const { id, name, ...rest } = t;
	void id;
	return { name, payload: rest, updated_at: new Date().toISOString() };
}

function memoryFingerprint(m: MemoryRecord): string {
	return JSON.stringify([m.content, m.createdAt]);
}

export function getActiveThreadId(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveThreadId(id: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(ACTIVE_KEY, id);
}

export async function loadAiState(): Promise<{ threads: ThreadRecord[]; memories: MemoryRecord[] }> {
	const [t, m] = await Promise.all([
		db.query({ ai_threads: { __args: { limit: 100000 }, id: true, name: true, payload: true, updated_at: true } }),
		db.query({ ai_memorys: { __args: { limit: 100000 }, id: true, content: true, created_at: true } })
	]);

	const threadRows = (t.ai_threads ?? []) as Array<Record<string, unknown>>;
	const memoryRows = (m.ai_memorys ?? []) as Array<Record<string, unknown>>;

	const threads: ThreadRecord[] = threadRows.map((r) => ({
		id: r.id as string,
		name: r.name as string,
		...((r.payload as Record<string, unknown>) ?? {})
	}));
	const memories: MemoryRecord[] = memoryRows.map((r) => ({
		id: r.id as string,
		content: r.content as string,
		createdAt: r.created_at ? Date.parse(r.created_at as string) : 0
	}));

	threadSynced.clear();
	for (const th of threads) threadSynced.set(th.id, threadFingerprint(th));
	memorySynced.clear();
	for (const me of memories) memorySynced.set(me.id, memoryFingerprint(me));

	ready = true;
	return { threads, memories };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
const DEBOUNCE_MS = 1000;

export function scheduleAiSave(threads: ThreadRecord[], memories: MemoryRecord[]): void {
	if (!ready) return;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => {
		timer = null;
		void flush(threads, memories);
	}, DEBOUNCE_MS);
}

async function flush(threads: ThreadRecord[], memories: MemoryRecord[]): Promise<void> {
	if (flushing) {
		scheduleAiSave(threads, memories);
		return;
	}
	flushing = true;
	try {
		const curThreads = new Map(threads.map((t) => [t.id, t]));
		for (const t of threads) {
			const fp = threadFingerprint(t);
			const prev = threadSynced.get(t.id);
			if (prev === undefined) {
				await db.mutation({ createAi_thread: { __args: { id: t.id, input: threadInput(t) as unknown as ai_threadCreateInput }, id: true } });
			} else if (prev !== fp) {
				await db.mutation({ updateAi_thread: { __args: { id: t.id, input: threadInput(t) as unknown as ai_threadUpdateInput }, id: true } });
			} else {
				continue;
			}
			threadSynced.set(t.id, fp);
		}
		for (const id of [...threadSynced.keys()]) {
			if (!curThreads.has(id)) {
				await db.mutation({ deleteAi_thread: { __args: { id } } });
				threadSynced.delete(id);
			}
		}

		const curMemories = new Map(memories.map((m) => [m.id, m]));
		for (const me of memories) {
			const fp = memoryFingerprint(me);
			if (memorySynced.get(me.id) === fp) continue;
			// Memories are append-only; create when new, otherwise leave as-is.
			if (!memorySynced.has(me.id)) {
				await db.mutation({
					createAi_memory: {
						__args: {
							id: me.id,
							input: { content: me.content, created_at: new Date(me.createdAt).toISOString() } as ai_memoryCreateInput
						},
						id: true
					}
				});
			}
			memorySynced.set(me.id, fp);
		}
		for (const id of [...memorySynced.keys()]) {
			if (!curMemories.has(id)) {
				await db.mutation({ deleteAi_memory: { __args: { id } } });
				memorySynced.delete(id);
			}
		}
	} catch (e) {
		console.error('[ai-sync] flush failed', e);
		scheduleAiSave(threads, memories);
	} finally {
		flushing = false;
	}
}
