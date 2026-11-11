const LRCLIB_API = 'https://lrclib.net/api';
const CLIENT_ID = 'Fakeyt/1.0 (https://github.com/MitsuoV/fakeyt)';

async function fetchLyrics(path) {
  const response = await fetch(`${LRCLIB_API}${path}`, {
    headers: { 'User-Agent': CLIENT_ID }
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' });

  const title = String(request.query?.title || '').trim().slice(0, 200);
  const artist = String(request.query?.artist || '').trim().slice(0, 160);
  const duration = Number(request.query?.duration);
  if (!title || !artist) return response.status(400).json({ error: 'A track title and artist are required.' });

  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  if (Number.isFinite(duration) && duration >= 1 && duration <= 3600) params.set('duration', String(Math.round(duration)));

  try {
    if (params.has('duration')) {
      const exact = await fetchLyrics(`/get?${params.toString()}`);
      if (exact.response.ok && exact.body) {
        response.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
        return response.status(200).json({ record: exact.body, candidates: [] });
      }
      if (exact.response.status === 429) {
        const retryAfter = exact.response.headers.get('retry-after');
        if (retryAfter) response.setHeader('Retry-After', retryAfter);
        return response.status(429).json({ error: 'Lyrics lookup is temporarily rate limited. Try again shortly.' });
      }
      if (!exact.response.ok && exact.response.status !== 404) {
        return response.status(502).json({ error: 'The lyrics service could not complete the lookup.' });
      }
    }

    const searchParams = new URLSearchParams({ track_name: title, artist_name: artist });
    const search = await fetchLyrics(`/search?${searchParams.toString()}`);
    if (search.response.status === 429) {
      const retryAfter = search.response.headers.get('retry-after');
      if (retryAfter) response.setHeader('Retry-After', retryAfter);
      return response.status(429).json({ error: 'Lyrics lookup is temporarily rate limited. Try again shortly.' });
    }
    if (!search.response.ok || !Array.isArray(search.body)) {
      return response.status(502).json({ error: 'The lyrics service could not complete the lookup.' });
    }

    response.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
    return response.status(200).json({ record: null, candidates: search.body });
  } catch {
    return response.status(502).json({ error: 'Could not reach the lyrics service.' });
  }
};
