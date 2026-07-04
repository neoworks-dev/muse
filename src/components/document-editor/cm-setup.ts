/**
 * Static CodeMirror extension definitions for the document editor.
 *
 * All exports are module-level singletons — safe to share across multiple
 * EditorView instances because StateEffect, StateField, Compartment, and
 * HighlightStyle/theme are type-level constructs; per-instance state lives
 * inside each EditorView's own StateConfig, not here.
 */

import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { Compartment, StateEffect, StateField } from '@codemirror/state';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// ── Diff compartment ─────────────────────────────────────────────────────────

/**
 * Swappable compartment that hosts the unified merge-view extension while diff
 * mode is active.  Reconfigured to `[]` when diff mode exits so the extension
 * is cleanly torn down without recreating the entire editor.
 */
export const diffCompartment = new Compartment();

// ── Annotation state effects ─────────────────────────────────────────────────

/**
 * Dispatched to add a `cm-annot` mark decoration for a new annotation.
 * The decoration carries a `data-annot` HTML attribute containing the UUID so
 * DOM event listeners can identify which annotation the user is hovering.
 */
export const addAnnotEff = StateEffect.define<{ id: string; from: number; to: number }>();

/**
 * Dispatched to remove the mark decoration for an annotation that has been
 * deleted or whose note was cleared.
 */
export const rmAnnotEff = StateEffect.define<string>();

// ── Annotation decoration field ──────────────────────────────────────────────

/**
 * StateField that maintains the active set of inline annotation decorations.
 *
 * Reacts to `addAnnotEff` (add a range mark) and `rmAnnotEff` (filter by id),
 * and remaps decoration positions through document changes automatically via
 * `DecorationSet.map`.
 */
export const annotDecorField = StateField.define<DecorationSet>({
	create: () => Decoration.none,

	update(set, tr) {
		set = set.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(addAnnotEff)) {
				set = set.update({
					add: [
						Decoration.mark({
							class: 'cm-annot',
							attributes: { 'data-annot': e.value.id },
						}).range(e.value.from, e.value.to),
					],
				});
			} else if (e.is(rmAnnotEff)) {
				set = set.update({
					filter: (_f, _t, d) => d.spec.attributes?.['data-annot'] !== e.value,
				});
			}
		}
		return set;
	},

	provide: (f) => EditorView.decorations.from(f),
});

// ── Markdown syntax highlighting ─────────────────────────────────────────────

/**
 * Visual overrides for Lezer markdown tokens.
 *
 * Headings receive scaled font sizes, links use the brand indigo, and inline
 * code uses a monospace stack with a muted red tint to stand out from prose.
 */
export const markdownStyle = HighlightStyle.define([
	{ tag: tags.heading1,            fontSize: '1.65em', fontWeight: '700', lineHeight: '1.25', color: 'var(--text)' },
	{ tag: tags.heading2,            fontSize: '1.3em',  fontWeight: '700', color: 'var(--text)' },
	{ tag: tags.heading3,            fontSize: '1.1em',  fontWeight: '600', color: 'var(--text)' },
	{ tag: tags.strong,              fontWeight: '700' },
	{ tag: tags.emphasis,            fontStyle: 'italic' },
	{ tag: tags.strikethrough,       textDecoration: 'line-through' },
	{ tag: tags.link,                color: 'var(--ctx-violet)' },
	{ tag: tags.url,                 color: 'var(--ctx-violet)' },
	{ tag: tags.processingInstruction, color: 'var(--text-faint)' },
	{ tag: tags.contentSeparator,    color: 'var(--text-faint)' },
	{
		tag: tags.monospace,
		fontFamily: "var(--font-mono)",
		fontSize: '0.88em',
		color: 'var(--ctx-red)',
	},
]);

// ── Editor theme ─────────────────────────────────────────────────────────────

/**
 * Base CodeMirror theme for the document editor.
 *
 * Key design decisions:
 * - Transparent background so the host container's colour shows through.
 * - Gutters hidden — this is a prose editor, not a code editor.
 * - Content column capped at 560 px and centred with symmetric padding so
 *   long documents stay readable at wide viewport widths.
 * - `.cm-annot` style must stay in sync with the `annotDecorField` class name.
 */
export const cmTheme = EditorView.theme({
	'&':           { background: 'transparent', fontSize: '15px', flex: '1', height: '100%' },
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': {
		fontFamily:     'var(--font-sans)',
		lineHeight:     '1.75',
		overflowY:      'auto',
		scrollBehavior: 'smooth',
		padding:        '4rem max(2rem, calc(50% - 280px))',
		boxSizing:      'border-box',
	},
	// Match the shared design-system scrollbar (ui package tokens). CodeMirror owns
	// its scroll element, so the FloatingScrollbar component can't wrap it.
	'.cm-scroller::-webkit-scrollbar':       { width: '6px', height: '6px' },
	'.cm-scroller::-webkit-scrollbar-track': { background: 'transparent' },
	'.cm-scroller::-webkit-scrollbar-thumb': { background: 'var(--border-strong)', borderRadius: '9999px' },
	'.cm-content': {
		color:      'var(--text)',
		caretColor: 'var(--text)',
		padding:    '0',
		whiteSpace: 'pre-wrap',
		wordBreak:  'break-word',
	},
	'.cm-line':    { padding: '0' },
	'.cm-cursor':  { borderLeftColor: 'var(--text)', borderLeftWidth: '1.5px' },
	'.cm-selectionBackground, ::selection': { background: 'var(--color-accent-selection)' },
	'.cm-gutters':    { display: 'none' },
	'.cm-activeLine': { background: 'transparent' },
	'.cm-placeholder': { color: 'var(--text-faint)' },
	'.cm-annot': {
		borderBottom:    '2px solid color-mix(in srgb, var(--ctx-violet) 55%, transparent)',
		backgroundColor: 'var(--ctx-violet-soft)',
		borderRadius:    '2px',
		cursor:          'default',
	},
});
