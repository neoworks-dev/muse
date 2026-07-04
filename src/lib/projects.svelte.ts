import { canvas } from './state.svelte';
import { hydrate, flushNow, canvasKey } from './sync.svelte';
import { idbGet, idbPut, idbDel } from './storage.svelte';
import { createId } from './canvas/utils/ids';

export interface Project {
	id: string;
	name: string;
	color?: string | null;
}

export const projects = $state({
	list: [] as Project[],
	activeId: null as string | null,
	ready: false
});

const PROJECTS_KEY = 'projects';
const ACTIVE_KEY = 'muse:active-project';

/** The project whose objects are currently loaded into the canvas. */
export function activeProjectId(): string | null {
	return projects.activeId;
}

export const activeProject = () => projects.list.find((p) => p.id === projects.activeId) ?? null;

// ── Load ─────────────────────────────────────────────────────────────────────

/**
 * Loads the project list from IndexedDB, creating a default project on first
 * run. Picks the last-active project (or the first).
 */
export async function loadProjects(): Promise<void> {
	let rows = (await idbGet<Project[]>(PROJECTS_KEY)) ?? [];

	if (rows.length === 0) {
		rows = [{ id: createId('project'), name: 'My Canvas' }];
		await idbPut(PROJECTS_KEY, rows);
	}

	projects.list = rows;

	const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_KEY) : null;
	const valid = saved && rows.some((p) => p.id === saved);
	projects.activeId = valid ? saved : rows[0].id;
	projects.ready = true;
}

async function persistProjects(): Promise<void> {
	await idbPut(PROJECTS_KEY, $state.snapshot(projects.list));
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export async function createProject(name: string): Promise<Project> {
	const project: Project = { id: createId('project'), name };
	projects.list = [...projects.list, project];
	await persistProjects();
	await switchProject(project.id);
	return project;
}

export async function renameProject(id: string, name: string): Promise<void> {
	const project = projects.list.find((p) => p.id === id);
	if (!project) return;
	project.name = name;
	await persistProjects();
}

/**
 * Deletes a project and its stored canvas snapshot. Refuses to remove the last
 * remaining project. Switches to another project if the active one is deleted.
 */
export async function deleteProject(id: string): Promise<void> {
	if (projects.list.length <= 1) return;

	projects.list = projects.list.filter((p) => p.id !== id);
	await persistProjects();
	await idbDel(canvasKey(id));

	if (projects.activeId === id) {
		await switchProject(projects.list[0].id);
	}
}

// ── Switch ─────────────────────────────────────────────────────────────────────

/** Activates a project and reloads the canvas with that project's objects. */
export async function switchProject(id: string): Promise<void> {
	if (id === projects.activeId) return;
	// Persist the outgoing project before the canvas is replaced.
	await flushNow();
	projects.activeId = id;
	if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVE_KEY, id);
	canvas.folderStack = [];
	canvas.selection = [];
	await hydrate();
}
