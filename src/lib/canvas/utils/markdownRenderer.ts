import { roundedRect } from './geometry';

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const MONO = "ui-monospace, 'Cascadia Code', 'Fira Code', monospace";

type InlineKind = 'normal' | 'bold' | 'italic' | 'boldItalic' | 'code';

interface Span {
	text: string;
	kind: InlineKind;
}

export type Block =
	| { t: 'h1' | 'h2' | 'h3'; text: string }
	| { t: 'p'; spans: Span[] }
	| { t: 'ul' | 'ol'; items: Span[][] }
	| { t: 'code'; code: string; lang: string }
	| { t: 'hr' }
	| { t: 'bq'; spans: Span[] };

function spanFont(kind: InlineKind, size: number): string {
	switch (kind) {
		case 'bold':
			return `700 ${size}px ${FONT}`;
		case 'italic':
			return `italic 400 ${size}px ${FONT}`;
		case 'boldItalic':
			return `italic 700 ${size}px ${FONT}`;
		case 'code':
			return `${size}px ${MONO}`;
		default:
			return `400 ${size}px ${FONT}`;
	}
}

function parseInline(text: string): Span[] {
	const spans: Span[] = [];
	const re = /(\*\*\*|___)(.*?)\1|(\*\*|__)(.*?)\3|(\*|_)(.*?)\5|`([^`]+)`/gs;
	let last = 0;

	for (const m of text.matchAll(re)) {
		if (m.index! > last) spans.push({ text: text.slice(last, m.index), kind: 'normal' });
		if (m[1]) spans.push({ text: m[2], kind: 'boldItalic' });
		else if (m[3]) spans.push({ text: m[4], kind: 'bold' });
		else if (m[5]) spans.push({ text: m[6], kind: 'italic' });
		else spans.push({ text: m[7], kind: 'code' });
		last = m.index! + m[0].length;
	}

	if (last < text.length) spans.push({ text: text.slice(last), kind: 'normal' });
	return spans.length ? spans : [{ text, kind: 'normal' }];
}

export function parseBlocks(markdown: string): Block[] {
	const lines = markdown.split('\n');
	const blocks: Block[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();

		if (line.startsWith('```')) {
			const lang = line.slice(3).trim();
			const code: string[] = [];
			i++;
			while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
			i++;
			blocks.push({ t: 'code', code: code.join('\n'), lang });
			continue;
		}

		if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed) && trimmed.length >= 3) {
			blocks.push({ t: 'hr' });
			i++;
			continue;
		}

		const hm = line.match(/^(#{1,3}) (.+)/);
		if (hm) {
			const lv = hm[1].length;
			blocks.push({ t: lv === 1 ? 'h1' : lv === 2 ? 'h2' : 'h3', text: hm[2] });
			i++;
			continue;
		}

		if (line.startsWith('> ')) {
			const bq = [line.slice(2)];
			i++;
			while (i < lines.length && lines[i].startsWith('> ')) bq.push(lines[i++].slice(2));
			blocks.push({ t: 'bq', spans: parseInline(bq.join(' ')) });
			continue;
		}

		if (/^[*+-] /.test(line)) {
			const items: Span[][] = [];
			while (i < lines.length && /^[*+-] /.test(lines[i]))
				items.push(parseInline(lines[i++].replace(/^[*+-] /, '')));
			blocks.push({ t: 'ul', items });
			continue;
		}

		if (/^\d+\. /.test(line)) {
			const items: Span[][] = [];
			while (i < lines.length && /^\d+\. /.test(lines[i]))
				items.push(parseInline(lines[i++].replace(/^\d+\. /, '')));
			blocks.push({ t: 'ol', items });
			continue;
		}

		if (trimmed === '') {
			i++;
			continue;
		}

		const pLines = [line];
		i++;
		while (i < lines.length) {
			const l = lines[i];
			if (
				!l.trim() ||
				/^#{1,3} /.test(l) ||
				/^[*+-] /.test(l) ||
				/^\d+\. /.test(l) ||
				l.startsWith('```') ||
				l.startsWith('> ') ||
				/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l.trim())
			)
				break;
			pLines.push(l);
			i++;
		}
		blocks.push({ t: 'p', spans: parseInline(pLines.join(' ')) });
	}

	return blocks;
}

interface Word {
	text: string;
	kind: InlineKind;
	space: boolean;
}

function spansToWords(spans: Span[]): Word[] {
	const words: Word[] = [];
	for (const span of spans) {
		const parts = span.text.split(/( +)/);
		for (const part of parts) {
			if (!part) continue;
			if (/^ +$/.test(part)) {
				if (words.length) words[words.length - 1].space = true;
			} else {
				words.push({ text: part, kind: span.kind, space: false });
			}
		}
	}
	return words;
}

function wrapSpans(
	ctx: CanvasRenderingContext2D,
	spans: Span[],
	maxWidth: number,
	fontSize: number
): Word[][] {
	const words = spansToWords(spans);
	if (!words.length) return [[]];

	ctx.font = spanFont('normal', fontSize);
	const spW = ctx.measureText(' ').width;
	const lines: Word[][] = [];
	let line: Word[] = [];
	let lineW = 0;

	for (const word of words) {
		ctx.font = spanFont(word.kind, fontSize);
		const wW = ctx.measureText(word.text).width;
		const gap = line.length ? spW : 0;

		if (line.length && lineW + gap + wW > maxWidth) {
			lines.push(line);
			line = [word];
			lineW = wW;
		} else {
			line.push(word);
			lineW += gap + wW;
		}
	}
	if (line.length) lines.push(line);
	return lines.length ? lines : [[]];
}

function drawWords(
	ctx: CanvasRenderingContext2D,
	words: Word[],
	x: number,
	y: number,
	fontSize: number,
	textColor: string
): void {
	ctx.font = spanFont('normal', fontSize);
	const spW = ctx.measureText(' ').width;
	let cx = x;

	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		ctx.font = spanFont(w.kind, fontSize);

		if (w.kind === 'code') {
			const tw = ctx.measureText(w.text).width;
			const pad = 3;
			ctx.fillStyle = 'rgba(0,0,0,0.07)';
			roundedRect(ctx, cx - pad, y - fontSize * 0.88, tw + pad * 2, fontSize * 1.35, 3);
			ctx.fill();
			ctx.fillStyle = 'rgba(170, 50, 50, 0.85)';
		} else {
			ctx.fillStyle = textColor;
		}

		ctx.fillText(w.text, cx, y);
		cx += ctx.measureText(w.text).width;
		if (w.space && i < words.length - 1) cx += spW;
	}
}

export interface RenderDocumentOptions {
	ctx: CanvasRenderingContext2D;
	blocks: Block[];
	x: number;
	y: number;
	contentWidth: number;
	pad: number;
}

export function renderBlocks(opts: RenderDocumentOptions): void {
	const { ctx, blocks, x, y, contentWidth, pad } = opts;
	const text = 'rgba(28, 25, 18, 0.88)';
	const dim = 'rgba(100, 95, 82, 0.72)';
	const cx = x + pad;
	let cy = y + pad;

	for (const block of blocks) {
		switch (block.t) {
			case 'h1': {
				const sz = 22;
				cy += 6;
				ctx.font = `700 ${sz}px ${FONT}`;
				ctx.fillStyle = 'rgba(18, 16, 10, 0.92)';
				ctx.fillText(block.text, cx, cy + sz);
				cy += sz + 20;
				break;
			}
			case 'h2': {
				const sz = 17;
				cy += 4;
				ctx.font = `700 ${sz}px ${FONT}`;
				ctx.fillStyle = 'rgba(20, 18, 12, 0.9)';
				ctx.fillText(block.text, cx, cy + sz);
				cy += sz + 16;
				break;
			}
			case 'h3': {
				const sz = 14;
				cy += 2;
				ctx.font = `600 ${sz}px ${FONT}`;
				ctx.fillStyle = text;
				ctx.fillText(block.text, cx, cy + sz);
				cy += sz + 14;
				break;
			}
			case 'p': {
				const sz = 13;
				const lh = 20;
				for (const line of wrapSpans(ctx, block.spans, contentWidth, sz)) {
					drawWords(ctx, line, cx, cy + sz, sz, text);
					cy += lh;
				}
				cy += 7;
				break;
			}
			case 'ul': {
				const sz = 13;
				const lh = 20;
				for (const item of block.items) {
					ctx.font = `400 ${sz}px ${FONT}`;
					ctx.fillStyle = dim;
					ctx.fillText('•', cx + 2, cy + sz);
					for (const line of wrapSpans(ctx, item, contentWidth - 18, sz)) {
						drawWords(ctx, line, cx + 18, cy + sz, sz, text);
						cy += lh;
					}
				}
				cy += 4;
				break;
			}
			case 'ol': {
				const sz = 13;
				const lh = 20;
				for (let n = 0; n < block.items.length; n++) {
					ctx.font = `400 ${sz}px ${FONT}`;
					ctx.fillStyle = dim;
					ctx.fillText(`${n + 1}.`, cx, cy + sz);
					for (const line of wrapSpans(ctx, block.items[n], contentWidth - 22, sz)) {
						drawWords(ctx, line, cx + 22, cy + sz, sz, text);
						cy += lh;
					}
				}
				cy += 4;
				break;
			}
			case 'code': {
				const sz = 11;
				const lh = 17;
				const codeLines = block.code.split('\n');
				const blockH = codeLines.length * lh + 18;
				ctx.fillStyle = 'rgba(0,0,0,0.04)';
				roundedRect(ctx, cx, cy, contentWidth, blockH, 5);
				ctx.fill();
				ctx.strokeStyle = 'rgba(0,0,0,0.09)';
				ctx.lineWidth = 0.5;
				roundedRect(ctx, cx, cy, contentWidth, blockH, 5);
				ctx.stroke();
				cy += 10;
				ctx.font = `${sz}px ${MONO}`;
				ctx.fillStyle = 'rgba(55, 38, 100, 0.88)';
				for (const cl of codeLines) {
					ctx.fillText(cl, cx + 10, cy + sz);
					cy += lh;
				}
				cy += 12;
				break;
			}
			case 'hr': {
				cy += 10;
				ctx.strokeStyle = 'rgba(0,0,0,0.1)';
				ctx.lineWidth = 0.5;
				ctx.beginPath();
				ctx.moveTo(cx, cy);
				ctx.lineTo(cx + contentWidth, cy);
				ctx.stroke();
				cy += 18;
				break;
			}
			case 'bq': {
				const sz = 13;
				const lh = 20;
				const wrapped = wrapSpans(ctx, block.spans, contentWidth - 20, sz);
				const bqH = wrapped.length * lh + 10;
				ctx.fillStyle = 'rgba(99, 102, 241, 0.06)';
				ctx.fillRect(cx, cy, contentWidth, bqH);
				ctx.fillStyle = 'rgba(99, 102, 241, 0.45)';
				ctx.fillRect(cx, cy, 3, bqH);
				cy += 6;
				for (const line of wrapped) {
					drawWords(ctx, line, cx + 14, cy + sz, sz, dim);
					cy += lh;
				}
				cy += 6;
				break;
			}
		}
	}
}
