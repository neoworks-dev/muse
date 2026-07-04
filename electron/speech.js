import { app, ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// Proxy to the isolated speech engine, which runs in a hidden BrowserWindow
// (src/routes/speech). A Chromium renderer is used instead of a Node child so
// the models can run on the GPU via WebGPU (falling back to wasm). A crash there
// only kills the hidden window; we respawn it and reject in-flight jobs.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.join(__dirname, 'speech-preload.cjs');
const DEV = process.env.NODE_ENV === 'development';

let workerWindow = null;
let workerReady = false;
let readyWaiters = [];
let nextJobId = 1;
const pendingJobs = new Map();

function workerUrl() {
	if (DEV) {
		const base = process.env.MUSE_DEV_SERVER ?? 'http://localhost:5173';
		return `${base}/speech`;
	}
	return 'app://muse/speech';
}

function whenReady() {
	if (workerReady) return Promise.resolve();
	return new Promise((resolve, reject) => readyWaiters.push({ resolve, reject }));
}

function resolveReadyWaiters() {
	workerReady = true;
	for (const { resolve } of readyWaiters) resolve();
	readyWaiters = [];
}

function rejectPending(reason) {
	const error = new Error(reason);
	for (const { reject } of pendingJobs.values()) reject(error);
	pendingJobs.clear();
	for (const { reject } of readyWaiters) reject(error);
	readyWaiters = [];
}

function handleWorkerLost(reason) {
	console.error('[speech]', reason);
	workerReady = false;
	workerWindow = null;
	rejectPending('Speech engine crashed');
}

function loadWorker(win, attempt = 0) {
	win.loadURL(workerUrl()).catch(() => {
		if (attempt < 30) setTimeout(() => loadWorker(win, attempt + 1), 500);
	});
}

function createWorkerWindow() {
	const win = new BrowserWindow({
		show: false,
		webPreferences: {
			preload: PRELOAD_PATH,
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
			// Keep the GPU/wasm work running full speed even though the window is hidden.
			backgroundThrottling: false
		}
	});

	win.webContents.on('render-process-gone', (_event, details) => {
		if (workerWindow !== win) return;
		handleWorkerLost(`worker gone: ${details?.reason ?? 'unknown'}`);
		if (!win.isDestroyed()) win.destroy();
	});
	win.on('closed', () => {
		if (workerWindow === win) handleWorkerLost('worker window closed');
	});

	loadWorker(win);
	return win;
}

function ensureWorker() {
	if (!workerWindow) {
		workerReady = false;
		workerWindow = createWorkerWindow();
	}
	return workerWindow;
}

async function runJob(job) {
	ensureWorker();
	await whenReady();
	const id = nextJobId++;
	return new Promise((resolve, reject) => {
		pendingJobs.set(id, { resolve, reject });
		workerWindow.webContents.send('speech:job', { ...job, id });
	});
}

function transcribe(pcmBuffer, language) {
	return runJob({ kind: 'transcribe', pcm: pcmBuffer, language });
}

function speak(text, language) {
	return runJob({ kind: 'speak', text, language });
}

function handleResult(message) {
	const pending = pendingJobs.get(message.id);
	if (!pending) return;
	pendingJobs.delete(message.id);
	if (message.ok) {
		pending.resolve(message.result);
	} else {
		pending.reject(new Error(message.error));
	}
}

// Called on main-window close so the hidden worker never keeps the app alive.
export function shutdownSpeechBridge() {
	rejectPending('Speech engine shut down');
	if (workerWindow) {
		const win = workerWindow;
		workerWindow = null;
		if (!win.isDestroyed()) win.destroy();
	}
}

export function registerSpeechBridge() {
	ipcMain.on('speech:ready', () => resolveReadyWaiters());
	ipcMain.on('speech:result', (_event, message) => handleResult(message));
	ipcMain.on('speech:log', (_event, message) => console.log('[speech]', message));

	ipcMain.handle('speech:transcribe', (_event, pcmBuffer, language) =>
		transcribe(pcmBuffer, language)
	);
	ipcMain.handle('speech:speak', (_event, text, language) => speak(text, language));
}
