/** Shared types for the AI sketch annotation feature. */

export interface SketchElement {
	id: string;
	type: string;
	/** Short human-readable label for AI context. */
	label: string;
	/** Full text content (truncated to ~500 chars). */
	content: string;
	/** World-space bounding box. */
	bounds: { x: number; y: number; w: number; h: number };
}

export type SketchAction =
	| { type: 'create_link';      sourceId: string; targetId: string; label?: string }
	| { type: 'move_element';     id: string; x: number; y: number }
	| { type: 'group_elements';   ids: string[]; title: string }
	| { type: 'add_note';         x: number; y: number; body: string }
	| { type: 'generate_image';   prompt: string; x?: number; y?: number }
	| { type: 'open_document';    id: string }
	| { type: 'create_document';  title?: string; content?: string; x?: number; y?: number }
	| { type: 'place_image';      url: string; x?: number; y?: number }
	| { type: 'reply';            message: string };
