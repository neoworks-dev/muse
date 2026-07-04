import type { AiProvider } from '$lib/settings';

export interface ModelInfo {
	id: string;
	name: string;
	description?: string;
}

interface AiCliModelBridge {
	listModels(engine: AiProvider): Promise<ModelInfo[]>;
}

// Model lists come from the local CLIs via the Electron main process:
// claude-code → alias list (the CLI has no list command), codex →
// `codex debug models`, opencode → `opencode models`.
export async function fetchModels(provider: AiProvider): Promise<ModelInfo[]> {
	const bridge = (window as { aiCli?: AiCliModelBridge }).aiCli;
	if (!bridge) {
		throw new Error('Model lists are only available inside the Muse desktop app.');
	}
	return bridge.listModels(provider);
}
