import { completeText } from '$lib/ai';

type Bounds = { x: number; y: number; w: number; h: number };

const PROMPT_SYSTEM =
	'You are a DALL-E 3 prompt engineer. You will be shown a canvas screenshot and a rough sketch drawn on top. ' +
	'Write a concise image generation prompt (max 80 words) describing what the sketch represents, ' +
	'in a visual style consistent with the existing canvas elements. ' +
	'Output ONLY the prompt text — no preamble, no quotes, no explanation.';

function dalleSize(bounds: Bounds, model: string): string {
	if (!bounds.w || !bounds.h) return '1024x1024';
	const r = bounds.w / bounds.h;
	if (model === 'dall-e-2') return '1024x1024';
	if (r > 1.4) return '1792x1024';
	if (r < 0.7) return '1024x1792';
	return '1024x1024';
}

export async function generateFromSketch(params: {
	openaiKey: string;
	imageModel: string;
	canvasImage: string;
	sketchImage: string;
	sketchBounds: Bounds;
}): Promise<{ prompt: string; imageDataUrl: string }> {
	const { openaiKey, imageModel, canvasImage, sketchImage, sketchBounds } = params;
	const resolvedImageModel = imageModel || 'dall-e-3';

	const dallePrompt = (
		await completeText(
			[
				{
					role: 'user',
					content:
						'First image: the canvas. Second image: the sketch overlay. Write the DALL-E 3 prompt.',
					images: [canvasImage, sketchImage],
				},
			],
			PROMPT_SYSTEM
		)
	).trim();

	if (!dallePrompt) throw new Error('AI did not return a prompt');
	if (!openaiKey) throw new Error('OpenAI API key required for image generation — add it in Settings.');

	const imageRes = await fetch('https://api.openai.com/v1/images/generations', {
		method: 'POST',
		headers: { Authorization: `Bearer ${openaiKey}`, 'content-type': 'application/json' },
		body: JSON.stringify({
			model: resolvedImageModel,
			prompt: dallePrompt,
			size: dalleSize(sketchBounds, resolvedImageModel),
		}),
	});

	if (!imageRes.ok) {
		const errText = await imageRes.text();
		throw new Error(`Image generation failed (${imageRes.status}): ${errText}`);
	}

	const imageData = (await imageRes.json()) as {
		data: { url?: string; b64_json?: string; revised_prompt?: string }[];
	};
	const item = imageData.data[0];
	if (!item) throw new Error('No image returned');

	let b64: string;
	if (item.b64_json) {
		b64 = item.b64_json;
	} else if (item.url) {
		const cdnRes = await fetch(item.url);
		if (!cdnRes.ok) throw new Error('Failed to fetch generated image');
		const bytes = new Uint8Array(await cdnRes.arrayBuffer());
		b64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
	} else {
		throw new Error('No image data in response');
	}

	return {
		prompt: item.revised_prompt ?? dallePrompt,
		imageDataUrl: `data:image/png;base64,${b64}`,
	};
}
