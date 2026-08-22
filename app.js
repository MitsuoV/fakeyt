const STORAGE_KEY = 'lowkey-state-v4';
const SCOPES = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl';
const $ = (selector) => document.querySelector(selector);
const resultsList = $('#resultsList');
const queueList = $('#queueList');
let searchTimer;
let player = null;
let playerReady = false;
let tokenClient = null;
let progressTimer = null;
let isPlaying = false;
let currentTrack = null;
let currentKind = 'music';
let currentResults = [];
let nextPageToken = '';
let lastQuery = '';

function getSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { clientId: saved.clientId || '', accessToken: saved.accessToken || '', queue: Array.isArray(saved.queue) ? saved.queue : [], favorites: Array.isArray(saved.favorites) ? saved.favorites : [], history: Array.isArray(saved.history) ? saved.history : [], notes: saved.notes || {}, playlists: Array.isArray(saved.playlists) ? saved.playlists : [] };
  } catch { return { clientId: '', accessToken: '', queue: [], favorites: [], history: [], notes: {}, playlists: [] }; }
}

const state = getSavedState();

function saveState() { const { apiKey, ...safeState } = state; localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState)); }
function trackKey(track) { return track?.videoId || `${track?.title || ''}::${track?.artist || ''}`; }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character])); }
function formatSeconds(seconds) { if (!Number.isFinite(seconds)) return '0:00'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible'); window.clearTimeout(showToast.timeout); showToast.timeout = window.setTimeout(() => toast.classList.remove('visible'), 2600); }
function hasApiKey() { return true; }
function hasGoogleConnection() { return Boolean(state.accessToken); }

function thumbnailMarkup(item) { return item.thumbnail ? `<img src="${escapeHtml(item.thumbnail)}" alt="" />` : '<span>♫</span>'; }

function renderSetupState(message = 'Add your YouTube API key in Settings to browse live results.') {
  resultsList.innerHTML = `<div class="browse-empty"><span class="empty-glyph">⌕</span><h3>Connect the catalog.</h3><p>${escapeHtml(message)}</p><button class="primary-button" id="openSettingsFromEmpty">Open settings</button></div>`;
  $('#openSettingsFromEmpty')?.addEventListener('click', openSettings);
  $('#loadMore').hidden = true;
}

function renderResults(items = currentResults) {
  currentResults = items;
  if (!items.length) { resultsList.innerHTML = '<div class="browse-empty"><span class="empty-glyph">∅</span><h3>No results found.</h3><p>Try a different search or choose another result type.</p></div>'; $('#loadMore').hidden = true; return; }
  resultsList.innerHTML = items.map((item, index) => {
    const isVideo = item.kind === 'video';
    const action = isVideo ? `<button class="result-action play-result" data-result-index="${index}" aria-label="Play ${escapeHtml(item.title)}">▶</button><button class="result-action add-result" data-add-index="${index}" aria-label="Add ${escapeHtml(item.title)} to queue">＋</button>` : item.kind === 'playlist' ? `<button class="result-action open-playlist" data-playlist-id="${escapeHtml(item.playlistId)}" data-playlist-title="${escapeHtml(item.title)}" aria-label="Open ${escapeHtml(item.title)}">↗</button>` : `<a class="result-action" href="https://www.youtube.com/channel/${encodeURIComponent(item.channelId)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(item.title)} on YouTube">↗</a>`;
    const kindLabel = item.kind === 'video' ? 'VIDEO' : item.kind === 'playlist' ? 'PLAYLIST' : 'CHANNEL';
    return `<article class="result-card"><div class="result-thumb art-${escapeHtml(item.tone || 'blue')}">${thumbnailMarkup(item)}</div><div class="result-copy"><span class="result-kind">${kindLabel}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.artist || item.description || '')}</p></div><div class="result-actions">${action}</div></article>`;
  }).join('');
  $('#loadMore').hidden = !nextPageToken;
}

function renderQueue() {
  saveState();
  queueList.innerHTML = state.queue.length ? state.queue.map((item, index) => `<div class="queue-row" data-queue-index="${index}"><div class="queue-thumb art-${escapeHtml(item.tone || 'blue')}">${thumbnailMarkup(item)}</div><div class="queue-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.artist || 'YouTube')}</small></div><button class="queue-remove" data-remove-index="${index}" aria-label="Remove ${escapeHtml(item.title)} from queue">×</button></div>`).join('') : '<p class="empty-queue">Your queue is empty.</p>';
}

function renderPlaylists() {
  const container = $('#remotePlaylists');
  container.innerHTML = state.playlists.map((playlist) => `<button class="playlist-link" data-remote-playlist="${escapeHtml(playlist.id)}" data-playlist-title="${escapeHtml(playlist.title)}"><span class="playlist-dot mint"></span>${escapeHtml(playlist.title)}</button>`).join('');
  $('#playlistEmpty').hidden = state.playlists.length > 0;
}

function renderLibrary() {
  const favorites = state.history.map((entry) => entry.track).filter((item) => state.favorites.includes(trackKey(item)));
  const history = state.history.map((entry) => entry.track);
  const renderSaved = (items, empty) => items.length ? items.slice(0, 20).map((item) => `<button class="saved-item" data-saved-video="${escapeHtml(item.videoId || '')}"><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.artist || 'YouTube')}</small></button>`).join('') : `<p class="saved-empty">${empty}</p>`;
  $('#favoritesList').innerHTML = renderSaved(favorites, 'No favorites yet.');
  $('#historyList').innerHTML = renderSaved(history, 'Your listening history will appear here.');
}

function setConnectionState() {
  const connected = hasGoogleConnection();
  $('#connectionLabel').textContent = connected ? 'Google connected' : hasApiKey() ? 'Search ready' : 'Not connected';
  $('#syncTitle').textContent = connected ? 'Google connected' : hasApiKey() ? 'Search ready' : 'Setup needed';
  $('#syncSubtitle').textContent = connected ? 'Playlists available' : hasApiKey() ? 'Add Google access for playlists' : 'Add your API key';
  $('#settingsStatus').textContent = connected ? 'Connected to Google. Your playlists are ready to import.' : hasApiKey() ? 'API key saved. Google access is not connected.' : 'Not connected yet.';
}

function updateCurrentUI() {
  const controls = ['#playPause', '#noteCurrent', '#favoriteCurrent'];
  controls.forEach((selector) => { $(selector).disabled = !currentTrack?.videoId; });
  $('#nowTitle').textContent = currentTrack?.title || 'Nothing selected';
  $('#nowArtist').textContent = currentTrack?.artist || 'Search YouTube to begin';
  $('#nowThumb').innerHTML = currentTrack ? thumbnailMarkup(currentTrack) : '<span>♪</span>';
  const liked = currentTrack && state.favorites.includes(trackKey(currentTrack));
  $('#favoriteCurrent').textContent = liked ? '♥' : '♡';
  $('#favoriteCurrent').classList.toggle('liked', Boolean(liked));
}

function setCurrent(track, announce = true) {
  if (!track) return;
  currentTrack = track; updateCurrentUI();
  if (!state.history.some((entry) => trackKey(entry.track) === trackKey(track))) state.history.unshift({ track, playedAt: new Date().toISOString() });
  state.history = state.history.slice(0, 50); saveState(); renderLibrary();
  if (announce) showToast(`Playing “${track.title}”`);
}

function loadScript(src, id) {
  return new Promise((resolve, reject) => { if (document.getElementById(id)) return resolve(); const script = document.createElement('script'); script.id = id; script.src = src; script.onload = resolve; script.onerror = reject; document.head.appendChild(script); });
}

function startProgressTimer() {
  window.clearInterval(progressTimer); progressTimer = window.setInterval(() => { if (!playerReady || !player) return; const current = player.getCurrentTime(); const duration = player.getDuration(); const fill = $('.player-progress .progress-fill'); if (fill && duration) fill.style.width = `${(current / duration) * 100}%`; const labels = document.querySelectorAll('.player-progress span'); if (labels.length === 2) { labels[0].textContent = formatSeconds(current); labels[1].textContent = formatSeconds(duration); } }, 1000);
}

function ensurePlayer() {
  if (playerReady) return Promise.resolve();
  return new Promise((resolve, reject) => { const createPlayer = () => { player = new window.YT.Player('youtubePlayer', { height: '1', width: '1', videoId: '', playerVars: { controls: 0, playsinline: 1, rel: 0 }, events: { onReady: () => { playerReady = true; resolve(); }, onStateChange: (event) => { if (event.data === window.YT.PlayerState.PLAYING) { isPlaying = true; $('#playPause').textContent = '❚❚'; startProgressTimer(); } if (event.data === window.YT.PlayerState.PAUSED) { isPlaying = false; $('#playPause').textContent = '▶'; } if (event.data === window.YT.PlayerState.ENDED) nextTrack(); } } }); }; if (window.YT?.Player) createPlayer(); else { const oldReady = window.onYouTubeIframeAPIReady; window.onYouTubeIframeAPIReady = () => { oldReady?.(); createPlayer(); }; loadScript('https://www.youtube.com/iframe_api', 'youtube-iframe-api').catch(reject); } });
}

async function playTrack(track) {
  if (!track?.videoId) return showToast('That result cannot be played here.');
  setCurrent(track, false);
  try { await ensurePlayer(); player.loadVideoById(track.videoId); player.playVideo(); showToast(`Playing “${track.title}”`); } catch { showToast('The official YouTube player could not load.'); }
}

function nextTrack() { if (state.queue.length) { const next = state.queue.shift(); renderQueue(); playTrack(next); } else showToast('Your queue is empty. Add a result to keep listening.'); }
function previousTrack() { if (playerReady && player.getCurrentTime() > 5) return player.seekTo(0); const previous = state.history[1]?.track; if (previous) playTrack(previous); else showToast('No previous track yet.'); }

async function apiGet(endpoint, authenticated = false) {
  const upstream = new URL(endpoint);
  const action = upstream.pathname.endsWith('/search') ? 'search' : upstream.searchParams.get('chart') ? 'trending' : upstream.pathname.endsWith('/playlistItems') ? 'playlist' : upstream.pathname.endsWith('/playlists') ? 'playlists' : 'search';
  const params = new URLSearchParams(upstream.search);
  params.set('action', action);
  const headers = authenticated ? { Authorization: `Bearer ${state.accessToken}` } : {};
  const response = await fetch(`/api/youtube?${params.toString()}`, { headers });
  if (response.status === 401) { state.accessToken = ''; saveState(); setConnectionState(); }
  if (!response.ok) throw new Error('YouTube request failed');
  return response.json();
}

function mapSearchResult(item) {
  if (item.id?.videoId) return { kind: 'video', videoId: item.id.videoId, title: item.snippet.title, artist: item.snippet.channelTitle, thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url, tone: 'blue' };
  if (item.id?.playlistId) return { kind: 'playlist', playlistId: item.id.playlistId, title: item.snippet.title, artist: item.snippet.channelTitle, thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url, tone: 'coral' };
  return { kind: 'channel', channelId: item.id?.channelId, title: item.snippet.title, artist: 'Channel', description: item.snippet.description, thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url, tone: 'yellow' };
}

async function searchYouTube(reset = true) {
  if (!hasApiKey()) return renderSetupState();
  const query = $('#searchInput').value.trim();
  if (!query) return loadTrending();
  if (reset) { nextPageToken = ''; currentResults = []; resultsList.innerHTML = '<div class="browse-empty"><span class="loading-mark">◌</span><h3>Searching…</h3><p>Finding the good stuff.</p></div>'; }
  const type = currentKind === 'playlists' ? 'playlist' : currentKind === 'channels' ? 'channel' : 'video';
  try {
    let endpoint = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=${type}&maxResults=12&q=${encodeURIComponent(query)}&pageToken=${encodeURIComponent(nextPageToken)}`;
    if (currentKind === 'music') endpoint += '&videoCategoryId=10';
    const data = await apiGet(endpoint); const results = (data.items || []).map(mapSearchResult); nextPageToken = data.nextPageToken || ''; lastQuery = query; $('#resultsHeading').textContent = `Results for “${query}”`; $('#resultsEyebrow').textContent = currentKind === 'music' ? 'YouTube music' : currentKind; $('#resultsMeta').textContent = `${results.length} loaded`; renderResults(reset ? results : [...currentResults, ...results]);
  } catch { resultsList.innerHTML = '<div class="browse-empty"><span class="empty-glyph">!</span><h3>Search is unavailable.</h3><p>Check your API key, quota, and YouTube Data API v3 settings.</p></div>'; $('#loadMore').hidden = true; }
}

async function loadTrending() {
  if (!hasApiKey()) return renderSetupState();
  resultsList.innerHTML = '<div class="browse-empty"><span class="loading-mark">◌</span><h3>Loading music…</h3><p>Fetching what is moving right now.</p></div>';
  try { const region = $('#regionSelect').value; const data = await apiGet(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&chart=mostPopular&videoCategoryId=10&regionCode=${region}&maxResults=12`); const results = (data.items || []).map((item) => ({ kind: 'video', videoId: item.id, title: item.snippet.title, artist: item.snippet.channelTitle, thumbnail: item.snippet.thumbnails?.medium?.url, tone: 'blue' })); nextPageToken = ''; $('#resultsEyebrow').textContent = 'Popular right now'; $('#resultsHeading').textContent = 'Trending music'; $('#resultsMeta').textContent = `${region} · ${results.length} loaded`; renderResults(results); } catch { renderSetupState('Trending music could not load. Check your API key and quota.'); }
}

async function openPlaylist(playlistId, title) {
  if (!hasApiKey()) return renderSetupState();
  resultsList.innerHTML = `<div class="browse-empty"><span class="loading-mark">◌</span><h3>Opening ${escapeHtml(title)}…</h3></div>`;
  try { const data = await apiGet(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(playlistId)}&maxResults=50`); const results = (data.items || []).filter((item) => item.snippet?.resourceId?.videoId).map((item) => ({ kind: 'video', videoId: item.snippet.resourceId.videoId, title: item.snippet.title, artist: item.snippet.videoOwnerChannelTitle || 'YouTube', thumbnail: item.snippet.thumbnails?.medium?.url, tone: 'coral' })); $('#resultsHeading').textContent = title; $('#resultsEyebrow').textContent = 'Playlist'; $('#resultsMeta').textContent = `${results.length} tracks`; nextPageToken = ''; renderResults(results); } catch { showToast('Could not open that playlist.'); }
}

async function importPlaylists() {
  if (!hasGoogleConnection()) return showToast('Connect Google before importing playlists.');
  try { const data = await apiGet('https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50', true); state.playlists = (data.items || []).map((item) => ({ id: item.id, title: item.snippet.title, count: item.contentDetails.itemCount })); saveState(); renderPlaylists(); showToast(`${state.playlists.length} playlists imported`); } catch { showToast('Could not import your playlists.'); }
}

async function connectGoogle() {
  if (!state.clientId) return showToast('Add your Google OAuth client ID first.');
  try { await loadScript('https://accounts.google.com/gsi/client', 'google-identity-services'); tokenClient = window.google.accounts.oauth2.initTokenClient({ client_id: state.clientId, scope: SCOPES, callback: async (response) => { if (response.error) return showToast(`Google connection failed: ${response.error}`); state.accessToken = response.access_token; saveState(); setConnectionState(); showToast('Google connected.'); await importPlaylists(); } }); tokenClient.requestAccessToken({ prompt: state.accessToken ? '' : 'consent' }); } catch { showToast('Google sign-in could not load.'); }
}

function toggleFavorite() { if (!currentTrack) return showToast('Play a result before saving it.'); const key = trackKey(currentTrack); state.favorites = state.favorites.includes(key) ? state.favorites.filter((item) => item !== key) : [...state.favorites, key]; saveState(); updateCurrentUI(); renderLibrary(); showToast(state.favorites.includes(key) ? 'Saved to favorites.' : 'Removed from favorites.'); }
function addNote() { if (!currentTrack) return; const key = trackKey(currentTrack); const note = window.prompt(`Note for “${currentTrack.title}”`, state.notes[key] || ''); if (note === null) return; if (note.trim()) state.notes[key] = note.trim(); else delete state.notes[key]; saveState(); showToast(note.trim() ? 'Note saved on this device.' : 'Note removed.'); }
function openSettings() { $('#clientIdInput').value = state.clientId; setConnectionState(); $('#settingsModal').hidden = false; $('#clientIdInput').focus(); }
function closeSettings() { $('#settingsModal').hidden = true; }
function showView(view) { $('#libraryPanel').hidden = view !== 'library'; document.querySelector('.browse-grid').hidden = view === 'library'; $('.browse-hero').hidden = view === 'library'; $('.browse-toolbar').hidden = view === 'library'; $('#breadcrumbTitle').textContent = view[0].toUpperCase() + view.slice(1); if (view === 'library') renderLibrary(); if (view === 'home') { $('#libraryPanel').hidden = false; $('.browse-hero').hidden = false; $('.browse-toolbar').hidden = true; document.querySelector('.browse-grid').hidden = false; $('#resultsHeading').textContent = 'Your listening space'; renderSetupState('Search YouTube to start building your personal library.'); } }

renderQueue(); renderPlaylists(); renderLibrary(); setConnectionState(); updateCurrentUI();
if (hasApiKey()) loadTrending(); else renderSetupState();

trackListSetup();
function trackListSetup() {
  resultsList.addEventListener('click', (event) => { const play = event.target.closest('[data-result-index]'); const add = event.target.closest('[data-add-index]'); const playlist = event.target.closest('[data-playlist-id]'); if (play) playTrack(currentResults[Number(play.dataset.resultIndex)]); if (add) { state.queue.push(currentResults[Number(add.dataset.addIndex)]); renderQueue(); showToast('Added to queue.'); } if (playlist) openPlaylist(playlist.dataset.playlistId, playlist.dataset.playlistTitle); });
  queueList.addEventListener('click', (event) => { const remove = event.target.closest('[data-remove-index]'); if (remove) { state.queue.splice(Number(remove.dataset.removeIndex), 1); renderQueue(); } });
}

$('#searchInput').addEventListener('input', () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => searchYouTube(true), 500); });
$('#searchSubmit').addEventListener('click', () => searchYouTube(true));
$('#loadMore').addEventListener('click', () => searchYouTube(false));
$('#regionSelect').addEventListener('change', loadTrending);
document.querySelectorAll('.browse-tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.browse-tab').forEach((item) => { item.classList.remove('active'); item.setAttribute('aria-selected', 'false'); }); tab.classList.add('active'); tab.setAttribute('aria-selected', 'true'); currentKind = tab.dataset.kind; if ($('#searchInput').value.trim()) searchYouTube(true); else loadTrending(); }));
$('#playPause').addEventListener('click', async () => { if (!currentTrack) return; try { await ensurePlayer(); if (isPlaying) player.pauseVideo(); else player.playVideo(); } catch { showToast('The official player could not load.'); } });
$('#next').addEventListener('click', nextTrack); $('#previous').addEventListener('click', previousTrack); $('#clearQueue').addEventListener('click', () => { state.queue = []; renderQueue(); showToast('Queue cleared.'); }); $('#addQueue').addEventListener('click', () => { if (currentResults[0]) { state.queue.push(currentResults[0]); renderQueue(); showToast('Added to queue.'); } else showToast('Search for a result first.'); }); $('#queueToggle').addEventListener('click', () => document.querySelector('.secondary-column').scrollIntoView({ behavior: 'smooth', block: 'center' }));
$('#favoriteCurrent').addEventListener('click', toggleFavorite); $('#noteCurrent').addEventListener('click', addNote); $('#settingsButton').addEventListener('click', openSettings); $('#topProfile').addEventListener('click', openSettings); $('#settingsClose').addEventListener('click', closeSettings); document.querySelector('[data-close-settings]').addEventListener('click', closeSettings); $('#importShortcut').addEventListener('click', importPlaylists);
$('#saveSettings').addEventListener('click', () => { state.clientId = $('#clientIdInput').value.trim(); saveState(); setConnectionState(); showToast('Connection settings saved.'); loadTrending(); }); $('#connectGoogle').addEventListener('click', () => { state.clientId = $('#clientIdInput').value.trim(); saveState(); connectGoogle(); }); $('#importPlaylists').addEventListener('click', importPlaylists);
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active')); button.classList.add('active'); showView(button.dataset.view); })); document.querySelector('.dismiss-note').addEventListener('click', (event) => event.currentTarget.closest('.mini-note').remove());
document.addEventListener('keydown', (event) => { if (event.target.matches('input, textarea, button')) return; if (event.code === 'Space') { event.preventDefault(); $('#playPause').click(); } if (event.code === 'ArrowRight') nextTrack(); if (event.code === 'ArrowLeft') previousTrack(); });

