import { theme } from '../theme.svelte';

// Theme-aware palette for canvas (Pixi / canvas-2d) objects. Pixi wants numeric
// colors; the document preview is canvas-2d and wants CSS strings — `css()`
// converts a stored number to "#rrggbb".
export interface CanvasPalette {
	// Folder
	folderFront: number;
	folderBack: number;
	folderTitle: number;
	folderPill: number;
	folderCount: number;
	thumbBorder: number;
	chipBg: number;
	chipOverflowBg: number;
	chipText: number;
	chipOverflowText: number;
	noteThumb: number;
	folderThumb: number;
	mediaThumb: number;

	// Note card
	noteCard: number;
	noteText: number;

	// Document / page
	page: number;
	pageText: number;
	pageCode: number;
	pageMuted: number;
	pageRule: number;
	pageCodeBlockBg: number;
	pageQuoteBar: number;

	// Shared
	shadow: number;
	accent: number;
}

const LIGHT: CanvasPalette = {
	folderFront: 0xe3e6ea,
	folderBack: 0xeef1f3,
	folderTitle: 0x232b33,
	folderPill: 0x7c8794,
	folderCount: 0x8a949f,
	thumbBorder: 0xd2d8dd,
	chipBg: 0xffffff,
	chipOverflowBg: 0xeef1f3,
	chipText: 0x3a434c,
	chipOverflowText: 0x8a949f,
	noteThumb: 0xfef9c3,
	folderThumb: 0xdfe7ef,
	mediaThumb: 0x20242a,

	noteCard: 0xfdfcf5,
	noteText: 0x322d23,

	page: 0xffffff,
	pageText: 0x1a1a1a,
	pageCode: 0x555555,
	pageMuted: 0x888888,
	pageRule: 0xe8e8e8,
	pageCodeBlockBg: 0xf5f5f5,
	pageQuoteBar: 0xd0d0d0,

	shadow: 0x1e2328,
	accent: 0xf59e0b
};

const DARK: CanvasPalette = {
	folderFront: 0x24282e,
	folderBack: 0x2e333a,
	folderTitle: 0xe8eaed,
	folderPill: 0x8b96a3,
	folderCount: 0x79828d,
	thumbBorder: 0x3a4048,
	chipBg: 0x2a2f36,
	chipOverflowBg: 0x20242a,
	chipText: 0xd6dadf,
	chipOverflowText: 0x8b96a3,
	noteThumb: 0x4a4528,
	folderThumb: 0x2c333c,
	mediaThumb: 0x14171b,

	noteCard: 0x26282c,
	noteText: 0xdadce0,

	page: 0x1b1e24,
	pageText: 0xe6e8eb,
	pageCode: 0xb9bfc7,
	pageMuted: 0x7d8893,
	pageRule: 0x2c313a,
	pageCodeBlockBg: 0x23272f,
	pageQuoteBar: 0x3a4049,

	shadow: 0x05070a,
	accent: 0xfbbf24
};

export function canvasPalette(): CanvasPalette {
	return theme.mode === 'dark' ? DARK : LIGHT;
}

export function themeMode(): 'dark' | 'light' {
	return theme.mode;
}

export function css(color: number): string {
	return '#' + color.toString(16).padStart(6, '0');
}
