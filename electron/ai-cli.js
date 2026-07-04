import { spawn } from 'child_process';
import { ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Streams AI completions through local coding-agent CLIs (Claude Code, Codex,
// opencode) instead of provider HTTP APIs, so requests bill against the user's
// subscription. Renderer protocol (per stream id):
//   invoke 'ai-cli:start' { id, engine, messages, system?, model? }
//   send   'ai-cli:cancel' id
//   receive `ai-cli:event:{id}` { type: 'chunk'|'error'|'done', ... }

const activeStreams = new Map();

function findBinary(name, extraCandidates = []) {
	const candidates = [
		...extraCandidates,
		path.join(os.homedir(), '.local/bin', name),
		path.join(os.homedir(), '.claude/local', name),
		'/usr/local/bin/' + name,
		'/usr/bin/' + name
	];
	for (const candidate of candidates) {
		if (candidate && fs.existsSync(candidate)) return candidate;
	}
	// Fall back to PATH resolution.
	return name;
}

function dataUrlToImage(dataUrl) {
	const [header, data] = dataUrl.split(',');
	const mediaType = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
	return { mediaType, data };
}

// All three CLIs take a single prompt per run, so earlier turns are replayed
// as a transcript block ahead of the latest user message.
function flattenMessages(messages) {
	const history = messages.slice(0, -1);
	const last = messages[messages.length - 1];

	let text = '';
	if (history.length > 0) {
		const transcript = history
			.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
			.join('\n\n');
		text = `<conversation-history>\n${transcript}\n</conversation-history>\n\n`;
	}
	text += last?.content ?? '';

	return { text, images: last?.images ?? [] };
}

function writeTempImages(images) {
	const files = [];
	for (const dataUrl of images) {
		const { mediaType, data } = dataUrlToImage(dataUrl);
		const ext = mediaType.split('/')[1] ?? 'png';
		const file = path.join(
			os.tmpdir(),
			`muse-ai-${process.pid}-${files.length}-${Math.random().toString(36).slice(2)}.${ext}`
		);
		fs.writeFileSync(file, Buffer.from(data, 'base64'));
		files.push(file);
	}
	return files;
}

// ── Engine definitions ────────────────────────────────────────────────
// Each engine returns { bin, args, stdin?, tempFiles?, parseLine } where
// parseLine(line, emit) turns one stdout line into text chunks. A null
// parseLine means stdout is plain text and is forwarded as-is.

function claudeEngine({ system, model, messages }) {
	const { text, images } = flattenMessages(messages);
	const args = [
		'-p',
		'--input-format', 'stream-json',
		'--output-format', 'stream-json',
		'--include-partial-messages',
		'--verbose',
		'--tools', '',
		// Keep the app's system prompt the only instruction source. Note:
		// --bare would also work here but it skips credential loading and the
		// CLI then reports "Not logged in".
		'--exclude-dynamic-system-prompt-sections'
	];
	if (system) args.push('--system-prompt', system);
	if (model) args.push('--model', model);

	const blocks = images.map((img) => {
		const { mediaType, data } = dataUrlToImage(img);
		return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
	});
	blocks.push({ type: 'text', text });
	const stdin = JSON.stringify({ type: 'user', message: { role: 'user', content: blocks } }) + '\n';

	let sawDelta = false;
	function parseLine(event, emit) {
		if (event.type === 'stream_event') {
			const inner = event.event;
			if (inner?.type !== 'content_block_delta') return;
			if (inner.delta?.type !== 'text_delta') return;
			sawDelta = true;
			emit.chunk(inner.delta.text);
			return;
		}
		if (event.type === 'result') {
			if (event.is_error) {
				emit.error(String(event.result ?? 'Claude Code returned an error.'));
				return;
			}
			// Fallback for CLI versions without partial message events.
			if (!sawDelta && typeof event.result === 'string') emit.chunk(event.result);
		}
	}

	return {
		bin: findBinary('claude', [process.env.CLAUDE_CODE_PATH]),
		args,
		stdin,
		parseLine
	};
}

function codexEngine({ system, model, messages }) {
	const { text, images } = flattenMessages(messages);
	const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--color', 'never'];
	if (model) args.push('-m', model);

	const tempFiles = writeTempImages(images);
	for (const file of tempFiles) args.push('-i', file);

	let prompt = text;
	if (system) prompt = `<system-instructions>\n${system}\n</system-instructions>\n\n${text}`;
	args.push('-');

	let sawDelta = false;
	function parseLine(event, emit) {
		// Legacy event shape: { msg: { type, delta|message } }
		const msg = event.msg;
		if (msg?.type === 'agent_message_delta' && typeof msg.delta === 'string') {
			sawDelta = true;
			emit.chunk(msg.delta);
			return;
		}
		if (msg?.type === 'agent_message' && typeof msg.message === 'string') {
			if (!sawDelta) emit.chunk(msg.message);
			return;
		}
		// Current event shape: { type: 'item.completed', item: { type|item_type, text } }
		if (event.type === 'item.completed') {
			const item = event.item ?? {};
			const kind = item.item_type ?? item.type;
			if (kind === 'agent_message' || kind === 'assistant_message') {
				if (!sawDelta && typeof item.text === 'string') emit.chunk(item.text);
			}
			return;
		}
		// Standalone 'error' events are transient (reconnect attempts) — only a
		// failed turn is fatal.
		if (event.type === 'turn.failed') {
			emit.error(event.error?.message ?? 'Codex turn failed.');
		}
	}

	return {
		bin: findBinary('codex', [process.env.CODEX_PATH]),
		args,
		stdin: prompt,
		tempFiles,
		parseLine
	};
}

function opencodeEngine({ system, model, messages }) {
	const { text } = flattenMessages(messages);
	let prompt = text;
	if (system) prompt = `<system-instructions>\n${system}\n</system-instructions>\n\n${text}`;

	const args = ['run', '--format', 'json', '--pure'];
	if (model) args.push('--model', model);
	args.push(prompt);

	// "text" events carry cumulative snapshots per part id — emit only the
	// unseen suffix so the renderer receives clean deltas.
	const partProgress = new Map();
	function parseLine(event, emit) {
		if (event.type !== 'text') return;
		const part = event.part ?? {};
		if (typeof part.text !== 'string') return;
		const seen = partProgress.get(part.id) ?? 0;
		if (part.text.length <= seen) return;
		emit.chunk(part.text.slice(seen));
		partProgress.set(part.id, part.text.length);
	}

	return {
		bin: findBinary('opencode', [process.env.OPENCODE_PATH]),
		args,
		parseLine
	};
}

const ENGINES = {
	'claude-code': claudeEngine,
	codex: codexEngine,
	opencode: opencodeEngine
};

// ── Stream lifecycle ──────────────────────────────────────────────────

function startStream(sender, request) {
	const { id, engine } = request;
	const buildEngine = ENGINES[engine];

	const channel = `ai-cli:event:${id}`;
	function send(payload) {
		if (!sender.isDestroyed()) sender.send(channel, payload);
	}

	if (!buildEngine) {
		send({ type: 'error', message: `Unknown AI engine: ${engine}` });
		send({ type: 'done' });
		return;
	}

	const spec = buildEngine(request);
	// Neutral cwd so CLIs don't pick up per-project config or git state.
	const child = spawn(spec.bin, spec.args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: os.tmpdir() });
	activeStreams.set(id, child);

	const emit = {
		chunk: (text) => send({ type: 'chunk', text }),
		error: (message) => send({ type: 'error', message })
	};

	let stderrTail = '';
	let stdoutBuffer = '';

	child.stdout.on('data', (chunk) => {
		if (!spec.parseLine) {
			emit.chunk(chunk.toString());
			return;
		}
		stdoutBuffer += chunk.toString();
		const lines = stdoutBuffer.split('\n');
		stdoutBuffer = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				spec.parseLine(JSON.parse(line), emit);
			} catch {}
		}
	});

	child.stderr.on('data', (chunk) => {
		stderrTail = (stderrTail + chunk.toString()).slice(-2000);
	});

	function cleanup() {
		activeStreams.delete(id);
		for (const file of spec.tempFiles ?? []) {
			fs.rm(file, { force: true }, () => {});
		}
	}

	child.on('error', (err) => {
		send({
			type: 'error',
			message: `Could not launch "${spec.bin}" (${err.message}). Install the ${engine} CLI or set its path env var.`
		});
		send({ type: 'done' });
		cleanup();
	});

	child.on('close', (code) => {
		if (code !== 0 && !child.killed) {
			send({ type: 'error', message: `${engine} exited with code ${code}: ${stderrTail}` });
		}
		send({ type: 'done' });
		cleanup();
	});

	if (spec.stdin != null) child.stdin.write(spec.stdin);
	child.stdin.end();
}

// ── Model listing ─────────────────────────────────────────────────────

function runCommand(bin, args, timeoutMs = 20000) {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: os.tmpdir() });
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
		child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
		child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
		child.on('error', (err) => {
			clearTimeout(timer);
			reject(new Error(`Could not launch "${bin}": ${err.message}`));
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			if (code === 0) resolve(stdout);
			else reject(new Error(`"${bin} ${args.join(' ')}" failed (${code}): ${stderr.slice(-500)}`));
		});
	});
}

// Claude Code has no model-list command; these aliases always resolve to the
// newest model of each family.
const CLAUDE_MODEL_ALIASES = [
	{ id: 'fable', name: 'Fable', description: 'Latest Fable model' },
	{ id: 'opus', name: 'Opus', description: 'Latest Opus model' },
	{ id: 'sonnet', name: 'Sonnet', description: 'Latest Sonnet model' },
	{ id: 'haiku', name: 'Haiku', description: 'Latest Haiku model' }
];

async function listCodexModels() {
	const bin = findBinary('codex', [process.env.CODEX_PATH]);
	let stdout;
	try {
		stdout = await runCommand(bin, ['debug', 'models']);
	} catch {
		// Offline fallback: catalog bundled in the binary.
		stdout = await runCommand(bin, ['debug', 'models', '--bundled']);
	}
	const catalog = JSON.parse(stdout);
	return (catalog.models ?? [])
		.filter((m) => m.visibility === 'list')
		.map((m) => ({ id: m.slug, name: m.display_name ?? m.slug, description: m.description }));
}

async function listOpencodeModels() {
	const bin = findBinary('opencode', [process.env.OPENCODE_PATH]);
	const stdout = await runCommand(bin, ['models']);
	return stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.includes('/'))
		.map((id) => ({ id, name: id }));
}

async function listModels(engine) {
	if (engine === 'claude-code') return CLAUDE_MODEL_ALIASES;
	if (engine === 'codex') return listCodexModels();
	if (engine === 'opencode') return listOpencodeModels();
	throw new Error(`Unknown AI engine: ${engine}`);
}

export function registerAiCliBridge() {
	ipcMain.handle('ai-cli:start', (event, request) => {
		startStream(event.sender, request);
	});
	ipcMain.on('ai-cli:cancel', (_event, id) => {
		const child = activeStreams.get(id);
		if (child) child.kill('SIGTERM');
	});
	ipcMain.handle('ai-cli:models', (_event, engine) => listModels(engine));
}
