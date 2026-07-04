import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

// Local speech models via @huggingface/transformers (ONNX), fully offline
// after the first download:
//   - Whisper (multilingual, auto language detection) for speech-to-text
//   - MMS VITS per-language models for text-to-speech
//
// Renderer protocol:
//   invoke 'speech:transcribe' (pcm: ArrayBuffer of Float32 mono 16kHz) → string
//   invoke 'speech:speak' (text: string, language?: string)
//     → { audio: ArrayBuffer of Float32, sampleRate: number }

const WHISPER_MODEL = 'onnx-community/whisper-small';

// MMS text-to-speech models by ISO 639-3 code.
const TTS_MODELS = {
	eng: 'Xenova/mms-tts-eng',
	deu: 'Xenova/mms-tts-deu',
	fra: 'Xenova/mms-tts-fra',
	spa: 'Xenova/mms-tts-spa',
	ita: 'Xenova/mms-tts-ita',
	por: 'Xenova/mms-tts-por',
	nld: 'Xenova/mms-tts-nld',
	rus: 'Xenova/mms-tts-rus',
	pol: 'Xenova/mms-tts-pol',
	tur: 'Xenova/mms-tts-tur',
	kor: 'Xenova/mms-tts-kor',
	vie: 'Xenova/mms-tts-vie'
};

let transformersPromise = null;
let whisperPromise = null;
const ttsPromises = new Map();

async function loadTransformers() {
	if (!transformersPromise) {
		transformersPromise = import('@huggingface/transformers').then((mod) => {
			const modelCache = path.join(app.getPath('userData'), 'models');
			mod.env.cacheDir = modelCache;
			if (fs.existsSync(modelCache) && fs.readdirSync(modelCache).length > 0) {
				mod.env.allowRemoteModels = false;
			}
			return mod;
		});
	}
	return transformersPromise;
}

async function whisperPipeline() {
	if (!whisperPromise) {
		whisperPromise = loadTransformers().then((mod) =>
			mod.pipeline('automatic-speech-recognition', WHISPER_MODEL, { dtype: 'q8', device: 'cpu' })
		);
	}
	return whisperPromise;
}

async function ttsPipeline(language) {
	const modelId = TTS_MODELS[language] ?? TTS_MODELS.eng;
	if (!ttsPromises.has(modelId)) {
		ttsPromises.set(
			modelId,
			loadTransformers().then((mod) => mod.pipeline('text-to-speech', modelId, { device: 'cpu' }))
		);
	}
	return ttsPromises.get(modelId);
}

async function transcribe(pcmBuffer, language) {
	const transcriber = await whisperPipeline();
	const audio = new Float32Array(pcmBuffer);
	// Whisper "auto-detect" in transformers.js falls back to English and then
	// TRANSLATES foreign speech — always pin the language and force transcribe.
	const options = { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' };
	if (language) options.language = language;
	const output = await transcriber(audio, options);
	const text = Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text;
	return (text ?? '').trim();
}

async function speak(text, language) {
	const synthesizer = await ttsPipeline(language);
	const output = await synthesizer(text);
	// Copy into a plain ArrayBuffer so it survives structured clone.
	const audio = new Float32Array(output.audio);
	return { audio: audio.buffer, sampleRate: output.sampling_rate };
}

export function registerSpeechBridge() {
	ipcMain.handle('speech:transcribe', (_event, pcmBuffer, language) =>
		transcribe(pcmBuffer, language)
	);
	ipcMain.handle('speech:speak', (_event, text, language) => speak(text, language));
}
