import type { AiProvider } from '$lib/settings';

export interface ModelInfo {
	id: string;
	name: string;
	description?: string;
}

export async function fetchModels(
	provider: AiProvider,
	apiKey: string,
	customBaseUrl?: string
): Promise<ModelInfo[]> {
	switch (provider) {
		case 'anthropic': {
			const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
				headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
			const json = await res.json();
			return (json.data ?? []).map((m: { id: string; display_name?: string }) => ({
				id: m.id,
				name: m.display_name ?? m.id
			}));
		}
		case 'openai': {
			const res = await fetch('https://api.openai.com/v1/models', {
				headers: { Authorization: `Bearer ${apiKey}` }
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
			const json = await res.json();
			return ((json.data ?? []) as { id: string }[])
				.filter((m) => /^(gpt-|o[1-9])/.test(m.id) && !/instruct/.test(m.id))
				.sort((a, b) => b.id.localeCompare(a.id))
				.map((m) => ({ id: m.id, name: m.id }));
		}
		case 'google': {
			const res = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${apiKey}`
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
			const json = await res.json();
			return ((json.models ?? []) as {
				name: string;
				displayName?: string;
				description?: string;
				supportedGenerationMethods?: string[];
			}[])
				.filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
				.map((m) => ({
					id: m.name.replace('models/', ''),
					name: m.displayName ?? m.name.replace('models/', ''),
					description: m.description
				}));
		}
		case 'custom': {
			const base = (customBaseUrl ?? '').replace(/\/$/, '');
			if (!base) return [];
			const res = await fetch(`${base}/models`, {
				headers: { Authorization: `Bearer ${apiKey}` }
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
			const json = await res.json();
			return ((json.data ?? []) as { id: string }[]).map((m) => ({ id: m.id, name: m.id }));
		}
		default:
			return [];
	}
}
