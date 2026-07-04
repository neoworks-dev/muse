import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	resolve: {
		// Force a single copy of the CodeMirror core packages. Since muse joined the
		// workspace, a stale local install can shadow the hoisted one, loading two
		// @codemirror/state instances and breaking instanceof checks ("Unrecognized
		// extension value in extension set").
		dedupe: [
			'@codemirror/state',
			'@codemirror/view',
			'@codemirror/language',
			'@codemirror/commands',
			'@lezer/common',
			'@lezer/highlight'
		]
	},
	build: {
		target: 'esnext',
		outDir: 'dist'
	}
});
