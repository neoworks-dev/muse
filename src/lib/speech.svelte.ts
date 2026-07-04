import { detectAll } from 'tinyld';
import { loadSettings } from './settings';

// Renderer side of local voice: mic capture + resampling for Whisper, and
// playback of MMS TTS output. Heavy lifting (ONNX) happens in the Electron
// main process; see electron/speech.js.

interface SpeechBridge {
	transcribe(pcmBuffer: ArrayBuffer, language?: string): Promise<string>;
	speak(text: string, language?: string): Promise<{ audio: ArrayBuffer; sampleRate: number }>;
}

const WHISPER_SAMPLE_RATE = 16000;

// tinyld ISO 639-1 → MMS ISO 639-3 (must match TTS_MODELS in electron/speech.js).
const TTS_LANGUAGES: Record<string, string> = {
	en: 'eng', de: 'deu', fr: 'fra', es: 'spa', it: 'ita', pt: 'por',
	nl: 'nld', ru: 'rus', pl: 'pol', tr: 'tur', ko: 'kor', vi: 'vie',
};

function bridge(): SpeechBridge | null {
	return (window as { speech?: SpeechBridge }).speech ?? null;
}

export function speechAvailable(): boolean {
	return bridge() !== null;
}

export const speechState = $state({
	recording: false,
	transcribing: false,
	speakingMsgId: null as string | null,
	synthesizing: false,
});

// ── Recording (speech → text) ─────────────────────────────────────────

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];

export async function startRecording(): Promise<void> {
	if (speechState.recording) return;
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	recordedChunks = [];
	mediaRecorder = new MediaRecorder(stream);
	mediaRecorder.ondataavailable = (e) => {
		if (e.data.size > 0) recordedChunks.push(e.data);
	};
	mediaRecorder.start();
	speechState.recording = true;
}

async function blobToWhisperPcm(blob: Blob): Promise<ArrayBuffer> {
	const encoded = await blob.arrayBuffer();
	const probe = new AudioContext();
	const decoded = await probe.decodeAudioData(encoded);
	await probe.close();

	const frameCount = Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE);
	const offline = new OfflineAudioContext(1, frameCount, WHISPER_SAMPLE_RATE);
	const source = offline.createBufferSource();
	source.buffer = decoded;
	source.connect(offline.destination);
	source.start();
	const resampled = await offline.startRendering();
	// Slice to a standalone ArrayBuffer for structured clone.
	return resampled.getChannelData(0).slice().buffer;
}

/** Stop recording and return the Whisper transcription. */
export async function stopRecording(): Promise<string> {
	const recorder = mediaRecorder;
	if (!recorder || !speechState.recording) return '';
	speechState.recording = false;

	const stopped = new Promise<void>((resolve) => {
		recorder.onstop = () => resolve();
	});
	recorder.stop();
	await stopped;
	for (const track of recorder.stream.getTracks()) track.stop();
	mediaRecorder = null;

	const speechBridge = bridge();
	if (!speechBridge || recordedChunks.length === 0) return '';

	speechState.transcribing = true;
	try {
		const pcm = await blobToWhisperPcm(new Blob(recordedChunks, { type: recorder.mimeType }));
		// Whisper needs an explicit language or it translates to English;
		// the system locale is the best guess for dictation.
		const language = navigator.language?.split('-')[0] || undefined;
		return await speechBridge.transcribe(pcm, language);
	} finally {
		speechState.transcribing = false;
	}
}

export function cancelRecording(): void {
	if (!mediaRecorder) return;
	for (const track of mediaRecorder.stream.getTracks()) track.stop();
	mediaRecorder.stop();
	mediaRecorder = null;
	recordedChunks = [];
	speechState.recording = false;
}

// ── Playback (text → speech) ──────────────────────────────────────────

let playbackContext: AudioContext | null = null;
let playbackSource: AudioBufferSourceNode | null = null;

export function stopSpeaking(): void {
	playbackSource?.stop();
	playbackSource = null;
	speechState.speakingMsgId = null;
}

// tinyld is unreliable on short text (it returns an arbitrary language or
// nothing), which sends English to a foreign MMS model and garbles every word.
// English scores low even when correct, while other languages score high when
// present — so default to English and only switch away on a strong, confident
// non-English signal. A pinned voiceLanguage skips detection entirely.
const MIN_DETECT_CHARS = 24;
const MIN_DETECT_ACCURACY = 0.6;

function detectTtsLanguage(text: string): string {
	const pinned = loadSettings().voiceLanguage;
	if (pinned !== 'auto') return pinned;
	if (text.length < MIN_DETECT_CHARS) return 'eng';

	const [best] = detectAll(text.slice(0, 500));
	if (!best || best.lang === 'en') return 'eng';
	if (best.accuracy < MIN_DETECT_ACCURACY) return 'eng';
	return TTS_LANGUAGES[best.lang] ?? 'eng';
}

function stripForSpeech(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, ' Code block omitted. ')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/[#*_>|-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Speak a message aloud; stops any current playback first. */
export async function speakText(msgId: string, markdown: string): Promise<void> {
	const speechBridge = bridge();
	if (!speechBridge) return;

	if (speechState.speakingMsgId === msgId) {
		stopSpeaking();
		return;
	}
	stopSpeaking();

	const text = stripForSpeech(markdown).slice(0, 3000);
	if (!text) return;

	speechState.synthesizing = true;
	speechState.speakingMsgId = msgId;
	try {
		const { audio, sampleRate } = await speechBridge.speak(text, detectTtsLanguage(text));
		// Bail if the user toggled playback off while synthesizing.
		if (speechState.speakingMsgId !== msgId) return;

		if (!playbackContext) playbackContext = new AudioContext();
		const samples = new Float32Array(audio);
		const buffer = playbackContext.createBuffer(1, samples.length, sampleRate);
		buffer.copyToChannel(samples, 0);

		const source = playbackContext.createBufferSource();
		source.buffer = buffer;
		source.connect(playbackContext.destination);
		source.onended = () => {
			if (speechState.speakingMsgId === msgId) speechState.speakingMsgId = null;
		};
		playbackSource = source;
		source.start();
	} catch {
		speechState.speakingMsgId = null;
	} finally {
		speechState.synthesizing = false;
	}
}
