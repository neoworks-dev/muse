export type AiProvider = 'anthropic' | 'openai' | 'google' | 'custom';
export type SearchProvider = 'jina' | 'brave' | 'tavily' | 'searxng' | 'none';

export interface AppSettings {
	aiProvider: AiProvider;
	apiKey: string;
	model: string;
	customBaseUrl: string;
	/** OpenAI key used for DALL-E image generation when the main provider is not OpenAI. */
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

const DEFAULTS: AppSettings = {
	aiProvider: 'anthropic',
	apiKey: '',
	model: '',
	customBaseUrl: '',
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
		if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
	} catch {}
	return { ...DEFAULTS };
}

export function saveSettings(s: AppSettings): void {
	localStorage.setItem(KEY, JSON.stringify(s));
}
