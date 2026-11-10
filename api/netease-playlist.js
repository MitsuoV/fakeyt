const NETEASE_ORIGIN = 'https://music.163.com';
const MAX_TRACKS = 500;

async function requestJson(path, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${NETEASE_ORIGIN}${path}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Referer: `${NETEASE_ORIGIN}/`
      }
    });
    if (!response.ok) throw new Error(`NetEase returned ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' });
  const id = String(request.query?.id || '');
  if (!/^\d{1,20}$/.test(id)) return response.status(400).json({ error: 'Enter a valid NetEase playlist link.' });

  try {
    const data = await requestJson(`/api/v6/playlist/detail?id=${id}`);
    const playlist = data?.playlist;
    if (Number(data?.code) !== 200 || !playlist || String(playlist.id) !== id) {
      return response.status(404).json({ error: 'That playlist is unavailable or private.' });
    }
    const sourceIds = Array.isArray(playlist.trackIds) && playlist.trackIds.length
      ? playlist.trackIds
      : Array.isArray(playlist.tracks) ? playlist.tracks : [];
    const ids = sourceIds
      .map((item) => String(item?.id || ''))
      .filter((trackId) => /^\d{1,20}$/.test(trackId))
      .slice(0, MAX_TRACKS);
    if (!ids.length) return response.status(422).json({ error: 'No playable track details were available for that playlist.' });

    const chunks = [];
    for (let offset = 0; offset < ids.length; offset += 100) chunks.push(ids.slice(offset, offset + 100));
    const detailResponses = await Promise.all(chunks.map((chunk) => requestJson(`/api/v3/song/detail?ids=${encodeURIComponent(JSON.stringify(chunk))}`)));
    const details = detailResponses.flatMap((result) => {
      if (Number(result?.code) !== 200 || !Array.isArray(result?.songs)) throw new Error('NetEase could not return the playlist songs.');
      return result.songs;
    });
    const tracksById = new Map(details.map((song) => [String(song.id), {
        id: String(song.id),
        name: String(song.name || '').slice(0, 240),
        artists: (song.ar || song.artists || []).map((artist) => String(artist.name || '').slice(0, 100)).filter(Boolean),
        album: String(song.al?.name || song.album?.name || '').slice(0, 200),
        duration: Number(song.dt || song.duration || 0),
        cover: String(song.al?.picUrl || song.album?.picUrl || '')
      }]));
    const tracks = ids.map((trackId) => tracksById.get(trackId)).filter((track) => track?.name);
    const requested = ids.length;
    if (tracks.length < Math.min(requested, 1)) return response.status(422).json({ error: 'NetEase did not provide any usable songs for that playlist.' });
    return response.status(200).json({
      playlist: { id, name: String(playlist.name || 'NetEase playlist').slice(0, 200), cover: String(playlist.coverImgUrl || '') },
      tracks,
      total: Number(playlist.trackCount || ids.length),
      importedCount: tracks.length,
      unavailableCount: Math.max(0, ids.length - tracks.length),
      truncated: Number(playlist.trackCount || ids.length) > MAX_TRACKS
    });
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'NetEase took too long to respond. Try again in a moment.'
      : error.message || 'Could not read that NetEase playlist.';
    return response.status(502).json({ error: message });
  }
};

