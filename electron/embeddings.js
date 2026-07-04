import { app, ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ONNX embedding backend (Nomic text + vision, same 768-dim space) via
// @huggingface/transformers running on onnxruntime-node. Models download to
// userData/models on first use, then load offline.
//
// Renderer protocol:
//   invoke 'embeddings:text'  (texts: string[], kind: 'document'|'query') → number[][]
//   invoke 'embeddings:image' (dataUrls: string[]) → number[][]

const TEXT_MODEL = 'nomic-ai/nomic-embed-text-v1.5';
const VISION_MODEL = 'nomic-ai/nomic-embed-vision-v1.5';

const TEXT_PREFIX = {
	document: 'search_document: ',
	query: 'search_query: '
};

let transformersPromise = null;
let textPipelinePromise = null;
let visionPipelinePromise = null;

async function loadTransformers() {
	if (!transformersPromise) {
		transformersPromise = import('@huggingface/transformers').then((mod) => {
			// Cache models under userData; transformers.js checks the cache first
			// and only fetches files that are missing, so a not-yet-downloaded
			// model (e.g. a TTS language) can still download while others stay local.
			mod.env.cacheDir = path.join(app.getPath('userData'), 'models');
			return mod;
		});
	}
	return transformersPromise;
}

async function textPipeline() {
	if (!textPipelinePromise) {
		textPipelinePromise = loadTransformers().then((mod) =>
			mod.pipeline('feature-extraction', TEXT_MODEL, { dtype: 'q8', device: 'cpu' })
		);
	}
	return textPipelinePromise;
}

async function visionPipeline() {
	if (!visionPipelinePromise) {
		visionPipelinePromise = loadTransformers().then((mod) =>
			mod.pipeline('image-feature-extraction', VISION_MODEL, { dtype: 'q8', device: 'cpu' })
		);
	}
	return visionPipelinePromise;
}

async function embedText(texts, kind) {
	const prefix = TEXT_PREFIX[kind] ?? TEXT_PREFIX.document;
	const extractor = await textPipeline();
	const output = await extractor(
		texts.map((text) => prefix + text),
		{ pooling: 'mean', normalize: true }
	);
	return output.tolist();
}

function dataUrlToTempFile(dataUrl, index) {
	const [header, data] = dataUrl.split(',');
	const ext = header.match(/:image\/(\w+)[;,]/)?.[1] ?? 'png';
	const file = path.join(
		os.tmpdir(),
		`muse-embed-${process.pid}-${index}-${Math.random().toString(36).slice(2)}.${ext}`
	);
	fs.writeFileSync(file, Buffer.from(data, 'base64'));
	return file;
}

function l2Normalize(vector) {
	let norm = 0;
	for (const value of vector) norm += value * value;
	norm = Math.sqrt(norm) || 1;
	return vector.map((value) => value / norm);
}

// transformers.js runs NomicVisionModel via its EncoderOnly fallback, which
// returns the raw last_hidden_state [1, tokens, 768]. Nomic's reference usage
// takes the CLS token (index 0), L2-normalized. Handle a pooled [1, 768]
// shape too in case a future version registers the architecture.
function toImageVector(output) {
	const [first] = output.tolist();
	const vector = Array.isArray(first[0]) ? first[0] : first;
	return l2Normalize(vector);
}

async function embedImages(dataUrls) {
	const extractor = await visionPipeline();
	const files = dataUrls.map(dataUrlToTempFile);
	try {
		const vectors = [];
		for (const file of files) {
			const output = await extractor(file);
			vectors.push(toImageVector(output));
		}
		return vectors;
	} finally {
		for (const file of files) fs.rm(file, { force: true }, () => {});
	}
}

export function registerEmbeddingsBridge() {
	ipcMain.handle('embeddings:text', (_event, texts, kind) => embedText(texts, kind));
	ipcMain.handle('embeddings:image', (_event, dataUrls) => embedImages(dataUrls));
}
