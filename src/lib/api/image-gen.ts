export async function generateImage(params: {
	prompt: string;
	openaiApiKey: string;
	model?: string;
}): Promise<string> {
	const { prompt, openaiApiKey, model = 'dall-e-3' } = params;

	const res = await fetch('https://api.openai.com/v1/images/generations', {
		method: 'POST',
		headers: { Authorization: `Bearer ${openaiApiKey}`, 'content-type': 'application/json' },
		body: JSON.stringify({ model, prompt, size: '1024x1024', n: 1 })
	});

	if (!res.ok) throw new Error(`Image generation failed (${res.status}): ${await res.text()}`);

	const data = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
	const item = data.data[0];
	if (!item) throw new Error('No image returned');

	if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;

	if (item.url) {
		const r = await fetch(item.url);
		if (!r.ok) throw new Error('Failed to fetch generated image');
		const bytes = new Uint8Array(await r.arrayBuffer());
		const b64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
		return `data:image/png;base64,${b64}`;
	}

	throw new Error('No image data in response');
}
