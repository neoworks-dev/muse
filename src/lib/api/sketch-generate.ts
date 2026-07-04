type Bounds = { x: number; y: number; w: number; h: number };

const PROMPT_SYSTEM =
	'You are a DALL-E 3 prompt engineer. You will be shown a canvas screenshot and a rough sketch drawn on top. ' +
	'Write a concise image generation prompt (max 80 words) describing what the sketch represents, ' +
	'in a visual style consistent with the existing canvas elements. ' +
	'Output ONLY the prompt text — no preamble, no quotes, no explanation.';

function stripDataUrl(dataUrl: string): { data: string; mediaType: string } {
	const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
	if (!m) throw new Error('Invalid data URL');
	return { data: m[2], mediaType: m[1] };
}

function dalleSize(bounds: Bounds, model: string): string {
	if (!bounds.w || !bounds.h) return '1024x1024';
	const r = bounds.w / bounds.h;
	if (model === 'dall-e-2') return '1024x1024';
	if (r > 1.4) return '1792x1024';
	if (r < 0.7) return '1024x1792';
	return '1024x1024';
}

async function promptFromAnthropic(
	apiKey: string,
	model: string,
	canvasData: string,
	sketchData: string,
	canvasType: string,
	sketchType: string
): Promise<string> {
	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			model,
			max_tokens: 256,
			system: PROMPT_SYSTEM,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'image', source: { type: 'base64', media_type: canvasType, data: canvasData } },
						{ type: 'image', source: { type: 'base64', media_type: sketchType, data: sketchData } },
						{ type: 'text', text: 'Write the DALL-E 3 prompt.' },
					],
				},
			],
		}),
	});
	if (!res.ok) throw new Error(`Claude error ${res.status}: ${await res.text()}`);
	const msg = (await res.json()) as { content: { type: string; text?: string }[] };
	return msg.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
}

async function promptFromOpenAI(
	apiKey: string,
	model: string,
	canvasData: string,
	sketchData: string,
	canvasType: string,
	sketchType: string
): Promise<string> {
	const res = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
		body: JSON.stringify({
			model,
			max_tokens: 256,
			messages: [
				{ role: 'system', content: PROMPT_SYSTEM },
				{
					role: 'user',
					content: [
						{ type: 'image_url', image_url: { url: `data:${canvasType};base64,${canvasData}` } },
						{ type: 'image_url', image_url: { url: `data:${sketchType};base64,${sketchData}` } },
						{ type: 'text', text: 'Write the DALL-E 3 prompt.' },
					],
				},
			],
		}),
	});
	if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
	const msg = (await res.json()) as { choices: { message: { content: string } }[] };
	return msg.choices[0]?.message?.content?.trim() ?? '';
}

export async function generateFromSketch(params: {
	provider: string;
	apiKey: string;
	openaiKey: string;
	model: string;
	imageModel: string;
	canvasImage: string;
	sketchImage: string;
	sketchBounds: Bounds;
}): Promise<{ prompt: string; imageDataUrl: string }> {
	const { provider, apiKey, openaiKey, model, imageModel, canvasImage, sketchImage, sketchBounds } = params;
	const resolvedImageModel = imageModel || 'dall-e-3';

	const canvas = stripDataUrl(canvasImage);
	const sketch = stripDataUrl(sketchImage);

	let dallePrompt: string;
	if (provider === 'anthropic') {
		dallePrompt = await promptFromAnthropic(apiKey, model, canvas.data, sketch.data, canvas.mediaType, sketch.mediaType);
	} else if (provider === 'openai' || provider === 'custom') {
		dallePrompt = await promptFromOpenAI(apiKey, model, canvas.data, sketch.data, canvas.mediaType, sketch.mediaType);
	} else {
		dallePrompt = 'A clean digital illustration materialising the rough hand-drawn sketch';
	}

	if (!dallePrompt) throw new Error('AI did not return a prompt');

	const imageKey = provider === 'openai' ? apiKey : openaiKey;
	if (!imageKey) throw new Error('OpenAI API key required for image generation — add it in Settings.');

	const imageRes = await fetch('https://api.openai.com/v1/images/generations', {
		method: 'POST',
		headers: { Authorization: `Bearer ${imageKey}`, 'content-type': 'application/json' },
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
