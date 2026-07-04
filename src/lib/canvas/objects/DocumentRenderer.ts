import { Container, Graphics, Sprite, Texture, ImageSource, Ticker } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';
import { marked, type Token } from 'marked';
import { BaseObjectRenderer } from '../core/BaseObjectRenderer';
import type { ObjectData, DocumentData } from '../../state.svelte';
import { canvasPalette, themeMode, css, type CanvasPalette } from '../theme-colors';

export const DOC_WIDTH = 360;
export const DOC_PAD = 24;
const A4_RATIO = 297 / 210;
export const DOC_HEIGHT = Math.round(DOC_WIDTH * A4_RATIO);

const RADIUS = 16;

type InlineSpan = { text: string; bold: boolean; italic: boolean; code: boolean };

function inlineSpans(tokens: Token[]): InlineSpan[] {
	const out: InlineSpan[] = [];
	for (const t of tokens) {
		if (t.type === 'strong' && 'tokens' in t)
			for (const s of inlineSpans(t.tokens as Token[])) out.push({ ...s, bold: true });
		else if (t.type === 'em' && 'tokens' in t)
			for (const s of inlineSpans(t.tokens as Token[])) out.push({ ...s, italic: true });
		else if (t.type === 'codespan')
			out.push({ text: (t as { text: string }).text, bold: false, italic: false, code: true });
		else if ('text' in t)
			out.push({ text: (t as { text: string }).text, bold: false, italic: false, code: false });
	}
	return out;
}

function buildPreviewTexture(markdown: string, pal: CanvasPalette): Texture | null {
	const scale = (window.devicePixelRatio || 1) * 2;
	const canvas = document.createElement('canvas');
	canvas.width = DOC_WIDTH * scale;
	canvas.height = DOC_HEIGHT * scale;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;

	const C = {
		text: css(pal.pageText),
		code: css(pal.pageCode),
		muted: css(pal.pageMuted),
		rule: css(pal.pageRule),
		codeBlockBg: css(pal.pageCodeBlockBg),
		quoteBar: css(pal.pageQuoteBar),
	};

	ctx.scale(scale, scale);
	ctx.fillStyle = css(pal.page);
	ctx.fillRect(0, 0, DOC_WIDTH, DOC_HEIGHT);

	const pad = DOC_PAD;
	const maxW = DOC_WIDTH - pad * 2;
	let y = pad;

	const fontStr = (size: number, bold: boolean, italic: boolean, code: boolean) =>
		code
			? `${size}px ui-monospace, monospace`
			: `${italic ? 'italic ' : ''}${bold ? '700' : '400'} ${size}px system-ui, sans-serif`;

	// Word-wrap inline spans that may have mixed bold/italic
	const fillSpans = (spans: InlineSpan[], size: number, lineH: number, indent = 0): void => {
		type Word = InlineSpan & { w: number };
		const words: Word[] = [];
		for (const span of spans) {
			ctx.font = fontStr(size, span.bold, span.italic, span.code);
			for (const word of span.text.replace(/\s+/g, ' ').trim().split(' ')) {
				if (word) words.push({ ...span, text: word, w: ctx.measureText(word + ' ').width });
			}
		}
		let lineWords: Word[] = [];
		let lineW = 0;
		const flush = () => {
			if (!lineWords.length) return;
			let x = pad + indent;
			for (const w of lineWords) {
				ctx.font = fontStr(size, w.bold, w.italic, w.code);
				ctx.fillStyle = w.code ? C.code : C.text;
				ctx.fillText(w.text, x, y + size);
				x += w.w;
			}
			y += lineH;
			lineWords = []; lineW = 0;
		};
		for (const word of words) {
			if (lineW + word.w > maxW - indent && lineWords.length) {
				if (y + size > DOC_HEIGHT - pad) return;
				flush();
			}
			lineWords.push(word); lineW += word.w;
		}
		flush();
	};

	// Plain text wrap (for headings — always bold, no inline tokens needed)
	const fillPlain = (text: string, size: number, lineH: number, bold = false, indent = 0): void => {
		ctx.font = fontStr(size, bold, false, false);
		ctx.fillStyle = C.text;
		fillSpans([{ text, bold, italic: false, code: false }], size, lineH, indent);
	};

	for (const token of marked.lexer(markdown || '')) {
		if (y + 14 > DOC_HEIGHT - pad) break;

		switch (token.type) {
			case 'heading': {
				const sizes = [17, 14, 12, 11, 11, 11];
				const lineHs = [23, 20, 18, 16, 16, 16];
				const after  = [ 6,  5,  4,  3,  3,  3];
				const d = Math.min((token as { depth: number }).depth - 1, 5);
				if (d > 0) y += 4;
				fillPlain((token as { text: string }).text, sizes[d], lineHs[d], true);
				y += after[d];
				break;
			}
			case 'paragraph': {
				const spans = 'tokens' in token ? inlineSpans(token.tokens as Token[]) : [{ text: (token as unknown as {text:string}).text, bold: false, italic: false, code: false }];
				fillSpans(spans, 11, 16);
				y += 6;
				break;
			}
			case 'code': {
				const lines = (token as { text: string }).text.split('\n');
				const blockH = Math.min(lines.length * 14 + 12, DOC_HEIGHT - pad - y);
				ctx.fillStyle = C.codeBlockBg;
				ctx.fillRect(pad, y, maxW, blockH);
				ctx.save();
				ctx.beginPath();
				ctx.rect(pad, y, maxW, blockH);
				ctx.clip();
				ctx.font = '9px ui-monospace, monospace';
				ctx.fillStyle = C.code;
				let cy = y + 10;
				for (const ln of lines) {
					if (cy > y + blockH - 4) break;
					ctx.fillText(ln, pad + 8, cy);
					cy += 14;
				}
				ctx.restore();
				y += blockH + 8;
				break;
			}
			case 'blockquote': {
				ctx.fillStyle = C.quoteBar;
				ctx.fillRect(pad, y, 2, 14);
				const spans = 'tokens' in token && Array.isArray((token as {tokens?: Token[]}).tokens)
					? inlineSpans((token as {tokens: Token[]}).tokens)
					: [{ text: (token as {text:string}).text, bold: false, italic: false, code: false }];
				ctx.fillStyle = C.muted;
				fillSpans(spans.map(s => ({ ...s })), 10, 15, 10);
				y += 4;
				break;
			}
			case 'list': {
				const lt = token as { ordered: boolean; start: number | ''; items: { text: string; tokens?: Token[] }[] };
				for (let i = 0; i < lt.items.length; i++) {
					if (y + 14 > DOC_HEIGHT - pad) break;
					const bullet = lt.ordered ? `${(lt.start || 1) + i}.` : '•';
					ctx.font = fontStr(11, false, false, false);
					ctx.fillStyle = C.muted;
					ctx.fillText(bullet, pad, y + 11);
					const spans = lt.items[i].tokens
						? inlineSpans(lt.items[i].tokens as Token[])
						: [{ text: lt.items[i].text, bold: false, italic: false, code: false }];
					fillSpans(spans, 11, 16, 14);
				}
				y += 4;
				break;
			}
			case 'hr': {
				ctx.strokeStyle = C.rule;
				ctx.lineWidth = 1;
				ctx.beginPath(); ctx.moveTo(pad, y + 7); ctx.lineTo(pad + maxW, y + 7); ctx.stroke();
				y += 14;
				break;
			}
			case 'space': {
				y += 6;
				break;
			}
		}
	}

	return new Texture({ source: new ImageSource({ resource: canvas }) });
}

export class DocumentRenderer extends BaseObjectRenderer {
	readonly container: Container;

	private _gfx: Graphics;
	private _sprite: Sprite;
	private _shadow: DropShadowFilter;
	private _lastRenderedContent = '';
	private _lastContent = '';
	private _lastSelected = false;
	private _lastTheme = '';
	private _pal: CanvasPalette = canvasPalette();
	private _queueTimer: ReturnType<typeof setTimeout> | null = null;
	private _hoverT = 0;
	private _hoverTarget = 0;
	private _hoverAnimating = false;

	constructor(data: DocumentData) {
		super();
		this.container = new Container();
		this.container.eventMode = 'static';
		this.container.cursor = 'pointer';

		this._shadow = new DropShadowFilter({
			offset: { x: 0, y: 4 },
			blur: 8,
			alpha: 0.10,
			color: 0x1e2328
		});

		this._gfx = new Graphics();
		this._gfx.filters = [this._shadow];
		this._drawCard(false);
		this.container.addChild(this._gfx);

		this._sprite = new Sprite();
		this._sprite.width = DOC_WIDTH;
		this._sprite.height = DOC_HEIGHT;
		this._sprite.visible = false;
		this.container.addChild(this._sprite);

		this._buildMask();

		this.container.pivot.set(DOC_WIDTH / 2, DOC_HEIGHT / 2);
		this.container.position.set(data.x + DOC_WIDTH / 2, data.y + DOC_HEIGHT / 2);

		this.container.on('pointerenter', () => {
			this._hoverTarget = 1;
			this._startHoverTick();
		});
		this.container.on('pointerleave', () => {
			this._hoverTarget = 0;
			this._startHoverTick();
		});

		this._doRender(data.content);
	}

	private _startHoverTick(): void {
		if (this._hoverAnimating) return;
		this._hoverAnimating = true;
		const tick = () => {
			const diff = this._hoverTarget - this._hoverT;
			if (Math.abs(diff) < 0.002) {
				this._hoverT = this._hoverTarget;
				Ticker.shared.remove(tick);
				this._hoverAnimating = false;
			} else {
				this._hoverT += diff * 0.14;
			}
			if (!this._lastSelected) {
				this._shadow.blur = 8 + 4 * this._hoverT;
				this._shadow.offset = { x: 0, y: 4 + 3 * this._hoverT };
				this._shadow.alpha = 0.10 + 0.03 * this._hoverT;
			}
		};
		Ticker.shared.add(tick);
	}

	private _drawCard(selected: boolean): void {
		const g = this._gfx;
		g.clear();
		g.roundRect(0, 0, DOC_WIDTH, DOC_HEIGHT, RADIUS);
		g.fill({ color: this._pal.page });

		if (selected) {
			g.roundRect(-1, -1, DOC_WIDTH + 2, DOC_HEIGHT + 2, RADIUS + 1);
			g.setStrokeStyle({ width: 2, color: themeMode() === 'dark' ? 0x6f7a86 : 0xffffff, alpha: 0.85 });
			g.stroke();
		}
	}

	private _buildMask(): void {
		const mask = new Graphics();
		mask.roundRect(0, 0, DOC_WIDTH, DOC_HEIGHT, RADIUS);
		mask.fill({ color: 0xffffff });
		this.container.addChild(mask);
		this._sprite.mask = mask;
	}

	private _doRender(text: string): void {
		if (text === this._lastRenderedContent) return;
		this._lastRenderedContent = text;
		try {
			const tex = buildPreviewTexture(text, this._pal);
			if (!tex || !this.container || this.container.destroyed) {
				tex?.destroy();
				return;
			}
			const old = this._sprite.texture;
			this._sprite.texture = tex;
			this._sprite.visible = true;
			this._sprite.width = DOC_WIDTH;
			this._sprite.height = DOC_HEIGHT;
			if (old && old !== Texture.EMPTY) old.destroy(true);
		} catch (e) {
			console.error(`Failed to render document preview: ${e}`);
		}
	}

	queuePreview(text: string, delayMs = 500): void {
		if (this._queueTimer) {
			clearTimeout(this._queueTimer);
			this._queueTimer = null;
		}
		this._queueTimer = setTimeout(() => {
			this._queueTimer = null;
			this._doRender(text);
		}, delayMs);
	}

	sync(data: ObjectData, selection: string[]): void {
		if (data.type !== 'document') return;
		const doc = data as DocumentData;
		const selected = selection.includes(doc.id);

		const mode = themeMode();
		if (mode !== this._lastTheme) {
			this._pal = canvasPalette();
			this._shadow.color = 0x1e2328;
			this._lastRenderedContent = ''; // force the preview to rebuild with the new palette
			this._doRender(doc.content);
			this._drawCard(selected);
			this._lastTheme = mode;
		}

		if (doc.content !== this._lastContent) {
			this._doRender(doc.content);
			this._lastContent = doc.content;
		}

		if (selected !== this._lastSelected) {
			this._drawCard(selected);
			if (selected) {
				this._shadow.color = 0x232d32;
				this._shadow.alpha = 0.06;
				this._shadow.offset = { x: 0, y: 2 };
				this._shadow.blur = 7;
			} else {
				this._shadow.color = 0x1e2328;
				this._shadow.alpha = 0.10;
				this._shadow.offset = { x: 0, y: 4 };
				this._shadow.blur = 8;
			}
			this._lastSelected = selected;
		}

		const targetX = doc.x + DOC_WIDTH / 2;
		const targetY = doc.y + DOC_HEIGHT / 2;
		if (Math.abs(this.container.x - targetX) > 0.5 || Math.abs(this.container.y - targetY) > 0.5) {
			this.container.x = targetX;
			this.container.y = targetY;
		}
	}

	override exit(onDone?: () => void): void {
		if (this._queueTimer) {
			clearTimeout(this._queueTimer);
			this._queueTimer = null;
		}
		super.exit(onDone);
	}
}
