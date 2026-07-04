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
