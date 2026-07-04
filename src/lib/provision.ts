import { sdk, clientId } from './sdk';
import { MUSE_SCHEMA_SOURCE, MUSE_DB_NAME, SCHEMA_VERSION } from './schema';

const PROVISIONED_KEY = 'muse:provisioned';
const DB_PASSWORD_KEY = 'muse:db-password';
const SCHEMA_VERSION_KEY = 'muse:schema-version';

let inflight: Promise<void> | null = null;

/**
 * Ensures the muse client database exists. Idempotent and cached: creates it on
 * first authenticated run, stores the one-time db_password (not needed for the
 * JWT-scoped data plane, kept for break-glass/direct access), and marks done.
 */
export function ensureMuseDatabase(): Promise<void> {
	if (inflight) return inflight;
	inflight = run();
	return inflight;
}

async function run(): Promise<void> {
	const ls = typeof localStorage !== 'undefined' ? localStorage : null;

	// Fast path: provisioned and schema up to date.
	if (ls?.getItem(PROVISIONED_KEY) && ls.getItem(SCHEMA_VERSION_KEY) === String(SCHEMA_VERSION)) {
		return;
	}

	const existing = await sdk.databases.list(clientId);
	const alreadyExists = existing.some((db) => db.name === MUSE_DB_NAME);

	if (!alreadyExists) {
		const result = await sdk.databases.create(clientId, MUSE_DB_NAME, MUSE_SCHEMA_SOURCE);
		ls?.setItem(DB_PASSWORD_KEY, result.db_password);
	} else {
		// DB exists but schema changed — re-apply (idempotent: OVERWRITE DDL).
		await sdk.databases.updateSchema(clientId, MUSE_DB_NAME, MUSE_SCHEMA_SOURCE);
	}

	ls?.setItem(PROVISIONED_KEY, '1');
	ls?.setItem(SCHEMA_VERSION_KEY, String(SCHEMA_VERSION));
}
