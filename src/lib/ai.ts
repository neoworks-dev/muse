import { loadSettings, type AiProvider } from './settings';

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
	images?: string[]; // base64 data URLs — only sent for the triggering message
}

const DEFAULT_MODELS: Record<AiProvider, string> = {
	anthropic: 'claude-sonnet-4-6',
	openai: 'gpt-4o',
	google: 'gemini-2.0-flash',
	custom: '',
};

function anthropicContent(msg: ChatMessage): unknown {
	if (!msg.images?.length) return msg.content;
	const parts: unknown[] = msg.images.map((img) => {
		const [header, data] = img.split(',');
		const mediaType = (header.match(/:(.*?);/)?.[1] ?? 'image/jpeg') as string;
		return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
	});
	if (msg.content) parts.push({ type: 'text', text: msg.content });
	return parts;
}

function openaiContent(msg: ChatMessage): unknown {
	if (!msg.images?.length) return msg.content;
	const parts: unknown[] = msg.images.map((img) => ({
		type: 'image_url',
		image_url: { url: img },
	}));
	if (msg.content) parts.push({ type: 'text', text: msg.content });
	return parts;
}

function googleParts(msg: ChatMessage): unknown[] {
	const parts: unknown[] = [];
	for (const img of msg.images ?? []) {
		const [header, data] = img.split(',');
		const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
		parts.push({ inline_data: { mime_type: mimeType, data } });
	}
	if (msg.content) parts.push({ text: msg.content });
	return parts;
}

export async function* streamCompletion(
	messages: ChatMessage[],
	system?: string,
	signal?: AbortSignal,
	modelOverride?: string
): AsyncGenerator<string, void, unknown> {
	const s = loadSettings();
	if (!s.apiKey) throw new Error('No API key configured — open Settings (top right) to add one.');

	const { aiProvider: provider, apiKey, customBaseUrl } = s;
	const model = modelOverride || s.model || DEFAULT_MODELS[provider];

	let upstream: Response;

	switch (provider) {
		case 'anthropic': {
			const body: Record<string, unknown> = {
				model,
				max_tokens: 8192,
				messages: messages.map((m) => ({ role: m.role, content: anthropicContent(m) })),
				stream: true,
			};
			if (system) body.system = system;
			upstream = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
					'content-type': 'application/json',
				},
				body: JSON.stringify(body),
				signal,
			});
			break;
		}
		case 'openai':
		case 'custom': {
			const base = provider === 'custom' ? (customBaseUrl ?? '') : 'https://api.openai.com/v1';
			const msgs = [
				...(system ? [{ role: 'system', content: system }] : []),
				...messages.map((m) => ({ role: m.role, content: openaiContent(m) })),
			];
			upstream = await fetch(`${base}/chat/completions`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
				body: JSON.stringify({ model, messages: msgs, stream: true }),
				signal,
			});
			break;
		}
		case 'google': {
			const contents = messages.map((m: ChatMessage) => ({
				role: m.role === 'assistant' ? 'model' : 'user',
				parts: googleParts(m),
			}));
			const body: Record<string, unknown> = { contents };
			if (system) body.system_instruction = { parts: [{ text: system }] };
			upstream = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
				{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }
			);
			break;
		}
		default:
			throw new Error(`Unknown provider: ${provider}`);
	}

	if (!upstream.ok) throw new Error(`AI error ${upstream.status}: ${await upstream.text()}`);

	const reader = upstream.body!.getReader();
	const dec = new TextDecoder();
	let buf = '';

	while (true) {
		if (signal?.aborted) break;
		const { done, value } = await reader.read();
		if (done) break;
		buf += dec.decode(value, { stream: true });
		const lines = buf.split('\n');
		buf = lines.pop() ?? '';

		for (const line of lines) {
			if (!line.startsWith('data:')) continue;
			const data = line.slice(5).trim();
			if (data === '[DONE]') return;

			try {
				const ev = JSON.parse(data);
				let text: string | null = null;

				if (provider === 'anthropic') {
					if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta')
						text = ev.delta.text;
				} else if (provider === 'openai' || provider === 'custom') {
					text = ev.choices?.[0]?.delta?.content ?? null;
				} else if (provider === 'google') {
					text = ev.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
				}

				if (text) yield text;
			} catch {}
		}
	}
}
