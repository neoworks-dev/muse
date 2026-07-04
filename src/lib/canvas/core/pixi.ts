import type { Renderer } from 'pixi.js';

let _renderer: Renderer | null = null;

export function setRenderer(r: Renderer): void {
	_renderer = r;
}

export function getRenderer(): Renderer {
	if (!_renderer) throw new Error('Pixi renderer not initialised');
	return _renderer;
}
