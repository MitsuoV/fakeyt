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
let pickerTrack = null;
let menuTrack = null;
let recommendationItems = [];
let recommendationSeed = null;
let currentView = 'home';
let requestSerial = 0;
const discoverySeeds = ['new music', 'indie pop', 'lofi beats', 'electronic music', 'jazz', 'r&b', 'ambient music', 'alternative rock'];

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

function renderRecommendations(items = []) {
  recommendationItems = items;
  const list = $('#recommendationList');
  list.innerHTML = items.length ? items.map((item, index) => `<article class="recommendation-card"><div class="recommendation-thumb">${thumbnailMarkup(item)}</div><div class="recommendation-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.artist || 'YouTube')}</small></div><button class="result-action play-recommendation" data-recommendation-index="${index}" aria-label="Play ${escapeHtml(item.title)}">▶</button><button class="result-action add-recommendation" data-recommendation-add-index="${index}" aria-label="Add ${escapeHtml(item.title)} to queue">＋</button></article>`).join('') : '<div class="recommendation-empty">Play or search for a track to get recommendations.</div>';
}

async function loadRecommendations(seed) {
  if (!hasApiKey()) return;
  const source = seed || currentTrack || currentResults.find((item) => item.kind === 'video') || state.history[0]?.track;
  if (!source?.videoId) return;
  recommendationSeed = source;
  try {
    const data = await apiGet(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=6&relatedToVideoId=${encodeURIComponent(source.videoId)}&videoCategoryId=10`);
    renderRecommendations((data.items || []).filter((item) => item.id?.videoId).map((item) => ({ ...mapSearchResult(item), kind: 'video' })));
  } catch { /* Keep the last successful recommendations visible. */ }
}

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
    const action = isVideo ? `<button class="result-menu-trigger" data-menu-index="${index}" aria-label="More options for ${escapeHtml(item.title)}">•••</button>` : item.kind === 'playlist' ? `<button class="result-action open-playlist" data-playlist-id="${escapeHtml(item.playlistId)}" data-playlist-title="${escapeHtml(item.title)}" aria-label="Open ${escapeHtml(item.title)}">↗</button>` : `<a class="result-action" href="https://www.youtube.com/channel/${encodeURIComponent(item.channelId)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(item.title)} on YouTube">↗</a>`;
    const kindLabel = item.kind === 'video' ? 'VIDEO' : item.kind === 'playlist' ? 'PLAYLIST' : 'CHANNEL';
    return `<article class="result-card" data-result-card-index="${index}"><div class="result-thumb art-${escapeHtml(item.tone || 'blue')}">${thumbnailMarkup(item)}</div><div class="result-copy"><span class="result-kind">${kindLabel}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.artist || item.description || '')}</p></div><div class="result-actions">${action}</div></article>`;
  }).join('');
  $('#loadMore').hidden = !nextPageToken;
}

function renderQueue() {
  saveState();
  queueList.innerHTML = state.queue.length ? state.queue.map((item, index) => `<div class="queue-row" data-queue-index="${index}"><div class="queue-thumb art-${escapeHtml(item.tone || 'blue')}">${thumbnailMarkup(item)}</div><div class="queue-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.artist || 'YouTube')}</small></div><button class="queue-remove" data-remove-index="${index}" aria-label="Remove ${escapeHtml(item.title)} from queue">×</button></div>`).join('') : '<p class="empty-queue">Your queue is empty.</p>';
}

function renderPlaylists() {
  const container = $('#remotePlaylists');
  const localPlaylists = state.playlists.filter((playlist) => playlist.local);
  container.innerHTML = localPlaylists.map((playlist) => `<button class="playlist-link" data-local-playlist="${escapeHtml(playlist.id)}" data-playlist-title="${escapeHtml(playlist.title)}"><span class="playlist-dot yellow"></span>${escapeHtml(playlist.title)}</button>`).join('');
  $('#playlistEmpty').hidden = localPlaylists.length > 0;
}

function createLocalPlaylist(title) {
  const clean = title.trim();
  if (!clean) return;
  state.playlists.unshift({ id: `local-${Date.now()}`, title: clean, local: true, tracks: [] });
  saveState(); renderPlaylists(); renderLibrary(); showToast(`“${clean}” created.`);
}

function createPlaylistFromPrompt() {
  const title = window.prompt('Name your new playlist');
  if (title?.trim()) createLocalPlaylist(title);
}

function openLocalPlaylist(id, title) {
  const playlist = state.playlists.find((item) => item.id === id);
  const tracks = playlist?.tracks || [];
  $('#resultsHeading').textContent = title;
  $('#resultsEyebrow').textContent = 'Your playlist';
  $('#resultsMeta').textContent = `${tracks.length} tracks`;
  nextPageToken = '';
  renderResults(tracks);
}

function renderPlaylistPicker() {
  const localPlaylists = state.playlists.filter((playlist) => playlist.local);
  $('#playlistPickerList').innerHTML = localPlaylists.length ? localPlaylists.map((playlist) => `<button class="playlist-pick-item" data-pick-playlist="${escapeHtml(playlist.id)}"><span>${escapeHtml(playlist.title)}</span><small>${(playlist.tracks || []).length} tracks</small></button>`).join('') : '<p class="saved-empty">No personal playlists yet.</p>';
}

function openPlaylistPicker(track) {
  if (!track) return;
  pickerTrack = track;
  $('#playlistPickerTrack').textContent = `Choose where to save “${track.title}”.`;
  $('#newPlaylistName').value = '';
  renderPlaylistPicker();
  $('#playlistPicker').hidden = false;
}

function closePlaylistPicker() { $('#playlistPicker').hidden = true; pickerTrack = null; }

function closeTrackMenu() { $('#trackMenu').hidden = true; menuTrack = null; }

function openTrackMenu(track, trigger) {
  if (!track) return;
  menuTrack = track;
  const menu = $('#trackMenu');
  const bounds = trigger.getBoundingClientRect();
  menu.hidden = false;
  menu.style.top = `${Math.min(window.innerHeight - 112, bounds.bottom + 8)}px`;
  menu.style.left = `${Math.max(12, Math.min(window.innerWidth - 190, bounds.right - 178))}px`;
}

function addToLocalPlaylist(id) {
  const playlist = state.playlists.find((item) => item.id === id);
  if (!playlist || !pickerTrack) return;
  playlist.tracks = playlist.tracks || [];
  if (!playlist.tracks.some((track) => trackKey(track) === trackKey(pickerTrack))) playlist.tracks.push(pickerTrack);
  saveState(); renderPlaylists(); closePlaylistPicker(); showToast(`Added to “${playlist.title}”.`);
}

function renderLibrary() {
  const localPlaylists = state.playlists.filter((playlist) => playlist.local);
  $('#libraryPlaylists').innerHTML = localPlaylists.length ? localPlaylists.map((playlist) => `<button class="library-playlist-card" data-library-playlist="${escapeHtml(playlist.id)}" data-playlist-title="${escapeHtml(playlist.title)}"><span class="library-playlist-art">♫</span><span class="library-playlist-copy"><strong>${escapeHtml(playlist.title)}</strong><small>${(playlist.tracks || []).length} ${(playlist.tracks || []).length === 1 ? 'song' : 'songs'}</small></span><span class="library-playlist-arrow">›</span></button>`).join('') : '<div class="library-empty"><span>＋</span><strong>Your library is empty.</strong><p>Create a playlist and start collecting songs.</p><button class="primary-button" id="createFirstPlaylist">Create playlist</button></div>';
  $('#createFirstPlaylist')?.addEventListener('click', createPlaylistFromPrompt);
}

function setConnectionState() {
  $('#connectionLabel').textContent = 'Local library';
  $('#syncTitle').textContent = 'Local mode';
  $('#syncSubtitle').textContent = 'Saved on this device';
  $('#settingsStatus').textContent = 'Local mode is ready.';
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
  loadRecommendations(track);
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
  if (!query) return currentView === 'home' ? loadTrending() : clearBrowseView();
  if (currentView !== 'browse') setActiveView('browse');
  document.querySelector('.browse-grid').hidden = false;
  const requestId = ++requestSerial;
  if (reset) { nextPageToken = ''; currentResults = []; resultsList.innerHTML = '<div class="browse-empty"><span class="loading-mark">◌</span><h3>Searching…</h3><p>Finding the good stuff.</p></div>'; }
  const type = 'video';
  try {
    let endpoint = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=${type}&maxResults=12&q=${encodeURIComponent(query)}&pageToken=${encodeURIComponent(nextPageToken)}`;
    endpoint += '&videoCategoryId=10';
    const data = await apiGet(endpoint); if (requestId !== requestSerial || currentView !== 'browse') return; const results = (data.items || []).map(mapSearchResult); nextPageToken = data.nextPageToken || ''; lastQuery = query; $('#resultsHeading').textContent = `Results for “${query}”`; $('#resultsEyebrow').textContent = 'Search results'; $('#resultsMeta').textContent = `${results.length} loaded`; renderResults(reset ? results : [...currentResults, ...results]); if (reset) loadRecommendations(results.find((item) => item.kind === 'video'));
  } catch { if (requestId !== requestSerial || currentView !== 'browse') return; resultsList.innerHTML = '<div class="browse-empty"><span class="empty-glyph">!</span><h3>Search is unavailable.</h3><p>Search could not load right now. Try again in a moment.</p></div>'; $('#loadMore').hidden = true; }
}

async function loadTrending() {
  if (!hasApiKey()) return renderSetupState();
  const requestId = ++requestSerial;
  resultsList.innerHTML = '<div class="browse-empty"><span class="loading-mark">◌</span><h3>Loading music…</h3><p>Fetching what is moving right now.</p></div>';
  try { const seed = discoverySeeds[Math.floor(Math.random() * discoverySeeds.length)]; const data = await apiGet(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=12&q=${encodeURIComponent(seed)}&order=relevance`); if (requestId !== requestSerial || currentView !== 'home') return; const results = (data.items || []).map(mapSearchResult).filter((item) => item.kind === 'video'); nextPageToken = ''; $('#resultsEyebrow').textContent = `Discovery · ${seed}`; $('#resultsHeading').textContent = 'Trending now'; $('#resultsMeta').textContent = `${results.length} loaded`; renderResults(results); loadRecommendations(results[0]); } catch { if (requestId === requestSerial && currentView === 'home') renderSetupState('Music discovery could not load. Check your API key and quota.'); }
}

async function openPlaylist(playlistId, title) {
  if (!hasApiKey()) return renderSetupState();
  resultsList.innerHTML = `<div class="browse-empty"><span class="loading-mark">◌</span><h3>Opening ${escapeHtml(title)}…</h3></div>`;
  try { const data = await apiGet(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(playlistId)}&maxResults=50`); const results = (data.items || []).filter((item) => item.snippet?.resourceId?.videoId).map((item) => ({ kind: 'video', videoId: item.snippet.resourceId.videoId, title: item.snippet.title, artist: item.snippet.videoOwnerChannelTitle || 'YouTube', thumbnail: item.snippet.thumbnails?.medium?.url, tone: 'coral' })); $('#resultsHeading').textContent = title; $('#resultsEyebrow').textContent = 'Playlist'; $('#resultsMeta').textContent = `${results.length} tracks`; nextPageToken = ''; renderResults(results); } catch { showToast('Could not open that playlist.'); }
}

function toggleFavorite() { if (!currentTrack) return showToast('Play a result before saving it.'); const key = trackKey(currentTrack); state.favorites = state.favorites.includes(key) ? state.favorites.filter((item) => item !== key) : [...state.favorites, key]; saveState(); updateCurrentUI(); renderLibrary(); showToast(state.favorites.includes(key) ? 'Saved to favorites.' : 'Removed from favorites.'); }
function addNote() { if (!currentTrack) return; const key = trackKey(currentTrack); const note = window.prompt(`Note for “${currentTrack.title}”`, state.notes[key] || ''); if (note === null) return; if (note.trim()) state.notes[key] = note.trim(); else delete state.notes[key]; saveState(); showToast(note.trim() ? 'Note saved on this device.' : 'Note removed.'); }
function openSettings() { setConnectionState(); $('#settingsModal').hidden = false; }
function closeSettings() { $('#settingsModal').hidden = true; }
function setActiveView(view) {
  requestSerial += 1;
  currentView = view;
  $('#libraryPanel').hidden = view !== 'library';
  document.querySelector('.browse-grid').hidden = view !== 'home';
  $('.browse-hero').hidden = view !== 'home';
  $('#recommendationsPanel').hidden = view === 'library';
  $('.search-shell').hidden = view !== 'browse';
  $('.topbar').classList.toggle('search-view', view === 'browse');
  $('#breadcrumbTitle').textContent = view === 'library' ? 'Library' : view === 'browse' ? 'Search' : 'Home';
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
}

function clearBrowseView() {
  requestSerial += 1;
  currentResults = [];
  nextPageToken = '';
  $('#resultsEyebrow').textContent = '';
  $('#resultsHeading').textContent = '';
  $('#resultsMeta').textContent = '';
  resultsList.innerHTML = '';
  $('#loadMore').hidden = true;
  renderRecommendations([]);
  document.querySelector('.browse-grid').hidden = true;
}

function showView(view) {
  setActiveView(view);
  if (view === 'home') {
    $('#searchInput').value = '';
    loadTrending();
  } else if (view === 'browse') {
    $('#searchInput').value = '';
    clearBrowseView();
    $('#searchInput').focus();
  } else if (view === 'library') {
    renderLibrary();
  }
}

renderQueue(); renderPlaylists(); renderLibrary(); setConnectionState(); updateCurrentUI(); setActiveView('home');
if (hasApiKey()) loadTrending(); else renderSetupState();

trackListSetup();
function trackListSetup() {
  resultsList.addEventListener('click', (event) => {
    const menu = event.target.closest('[data-menu-index]');
    const playlist = event.target.closest('[data-playlist-id]');
    const card = event.target.closest('[data-result-card-index]');
    if (menu) { event.stopPropagation(); return openTrackMenu(currentResults[Number(menu.dataset.menuIndex)], menu); }
    if (playlist) return openPlaylist(playlist.dataset.playlistId, playlist.dataset.playlistTitle);
    if (card && currentResults[Number(card.dataset.resultCardIndex)]?.kind === 'video') playTrack(currentResults[Number(card.dataset.resultCardIndex)]);
  });
  queueList.addEventListener('click', (event) => { const remove = event.target.closest('[data-remove-index]'); if (remove) { state.queue.splice(Number(remove.dataset.removeIndex), 1); renderQueue(); } });
}

$('#searchInput').addEventListener('input', () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => searchYouTube(true), 500); });
$('#searchSubmit').addEventListener('click', () => searchYouTube(true));
$('#loadMore').addEventListener('click', () => searchYouTube(false));
$('#playPause').addEventListener('click', async () => { if (!currentTrack) return; try { await ensurePlayer(); if (isPlaying) player.pauseVideo(); else player.playVideo(); } catch { showToast('The official player could not load.'); } });
$('#next').addEventListener('click', nextTrack); $('#previous').addEventListener('click', previousTrack);
$('#favoriteCurrent').addEventListener('click', toggleFavorite); $('#noteCurrent').addEventListener('click', addNote); $('#settingsButton').addEventListener('click', openSettings); $('#topProfile').addEventListener('click', openSettings); $('#settingsClose').addEventListener('click', closeSettings); document.querySelector('[data-close-settings]').addEventListener('click', closeSettings);
$('#newPlaylist').addEventListener('click', createPlaylistFromPrompt); $('#newPlaylistLibrary').addEventListener('click', createPlaylistFromPrompt);
$('#remotePlaylists').addEventListener('click', (event) => { const remote = event.target.closest('[data-remote-playlist]'); const local = event.target.closest('[data-local-playlist]'); if (remote) openPlaylist(remote.dataset.remotePlaylist, remote.dataset.playlistTitle); if (local) openLocalPlaylist(local.dataset.localPlaylist, local.dataset.playlistTitle); });
$('#libraryPlaylists').addEventListener('click', (event) => { const playlist = event.target.closest('[data-library-playlist]'); if (playlist) { showView('browse'); openLocalPlaylist(playlist.dataset.libraryPlaylist, playlist.dataset.playlistTitle); } });
$('#playlistPickerClose').addEventListener('click', closePlaylistPicker); document.querySelector('[data-close-playlist-picker]').addEventListener('click', closePlaylistPicker); $('#playlistPickerList').addEventListener('click', (event) => { const pick = event.target.closest('[data-pick-playlist]'); if (pick) addToLocalPlaylist(pick.dataset.pickPlaylist); }); $('#createPlaylistFromPicker').addEventListener('click', () => { const title = $('#newPlaylistName').value; if (!title.trim()) return; createLocalPlaylist(title); $('#newPlaylistName').value = ''; renderPlaylistPicker(); });
$('#menuAddPlaylist').addEventListener('click', () => { const track = menuTrack; closeTrackMenu(); openPlaylistPicker(track); }); $('#menuAddQueue').addEventListener('click', () => { if (!menuTrack) return; state.queue.push(menuTrack); renderQueue(); showToast('Added to queue.'); closeTrackMenu(); }); document.addEventListener('click', (event) => { if (!event.target.closest('#trackMenu') && !event.target.closest('[data-menu-index]')) closeTrackMenu(); });
$('#recommendationList').addEventListener('click', (event) => { const play = event.target.closest('[data-recommendation-index]'); const add = event.target.closest('[data-recommendation-add-index]'); if (play) playTrack(recommendationItems[Number(play.dataset.recommendationIndex)]); if (add) { state.queue.push(recommendationItems[Number(add.dataset.recommendationAddIndex)]); renderQueue(); showToast('Added to queue.'); } }); $('#refreshRecommendations').addEventListener('click', () => loadRecommendations(recommendationSeed || currentTrack || currentResults.find((item) => item.kind === 'video')));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
document.addEventListener('keydown', (event) => { if (event.target.matches('input, textarea, button')) return; if (event.code === 'Space') { event.preventDefault(); $('#playPause').click(); } if (event.code === 'ArrowRight') nextTrack(); if (event.code === 'ArrowLeft') previousTrack(); });

