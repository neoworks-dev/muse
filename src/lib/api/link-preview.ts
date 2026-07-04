export interface LinkPreviewResult {
	title: string;
	description: string;
	imageUrl: string;
	favicon: string;
	domain: string;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreviewResult> {
	const targetUrl = new URL(url);
	const domain = targetUrl.hostname;

	const resp = await fetch(url, {
		headers: {
			'User-Agent': 'Mozilla/5.0 (compatible; Muse/1.0; +link-preview)',
			Accept: 'text/html,application/xhtml+xml',
		},
		signal: AbortSignal.timeout(8000),
	});

	const html = await resp.text();
	const doc = new DOMParser().parseFromString(html, 'text/html');

	const getMeta = (prop: string) =>
		doc.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') ||
		doc.querySelector(`meta[name="${prop}"]`)?.getAttribute('content') ||
		'';

	const title = (
		getMeta('og:title') ||
		getMeta('twitter:title') ||
		doc.title ||
		domain
	).trim();

	const description = (
		getMeta('og:description') ||
		getMeta('twitter:description') ||
		getMeta('description') ||
		''
	).trim();

	const ogImageRaw = getMeta('og:image') || getMeta('twitter:image') || '';
	let imageUrl = '';
	if (ogImageRaw) {
		try {
			imageUrl = new URL(ogImageRaw, url).href;
		} catch {}
	}

	const faviconEl =
		doc.querySelector('link[rel~="icon"]') ||
		doc.querySelector('link[rel="shortcut icon"]');
	const faviconHref = faviconEl?.getAttribute('href');
	const faviconUrl = faviconHref
		? new URL(faviconHref, url).href
		: `${targetUrl.protocol}//${targetUrl.host}/favicon.ico`;

	let favicon = '';
	try {
		const fr = await fetch(faviconUrl, { signal: AbortSignal.timeout(3000) });
		if (fr.ok) {
			const buf = await fr.arrayBuffer();
			const ct = fr.headers.get('content-type') || 'image/x-icon';
			if (buf.byteLength < 100_000) {
				favicon = `data:${ct};base64,${toBase64(buf)}`;
			}
		}
	} catch {}

	return { title, description, imageUrl, favicon, domain };
}

function toBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
