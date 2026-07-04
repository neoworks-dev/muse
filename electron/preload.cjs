const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiCli', {
	start(request) {
		return ipcRenderer.invoke('ai-cli:start', request);
	},
	cancel(streamId) {
		ipcRenderer.send('ai-cli:cancel', streamId);
	},
	listModels(engine) {
		return ipcRenderer.invoke('ai-cli:models', engine);
	},
	// Subscribe before calling start() so no events are missed.
	onEvent(streamId, callback) {
		const channel = `ai-cli:event:${streamId}`;
		const listener = (_event, payload) => callback(payload);
		ipcRenderer.on(channel, listener);
		return () => ipcRenderer.removeListener(channel, listener);
	}
});

contextBridge.exposeInMainWorld('canvasBridge', {
	// Renderer registers one handler; main forwards MCP tool calls through it.
	onRequest(handler) {
		ipcRenderer.on('canvas-bridge:request', async (_event, { requestId, method, params }) => {
			try {
				const result = await handler(method, params);
				ipcRenderer.send('canvas-bridge:response', { requestId, result });
			} catch (e) {
				const error = e instanceof Error ? e.message : String(e);
				ipcRenderer.send('canvas-bridge:response', { requestId, error });
			}
		});
	}
});

contextBridge.exposeInMainWorld('speech', {
	transcribe(pcmBuffer, language) {
		return ipcRenderer.invoke('speech:transcribe', pcmBuffer, language);
	},
	speak(text, language) {
		return ipcRenderer.invoke('speech:speak', text, language);
	}
});

contextBridge.exposeInMainWorld('embeddings', {
	embedText(texts, kind) {
		return ipcRenderer.invoke('embeddings:text', texts, kind);
	},
	embedImage(dataUrls) {
		return ipcRenderer.invoke('embeddings:image', dataUrls);
	}
});
