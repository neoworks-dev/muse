import { canvas, type ObjectData } from './state.svelte';
import { semanticSearch } from './embeddings.svelte';

// Answers MCP tool calls (search_canvas / get_canvas_object) forwarded from
// the Electron main process. See electron/mcp-canvas.js.

interface CanvasBridge {
	onRequest(handler: (method: string, params: Record<string, unknown>) => Promise<unknown>): void;
}

function searchExcerpt(obj: ObjectData): string | null {
	if (obj.type === 'document') return obj.content.slice(0, 1500);
	if (obj.type === 'note') return obj.body.slice(0, 700);
	if (obj.type === 'bookmark') return [obj.title, obj.description, obj.url].filter(Boolean).join('\n');
	if (obj.type === 'folder') return `Folder: ${obj.title}`;
	if (obj.type === 'media') return '(image on canvas)';
	return null;
}

function objectTitle(obj: ObjectData): string {
	if ('title' in obj && obj.title) return obj.title;
	if ('body' in obj) return obj.body.slice(0, 60);
	return obj.type;
}

async function handleSearch(params: Record<string, unknown>) {
	const query = String(params.query ?? '');
	const limit = Math.min(Number(params.limit ?? 6), 20);
	const hits = await semanticSearch(query, limit);

	const results = [];
	for (const hit of hits) {
		const obj = canvas.objects.find((o) => o.id === hit.id);
		if (!obj) continue;
		const excerpt = searchExcerpt(obj);
		if (excerpt == null) continue;
		results.push({
			id: obj.id,
			type: obj.type,
			title: objectTitle(obj),
			excerpt,
			relevance: Number(hit.score.toFixed(3)),
		});
	}
	return { results };
}

function handleGet(params: Record<string, unknown>) {
	const obj = canvas.objects.find((o) => o.id === String(params.id ?? ''));
	if (!obj) throw new Error(`No canvas object with id "${params.id}"`);

	if (obj.type === 'document') {
		return { id: obj.id, type: obj.type, title: obj.title ?? '', content: obj.content };
	}
	if (obj.type === 'note') {
		return { id: obj.id, type: obj.type, content: obj.body };
	}
	if (obj.type === 'bookmark') {
		return {
			id: obj.id,
			type: obj.type,
			title: obj.title,
			url: obj.url,
			description: obj.description ?? '',
		};
	}
	if (obj.type === 'folder') {
		const children = canvas.objects
			.filter((o) => 'parentId' in o && o.parentId === obj.id)
			.map((o) => ({ id: o.id, type: o.type, title: objectTitle(o) }));
		return { id: obj.id, type: obj.type, title: obj.title, children };
	}
	return { id: obj.id, type: obj.type };
}

export function startCanvasBridge(): void {
	const bridge = (window as { canvasBridge?: CanvasBridge }).canvasBridge;
	if (!bridge) return;

	bridge.onRequest(async (method, params) => {
		if (method === 'search') return handleSearch(params);
		if (method === 'get') return handleGet(params);
		throw new Error(`Unknown bridge method: ${method}`);
	});
}
