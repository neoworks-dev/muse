let _counter = $state(100);
let _topId    = $state<string | null>(null);

export function claimTop(id: string): number {
	_counter++;
	_topId = id;
	return _counter;
}

export function releaseTop(id: string): void {
	if (_topId === id) _topId = null;
}

export function isTopWindow(id: string): boolean {
	return _topId === id;
}
