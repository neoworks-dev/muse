<script lang="ts">
	import { onMount, tick } from 'svelte';

	import { PegboardCanvas } from '@neoworks-dev/ui';
	import { theme } from '$lib/theme.svelte';
	import Toolbar from '../components/Toolbar.svelte';
	import DocumentEditor from '../components/document-editor';
	import BookmarkWindow from '../components/BookmarkWindow.svelte';
	import SketchOverlay from '../components/SketchOverlay.svelte';
	import ContextMenu from '../components/ContextMenu.svelte';
	import RadialDrawMenu from '../components/RadialDrawMenu.svelte';
	import CustomCursor from '../components/CustomCursor.svelte';
	import ProfileBar from '../components/ProfileBar.svelte';
	import SettingsOverlay from '../components/SettingsOverlay.svelte';
	import ProjectSwitcher from '../components/ProjectSwitcher.svelte';
	import ProjectPanel from '../components/ProjectPanel.svelte';
	import IntroOverlay from '../components/IntroOverlay.svelte';
	import { AIChat, AIChatButton } from '../components/AIChat';
	import CommandPalette from '../components/CommandPalette/CommandPalette.svelte';

	import { canvas, ui, pushHistory } from '$lib/state.svelte';
	import { startEmbeddingIndexer } from '$lib/embeddings.svelte';
	import { startCanvasBridge } from '$lib/canvas-bridge';
	import * as actions from '$lib/actions.svelte';
	import { hydrate, flushNow, scheduleSync } from '$lib/sync.svelte';
	import { loadProjects } from '$lib/projects.svelte';
	import { uploadImage, mediaSentinel } from '$lib/media';
	import { CanvasRenderer } from '$lib/canvas/core/CanvasRenderer';
	import { MultiSelectTool } from '$lib/canvas/tools/MultiSelectTool';
	import { DrawTool } from '$lib/canvas/tools/DrawTool';
	import { EraseTool } from '$lib/canvas/tools/EraseTool';
	import { LinkTool } from '$lib/canvas/tools/LinkTool';
	import { DocumentTool } from '$lib/canvas/tools/DocumentTool';
	import { createId } from '$lib/canvas/utils/ids';
	import type { SketchAction } from '$lib/sketch-types';
	import type {
		NoteData,
		DocumentData,
		MediaData,
		LinkData,
		FolderData,
		BookmarkData
	} from '$lib/state.svelte';
	import { fetchLinkPreview } from '$lib/api/link-preview';
	import { closePdf } from '$lib/actions.svelte';
	import { extractYoutubeId, getYoutubeStreamUrl } from '$lib/api/youtube';
	import { generateImage } from '$lib/api/image-gen';
	import { loadSettings } from '$lib/settings';
	import { generateTitle } from '$lib/ai';
	import {
		NOTE_FONT_FAMILY,
		NOTE_FONT_SIZE,
		NOTE_LINE_HEIGHT,
		NOTE_PAD
	} from '$lib/canvas/objects/NoteRenderer';
	import { DOC_WIDTH, DOC_HEIGHT } from '$lib/canvas/objects/DocumentRenderer';
	import { BOOKMARK_W } from '$lib/canvas/objects/BookmarkRenderer';
	import type { ContextMenuItem } from '$lib/canvas/core/types';

	let container: HTMLDivElement;

	// Keeps the Nomic embedding index in sync with canvas content.
	startEmbeddingIndexer();

	// Answers MCP tool calls (canvas search) from AI CLI subprocesses.
	startCanvasBridge();

	// AI-titles untitled documents in the background after the editor closes.
	async function maybeGenerateDocumentTitle(docId: string, content: string) {
		const doc = canvas.objects.find((o) => o.id === docId);
		if (!doc || doc.type !== 'document' || doc.title) return;
		if (content.trim().split(/\s+/).length < 10) return;

		try {
			const title = await generateTitle(content);
			if (!title) return;
			const current = canvas.objects.find((o) => o.id === docId);
			if (current && current.type === 'document' && !current.title) {
				actions.updateObject(docId, { title });
			}
		} catch {
			// Title stays empty — non-critical.
		}
	}

	// Pegboard dot styling per theme (linear RGB 0..1).
	const peg = $derived(
		theme.mode === 'dark'
			? { dot: [1, 1, 1] as [number, number, number], glow: [0.8, 0.9, 1.0] as [number, number, number], op: 0.5 }
			: { dot: [0.2, 0.22, 0.27] as [number, number, number], glow: [0.42, 0.38, 0.6] as [number, number, number], op: 0.22 }
	);
	let noteEditor: HTMLDivElement;
	let renderer: CanvasRenderer;
	let _middleDown = false;
	let linkLabelInput: HTMLInputElement | undefined;
	let editingLinkLabel = $state('');
	let _pendingSketch = $state<{ dataUrl: string; reply: string; actions: SketchAction[] } | null>(
		null
	);
	let _aiBookmarks = $state<BookmarkData[]>([]);

	const INTRO_SEEN_KEY = 'muse:intro-seen';
	let showIntro = $state(false);

	function dismissIntro() {
		localStorage.setItem(INTRO_SEEN_KEY, '1');
		showIntro = false;
	}

	function openUrlInWebview(url: string, title: string) {
		const id = `ai-bk-${crypto.randomUUID()}`;
		_aiBookmarks = [
			..._aiBookmarks,
			{
				type: 'bookmark',
				id,
				x: 0,
				y: 0,
				url,
				title: title || url,
				domain: (() => {
					try {
						return new URL(url).hostname;
					} catch {
						return '';
					}
				})()
			} satisfies BookmarkData
		];
	}

	onMount(() => {
		// First-run onboarding: shown once, then remembered.
		if (!localStorage.getItem(INTRO_SEEN_KEY)) showIntro = true;

		let cleanup: (() => void) | undefined;
		(async () => {
			// Preload the handwriting font so canvas notes don't render in a fallback first.
			await document.fonts.load("600 22px 'Caveat'").catch(() => {});

			renderer = new CanvasRenderer();
			renderer.registerTool(new MultiSelectTool());
			renderer.registerTool(new DrawTool());
			renderer.registerTool(new EraseTool());
			renderer.registerTool(new LinkTool());
			renderer.registerTool(new DocumentTool());

			await renderer.init(container);

			// Background context menu
			renderer.backgroundMenuProvider = (world) =>
				[
					{
						kind: 'action',
						label: 'Add Note',
						icon: 'pencil',
						shortcut: 'N',
						action: () => {
							const data: NoteData = {
								type: 'note',
								id: createId('note'),
								x: world.x,
								y: world.y,
								body: 'New note'
							};
							actions.addObject(data);
						}
					},
					{
						kind: 'action',
						label: 'Add Document',
						icon: 'article',
						shortcut: 'D',
						action: () => {
							const id = createId('doc');
							const data: DocumentData = {
								type: 'document',
								id,
								x: world.x,
								y: world.y,
								content: '# New Document\n\nStart writing here.\n\n---\n\n'
							};
							actions.addObject(data);
							actions.startEditingDocument(id);
						}
					}
				] satisfies ContextMenuItem[];

			await loadProjects();
			await hydrate();
			pushHistory(); // seed base snapshot so first action is always undoable
			if (canvas.objects.length === 0) {
				actions.addObject({
					type: 'folder',
					id: createId('folder'),
					x: 120,
					y: 120,
					title: 'Research Collection'
				} satisfies FolderData);
				actions.addObject({
					type: 'note',
					id: createId('note'),
					x: 540,
					y: 170,
					body: 'Double-tap to edit.\nDrag from link tool to connect.'
				} satisfies NoteData);
			}

			window.addEventListener('beforeunload', () => flushNow());

			// Block middle-click paste (Linux primary selection)
			const onMid = (e: MouseEvent) => {
				_middleDown = e.button === 1;
			};
			window.addEventListener('mousedown', onMid, true);
			window.addEventListener('mouseup', onMid, true);

			cleanup = () => {
				renderer.destroy();
				window.removeEventListener('mousedown', onMid, true);
				window.removeEventListener('mouseup', onMid, true);
			};
		})();
		return () => cleanup?.();
	});


	// Sync active tool to renderer (e.g. when the radial menu picks the eraser)
	$effect(() => {
		const tool = ui.activeTool;
		if (renderer && renderer.app && renderer.currentToolId !== tool) {
			renderer.setTool(tool);
		}
	});

	function selectTool(tool: string) {
		if (renderer) renderer.setTool(tool);
	}

	function closeContextMenu() {
		ui.contextMenu = null;
	}

	// ── Note editing ───────────────────────────────────────────────────────

	function getNoteEditorStyle(): string {
		if (!renderer || !ui.editingNoteId) return '';
		const note = canvas.objects.find((o) => o.id === ui.editingNoteId) as NoteData | undefined;
		if (!note) return '';

		const noteRenderer = renderer.getRenderer(ui.editingNoteId);
		// Approximate card size from NoteRenderer if available
		let cardW = 200,
			cardH = 60;
		if (noteRenderer && 'cardWidth' in noteRenderer && 'cardHeight' in noteRenderer) {
			cardW = (noteRenderer as unknown as { cardWidth: number }).cardWidth;
			cardH = (noteRenderer as unknown as { cardHeight: number }).cardHeight;
		}

		const topLeft = renderer.worldToScreen(note.x, note.y);
		const zoom = canvas.camera.zoom;
		return `
			left: ${topLeft.x}px;
			top: ${topLeft.y}px;
			width: ${cardW * zoom}px;
			min-height: ${cardH * zoom}px;
			padding-top: ${NOTE_PAD * zoom}px;
			padding-right: ${NOTE_PAD * zoom}px;
			padding-bottom: ${NOTE_PAD * zoom}px;
			padding-left: ${NOTE_PAD * zoom}px;
			border-radius: ${10 * zoom}px;
			font-size: ${NOTE_FONT_SIZE * zoom}px;
			line-height: ${NOTE_LINE_HEIGHT * zoom}px;
			font-family: ${NOTE_FONT_FAMILY};
			font-weight: 600;
			color: rgba(50, 45, 35, 0.9);
			box-sizing: border-box;
		`;
	}

	function commitNoteEditing() {
		if (!ui.editingNoteId) return;
		const id = ui.editingNoteId;
		const r = renderer?.getRenderer(id);
		if (r) r.container.visible = true;
		actions.commitNoteEdit(id, noteEditor?.innerText ?? '');
	}

	function cancelNoteEditing() {
		if (ui.editingNoteId) {
			const r = renderer?.getRenderer(ui.editingNoteId);
			if (r) r.container.visible = true;
		}
		actions.cancelNoteEdit();
	}

	function onNoteEditorKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			cancelNoteEditing();
		}
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			commitNoteEditing();
		}
	}

	// Initialize the inline note editor when editingNoteId is set
	$effect(() => {
		const id = ui.editingNoteId;
		if (!id) return;
		const note = canvas.objects.find((o) => o.id === id) as NoteData | undefined;
		if (!note) return;
		const r = renderer?.getRenderer(id);
		if (r) r.container.visible = false;
		tick().then(() => {
			if (!noteEditor) return;
			noteEditor.innerText = note.body;
			noteEditor.focus();
			const range = document.createRange();
			range.selectNodeContents(noteEditor);
			range.collapse(false);
			window.getSelection()?.removeAllRanges();
			window.getSelection()?.addRange(range);
		});
	});

	// ── Link label editing ─────────────────────────────────────────────────

	function getLinkLabelScreenPos(): { x: number; y: number } | null {
		if (!ui.editingLinkId || !renderer) return null;
		const linkRenderer = renderer.getRenderer(ui.editingLinkId);
		if (!linkRenderer) return null;
		const labelPos = (linkRenderer as { labelWorldPosition?: { x: number; y: number } })
			.labelWorldPosition;
		if (!labelPos) return null;
		return renderer.worldToScreen(labelPos.x, labelPos.y);
	}

	function commitLinkEditing() {
		if (!ui.editingLinkId) return;
		actions.commitLinkEdit(ui.editingLinkId, editingLinkLabel);
	}

	function cancelLinkEditing() {
		actions.cancelLinkEdit();
	}

	// ── Sketch overlay ──────────────────────────────────────────────────────

	function exitSketch() {
		selectTool('select');
	}

	function handlePlaceImage(
		dataUrl: string,
		bounds: { x: number; y: number; w: number; h: number }
	) {
		if (!renderer) return;
		const data: MediaData = {
			type: 'media',
			id: createId('media'),
			x: bounds.x,
			y: bounds.y,
			src: dataUrl,
			mediaType: 'image'
		};
		actions.addObject(data);
		selectTool('select');
	}

	async function executeSketchActions(sketchActions: SketchAction[]) {
		for (const action of sketchActions) {
			switch (action.type) {
				case 'create_link': {
					const srcExists = canvas.objects.some((o) => o.id === action.sourceId);
					const tgtExists = canvas.objects.some((o) => o.id === action.targetId);
					if (!srcExists || !tgtExists) break;
					const data: LinkData = {
						type: 'link',
						id: createId('link'),
						fromId: action.sourceId,
						toId: action.targetId,
						label: action.label ?? '',
						direction: 'forward'
					};
					actions.addObject(data);
					break;
				}
				case 'move_element': {
					actions.moveObject(action.id, action.x, action.y);
					break;
				}
				case 'group_elements': {
					const ids = action.ids.filter((id) => canvas.objects.some((o) => o.id === id));
					if (ids.length < 2) break;
					let minX = Infinity,
						minY = Infinity;
					for (const id of ids) {
						const o = canvas.objects.find((obj) => obj.id === id);
						if (o && 'x' in o) {
							minX = Math.min(minX, (o as { x: number }).x);
							minY = Math.min(minY, (o as { y: number }).y);
						}
					}
					const folderId = createId('folder');
					for (const id of ids) {
						const o = canvas.objects.find((obj) => obj.id === id);
						if (o) Object.assign(o, { parentId: folderId });
					}
					actions.addObject({
						type: 'folder',
						id: folderId,
						x: minX,
						y: minY,
						title: action.title
					} satisfies FolderData);
					break;
				}
				case 'add_note': {
					actions.addObject({
						type: 'note',
						id: createId('note'),
						x: action.x,
						y: action.y,
						body: action.body
					} satisfies NoteData);
					break;
				}
				case 'open_document': {
					actions.startEditingDocument(action.id);
					break;
				}
				case 'create_document': {
					const pos = renderer
						? renderer.screenToWorld(
								action.x ?? window.innerWidth / 2,
								action.y ?? window.innerHeight / 2
							)
						: { x: action.x ?? 0, y: action.y ?? 0 };
					const docId = createId('doc');
					const heading = action.title ? `# ${action.title}\n\n` : '';
					actions.addObject({
						type: 'document',
						id: docId,
						x: pos.x,
						y: pos.y,
						content: heading + (action.content ?? '')
					} satisfies DocumentData);
					break;
				}
				case 'place_image': {
					const pos = renderer
						? renderer.screenToWorld(
								action.x ?? window.innerWidth / 2,
								action.y ?? window.innerHeight / 2
							)
						: { x: action.x ?? 0, y: action.y ?? 0 };
					let src = action.url;
					try {
						src = await fetchImageAsDataUrl(action.url);
					} catch {}
					actions.addObject({
						type: 'media',
						id: createId('media'),
						x: pos.x,
						y: pos.y,
						src,
						mediaType: 'image'
					} satisfies MediaData);
					break;
				}
				case 'generate_image': {
					const settings = loadSettings();
					const openaiKey = settings.openaiApiKey;
					if (!openaiKey) {
						console.error('Image generation requires an OpenAI API key — add it in Settings.');
						break;
					}
					try {
						const dataUrl = await generateImage({
							prompt: action.prompt,
							openaiApiKey: openaiKey,
							model: settings.imageModel || 'dall-e-3'
						});
						const pos = renderer
							? renderer.screenToWorld(
									action.x ?? window.innerWidth / 2,
									action.y ?? window.innerHeight / 2
								)
							: { x: action.x ?? 0, y: action.y ?? 0 };
						actions.addObject({
							type: 'media',
							id: createId('media'),
							x: pos.x,
							y: pos.y,
							src: dataUrl,
							mediaType: 'image'
						} satisfies MediaData);
					} catch (e) {
						console.error('Image generation failed:', e);
					}
					break;
				}
			}
		}
	}

	function groupSelectedIntoFolder() {
		const ids = canvas.selection;
		if (ids.length < 2) return;
		actions.groupSelectedIntoFolder('New Folder');
	}

	// ── Drag-drop & paste media ──────────────────────────────────────────────

	async function importFiles(files: File[], dropScreenX = 200, dropScreenY = 200) {
		if (!renderer) return;
		const mediaFiles = files.filter(
			(f) => f.type.startsWith('image/') || f.type.startsWith('video/') || f.type === 'application/pdf'
		);
		if (!mediaFiles.length) return;
		for (const file of mediaFiles) {
			const world = renderer.screenToWorld(dropScreenX, dropScreenY);

			// Images are stored as blobs in IndexedDB; rendered via a manifest.
			if (file.type.startsWith('image/') && file.type !== 'image/gif') {
				try {
					const manifest = await uploadImage(file, file.name || 'image', file.type);
					actions.addObject({
						type: 'media',
						id: createId('media'),
						x: world.x,
						y: world.y,
						src: mediaSentinel(manifest.id),
						mediaType: 'image',
						manifest
					} satisfies MediaData);
					continue;
				} catch (err) {
					console.error('[media] image upload failed', err);
					continue;
				}
			}

			let src: string;
			let mediaType: MediaData['mediaType'];
			if (file.type === 'application/pdf') {
				src = await blobToDataUrl(file);
				mediaType = 'pdf';
			} else if (file.type === 'image/gif') {
				src = await blobToDataUrl(file);
				mediaType = 'gif';
			} else {
				src = URL.createObjectURL(file);
				mediaType = 'video';
			}
			actions.addObject({
				type: 'media',
				id: createId('media'),
				x: world.x,
				y: world.y,
				src,
				mediaType
			} satisfies MediaData);
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		const files = [...(e.dataTransfer?.files ?? [])];
		if (files.length > 0) {
			importFiles(files, e.clientX, e.clientY);
			return;
		}
		const urlText =
			e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
		const trimmed = urlText.trim().split('\n')[0].trim();
		if (trimmed && isHttpUrl(trimmed)) {
			importUrl(trimmed, e.clientX, e.clientY);
		}
	}

	function onPaste(e: ClipboardEvent) {
		if (_middleDown) return; // Linux primary-selection middle-click paste
		if (ui.openDocumentIds.length > 0 || ui.editingNoteId !== null) return;
		const files = [...(e.clipboardData?.files ?? [])];
		if (files.length > 0) {
			importFiles(files);
			return;
		}
		const text = e.clipboardData?.getData('text/plain')?.trim() ?? '';
		if (isHttpUrl(text)) {
			e.preventDefault();
			importUrl(text);
		}
	}

	function isHttpUrl(s: string): boolean {
		try {
			const u = new URL(s);
			return u.protocol === 'http:' || u.protocol === 'https:';
		} catch {
			return false;
		}
	}

	function blobToDataUrl(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	}

	async function fetchImageAsDataUrl(url: string): Promise<string> {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`${res.status}`);
		return blobToDataUrl(await res.blob());
	}

	async function importUrl(urlStr: string, screenX?: number, screenY?: number) {
		if (!renderer) return;
		const world = renderer.screenToWorld(
			screenX ?? window.innerWidth / 2,
			screenY ?? window.innerHeight / 2
		);

		const youtubeId = extractYoutubeId(urlStr);
		if (youtubeId) {
			try {
				const src = await getYoutubeStreamUrl(youtubeId);
				actions.addObject({
					type: 'media',
					id: createId('media'),
					x: world.x,
					y: world.y,
					src,
					mediaType: 'video'
				} satisfies MediaData);
			} catch {
				importAsBookmark(urlStr, world);
			}
			return;
		}

		try {
			const res = await fetch(urlStr);
			if (!res.ok) throw new Error();
			const ct = res.headers.get('content-type') ?? '';

			if (ct.startsWith('image/') || ct === 'application/pdf') {
				const blob = await res.blob();
				const src = await blobToDataUrl(blob);
				const mediaType: MediaData['mediaType'] =
					ct === 'application/pdf' ? 'pdf' :
					ct === 'image/gif' ? 'gif' : 'image';
				actions.addObject({
					type: 'media',
					id: createId('media'),
					x: world.x,
					y: world.y,
					src,
					mediaType
				} satisfies MediaData);
				return;
			}

			if (ct.startsWith('video/')) {
				actions.addObject({
					type: 'media',
					id: createId('media'),
					x: world.x,
					y: world.y,
					src: urlStr,
					mediaType: 'video'
				} satisfies MediaData);
				return;
			}
		} catch {}

		importAsBookmark(urlStr, world);
	}

	async function importAsBookmark(urlStr: string, world: { x: number; y: number }) {
		let domain = urlStr;
		try {
			domain = new URL(urlStr).hostname;
		} catch {}

		const id = createId('bookmark');
		const data: BookmarkData = {
			type: 'bookmark',
			id,
			x: world.x,
			y: world.y,
			url: urlStr,
			title: domain,
			domain,
			loading: true
		};
		actions.addObject(data);

		try {
			const meta = await fetchLinkPreview(urlStr);
			actions.updateObject(id, {
				title: meta.title || domain,
				description: meta.description || undefined,
				favicon: meta.favicon || undefined,
				imageUrl: meta.imageUrl || undefined,
				domain: meta.domain,
				loading: false
			} as Partial<BookmarkData>);
		} catch {
			actions.updateObject(id, { loading: false } as Partial<BookmarkData>);
		}
	}

	function onWindowKeydown(e: KeyboardEvent) {
		// Command palette
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			ui.commandPaletteOpen = !ui.commandPaletteOpen;
			return;
		}
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		if (ui.aiChatOpen) {
			ui.aiChatOpen = false;
			return;
		}
	}
</script>

<svelte:window onpaste={onPaste} onkeydown={onWindowKeydown} />

<!-- Pegboard dot grid background; tracks the canvas camera. -->
<div class="fixed inset-0 z-0" style="background: var(--color-canvas);">
	<PegboardCanvas
		panX={canvas.camera.x}
		panY={canvas.camera.y}
		zoom={canvas.camera.zoom}
		dotColor={peg.dot}
		glowColor={peg.glow}
		baseOpacity={peg.op}
		flipY
	/>
</div>

<div
	bind:this={container}
	class="fixed inset-0 z-10 h-full w-full touch-none overflow-hidden select-none"
	style="touch-action: none; user-select: none; -webkit-user-select: none;"
	ondragover={(e) => e.preventDefault()}
	ondrop={onDrop}
/>

<!-- Note inline overlay -->
{#if ui.editingNoteId}
	<div class="fixed inset-0 z-30" onpointerdown={commitNoteEditing} role="presentation" />
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={noteEditor}
		contenteditable="true"
		role="textbox"
		aria-multiline="true"
		spellcheck="false"
		class="fixed z-40 bg-[var(--note-card)] text-[var(--note-text)] whitespace-pre-wrap outline-none"
		style={getNoteEditorStyle()}
		onkeydown={onNoteEditorKeydown}
		onpointerdown={(e) => e.stopPropagation()}
	></div>
{/if}

<!-- Link label editor -->
{#if ui.editingLinkId}
	{@const pos = getLinkLabelScreenPos()}
	{#if pos}
		<div class="fixed inset-0 z-30" onpointerdown={commitLinkEditing} role="presentation" />
		<input
			bind:this={linkLabelInput}
			bind:value={editingLinkLabel}
			type="text"
			spellcheck="false"
			class="fixed z-40 rounded-full border border-accent/50 bg-base-100/96 px-3 py-1 text-center text-[12px] text-accent shadow-lg ring-2 ring-accent/20 outline-none"
			style="left: {pos.x}px; top: {pos.y}px; transform: translate(-50%, -50%); min-width: 80px;"
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					commitLinkEditing();
				}
				if (e.key === 'Escape') {
					e.preventDefault();
					cancelLinkEditing();
				}
			}}
			onpointerdown={(e) => e.stopPropagation()}
		/>
	{/if}
{/if}

<!-- Document editors (one floating window per open document) -->
{#each ui.openDocumentIds as docId (docId)}
	{@const doc = canvas.objects.find((o) => o.id === docId) as DocumentData | undefined}
	{#if doc}
		{@const _screenPos = renderer?.worldToScreen(doc.x, doc.y)}
		{@const _zoom = canvas.camera.zoom}
		{@const _origin = _screenPos
			? { x: _screenPos.x, y: _screenPos.y, w: DOC_WIDTH * _zoom, h: DOC_HEIGHT * _zoom }
			: undefined}
		<DocumentEditor
			initialContent={doc.content}
			origin={_origin}
			storageKey={`doc:${docId}:win`}
			onCommit={(text) => {
				actions.commitDocumentEdit(docId, text);
				scheduleSync();
				void maybeGenerateDocumentTitle(docId, text);
			}}
			onCancel={() => actions.cancelDocumentEdit(docId)}
			onUpdate={(text) => {
				// Keep canvas.objects live so AIChat always sees current content
				const obj = canvas.objects.find((o) => o.id === docId);
				if (obj && obj.type === 'document') (obj as DocumentData).content = text;
				// Queue preview render in DocumentRenderer
				const r = renderer?.getRenderer(docId);
				if (r && 'queuePreview' in r)
					(r as { queuePreview: (t: string) => void }).queuePreview(text);
				scheduleSync();
			}}
			onAnnotsChange={(annots) => {
				ui.docAnnots = annots;
			}}
			onOpenChat={() => {
				ui.aiChatOpen = true;
			}}
			bind:proposedDoc={ui.proposedDoc}
		/>
	{/if}
{/each}

<!-- Bookmark overlays (one floating window per open bookmark) -->
{#each ui.openBookmarkIds as bkId (bkId)}
	{@const bookmark = canvas.objects.find((o) => o.id === bkId) as BookmarkData | undefined}
	{#if bookmark}
		{@const _sp = renderer?.worldToScreen(bookmark.x, bookmark.y)}
		{@const _zoom = canvas.camera.zoom}
		{@const _bkR = renderer?.getRenderer(bkId)}
		{@const _bkH = _bkR && 'cardHeight' in _bkR ? (_bkR as { cardHeight: number }).cardHeight : 200}
		{@const _origin = _sp
			? { x: _sp.x, y: _sp.y, w: BOOKMARK_W * _zoom, h: _bkH * _zoom }
			: undefined}
		<BookmarkWindow {bookmark} origin={_origin} onClose={() => actions.stopViewingBookmark(bkId)} />
	{/if}
{/each}

<!-- PDF viewers -->
{#each ui.openPdfIds as pdfId (pdfId)}
	{@const pdfObj = canvas.objects.find((o) => o.id === pdfId) as MediaData | undefined}
	{#if pdfObj}
		{@const _sp = renderer?.worldToScreen(pdfObj.x, pdfObj.y)}
		{@const _zoom = canvas.camera.zoom}
		{@const _w = (pdfObj.w ?? 480) * _zoom}
		{@const _h = (pdfObj.h ?? 360) * _zoom}
		{@const _origin = _sp ? { x: _sp.x, y: _sp.y, w: _w, h: _h } : undefined}
		{@const _blobUrl = (() => { try { const b64 = pdfObj.src.split(',')[1]; const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); } catch { return pdfObj.src; } })()}
		<BookmarkWindow
			bookmark={{ type: 'bookmark', id: pdfId, x: 0, y: 0, url: _blobUrl, title: 'PDF' }}
			origin={_origin}
			storageKey={`pdf:${pdfId}:win`}
			onClose={() => closePdf(pdfId)}
		/>
	{/if}
{/each}

<!-- AI-opened URL webviews (ephemeral, not on canvas) -->
{#each _aiBookmarks as bk (bk.id)}
	<BookmarkWindow
		bookmark={bk}
		onClose={() => {
			_aiBookmarks = _aiBookmarks.filter((b) => b.id !== bk.id);
		}}
	/>
{/each}

<!-- Folder back bar -->
{#if canvas.folderStack.length > 0}
	<div class="fixed top-3 left-16 z-50 flex items-center gap-2">
		<button
			class="btn border-base-300 bg-base-100 text-base-content/70 btn-ghost btn-sm hover:text-base-content gap-1.5 rounded-xl border shadow-sm"
			onclick={() => actions.exitFolder()}
		>
			← Back
		</button>
		<span
			class="border-base-300 bg-base-100/80 text-base-content/70 rounded-xl border px-3 py-1.5 text-sm font-semibold shadow-sm backdrop-blur-sm"
			>{ui.folderTitle}</span
		>
	</div>
{/if}

{#if ui.activeTool === 'sketch' && renderer}
	<SketchOverlay
		engine={renderer}
		onClose={exitSketch}
		onExecuteActions={executeSketchActions}
		onPlaceImage={handlePlaceImage}
		onSubmitToChat={(r) => {
			_pendingSketch = r;
			ui.aiChatOpen = true;
			selectTool('select');
		}}
	/>
{/if}

<Toolbar
	activeTool={ui.activeTool}
	onSelectTool={selectTool}
	selectedCount={canvas.selection.length}
	onGroupFolder={groupSelectedIntoFolder}
/>
<ProfileBar onOpenSettings={() => (ui.settingsOpen = true)} />
<ProjectSwitcher />
<AIChatButton open={ui.aiChatOpen} onclick={() => (ui.aiChatOpen = !ui.aiChatOpen)} />
<AIChat
	bind:open={ui.aiChatOpen}
	bind:pendingSketch={_pendingSketch}
	canvasObjects={canvas.objects}
	getScreenshot={() => renderer?.screenshotViewport() ?? null}
	docText={(
		canvas.objects.find((o) => o.id === ui.openDocumentIds.at(-1)) as DocumentData | undefined
	)?.content ?? ''}
	docAnnots={ui.openDocumentIds.length > 0 ? ui.docAnnots : []}
	onProposedDoc={ui.openDocumentIds.length > 0
		? (text) => {
				ui.proposedDoc = text;
			}
		: undefined}
	onExecuteActions={executeSketchActions}
	onOpenDocument={actions.startEditingDocument}
	onOpenUrl={openUrlInWebview}
/>

{#if ui.settingsOpen}
	<SettingsOverlay onClose={() => (ui.settingsOpen = false)} />
{/if}

{#if ui.projectPanelOpen}
	<ProjectPanel />
{/if}

{#if showIntro}
	<IntroOverlay onClose={dismissIntro} />
{/if}

{#if ui.contextMenu}
	<ContextMenu
		items={ui.contextMenu.items}
		x={ui.contextMenu.x}
		y={ui.contextMenu.y}
		onClose={closeContextMenu}
	/>
{/if}

{#if ui.radialMenu}
	<RadialDrawMenu
		x={ui.radialMenu.x}
		y={ui.radialMenu.y}
		onClose={() => (ui.radialMenu = null)}
	/>
{/if}

<CommandPalette
	bind:open={ui.commandPaletteOpen}
	getCenter={() =>
		renderer?.screenToWorld(window.innerWidth / 2, window.innerHeight / 2) ?? { x: 0, y: 0 }}
/>

<CustomCursor />
