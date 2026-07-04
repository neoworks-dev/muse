let nextId = 1;

export function createId(prefix = 'id'): string {
	if (globalThis.crypto?.randomUUID) {
		return globalThis.crypto.randomUUID();
	}

	return `${prefix}-${Date.now()}-${nextId++}`;
}
