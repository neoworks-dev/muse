import { app, BrowserWindow, shell, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { registerAiCliBridge } from './ai-cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(__dirname, '../build');

const DEV = process.env.NODE_ENV === 'development';

// Prefer native Wayland (Hyprland) over XWayland for crisp scaling + presentation.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

// Do NOT add `disable-frame-rate-limit` or `disable-gpu-vsync`: they uncap the
// render loop to thousands of fps, flooding the GPU queue so Pixi's scene stalls
// to ~2fps (GPU-bound, low CPU). Chromium's default vsync already paces rAF to
// the monitor's refresh rate (144Hz here), which is what we want.

protocol.registerSchemesAsPrivileged([
	{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

function createWindow() {
	const win = new BrowserWindow({
		width: 1400,
		height: 900,
		frame: false,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			webviewTag: true,
			webSecurity: false,
			preload: path.join(__dirname, 'preload.cjs')
		}
	});

	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('http://') || url.startsWith('https://')) {
			shell.openExternal(url);
		}
		return { action: 'deny' };
	});

	if (DEV) {
		const devUrl = process.env.MUSE_DEV_SERVER ?? 'http://localhost:5173';
		loadWithRetry(win, devUrl);
		win.webContents.openDevTools();
	} else {
		win.loadURL('app://muse/');
	}
}

function loadWithRetry(win, url, attempt = 0) {
	win.loadURL(url).catch(() => {
		if (attempt < 30) setTimeout(() => loadWithRetry(win, url, attempt + 1), 500);
	});
}

app.whenReady().then(() => {
	registerAiCliBridge();

	protocol.handle('app', (request) => {
		const { pathname } = new URL(request.url);
		const filePath = path.join(BUILD_DIR, pathname);
		const resolved =
			fs.existsSync(filePath) && fs.statSync(filePath).isFile()
				? filePath
				: path.join(BUILD_DIR, 'index.html');
		return net.fetch(pathToFileURL(resolved).href);
	});

	createWindow();
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
