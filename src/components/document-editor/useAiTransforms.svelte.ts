/**
 * AI-powered whole-document transforms: Refactor and Expand.
 *
 * Each transform works by:
 * 1. Capturing the current document text as `original`.
 * 2. Clearing the editor content.
 * 3. Streaming the AI response and appending each token directly into the
 *    CodeMirror view so the user sees the text appear in real time.
 * 4. On error, restoring the original text and showing a timed error banner.
 *
 * Annotations are cleared before a transform because their stored `from`/`to`
 * positions would be invalidated by the full content replacement.
 *
 * Call `createAiTransforms(getView, resetAnnots)` once during component
 * initialisation.
 */

import type { EditorView } from '@codemirror/view';
import { streamCompletion } from '$lib/ai';

export function createAiTransforms(
	/** Returns the active EditorView; read on each call to tolerate async timing. */
	getView:      () => EditorView | undefined,
	/** Clears all annotation records before a transform overwrites the document. */
	resetAnnots:  () => void,
) {
	// ── State ─────────────────────────────────────────────────────────────────

	/** True while an AI streaming response is in flight. */
	let aiTransforming = $state(false);

	/**
	 * Non-empty string when the last transform failed.
	 * Auto-cleared after 5 s so the banner disappears without user interaction.
	 */
	let aiError = $state('');

	// ── Core transform ────────────────────────────────────────────────────────

	/**
	 * Runs a whole-document AI transform described by `systemPrompt`.
	 *
	 * The prompt should instruct the model to return only the rewritten
	 * markdown with no preamble so the raw stream can be appended directly.
	 */
	async function applyTransform(systemPrompt: string) {
		const view = getView();
		if (aiTransforming || !view) return;

		aiTransforming = true;
		aiError        = '';
		resetAnnots();

		const original = view.state.doc.toString();
		try {
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
			for await (const chunk of streamCompletion(
				[{ role: 'user', content: original }],
				systemPrompt,
			)) {
				const len = view.state.doc.length;
				view.dispatch({ changes: { from: len, to: len, insert: chunk } });
			}
		} catch (e: unknown) {
			// Roll back to the original text so the user isn't left with a blank document.
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: original } });
			aiError = e instanceof Error ? e.message : String(e);
			setTimeout(() => (aiError = ''), 5000);
		} finally {
			aiTransforming = false;
		}
	}

	// ── Named transforms ──────────────────────────────────────────────────────

	/**
	 * Rewrites the document for clarity, structure, and persuasiveness while
	 * preserving all key points.
	 */
	function refactor() {
		applyTransform(
			'You are a writing assistant. Rewrite the provided markdown text to be clearer, better structured, and more compelling. Preserve all key points. Return only the rewritten markdown, no preamble.',
		);
	}

	/**
	 * Expands the document with additional detail, examples, and depth while
	 * maintaining the author's voice and existing structure.
	 */
	function expand() {
		applyTransform(
			'You are a writing assistant. Expand and elaborate on the provided markdown. Add more detail, examples, nuance and depth while maintaining voice and structure. Return only the expanded markdown, no preamble.',
		);
	}

	// ── Public interface ──────────────────────────────────────────────────────

	return {
		get aiTransforming() { return aiTransforming; },
		get aiError()        { return aiError; },
		refactor,
		expand,
	};
}
