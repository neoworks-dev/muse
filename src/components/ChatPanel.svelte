<script lang="ts">
	import { tick, onMount, onDestroy } from 'svelte';
	import { cubicOut } from 'svelte/easing';

	function slideWidth(node: HTMLElement) {
		const w = node.clientWidth;
		return {
			duration: 220,
			easing: cubicOut,
			css: (t: number) => `width: ${t * w}px; min-width: 0; overflow: hidden;`,
		};
	}
	import { marked } from 'marked';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTiltIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ArrowSquareUpRightIcon from 'phosphor-svelte/lib/ArrowSquareUpRightIcon';
	import NotePencilIcon from 'phosphor-svelte/lib/NotePencilIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import GitForkIcon from 'phosphor-svelte/lib/GitForkIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import ListBulletsIcon from 'phosphor-svelte/lib/ListBulletsIcon';
	import MagicWandIcon from 'phosphor-svelte/lib/MagicWandIcon';
	import { streamCompletion } from '$lib/ai';
	import type { EditorAnnot, ChatAnnot, Msg, Thread, FlatTreeNode } from '$lib/editor-types';

	let {
		docText,
		editorAnnots,
		open = $bindable(false),
		width = $bindable(340),
		onInsertToDoc,
		onProposedDoc
	}: {
		docText: string;
		editorAnnots: EditorAnnot[];
		open: boolean;
		width: number;
		onInsertToDoc: (text: string) => void;
		onProposedDoc?: (text: string) => void;
	} = $props();

	// ── Thread / chat state ─────────────────────────────────────────────────────
	let threads: Thread[] = $state([
		{ id: 'main', name: 'Main', messages: [], createdAt: Date.now() }
	]);
	let activeThreadId = $state('main');
	let showThreadList = $state(false);
	let isResizing = $state(false);

	let chatInput = $state('');
	let streaming = $state('');
	let chatLoading = $state(false);
	let applyToDocLoading = $state(false);

	let chatAnnots: ChatAnnot[] = $state([]);
	let editCAnnotId: string | null = $state(null);
	let chatAnnotDraft = $state('');
	let chatSelBar: { text: string; msgIndex: number; x: number; y: number } | null = $state(null);

	let editingThreadName = $state(false);
	let threadNameDraft = $state('');

	// ── Refs ────────────────────────────────────────────────────────────────────
	let chatScrollEl: HTMLDivElement | undefined;
	let chatInputEl: HTMLTextAreaElement | undefined;
	let cAnnotInputEl: HTMLTextAreaElement | undefined;
	let threadNameEl: HTMLInputElement | undefined;

	// ── Derived ─────────────────────────────────────────────────────────────────
	let activeThread = $derived(threads.find((t) => t.id === activeThreadId)!);
	let pendingCAnnots = $derived(chatAnnots.filter((a) => !a.sent && a.note.trim()).length);

	let flatTree = $derived.by<FlatTreeNode[]>(() => {
		const childMap = new Map<string, Thread[]>();
		for (const t of threads) {
			const key = t.parentThreadId ?? '__root__';
			if (!childMap.has(key)) childMap.set(key, []);
			childMap.get(key)!.push(t);
		}
		const result: FlatTreeNode[] = [];
		function walk(t: Thread, depth: number, ancestorHasMore: boolean[]) {
			const children = childMap.get(t.id) ?? [];
			result.push({
				thread: t,
				depth,
				hasChildren: children.length > 0,
				isLastChild: false,
				vertLines: ancestorHasMore
			});
			children.forEach((child, idx) => {
				walk(child, depth + 1, [...ancestorHasMore, idx < children.length - 1]);
			});
		}
		(childMap.get('__root__') ?? []).forEach((t) => walk(t, 0, []));
		return result;
	});

	// ── Lifecycle ────────────────────────────────────────────────────────────────
	$effect(() => {
		if (open)
			tick().then(() => {
				chatInputEl?.focus();
				scrollChat();
			});
	});

	onMount(() => {
		const onDown = (e: PointerEvent) => {
			if (!(e.target as HTMLElement).closest('[data-chat-sel-bar], [data-cannot-card]')) {
				chatSelBar = null;
			}
		};
		window.addEventListener('pointerdown', onDown);
		return () => window.removeEventListener('pointerdown', onDown);
	});

	// ── Helpers ──────────────────────────────────────────────────────────────────
	function md(src: string): string {
		return marked(src, { async: false }) as string;
	}
	function fmtTime(ts: number) {
		return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	// ── Thread management ─────────────────────────────────────────────────────────
	function createThread() {
		const id = crypto.randomUUID();
		threads = [...threads, { id, name: 'New thread', messages: [], createdAt: Date.now() }];
		activeThreadId = id;
		showThreadList = false;
		chatAnnots = [];
	}

	function findRoot(threadId: string): string {
		const t = threads.find((t) => t.id === threadId);
		if (!t || !t.parentThreadId) return threadId;
		return findRoot(t.parentThreadId);
	}

	function branchThread(upToIdx: number) {
		const source = activeThread;
		const id = crypto.randomUUID();
		const branchedMsgs = source.messages.slice(0, upToIdx + 1);
		const snippet = branchedMsgs.findLast((m) => m.role === 'assistant')?.content ?? '';
		const name = 'Branch: ' + snippet.replace(/\n/g, ' ').slice(0, 32) + '…';
		// Always branch from root so all branches stay at depth 1
		const rootId = findRoot(source.id);
		threads = [
			...threads,
			{
				id,
				name,
				messages: branchedMsgs,
				createdAt: Date.now(),
				parentThreadId: rootId,
				parentMsgIdx: upToIdx
			}
		];
		activeThreadId = id;
		showThreadList = false;
		chatAnnots = [];
	}

	function startRenameThread() {
		threadNameDraft = activeThread.name;
		editingThreadName = true;
		tick().then(() => threadNameEl?.select());
	}

	function commitRenameThread() {
		const name = threadNameDraft.trim();
		if (name) threads = threads.map((t) => (t.id === activeThreadId ? { ...t, name } : t));
		editingThreadName = false;
	}

	// ── Chat annotations ──────────────────────────────────────────────────────────
	function handleMsgMouseUp(e: MouseEvent, msgIndex: number) {
		if ((e.target as HTMLElement).closest('button, textarea, input, [data-cannot-card]')) return;
		setTimeout(() => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed) {
				chatSelBar = null;
				return;
			}
			const text = sel.toString().trim();
			if (!text) {
				chatSelBar = null;
				return;
			}
			const rect = sel.getRangeAt(0).getBoundingClientRect();
			chatSelBar = { text, msgIndex, x: rect.left + rect.width / 2, y: rect.top };
		}, 0);
	}

	function insertChatSelection() {
		if (!chatSelBar) return;
		onInsertToDoc(chatSelBar.text);
		chatSelBar = null;
		window.getSelection()?.removeAllRanges();
	}

	async function createChatAnnot() {
		if (!chatSelBar) return;
		const id = crypto.randomUUID();
		chatAnnots = [
			...chatAnnots,
			{ id, quote: chatSelBar.text, note: '', msgIndex: chatSelBar.msgIndex, sent: false }
		];
		editCAnnotId = id;
		chatAnnotDraft = '';
		chatSelBar = null;
		window.getSelection()?.removeAllRanges();
		await tick();
		cAnnotInputEl?.focus();
		scrollChat();
	}

	function commitChatAnnot() {
		if (!editCAnnotId) return;
		const note = chatAnnotDraft.trim();
		chatAnnots = note
			? chatAnnots.map((a) => (a.id === editCAnnotId ? { ...a, note } : a))
			: chatAnnots.filter((a) => a.id !== editCAnnotId);
		editCAnnotId = null;
		chatAnnotDraft = '';
	}

	function cancelChatAnnot() {
		if (editCAnnotId) chatAnnots = chatAnnots.filter((a) => a.id !== editCAnnotId);
		editCAnnotId = null;
		chatAnnotDraft = '';
	}

	function deleteChatAnnot(id: string) {
		chatAnnots = chatAnnots.filter((a) => a.id !== id);
	}

	function onCAnnotKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			commitChatAnnot();
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelChatAnnot();
		}
	}

	// ── Chat send ──────────────────────────────────────────────────────────────────
	async function sendChat() {
		const text = chatInput.trim();
		const pending = chatAnnots.filter((a) => !a.sent && a.note.trim());
		if (!text && !pending.length) return;
		if (chatLoading) return;

		chatInput = '';

		let apiContent = text;
		if (pending.length) {
			const block = pending.map((a) => `> "${a.quote}"\n→ ${a.note}`).join('\n\n');
			apiContent = `Annotations on your previous response:\n\n${block}${text ? `\n\n---\n\n${text}` : ''}`;
		}

		chatAnnots = chatAnnots.map((a) => ({ ...a, sent: true }));

		const newMsg: Msg = {
			role: 'user',
			content: apiContent,
			display: text || undefined,
			annotCount: pending.length || undefined
		};
		const updatedMsgs = [...activeThread.messages, newMsg];
		threads = threads.map((t) => (t.id === activeThreadId ? { ...t, messages: updatedMsgs } : t));

		if (!editingThreadName && activeThread.messages.length === 0 && text) {
			const autoName = text.slice(0, 40) + (text.length > 40 ? '…' : '');
			threads = threads.map((t) => (t.id === activeThreadId ? { ...t, name: autoName } : t));
		}

		chatLoading = true;
		streaming = '';

		const annotNotes = editorAnnots
			.filter((a) => a.note)
			.map((a) => `"${a.quote}" → ${a.note}`)
			.join('\n');
		const system =
			`You are a thinking partner helping the user develop and refine their ideas.` +
			(docText ? `\n\nCurrent document:\n\n${docText}` : '') +
			(annotNotes ? `\n\nDocument annotations by the user:\n${annotNotes}` : '') +
			`\n\nWhen the user sends chat annotations, address each one directly. Be concise and focused. Respond in markdown.`;

		try {
			const history = updatedMsgs.map((m) => ({ role: m.role, content: m.content }));
			for await (const chunk of streamCompletion(history, system)) {
				streaming += chunk;
				await tick();
				scrollChat();
			}
			threads = threads.map((t) =>
				t.id === activeThreadId
					? { ...t, messages: [...t.messages, { role: 'assistant', content: streaming }] }
					: t
			);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			threads = threads.map((t) =>
				t.id === activeThreadId
					? { ...t, messages: [...t.messages, { role: 'assistant', content: `⚠️ ${msg}` }] }
					: t
			);
		} finally {
			streaming = '';
			chatLoading = false;
			await tick();
			scrollChat();
		}
	}

	function scrollChat() {
		if (chatScrollEl) chatScrollEl.scrollTop = chatScrollEl.scrollHeight;
	}

	// ── Apply to doc (chat-driven revision) ───────────────────────────────────────
	async function applyToDoc() {
		if (!onProposedDoc || !docText || applyToDocLoading || chatLoading) return;
		const pending = chatAnnots.filter((a) => !a.sent && a.note.trim());
		const text = chatInput.trim();
		if (!pending.length && !text) return;

		applyToDocLoading = true;
		chatInput = '';

		let requestDesc = text;
		if (pending.length) {
			const block = pending.map((a) => `- "${a.quote}": ${a.note}`).join('\n');
			requestDesc = `Annotations on the AI's previous response:\n${block}${text ? `\n\nAdditional instructions: ${text}` : ''}`;
		}
		chatAnnots = chatAnnots.map((a) => ({ ...a, sent: true }));

		const userMsg: Msg = {
			role: 'user',
			content: requestDesc,
			display:
				text || `Apply ${pending.length} annotation${pending.length !== 1 ? 's' : ''} to document`,
			annotCount: pending.length || undefined
		};
		const updatedMsgs = [...activeThread.messages, userMsg];
		threads = threads.map((t) => (t.id === activeThreadId ? { ...t, messages: updatedMsgs } : t));

		const system = `You are a document editor. The user wants changes applied to their document.
Return your response in two parts:
1. One sentence explaining what you changed.
2. The complete revised document wrapped exactly like:
\`\`\`document
...revised content here...
\`\`\``;

		streaming = '';
		try {
			const annotNotes = editorAnnots
				.filter((a) => a.note)
				.map((a) => `"${a.quote}" → ${a.note}`)
				.join('\n');
			const history = updatedMsgs.map((m) => ({ role: m.role, content: m.content }));
			const ctx =
				`Current document:\n\n${docText}` +
				(annotNotes ? `\n\nEditor annotations:\n${annotNotes}` : '');

			let fullResponse = '';
			for await (const chunk of streamCompletion(history, system + '\n\n' + ctx)) {
				fullResponse += chunk;
				streaming = fullResponse;
				await tick();
				scrollChat();
			}

			const aiMsg: Msg = { role: 'assistant', content: fullResponse };
			threads = threads.map((t) =>
				t.id === activeThreadId ? { ...t, messages: [...t.messages, aiMsg] } : t
			);

			const match = fullResponse.match(/```document\n([\s\S]*?)```/);
			if (match) {
				onProposedDoc(match[1].trimEnd());
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			threads = threads.map((t) =>
				t.id === activeThreadId
					? { ...t, messages: [...t.messages, { role: 'assistant', content: `⚠️ ${msg}` }] }
					: t
			);
		} finally {
			streaming = '';
			applyToDocLoading = false;
			await tick();
			scrollChat();
		}
	}

	function onChatKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			sendChat();
		}
	}

	// ── Resize ──────────────────────────────────────────────────────────────────
	function onResizePointerDown(e: PointerEvent) {
		isResizing = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onResizePointerMove(e: PointerEvent) {
		if (!isResizing) return;
		width = Math.max(240, Math.min(700, width - e.movementX));
	}
	function onResizePointerUp() {
		isResizing = false;
	}
</script>

<!-- Panel -->
<div
	class="relative flex shrink-0 flex-col overflow-hidden border-l border-black/[0.06] bg-white"
	style="width: {width}px"
	transition:slideWidth
>
	<!-- Resize handle -->
	<div
		class="absolute top-0 bottom-0 left-[-3px] z-10 w-1.5 cursor-col-resize bg-transparent transition-colors duration-150 hover:bg-indigo-400/30 active:bg-indigo-400/50"
		onpointerdown={onResizePointerDown}
		onpointermove={onResizePointerMove}
		onpointerup={onResizePointerUp}
		role="separator"
		aria-label="Resize chat panel"
	/>

	<!-- ── THREAD LIST VIEW ── -->
	{#if showThreadList}
		<div class="flex shrink-0 items-center gap-1.5 border-b border-black/[0.06] px-3.5 py-2.5">
			<span class="text-[0.7rem] font-semibold tracking-widest text-stone-500 uppercase"
				>Conversations</span
			>
			<div class="ml-auto flex gap-1">
				<button
					class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-900"
					onclick={createThread}
					title="New thread"><PlusIcon size={13} weight="bold" /></button
				>
				<button
					class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-900"
					onclick={() => (open = false)}
					aria-label="Close"><XIcon size={13} weight="bold" /></button
				>
			</div>
		</div>

		<!-- Git tree -->
		<div class="flex flex-1 flex-col gap-0 overflow-y-auto px-2 py-1.5">
			{#each flatTree as node (node.thread.id)}
				{@const LANE = 14}
				{@const MID = 22}
				{@const H = 44}
				{@const R = 4}
				{@const d = node.depth}
				{@const cx = d * LANE + LANE / 2}
				{@const svgW = (d + 1) * LANE}
				{@const isActive = node.thread.id === activeThreadId}
				<button
					class="flex h-11 w-full cursor-pointer items-center overflow-hidden rounded-lg border-none bg-transparent transition-colors {isActive
						? 'bg-indigo-50'
						: 'hover:bg-stone-100'}"
					onclick={() => {
						activeThreadId = node.thread.id;
						showThreadList = false;
					}}
				>
					<svg class="block shrink-0" width={svgW} height={H} viewBox="0 0 {svgW} {H}">
						{#each node.vertLines.slice(0, Math.max(0, d - 1)) as cont, i}
							{#if cont}
								<line
									x1={i * LANE + LANE / 2}
									y1={0}
									x2={i * LANE + LANE / 2}
									y2={H}
									stroke="#d4d4d4"
									stroke-width="1.5"
								/>
							{/if}
						{/each}
						{#if d > 0}
							{@const px = (d - 1) * LANE + LANE / 2}
							<line x1={px} y1={0} x2={px} y2={MID} stroke="#d4d4d4" stroke-width="1.5" />
							<line x1={px} y1={MID} x2={cx} y2={MID} stroke="#d4d4d4" stroke-width="1.5" />
							{#if node.vertLines[d - 1]}
								<line x1={px} y1={MID} x2={px} y2={H} stroke="#d4d4d4" stroke-width="1.5" />
							{/if}
						{/if}
						<circle {cx} cy={MID} r={R} fill={isActive ? '#4f46e5' : '#a8a29e'} />
					</svg>
					<div class="min-w-0 flex-1 px-2.5 py-0">
						<div
							class="overflow-hidden text-[0.8rem] font-semibold text-ellipsis whitespace-nowrap text-stone-900 {isActive
								? 'text-indigo-600'
								: ''}"
						>
							{node.thread.name}
						</div>
						<div class="mt-0.5 text-[0.67rem] text-stone-400">
							{node.thread.messages.length} msg{node.thread.messages.length !== 1 ? 's' : ''}
							{#if node.thread.parentMsgIdx !== undefined}
								· branched at msg {node.thread.parentMsgIdx + 1}{/if}
						</div>
					</div>
				</button>
			{/each}
		</div>

		<div class="shrink-0 border-t border-black/[0.06] px-3 py-2.5">
			<button
				class="flex w-full cursor-pointer items-center gap-1.5 rounded-[0.625rem] border border-dashed border-black/10 bg-transparent px-3 py-1.5 text-[0.78rem] text-stone-500 transition-all hover:border-black/20 hover:bg-stone-100"
				onclick={createThread}
			>
				<PlusIcon size={13} weight="bold" /> New thread
			</button>
		</div>

		<!-- ── THREAD CHAT VIEW ── -->
	{:else}
		<!-- Header -->
		<div class="flex shrink-0 items-center gap-1.5 border-b border-black/[0.06] px-3.5 py-2.5">
			<button
				class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-900"
				onclick={() => (showThreadList = true)}
				title="All threads"><ListBulletsIcon size={13} weight="bold" /></button
			>

			{#if editingThreadName}
				<input
					bind:this={threadNameEl}
					bind:value={threadNameDraft}
					class="flex-1 rounded border border-violet-300 bg-stone-50 px-1 py-0.5 text-[0.7rem] font-semibold tracking-widest text-stone-600 uppercase outline-none focus:border-violet-500"
					onblur={commitRenameThread}
					onkeydown={(e) => {
						if (e.key === 'Enter') commitRenameThread();
						if (e.key === 'Escape') editingThreadName = false;
					}}
				/>
			{:else}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<span
					class="cursor-pointer rounded px-1 py-0.5 text-[0.7rem] font-semibold tracking-widest text-stone-500 uppercase transition-colors hover:bg-stone-100"
					role="button"
					tabindex="0"
					ondblclick={startRenameThread}
					onkeydown={(e) => {
						if (e.key === 'Enter') startRenameThread();
					}}
					title="Double-click to rename">{activeThread.name}</span
				>
			{/if}

			<div class="ml-auto flex gap-1">
				<button
					class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-900"
					onclick={createThread}
					title="New thread"><PlusIcon size={13} weight="bold" /></button
				>
				<button
					class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-900"
					onclick={() => (open = false)}
					aria-label="Close"><XIcon size={13} weight="bold" /></button
				>
			</div>
		</div>

		<!-- Messages -->
		<div class="flex flex-1 flex-col gap-2 overflow-y-auto p-3.5" bind:this={chatScrollEl}>
			{#if activeThread.messages.length === 0 && !streaming && !chatLoading}
				<p class="mx-2 mt-8 text-center text-[0.78rem] leading-relaxed text-stone-400">
					Ask anything about your document or ideas.<br />Select text in a response to insert or
					annotate it.
				</p>
			{/if}

			{#each activeThread.messages as msg, i (i)}
				{#if msg.role === 'user'}
					<div class="flex max-w-[92%] flex-col items-end gap-1 self-end">
						{#if msg.annotCount}
							<span class="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[0.68rem] text-indigo-500">
								↑ {msg.annotCount} annotation{msg.annotCount > 1 ? 's' : ''}
							</span>
						{/if}
						{#if msg.display || !msg.annotCount}
							<p
								class="m-0 rounded-xl rounded-br-[0.2rem] bg-indigo-600 px-3 py-2 text-[0.8125rem] leading-relaxed break-words whitespace-pre-wrap text-white select-text"
							>
								{msg.display ?? msg.content}
							</p>
						{/if}
					</div>
				{:else}
					<div class="group/msg flex max-w-full flex-col gap-1 self-start">
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div
							class="prose prose-sm max-w-none cursor-text rounded-xl rounded-bl-[0.2rem] bg-stone-100 px-3 py-2 text-[0.8125rem] leading-relaxed text-stone-800 prose-stone select-text prose-headings:mb-1 prose-p:my-1 prose-p:last:mb-0 prose-blockquote:border-violet-300 prose-blockquote:text-violet-700 prose-code:bg-black/[0.07] prose-code:before:content-none prose-code:after:content-none prose-pre:bg-black/[0.06]"
							role="article"
							onmouseup={(e) => handleMsgMouseUp(e, i)}
						>
							{@html md(msg.content)}
						</div>
						<div
							class="flex gap-1 px-0.5 opacity-0 transition-opacity duration-[120ms] group-hover/msg:opacity-100"
						>
							<button
								class="flex cursor-pointer items-center gap-1 rounded-md border-none bg-transparent px-1.5 py-0.5 text-[0.68rem] text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600"
								onclick={() => onInsertToDoc(msg.content)}
								title="Append to document"
							>
								<ArrowSquareUpRightIcon size={11} weight="bold" /> Insert all
							</button>
							<button
								class="flex cursor-pointer items-center gap-1 rounded-md border-none bg-transparent px-1.5 py-0.5 text-[0.68rem] text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600"
								onclick={() => branchThread(i)}
								title="Branch new thread from here"
							>
								<GitForkIcon size={11} weight="bold" /> Branch
							</button>
						</div>
					</div>

					<!-- Chat annotations for this message -->
					{#each chatAnnots.filter((a) => a.msgIndex === i) as ann (ann.id)}
						<div
							class="ml-1 w-[calc(100%-0.5rem)] self-start border-l-2 {ann.sent
								? 'border-stone-300 bg-stone-50 opacity-70'
								: 'border-indigo-300 bg-violet-50'} relative flex flex-col gap-1.5 rounded-r-xl px-2.5 py-2"
							data-cannot-card
						>
							<blockquote
								class="text-[0.73rem] italic {ann.sent
									? 'text-stone-400'
									: 'text-violet-700'} m-0 overflow-hidden border-none p-0 leading-relaxed"
								style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;"
							>
								{ann.quote}
							</blockquote>
							{#if editCAnnotId === ann.id}
								<textarea
									bind:this={cAnnotInputEl}
									bind:value={chatAnnotDraft}
									placeholder="Your annotation…"
									rows={2}
									class="box-border w-full resize-none rounded-lg border border-violet-300 bg-white px-2 py-1.5 font-[inherit] text-[0.78rem] leading-relaxed text-stone-800 transition-colors outline-none focus:border-violet-500"
									onkeydown={onCAnnotKeydown}
								></textarea>
								<div class="flex gap-1.5">
									<button
										class="cursor-pointer rounded border-none bg-violet-600 px-2 py-0.5 text-[0.68rem] text-white transition-colors hover:bg-violet-700"
										onclick={commitChatAnnot}>Save ↵</button
									>
									<button
										class="cursor-pointer rounded border-none bg-transparent px-2 py-0.5 text-[0.68rem] text-stone-500 transition-colors hover:bg-stone-100"
										onclick={cancelChatAnnot}>Cancel</button
									>
								</div>
							{:else}
								<p class="m-0 text-[0.78rem] leading-relaxed whitespace-pre-wrap text-stone-700">
									{ann.note}
								</p>
								{#if !ann.sent}
									<button
										class="absolute top-1.5 right-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded border-none bg-transparent text-violet-300 opacity-0 transition-all hover:bg-pink-100 hover:text-pink-700 hover:opacity-100"
										onclick={() => deleteChatAnnot(ann.id)}
										title="Remove"><TrashIcon size={11} weight="bold" /></button
									>
								{/if}
							{/if}
						</div>
					{/each}
				{/if}
			{/each}

			{#if streaming}
				<div class="max-w-full self-start">
					<div
						class="prose prose-sm max-w-none rounded-xl rounded-bl-[0.2rem] bg-stone-100 px-3 py-2 text-[0.8125rem] leading-relaxed text-stone-800 prose-stone prose-p:my-1 prose-code:before:content-none prose-code:after:content-none"
					>
						{@html md(streaming)}<span class="animate-[blink_1s_step-end_infinite]">▋</span>
					</div>
				</div>
			{:else if chatLoading}
				<div class="self-start">
					<p
						class="m-0 rounded-xl rounded-bl-[0.2rem] bg-stone-100 px-3 py-2 text-[0.8125rem] leading-relaxed text-stone-400 italic"
					>
						Thinking…
					</p>
				</div>
			{/if}
		</div>

		{#if pendingCAnnots > 0}
			<div
				class="flex shrink-0 items-center gap-1.5 border-t border-purple-200 bg-violet-50 px-3.5 py-1.5 text-[0.7rem] text-violet-700"
			>
				<NotePencilIcon size={12} weight="bold" />
				{pendingCAnnots} annotation{pendingCAnnots > 1 ? 's' : ''} pending
			</div>
		{/if}

		<div class="flex shrink-0 flex-col gap-2 border-t border-black/[0.06] px-3 py-2.5">
			<textarea
				bind:this={chatInputEl}
				bind:value={chatInput}
				placeholder={pendingCAnnots
					? 'Add a message or send annotations… (⌘↵)'
					: 'Ask a question… (⌘↵)'}
				rows={2}
				class="w-full resize-none rounded-xl border border-black/10 bg-stone-50 px-3 py-2 font-[inherit] text-[0.8125rem] leading-relaxed text-stone-800 transition-colors outline-none placeholder:text-stone-300 focus:border-indigo-400/45"
				onkeydown={onChatKeydown}
			></textarea>
			<div class="flex items-center gap-2">
				{#if onProposedDoc && (pendingCAnnots > 0 || chatInput.trim())}
					<button
						class="flex cursor-pointer items-center gap-1.5 rounded-lg border-none bg-violet-50 px-2.5 py-1.5 text-[0.72rem] font-medium whitespace-nowrap text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-default disabled:opacity-40"
						onclick={applyToDoc}
						disabled={applyToDocLoading || chatLoading}
						title="Ask AI to revise the document and show a diff"
					>
						{#if applyToDocLoading}<CircleNotchIcon
								size={12}
								class="animate-spin"
							/>{:else}<MagicWandIcon size={12} weight="bold" />{/if}
						Apply to doc
					</button>
					<div class="flex-1" />
				{:else}
					<div class="flex-1" />
				{/if}
				<button
					class="flex h-[2.1rem] w-[2.1rem] shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:cursor-default disabled:opacity-35"
					onclick={sendChat}
					disabled={chatLoading || applyToDocLoading || (!chatInput.trim() && !pendingCAnnots)}
					aria-label="Send (⌘↵)"
				>
					<PaperPlaneTiltIcon size={15} weight="bold" />
				</button>
			</div>
		</div>
	{/if}
</div>

<!-- Chat message selection bar (fixed, z-60 to appear above everything) -->
{#if chatSelBar}
	<div
		class="pointer-events-auto fixed z-60 flex items-center rounded-lg bg-stone-900 px-1 py-1 shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
		style="left: {chatSelBar.x}px; top: {chatSelBar.y}px; transform: translate(-50%, calc(-100% - 8px));"
		onpointerdown={(e) => e.stopPropagation()}
		data-chat-sel-bar
		role="toolbar"
	>
		<button
			class="flex cursor-pointer items-center gap-1 rounded-md border-none bg-transparent px-2 py-1 text-[0.72rem] font-medium whitespace-nowrap text-stone-300 transition-colors hover:bg-white/12 hover:text-white"
			onclick={insertChatSelection}
		>
			<ArrowSquareUpRightIcon size={12} weight="bold" /> Insert
		</button>
		<div class="mx-0.5 h-4 w-px bg-white/12"></div>
		<button
			class="flex cursor-pointer items-center gap-1 rounded-md border-none bg-transparent px-2 py-1 text-[0.72rem] font-medium whitespace-nowrap text-stone-300 transition-colors hover:bg-white/12 hover:text-white"
			onclick={createChatAnnot}
		>
			<NotePencilIcon size={12} weight="bold" /> Annotate
		</button>
	</div>
{/if}

<style>
	/* blink keyframe for streaming cursor */
	@keyframes blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}
</style>
