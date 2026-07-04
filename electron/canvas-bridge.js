import { ipcMain } from 'electron';
import crypto from 'crypto';
import http from 'http';

// Localhost HTTP bridge that lets out-of-process helpers (the MCP server the
// claude CLI spawns) query canvas state living in the renderer. Flow:
//   MCP server → POST /rpc (token-authed) → main → IPC → renderer handler →
//   IPC response → HTTP response.

let bridgeInfo = null; // { port, token }
let getWindow = null;
const pendingRequests = new Map();

const REQUEST_TIMEOUT_MS = 15000;

function callRenderer(method, params) {
	return new Promise((resolve, reject) => {
		const win = getWindow?.();
		if (!win || win.isDestroyed()) {
			reject(new Error('No renderer window available'));
			return;
		}
		const requestId = crypto.randomUUID();
		const timer = setTimeout(() => {
			pendingRequests.delete(requestId);
			reject(new Error('Renderer request timed out'));
		}, REQUEST_TIMEOUT_MS);
		pendingRequests.set(requestId, { resolve, reject, timer });
		win.webContents.send('canvas-bridge:request', { requestId, method, params });
	});
}

function readBody(request) {
	return new Promise((resolve, reject) => {
		let body = '';
		request.on('data', (chunk) => (body += chunk));
		request.on('end', () => resolve(body));
		request.on('error', reject);
	});
}

async function handleHttpRequest(request, response) {
	const send = (status, payload) => {
		response.writeHead(status, { 'content-type': 'application/json' });
		response.end(JSON.stringify(payload));
	};

	if (request.method !== 'POST' || request.url !== '/rpc') {
		send(404, { error: 'Not found' });
		return;
	}
	if (request.headers.authorization !== `Bearer ${bridgeInfo.token}`) {
		send(401, { error: 'Unauthorized' });
		return;
	}

	try {
		const { method, params } = JSON.parse(await readBody(request));
		const result = await callRenderer(method, params);
		send(200, { result });
	} catch (e) {
		send(500, { error: e instanceof Error ? e.message : String(e) });
	}
}

export function registerCanvasBridge(windowGetter) {
	getWindow = windowGetter;

	ipcMain.on('canvas-bridge:response', (_event, { requestId, result, error }) => {
		const pending = pendingRequests.get(requestId);
		if (!pending) return;
		pendingRequests.delete(requestId);
		clearTimeout(pending.timer);
		if (error) pending.reject(new Error(error));
		else pending.resolve(result);
	});

	const token = crypto.randomUUID();
	const server = http.createServer(handleHttpRequest);
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			bridgeInfo = { port: server.address().port, token };
			resolve(bridgeInfo);
		});
	});
}

export function getBridgeInfo() {
	return bridgeInfo;
}
