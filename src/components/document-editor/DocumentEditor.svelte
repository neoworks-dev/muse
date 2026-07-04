<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import MagicWandIcon from 'phosphor-svelte/lib/MagicWandIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import XCircleIcon from 'phosphor-svelte/lib/XCircleIcon';
	import TextHIcon from 'phosphor-svelte/lib/TextHIcon';
	import ListBulletsIcon from 'phosphor-svelte/lib/ListBulletsIcon';
	import ListNumbersIcon from 'phosphor-svelte/lib/ListNumbersIcon';
	import ArrowsOutIcon from 'phosphor-svelte/lib/ArrowsOutIcon';
	import ArrowsInIcon from 'phosphor-svelte/lib/ArrowsInIcon';
	import { EditorView, keymap, drawSelection } from '@codemirror/view';
	import { EditorState, Compartment } from '@codemirror/state';
	import { markdown } from '@codemirror/lang-markdown';
	import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
	import { syntaxHighlighting } from '@codemirror/language';
	import { vim } from '@replit/codemirror-vim';

	import FloatingWindow from '../FloatingWindow.svelte';
	import { saveStatus, scheduleSync } from '$lib/sync.svelte';
	import { loadSettings, saveSettings } from '$lib/settings';
	import AnnotSelBar from './AnnotSelBar.svelte';
	import AnnotTooltip from './AnnotTooltip.svelte';
	import DiffChunkButtons from './DiffChunkButtons.svelte';

	import { createAnnotations } from './useAnnotations.svelte';
	import { createAnnotTooltip } from './useAnnotTooltip.svelte';
	import { createAiTransforms } from './useAiTransforms.svelte';
	import { createDiff } from './useDiff.svelte';
	import { annotDecorField, diffCompartment, markdownStyle, cmTheme } from './cm-setup';
	import type { EditorAnnot } from '$lib/editor-types';

	// ── Props ────────────────────────────────────────────────────────────────

	let {
		initialContent,
		onCommit,
		onCancel,
		onUpdate,
		onAnnotsChange,
		onOpenChat,
		origin,
		storageKey,
		proposedDoc = $bindable<string | null>(null)
	}: {
		initialContent: string;
		onCommit: (text: string) => void;
		onCancel: () => void;
		onUpdate?: (text: string) => void;
		onAnnotsChange?: (annots: EditorAnnot[]) => void;
		onOpenChat?: () => void;
		origin?: { x: number; y: number; w: number; h: number };
		storageKey?: string;
		proposedDoc?: string | null;
	} = $props();

	// ── Window open state ─────────────────────────────────────────────────────

	let isOpen = $state(true);

	$effect(() => {
		if (!isOpen && view) {
			const text = view.state.doc.toString();
			setTimeout(() => onCommit(text), 180);
		}
	});

	// ── Editor ref ────────────────────────────────────────────────────────────

	let cmContainer: HTMLDivElement;
	let editorBody: HTMLDivElement;
	let view: EditorView | undefined;
	let updateDebounce: ReturnType<typeof setTimeout> | undefined;

	// ── Local state ───────────────────────────────────────────────────────────

	let docText = $state(initialContent);
	let activeHeading = $state(0);
	let vimMode = $state(loadSettings().vimMode);

	const vimCompartment = new Compartment();

	const wordCount = $derived(docText.trim() ? docText.trim().split(/\s+/).length : 0);

	// ── Composables ───────────────────────────────────────────────────────────

	const annots = createAnnotations(() => view);

	const tooltip = createAnnotTooltip(
		() => annots.editorAnnots,
		(id) => annots.removeEditorAnnot(id),
		(id, note) => annots.updateAnnotNote(id, note)
	);

	const transforms = createAiTransforms(
		() => view,
		() => {
			annots.editorAnnots = [];
		}
	);

	const diff = createDiff(
		() => view,
		() => annots.editorAnnots,
		() => tooltip.hide(),
		() => { annots.editorAnnots = []; },
		() => editorBody
	);

	const displayError = $derived(transforms.aiError || diff.reviseError);

	// Propagate annotations to parent for AIChat context
	$effect(() => {
		if (onAnnotsChange) onAnnotsChange(annots.editorAnnots);
	});

	// Accept externally proposed doc (from AIChat "Apply to doc")
	$effect(() => {
		if (proposedDoc && view) {
			diff.enter(proposedDoc);
			proposedDoc = null;
		}
	});

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	onMount(() => {
		view = new EditorView({
			state: EditorState.create({
				doc: initialContent,
				extensions: [
					vimCompartment.of(vimMode ? vim() : []),
					drawSelection(),
					markdown(),
					history(),
					syntaxHighlighting(markdownStyle),
					EditorView.lineWrapping,
					annotDecorField,
					diffCompartment.of([]),
					keymap.of([
						{
							key: 'Escape',
							run: () => {
								isOpen = false;
								return true;
							}
						},
						{
							key: 'Mod-s',
							run: () => {
								scheduleSync();
								return true;
							}
						},
						indentWithTab,
						...historyKeymap,
						...defaultKeymap
					]),
					cmTheme,
					EditorView.updateListener.of((u) => {
						if (u.docChanged) {
							docText = u.state.doc.toString();
							if (onUpdate) {
								clearTimeout(updateDebounce);
								updateDebounce = setTimeout(() => onUpdate!(docText), 1500);
							}
							diff.notifyScroll();
						}
						if (u.selectionSet || u.docChanged) {
							const line = u.state.doc.lineAt(u.state.selection.main.from);
							const m = line.text.match(/^(#{1,3}) /);
							activeHeading = m ? m[1].length : 0;
						}
						if (u.geometryChanged || u.viewportChanged) diff.notifyScroll();
					})
				]
			}),
			parent: cmContainer
		});
		view.focus();

		let rafPending = false;
		view.scrollDOM.addEventListener('scroll', () => {
			if (rafPending) return;
			rafPending = true;
			requestAnimationFrame(() => {
				diff.notifyScroll();
				rafPending = false;
			});
		});

		view.dom.addEventListener('mouseover', (e: MouseEvent) => {
			const target = (e.target as HTMLElement).closest('[data-annot]') as HTMLElement | null;
			if (!target || tooltip.tooltipEditMode) return;
			const annotId = target.getAttribute('data-annot');
			if (!annotId) return;
			tooltip.clearTimer();
			const rect = target.getBoundingClientRect();
			tooltip.show(annotId, { x: rect.left + rect.width / 2, y: rect.bottom + 8 });
		});

		view.dom.addEventListener('mouseout', (e: MouseEvent) => {
			const target = (e.target as HTMLElement).closest('[data-annot]') as HTMLElement | null;
			if (target && !tooltip.tooltipEditMode) tooltip.scheduleHide();
		});

		const clearSel = (e: PointerEvent) => {
			const t = e.target as HTMLElement;
			if (t.closest('[data-sel-bar], [data-annot-tooltip]')) return;
			if (!t.closest('.cm-content, .cm-line')) annots.editorSelBar = null;
		};
		window.addEventListener('pointerdown', clearSel);
		return () => window.removeEventListener('pointerdown', clearSel);
	});

	onDestroy(() => {
		view?.destroy();
		clearTimeout(updateDebounce);
	});

	$effect(() => {
		if (!view) return;
		view.dispatch({ effects: vimCompartment.reconfigure(vimMode ? vim() : []) });
	});

	// ── Formatting helpers ────────────────────────────────────────────────────

	function toggleHeading(level: 1 | 2 | 3) {
		if (!view) return;
		const { state } = view;
		const line = state.doc.lineAt(state.selection.main.from);
		const prefix = '#'.repeat(level) + ' ';
		const stripped = line.text.replace(/^#{1,6} /, '');
		if (line.text.startsWith(prefix)) {
			view.dispatch({ changes: { from: line.from, to: line.from + prefix.length, insert: '' } });
		} else {
			view.dispatch({ changes: { from: line.from, to: line.to, insert: prefix + stripped } });
		}
		view.focus();
	}

	function toggleInline(marker: string) {
		if (!view) return;
		const { state } = view;
		const { from, to } = state.selection.main;
		if (from === to) return;
		const text = state.sliceDoc(from, to);
		if (text.startsWith(marker) && text.endsWith(marker)) {
			view.dispatch({ changes: { from, to, insert: text.slice(marker.length, -marker.length) } });
		} else {
			view.dispatch({ changes: { from, to, insert: `${marker}${text}${marker}` } });
		}
		view.focus();
	}

	function toggleList(ordered: boolean) {
		if (!view) return;
		const { state } = view;
		const line = state.doc.lineAt(state.selection.main.from);
		const prefix = ordered ? '1. ' : '- ';
		if (line.text.startsWith(prefix)) {
			view.dispatch({ changes: { from: line.from, to: line.from + prefix.length, insert: '' } });
		} else {
			view.dispatch({ changes: { from: line.from, to: line.from, insert: prefix } });
		}
		view.focus();
	}

	async function onAnnotateSelection() {
		const result = await annots.createEditorAnnot();
		if (result) tooltip.openNew(result.id, result.pos);
	}
</script>

<!-- ══════════════════════════ TEMPLATE ══════════════════════════════════════ -->

<FloatingWindow
	bind:open={isOpen}
	width={760}
	height={620}
	minwidth={420}
	minheight={320}
	center={true}
	zIndex={50}
	{origin}
	{storageKey}
>
	{#snippet children({ fullscreen, startDrag, moveDrag, endDrag, toggleFullscreen })}
		<!-- ── Toolbar ─────────────────────────────────────────────────────────── -->
		<header
			class="flex h-11 shrink-0 items-center gap-0.5 border-b border-base-200 px-2 select-none {fullscreen
				? ''
				: 'cursor-grab active:cursor-grabbing'}"
			onpointerdown={startDrag}
			onpointermove={moveDrag}
			onpointerup={endDrag}
			role="presentation"
		>
			{#if diff.diffMode}
				<!-- Diff mode toolbar -->
				<div
					class="flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[0.72rem] font-medium text-amber-700"
				>
					<MagicWandIcon size={13} weight="bold" />
					Review AI changes
				</div>
				<span class="ml-1 hidden text-[0.68rem] text-base-content/40 sm:block"
					>Accept or reject each change inline</span
				>
				<div class="flex-1" />
				<button
					class="btn gap-1 border-none bg-success text-success-content btn-xs hover:brightness-95"
					onclick={() => diff.acceptAll()}
				>
					<CheckCircleIcon size={13} weight="bold" /> Accept all
				</button>
				<button
					class="btn gap-1 border border-base-300 btn-ghost btn-xs"
					onclick={() => diff.exit(false)}
				>
					<XCircleIcon size={13} weight="bold" /> Reject all
				</button>
			{:else}
				<!-- Normal toolbar -->
				<button
					class="btn mr-1 btn-square shrink-0 text-base-content/60 btn-ghost btn-xs"
					onclick={() => {
						isOpen = false;
					}}
					aria-label="Close"
				>
					<ArrowLeftIcon size={13} weight="bold" />
				</button>

				<div class="mx-0.5 h-5 w-px shrink-0 bg-base-content/10" />

				<!-- Headings -->
				{#each [1, 2, 3] as const as level}
					<button
						class="btn px-2 font-semibold btn-ghost btn-xs {activeHeading === level
							? 'bg-primary/10 text-primary'
							: 'text-base-content/50'}"
						onclick={() => toggleHeading(level)}
						title="Heading {level}">H{level}</button
					>
				{/each}

				<div class="mx-0.5 h-5 w-px shrink-0 bg-base-content/10" />

				<!-- Lists -->
				<button
					class="btn btn-square text-base-content/50 btn-ghost btn-xs"
					onclick={() => toggleList(false)}
					title="Bullet list"
				>
					<ListBulletsIcon size={14} />
				</button>
				<button
					class="btn btn-square text-base-content/50 btn-ghost btn-xs"
					onclick={() => toggleList(true)}
					title="Numbered list"
				>
					<ListNumbersIcon size={14} />
				</button>

				<div class="mx-0.5 h-5 w-px shrink-0 bg-base-content/10" />

				<!-- Inline formatting -->
				<button
					class="btn btn-square font-bold text-base-content/50 btn-ghost btn-xs"
					onclick={() => toggleInline('**')}
					title="Bold">B</button
				>
				<button
					class="btn btn-square text-base-content/50 italic btn-ghost btn-xs"
					onclick={() => toggleInline('_')}
					title="Italic">I</button
				>

				<div class="flex-1" />

				{#if displayError}
					<span
						class="max-w-[220px] overflow-hidden rounded-lg border border-error/20 bg-error/10 px-2 py-1 text-[0.7rem] text-ellipsis whitespace-nowrap text-error"
					>
						{displayError}
					</span>
				{/if}

				<!-- AI actions -->
				{#if annots.editorAnnots.some((a) => a.note)}
					<button
						class="btn gap-1 border-none bg-violet-50 text-violet-700 btn-xs hover:bg-violet-100 disabled:opacity-45"
						onclick={() => diff.reviseWithAnnotations()}
						disabled={diff.reviseLoading || transforms.aiTransforming}
					>
						{#if diff.reviseLoading}<CircleNotchIcon
								size={12}
								class="animate-spin"
							/>{:else}<MagicWandIcon size={12} weight="bold" />{/if}
						Revise
					</button>
				{/if}

				<button
					class="btn gap-1 text-base-content/50 btn-ghost btn-xs disabled:opacity-45"
					onclick={() => transforms.refactor()}
					disabled={transforms.aiTransforming || diff.reviseLoading}
					title="Refactor"
				>
					{#if transforms.aiTransforming}<CircleNotchIcon
							size={12}
							class="animate-spin"
						/>{:else}<ArrowsClockwiseIcon size={12} weight="bold" />{/if}
				</button>
				<button
					class="btn gap-1 text-base-content/50 btn-ghost btn-xs disabled:opacity-45"
					onclick={() => transforms.expand()}
					disabled={transforms.aiTransforming || diff.reviseLoading}
					title="Expand with AI"
				>
					{#if !transforms.aiTransforming}<SparkleIcon size={12} weight="bold" />{/if}
				</button>

				<div class="mx-0.5 h-5 w-px shrink-0 bg-base-content/10" />

				<button
					class="btn btn-square text-base-content/40 btn-ghost btn-xs"
					onclick={toggleFullscreen}
					title={fullscreen ? 'Restore' : 'Fullscreen'}
				>
					{#if fullscreen}<ArrowsInIcon size={13} />{:else}<ArrowsOutIcon size={13} />{/if}
				</button>
			{/if}
		</header>

		<!-- ── Editor body ──────────────────────────────────────────────────────── -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={editorBody}
			class="relative min-h-0 flex-1 overflow-hidden"
			onmouseup={() => annots.onEditorMouseUp()}
			role="textbox"
			aria-multiline="true"
			aria-label="Document editor"
		>
			<div bind:this={cmContainer} class="h-full" />
			<DiffChunkButtons
				chunks={diff.diffChunks}
				onAccept={(fromB) => diff.acceptAt(fromB)}
				onReject={(fromB) => diff.rejectAt(fromB)}
			/>
		</div>

		<!-- ── Footer ───────────────────────────────────────────────────────────── -->
		<footer class="flex h-9 shrink-0 items-center gap-3 border-t border-base-200 px-4">
			<span class="text-[11px] text-base-content/35"
				>{wordCount} word{wordCount !== 1 ? 's' : ''}</span
			>
			<button
				class="btn btn-ghost btn-xs text-[10px] font-mono {vimMode ? 'text-primary' : 'text-base-content/30'}"
				onclick={() => {
					vimMode = !vimMode;
					saveSettings({ ...loadSettings(), vimMode });
				}}
				title="Toggle vim mode"
			>VIM</button>
			{#if onOpenChat}
				<button
					class="btn gap-1 text-base-content/40 btn-ghost btn-xs hover:text-base-content"
					onclick={onOpenChat}
				>
					<SparkleIcon size={11} weight="bold" /> Chat
				</button>
			{/if}
			<div class="flex-1" />
			<div class="flex items-center gap-1 text-base-content/35 select-none" title="Auto-saved">
				{#if saveStatus.saving}
					<CircleNotchIcon size={14} class="animate-spin" />
					<span class="text-[10px]">Saving…</span>
				{:else if saveStatus.savedAt > 0}
					<CheckCircleIcon size={14} />
					<span class="text-[10px]">Saved</span>
				{/if}
			</div>
		</footer>
	{/snippet}
</FloatingWindow>

<!-- ── Floating annotation selection bar ─────────────────────────────────── -->
<AnnotSelBar selBar={annots.editorSelBar} onAnnotate={onAnnotateSelection} />

<!-- ── Annotation hover tooltip ──────────────────────────────────────────── -->
<AnnotTooltip
	annotId={tooltip.tooltipAnnotId}
	pos={tooltip.tooltipPos}
	ann={annots.editorAnnots.find((a) => a.id === tooltip.tooltipAnnotId)}
	editMode={tooltip.tooltipEditMode}
	initialDraft={tooltip.tooltipInitialDraft}
	onMouseEnter={() => tooltip.clearTimer()}
	onMouseLeave={() => {
		if (!tooltip.tooltipEditMode) tooltip.scheduleHide();
	}}
	onStartEdit={() => tooltip.startEdit()}
	onCommit={(note) => tooltip.commit(note)}
	onCancel={() => tooltip.cancel()}
	onRemove={(id) => annots.removeEditorAnnot(id)}
/>

<style>
	:global(.cm-deletedChunk) {
		background: rgba(239, 68, 68, 0.08) !important;
	}
	:global(.cm-deletedChunk .cm-line) {
		text-decoration: line-through;
		color: rgba(185, 28, 28, 0.7) !important;
	}
	:global(.cm-changedLine) {
		background: rgba(74, 222, 128, 0.08) !important;
	}
	:global(.cm-changedText) {
		background: rgba(74, 222, 128, 0.22) !important;
		border-radius: 2px;
	}
	:global(.cm-deletedText) {
		background: rgba(239, 68, 68, 0.22) !important;
		border-radius: 2px;
	}
	:global(.cm-mergeGap) {
		background: rgba(0, 0, 0, 0.03) !important;
	}
</style>
