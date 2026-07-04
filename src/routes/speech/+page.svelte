<script lang="ts">
	import { onMount } from 'svelte';
	import { pipeline, env } from '@huggingface/transformers';

	// Isolated speech engine. Runs in a hidden BrowserWindow (see electron/speech.js)
	// so a WebGPU/ONNX crash lands in a throwaway renderer instead of the main
	// process. WebGPU gives GPU acceleration; wasm is the CPU fallback.

	const WHISPER_MODEL = 'onnx-community/whisper-small';

	const TTS_MODELS: Record<string, string> = {
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
		vie: 'Xenova/mms-tts-vie',
	};

	// device 'webgpu' needs unquantized weights; wasm stays quantized for speed.
	const DEVICE_ATTEMPTS = [
		{ device: 'webgpu', dtype: 'fp32' },
		{ device: 'wasm', dtype: 'q8' },
	] as const;

	interface SpeechHost {
		onJob(cb: (job: SpeechJob) => void): void;
		sendResult(result: JobResult): void;
		ready(): void;
		log(message: string): void;
	}

	type SpeechJob =
		| { id: number; kind: 'transcribe'; pcm: ArrayBuffer; language?: string }
		| { id: number; kind: 'speak'; text: string; language?: string };

	type JobResult =
		| { id: number; ok: true; result: unknown }
		| { id: number; ok: false; error: string };

	let whisperPromise: Promise<unknown> | null = null;
	const ttsPromises = new Map<string, Promise<unknown>>();

	// Serialize inference: ONNX sessions are not safe to call concurrently.
	let jobQueue: Promise<void> = Promise.resolve();

	function host(): SpeechHost | null {
		return (window as unknown as { speechHost?: SpeechHost }).speechHost ?? null;
	}

	function report(message: string): void {
		host()?.log(message);
	}

	// Build a pipeline, trying WebGPU first and falling back to wasm. TTS ignores
	// the quantized dtype (MMS ships fp32 only), so callers pass allowQuantized.
	async function buildPipeline(task: string, modelId: string, allowQuantized: boolean) {
		let lastError: unknown = null;
		for (const attempt of DEVICE_ATTEMPTS) {
			const dtype = allowQuantized ? attempt.dtype : 'fp32';
			try {
				const pipe = await pipeline(task as never, modelId, {
					device: attempt.device,
					dtype: dtype as never,
				});
				report(`${modelId} on ${attempt.device}`);
				return pipe;
			} catch (error) {
				lastError = error;
				const message = error instanceof Error ? error.message : String(error);
				report(`${modelId} failed on ${attempt.device}: ${message}`);
			}
		}
		throw lastError ?? new Error(`Could not load ${modelId}`);
	}

	function whisperPipeline() {
		if (!whisperPromise) {
			whisperPromise = buildPipeline('automatic-speech-recognition', WHISPER_MODEL, true);
		}
		return whisperPromise;
	}

	function ttsPipeline(language?: string) {
		const modelId = TTS_MODELS[language ?? 'eng'] ?? TTS_MODELS.eng;
		if (!ttsPromises.has(modelId)) {
			ttsPromises.set(modelId, buildPipeline('text-to-speech', modelId, false));
		}
		return ttsPromises.get(modelId)!;
	}

	async function transcribe(pcmBuffer: ArrayBuffer, language?: string): Promise<string> {
		const transcriber = (await whisperPipeline()) as (audio: Float32Array, options: object) => Promise<unknown>;
		const audio = new Float32Array(pcmBuffer);
		// Whisper "auto-detect" in transformers.js falls back to English and then
		// TRANSLATES foreign speech — always pin the language and force transcribe.
		const options: Record<string, unknown> = { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' };
		if (language) options.language = language;
		const output = (await transcriber(audio, options)) as { text?: string } | { text: string }[];
		const text = Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text;
		return (text ?? '').trim();
	}

	async function speak(text: string, language?: string): Promise<{ audio: ArrayBuffer; sampleRate: number }> {
		const synthesizer = (await ttsPipeline(language)) as (text: string) => Promise<{ audio: Float32Array; sampling_rate: number }>;
		const output = await synthesizer(text);
		const audio = new Float32Array(output.audio);
		return { audio: audio.buffer, sampleRate: output.sampling_rate };
	}

	async function runJob(job: SpeechJob): Promise<unknown> {
		if (job.kind === 'transcribe') return transcribe(job.pcm, job.language);
		if (job.kind === 'speak') return speak(job.text, job.language);
		throw new Error('Unknown job kind');
	}

	function handleJob(activeHost: SpeechHost, job: SpeechJob): void {
		// Chain onto the queue so inferences never overlap.
		jobQueue = jobQueue.then(async () => {
			try {
				const result = await runJob(job);
				activeHost.sendResult({ id: job.id, ok: true, result });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				activeHost.sendResult({ id: job.id, ok: false, error: message });
			}
		});
	}

	onMount(() => {
		const activeHost = host();
		if (!activeHost) return;
		env.allowRemoteModels = true;
		activeHost.onJob((job) => handleJob(activeHost, job));
		activeHost.ready();
	});
</script>

<!-- Never shown; the window stays hidden. -->
<div style="display:none" aria-hidden="true">speech worker</div>
