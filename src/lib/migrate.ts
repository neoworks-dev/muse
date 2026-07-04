import { idbGet, migrateOldObjects } from './storage.svelte';
import { pushObjects } from './sync.svelte';

const MIGRATED_KEY = 'muse:migrated';
const OLD_ROOT_KEY = 'root';

interface OldRoot {
	objects?: Record<string, unknown>[];
}

/**
 * One-time migration of the old local-only IndexedDB canvas blob into the
 * backend. Runs before hydrate(); guarded by a localStorage flag. The old blob
 * is left in place as a backup. Only marks complete on success so a failed run
 * retries next load (pushObjects tolerates already-existing ids).
 */
export async function migrateLocalData(): Promise<void> {
	if (typeof localStorage === 'undefined') return;
	if (localStorage.getItem(MIGRATED_KEY)) return;

	try {
		const raw = await idbGet<OldRoot>(OLD_ROOT_KEY);
		if (raw && Array.isArray(raw.objects) && raw.objects.length > 0) {
			const objects = migrateOldObjects(raw.objects);
			const created = await pushObjects(objects);
			console.info(`[migrate] pushed ${created}/${objects.length} objects to backend`);
		}
		localStorage.setItem(MIGRATED_KEY, '1');
	} catch (e) {
		console.error('[migrate] failed, will retry next load', e);
	}
}
