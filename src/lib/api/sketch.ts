import type { SketchAction, SketchElement } from '$lib/sketch-types';
import { completeText } from '$lib/ai';

const SYSTEM = `You are an AI assistant embedded in a visual canvas application. You analyze sketches the user draws on top of their canvas to understand their intent.

You receive:
1. A JPEG of the full canvas showing all elements
2. A PNG of the user's sketch overlay (what they drew on top)
3. A JSON list of all canvas elements with IDs, types, positions, labels, and content excerpts

Common sketch patterns and their corresponding actions:
- Arrow drawn from one element to another → {"type":"create_link","sourceId":"…","targetId":"…","label":"optional"}
- Circle or lasso drawn around multiple elements → {"type":"group_elements","ids":["…"],"title":"…"}
- Arrow pointing from an element toward empty space → {"type":"move_element","id":"…","x":0,"y":0}
- Text written or + symbol near empty space → {"type":"add_note","x":0,"y":0,"body":"…"}
- Question mark or ambiguous sketch → no actions, ask for clarification in the reply

Respond with ONLY a JSON object, no code fences, no prose outside it:
{"reply":"short summary of what you understood and did (or a clarification question)","actions":[…]}`;

function parseJsonResponse(raw: string): { reply: string; actions: SketchAction[] } {
	let text = raw.trim();
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenced) text = fenced[1].trim();
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1) return { reply: raw.trim(), actions: [] };

	try {
		const parsed = JSON.parse(text.slice(start, end + 1));
		return {
			reply: typeof parsed.reply === 'string' ? parsed.reply : '',
			actions: Array.isArray(parsed.actions) ? parsed.actions : [],
		};
	} catch {
		return { reply: raw.trim(), actions: [] };
	}
}

export async function analyzeSketch(params: {
	canvasImage: string;
	sketchImage: string;
	elements: SketchElement[];
}): Promise<{ reply: string; actions: SketchAction[] }> {
	const { canvasImage, sketchImage, elements } = params;

	const elemSummary = elements.map((e) => ({
		id: e.id,
		type: e.type,
		label: e.label,
		content: e.content,
		bounds: e.bounds,
	}));

	const raw = await completeText(
		[
			{
				role: 'user',
				content: `Here is the canvas and the user's sketch overlay (first image: canvas, second image: sketch). Analyse the sketch and return the JSON response.\n\nCanvas elements:\n${JSON.stringify(elemSummary, null, 2)}`,
				images: [canvasImage, sketchImage],
			},
		],
		SYSTEM
	);

	return parseJsonResponse(raw);
}
