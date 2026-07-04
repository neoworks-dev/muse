export interface EditorAnnot {
	id: string;
	from: number;
	to: number;
	quote: string;
	note: string;
}

export interface ChatAnnot {
	id: string;
	quote: string;
	note: string;
	msgIndex: number;
	sent: boolean;
}

export interface Msg {
	role: 'user' | 'assistant';
	content: string;
	display?: string;
	annotCount?: number;
}

export interface Thread {
	id: string;
	name: string;
	messages: Msg[];
	createdAt: number;
	parentThreadId?: string;
	parentMsgIdx?: number;
}

export interface AnnotGroup {
	id: string;
	baseY: number;
	items: { ann: EditorAnnot; y: number }[];
}

export interface FlatTreeNode {
	thread: Thread;
	depth: number;
	hasChildren: boolean;
	isLastChild: boolean;
	vertLines: boolean[];
}
