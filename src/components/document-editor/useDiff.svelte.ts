/**
 * Diff mode for reviewing AI-proposed document revisions.
 *
 * Wraps the `@codemirror/merge` unified merge view inside `diffCompartment` so
 * it can be toggled in and out of the editor without recreating the EditorView.
 *
 * ## Lifecycle
 *
 * 1. `enter(proposed)` — stores the current text as `diffOriginal`, replaces
 *    the editor content with the proposed text, and activates the merge view.
 * 2. While in diff mode, `DiffChunkButtons` renders floating Accept / Reject
 *    buttons at each changed chunk.  `diffChunks` is kept in sync with the
 *    editor scroll position via a `scrollTick` counter.
 * 3. `exit(keepCurrent)` — either rejects all remaining chunks (restoring
 *    original) or accepts the current state, then deactivates the merge view.
 * 4. `acceptAll()` — convenience shortcut that accepts every chunk at once.
 *
 * ## Annotation-driven revision
 *
 * `reviseWithAnnotations()` builds a prompt from the document's `EditorAnnot`
 * notes, streams an AI response, and calls `enter()` with the result so the
 * user can review changes before committing.
 *
 * Call `createDiff(getView, getAnnots, hideTooltip, resetAnnots)` once during
 * component initialisation.
 */

import type { EditorView } from '@codemirror/view';
import { acceptChunk, getChunks, rejectChunk, unifiedMergeView } from '@codemirror/merge';
import type { EditorAnnot } from '$lib/editor-types';
import { streamCompletion } from '$lib/ai';
import { diffCompartment } from './cm-setup';

export function createDiff(
	/** Returns the active EditorView; read on each call to tolerate async timing. */
	getView:       () => EditorView | undefined,
	/** Returns the current annotation list for the revision prompt. */
	getAnnots:     () => EditorAnnot[],
	/** Hides the annotation tooltip before entering diff mode. */
	hideTooltip:   () => void,
	/** Clears annotation records (their positions are invalidated by the diff replace). */
	resetAnnots:   () => void,
	/** Returns the editor body container element for relative button positioning. */
	getContainer?: () => HTMLElement | undefined,
) {
	// ── State ─────────────────────────────────────────────────────────────────

	/** Whether the unified merge view is currently active. */
	let diffMode = $state(false);

	/** The document text captured just before entering diff mode (used for reject-all). */
	let diffOriginal = $state('');

	/** True while an annotation-driven AI revision is streaming. */
	let reviseLoading = $state(false);

	/**
	 * Non-empty when `reviseWithAnnotations` fails.
	 * Auto-cleared after 5 s.
	 */
	let reviseError = $state('');

	/**
	 * Monotonically-increasing counter bumped on scroll and doc changes.
	 * The `$effect` below reads it as a dependency so chunk positions are
	 * recomputed whenever the viewport shifts.
	 */
	let scrollTick = $state(0);

	/**
	 * Screen Y coordinates for each pending diff chunk.
	 * Consumed by `DiffChunkButtons` to position the floating Accept/Reject buttons.
	 */
	let diffChunks: { fromB: number; y: number }[] = $state([]);

	// ── Chunk position tracking ───────────────────────────────────────────────

	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const _tick = scrollTick; // declare dependency
		const view  = getView();
		if (!view || !diffMode) { diffChunks = []; return; }

		const result = getChunks(view.state);
		if (!result?.chunks?.length) { diffChunks = []; return; }

		const containerTop = getContainer?.()?.getBoundingClientRect().top ?? 0;
		const fresh: { fromB: number; y: number }[] = [];
		for (const chunk of result.chunks) {
			try {
				const pos    = Math.min(chunk.fromB, view.state.doc.length);
				const coords = view.coordsAtPos(pos);
				if (coords) fresh.push({ fromB: chunk.fromB, y: coords.top - containerTop });
			} catch {
				// coordsAtPos can throw for positions beyond a shrunk document.
			}
		}
		diffChunks = fresh;
	});

	/** Bumps the scroll tick to re-derive chunk screen positions. */
	function notifyScroll() { scrollTick++; }

	// ── Diff lifecycle ────────────────────────────────────────────────────────

	/**
	 * Enters diff mode with a proposed replacement document.
	 *
	 * Stores the current text as the "original" side of the merge view, replaces
	 * the editor content with `proposed`, then activates the merge extension.
	 * Clears annotations first because their positions are invalidated.
	 */
	function enter(proposed: string) {
		const view = getView();
		if (!view) return;

		diffOriginal = view.state.doc.toString();
		resetAnnots();
		hideTooltip();

		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: proposed } });
		view.dispatch({
			effects: diffCompartment.reconfigure(
				unifiedMergeView({ original: diffOriginal, mergeControls: false, highlightChanges: true }),
			),
		});
		diffMode = true;
	}

	/**
	 * Exits diff mode.
	 *
	 * @param keepCurrent - If `true`, leaves the editor content as-is (accepts all
	 *   changes implicitly).  If `false`, rejects all remaining chunks first so the
	 *   document reverts to `diffOriginal`.
	 */
	function exit(keepCurrent: boolean) {
		const view = getView();
		if (!view) return;

		if (!keepCurrent) {
			const result = getChunks(view.state);
			if (result?.chunks) {
				for (const chunk of [...result.chunks].reverse()) rejectChunk(view, chunk.fromB);
			}
		}

		view.dispatch({ effects: diffCompartment.reconfigure([]) });
		diffMode     = false;
		diffOriginal = '';
		diffChunks   = [];
	}

	/**
	 * Accepts every pending chunk at once, then exits diff mode.
	 * Equivalent to clicking "Accept" on each chunk individually.
	 */
	function acceptAll() {
		const view = getView();
		if (!view) return;

		const result = getChunks(view.state);
		if (result?.chunks) {
			for (const chunk of [...result.chunks].reverse()) acceptChunk(view, chunk.fromB);
		}

		view.dispatch({ effects: diffCompartment.reconfigure([]) });
		diffMode     = false;
		diffOriginal = '';
		diffChunks   = [];
	}

	// ── Per-chunk helpers ─────────────────────────────────────────────────────

	/** Accepts the diff chunk whose modified side starts at `fromB`. */
	function acceptAt(fromB: number) {
		const view = getView();
		if (!view) return;
		acceptChunk(view, fromB);
		if (!getChunks(view.state)?.chunks?.length) exit(true);
	}

	/** Rejects the diff chunk whose modified side starts at `fromB`. */
	function rejectAt(fromB: number) {
		const view = getView();
		if (!view) return;
		rejectChunk(view, fromB);
		if (!getChunks(view.state)?.chunks?.length) exit(true);
	}

	// ── Annotation-driven revision ────────────────────────────────────────────

	/**
	 * Sends the current document and all non-empty annotation notes to the AI,
	 * streams a full replacement document, and enters diff mode with the result.
	 *
	 * No-ops if there are no annotated notes or a revision is already in flight.
	 */
	async function reviseWithAnnotations() {
		const view   = getView();
		const annots = getAnnots().filter((a) => a.note);
		if (!annots.length || !view || reviseLoading) return;

		reviseLoading = true;
		reviseError   = '';

		const original   = view.state.doc.toString();
		const annotBlock = annots.map((a) => `- "${a.quote}" → ${a.note}`).join('\n');
		const system     =
			'You are a document editor. Return ONLY the complete revised document with all requested changes applied. No explanation, no code fences, no preamble.';
		const userMsg    = `Document:\n\n${original}\n\nRequested changes (annotated by user):\n${annotBlock}`;

		try {
			let proposed = '';
			for await (const chunk of streamCompletion([{ role: 'user', content: userMsg }], system)) {
				proposed += chunk;
			}
			enter(proposed.trim());
		} catch (e: unknown) {
			reviseError = e instanceof Error ? e.message : String(e);
			setTimeout(() => (reviseError = ''), 5000);
		} finally {
			reviseLoading = false;
		}
	}

	// ── Public interface ──────────────────────────────────────────────────────

	return {
		get diffMode()      { return diffMode; },
		get reviseLoading() { return reviseLoading; },
		get reviseError()   { return reviseError; },
		get diffChunks()    { return diffChunks; },
		notifyScroll,
		enter,
		exit,
		acceptAll,
		acceptAt,
		rejectAt,
		reviseWithAnnotations,
	};
}
