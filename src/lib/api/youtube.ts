export function extractYoutubeId(url: string): string | null {
	try {
		const u = new URL(url);
		if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
		if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
	} catch {}
	return null;
}

interface YtFormat {
	url?: string;
	mimeType: string;
	bitrate: number;
	qualityLabel?: string;
}

export async function getYoutubeStreamUrl(videoId: string): Promise<string> {
	const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-YouTube-Client-Name': '3',
			'X-YouTube-Client-Version': '17.31.35',
		},
		body: JSON.stringify({
			videoId,
			context: {
				client: {
					clientName: 'ANDROID',
					clientVersion: '17.31.35',
					androidSdkVersion: 30,
					userAgent: 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip'
				}
			}
		})
	});

	if (!res.ok) throw new Error(`innertube ${res.status}`);
	const data = await res.json();

	// `formats` are muxed (video+audio) — prefer these for simple <video> playback
	const formats: YtFormat[] = data.streamingData?.formats ?? [];
	const direct = formats
		.filter((f) => f.url && f.mimeType.startsWith('video/'))
		.sort((a, b) => b.bitrate - a.bitrate);

	if (!direct.length) throw new Error('No direct stream URL in innertube response');
	return direct[0].url!;
}
