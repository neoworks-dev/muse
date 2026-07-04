// The muse client database schema, authored in the OpenSchema DSL (./muse.schema)
// and submitted as source — the neoworks API compiles it server-side. Every table
// is kind "data" (default), so the server injects + enforces a hidden
// subject_user_id, scoping all rows to the signed-in user. The Surreal record id is
// muse's own object/thread/message id (supplied at create time).
import MUSE_SCHEMA_SOURCE from './muse.schema?raw';

export { MUSE_SCHEMA_SOURCE };

/** Logical name of the muse database (the `name` passed to databases.create). */
export const MUSE_DB_NAME = 'muse';

/** Bump when muse.schema changes so provision re-applies it (updateSchema). */
export const SCHEMA_VERSION = 4;
