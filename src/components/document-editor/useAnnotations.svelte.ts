/**
 * Reactive annotation state and operations for the document editor.
 *
 * An "annotation" is a highlighted text range with an attached freeform note.
 * This module manages:
 * - The list of `EditorAnnot` records (id, from/to positions, quote, note).
 * - The ephemeral "selection bar" state that appears when the user selects
 *   text and wants to create a new annotation.
 * - CodeMirror dispatch helpers that add/remove the `cm-annot` mark decorations
 *   that visually highlight annotated ranges in the editor.
 *
 * Call `createAnnotations(getView)` once during component initialisation.
 * Pass a getter so the function captures a stable reference without needing the
 * EditorView to exist at call time (it is created in `onMount`).
 */

import { tick } from 'svelte';
import type { EditorView } from '@codemirror/view';
import type { EditorAnnot } from '$lib/editor-types';
import { addAnnotEff, rmAnnotEff } from './cm-setup';

export function createAnnotations(getView: () => EditorView | undefined) {
	// ── State ─────────────────────────────────────────────────────────────────

	/** All current annotation records for the open document. */
	let editorAnnots: EditorAnnot[] = $state([]);

	/**
	 * Populated when the user lifts the pointer after selecting text.
	 * Drives the `AnnotSelBar` floating toolbar.  Cleared when selection is
	 * dismissed or an annotation is created from it.
	 */
	let editorSelBar: { from: number; to: number; x: number; y: number } | null = $state(null);

	// ── Operations ────────────────────────────────────────────────────────────

	/**
	 * Called on `mouseup` inside the editor wrapper.  Reads the current
	 * CodeMirror selection and updates `editorSelBar` with screen coordinates
	 * so the floating annotation toolbar can position itself.
	 *
	 * The 0 ms `setTimeout` lets the browser finalise the selection before we
	 * read it — without the delay, `selection.main` may still be empty.
	 */
	function onEditorMouseUp() {
		setTimeout(() => {
			const view = getView();
			if (!view) return;
			const sel = view.state.selection.main;
			if (sel.empty) { editorSelBar = null; return; }
			const c1 = view.coordsAtPos(sel.from);
			const c2 = view.coordsAtPos(sel.to);
			if (!c1) { editorSelBar = null; return; }
			editorSelBar = {
				from: sel.from,
				to: sel.to,
				x: (c1.left + (c2?.right ?? c1.right)) / 2,
				y: c1.top,
			};
		}, 0);
	}

	/**
	 * Converts the active selection bar into a new annotation record and a
	 * matching CM mark decoration, then collapses the cursor.
	 *
	 * Returns `{ id, pos }` so the caller can open the tooltip in edit mode at
	 * the right screen position.  Returns `null` if there is no active
	 * selection bar or no editor view.
	 *
	 * Awaits `tick()` so that Svelte has flushed the new annotation into the
	 * DOM before the caller tries to position the tooltip over it.
	 */
	async function createEditorAnnot(): Promise<{ id: string; pos: { x: number; y: number } | null } | null> {
		const view = getView();
		if (!editorSelBar || !view) return null;

		const { from, to } = editorSelBar;
		const quote  = view.state.sliceDoc(from, to);
		const id     = crypto.randomUUID();
		const coords = view.coordsAtPos(from);

		view.dispatch({ effects: addAnnotEff.of({ id, from, to }) });
		editorAnnots = [...editorAnnots, { id, from, to, quote, note: '' }];
		editorSelBar = null;
		view.dispatch({ selection: { anchor: from } });
		await tick();

		return {
			id,
			pos: coords ? { x: (coords.left + coords.right) / 2, y: coords.bottom + 8 } : null,
		};
	}

	/**
	 * Removes an annotation by id: dispatches the CM effect to drop the
	 * decoration and filters the annotation out of the list.
	 */
	function removeEditorAnnot(id: string) {
		const view = getView();
		if (view) view.dispatch({ effects: rmAnnotEff.of(id) });
		editorAnnots = editorAnnots.filter((a) => a.id !== id);
	}

	/**
	 * Updates the note text of an existing annotation record in-place.
	 * Does not touch the CM decoration (the highlight persists regardless of
	 * whether a note has been written yet).
	 */
	function updateAnnotNote(id: string, note: string) {
		editorAnnots = editorAnnots.map((a) => (a.id === id ? { ...a, note } : a));
	}

	// ── Public interface ──────────────────────────────────────────────────────

	return {
		get editorAnnots()         { return editorAnnots; },
		set editorAnnots(v)        { editorAnnots = v; },
		get editorSelBar()         { return editorSelBar; },
		set editorSelBar(v)        { editorSelBar = v; },
		onEditorMouseUp,
		createEditorAnnot,
		removeEditorAnnot,
		updateAnnotNote,
	};
}
