import type { SketchAction, SketchElement } from '$lib/sketch-types';

const TOOLS = [
	{
		name: 'get_element_content',
		description: 'Get the full text content of a canvas element by ID.',
		input_schema: {
			type: 'object',
			properties: { id: { type: 'string' } },
			required: ['id'],
		},
	},
	{
		name: 'create_link',
		description: 'Create a directional relationship link between two canvas elements.',
		input_schema: {
			type: 'object',
			properties: {
				sourceId: { type: 'string', description: 'ID of the source element.' },
				targetId: { type: 'string', description: 'ID of the target element.' },
				label: { type: 'string', description: 'Optional short label for the link.' },
			},
			required: ['sourceId', 'targetId'],
		},
	},
	{
		name: 'move_element',
		description: 'Move a canvas element to a new world-space position.',
		input_schema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				x: { type: 'number', description: 'New world X coordinate.' },
				y: { type: 'number', description: 'New world Y coordinate.' },
			},
			required: ['id', 'x', 'y'],
		},
	},
	{
		name: 'group_elements',
		description: 'Group multiple canvas elements into a named folder.',
		input_schema: {
			type: 'object',
			properties: {
				ids: { type: 'array', items: { type: 'string' }, description: 'IDs of elements to group.' },
				title: { type: 'string', description: 'Name for the resulting folder.' },
			},
			required: ['ids', 'title'],
		},
	},
	{
		name: 'add_note',
		description: 'Add a new text note at a world-space position on the canvas.',
		input_schema: {
			type: 'object',
			properties: {
				x: { type: 'number' },
				y: { type: 'number' },
				body: { type: 'string', description: 'Text content for the note.' },
			},
			required: ['x', 'y', 'body'],
		},
	},
	{
		name: 'reply',
		description: 'Send a text message to the user explaining your interpretation or asking for clarification.',
		input_schema: {
			type: 'object',
			properties: { message: { type: 'string' } },
			required: ['message'],
		},
	},
];

const SYSTEM = `You are an AI assistant embedded in a visual canvas application. You analyze sketches the user draws on top of their canvas to understand their intent.

You receive:
1. A JPEG of the full canvas showing all elements
2. A PNG of the user's sketch overlay (what they drew on top)
3. A JSON list of all canvas elements with IDs, types, positions, and short labels

Common sketch patterns and their corresponding actions:
- Arrow drawn from one element to another → create_link(sourceId, targetId)
- Circle or lasso drawn around multiple elements → group_elements(ids, title)
- Arrow pointing from an element toward empty space → move_element(id, x, y)
- Text written or + symbol near empty space → add_note(x, y, body)
- Question mark or ambiguous sketch → reply with a clarification question

You may call get_element_content to read the full text of any element before deciding what to do.
Always call reply() last to summarise what you understood and what actions you took (or ask for clarification if the sketch is ambiguous).`;

function stripDataUrl(dataUrl: string): { data: string; mediaType: string } {
	const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
	if (!m) throw new Error('Invalid data URL');
	return { data: m[2], mediaType: m[1] };
}

type AnthropicContent = { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string };

export async function analyzeSketch(params: {
	apiKey: string;
	model: string;
	canvasImage: string;
	sketchImage: string;
	elements: SketchElement[];
}): Promise<{ reply: string; actions: SketchAction[] }> {
	const { apiKey, model, canvasImage, sketchImage, elements } = params;

	const elemMap = new Map(elements.map((e) => [e.id, e]));
	const canvas = stripDataUrl(canvasImage);
	const sketch = stripDataUrl(sketchImage);

	const elemSummary = elements.map((e) => ({
		id: e.id,
		type: e.type,
		label: e.label,
		bounds: e.bounds,
	}));

	const messages: unknown[] = [
		{
			role: 'user',
			content: [
				{
					type: 'text',
					text: `Here is the canvas and the user's sketch overlay. Analyse the sketch and take the appropriate actions.\n\nCanvas elements:\n${JSON.stringify(elemSummary, null, 2)}`,
				},
				{ type: 'image', source: { type: 'base64', media_type: canvas.mediaType, data: canvas.data } },
				{ type: 'image', source: { type: 'base64', media_type: sketch.mediaType, data: sketch.data } },
			],
		},
	];

	const actions: SketchAction[] = [];
	let reply = '';

	for (let iter = 0; iter < 10; iter++) {
		const res = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json',
			},
			body: JSON.stringify({ model, max_tokens: 4096, system: SYSTEM, tools: TOOLS, messages }),
		});

		if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);

		const msg = (await res.json()) as { stop_reason: string; content: AnthropicContent[] };
		messages.push({ role: 'assistant', content: msg.content });

		if (msg.stop_reason !== 'tool_use') {
			for (const block of msg.content) {
				if (block.type === 'text' && block.text) reply = reply || block.text;
			}
			break;
		}

		const toolResults: unknown[] = [];
		for (const block of msg.content) {
			if (block.type !== 'tool_use' || !block.id || !block.name || !block.input) continue;

			let result: string;

			if (block.name === 'get_element_content') {
				const elem = elemMap.get(block.input.id as string);
				result = elem ? elem.content : 'Element not found.';
			} else if (block.name === 'reply') {
				reply = (block.input.message as string) || '';
				result = 'ok';
			} else {
				actions.push({ type: block.name, ...block.input } as unknown as SketchAction);
				result = 'queued';
			}

			toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
		}

		messages.push({ role: 'user', content: toolResults });
	}

	return { reply, actions };
}
