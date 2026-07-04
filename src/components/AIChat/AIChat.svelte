<script lang="ts">
	import { tick, onMount } from 'svelte';
	import { marked } from 'marked';
	import { streamCompletion } from '$lib/ai';
	import { semanticContext } from '$lib/embeddings.svelte';
	import { loadSettings } from '$lib/settings';
	import { webSearch } from '$lib/api/web-search';
	import Dropdown from '../Dropdown.svelte';
	import FloatingWindow from '../FloatingWindow.svelte';
	import type { EditorAnnot } from '$lib/editor-types';
	import type { ObjectData, MediaData, DocumentData, BookmarkData } from '$lib/state.svelte';
	import {
		loadAiState,
		scheduleAiSave,
		getActiveThreadId,
		setActiveThreadId,
		type ThreadRecord,
		type MemoryRecord
	} from '$lib/ai-sync';
	import type { SketchAction } from '$lib/sketch-types';
	import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
	import ArrowsOutIcon from 'phosphor-svelte/lib/ArrowsOutIcon';
	import ArrowsInIcon from 'phosphor-svelte/lib/ArrowsInIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTiltIcon';
	import SidebarSimpleIcon from 'phosphor-svelte/lib/SidebarSimpleIcon';
	import SlidersHorizontalIcon from 'phosphor-svelte/lib/SlidersHorizontalIcon';
	import PaperclipIcon from 'phosphor-svelte/lib/PaperclipIcon';
	import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import BrainIcon from 'phosphor-svelte/lib/BrainIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import GitForkIcon from 'phosphor-svelte/lib/GitForkIcon';
	import MagicWandIcon from 'phosphor-svelte/lib/MagicWandIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import NoteIcon from 'phosphor-svelte/lib/NoteIcon';
	import PencilRulerIcon from 'phosphor-svelte/lib/PencilRulerIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import StopCircleIcon from 'phosphor-svelte/lib/StopCircleIcon';
	import ArrowSquareInIcon from 'phosphor-svelte/lib/ArrowSquareInIcon';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import FrameCornersIcon from 'phosphor-svelte/lib/FrameCornersIcon';
	import ModelPicker from '../ModelPicker.svelte';

	type SketchResult = { dataUrl: string; reply: string; actions: SketchAction[] };

	let {
		open = $bindable(false),
		docText = '',
		docAnnots = [],
		canvasObjects = [] as ObjectData[],
		getScreenshot,
		pendingSketch = $bindable(null as SketchResult | null),
		onProposedDoc,
		onExecuteActions,
		onOpenDocument,
		onOpenUrl
	}: {
		open?: boolean;
		docText?: string;
		docAnnots?: EditorAnnot[];
		canvasObjects?: ObjectData[];
		getScreenshot?: () => string | null;
		pendingSketch?: SketchResult | null;
		onProposedDoc?: (text: string) => void;
		onExecuteActions?: (actions: SketchAction[]) => void | Promise<void>;
		onOpenDocument?: (id: string) => void;
		onOpenUrl?: (url: string, title: string) => void;
	} = $props();

	// ── Threads ───────────────────────────────────────────────────────────
	type MsgDoc = { name: string; content: string; id?: string };
	type MsgSource = { url: string; title: string; snippet?: string; autoOpen?: boolean };
	type MsgSearchResult = { url: string; title: string; snippet: string };
	type Msg = {
		role: 'user' | 'assistant';
		content: string;
		id: string;
		images?: string[];
		docs?: MsgDoc[];
		sources?: MsgSource[];
		searchQuery?: string;
		searchResults?: MsgSearchResult[];
	};
	type Thread = {
		id: string;
		name: string;
		messages: Msg[];
		parentThreadId?: string;
		parentMsgIdx?: number;
	};

	// ── Memory ────────────────────────────────────────────────────────────
	type Memory = { id: string; content: string; createdAt: number };
	let memories: Memory[] = $state([]);

	const firstId = crypto.randomUUID();
	let threads: Thread[] = $state([{ id: firstId, name: 'New chat', messages: [] }]);
	let activeThreadId: string = $state(firstId);
	let sidebarTab = $state<'threads' | 'memory'>('threads');
	let sidebarOpen = $state(false);
	let _persistReady = false;

	onMount(async () => {
		try {
			const { threads: saved, memories: savedMem } = await loadAiState();
			if (saved.length > 0) {
				threads = saved as Thread[];
				const savedActive = getActiveThreadId();
				activeThreadId = saved.some((t) => t.id === savedActive) ? savedActive! : saved[0].id;
			}
			if (savedMem.length > 0) memories = savedMem;
		} catch (e) {
			console.error('[ai-sync] load failed', e);
		}
		_persistReady = true;
	});

	// Process incoming sketch results from SketchOverlay
	$effect(() => {
		const sketch = pendingSketch;
		if (!sketch) return;
		pendingSketch = null;
		open = true;
		if (!activeThread || activeThread.messages.length > 0) {
			const id = crypto.randomUUID();
			threads = [...threads, { id, name: 'Sketch analysis', messages: [] }];
			activeThreadId = id;
		} else {
			threads = threads.map((t) =>
				t.id === activeThreadId ? { ...t, name: 'Sketch analysis' } : t
			);
		}
		const userMsg: Msg = {
			role: 'user',
			content: 'Sketch submitted for analysis',
			images: [sketch.dataUrl],
			id: crypto.randomUUID()
		};
		const parsed = _parseResponse(sketch.reply);
		const assistantMsg: Msg = {
			role: 'assistant',
			content: parsed.clean,
			id: crypto.randomUUID()
		};
		threads = threads.map((t) =>
			t.id === activeThreadId ? { ...t, messages: [userMsg, assistantMsg] } : t
		);
		if (parsed.canvasActions.length > 0) {
			_pendingActions = { actions: parsed.canvasActions, msgId: assistantMsg.id };
		}
		tick().then(scrollBottom);
	});

	let _saveTimer: ReturnType<typeof setTimeout> | null = null;
	function _scheduleSave() {
		if (!_persistReady) return;
		if (_saveTimer) clearTimeout(_saveTimer);
		_saveTimer = setTimeout(() => {
			_saveTimer = null;
			setActiveThreadId(activeThreadId);
			scheduleAiSave(
				$state.snapshot(threads) as ThreadRecord[],
				$state.snapshot(memories) as MemoryRecord[]
			);
		}, 1000);
	}

	$effect(() => {
		threads;
		activeThreadId;
		memories;
		_scheduleSave();
	});

	function addMemory(content: string) {
		memories = [...memories, { id: crypto.randomUUID(), content, createdAt: Date.now() }];
	}

	function deleteMemory(id: string) {
		memories = memories.filter((m) => m.id !== id);
	}

	// ── Pending canvas actions ────────────────────────────────────────────
	let _pendingActions = $state<{ actions: SketchAction[]; msgId: string } | null>(null);
	let _executingActions = $state(false);
	let _generatingForMsgId = $state<string | null>(null);

	const activeThread = $derived(threads.find((t) => t.id === activeThreadId)!);

	type TreeNode = { thread: Thread; depth: number; isLast: boolean; parentHasMore: boolean[] };
	const treeNodes = $derived.by<TreeNode[]>(() => {
		const ROOT = '__root__';
		const childMap = new Map<string, Thread[]>();
		for (const t of threads) {
			const key = t.parentThreadId ?? ROOT;
			if (!childMap.has(key)) childMap.set(key, []);
			childMap.get(key)!.push(t);
		}
		const result: TreeNode[] = [];
		function walk(parentId: string, depth: number, parentHasMore: boolean[]) {
			const children = childMap.get(parentId) ?? [];
			children.forEach((t, idx) => {
				const isLast = idx === children.length - 1;
				result.push({ thread: t, depth, isLast, parentHasMore });
				walk(t.id, depth + 1, [...parentHasMore, !isLast]);
			});
		}
		walk(ROOT, 0, []);
		return result;
	});

	function newThread() {
		const id = crypto.randomUUID();
		threads = [...threads, { id, name: 'New chat', messages: [] }];
		activeThreadId = id;
	}

	function switchThread(id: string) {
		activeThreadId = id;
	}

	function deleteThread(id: string) {
		const toDelete = new Set<string>();
		function mark(tid: string) {
			toDelete.add(tid);
			for (const t of threads) {
				if (t.parentThreadId === tid) mark(t.id);
			}
		}
		mark(id);
		const remaining = threads.filter((t) => !toDelete.has(t.id));
		if (remaining.length === 0) {
			const newId = crypto.randomUUID();
			threads = [{ id: newId, name: 'New chat', messages: [] }];
			activeThreadId = newId;
		} else {
			threads = remaining;
			if (toDelete.has(activeThreadId)) activeThreadId = remaining[0].id;
		}
	}

	function branchThread(upToMsgIdx: number) {
		const source = activeThread;
		const branchedMsgs = source.messages.slice(0, upToMsgIdx + 1);
		const snippet = [...branchedMsgs].reverse().find((m) => m.role === 'assistant')?.content ?? '';
		const name =
			'Branch: ' +
			snippet
				.replace(/[#*`\n]/g, ' ')
				.trim()
				.slice(0, 30) +
			'…';
		const id = crypto.randomUUID();
		threads = [
			...threads,
			{ id, name, messages: branchedMsgs, parentThreadId: source.id, parentMsgIdx: upToMsgIdx }
		];
		activeThreadId = id;
	}

	// ── AI options ────────────────────────────────────────────────────────
	let thinking = $state(false);
	let imageGen = $state(false);
	let modelOverride = $state('');

	const currentSettings = $derived.by(() => {
		try {
			return loadSettings();
		} catch {
			return null;
		}
	});

	const defaultModel = $derived(currentSettings?.model || 'default');

	// ── Attachments ───────────────────────────────────────────────────────
	type Attachment = {
		id: string;
		name: string;
		kind: 'image' | 'doc';
		content: string;
		preview?: string;
		canvasId?: string;
	};
	let attachments: Attachment[] = $state([]);

	function removeAttachment(id: string) {
		attachments = attachments.filter((a) => a.id !== id);
	}

	function onImageChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			attachments = [
				...attachments,
				{
					id: crypto.randomUUID(),
					name: file.name,
					kind: 'image',
					content: reader.result as string,
					preview: reader.result as string
				}
			];
		};
		reader.readAsDataURL(file);
		(e.target as HTMLInputElement).value = '';
	}

	async function onDocChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const text = await file.text();
		attachments = [
			...attachments,
			{ id: crypto.randomUUID(), name: file.name, kind: 'doc', content: text }
		];
		(e.target as HTMLInputElement).value = '';
	}

	// ── Chat state ────────────────────────────────────────────────────────
	let input = $state('');
	let streaming = $state('');
	let loading = $state(false);
	let applyLoading = $state(false);
	let _searching = $state(false);
	let err = $state('');
	let scrollEl: HTMLDivElement | undefined = $state();
	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let fileImageInput: HTMLInputElement | undefined = $state();
	let fileDocInput: HTMLInputElement | undefined = $state();

	// ── Abort / edit / copy ───────────────────────────────────────────────
	let _abortController: AbortController | null = null;
	let _editingMsgId = $state<string | null>(null);
	let _editingMsgText = $state('');

	function stopStreaming() {
		_abortController?.abort();
	}

	function startEditMsg(idx: number) {
		const msg = activeThread.messages[idx];
		if (msg.role !== 'user') return;
		_editingMsgId = msg.id;
		_editingMsgText = msg.content;
	}

	function cancelEdit() {
		_editingMsgId = null;
		_editingMsgText = '';
	}

	async function confirmEdit(idx: number) {
		const newContent = _editingMsgText.trim();
		if (!newContent) {
			cancelEdit();
			return;
		}
		_editingMsgId = null;
		_editingMsgText = '';

		const tid = activeThreadId;
		const msgs = activeThread.messages.slice(0, idx);
		const editedMsg: Msg = { ...activeThread.messages[idx], content: newContent };
		threads = threads.map((t) => (t.id === tid ? { ...t, messages: [...msgs, editedMsg] } : t));
		await _runCompletion(tid);
	}

	function attachCanvas() {
		const dataUrl = getScreenshot?.();
		if (!dataUrl) return;
		attachments = [
			...attachments,
			{
				id: crypto.randomUUID(),
				name: 'canvas-view.jpg',
				kind: 'image',
				content: dataUrl,
				preview: dataUrl
			}
		];
	}

	const canvasImages = $derived(
		canvasObjects.filter(
			(o): o is MediaData => o.type === 'media' && (o as MediaData).mediaType === 'image'
		)
	);
	const canvasDocs = $derived(
		canvasObjects.filter((o): o is DocumentData => o.type === 'document')
	);
	const canvasBookmarks = $derived(
		canvasObjects.filter((o): o is BookmarkData => o.type === 'bookmark')
	);

	function attachCanvasImage(obj: MediaData) {
		attachments = [
			...attachments,
			{
				id: crypto.randomUUID(),
				name: 'canvas-image.jpg',
				kind: 'image',
				content: obj.src,
				preview: obj.src
			}
		];
	}

	function attachCanvasDoc(obj: DocumentData) {
		attachments = [
			...attachments,
			{
				id: crypto.randomUUID(),
				name: obj.title || 'Document',
				kind: 'doc',
				content: obj.content,
				canvasId: obj.id
			}
		];
	}

	function attachCanvasBookmark(obj: BookmarkData) {
		const content = [obj.title, obj.url, obj.description].filter(Boolean).join('\n');
		attachments = [
			...attachments,
			{ id: crypto.randomUUID(), name: obj.title || obj.domain || 'Bookmark', kind: 'doc', content }
		];
	}

	function copyMsg(content: string) {
		navigator.clipboard.writeText(content).catch(() => {});
	}

	function appendToDoc(content: string) {
		if (!onProposedDoc) return;
		onProposedDoc(docText.trimEnd() + '\n\n---\n\n' + content);
	}

	// ── System prompt ─────────────────────────────────────────────────────

	function buildSystemPrompt() {
		let sys =
			'You are a helpful AI assistant built into Muse, a visual canvas workspace. Help users think through ideas, organize their canvas, and answer questions concisely. Format responses in markdown.';

		if (memories.length > 0) {
			sys += `\n\n## Your memories\n\n${memories.map((m) => `- ${m.content}`).join('\n')}`;
		}

		// Provide IDs so canvas actions can reference objects
		const actionable = canvasObjects.filter((o) => o.type !== 'stroke' && o.type !== 'link');
		if (actionable.length > 0) {
			const idList = actionable
				.map((o) => {
					const label =
						'title' in o
							? (o as { title: string }).title
							: 'body' in o
								? (o as { body: string }).body.slice(0, 50)
								: o.type;
					return `- ${o.type} id="${o.id}" label="${label}"`;
				})
				.join('\n');
			sys += `\n\n## Canvas object IDs (use when targeting canvas actions)\n${idList}`;
		}

		if (onProposedDoc) {
			sys += `\n\n## Open document\n\n${docText || '(empty document)'}`;
			const notes = docAnnots
				.filter((a) => a.note)
				.map((a) => `"${a.quote}" → ${a.note}`)
				.join('\n');
			if (notes) sys += `\n\nDocument annotations:\n${notes}`;
		}

		sys += `\n\n## Special output tags

To remember something across conversations, include anywhere in your response:
<remember>text to remember</remember>

To modify the canvas, append a JSON block at the end of your response:
<canvas-actions>
[{"type":"move_element","id":"<object-id>","x":100,"y":200}]
</canvas-actions>

Canvas action types:
- move_element: { id, x, y }
- add_note: { x, y, body }
- create_link: { sourceId, targetId, label? }
- group_elements: { ids: string[], title: string }
- generate_image: { prompt: string, x?: number, y?: number } — generate an image with DALL-E and place it on the canvas
- open_document: { id: string } — open a canvas document by its ID
- create_document: { title?: string, content?: string, x?: number, y?: number } — create a new document on the canvas with optional markdown content
- place_image: { url: string, x?: number, y?: number } — place an image from a URL onto the canvas

To search the web, include this tag (intercepted before display):
<web-search>your search query</web-search>

After results arrive you will be asked to respond again. Cite results using:
<sources>
[{"url":"https://...","title":"Page title","snippet":"brief description","autoOpen":false}]
</sources>
Set autoOpen:true on the single most relevant result to open it automatically.

Only include canvas-actions / remember / web-search tags when genuinely needed.`;

		return sys;
	}

	const _SPECIAL_TAGS = ['remember', 'canvas-actions', 'web-search', 'sources'];

	function _filterStreaming(text: string): string {
		let out = text;
		// Strip complete tags
		for (const tag of _SPECIAL_TAGS) {
			out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'), '');
		}
		// Cut from any unclosed opening tag (content still streaming in)
		for (const tag of _SPECIAL_TAGS) {
			const idx = out.lastIndexOf(`<${tag}>`);
			if (idx !== -1) out = out.slice(0, idx);
		}
		// Cut trailing partial tag name (e.g. "<canvas-act" not yet complete)
		const lastLt = out.lastIndexOf('<');
		if (lastLt !== -1 && !out.slice(lastLt).includes('>')) {
			out = out.slice(0, lastLt);
		}
		return out;
	}

	function _parseResponse(text: string): {
		clean: string;
		newMemories: string[];
		canvasActions: SketchAction[];
		sources: MsgSource[];
		webSearchQuery: string | null;
	} {
		const newMemories: string[] = [];
		const canvasActions: SketchAction[] = [];
		const sources: MsgSource[] = [];
		let webSearchQuery: string | null = null;

		let clean = text.replace(/<remember>([\s\S]*?)<\/remember>/g, (_, c) => {
			newMemories.push(c.trim());
			return '';
		});

		clean = clean.replace(/<canvas-actions>([\s\S]*?)<\/canvas-actions>/g, (_, c) => {
			try {
				const parsed = JSON.parse(c.trim());
				if (Array.isArray(parsed)) canvasActions.push(...(parsed as SketchAction[]));
			} catch {}
			return '';
		});

		clean = clean.replace(/<web-search>([\s\S]*?)<\/web-search>/g, (_, q) => {
			webSearchQuery = q.trim();
			return '';
		});

		clean = clean.replace(/<sources>([\s\S]*?)<\/sources>/g, (_, c) => {
			try {
				const parsed = JSON.parse(c.trim());
				if (Array.isArray(parsed)) sources.push(...(parsed as MsgSource[]));
			} catch {}
			return '';
		});

		return { clean: clean.trim(), newMemories, canvasActions, sources, webSearchQuery };
	}

	// ── Core completion ───────────────────────────────────────────────────

	async function _runCompletion(tid: string) {
		loading = true;
		streaming = '';
		_abortController = new AbortController();
		await tick();
		scrollBottom();

		let partial = '';
		try {
			const thread = threads.find((t) => t.id === tid)!;
			// Only send images on the last message — history images would be too expensive
			const history = thread.messages.map((m, i) => {
				let content = m.content;
				if (m.docs?.length) {
					const block = m.docs
						.map((d) => `**File: ${d.name}**\n\`\`\`\n${d.content.slice(0, 8000)}\n\`\`\``)
						.join('\n\n');
					content = block + (content ? '\n\n---\n\n' + content : '');
				}
				if (m.searchResults?.length) {
					const block = m.searchResults
						.map((r, j) => `[${j + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
						.join('\n\n');
					content += `\n\n[Web search results for "${m.searchQuery}":\n${block}\nAnswer using these results and include a <sources> tag.]`;
				}
				return {
					role: m.role,
					content,
					images: i === thread.messages.length - 1 ? m.images : undefined
				};
			});
			const lastUser = [...thread.messages].reverse().find((m) => m.role === 'user');
			let retrieved = '';
			if (lastUser?.content) {
				try {
					retrieved = await semanticContext(lastUser.content);
				} catch {}
			}
			for await (const chunk of streamCompletion(
				history,
				buildSystemPrompt() + retrieved,
				_abortController.signal,
				modelOverride || undefined
			)) {
				partial += chunk;
				streaming = _filterStreaming(partial);
				await tick();
				scrollBottom();
			}
		} catch (e: unknown) {
			if (!(e instanceof Error && e.name === 'AbortError')) {
				err = e instanceof Error ? e.message : String(e);
			}
		} finally {
			_abortController = null;
			if (partial) {
				const { clean, newMemories, canvasActions, sources, webSearchQuery } =
					_parseResponse(partial);
				for (const m of newMemories) addMemory(m);

				// Web search pass — perform search, then do a second completion
				if (webSearchQuery) {
					streaming = '';
					loading = false;
					await _runWebSearch(tid, webSearchQuery);
					return;
				}

				const msgId = crypto.randomUUID();
				threads = threads.map((t) =>
					t.id === tid
						? {
								...t,
								messages: [
									...t.messages,
									{
										role: 'assistant' as const,
										content: clean,
										id: msgId,
										sources: sources.length > 0 ? sources : undefined
									}
								]
							}
						: t
				);
				if (canvasActions.length > 0) {
					_pendingActions = { actions: canvasActions, msgId };
				}
				// Auto-open the source marked autoOpen
				const autoSrc = sources.find((s) => s.autoOpen);
				if (autoSrc) onOpenUrl?.(autoSrc.url, autoSrc.title);
			}
			streaming = '';
			loading = false;
			await tick();
			scrollBottom();
		}
	}

	async function _runWebSearch(tid: string, query: string) {
		_searching = true;
		loading = true;
		let results: MsgSearchResult[] = [];
		if (loadSettings().searchProvider !== 'none') {
			try {
				results = await webSearch(query, loadSettings());
			} catch (e) {
				err = `Search failed: ${e instanceof Error ? e.message : String(e)}`;
			}
		}
		_searching = false;

		// Attach results to the last user message — no synthetic message added
		threads = threads.map((t) => {
			if (t.id !== tid) return t;
			const msgs = [...t.messages];
			const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user');
			if (lastUserIdx >= 0) {
				msgs[lastUserIdx] = { ...msgs[lastUserIdx], searchQuery: query, searchResults: results };
			}
			return { ...t, messages: msgs };
		});

		await _runCompletion(tid);
	}

	async function send() {
		const text = input.trim();
		if (!text || loading) return;
		input = '';
		err = '';
		autoResizeTextarea();

		const docs = attachments.filter((a) => a.kind === 'doc');
		const imgs = attachments.filter((a) => a.kind === 'image');
		attachments = [];

		if (activeThread.messages.length === 0) {
			const name = text.slice(0, 42) + (text.length > 42 ? '…' : '');
			threads = threads.map((t) => (t.id === activeThreadId ? { ...t, name } : t));
		}

		const userMsg: Msg = {
			role: 'user',
			content: text,
			id: crypto.randomUUID(),
			images: imgs.length > 0 ? imgs.map((a) => a.content) : undefined,
			docs:
				docs.length > 0
					? docs.map((a) => ({ name: a.name, content: a.content, id: a.canvasId }))
					: undefined
		};
		threads = threads.map((t) =>
			t.id === activeThreadId ? { ...t, messages: [...t.messages, userMsg] } : t
		);

		await _runCompletion(activeThreadId);
	}

	async function applyToDoc() {
		if (!onProposedDoc || applyLoading || loading) return;
		const text = input.trim();
		if (!text) return;

		applyLoading = true;
		input = '';
		autoResizeTextarea();

		const uid = crypto.randomUUID();
		threads = threads.map((t) =>
			t.id === activeThreadId
				? { ...t, messages: [...t.messages, { role: 'user', content: text, id: uid }] }
				: t
		);

		if (activeThread.messages.length === 1) {
			threads = threads.map((t) =>
				t.id === activeThreadId ? { ...t, name: text.slice(0, 42) } : t
			);
		}

		streaming = '';
		const tid = activeThreadId;
		const applySys = `You are a document editor. The user wants you to revise the document below based on their instructions.
Return your response in two parts:
1. One sentence explaining what you changed.
2. The complete revised document wrapped exactly like:
\`\`\`document
...revised content here...
\`\`\`

Current document:
${docText}`;

		try {
			const history = activeThread.messages.map((m) => ({ role: m.role, content: m.content }));
			let fullResponse = '';
			for await (const chunk of streamCompletion(history, applySys, undefined, modelOverride || undefined)) {
				fullResponse += chunk;
				streaming = fullResponse;
				await tick();
				scrollBottom();
			}
			threads = threads.map((t) =>
				t.id === tid
					? {
							...t,
							messages: [
								...t.messages,
								{ role: 'assistant', content: fullResponse, id: crypto.randomUUID() }
							]
						}
					: t
			);
			const match = fullResponse.match(/```document\n([\s\S]*?)```/);
			if (match) onProposedDoc(match[1].trimEnd());
		} catch (e: unknown) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			streaming = '';
			applyLoading = false;
			await tick();
			scrollBottom();
		}
	}

	function scrollBottom() {
		if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
	}

	function autoResizeTextarea() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 128) + 'px';
	}

	function onKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			send();
		}
	}

	function md(src: string): string {
		return marked(src, { async: false }) as string;
	}
</script>

<FloatingWindow
	bind:open
	width={460}
	height={580}
	minwidth={300}
	minheight={380}
	x={999999}
	zIndex={55}
	storageKey="aichat:fs"
>
	{#snippet children({ fullscreen, startDrag, moveDrag, endDrag, toggleFullscreen })}
		<!-- Title bar -->
		<div
			class="border-base-200 flex h-9 shrink-0 items-center gap-0.5 border-b px-1.5 {fullscreen
				? ''
				: 'cursor-grab active:cursor-grabbing'}"
			onpointerdown={startDrag}
			onpointermove={moveDrag}
			onpointerup={endDrag}
			role="presentation"
		>
			<button
				class="btn btn-square btn-ghost btn-xs {sidebarOpen
					? 'text-primary'
					: 'text-base-content/40'}"
				onclick={() => (sidebarOpen = !sidebarOpen)}
				title="Threads"
			>
				<SidebarSimpleIcon size={14} />
			</button>

			<div class="flex flex-1 items-center justify-center select-none">
				{#if onProposedDoc}
					<span class="text-primary/60 text-[13px] font-medium">Document context active</span>
				{:else}
					<SparkleIcon size={13} weight="fill" class="text-primary/50" />
				{/if}
			</div>

			<button
				class="btn btn-square text-base-content/40 btn-ghost btn-xs"
				onclick={toggleFullscreen}
				title={fullscreen ? 'Restore' : 'Fullscreen'}
			>
				{#if fullscreen}<ArrowsInIcon size={13} />{:else}<ArrowsOutIcon size={13} />{/if}
			</button>
			<button
				class="btn btn-square text-base-content/40 btn-ghost btn-xs hover:bg-error/10 hover:text-error"
				onclick={() => {
					open = false;
				}}
				title="Close"
			>
				<XIcon size={13} />
			</button>
		</div>

		<!-- Body -->
		<div class="flex min-h-0 flex-1">
			<!-- Sidebar -->
			{#if sidebarOpen}
				<div
					class="border-base-200 bg-base-200/50 flex w-44 shrink-0 flex-col overflow-hidden border-r"
				>
					<div class="border-base-200 flex shrink-0 border-b">
						<button
							class="flex flex-1 items-center justify-center gap-1 py-1.5 text-[13px] font-medium transition-colors {sidebarTab ===
							'threads'
								? 'border-primary text-primary border-b-2'
								: 'text-base-content/40 hover:text-base-content/70'}"
							onclick={() => (sidebarTab = 'threads')}
						>
							<GitForkIcon size={10} /> Threads
						</button>
						<button
							class="flex flex-1 items-center justify-center gap-1 py-1.5 text-[13px] font-medium transition-colors {sidebarTab ===
							'memory'
								? 'border-primary text-primary border-b-2'
								: 'text-base-content/40 hover:text-base-content/70'}"
							onclick={() => (sidebarTab = 'memory')}
						>
							<NoteIcon size={10} /> Memory
							{#if memories.length > 0}
								<span class="bg-primary/20 text-primary rounded-full px-1">{memories.length}</span>
							{/if}
						</button>
					</div>

					{#if sidebarTab === 'threads'}
						<div class="flex-1 overflow-y-auto py-0.5">
							{#each treeNodes as node (node.thread.id)}
								{@const isActive = node.thread.id === activeThreadId}
								{@const STEP = 14}
								{@const MID = 16}
								{@const H = 32}
								{@const col = (d: number) => d * STEP + 8}
								{@const svgW = node.depth * STEP + STEP}
								<div
									class="group/thread hover:bg-base-content/5 relative flex w-full cursor-pointer items-center transition-colors {isActive
										? 'bg-primary/10 text-primary'
										: 'text-base-content/60'}"
									role="button"
									tabindex={0}
									onclick={() => switchThread(node.thread.id)}
									onkeydown={(e) => e.key === 'Enter' && switchThread(node.thread.id)}
								>
									{#if node.depth > 0}
										<svg
											class="pointer-events-none absolute top-0 left-0 h-full shrink-0"
											width={svgW}
											viewBox="0 0 {svgW} {H}"
											preserveAspectRatio="none"
										>
											{#each node.parentHasMore as hasMore, lvl}
												{#if hasMore}
													<line
														x1={col(lvl)}
														y1={0}
														x2={col(lvl)}
														y2={H}
														stroke="oklch(from var(--color-base-content) l c h / 12%)"
														stroke-width="1"
													/>
												{/if}
											{/each}
											<line
												x1={col(node.depth - 1)}
												y1={0}
												x2={col(node.depth - 1)}
												y2={MID}
												stroke="oklch(from var(--color-base-content) l c h / 12%)"
												stroke-width="1"
											/>
											{#if !node.isLast}
												<line
													x1={col(node.depth - 1)}
													y1={MID}
													x2={col(node.depth - 1)}
													y2={H}
													stroke="oklch(from var(--color-base-content) l c h / 12%)"
													stroke-width="1"
												/>
											{/if}
											<line
												x1={col(node.depth - 1)}
												y1={MID}
												x2={svgW - 2}
												y2={MID}
												stroke="oklch(from var(--color-base-content) l c h / 12%)"
												stroke-width="1"
											/>
										</svg>
									{/if}
									<span
										class="line-clamp-1 flex-1 py-1.5 text-[13px] leading-snug"
										style:padding-left="{node.depth > 0 ? svgW + 4 : 10}px"
									>
										{node.thread.name}
									</span>
									<button
										class="text-base-content/20 hover:text-error mr-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover/thread:opacity-100"
										onclick={(e) => {
											e.stopPropagation();
											deleteThread(node.thread.id);
										}}
										title="Delete thread"
									>
										<TrashIcon size={10} />
									</button>
								</div>
							{/each}
						</div>
						<div class="border-base-200 shrink-0 border-t p-1.5">
							<button
								class="btn btn-ghost btn-xs text-base-content/40 w-full justify-start gap-1.5"
								onclick={newThread}
							>
								<PlusIcon size={11} weight="bold" /> New chat
							</button>
						</div>
					{:else}
						<!-- Memory tab -->
						<div class="flex-1 overflow-y-auto py-1">
							{#if memories.length === 0}
								<p class="text-base-content/30 px-3 py-4 text-center text-[13px] leading-relaxed">
									No memories yet.<br />Ask the AI to remember something.
								</p>
							{:else}
								{#each memories as mem (mem.id)}
									<div class="group/mem flex items-start gap-1.5 px-2 py-1.5">
										<p class="text-base-content/70 flex-1 text-[13px] leading-snug break-words">
											{mem.content}
										</p>
										<button
											class="text-base-content/20 hover:text-error mt-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover/mem:opacity-100"
											onclick={() => deleteMemory(mem.id)}
											title="Forget"
										>
											<TrashIcon size={10} />
										</button>
									</div>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Messages -->
			<div bind:this={scrollEl} class="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3">
				{#if activeThread.messages.length === 0 && !streaming && !loading}
					<div class="text-base-content/40 flex h-full flex-col items-center justify-center gap-3">
						<SparkleIcon size={28} weight="fill" class="text-primary/30" />
						<p class="text-center text-xs leading-relaxed">
							{#if onProposedDoc}
								Ask anything about your document<br />or request changes.
							{:else}
								Ask anything about your canvas<br />or let me help you think.
							{/if}
						</p>
					</div>
				{/if}

				{#each activeThread.messages as msg, i (msg.id)}
					{#if msg.role === 'user'}
						<div class="flex flex-col items-end gap-1.5">
							{#if msg.images?.length}
								<div class="flex flex-wrap justify-end gap-1.5">
									{#each msg.images as img}
										<img
											src={img}
											alt=""
											class="border-base-200 max-h-36 max-w-[220px] rounded-xl border object-contain shadow-sm"
										/>
									{/each}
								</div>
							{/if}
							{#if msg.docs?.length}
								<div class="flex flex-wrap justify-end gap-1.5">
									{#each msg.docs as doc}
										<button
											class="bg-base-200 border-base-300 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-colors {doc.id
												? 'hover:bg-base-300 cursor-pointer'
												: 'cursor-default'}"
											onclick={() => doc.id && onOpenDocument?.(doc.id)}
											disabled={!doc.id || !onOpenDocument}
										>
											<FileTextIcon size={11} class="text-base-content/50 shrink-0" />
											<span class="text-base-content/70 max-w-[140px] truncate text-[13px]"
												>{doc.name}</span
											>
										</button>
									{/each}
								</div>
							{/if}
							{#if msg.searchQuery}
								<div class="flex justify-end">
									<div class="bg-base-200 border-base-300 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5">
										<ArrowSquareOutIcon size={11} class="text-base-content/40 shrink-0" />
										<span class="text-base-content/50 text-[13px]">Searched: <span class="text-base-content/70 font-medium">{msg.searchQuery}</span></span>
										{#if msg.searchResults?.length}
											<span class="text-base-content/30 text-[13px]">· {msg.searchResults.length} results</span>
										{/if}
									</div>
								</div>
							{/if}
							<div class="group/umsg flex items-end gap-1">
								<div
									class="mb-0.5 flex flex-col gap-0.5 opacity-0 transition-opacity group-hover/umsg:opacity-100"
								>
									<button
										class="btn btn-ghost btn-xs text-base-content/30 hover:text-base-content/60 !p-1"
										onclick={() => startEditMsg(i)}
										title="Edit message"
									>
										<PencilSimpleIcon size={10} />
									</button>
									<button
										class="btn btn-ghost btn-xs text-base-content/30 hover:text-base-content/60 !p-1"
										onclick={() => copyMsg(msg.content)}
										title="Copy message"
									>
										<CopyIcon size={10} />
									</button>
								</div>
								{#if _editingMsgId === msg.id}
									<div class="flex flex-col gap-1.5" style="max-width: 82%">
										<textarea
											bind:value={_editingMsgText}
											class="border-primary/30 bg-primary/10 text-base-content w-full resize-none rounded-2xl rounded-br-sm border px-3 py-2 text-[13px] outline-none"
											rows={3}
											onkeydown={(e) => {
												if (e.key === 'Escape') {
													e.preventDefault();
													cancelEdit();
												}
												if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
													e.preventDefault();
													confirmEdit(i);
												}
											}}
										></textarea>
										<div class="flex justify-end gap-1">
											<button onclick={cancelEdit} class="btn btn-ghost btn-xs text-base-content/50"
												>Cancel</button
											>
											<button onclick={() => confirmEdit(i)} class="btn btn-primary btn-xs"
												>Send</button
											>
										</div>
									</div>
								{:else}
									<p
										class="bg-primary text-primary-content max-w-[82%] rounded-2xl rounded-tr-sm px-3 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap select-text"
									>
										{msg.content}
									</p>
								{/if}
							</div>
						</div>
					{:else}
						<div class="group/msg flex flex-col gap-1">
							<div class="flex items-start gap-2">
								<div
									class="bg-primary/10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
								>
									<SparkleIcon size={9} weight="fill" class="text-primary" />
								</div>
								<div
									class="prose prose-sm max-w-none flex-1 select-text [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-[13px] [&_h2]:font-semibold [&_h3]:text-[13px] [&_h3]:font-semibold [&_li]:text-[13px] [&_p]:my-1 [&_p]:text-[13px] [&_pre]:text-[13px]"
								>
									{@html md(msg.content)}
								</div>
							</div>
							<div
								class="ml-6 flex gap-0.5 opacity-0 transition-opacity duration-100 group-hover/msg:opacity-100"
							>
								<button
									class="btn btn-ghost btn-xs text-base-content/30 gap-1"
									onclick={() => copyMsg(msg.content)}
									title="Copy"
								>
									<CopyIcon size={10} /> Copy
								</button>
								{#if onProposedDoc}
									<button
										class="btn btn-ghost btn-xs text-base-content/30 gap-1"
										onclick={() => appendToDoc(msg.content)}
										title="Append to document"
									>
										<ArrowSquareInIcon size={10} /> To doc
									</button>
								{/if}
								<button
									class="btn btn-ghost btn-xs text-base-content/30 gap-1"
									onclick={() => branchThread(i)}
									title="Branch conversation from here"
								>
									<GitForkIcon size={10} weight="bold" /> Branch
								</button>
							</div>
							{#if msg.sources?.length}
								<div class="mt-1 ml-6 flex flex-col gap-1">
									{#each msg.sources as src}
										<button
											class="bg-base-200/60 border-base-300 hover:bg-base-200 flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors"
											onclick={() => onOpenUrl?.(src.url, src.title)}
										>
											<ArrowSquareOutIcon size={11} class="text-primary/50 mt-0.5 shrink-0" />
											<div class="min-w-0">
												<p
													class="text-base-content/80 truncate text-[13px] leading-tight font-medium"
												>
													{src.title}
												</p>
												{#if src.snippet}
													<p
														class="text-base-content/40 mt-0.5 line-clamp-1 text-[13px] leading-snug"
													>
														{src.snippet}
													</p>
												{/if}
												<p class="text-primary/50 mt-0.5 truncate text-[13px]">{src.url}</p>
											</div>
										</button>
									{/each}
								</div>
							{/if}
							{#if _pendingActions && _pendingActions.msgId === msg.id}
								{@const hasImageGen = _pendingActions.actions.some(
									(a) => a.type === 'generate_image'
								)}
								{@const count = _pendingActions.actions.length}
								<div
									class="border-primary/20 bg-primary/5 ml-6 flex items-center gap-2 rounded-lg border px-2 py-1.5"
								>
									{#if hasImageGen}
										<ImageIcon size={11} class="text-primary/60" />
									{:else}
										<PencilRulerIcon size={11} class="text-primary/60" />
									{/if}
									<span class="text-primary/70 flex-1 text-[13px]">
										{#if hasImageGen && count === 1}
											Generate image with DALL-E
										{:else if hasImageGen}
											{count} actions incl. image generation
										{:else}
											{count} canvas action{count !== 1 ? 's' : ''} proposed
										{/if}
									</span>
									{#if _executingActions}
										<CircleNotchIcon size={11} class="text-primary/60 animate-spin" />
									{:else}
										<button
											onclick={async () => {
												const { actions: acts, msgId } = _pendingActions!;
												const hasImg = acts.some((a) => a.type === 'generate_image');
												_executingActions = true;
												if (hasImg) _generatingForMsgId = msgId;
												_pendingActions = null;
												try {
													await onExecuteActions?.(acts);
												} finally {
													_executingActions = false;
													_generatingForMsgId = null;
												}
											}}
											class="btn btn-primary btn-xs gap-1"
										>
											<CheckIcon size={10} /> Apply
										</button>
										<button
											onclick={() => (_pendingActions = null)}
											class="btn btn-ghost btn-xs text-base-content/40">Dismiss</button
										>
									{/if}
								</div>
							{/if}
							{#if _generatingForMsgId === msg.id}
								<div
									class="border-base-200 bg-base-100 ml-6 flex items-center gap-2 rounded-lg border px-3 py-2 shadow-sm"
								>
									<div class="bg-base-200 relative h-8 w-8 shrink-0 overflow-hidden rounded-md">
										<div
											class="via-base-300/60 absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent to-transparent"
										></div>
									</div>
									<div class="flex flex-1 flex-col gap-1">
										<div class="bg-base-200 relative h-2 w-24 overflow-hidden rounded-full">
											<div
												class="via-base-300/60 absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent to-transparent"
											></div>
										</div>
										<span class="text-base-content/40 text-[13px]"
											>Generating image with DALL-E…</span
										>
									</div>
									<CircleNotchIcon size={13} class="text-base-content/30 shrink-0 animate-spin" />
								</div>
							{/if}
						</div>
					{/if}
				{/each}

				{#if streaming}
					<div class="flex items-start gap-2">
						<div
							class="bg-primary/10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
						>
							<SparkleIcon size={9} weight="fill" class="text-primary" />
						</div>
						<div
							class="prose prose-sm max-w-none flex-1 select-text [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-[13px] [&_h2]:font-semibold [&_h3]:text-[13px] [&_h3]:font-semibold [&_li]:text-[13px] [&_p]:my-1 [&_p]:text-[13px] [&_pre]:text-[13px]"
						>
							{@html md(streaming)}<span class="not-prose animate-pulse opacity-60">▋</span>
						</div>
						<button
							onclick={stopStreaming}
							class="text-base-content/30 hover:bg-error/10 hover:text-error mt-0.5 shrink-0 rounded p-1 transition-colors"
							title="Stop generating"
						>
							<StopCircleIcon size={13} />
						</button>
					</div>
				{:else if loading || applyLoading}
					<div class="flex items-start gap-2">
						<div
							class="bg-primary/10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
						>
							<SparkleIcon size={9} weight="fill" class="text-primary animate-pulse" />
						</div>
						<p class="text-base-content/40 flex-1 text-xs italic">{_searching ? 'Searching the web…' : 'Thinking…'}</p>
						<button
							onclick={stopStreaming}
							class="text-base-content/30 hover:bg-error/10 hover:text-error shrink-0 rounded p-1 transition-colors"
							title="Stop generating"
						>
							<StopCircleIcon size={13} />
						</button>
					</div>
				{/if}

				{#if err}
					<div role="alert" class="alert alert-error py-2 text-xs">{err}</div>
				{/if}
			</div>
		</div>

		<!-- Input area -->
		<div class="border-base-200 shrink-0 border-t p-2.5">
			<div
				class="border-base-200 bg-base-200/60 focus-within:border-primary/40 flex flex-col rounded-xl border transition-colors"
			>
				{#if attachments.length > 0}
					<div class="border-base-200 flex flex-wrap gap-1.5 border-b px-3 py-2">
						{#each attachments as att (att.id)}
							<div class="bg-base-content/5 flex items-center gap-1 rounded-md px-2 py-1">
								{#if att.kind === 'image' && att.preview}
									<img src={att.preview} class="h-4 w-4 rounded object-cover" alt={att.name} />
								{:else}
									<FileTextIcon size={10} class="text-base-content/50 shrink-0" />
								{/if}
								<span class="text-base-content/70 max-w-[96px] truncate text-[13px]"
									>{att.name}</span
								>
								<button
									onclick={() => removeAttachment(att.id)}
									class="btn btn-ghost btn-xs text-base-content/40 !p-0"
								>
									<XIcon size={10} />
								</button>
							</div>
						{/each}
					</div>
				{/if}

				<textarea
					bind:this={textareaEl}
					bind:value={input}
					onkeydown={onKeydown}
					oninput={autoResizeTextarea}
					placeholder={onProposedDoc
						? 'Ask about or revise the document… (⌘↵)'
						: 'Ask anything… (⌘↵)'}
					rows={1}
					disabled={loading || applyLoading}
					class="text-base-content placeholder:text-base-content/30 max-h-32 w-full resize-none bg-transparent px-3 pt-2 pb-1 text-[13px] ring-0 outline-none select-text"
				></textarea>

				<div class="flex items-center gap-0.5 px-1.5 pb-1.5">
					<Dropdown align="top-left">
						{#snippet trigger({ open: dOpen, toggle })}
							<button
								onclick={toggle}
								class="btn btn-ghost btn-square btn-xs {dOpen
									? 'text-base-content'
									: 'text-base-content/40'}"
								title="Attach file"
							>
								<PaperclipIcon size={13} />
							</button>
						{/snippet}
						{#if getScreenshot}
							<button
								class="text-base-content/70 hover:bg-base-content/5 hover:text-base-content flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors"
								onclick={attachCanvas}
							>
								<FrameCornersIcon size={12} /> Canvas view
							</button>
						{/if}
						{#if canvasImages.length > 0}
							<p
								class="text-base-content/30 px-3 pt-2 pb-0.5 text-[13px] font-semibold tracking-wider uppercase"
							>
								Canvas images
							</p>
							<div class="max-h-32 overflow-y-auto">
								{#each canvasImages as obj (obj.id)}
									<button
										class="text-base-content/70 hover:bg-base-content/5 hover:text-base-content flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors"
										onclick={() => attachCanvasImage(obj)}
									>
										<img src={obj.src} class="h-4 w-4 shrink-0 rounded object-cover" alt="" />
										<span class="truncate">{obj.id.slice(0, 8)}…</span>
									</button>
								{/each}
							</div>
						{/if}
						{#if canvasDocs.length > 0}
							<p
								class="text-base-content/30 px-3 pt-2 pb-0.5 text-[13px] font-semibold tracking-wider uppercase"
							>
								Canvas documents
							</p>
							<div class="max-h-32 overflow-y-auto">
								{#each canvasDocs as obj (obj.id)}
									<button
										class="text-base-content/70 hover:bg-base-content/5 hover:text-base-content flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors"
										onclick={() => attachCanvasDoc(obj)}
									>
										<FileTextIcon size={12} class="shrink-0" />
										<span class="truncate">{obj.title || 'Untitled'}</span>
									</button>
								{/each}
							</div>
						{/if}
						{#if canvasBookmarks.length > 0}
							<p
								class="text-base-content/30 px-3 pt-2 pb-0.5 text-[13px] font-semibold tracking-wider uppercase"
							>
								Bookmarks
							</p>
							<div class="max-h-32 overflow-y-auto">
								{#each canvasBookmarks as obj (obj.id)}
									<button
										class="text-base-content/70 hover:bg-base-content/5 hover:text-base-content flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors"
										onclick={() => attachCanvasBookmark(obj)}
									>
										{#if obj.favicon}
											<img src={obj.favicon} class="h-3 w-3 shrink-0" alt="" />
										{:else}
											<FileTextIcon size={12} class="shrink-0" />
										{/if}
										<span class="truncate">{obj.title || obj.domain || obj.url}</span>
									</button>
								{/each}
							</div>
						{/if}
						{#if canvasImages.length > 0 || canvasDocs.length > 0 || canvasBookmarks.length > 0}
							<div class="border-base-200 my-1 border-t"></div>
						{/if}
						<button
							class="text-base-content/70 hover:bg-base-content/5 hover:text-base-content flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors"
							onclick={() => fileImageInput?.click()}
						>
							<ImageIcon size={12} /> Upload image
						</button>
						<button
							class="text-base-content/70 hover:bg-base-content/5 hover:text-base-content flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors"
							onclick={() => fileDocInput?.click()}
						>
							<FileTextIcon size={12} /> Upload document
						</button>
					</Dropdown>

					<Dropdown align="top-left">
						{#snippet trigger({ open: dOpen, toggle })}
							<button
								onclick={toggle}
								class="btn btn-ghost btn-square btn-xs {dOpen ||
								thinking ||
								imageGen ||
								modelOverride
									? 'text-primary'
									: 'text-base-content/40'}"
								title="AI options"
							>
								<SlidersHorizontalIcon size={13} />
							</button>
						{/snippet}
						<div class="border-base-200 border-b px-2 py-2">
							<p
								class="text-base-content/40 mb-1.5 px-1 text-[13px] font-semibold tracking-wider uppercase"
							>
								Model
							</p>
							{#if currentSettings}
								<ModelPicker
									bind:value={modelOverride}
									provider={currentSettings.aiProvider}
									placeholder={defaultModel}
								/>
							{/if}
						</div>
						<button
							class="hover:bg-base-content/5 flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors {thinking
								? 'text-primary'
								: 'text-base-content/70 hover:text-base-content'}"
							onclick={() => (thinking = !thinking)}
						>
							<BrainIcon size={12} />
							<span class="flex-1 text-left">Extended thinking</span>
							{#if thinking}<CheckIcon size={11} weight="bold" />{/if}
						</button>
						<button
							class="hover:bg-base-content/5 flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors {imageGen
								? 'text-primary'
								: 'text-base-content/70 hover:text-base-content'}"
							onclick={() => (imageGen = !imageGen)}
						>
							<ImageIcon size={12} />
							<span class="flex-1 text-left">Image generation</span>
							{#if imageGen}<CheckIcon size={11} weight="bold" />{/if}
						</button>
					</Dropdown>

					<div class="flex-1"></div>

					{#if onProposedDoc && input.trim()}
						<button
							onclick={applyToDoc}
							disabled={applyLoading || loading}
							class="btn btn-ghost btn-xs text-primary/70 hover:bg-primary/10 hover:text-primary mr-1 gap-1 disabled:opacity-40"
							title="Apply to document"
						>
							{#if applyLoading}
								<CircleNotchIcon size={11} class="animate-spin" />
							{:else}
								<MagicWandIcon size={11} weight="bold" />
							{/if}
							Apply to doc
						</button>
					{/if}

					{#if loading || applyLoading}
						<button
							onclick={stopStreaming}
							class="btn btn-error btn-square btn-xs active:scale-90"
							title="Stop generating"
						>
							<StopCircleIcon size={12} weight="fill" />
						</button>
					{:else}
						<button
							onclick={send}
							disabled={!input.trim()}
							class="btn btn-primary btn-square btn-xs active:scale-90 disabled:opacity-40"
						>
							<PaperPlaneTiltIcon size={12} weight="fill" />
						</button>
					{/if}
				</div>
			</div>

			<p class="text-base-content/30 mt-1.5 text-center text-[13px]">
				AI can make mistakes. Double-check important info.
			</p>
		</div>
	{/snippet}
</FloatingWindow>

<!-- Hidden file inputs -->
<input
	bind:this={fileImageInput}
	type="file"
	accept="image/*"
	class="hidden"
	onchange={onImageChange}
/>
<input
	bind:this={fileDocInput}
	type="file"
	accept=".pdf,.txt,.md,.doc,.docx"
	class="hidden"
	onchange={onDocChange}
/>
