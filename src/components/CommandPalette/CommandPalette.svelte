<script lang="ts">
	import { tick, onMount } from 'svelte';
	import { canvas, ui, type ObjectData } from '$lib/state.svelte';
	import * as actions from '$lib/actions.svelte';
	import { createId } from '$lib/canvas/utils/ids';
	import { semanticSearch, type SearchHit } from '$lib/embeddings.svelte';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import CursorIcon from 'phosphor-svelte/lib/CursorIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import EraserIcon from 'phosphor-svelte/lib/EraserIcon';
	import LinkIcon from 'phosphor-svelte/lib/LinkIcon';
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import NoteIcon from 'phosphor-svelte/lib/NoteIcon';
	import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
	import GearSixIcon from 'phosphor-svelte/lib/GearSixIcon';
	import ArrowsOutIcon from 'phosphor-svelte/lib/ArrowsOutIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import BookmarkIcon from 'phosphor-svelte/lib/BookmarkIcon';
	import StickerIcon from 'phosphor-svelte/lib/StickerIcon';
	import SelectionIcon from 'phosphor-svelte/lib/SelectionIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import type { Component } from 'svelte';

	let {
		open = $bindable(false),
		getCenter = () => ({ x: 0, y: 0 })
	}: {
		open?: boolean;
		getCenter?: () => { x: number; y: number };
	} = $props();

	// ── Hotkeys ───────────────────────────────────────────────────────────────

	type HotkeyDef = { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean };
	const STORAGE_KEY = 'muse:command-hotkeys';
	const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

	// Defaults use ctrl=true meaning Ctrl on Win/Linux, Cmd on Mac
	const DEFAULT_HOTKEYS: Record<string, HotkeyDef> = {
		'create-note': { key: 'n', ctrl: true, shift: true },
		'create-document': { key: 'd', ctrl: true, shift: true },
		'create-folder': { key: 'f', ctrl: true, shift: true },
		'app-ai': { key: 'j', ctrl: true }
	};

	let storedHotkeys = $state<Record<string, HotkeyDef | null>>({});

	function loadHotkeys() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) storedHotkeys = JSON.parse(raw);
		} catch {}
	}

	function saveHotkeys() {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(storedHotkeys));
	}

	function getHotkey(id: string): HotkeyDef | null {
		if (id in storedHotkeys) return storedHotkeys[id];
		return DEFAULT_HOTKEYS[id] ?? null;
	}

	function formatHotkey(hk: HotkeyDef): string {
		const parts: string[] = [];
		if (hk.ctrl) parts.push(isMac ? '⌘' : 'Ctrl');
		if (hk.shift) parts.push(isMac ? '⇧' : 'Shift');
		if (hk.alt) parts.push(isMac ? '⌥' : 'Alt');
		const k = hk.key === ' ' ? 'Space' : hk.key.length === 1 ? hk.key.toUpperCase() : hk.key;
		parts.push(k);
		return parts.join(isMac ? '' : '+');
	}

	function hotkeyMatches(hk: HotkeyDef, e: KeyboardEvent): boolean {
		const modMatch = !!(e.ctrlKey || e.metaKey) === !!hk.ctrl;
		return (
			e.key.toLowerCase() === hk.key &&
			modMatch &&
			!!e.shiftKey === !!hk.shift &&
			!!e.altKey === !!hk.alt
		);
	}

	// Capture mode: which command id is waiting for a keypress
	let capturingFor = $state<string | null>(null);

	function startCapture(id: string, e: MouseEvent) {
		e.stopPropagation();
		capturingFor = id;
	}

	function clearHotkey(id: string, e: MouseEvent) {
		e.stopPropagation();
		storedHotkeys = { ...storedHotkeys, [id]: null };
		saveHotkeys();
	}

	// ── Command definition ────────────────────────────────────────────────────

	type Command = {
		id: string;
		label: string;
		category: string;
		keywords?: string[];
		action: () => void;
		Icon?: Component<{ size?: number | string; class?: string }>;
	};

	function focusCenter() {
		return getCenter();
	}

	const staticCommands: Command[] = [
		// Tools
		{
			id: 'tool-select',
			label: 'Select tool',
			category: 'Tools',
			keywords: ['cursor', 'pointer', 'move'],
			Icon: CursorIcon,
			action: () => actions.setActiveTool('select')
		},
		{
			id: 'tool-draw',
			label: 'Draw tool',
			category: 'Tools',
			keywords: ['pen', 'pencil', 'freehand'],
			Icon: PencilSimpleIcon,
			action: () => actions.setActiveTool('draw')
		},
		{
			id: 'tool-erase',
			label: 'Erase tool',
			category: 'Tools',
			keywords: ['delete', 'rubber'],
			Icon: EraserIcon,
			action: () => actions.setActiveTool('erase')
		},
		{
			id: 'tool-link',
			label: 'Link tool',
			category: 'Tools',
			keywords: ['connect', 'arrow', 'edge'],
			Icon: LinkIcon,
			action: () => actions.setActiveTool('link')
		},
		{
			id: 'tool-document',
			label: 'Document tool',
			category: 'Tools',
			keywords: ['doc', 'text', 'write'],
			Icon: FileTextIcon,
			action: () => actions.setActiveTool('document')
		},
		// Create
		{
			id: 'create-note',
			label: 'Add Note',
			category: 'Create',
			keywords: ['new', 'sticky', 'card'],
			Icon: StickerIcon,
			action: () => {
				const { x, y } = focusCenter();
				actions.addObject({
					type: 'note',
					id: createId('note'),
					x,
					y,
					body: 'New note',
					parentId: canvas.folderStack.at(-1)
				});
				close();
			}
		},
		{
			id: 'create-document',
			label: 'Add Document',
			category: 'Create',
			keywords: ['new', 'doc', 'text'],
			Icon: FileTextIcon,
			action: () => {
				const { x, y } = focusCenter();
				const id = createId('doc');
				actions.addObject({
					type: 'document',
					id,
					x,
					y,
					content: '# New Document\n\nStart writing here.\n\n---\n\n',
					parentId: canvas.folderStack.at(-1)
				});
				actions.startEditingDocument(id);
				close();
			}
		},
		{
			id: 'create-folder',
			label: 'Add Folder',
			category: 'Create',
			keywords: ['new', 'group', 'collection'],
			Icon: FolderIcon,
			action: () => {
				const { x, y } = focusCenter();
				actions.addObject({
					type: 'folder',
					id: createId('folder'),
					x,
					y,
					title: 'New Folder',
					parentId: canvas.folderStack.at(-1)
				});
				close();
			}
		},
		// Selection
		{
			id: 'group-selection',
			label: 'Group selection into folder',
			category: 'Selection',
			keywords: ['group', 'folder', 'wrap'],
			Icon: SelectionIcon,
			action: () => {
				actions.groupSelectedIntoFolder('New Folder');
				close();
			}
		},
		// Navigate
		{
			id: 'nav-home',
			label: 'Go to root canvas',
			category: 'Navigate',
			keywords: ['home', 'root', 'back', 'exit folder'],
			Icon: ArrowsOutIcon,
			action: () => {
				while (canvas.folderStack.length > 0) actions.exitFolder();
				close();
			}
		},
		// App
		{
			id: 'app-ai',
			label: 'Toggle AI Chat',
			category: 'App',
			keywords: ['claude', 'assistant', 'copilot', 'chat'],
			Icon: SparkleIcon,
			action: () => {
				ui.aiChatOpen = !ui.aiChatOpen;
				close();
			}
		},
		{
			id: 'app-settings',
			label: 'Open Settings',
			category: 'App',
			keywords: ['preferences', 'config', 'api key'],
			Icon: GearSixIcon,
			action: () => {
				ui.settingsOpen = true;
				close();
			}
		}
	];

	const dynamicCommands = $derived.by<Command[]>(() => {
		const cmds: Command[] = [];
		for (const obj of canvas.objects) {
			if (obj.type === 'document') {
				cmds.push({
					id: `open-doc-${obj.id}`,
					label: `Open: ${obj.title || 'Untitled Document'}`,
					category: 'Documents',
					keywords: ['document', 'open', 'edit'],
					Icon: FileTextIcon,
					action: () => {
						actions.startEditingDocument(obj.id);
						close();
					}
				});
			} else if (obj.type === 'folder') {
				cmds.push({
					id: `enter-folder-${obj.id}`,
					label: `Enter folder: ${obj.title}`,
					category: 'Navigate',
					keywords: ['folder', 'enter', 'navigate', 'open'],
					Icon: FolderOpenIcon,
					action: () => {
						while (canvas.folderStack.length > 0) actions.exitFolder();
						actions.enterFolder(obj.id);
						close();
					}
				});
			} else if (obj.type === 'bookmark') {
				cmds.push({
					id: `open-bookmark-${obj.id}`,
					label: `Open: ${obj.title || obj.domain || obj.url}`,
					category: 'Bookmarks',
					keywords: ['bookmark', 'link', 'url', 'open', obj.domain ?? ''],
					Icon: BookmarkIcon,
					action: () => {
						actions.startViewingBookmark(obj.id);
						close();
					}
				});
			} else if (obj.type === 'note') {
				const preview = obj.body.slice(0, 50).replace(/\n/g, ' ');
				cmds.push({
					id: `focus-note-${obj.id}`,
					label: `Note: ${preview}${obj.body.length > 50 ? '…' : ''}`,
					category: 'Notes',
					keywords: ['note', 'focus', 'select'],
					Icon: NoteIcon,
					action: () => {
						actions.selectOne(obj.id);
						close();
					}
				});
			}
		}
		return cmds;
	});

	const allCommands = $derived([...staticCommands, ...dynamicCommands]);

	// ── Filtering & grouping ──────────────────────────────────────────────────

	let query = $state('');
	let selectedIndex = $state(0);

	const keywordFiltered = $derived.by<Command[]>(() => {
		const q = query.toLowerCase().trim();
		if (!q) return allCommands;
		return allCommands.filter((c) => {
			const s = [c.label, c.category, ...(c.keywords ?? [])].join(' ').toLowerCase();
			return q.split(' ').every((w) => s.includes(w));
		});
	});

	// ── Semantic search (Nomic embeddings) ────────────────────────────────────

	let semanticHits = $state<SearchHit[]>([]);

	$effect(() => {
		const q = query.trim();
		if (!open || q.length < 3) {
			semanticHits = [];
			return;
		}
		const timer = setTimeout(async () => {
			try {
				semanticHits = await semanticSearch(q, 8);
			} catch {
				semanticHits = [];
			}
		}, 250);
		return () => clearTimeout(timer);
	});

	// Mirrors the id schemes of dynamicCommands so keyword matches dedupe
	// semantic duplicates of the same object.
	function objectCommand(obj: ObjectData): Command | null {
		if (obj.type === 'document') {
			return {
				id: `open-doc-${obj.id}`,
				label: `Open: ${obj.title || 'Untitled Document'}`,
				category: 'Search',
				Icon: FileTextIcon,
				action: () => {
					actions.startEditingDocument(obj.id);
					close();
				}
			};
		}
		if (obj.type === 'folder') {
			return {
				id: `enter-folder-${obj.id}`,
				label: `Enter folder: ${obj.title}`,
				category: 'Search',
				Icon: FolderOpenIcon,
				action: () => {
					while (canvas.folderStack.length > 0) actions.exitFolder();
					actions.enterFolder(obj.id);
					close();
				}
			};
		}
		if (obj.type === 'bookmark') {
			return {
				id: `open-bookmark-${obj.id}`,
				label: `Open: ${obj.title || obj.domain || obj.url}`,
				category: 'Search',
				Icon: BookmarkIcon,
				action: () => {
					actions.startViewingBookmark(obj.id);
					close();
				}
			};
		}
		if (obj.type === 'note') {
			const preview = obj.body.slice(0, 50).replace(/\n/g, ' ');
			return {
				id: `focus-note-${obj.id}`,
				label: `Note: ${preview}${obj.body.length > 50 ? '…' : ''}`,
				category: 'Search',
				Icon: NoteIcon,
				action: () => {
					actions.selectOne(obj.id);
					close();
				}
			};
		}
		if (obj.type === 'media') {
			return {
				id: `focus-media-${obj.id}`,
				label: `Image on canvas`,
				category: 'Search',
				Icon: StickerIcon,
				action: () => {
					actions.selectOne(obj.id);
					close();
				}
			};
		}
		return null;
	}

	const semanticCommands = $derived.by<Command[]>(() => {
		const cmds: Command[] = [];
		for (const hit of semanticHits) {
			const obj = canvas.objects.find((o) => o.id === hit.id);
			if (!obj) continue;
			const cmd = objectCommand(obj);
			if (cmd) cmds.push(cmd);
		}
		return cmds;
	});

	const filtered = $derived.by<Command[]>(() => {
		const seen = new Set(keywordFiltered.map((c) => c.id));
		return [...keywordFiltered, ...semanticCommands.filter((c) => !seen.has(c.id))];
	});

	// Only reset on query change, not on dynamic command changes
	$effect(() => {
		query;
		selectedIndex = 0;
	});

	type Group = { category: string; items: (Command & { idx: number })[] };
	const groups = $derived.by<Group[]>(() => {
		const map = new Map<string, Group>();
		filtered.forEach((cmd, i) => {
			if (!map.has(cmd.category)) map.set(cmd.category, { category: cmd.category, items: [] });
			map.get(cmd.category)!.items.push({ ...cmd, idx: i });
		});
		return [...map.values()];
	});

	// ── UI state ──────────────────────────────────────────────────────────────

	let inputEl: HTMLInputElement | undefined = $state();
	let listEl: HTMLDivElement | undefined = $state();

	function close() {
		open = false;
		query = '';
		selectedIndex = 0;
		capturingFor = null;
	}

	$effect(() => {
		if (open) {
			loadHotkeys();
			selectedIndex = 0;
			tick().then(() => inputEl?.focus());
		}
	});

	function scrollToSelected() {
		tick().then(() => {
			if (!listEl) return;
			const el = listEl.querySelector<HTMLElement>(`[data-idx="${selectedIndex}"]`);
			if (!el) return;
			const listRect = listEl.getBoundingClientRect();
			const elRect = el.getBoundingClientRect();
			const elTop = elRect.top - listRect.top + listEl.scrollTop;
			const elBottom = elTop + el.offsetHeight;
			const viewTop = listEl.scrollTop;
			const viewBottom = viewTop + listEl.clientHeight;
			if (elTop < viewTop) {
				listEl.scrollTop = elTop - 4;
			} else if (elBottom > viewBottom) {
				listEl.scrollTop = elBottom - listEl.clientHeight + 4;
			}
		});
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) return;
		// Capture mode intercepts everything
		if (capturingFor !== null) {
			e.preventDefault();
			e.stopPropagation();
			if (e.key === 'Escape') {
				capturingFor = null;
				return;
			}
			if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return;
			const hk: HotkeyDef = {
				key: e.key.toLowerCase(),
				ctrl: e.ctrlKey || e.metaKey || undefined,
				shift: e.shiftKey || undefined,
				alt: e.altKey || undefined
			};
			storedHotkeys = { ...storedHotkeys, [capturingFor]: hk };
			saveHotkeys();
			capturingFor = null;
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
			scrollToSelected();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
			scrollToSelected();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			filtered[selectedIndex]?.action();
		}
	}

	// ── Global hotkey listener ─────────────────────────────────────────────────

	onMount(() => {
		loadHotkeys();

		function onGlobalKey(e: KeyboardEvent) {
			// While palette is open: its own onKeydown handles everything
			if (open) return;

			// Don't fire when user is in a text field
			const active = document.activeElement as HTMLElement | null;
			const isTyping =
				active &&
				(active.tagName === 'INPUT' ||
					active.tagName === 'TEXTAREA' ||
					active.contentEditable === 'true');
			if (isTyping) return;

			for (const cmd of allCommands) {
				const hk = getHotkey(cmd.id);
				if (!hk) continue;
				if (hotkeyMatches(hk, e)) {
					e.preventDefault();
					cmd.action();
					return;
				}
			}
		}

		window.addEventListener('keydown', onGlobalKey, true);
		return () => window.removeEventListener('keydown', onGlobalKey, true);
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-200 bg-black/30 backdrop-blur-sm"
		onpointerdown={close}
		role="presentation"
	></div>

	<!-- Palette -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="border-base-200 bg-base-100 fixed top-[20%] left-1/2 z-201 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border shadow-2xl"
		role="dialog"
		aria-label="Command palette"
		onpointerdown={(e) => e.stopPropagation()}
	>
		<!-- Search input -->
		<div class="border-base-200 flex items-center gap-2 border-b px-4 py-3">
			<MagnifyingGlassIcon size={16} class="text-base-content/40 shrink-0" />
			<input
				bind:this={inputEl}
				bind:value={query}
				type="text"
				placeholder={capturingFor ? 'Press a key combination…' : 'Search commands…'}
				class="text-base-content placeholder:text-base-content/30 flex-1 bg-transparent text-sm outline-none {capturingFor
					? 'text-primary'
					: ''}"
				readonly={capturingFor !== null}
			/>
			<kbd class="border-base-200 text-base-content/30 rounded border px-1.5 py-0.5 text-[13px]"
				>Esc</kbd
			>
		</div>

		<!-- Results -->
		<div bind:this={listEl} class="max-h-80 overflow-y-auto py-1.5">
			{#if filtered.length === 0}
				<p class="text-base-content/30 px-4 py-6 text-center text-xs">No commands found.</p>
			{:else}
				{#each groups as group (group.category)}
					<div class="px-2 pt-2 pb-0.5">
						<p
							class="text-base-content/30 mb-0.5 px-2 text-[13px] font-semibold tracking-wider uppercase"
						>
							{group.category}
						</p>
						{#each group.items as item (item.id)}
							{@const hk = getHotkey(item.id)}
							{@const isCapturing = capturingFor === item.id}
							<div
								data-idx={item.idx}
								class="group/row flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors {item.idx ===
								selectedIndex
									? 'bg-primary/10 text-primary'
									: 'text-base-content/70 hover:bg-base-content/5 hover:text-base-content'}"
								onpointerenter={() => (selectedIndex = item.idx)}
								role="presentation"
							>
								<!-- Icon -->
								{#if item.Icon}
									<item.Icon size={14} class="shrink-0" />
								{/if}

								<!-- Label -->
								<button class="flex-1 truncate text-left" onclick={item.action}>
									{item.label}
								</button>

								<!-- Hotkey badge -->
								<div class="flex shrink-0 items-center gap-1">
									{#if isCapturing}
										<span
											class="border-primary/40 bg-primary/10 text-primary animate-pulse rounded border px-1.5 py-0.5 text-[13px]"
										>
											press key…
										</span>
									{:else if hk}
										<button
											class="border-base-200 text-base-content/40 hover:border-primary/40 hover:text-primary rounded border px-1.5 py-0.5 text-[13px] transition-colors"
											onclick={(e) => startCapture(item.id, e)}
											title="Click to change hotkey"
										>
											{formatHotkey(hk)}
										</button>
										<button
											class="text-base-content/20 hover:text-error hidden rounded p-0.5 transition-colors group-hover/row:flex"
											onclick={(e) => clearHotkey(item.id, e)}
											title="Remove hotkey"
										>
											<XIcon size={10} />
										</button>
									{:else}
										<button
											class="border-base-200 text-base-content/20 hover:border-primary/40 hover:text-primary hidden rounded border border-dashed px-1.5 py-0.5 text-[13px] transition-colors group-hover/row:block"
											onclick={(e) => startCapture(item.id, e)}
											title="Assign hotkey"
										>
											+ key
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/each}
			{/if}
		</div>

		<!-- Footer -->
		<div
			class="border-base-200 text-base-content/25 flex items-center gap-3 border-t px-4 py-2 text-[13px]"
		>
			<span><kbd class="font-mono">↑↓</kbd> navigate</span>
			<span><kbd class="font-mono">↵</kbd> run</span>
			<span><kbd class="font-mono">Esc</kbd> close</span>
			<span class="ml-auto">click a hotkey to reassign</span>
		</div>
	</div>
{/if}
