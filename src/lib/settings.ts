export type AiProvider = 'claude-code' | 'codex' | 'opencode';
export type SearchProvider = 'jina' | 'brave' | 'tavily' | 'searxng' | 'none';

export interface AppSettings {
	aiProvider: AiProvider;
	model: string;
	/** OpenAI key used for DALL-E image generation. */
	openaiApiKey: string;
	/** DALL-E model used for sketch-to-image generation. */
	imageModel: string;
	vimMode: boolean;
	searchProvider: SearchProvider;
	/** API key for Brave or Tavily search. */
	searchApiKey: string;
	/** Base URL for a self-hosted SearXNG instance. */
	searxngUrl: string;
}

const KEY = 'muse:settings';

const PROVIDERS: AiProvider[] = ['claude-code', 'codex', 'opencode'];

const DEFAULTS: AppSettings = {
	aiProvider: 'claude-code',
	model: '',
	openaiApiKey: '',
	imageModel: 'gpt-image-1',
	vimMode: false,
	searchProvider: 'jina',
	searchApiKey: '',
	searxngUrl: '',
};

export function loadSettings(): AppSettings {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			const settings = { ...DEFAULTS, ...JSON.parse(raw) };
			// Settings saved before the CLI-provider migration may hold an old
			// HTTP provider id (anthropic/openai/...) or an API-model id.
			if (!PROVIDERS.includes(settings.aiProvider)) {
				settings.aiProvider = DEFAULTS.aiProvider;
				settings.model = '';
			}
			return settings;
		}
	} catch {}
	return { ...DEFAULTS };
}

export function saveSettings(s: AppSettings): void {
	localStorage.setItem(KEY, JSON.stringify(s));
}
