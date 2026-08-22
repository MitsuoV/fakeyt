const demoTracks = [
  { title: 'A Walk', artist: 'Tycho · Awake', time: '4:38', tone: 'cobalt', symbol: '◒' },
  { title: 'Everything In Its Right Place', artist: 'Radiohead · Kid A', time: '4:11', tone: 'yellow', symbol: '∿' },
  { title: 'Weightless', artist: 'Marconi Union · Ambient', time: '8:00', tone: 'mint', symbol: '✦' },
  { title: 'Night Drive', artist: 'The Midnight · Nocturnal', time: '4:22', tone: 'coral', symbol: '✧' },
  { title: 'New Grass', artist: 'Talk Talk · Laughing Stock', time: '9:47', tone: 'blue', symbol: '≈' }
];

const STORAGE_KEY = 'lowkey-state-v3';
const SCOPES = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl';
const $ = (selector) => document.querySelector(selector);
const trackList = $('#trackList');
const queueList = $('#queueList');
let displayedTracks = demoTracks;
let searchTerm = '';
let searchTimer;
let player = null;
let playerReady = false;
let pendingTrack = null;
let tokenClient = null;
let progressTimer = null;

function getSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { apiKey: saved.apiKey || '', clientId: saved.clientId || '', accessToken: saved.accessToken || '', queue: Array.isArray(saved.queue) ? saved.queue : [demoTracks[1], demoTracks[2], demoTracks[3]], favorites: Array.isArray(saved.favorites) ? saved.favorites : [], history: Array.isArray(saved.history) ? saved.history : [], notes: saved.notes || {}, playlists: Array.isArray(saved.playlists) ? saved.playlists : [], currentTrack: saved.currentTrack || demoTracks[0] };
  } catch { return { apiKey: '', clientId: '', accessToken: '', queue: [demoTracks[1], demoTracks[2], demoTracks[3]], favorites: [], history: [], notes: {}, playlists: [], currentTrack: demoTracks[0] }; }
}

const state = getSavedState();
let currentTrack = state.currentTrack;
let isPlaying = false;

function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, currentTrack })); }
function trackKey(track) { return track.videoId || `${track.title}::${track.artist}`; }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character])); }
function formatSeconds(seconds) { if (!Number.isFinite(seconds)) return '0:00'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }

function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible'); window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove('visible'), 2400);
}

function thumbnailMarkup(track) { return track.thumbnail ? `<img src="${escapeHtml(track.thumbnail)}" alt="" />` : `<span>${escapeHtml(track.symbol || '▶')}</span>`; }

function renderTracks(items = displayedTracks) {
  displayedTracks = items;
  trackList.innerHTML = items.length ? items.map((track, index) => `
    <div class="track-row" data-index="${index}">
      <span class="track-number">${String(index + 1).padStart(2, '0')}</span>
      <div class="track-thumb art-${escapeHtml(track.tone || 'blue')}">${thumbnailMarkup(track)}</div>
      <div class="track-main"><strong>${escapeHtml(track.title)}</strong><small>${escapeHtml(track.artist)}</small></div>
      <span class="track-time">${escapeHtml(track.time || '—')}</span>
      <button class="row-play" data-play-index="${index}" aria-label="Play ${escapeHtml(track.title)}">▶</button>
    </div>`).join('') : '<div class="empty-results">No tracks match your search.</div>';
}

function renderQueue() {
  state.queue = state.queue.filter(Boolean); saveState();
  queueList.innerHTML = state.queue.length ? state.queue.map((track, index) => `
    <div class="queue-row" data-queue-index="${index}">
      <div class="queue-thumb art-${escapeHtml(track.tone || 'blue')}">${thumbnailMarkup(track)}</div>
      <div class="queue-copy"><strong>${escapeHtml(track.title)}</strong><small>${escapeHtml((track.artist || '').split(' · ')[0])}</small></div>
      <span class="queue-time">${escapeHtml(track.time || '—')}</span>
      <button class="queue-remove" data-remove-index="${index}" aria-label="Remove ${escapeHtml(track.title)} from queue">×</button>
    </div>`).join('') : '<p class="empty-queue">Your queue is clear.</p>';
}

function renderPlaylists() {
  $('#remotePlaylists').innerHTML = state.playlists.map((playlist) => playlist.local ? `<button class="playlist-link" data-local-playlist="${escapeHtml(playlist.id)}" data-playlist-title="${escapeHtml(playlist.title)}"><span class="playlist-dot yellow"></span>${escapeHtml(playlist.title)}</button>` : `<button class="playlist-link" data-remote-playlist="${escapeHtml(playlist.id)}" data-playlist-title="${escapeHtml(playlist.title)}"><span class="playlist-dot mint"></span>${escapeHtml(playlist.title)}</button>`).join('');
}

function setConnectionLabel() {
  $('#connectionLabel').textContent = state.accessToken ? 'Google connected' : 'Personal account';
  $('#settingsStatus').textContent = state.accessToken ? 'Connected to Google. Your playlists are ready to import.' : 'Not connected yet.';
}

function updateFavoriteButtons() {
  const liked = state.favorites.includes(trackKey(currentTrack));
  document.querySelectorAll('.heart-button').forEach((button) => { button.classList.toggle('liked', liked); button.textContent = liked ? '♥' : '♡'; });
}

function setCurrent(track, announce = true) {
  currentTrack = track; $('#nowTitle').textContent = track.title; $('#nowArtist').textContent = track.artist; updateFavoriteButtons();
  if (!state.history.some((item) => trackKey(item.track) === trackKey(track))) state.history.unshift({ track, playedAt: new Date().toISOString() });
  state.history = state.history.slice(0, 50); saveState(); if (announce) showToast(`Ready to play “${track.title}”`);
}

function loadScript(src, id) {
  return new Promise((resolve, reject) => { if (document.getElementById(id)) return resolve(); const script = document.createElement('script'); script.id = id; script.src = src; script.onload = resolve; script.onerror = () => reject(new Error(`Could not load ${src}`)); document.head.appendChild(script); });
}

function startProgressTimer() {
  window.clearInterval(progressTimer); progressTimer = window.setInterval(() => {
    if (!playerReady || !player || typeof player.getCurrentTime !== 'function') return;
    const current = player.getCurrentTime(); const duration = player.getDuration(); const fill = $('.player-progress .progress-fill');
    if (fill && duration) fill.style.width = `${Math.min(100, (current / duration) * 100)}%`;
    const labels = document.querySelectorAll('.player-progress span'); if (labels.length === 2) { labels[0].textContent = formatSeconds(current); labels[1].textContent = formatSeconds(duration); }
  }, 1000);
}

function onPlayerStateChange(event) {
  if (event.data === window.YT?.PlayerState?.PLAYING) { isPlaying = true; $('#playPause').textContent = '❚❚'; startProgressTimer(); }
  if (event.data === window.YT?.PlayerState?.PAUSED) { isPlaying = false; $('#playPause').textContent = '▶'; }
  if (event.data === window.YT?.PlayerState?.ENDED) nextTrack();
}

function ensurePlayer() {
  if (playerReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const makePlayer = () => { player = new window.YT.Player('youtubePlayer', { height: '1', width: '1', videoId: '', playerVars: { controls: 0, playsinline: 1, rel: 0 }, events: { onReady: () => { playerReady = true; resolve(); if (pendingTrack) playTrack(pendingTrack, false); }, onStateChange: onPlayerStateChange } }); };
    if (window.YT?.Player) makePlayer(); else { const previous = window.onYouTubeIframeAPIReady; window.onYouTubeIframeAPIReady = () => { previous?.(); makePlayer(); }; loadScript('https://www.youtube.com/iframe_api', 'youtube-iframe-api').catch(reject); }
  });
}

async function playTrack(track, announce = true) {
  setCurrent(track, announce); pendingTrack = track;
  if (!track.videoId) { showToast('Connect YouTube to play this demo track'); return; }
  try { await ensurePlayer(); player.loadVideoById(track.videoId); player.playVideo(); } catch { showToast('The official player could not load'); }
}

function nextTrack() { if (state.queue.length) return playTrack(state.queue.shift()); const index = displayedTracks.findIndex((track) => trackKey(track) === trackKey(currentTrack)); return playTrack(displayedTracks[(index + 1 + displayedTracks.length) % displayedTracks.length] || demoTracks[0]); }
function previousTrack() { if (playerReady && player.getCurrentTime() > 5) { player.seekTo(0); return; } playTrack(state.history[1]?.track || demoTracks[0]); }

async function searchYouTube(query) {
  if (!state.apiKey) { renderTracks(demoTracks.filter((track) => `${track.title} ${track.artist}`.toLowerCase().includes(query))); return; }
  trackList.innerHTML = '<div class="empty-results">Searching YouTube…</div>';
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=12&q=${encodeURIComponent(query)}&key=${encodeURIComponent(state.apiKey)}`;
    const response = await fetch(url); if (!response.ok) throw new Error('Search failed'); const data = await response.json();
    const results = (data.items || []).filter((item) => item.id?.videoId).map((item) => ({ videoId: item.id.videoId, title: item.snippet.title, artist: item.snippet.channelTitle, time: '—', thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url, tone: 'blue', symbol: '▶' }));
    renderTracks(results);
  } catch { renderTracks([]); showToast('YouTube search failed — check your API key'); }
}

async function connectGoogle() {
  if (!state.clientId) { showToast('Add your Google OAuth client ID first'); return; }
  try {
    await loadScript('https://accounts.google.com/gsi/client', 'google-identity-services');
    tokenClient = window.google.accounts.oauth2.initTokenClient({ client_id: state.clientId, scope: SCOPES, callback: async (response) => { if (response.error) return showToast('Google connection was not completed'); state.accessToken = response.access_token; saveState(); setConnectionLabel(); showToast('Google connected'); await importPlaylists(); } });
    tokenClient.requestAccessToken({ prompt: state.accessToken ? '' : 'consent' });
  } catch { showToast('Google sign-in could not load'); }
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${state.accessToken}` } });
  if (response.status === 401) { state.accessToken = ''; saveState(); setConnectionLabel(); }
  if (!response.ok) throw new Error('Google API request failed'); return response.status === 204 ? null : response.json();
}

async function importPlaylists() {
  if (!state.accessToken) { showToast('Connect Google before importing playlists'); return; }
  try { const data = await apiRequest('https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50'); const localPlaylists = state.playlists.filter((playlist) => playlist.local); state.playlists = [...localPlaylists, ...(data.items || []).map((item) => ({ id: item.id, title: item.snippet.title, count: item.contentDetails.itemCount }))]; saveState(); renderPlaylists(); showToast(`${state.playlists.length} playlists imported`); } catch { showToast('Could not import playlists'); }
}

async function openRemotePlaylist(playlistId, title) {
  if (!state.accessToken) return showToast('Connect Google before opening playlists'); trackList.innerHTML = `<div class="empty-results">Loading ${escapeHtml(title)}…</div>`;
  try { const data = await apiRequest(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(playlistId)}&maxResults=50`); const items = (data.items || []).filter((item) => item.snippet?.resourceId?.videoId).map((item) => ({ videoId: item.snippet.resourceId.videoId, title: item.snippet.title, artist: item.snippet.videoOwnerChannelTitle || 'YouTube', time: '—', thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url, tone: 'coral', symbol: '▶' })); searchTerm = ''; $('#searchInput').value = ''; renderTracks(items); showToast(`${items.length} tracks in “${title}”`); } catch { showToast('Could not load that playlist'); }
}

function openLocalPlaylist(playlistId, title) {
  const playlist = state.playlists.find((item) => item.id === playlistId);
  searchTerm = ''; $('#searchInput').value = ''; renderTracks(playlist?.tracks || []); showToast(`${playlist?.tracks?.length || 0} tracks in “${title}”`);
}

function toggleFavorite() { const key = trackKey(currentTrack); state.favorites = state.favorites.includes(key) ? state.favorites.filter((item) => item !== key) : [...state.favorites, key]; saveState(); updateFavoriteButtons(); showToast(state.favorites.includes(key) ? 'Saved to favorites' : 'Removed from favorites'); }
function addNote() { const key = trackKey(currentTrack); const note = window.prompt(`Note for “${currentTrack.title}”`, state.notes[key] || ''); if (note === null) return; if (note.trim()) state.notes[key] = note.trim(); else delete state.notes[key]; saveState(); showToast(note.trim() ? 'Note saved on this device' : 'Note removed'); }
function openSettings() { $('#apiKeyInput').value = state.apiKey; $('#clientIdInput').value = state.clientId; setConnectionLabel(); $('#settingsModal').hidden = false; $('#apiKeyInput').focus(); }
function closeSettings() { $('#settingsModal').hidden = true; }

renderTracks(); renderQueue(); renderPlaylists(); setCurrent(currentTrack, false); setConnectionLabel();
trackList.addEventListener('click', (event) => { const button = event.target.closest('[data-play-index]'); if (button) playTrack(displayedTracks[Number(button.dataset.playIndex)]); });
queueList.addEventListener('click', (event) => { const removeButton = event.target.closest('[data-remove-index]'); if (!removeButton) return; const removed = state.queue.splice(Number(removeButton.dataset.removeIndex), 1)[0]; renderQueue(); showToast(`Removed “${removed.title}” from queue`); });
$('#playPause').addEventListener('click', async () => { if (!currentTrack.videoId) return showToast('Connect YouTube to play this track'); try { await ensurePlayer(); if (isPlaying) player.pauseVideo(); else player.playVideo(); } catch { showToast('Connect YouTube to start playback'); } });
$('#featurePlay').addEventListener('click', () => playTrack(currentTrack)); $('#next').addEventListener('click', nextTrack); $('#previous').addEventListener('click', previousTrack);
$('#shuffle').addEventListener('click', (event) => { event.currentTarget.classList.toggle('toggled'); showToast(event.currentTarget.classList.contains('toggled') ? 'Shuffle on' : 'Shuffle off'); }); $('#repeat').addEventListener('click', (event) => { event.currentTarget.classList.toggle('toggled'); showToast(event.currentTarget.classList.contains('toggled') ? 'Repeat on' : 'Repeat off'); });
$('#clearQueue').addEventListener('click', () => { state.queue = []; renderQueue(); showToast('Queue cleared'); }); $('#addQueue').addEventListener('click', () => { state.queue.push(displayedTracks[0] || demoTracks[0]); renderQueue(); showToast('Added a track to your queue'); }); $('#openQueue').addEventListener('click', () => document.querySelector('.secondary-column').scrollIntoView({ behavior: 'smooth', block: 'center' })); $('#queueToggle').addEventListener('click', () => document.querySelector('.secondary-column').scrollIntoView({ behavior: 'smooth', block: 'center' }));
$('#noteCurrent').addEventListener('click', addNote); document.querySelectorAll('.heart-button').forEach((button) => button.addEventListener('click', toggleFavorite));
$('#searchInput').addEventListener('input', (event) => { searchTerm = event.target.value.trim().toLowerCase(); window.clearTimeout(searchTimer); if (!searchTerm) return renderTracks(demoTracks); searchTimer = window.setTimeout(() => searchYouTube(searchTerm), 450); });
$('#settingsButton').addEventListener('click', openSettings); $('#settingsClose').addEventListener('click', closeSettings); document.querySelector('[data-close-settings]').addEventListener('click', closeSettings); $('#saveSettings').addEventListener('click', () => { state.apiKey = $('#apiKeyInput').value.trim(); state.clientId = $('#clientIdInput').value.trim(); saveState(); showToast('Connection settings saved'); setConnectionLabel(); }); $('#connectGoogle').addEventListener('click', () => { state.apiKey = $('#apiKeyInput').value.trim(); state.clientId = $('#clientIdInput').value.trim(); saveState(); connectGoogle(); }); $('#importPlaylists').addEventListener('click', importPlaylists);
$('#remotePlaylists').addEventListener('click', (event) => { const remoteButton = event.target.closest('[data-remote-playlist]'); const localButton = event.target.closest('[data-local-playlist]'); if (remoteButton) openRemotePlaylist(remoteButton.dataset.remotePlaylist, remoteButton.dataset.playlistTitle); if (localButton) openLocalPlaylist(localButton.dataset.localPlaylist, localButton.dataset.playlistTitle); }); document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showToast(`${button.dataset.view[0].toUpperCase()}${button.dataset.view.slice(1)} view is ready`))); document.querySelectorAll('[data-playlist]').forEach((button) => button.addEventListener('click', () => showToast(`Opened “${button.dataset.playlist}”`)));
$('#newPlaylist').addEventListener('click', () => { const title = window.prompt('Name your new playlist'); if (title?.trim()) { state.playlists.unshift({ id: `local-${Date.now()}`, title: title.trim(), local: true, tracks: [] }); saveState(); renderPlaylists(); showToast(`“${title.trim()}” is ready for tracks`); } }); document.querySelector('.dismiss-note').addEventListener('click', (event) => event.currentTarget.closest('.mini-note').remove());
document.addEventListener('keydown', (event) => { if (event.target.matches('input, textarea, button')) return; if (event.code === 'Space') { event.preventDefault(); $('#playPause').click(); } if (event.code === 'ArrowRight') nextTrack(); if (event.code === 'ArrowLeft') previousTrack(); });
