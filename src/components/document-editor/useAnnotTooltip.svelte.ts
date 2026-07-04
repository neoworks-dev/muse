/**
 * Tooltip state for the inline annotation callout.
 *
 * Controls the hover card that appears over annotated text spans and manages
 * two distinct modes:
 *
 * - **View mode** — shows the annotation quote and note with Edit / Remove
 *   actions.  Auto-hides 200 ms after the pointer leaves (debounced so moving
 *   from the annotated span onto the tooltip itself doesn't flicker it away).
 *
 * - **Edit mode** — textarea for authoring or updating a note.  Dismissing
 *   without saving a non-empty note removes the annotation entirely (the mark
 *   decoration is also dropped via `removeAnnot`).
 *
 * Call `createAnnotTooltip(getAnnots, removeAnnot, updateAnnotNote)` once
 * during component initialisation.
 */

import type { EditorAnnot } from '$lib/editor-types';

export function createAnnotTooltip(
	/** Returns the current annotation list; read on each access to stay in sync. */
	getAnnots:      () => EditorAnnot[],
	/** Removes an annotation by id (CM decoration + record). */
	removeAnnot:    (id: string) => void,
	/** Writes a new note text into an existing annotation record. */
	updateAnnotNote:(id: string, note: string) => void,
) {
	// ── State ─────────────────────────────────────────────────────────────────

	/** Id of the annotation whose tooltip is currently visible, or null. */
	let tooltipAnnotId: string | null = $state(null);

	/** Absolute screen position for the tooltip (fixed, not relative to scroll). */
	let tooltipPos: { x: number; y: number } | null = $state(null);

	/** Whether the tooltip is in textarea-edit mode (vs. read-only view mode). */
	let tooltipEditMode = $state(false);

	/**
	 * Seed value fed into `AnnotTooltip` when edit mode opens.
	 * Set to the existing note text when editing an annotation, or `''` when
	 * creating a brand-new annotation.
	 */
	let tooltipInitialDraft = $state('');

	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	// ── Timer helpers ─────────────────────────────────────────────────────────

	/** Cancels any pending auto-hide timer. */
	function clearTimer() {
		if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
	}

	/**
	 * Hides the tooltip immediately and resets all tooltip state.
	 * Safe to call redundantly.
	 */
	function hide() {
		tooltipAnnotId  = null;
		tooltipPos      = null;
		tooltipEditMode = false;
		tooltipInitialDraft = '';
		clearTimer();
	}

	/**
	 * Schedules a hide after 200 ms unless the pointer has moved back onto the
	 * tooltip or its edit mode is active.
	 *
	 * Used by `mouseleave` on the annotated span so that moving onto the tooltip
	 * card itself cancels the timer.
	 */
	function scheduleHide() {
		clearTimer();
		hideTimer = setTimeout(() => { if (!tooltipEditMode) hide(); }, 200);
	}

	// ── Show helpers ──────────────────────────────────────────────────────────

	/**
	 * Shows the tooltip in view mode for an existing annotation.
	 * Cancels any pending hide timer so the card stays visible.
	 */
	function show(id: string, pos: { x: number; y: number }) {
		clearTimer();
		tooltipAnnotId = id;
		tooltipPos     = pos;
	}

	/**
	 * Opens the tooltip for a freshly created annotation, starting directly in
	 * edit mode with an empty draft.
	 *
	 * If `pos` is `null` (e.g. the position was off-screen), the tooltip is
	 * still opened so the user can still save or cancel — it just won't be
	 * visible until they scroll to it.
	 */
	function openNew(id: string, pos: { x: number; y: number } | null) {
		tooltipAnnotId      = id;
		tooltipPos          = pos;
		tooltipInitialDraft = '';
		tooltipEditMode     = true;
	}

	// ── Edit lifecycle ────────────────────────────────────────────────────────

	/**
	 * Switches an already-visible tooltip from view mode to edit mode.
	 * Initialises the draft with the annotation's current note text.
	 */
	function startEdit() {
		const ann = getAnnots().find((a) => a.id === tooltipAnnotId);
		if (!ann) return;
		tooltipInitialDraft = ann.note;
		tooltipEditMode     = true;
	}

	/**
	 * Saves the edited note.
	 *
	 * - Empty note → removes the annotation entirely.
	 * - Non-empty note → updates the record and closes the tooltip.
	 */
	function commit(note: string) {
		if (!tooltipAnnotId) return;
		if (!note.trim()) {
			removeAnnot(tooltipAnnotId);
		} else {
			updateAnnotNote(tooltipAnnotId, note.trim());
		}
		hide();
	}

	/**
	 * Discards edits.
	 *
	 * If the annotation was just created (note is still empty), it is removed
	 * so the user isn't left with a decoration that has no note.
	 */
	function cancel() {
		if (tooltipAnnotId) {
			const ann = getAnnots().find((a) => a.id === tooltipAnnotId);
			if (ann && !ann.note) removeAnnot(tooltipAnnotId);
		}
		hide();
	}

	// ── Public interface ──────────────────────────────────────────────────────

	return {
		get tooltipAnnotId()      { return tooltipAnnotId; },
		get tooltipPos()          { return tooltipPos; },
		get tooltipEditMode()     { return tooltipEditMode; },
		get tooltipInitialDraft() { return tooltipInitialDraft; },
		clearTimer,
		hide,
		scheduleHide,
		show,
		openNew,
		startEdit,
		commit,
		cancel,
	};
}
