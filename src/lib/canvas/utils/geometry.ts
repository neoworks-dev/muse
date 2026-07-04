/** Returns the point on the bounding-box edge of `obj` in the direction of `toward`. */
export function getEdgePoint(
	obj: { x: number; y: number; width: number; height: number },
	toward: { x: number; y: number }
): { x: number; y: number } {
	const cx = obj.x + obj.width / 2;
	const cy = obj.y + obj.height / 2;
	const dx = toward.x - cx;
	const dy = toward.y - cy;
	if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy };
	const tx = dx !== 0 ? (obj.width / 2) / Math.abs(dx) : Infinity;
	const ty = dy !== 0 ? (obj.height / 2) / Math.abs(dy) : Infinity;
	const t = Math.min(tx, ty);
	return { x: cx + t * dx, y: cy + t * dy };
}

export function roundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number
): void {
	const r = Math.min(radius, width / 2, height / 2);

	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + width - r, y);
	ctx.quadraticCurveTo(x + width, y, x + width, y + r);
	ctx.lineTo(x + width, y + height - r);
	ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
	ctx.lineTo(x + r, y + height);
	ctx.quadraticCurveTo(x, y + height, x, y + height - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}
