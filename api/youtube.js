const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

function addIfPresent(searchParams, key, value) {
  if (value !== undefined && value !== null && value !== '') searchParams.set(key, value);
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });

  const query = request.query || {};
  const action = query.action || 'search';
  const accessToken = request.headers.authorization || '';
  const apiKey = process.env.YOUTUBE_API_KEY;
  const requiresUser = action === 'playlists';

  if (!accessToken && !apiKey) return response.status(500).json({ error: 'YOUTUBE_API_KEY is not configured in Vercel.' });
  if (requiresUser && !accessToken) return response.status(401).json({ error: 'Google connection required.' });

  let resource = 'search';
  const params = new URLSearchParams({ part: 'snippet' });

  if (action === 'search') {
    const kind = query.kind || 'music';
    resource = 'search';
    addIfPresent(params, 'type', kind === 'playlists' ? 'playlist' : kind === 'channels' ? 'channel' : 'video');
    addIfPresent(params, 'q', query.q);
    addIfPresent(params, 'maxResults', query.maxResults || '12');
    addIfPresent(params, 'pageToken', query.pageToken);
    addIfPresent(params, 'relatedToVideoId', query.relatedToVideoId);
    if (kind === 'music') params.set('videoCategoryId', '10');
  } else if (action === 'trending') {
    resource = 'videos';
    params.set('part', 'snippet,contentDetails');
    params.set('chart', 'mostPopular');
    params.set('videoCategoryId', '10');
    addIfPresent(params, 'regionCode', query.regionCode || 'SG');
    addIfPresent(params, 'maxResults', query.maxResults || '12');
  } else if (action === 'playlist') {
    resource = 'playlistItems';
    params.set('part', 'snippet,contentDetails');
    addIfPresent(params, 'playlistId', query.playlistId);
    addIfPresent(params, 'maxResults', query.maxResults || '50');
    addIfPresent(params, 'pageToken', query.pageToken);
  } else if (action === 'playlists') {
    resource = 'playlists';
    params.set('part', 'snippet,contentDetails');
    params.set('mine', 'true');
    addIfPresent(params, 'maxResults', query.maxResults || '50');
    addIfPresent(params, 'pageToken', query.pageToken);
  } else {
    return response.status(400).json({ error: 'Unsupported YouTube action.' });
  }

  if (!accessToken) params.set('key', apiKey);
  try {
    const upstream = await fetch(`${YOUTUBE_API}/${resource}?${params.toString()}`, { headers: accessToken ? { Authorization: accessToken } : {} });
    const body = await upstream.json();
    return response.status(upstream.status).json(body);
  } catch (error) {
    return response.status(502).json({ error: 'Could not reach YouTube.', detail: error.message });
  }
};

