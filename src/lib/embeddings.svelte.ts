import { canvas, type ObjectData } from './state.svelte';
import { idbGet, idbPut } from './storage.svelte';

// Semantic index over canvas objects. Vectors come from Nomic embed models
// (text + vision, same embedding space) running as ONNX in the Electron main
// process; see electron/embeddings.js. Used by the command palette and the
// AI chat for global search.

export interface SearchHit {
	id: string;
	score: number;
}

interface EmbeddingRecord {
	id: string;
	hash: string;
	vector: number[];
}

interface EmbeddingsBridge {
	embedText(texts: string[], kind: 'document' | 'query'): Promise<number[][]>;
	embedImage(dataUrls: string[]): Promise<number[][]>;
}

const IDB_KEY = 'muse:embeddings:v1';
const REINDEX_DEBOUNCE_MS = 2500;

function bridge(): EmbeddingsBridge | null {
	return (window as { embeddings?: EmbeddingsBridge }).embeddings ?? null;
}

export const embeddingState = $state({
	indexing: false,
	ready: false,
	error: '' as string,
});

const index = new Map<string, EmbeddingRecord>();
let loaded = false;

function contentHash(text: string): string {
	let hash = 5381;
	for (let i = 0; i < text.length; i++) {
		hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
	}
	return String(hash);
}

function embeddableText(obj: ObjectData): string | null {
	if (obj.type === 'note') return obj.body;
	if (obj.type === 'document') {
		const title = obj.title ?? '';
		return `${title}\n${obj.content}`.trim();
	}
	if (obj.type === 'bookmark') {
		return [obj.title, obj.description, obj.domain, obj.url].filter(Boolean).join('\n');
	}
	if (obj.type === 'folder') return obj.title;
	return null;
}

function embeddableImage(obj: ObjectData): string | null {
	if (obj.type !== 'media') return null;
	if (obj.mediaType !== 'image' && obj.mediaType !== 'gif') return null;
	if (!obj.src.startsWith('data:')) return null;
	return obj.src;
}

async function loadIndex(): Promise<void> {
	if (loaded) return;
	loaded = true;
	const stored = await idbGet<EmbeddingRecord[]>(IDB_KEY);
	for (const record of stored ?? []) index.set(record.id, record);
}

async function persistIndex(): Promise<void> {
	await idbPut(IDB_KEY, [...index.values()]);
}

interface PendingItem {
	id: string;
	hash: string;
	text?: string;
	image?: string;
}

function collectPending(): { pending: PendingItem[]; alive: Set<string> } {
	const pending: PendingItem[] = [];
	const alive = new Set<string>();

	for (const obj of canvas.objects) {
		const text = embeddableText(obj);
		const image = embeddableImage(obj);
		if (text == null && image == null) continue;
		if (text != null && !text.trim()) continue;

		alive.add(obj.id);
		const hash = contentHash(text ?? image!.slice(0, 4096));
		if (index.get(obj.id)?.hash === hash) continue;

		if (text != null) pending.push({ id: obj.id, hash, text });
		else pending.push({ id: obj.id, hash, image: image! });
	}

	return { pending, alive };
}

async function embedPending(pending: PendingItem[]): Promise<void> {
	const br = bridge();
	if (!br) return;

	const textItems = pending.filter((p) => p.text != null);
	const imageItems = pending.filter((p) => p.image != null);

	if (textItems.length > 0) {
		const vectors = await br.embedText(textItems.map((p) => p.text!), 'document');
		textItems.forEach((p, i) => index.set(p.id, { id: p.id, hash: p.hash, vector: vectors[i] }));
	}
	if (imageItems.length > 0) {
		const vectors = await br.embedImage(imageItems.map((p) => p.image!));
		imageItems.forEach((p, i) => index.set(p.id, { id: p.id, hash: p.hash, vector: vectors[i] }));
	}
}

let reindexTimer: ReturnType<typeof setTimeout> | null = null;
let reindexRunning = false;
let reindexQueued = false;

export async function reindexNow(): Promise<void> {
	if (reindexRunning) {
		reindexQueued = true;
		return;
	}
	reindexRunning = true;
	embeddingState.indexing = true;
	try {
		await loadIndex();
		const { pending, alive } = collectPending();

		for (const id of [...index.keys()]) {
			if (!alive.has(id)) index.delete(id);
		}
		if (pending.length > 0) await embedPending(pending);

		await persistIndex();
		embeddingState.ready = true;
		embeddingState.error = '';
	} catch (e) {
		embeddingState.error = e instanceof Error ? e.message : String(e);
	} finally {
		embeddingState.indexing = false;
		reindexRunning = false;
		if (reindexQueued) {
			reindexQueued = false;
			void reindexNow();
		}
	}
}

/** Call once from the page root — watches canvas objects and keeps the index fresh. */
export function startEmbeddingIndexer(): void {
	if (!bridge()) return;
	$effect(() => {
		// Touch the reactive fields the index depends on.
		for (const obj of canvas.objects) {
			if (obj.type === 'note') void obj.body;
			else if (obj.type === 'document') void obj.content, void obj.title;
			else if (obj.type === 'bookmark') void obj.title;
			else if (obj.type === 'folder') void obj.title;
			else if (obj.type === 'media') void obj.src;
		}
		if (reindexTimer) clearTimeout(reindexTimer);
		reindexTimer = setTimeout(() => void reindexNow(), REINDEX_DEBOUNCE_MS);
	});
}

function dot(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length && i < b.length; i++) sum += a[i] * b[i];
	return sum;
}

function excerptFor(obj: ObjectData): string | null {
	if (obj.type === 'note') return obj.body.slice(0, 700);
	if (obj.type === 'document') {
		return `${obj.title ?? 'Untitled'}\n${obj.content.slice(0, 1200)}`;
	}
	if (obj.type === 'bookmark') return [obj.title, obj.url].filter(Boolean).join(' — ');
	if (obj.type === 'folder') return obj.title;
	if (obj.type === 'media') return '(image on canvas)';
	return null;
}

/**
 * Formatted context block of the canvas content most relevant to a query,
 * for injection into the AI system prompt. Empty string when nothing relevant.
 */
export async function semanticContext(query: string, k = 5): Promise<string> {
	const hits = await semanticSearch(query, k);
	const sections: string[] = [];

	for (const hit of hits) {
		if (hit.score < 0.35) continue;
		const obj = canvas.objects.find((o) => o.id === hit.id);
		if (!obj) continue;
		const excerpt = excerptFor(obj);
		if (!excerpt) continue;
		sections.push(`### ${obj.type} id="${obj.id}" (relevance ${hit.score.toFixed(2)})\n${excerpt}`);
	}

	if (sections.length === 0) return '';
	return `\n\n## Relevant canvas content (semantic search for the latest user message)\n\n${sections.join('\n\n')}`;
}

/** Global semantic search over all indexed canvas objects. */
export async function semanticSearch(query: string, k = 8): Promise<SearchHit[]> {
	const br = bridge();
	if (!br || !query.trim()) return [];
	await loadIndex();

	const [queryVector] = await br.embedText([query], 'query');
	const hits: SearchHit[] = [];
	for (const record of index.values()) {
		hits.push({ id: record.id, score: dot(queryVector, record.vector) });
	}
	hits.sort((a, b) => b.score - a.score);
	return hits.slice(0, k);
}
