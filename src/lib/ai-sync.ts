import { idbGet, idbPut } from './storage.svelte';

// Local persistence for AI chat threads + memories: in-memory state is the
// source of truth, snapshots are written to IndexedDB by a debounced save.
// The active thread id is per-device view state and stays in localStorage.

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
const THREADS_KEY = 'ai:threads';
const MEMORIES_KEY = 'ai:memories';

let ready = false;

export function getActiveThreadId(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveThreadId(id: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(ACTIVE_KEY, id);
}

export async function loadAiState(): Promise<{ threads: ThreadRecord[]; memories: MemoryRecord[] }> {
	const threads = (await idbGet<ThreadRecord[]>(THREADS_KEY)) ?? [];
	const memories = (await idbGet<MemoryRecord[]>(MEMORIES_KEY)) ?? [];
	ready = true;
	return { threads, memories };
}

let timer: ReturnType<typeof setTimeout> | null = null;
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
	try {
		await idbPut(THREADS_KEY, threads);
		await idbPut(MEMORIES_KEY, memories);
	} catch (e) {
		console.error('[ai-sync] save failed', e);
	}
}
