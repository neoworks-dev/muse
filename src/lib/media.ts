import { sdk } from './sdk';
import type { MediaManifest } from '@neoworks-dev/sdk';

// Encrypted media resource: chunks + uploads via the SDK, with encrypt/decrypt
// delegated to the cross-origin Vault (the AMK never reaches muse).
export const vaultTransport = sdk.vault.setup();
export const media = sdk.media(vaultTransport);

/** Mounts + surfaces the Vault so the user can unlock encryption. */
export function ensureVault(): Promise<void> {
	return vaultTransport.ensureReady();
}

export type { MediaManifest };

/** Sentinel `src` value for an encrypted media object stored in the backend. */
export function mediaSentinel(id: string): string {
	return `media:${id}`;
}

export function isMediaSentinel(src: string): boolean {
	return src.startsWith('media:');
}

/** Uploads an image blob (encrypted) and returns its manifest. */
export async function uploadImage(blob: Blob, filename: string, mimeType: string): Promise<MediaManifest> {
	return media.upload(blob, filename, mimeType);
}

/** Resolves a stored manifest to a decrypted blob object URL for rendering. */
export function resolveMediaUrl(manifest: MediaManifest): Promise<string> {
	return media.getObjectUrl(manifest);
}
