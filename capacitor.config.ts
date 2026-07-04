import type { CapacitorConfig } from '@capacitor/cli';

// Live reload: when MUSE_DEV_SERVER is set point the webview at the host dev
// server (reached over the adb reverse bridge) instead of the bundled build.
// Defaults to the Caddy https host so a normal native build still loads the app.
const devServer = process.env.MUSE_DEV_SERVER ?? 'https://muse.neoworks.localhost';

const config: CapacitorConfig = {
	appId: 'dev.neoworks.muse',
	appName: 'muse',
	webDir: 'build',
	server: {
		url: devServer,
		cleartext: true
	}
};

export default config;
