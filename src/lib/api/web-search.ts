import type { AppSettings } from '$lib/settings';

export interface SearchResult {
	url: string;
	title: string;
	snippet: string;
}

export async function webSearch(query: string, settings: AppSettings): Promise<SearchResult[]> {
	const { searchProvider, searchApiKey, searxngUrl } = settings;

	switch (searchProvider) {
		case 'jina': {
			const headers: Record<string, string> = { Accept: 'application/json' };
			if (searchApiKey) headers['Authorization'] = `Bearer ${searchApiKey}`;
			const res = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(query)}`, { headers });
			if (!res.ok) throw new Error(`Jina search error ${res.status}`);
			const data = await res.json() as { data?: { url: string; title: string; description?: string; content?: string }[] };
			return (data.data ?? []).slice(0, 6).map((r) => ({
				url: r.url,
				title: r.title,
				snippet: r.description ?? r.content?.slice(0, 200) ?? '',
			}));
		}

		case 'brave': {
			if (!searchApiKey) throw new Error('Brave Search requires an API key — add it in Settings.');
			const res = await fetch(
				`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`,
				{ headers: { Accept: 'application/json', 'X-Subscription-Token': searchApiKey } },
			);
			if (!res.ok) throw new Error(`Brave Search error ${res.status}`);
			const data = await res.json() as { web?: { results?: { url: string; title: string; description: string }[] } };
			return (data.web?.results ?? []).map((r) => ({
				url: r.url, title: r.title, snippet: r.description,
			}));
		}

		case 'tavily': {
			if (!searchApiKey) throw new Error('Tavily requires an API key — add it in Settings.');
			const res = await fetch('https://api.tavily.com/search', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ query, api_key: searchApiKey, max_results: 6 }),
			});
			if (!res.ok) throw new Error(`Tavily error ${res.status}`);
			const data = await res.json() as { results?: { url: string; title: string; content: string }[] };
			return (data.results ?? []).map((r) => ({
				url: r.url, title: r.title, snippet: r.content?.slice(0, 200) ?? '',
			}));
		}

		case 'searxng': {
			const base = searxngUrl.replace(/\/$/, '') || 'http://localhost:8080';
			const res = await fetch(
				`${base}/search?q=${encodeURIComponent(query)}&format=json&categories=general`,
			);
			if (!res.ok) throw new Error(`SearXNG error ${res.status}`);
			const data = await res.json() as { results?: { url: string; title: string; content: string }[] };
			return (data.results ?? []).slice(0, 6).map((r) => ({
				url: r.url, title: r.title, snippet: r.content?.slice(0, 200) ?? '',
			}));
		}

		default:
			return [];
	}
}
