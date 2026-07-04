export type ToolId = 'select' | 'draw' | 'erase' | 'link' | 'folder' | 'image' | 'document' | 'sketch';

export type Point = {
	x: number;
	y: number;
};

export type Rect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type Camera = {
	x: number;
	y: number;
	zoom: number;
};

export type PointerInfo = {
	id: number;
	screen: Point;
	world: Point;
	pressure: number;
	pointerType: string;
	shiftKey: boolean;
};

export type ContextMenuItem =
	| { kind: 'action'; label: string; icon?: string; shortcut?: string; action: () => void }
	| { kind: 'separator' };
