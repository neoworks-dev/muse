<script lang="ts">
	import { login } from '$lib/auth.svelte';

	let busy = $state(false);

	async function onLogin() {
		busy = true;
		try {
			await login();
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-base-200 text-base-content">
	<div class="flex flex-col items-center gap-2">
		<div
			class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary text-2xl font-bold text-white select-none"
		>
			M
		</div>
		<h1 class="text-2xl font-semibold">Muse</h1>
		<p class="text-sm opacity-60">Your spatial canvas, synced with Neoworks.</p>
	</div>

	<button class="btn btn-primary" onclick={onLogin} disabled={busy}>
		{busy ? 'Redirecting…' : 'Login with Neoworks'}
	</button>
</div>
