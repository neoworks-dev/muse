export type ThemeMode = 'dark' | 'light';

const KEY = 'muse:theme';

function readInitial(): ThemeMode {
	try {
		const saved = localStorage.getItem(KEY);
		if (saved === 'light' || saved === 'dark') return saved;
	} catch {}
	return 'dark';
}

export const theme = $state({ mode: readInitial() as ThemeMode });

// Mirrors the active mode onto <html data-theme> so the neoworks token layer
// and daisyUI theme switch.
export function applyTheme(): void {
	document.documentElement.setAttribute('data-theme', theme.mode);
}

export function setTheme(mode: ThemeMode): void {
	theme.mode = mode;
	try {
		localStorage.setItem(KEY, mode);
	} catch {}
	applyTheme();
}

export function toggleTheme(): void {
	setTheme(theme.mode === 'dark' ? 'light' : 'dark');
}
