// Minimal MCP stdio server exposing Muse canvas search to coding-agent CLIs.
// Spawned by the claude CLI (via --mcp-config) with ELECTRON_RUN_AS_NODE=1.
// Dependency-free on purpose: it must run from a packaged app without
// node_modules resolution.
//
// Talks to the Electron main process over the localhost canvas bridge
// (MUSE_BRIDGE_URL + MUSE_BRIDGE_TOKEN env vars).

const BRIDGE_URL = process.env.MUSE_BRIDGE_URL;
const BRIDGE_TOKEN = process.env.MUSE_BRIDGE_TOKEN;

const TOOLS = [
	{
		name: 'search_canvas',
		description:
			"Semantic search over the user's canvas content (documents, notes, bookmarks, folders, images). Returns the best-matching objects with content excerpts and their IDs.",
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'What to look for, natural language.' },
				limit: { type: 'number', description: 'Max results, default 6.' }
			},
			required: ['query']
		}
	},
	{
		name: 'get_canvas_object',
		description:
			'Fetch the full content of a single canvas object (e.g. a whole document) by its ID, as returned by search_canvas.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Canvas object ID.' }
			},
			required: ['id']
		}
	}
];

async function callBridge(method, params) {
	const response = await fetch(`${BRIDGE_URL}/rpc`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${BRIDGE_TOKEN}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({ method, params })
	});
	const payload = await response.json();
	if (!response.ok || payload.error) {
		throw new Error(payload.error ?? `Bridge error ${response.status}`);
	}
	return payload.result;
}

async function handleToolCall(name, args) {
	if (name === 'search_canvas') {
		return callBridge('search', { query: args.query, limit: args.limit ?? 6 });
	}
	if (name === 'get_canvas_object') {
		return callBridge('get', { id: args.id });
	}
	throw new Error(`Unknown tool: ${name}`);
}

function respond(id, result) {
	process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id, message) {
	process.stdout.write(
		JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n'
	);
}

async function handleMessage(message) {
	const { id, method, params } = message;

	if (method === 'initialize') {
		respond(id, {
			protocolVersion: params?.protocolVersion ?? '2025-06-18',
			capabilities: { tools: {} },
			serverInfo: { name: 'muse-canvas', version: '1.0.0' }
		});
		return;
	}
	if (method === 'tools/list') {
		respond(id, { tools: TOOLS });
		return;
	}
	if (method === 'tools/call') {
		try {
			const result = await handleToolCall(params.name, params.arguments ?? {});
			respond(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
		} catch (e) {
			respond(id, {
				content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
				isError: true
			});
		}
		return;
	}
	if (method === 'ping') {
		respond(id, {});
		return;
	}
	// Notifications (no id) need no reply; unknown requests get an error.
	if (id !== undefined) respondError(id, `Method not supported: ${method}`);
}

let stdinBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
	stdinBuffer += chunk;
	const lines = stdinBuffer.split('\n');
	stdinBuffer = lines.pop() ?? '';
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			void handleMessage(JSON.parse(line));
		} catch {
			// Ignore malformed lines.
		}
	}
});
process.stdin.on('end', () => process.exit(0));
