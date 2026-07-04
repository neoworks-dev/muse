import { loadSettings, type AiProvider } from './settings';

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
	images?: string[]; // base64 data URLs — only sent for the triggering message
}

interface AiCliEvent {
	type: 'chunk' | 'error' | 'done';
	text?: string;
	message?: string;
}

interface AiCliBridge {
	start(request: {
		id: string;
		engine: AiProvider;
		messages: ChatMessage[];
		system?: string;
		model?: string;
	}): Promise<void>;
	cancel(streamId: string): void;
	onEvent(streamId: string, callback: (event: AiCliEvent) => void): () => void;
}

function aiCliBridge(): AiCliBridge {
	const bridge = (window as { aiCli?: AiCliBridge }).aiCli;
	if (!bridge) {
		throw new Error('AI is only available inside the Muse desktop app.');
	}
	return bridge;
}

export async function* streamCompletion(
	messages: ChatMessage[],
	system?: string,
	signal?: AbortSignal,
	modelOverride?: string
): AsyncGenerator<string, void, unknown> {
	const settings = loadSettings();
	const bridge = aiCliBridge();
	const id = crypto.randomUUID();
	const model = modelOverride || settings.model || undefined;

	const pending: string[] = [];
	let finished = false;
	let errorMessage: string | null = null;
	let wake: (() => void) | null = null;

	const unsubscribe = bridge.onEvent(id, (event) => {
		if (event.type === 'chunk' && event.text) pending.push(event.text);
		if (event.type === 'error') errorMessage = event.message ?? 'AI CLI error';
		if (event.type === 'error' || event.type === 'done') finished = true;
		wake?.();
	});

	const onAbort = () => {
		bridge.cancel(id);
		wake?.();
	};
	signal?.addEventListener('abort', onAbort);

	try {
		await bridge.start({ id, engine: settings.aiProvider, messages, system, model });
		while (true) {
			while (pending.length > 0) yield pending.shift()!;
			if (finished || signal?.aborted) break;
			await new Promise<void>((resolve) => {
				wake = resolve;
			});
			wake = null;
		}
		if (errorMessage && !signal?.aborted) throw new Error(errorMessage);
	} finally {
		signal?.removeEventListener('abort', onAbort);
		unsubscribe();
	}
}

/** Run a completion to the end and return the full text. */
export async function completeText(
	messages: ChatMessage[],
	system?: string,
	signal?: AbortSignal,
	modelOverride?: string
): Promise<string> {
	let text = '';
	for await (const chunk of streamCompletion(messages, system, signal, modelOverride)) {
		text += chunk;
	}
	return text;
}
