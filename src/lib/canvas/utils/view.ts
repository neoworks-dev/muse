import type { Camera, Point } from '../core/types';

export function screenToWorld(x: number, y: number, camera: Camera): Point {
	return {
		x: (x - camera.x) / camera.zoom,
		y: (y - camera.y) / camera.zoom
	};
}

export function worldToScreen(x: number, y: number, camera: Camera): Point {
	return {
		x: x * camera.zoom + camera.x,
		y: y * camera.zoom + camera.y
	};
}

export function zoomAt(screenX: number, screenY: number, nextZoom: number, camera: Camera): void {
	const before = screenToWorld(screenX, screenY, camera);

	camera.zoom = Math.min(4, Math.max(0.25, nextZoom));
	camera.x = screenX - before.x * camera.zoom;
	camera.y = screenY - before.y * camera.zoom;
}
