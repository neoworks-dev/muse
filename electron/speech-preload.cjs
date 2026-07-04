const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the hidden speech worker window. Main sends jobs; the renderer
// runs the ONNX models and sends results back.
contextBridge.exposeInMainWorld('speechHost', {
	onJob: (callback) => ipcRenderer.on('speech:job', (_event, job) => callback(job)),
	sendResult: (result) => ipcRenderer.send('speech:result', result),
	ready: () => ipcRenderer.send('speech:ready'),
	log: (message) => ipcRenderer.send('speech:log', message)
});
