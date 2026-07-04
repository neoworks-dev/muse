import { idbGet, idbPut } from './storage.svelte';

// Local media store: image blobs live in IndexedDB and are rendered via
// object URLs. A manifest identifies a stored blob.

export interface MediaManifest {
	id: string;
	filename: string;
	mimeType: string;
}

/** Sentinel `src` value for a media object stored in the local blob store. */
export function mediaSentinel(id: string): string {
	return `media:${id}`;
}

export function isMediaSentinel(src: string): boolean {
	return src.startsWith('media:');
}

function blobKey(id: string): string {
	return `media:${id}`;
}

/** Stores an image blob locally and returns its manifest. */
export async function uploadImage(blob: Blob, filename: string, mimeType: string): Promise<MediaManifest> {
	const id = crypto.randomUUID();
	await idbPut(blobKey(id), blob);
	return { id, filename, mimeType };
}

// Object URLs stay valid for the session; cache them per manifest id.
const objectUrls = new Map<string, string>();

/** Resolves a stored manifest to a blob object URL for rendering. */
export async function resolveMediaUrl(manifest: MediaManifest): Promise<string> {
	const cached = objectUrls.get(manifest.id);
	if (cached) return cached;

	const blob = await idbGet<Blob>(blobKey(manifest.id));
	if (!blob) throw new Error(`media blob not found: ${manifest.id}`);

	const url = URL.createObjectURL(blob);
	objectUrls.set(manifest.id, url);
	return url;
}
