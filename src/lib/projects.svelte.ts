import { db } from './db';
import { canvas } from './state.svelte';
import { hydrate } from './sync.svelte';
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

const ACTIVE_KEY = 'muse:active-project';
const ADOPTED_KEY = 'muse:objects-adopted';

/** The project whose objects are currently loaded into the canvas. */
export function activeProjectId(): string | null {
	return projects.activeId;
}

export const activeProject = () => projects.list.find((p) => p.id === projects.activeId) ?? null;

// ── Load ─────────────────────────────────────────────────────────────────────

/**
 * Loads the project list, creating a default project on first run and adopting
 * any pre-projects objects into it. Picks the last-active project (or the first).
 */
export async function loadProjects(): Promise<void> {
	let rows = await fetchProjects();

	if (rows.length === 0) {
		const first = await createProjectRow('My Canvas');
		await adoptOrphanObjects(first.id);
		rows = [first];
	}

	projects.list = rows;

	const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_KEY) : null;
	const valid = saved && rows.some((p) => p.id === saved);
	projects.activeId = valid ? saved : rows[0].id;
	projects.ready = true;
}

async function fetchProjects(): Promise<Project[]> {
	const data = await db.query({
		projects: { __args: { limit: 1000 }, id: true, name: true, color: true }
	});
	return (data.projects ?? []) as Project[];
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export async function createProject(name: string): Promise<Project> {
	const project = await createProjectRow(name);
	projects.list = [...projects.list, project];
	await switchProject(project.id);
	return project;
}

async function createProjectRow(name: string, color?: string): Promise<Project> {
	const id = createId('project');
	const now = new Date().toISOString();
	const input: Record<string, unknown> = { name, created_at: now, updated_at: now };
	if (color) input.color = color;
	await db.mutation({ createProject: { __args: { id, input: input as never }, id: true } });
	return { id, name, color };
}

export async function renameProject(id: string, name: string): Promise<void> {
	const project = projects.list.find((p) => p.id === id);
	if (!project) return;
	project.name = name;
	await db.mutation({
		updateProject: {
			__args: { id, input: { name, updated_at: new Date().toISOString() } as never },
			id: true
		}
	});
}

/**
 * Deletes a project and all of its canvas objects. Refuses to remove the last
 * remaining project. Switches to another project if the active one is deleted.
 */
export async function deleteProject(id: string): Promise<void> {
	if (projects.list.length <= 1) return;

	const objectIds = await objectIdsFor(id);
	for (const objectId of objectIds) {
		await db.mutation({ deleteObject: { __args: { id: objectId } } });
	}
	await db.mutation({ deleteProject: { __args: { id } } });

	projects.list = projects.list.filter((p) => p.id !== id);

	if (projects.activeId === id) {
		await switchProject(projects.list[0].id);
	}
}

// ── Switch ─────────────────────────────────────────────────────────────────────

/** Activates a project and reloads the canvas with that project's objects. */
export async function switchProject(id: string): Promise<void> {
	if (id === projects.activeId) return;
	projects.activeId = id;
	if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVE_KEY, id);
	canvas.folderStack = [];
	canvas.selection = [];
	await hydrate();
}

// ── Object id helpers ───────────────────────────────────────────────────────────

async function objectIdsFor(projectId: string): Promise<string[]> {
	const data = await db.query({
		objects: { __args: { limit: 100000, filter: { project_id: projectId } as never }, id: true }
	});
	return ((data.objects ?? []) as { id: string }[]).map((o) => o.id);
}

/**
 * One-time migration: assigns every object that predates projects (no
 * project_id) to the default project. Guarded by a localStorage flag.
 */
async function adoptOrphanObjects(projectId: string): Promise<void> {
	if (typeof localStorage !== 'undefined' && localStorage.getItem(ADOPTED_KEY)) return;

	const data = await db.query({
		objects: { __args: { limit: 100000 }, id: true, project_id: true }
	});
	const orphans = ((data.objects ?? []) as { id: string; project_id?: string | null }[]).filter(
		(o) => !o.project_id
	);

	const now = new Date().toISOString();
	for (const orphan of orphans) {
		await db.mutation({
			updateObject: {
				__args: { id: orphan.id, input: { project_id: projectId, updated_at: now } as never },
				id: true
			}
		});
	}

	if (typeof localStorage !== 'undefined') localStorage.setItem(ADOPTED_KEY, '1');
}
