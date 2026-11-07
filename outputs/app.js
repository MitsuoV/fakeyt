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
let menuPlaylistId = null;
let menuTrackIndex = null;
let shuffleEnabled = false;
let repeatMode = 'off';
let activePlaybackTracks = [];
let swipeStartX = 0;
let mobileSwipeAnimating = false;
let mobileSwipeStartX = 0;
let mobileSwipeStartY = 0;
let mobileSwipeTracking = false;
let recommendationItems = [];
let recommendationSeed = null;
let currentView = 'home';
let requestSerial = 0;
let activeLibraryPlaylistId = null;
let mobileLyricsEnabled = false;
let currentLyrics = null;
let lyricsStatus = 'idle';
let lyricsRequestSerial = 0;
let lyricsLoadingVideoId = null;
let lyricsScrollTimer = null;
let programmaticLyricsScrollUntil = 0;
let manualLyricsScrollUntil = 0;
let currentLyricLineIndex = -1;
const lyricsCache = new Map();
const discoverySeeds = ['new music', 'indie pop', 'lofi beats', 'electronic music', 'jazz', 'r&b', 'ambient music', 'alternative rock'];

function getSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { clientId: saved.clientId || '', accessToken: saved.accessToken || '', queue: Array.isArray(saved.queue) ? saved.queue : [], favorites: Array.isArray(saved.favorites) ? saved.favorites : [], history: Array.isArray(saved.history) ? saved.history : [], notes: saved.notes || {}, playlists: Array.isArray(saved.playlists) ? saved.playlists : [], recentSearches: Array.isArray(saved.recentSearches) ? saved.recentSearches : [], lastPlayedTrack: saved.lastPlayedTrack || null, lastPosition: Number(saved.lastPosition) || 0 };
  } catch { return { clientId: '', accessToken: '', queue: [], favorites: [], history: [], notes: {}, playlists: [], recentSearches: [], lastPlayedTrack: null, lastPosition: 0 }; }
}

const state = getSavedState();
currentTrack = state.lastPlayedTrack;

let sharedPlaylistsVersion = null;
let sharedPlaylistsSnapshot = JSON.stringify(state.playlists);
let sharedPlaylistsDirty = false;
let sharedSyncTimer = null;
let sharedSyncBusy = false;
let sharedSyncMessage = 'Playlists are saved on this device until you connect sync.';
function saveState() {
  const { apiKey, ...safeState } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState));
  const playlistSnapshot = JSON.stringify(state.playlists);
  if (playlistSnapshot !== sharedPlaylistsSnapshot && sharedPlaylistsVersion !== null) {
    sharedPlaylistsDirty = true;
    window.clearTimeout(sharedSyncTimer);
    sharedSyncTimer = window.setTimeout(() => pushSharedPlaylists(), 500);
  }
}
async function requestSharedLibrary(options = {}) {
  const response = await fetch('/api/library', { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Playlist sync is unavailable.'), { status: response.status, data });
  return data;
}
function updateSyncMessage(message) {
  sharedSyncMessage = message;
  const status = $('#settingsStatus');
  if (status) status.textContent = message;
  const label = $('#connectionLabel');
  if (label) label.textContent = sharedPlaylistsVersion === null ? 'Local library' : 'Synced library';
  const title = $('#syncTitle');
  const subtitle = $('#syncSubtitle');
  if (title) title.textContent = sharedPlaylistsVersion === null ? 'Local mode' : 'Shared library';
  if (subtitle) subtitle.textContent = sharedPlaylistsVersion === null ? 'Saved on this device' : 'Playlists sync across devices';
}
function renderSyncConnection() {
  const input = $('#syncPassphrase');
  const connect = $('#connectPlaylistSync');
  const disconnect = $('#disconnectPlaylistSync');
  if (!input) return;
  const connected = sharedPlaylistsVersion !== null;
  input.hidden = connected;
  connect.hidden = connected;
  disconnect.hidden = !connected;
  updateSyncMessage(sharedSyncMessage);
}
async function connectSharedLibrary() {
  const phrase = $('#syncPassphrase').value;
  if (!phrase) return updateSyncMessage('Enter your shared passphrase to connect this device.');
  $('#connectPlaylistSync').disabled = true;
  updateSyncMessage('Connecting to your shared playlists…');
  try {
    await requestSharedLibrary({ method: 'POST', body: JSON.stringify({ passphrase: phrase }), headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' });
    $('#syncPassphrase').value = '';
    await loadSharedPlaylists(true);
    renderSyncConnection();
  } catch (error) {
    updateSyncMessage(error.status === 401 ? 'That passphrase did not match.' : error.message);
  } finally { $('#connectPlaylistSync').disabled = false; }
}
async function loadSharedPlaylists(migrateLocal = false) {
  try {
    const remote = await requestSharedLibrary();
    if (remote.version === 0 && migrateLocal && state.playlists.length) {
      sharedPlaylistsVersion = 0;
      sharedPlaylistsDirty = true;
      await pushSharedPlaylists();
    } else {
      state.playlists = Array.isArray(remote.playlists) ? remote.playlists : [];
      sharedPlaylistsVersion = remote.version;
      sharedPlaylistsSnapshot = JSON.stringify(state.playlists);
      sharedPlaylistsDirty = false;
      const { apiKey, ...safeState } = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState));
      renderPlaylists(); renderLibrary();
    }
    updateSyncMessage('Your playlists are synced across devices.');
  } catch (error) {
    if (error.status === 401) {
      sharedPlaylistsVersion = null;
      updateSyncMessage('Playlists are saved on this device. Connect sync to share them across devices.');
    } else updateSyncMessage(error.message);
  }
}
async function refreshSharedPlaylists() {
  if (sharedPlaylistsVersion === null || sharedSyncBusy || !navigator.onLine) return;
  if (sharedPlaylistsDirty) return pushSharedPlaylists();
  try {
    const remote = await requestSharedLibrary();
    if (remote.version === sharedPlaylistsVersion) return;
    if (sharedPlaylistsDirty) return pushSharedPlaylists();
    state.playlists = Array.isArray(remote.playlists) ? remote.playlists : [];
    sharedPlaylistsVersion = remote.version;
    sharedPlaylistsSnapshot = JSON.stringify(state.playlists);
    sharedPlaylistsDirty = false;
    const { apiKey, ...safeState } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState));
    renderPlaylists(); renderLibrary();
    updateSyncMessage('Your playlists are synced across devices.');
  } catch (error) {
    if (error.status === 401) {
      sharedPlaylistsVersion = null;
      updateSyncMessage('Your session expired. Connect sync again to share playlists.');
      renderSyncConnection();
    } else updateSyncMessage(error.message);
  }
}
async function pushSharedPlaylists() {
  if (sharedSyncBusy || sharedPlaylistsVersion === null) return;
  sharedSyncBusy = true;
  const payload = JSON.stringify(state.playlists);
  try {
    let result;
    try {
      result = await requestSharedLibrary({ method: 'PUT', body: JSON.stringify({ version: sharedPlaylistsVersion, playlists: state.playlists }) });
    } catch (error) {
      if (error.status !== 409) throw error;
      sharedPlaylistsVersion = error.data.version;
      result = await requestSharedLibrary({ method: 'PUT', body: JSON.stringify({ version: sharedPlaylistsVersion, playlists: state.playlists }) });
    }
    sharedPlaylistsVersion = result.version;
    sharedPlaylistsSnapshot = payload;
    sharedPlaylistsDirty = JSON.stringify(state.playlists) !== payload;
    updateSyncMessage('Your playlists are synced across devices.');
  } catch (error) {
    if (error.status === 401) sharedPlaylistsVersion = null;
    updateSyncMessage(error.message);
  } finally {
    sharedSyncBusy = false;
    if (sharedPlaylistsDirty) {
      window.clearTimeout(sharedSyncTimer);
      sharedSyncTimer = window.setTimeout(() => pushSharedPlaylists(), 200);
    }
  }
}
async function disconnectSharedLibrary() {
  try { await requestSharedLibrary({ method: 'DELETE' }); } catch { /* Local data stays available when offline. */ }
  sharedPlaylistsVersion = null;
  updateSyncMessage('Disconnected on this device. Shared playlists remain online.');
  renderSyncConnection();
}
function trackKey(track) { return track?.videoId || `${track?.title || ''}::${track?.artist || ''}`; }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character])); }
function formatSeconds(seconds) { if (!Number.isFinite(seconds)) return '0:00'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible'); window.clearTimeout(showToast.timeout); showToast.timeout = window.setTimeout(() => toast.classList.remove('visible'), 2600); }
function lyricIdentity(value) {
  return String(value || '')
    .replace(/[([{](?:\s*official\s*)?(?:music\s*)?(?:video|audio|lyrics?|visualizer|4k|hd|hq)[^\])}]*[\])}]/gi, ' ')
    .replace(/\s*(?:[-|:–—]\s*)?(?:official\s*)?(?:music\s*)?(?:video|audio|lyrics?|visualizer|4k|hd|hq|remaster(?:ed)?)\s*$/i, ' ')
    .replace(/\s+(?:feat(?:uring)?|ft)\.?\s+.*$/i, '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function lyricArtistIdentity(value) {
  return lyricIdentity(String(value || '').replace(/(?:\s*[-–—]\s*topic|\s+topic|\s*vevo|\s+official channel)\s*$/i, '')).trim();
}
function lyricTitleVariants(value, artist = '') {
  const raw = String(value || '')
    .replace(/[([{](?:\s*official\s*)?(?:music\s*)?(?:video|audio|lyrics?|visualizer|4k|hd|hq)[^\])}]*[\])}]/gi, ' ')
    .replace(/\s*(?:[-|:–—]\s*)?(?:official\s*)?(?:music\s*)?(?:video|audio|lyrics?|visualizer|4k|hd|hq|remaster(?:ed)?)\s*$/i, ' ')
    .trim();
  const artistName = lyricArtistIdentity(artist);
  const candidates = [raw, ...raw.split(/\s+(?:-|–|—|\||:)\s+/)];
  const variants = new Set();
  for (const candidate of candidates) {
    let normalized = lyricIdentity(candidate);
    if (artistName && normalized.startsWith(`${artistName} `)) normalized = normalized.slice(artistName.length).trim();
    if (normalized) variants.add(normalized);
  }
  return variants;
}
function lyricTrackTitle(track) {
  return lyricTitleVariants(track?.title, track?.artist);
}
function lyricsArtistMatches(track, recordArtist) {
  const candidate = lyricArtistIdentity(recordArtist);
  if (!candidate) return false;
  const targets = new Set([lyricArtistIdentity(track?.artist)]);
  const titlePrefix = String(track?.title || '').split(/\s+[-–—]\s+/)[0];
  if (titlePrefix && titlePrefix.length > 2) targets.add(lyricArtistIdentity(titlePrefix));
  for (const target of targets) {
    if (!target) continue;
    if (target.replace(/\s/g, '') === candidate.replace(/\s/g, '')) return true;
    const targetWords = new Set(target.split(' '));
    const candidateWords = new Set(candidate.split(' '));
    const smaller = targetWords.size <= candidateWords.size ? targetWords : candidateWords;
    const larger = smaller === targetWords ? candidateWords : targetWords;
    if (smaller.size >= 2 && [...smaller].every((word) => larger.has(word))) return true;
  }
  return false;
}
function lyricsMatchTrack(track, record) {
  const titles = lyricTrackTitle(track);
  if (!titles.size || !lyricsArtistMatches(track, record?.artistName)) return false;
  const recordTitles = lyricTitleVariants(record?.trackName || record?.name, record?.artistName);
  return [...titles].some((title) => recordTitles.has(title));
}
function parseSyncedLyrics(rawLyrics) {
  const lines = [];
  for (const rawLine of String(rawLyrics || '').split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = rawLine.replace(/\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?|[a-z]{2,3}:[^\]]*)\]/gi, '').trim();
    if (!timestamps.length || !text) continue;
    for (const match of timestamps) {
      const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
      lines.push({ time: Number(match[1]) * 60 + Number(match[2]) + fraction, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}
function renderLyricsMessage(message, state = 'message') {
  const inner = $('#mobilePlayerLyricsInner');
  if (!inner) return;
  inner.replaceChildren();
  const label = document.createElement('p');
  label.className = `mobile-lyrics-message mobile-lyrics-message-${state}`;
  label.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  label.textContent = message;
  inner.append(label);
  if (state === 'error' || state === 'empty') {
    const action = document.createElement('button');
    action.className = 'mobile-lyrics-retry';
    action.type = 'button';
    action.dataset.retryLyrics = 'true';
    action.textContent = state === 'error' ? 'Try again' : 'Check again';
    inner.append(action);
  }
}
function renderLyrics(track) {
  if (!mobileLyricsEnabled) return;
  const panel = $('#mobilePlayerLyrics');
  const inner = $('#mobilePlayerLyricsInner');
  if (!panel || !inner) return;
  if (!track?.videoId) return renderLyricsMessage('Choose a song to see its lyrics.');
  if (lyricsStatus === 'loading') return renderLyricsMessage('Finding the lyrics…', 'loading');
  if (lyricsStatus === 'error') return renderLyricsMessage('Lyrics couldn’t load right now.', 'error');
  if (!currentLyrics) return renderLyricsMessage('Lyrics will appear when playback is ready.');
  if (currentLyrics.instrumental) return renderLyricsMessage('This track is marked as instrumental.');
  if (!currentLyrics.syncedLines.length && !currentLyrics.plainLyrics) return renderLyricsMessage('No lyrics were found for this track.', 'empty');

  inner.replaceChildren();
  if (currentLyrics.syncedLines.length) {
    const hint = document.createElement('p');
    hint.className = 'mobile-lyrics-hint';
    hint.textContent = 'Scroll or tap to seek · LRCLIB';
    inner.append(hint);
    const list = document.createElement('div');
    list.className = 'mobile-lyrics-lines';
    currentLyrics.syncedLines.forEach((line, index) => {
      const button = document.createElement('button');
      button.className = 'mobile-lyrics-line';
      button.type = 'button';
      button.dataset.lyricIndex = String(index);
      button.dataset.lyricTime = String(line.time);
      button.setAttribute('aria-label', `Jump to ${formatSeconds(line.time)}: ${line.text}`);
      button.textContent = line.text;
      list.append(button);
    });
    inner.append(list);
    currentLyricLineIndex = -1;
    syncActiveLyricLine(playerReady && player ? player.getCurrentTime() : 0, true);
    return;
  }

  const notice = document.createElement('p');
  notice.className = 'mobile-lyrics-hint';
  notice.textContent = 'Unsynced lyrics · LRCLIB';
  inner.append(notice);
  const text = document.createElement('p');
  text.className = 'mobile-lyrics-plain';
  text.textContent = currentLyrics.plainLyrics;
  inner.append(text);
}
function syncActiveLyricLine(currentTime, forceScroll = false) {
  if (!mobileLyricsEnabled || !currentLyrics?.syncedLines?.length) return;
  const lines = currentLyrics.syncedLines;
  let low = 0;
  let high = lines.length - 1;
  let active = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lines[middle].time <= currentTime) { active = middle; low = middle + 1; }
    else high = middle - 1;
  }
  if (active === currentLyricLineIndex && !forceScroll) return;
  currentLyricLineIndex = active;
  const buttons = $('#mobilePlayerLyricsInner')?.querySelectorAll('.mobile-lyrics-line');
  if (!buttons?.length) return;
  buttons.forEach((button, index) => {
    button.classList.toggle('is-current', index === active);
    button.classList.toggle('is-near', Math.abs(index - active) === 1);
    if (index === active) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  if (active < 0) return;
  const line = buttons[active];
  const panel = $('#mobilePlayerLyrics');
  if (!line || !panel) return;
  const lineRect = line.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const target = panel.scrollTop + lineRect.top - panelRect.top - (panel.clientHeight - lineRect.height) / 2;
  if (forceScroll || Date.now() >= manualLyricsScrollUntil) {
    programmaticLyricsScrollUntil = Date.now() + 460;
    panel.scrollTo({ top: Math.max(0, target), behavior: forceScroll ? 'auto' : 'smooth' });
  }
}
function handleManualLyricsScroll() {
  const panel = $('#mobilePlayerLyrics');
  if (!mobileLyricsEnabled || !currentLyrics?.syncedLines?.length || !playerReady || !panel || Date.now() < programmaticLyricsScrollUntil) return;
  const videoId = currentTrack?.videoId;
  manualLyricsScrollUntil = Date.now() + 900;
  window.clearTimeout(lyricsScrollTimer);
  lyricsScrollTimer = window.setTimeout(() => {
    if (!mobileLyricsEnabled || currentTrack?.videoId !== videoId || !currentLyrics?.syncedLines?.length || Date.now() < programmaticLyricsScrollUntil) return;
    const panelRect = panel.getBoundingClientRect();
    const center = panelRect.top + panel.clientHeight / 2;
    let closest = null;
    let closestDistance = Infinity;
    for (const line of panel.querySelectorAll('.mobile-lyrics-line')) {
      const rect = line.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - center);
      if (distance < closestDistance) { closest = line; closestDistance = distance; }
    }
    if (closest) seekFromLyricLine(closest);
  }, 150);
}
async function loadMobileLyrics(track = currentTrack, retry = false) {
  if (!track?.videoId) return renderLyricsMessage('Choose a song to see its lyrics.');
  const key = track.videoId;
  if (!retry && lyricsCache.has(key)) {
    currentLyrics = lyricsCache.get(key);
    lyricsStatus = 'loaded';
    renderLyrics(track);
    return;
  }
  if (!retry && lyricsLoadingVideoId === key) return;
  const requestId = ++lyricsRequestSerial;
  lyricsLoadingVideoId = key;
  currentLyrics = null;
  lyricsStatus = 'loading';
  currentLyricLineIndex = -1;
  renderLyrics(track);
  const lookupTitle = lyricTrackTitle(track).values().next().value || track.title || '';
  const lookupArtist = lyricArtistIdentity(track.artist) || track.artist || '';
  const params = new URLSearchParams({ title: lookupTitle, artist: lookupArtist });
  if (playerReady && player && currentTrack?.videoId === key && player.getDuration() > 0) params.set('duration', String(Math.round(player.getDuration())));
  try {
    const response = await fetch(`/api/lyrics?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || 'Lyrics request failed.'), { status: response.status });
    if (requestId !== lyricsRequestSerial || currentTrack?.videoId !== key) return;
    const records = [payload.record, ...(Array.isArray(payload.candidates) ? payload.candidates : [])].filter(Boolean);
    const record = payload.record || records.find((candidate) => lyricsMatchTrack(track, candidate));
    if (!record) {
      currentLyrics = { instrumental: false, syncedLines: [], plainLyrics: '' };
      lyricsStatus = 'loaded';
      lyricsCache.set(key, currentLyrics);
    } else {
      const rawSyncedLyrics = typeof record.syncedLyrics === 'string' ? record.syncedLyrics : '';
      const syncedLines = parseSyncedLyrics(rawSyncedLyrics);
      currentLyrics = {
        instrumental: Boolean(record.instrumental),
        syncedLines,
        plainLyrics: typeof record.plainLyrics === 'string' && record.plainLyrics.trim()
          ? record.plainLyrics.trim()
          : rawSyncedLyrics.split(/\r?\n/).map((line) => line.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim()).filter(Boolean).join('\n')
      };
      lyricsStatus = 'loaded';
      lyricsCache.set(key, currentLyrics);
    }
    renderLyrics(track);
  } catch (error) {
    if (requestId !== lyricsRequestSerial || currentTrack?.videoId !== key) return;
    lyricsStatus = 'error';
    renderLyrics(track);
  } finally {
    if (requestId === lyricsRequestSerial) lyricsLoadingVideoId = null;
  }
}
function toggleMobileLyrics() {
  if (!currentTrack?.videoId) return;
  mobileLyricsEnabled = !mobileLyricsEnabled;
  const playerOverlay = $('#mobilePlayer');
  const panel = $('#mobilePlayerLyrics');
  const toggle = $('#mobileLyricsToggle');
  playerOverlay?.classList.toggle('showing-lyrics', mobileLyricsEnabled);
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(mobileLyricsEnabled));
    toggle.textContent = mobileLyricsEnabled ? 'Cover' : 'Lyrics';
  }
  if (panel) {
    panel.setAttribute('aria-hidden', String(!mobileLyricsEnabled));
    panel.inert = !mobileLyricsEnabled;
  }
  if (mobileLyricsEnabled) {
    if (lyricsCache.has(currentTrack.videoId)) {
      currentLyrics = lyricsCache.get(currentTrack.videoId);
      lyricsStatus = 'loaded';
      renderLyrics(currentTrack);
    } else if (playerReady && player && player.getVideoData?.().video_id === currentTrack.videoId && player.getPlayerState?.() === window.YT?.PlayerState?.PLAYING) {
      loadMobileLyrics(currentTrack);
    } else {
      lyricsStatus = 'loading';
      renderLyricsMessage('Lyrics will load when the song starts.');
    }
  }
}
function seekFromLyricLine(button) {
  const targetTime = Number(button.dataset.lyricTime);
  if (!Number.isFinite(targetTime) || !playerReady || !player) return;
  player.seekTo(targetTime, true);
  syncActiveLyricLine(targetTime, true);
}
function shuffleTracks(tracks) { const result = tracks.slice(); for (let index = result.length - 1; index > 0; index -= 1) { const swap = Math.floor(Math.random() * (index + 1)); [result[index], result[swap]] = [result[swap], result[index]]; } return result; }
function bestThumbnail(thumbnails) { return thumbnails?.uhd?.url || thumbnails?.qhd?.url || thumbnails?.fhd?.url || thumbnails?.maxres?.url || thumbnails?.standard?.url || thumbnails?.high?.url || thumbnails?.medium?.url || thumbnails?.default?.url || ''; }
async function resolveHighestThumbnail(track) {
  if (!track?.videoId) return;
  const videoId = track.videoId;
  try {
    const data = await apiGet(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}`);
    const thumbnail = bestThumbnail(data.items?.[0]?.snippet?.thumbnails);
    if (!thumbnail || currentTrack?.videoId !== videoId) return;
    currentTrack.thumbnail = thumbnail;
    if (state.lastPlayedTrack?.videoId === videoId) state.lastPlayedTrack.thumbnail = thumbnail;
    updateCurrentUI();
    saveState();
  } catch { /* Keep the best thumbnail already returned with the video. */ }
}
function renderRecentSearches() { $('#recentSearches').innerHTML = state.recentSearches.map((query) => `<option value="${escapeHtml(query)}"></option>`).join(''); }
function recordSearch(query) { const clean = query.trim(); if (!clean) return; state.recentSearches = [clean, ...state.recentSearches.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 8); saveState(); renderRecentSearches(); }
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

function renderSetupState(message = 'Add your YouTube API key in Settings to browse live results.', showSettings = true) {
  resultsList.innerHTML = `<div class="browse-empty"><span class="empty-glyph">⌕</span><h3>Connect the catalog.</h3><p>${escapeHtml(message)}</p><div class="empty-actions"><button class="secondary-button" id="retryCatalog">Try again</button>${showSettings ? '<button class="primary-button" id="openSettingsFromEmpty">Open settings</button>' : ''}</div></div>`;
  $('#openSettingsFromEmpty')?.addEventListener('click', openSettings);
  $('#retryCatalog')?.addEventListener('click', () => currentView === 'home' ? loadTrending() : searchYouTube(true));
  $('#loadMore').hidden = true;
}

function renderResults(items = currentResults) {
  currentResults = items;
  if (!items.length) { resultsList.innerHTML = '<div class="browse-empty"><span class="empty-glyph">∅</span><h3>No results found.</h3><p>Try a different search or choose another result type.</p></div>'; $('#loadMore').hidden = true; return; }
  resultsList.innerHTML = items.map((item, index) => {
    const isVideo = item.kind === 'video';
    const action = isVideo ? `<button class="result-menu-trigger" data-menu-index="${index}" aria-label="More options for ${escapeHtml(item.title)}">•••</button>` : item.kind === 'playlist' ? `<button class="result-action open-playlist" data-playlist-id="${escapeHtml(item.playlistId)}" data-playlist-title="${escapeHtml(item.title)}" aria-label="Open ${escapeHtml(item.title)}">↗</button>` : `<a class="result-action" href="https://www.youtube.com/channel/${encodeURIComponent(item.channelId)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(item.title)} on YouTube">↗</a>`;
    const kindLabel = item.kind === 'video' ? 'VIDEO' : item.kind === 'playlist' ? 'PLAYLIST' : 'CHANNEL';
    const savedBadge = isVideo && state.favorites.includes(trackKey(item)) ? '<span class="saved-badge">SAVED</span>' : '';
    return `<article class="result-card" data-result-card-index="${index}"><div class="result-thumb art-${escapeHtml(item.tone || 'blue')}">${thumbnailMarkup(item)}</div><div class="result-copy"><span class="result-kind">${kindLabel} ${savedBadge}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.artist || item.description || '')}</p></div><div class="result-actions">${action}</div></article>`;
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

function getLocalPlaylist(id) { return state.playlists.find((playlist) => playlist.id === id && playlist.local); }
function renamePlaylist(id = activeLibraryPlaylistId) {
  const playlist = getLocalPlaylist(id); if (!playlist) return;
  const title = window.prompt('Rename playlist', playlist.title);
  if (!title?.trim() || title.trim() === playlist.title) return;
  playlist.title = title.trim(); saveState(); renderPlaylists(); renderLibrary(); showToast('Playlist renamed.');
}
function deletePlaylist(id = activeLibraryPlaylistId) {
  const playlist = getLocalPlaylist(id); if (!playlist) return;
  if (!window.confirm(`Delete “${playlist.title}”? This cannot be undone unless you use the undo message.`)) return;
  const index = state.playlists.findIndex((item) => item.id === id);
  const removed = state.playlists.splice(index, 1)[0];
  activeLibraryPlaylistId = null; saveState(); renderPlaylists(); renderLibrary();
  const toast = $('#toast'); toast.textContent = `Deleted “${removed.title}”. Undo`; toast.classList.add('visible'); window.clearTimeout(showToast.timeout); showToast.timeout = window.setTimeout(() => toast.classList.remove('visible'), 4500);
  toast.onclick = () => { state.playlists.splice(index, 0, removed); saveState(); renderPlaylists(); renderLibrary(); toast.classList.remove('visible'); toast.onclick = null; showToast('Playlist restored.'); };
}
function duplicatePlaylist(id = activeLibraryPlaylistId) {
  const playlist = getLocalPlaylist(id); if (!playlist) return;
  state.playlists.unshift({ ...playlist, id: `local-${Date.now()}`, title: `${playlist.title} copy`, tracks: (playlist.tracks || []).slice() });
  saveState(); renderPlaylists(); renderLibrary(); showToast('Playlist duplicated.');
}
function clearPlaylist(id = activeLibraryPlaylistId) {
  const playlist = getLocalPlaylist(id); if (!playlist || !(playlist.tracks || []).length) return showToast('This playlist is already empty.');
  if (!window.confirm(`Remove all songs from “${playlist.title}”?`)) return;
  playlist.tracks = []; saveState(); renderLibrary(); showToast('Playlist cleared.');
}
function movePlaylistTrack(id, index, direction) {
  const playlist = getLocalPlaylist(id); if (!playlist) return;
  const target = index + direction; if (target < 0 || target >= playlist.tracks.length) return;
  [playlist.tracks[index], playlist.tracks[target]] = [playlist.tracks[target], playlist.tracks[index]];
  saveState(); renderLibrary();
}

function extractPlaylistId(value) {
  try {
    const url = new URL(value.trim());
    const id = url.searchParams.get('list');
    return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : '';
  } catch { return ''; }
}

function extractChannelTarget(value) {
  try {
    const url = new URL(value.trim());
    const parts = url.pathname.split('/').filter(Boolean);
    const channelIndex = parts.findIndex((part) => part.toLowerCase() === 'channel');
    if (channelIndex >= 0 && parts[channelIndex + 1]) return { type: 'channelId', value: parts[channelIndex + 1] };
    const userIndex = parts.findIndex((part) => part.toLowerCase() === 'user');
    if (userIndex >= 0 && parts[userIndex + 1]) return { type: 'username', value: parts[userIndex + 1] };
    const handle = parts.find((part) => part.startsWith('@'));
    if (handle) return { type: 'handle', value: handle };
  } catch { /* invalid URL is handled by the caller */ }
  return null;
}

function setImportStatus(message, isError = false) {
  const status = $('#playlistImportStatus');
  status.textContent = message;
  status.classList.toggle('error', isError);
}

async function importPlaylistFromUrl(event) {
  event.preventDefault();
  const input = $('#playlistImportUrl');
  const submit = $('#playlistImportSubmit');
  const playlistId = extractPlaylistId(input.value);
  const channelTarget = extractChannelTarget(input.value);
  if (!playlistId && !channelTarget) return setImportStatus('Paste a valid YouTube playlist or artist channel link.', true);
  submit.disabled = true;
  setImportStatus(channelTarget ? 'Finding the artist’s uploads…' : 'Importing playlist…');
  try {
    let importId = playlistId;
    let title = 'Imported playlist';
    let importedFrom = playlistId;
    if (channelTarget) {
      const params = new URLSearchParams({ action: 'channel', maxResults: '1' });
      params.set(channelTarget.type, channelTarget.value);
      const channelData = await apiGet(`https://www.googleapis.com/youtube/v3/channels?${params.toString()}`);
      const channel = channelData.items?.[0];
      importId = channel?.contentDetails?.relatedPlaylists?.uploads || '';
      if (!channel || !importId) throw new Error('That artist channel could not be found or has no public uploads.');
      title = `${channel.snippet?.title || 'Artist'} — all songs`;
      importedFrom = `channel:${channel.id}`;
      const topSongs = await apiGet(`https://www.googleapis.com/youtube/v3/search?channelId=${encodeURIComponent(channel.id)}&order=viewCount&type=video&videoCategoryId=10&maxResults=25`);
      const tracks = (topSongs.items || []).filter((item) => item.id?.videoId).map((item) => ({ kind: 'video', videoId: item.id.videoId, title: item.snippet?.title, artist: item.snippet?.channelTitle || channel.snippet?.title || 'YouTube', thumbnail: bestThumbnail(item.snippet?.thumbnails), tone: 'coral' }));
      title = `${channel.snippet?.title || 'Artist'} — top songs`;
      if (!tracks.length) throw new Error('No music videos were found for that artist channel.');
      state.playlists.unshift({ id: `local-${Date.now()}`, title, local: true, importedFrom, tracks });
      saveState(); renderPlaylists(); renderLibrary(); input.value = ''; setImportStatus(`${tracks.length} top songs imported from “${title}”.`); showToast(`Imported “${title}”.`);
      return;
    }
    const [metadata, firstPage] = await Promise.all([
      apiGet(`https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&id=${encodeURIComponent(importId)}&maxResults=1&mine=false`),
      apiGet(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(importId)}&maxResults=50`)
    ]);
    const playlistInfo = metadata.items?.[0];
    if (!playlistInfo && !channelTarget) throw new Error('That playlist could not be found or is not public.');
    let items = firstPage.items || [];
    let pageToken = firstPage.nextPageToken || '';
    let pages = 1;
    const maxImportPages = channelTarget ? 100 : 4;
    while (pageToken && pages < maxImportPages) {
      const page = await apiGet(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(importId)}&maxResults=50&pageToken=${encodeURIComponent(pageToken)}`);
      items = items.concat(page.items || []);
      pageToken = page.nextPageToken || '';
      pages += 1;
    }
    const tracks = items.filter((item) => item.snippet?.resourceId?.videoId).map((item) => ({ kind: 'video', videoId: item.snippet.resourceId.videoId, title: item.snippet.title, artist: item.snippet.videoOwnerChannelTitle || 'YouTube', thumbnail: bestThumbnail(item.snippet.thumbnails), tone: 'coral' }));
    if (!channelTarget) title = playlistInfo.snippet.title || title;
    state.playlists.unshift({ id: `local-${Date.now()}`, title, local: true, importedFrom, tracks });
    saveState(); renderPlaylists(); renderLibrary(); input.value = ''; setImportStatus(`${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'} imported from “${title}”.`); showToast(`Imported “${title}”.`);
  } catch (error) {
    setImportStatus(error.message || 'The playlist could not be imported. Check the link and try again.', true);
  } finally { submit.disabled = false; }
}

function openLocalPlaylist(id, title) {
  if (!state.playlists.some((playlist) => playlist.id === id && playlist.local)) return;
  activeLibraryPlaylistId = id;
  setActiveView('library');
  renderLibrary();
}

function playLocalPlaylist() {
  const playlist = state.playlists.find((item) => item.id === activeLibraryPlaylistId && item.local);
  const tracks = playlist?.tracks || [];
  if (!tracks.length) return showToast('Add songs before playing this playlist.');
  startPlaylistPlayback(tracks, 0);
}

function startPlaylistPlayback(tracks, index) {
  if (!Array.isArray(tracks) || !tracks.length || !tracks[index]) return;
  activePlaybackTracks = tracks.slice();
  const remaining = tracks.filter((_, trackIndex) => trackIndex !== index);
  state.queue = shuffleEnabled ? shuffleTracks(remaining) : remaining;
  renderQueue();
  playTrack(tracks[index], true);
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

function closeTrackMenu() { $('#trackMenu').hidden = true; menuTrack = null; menuPlaylistId = null; menuTrackIndex = null; }

function openTrackMenu(track, trigger, playlistId = null, trackIndex = null) {
  if (!track) return;
  menuTrack = track;
  menuPlaylistId = playlistId;
  menuTrackIndex = trackIndex;
  const menu = $('#trackMenu');
  document.querySelectorAll('.menu-library-action').forEach((item) => { item.hidden = !playlistId; });
  document.querySelectorAll('.menu-playlist-action').forEach((item) => { item.hidden = true; });
  const bounds = trigger.getBoundingClientRect();
  menu.hidden = false;
  menu.style.top = `${Math.min(window.innerHeight - 112, bounds.bottom + 8)}px`;
  menu.style.left = `${Math.max(12, Math.min(window.innerWidth - 190, bounds.right - 178))}px`;
}

function openPlaylistMenu(trigger) {
  const playlist = getLocalPlaylist(activeLibraryPlaylistId); if (!playlist) return;
  menuPlaylistId = playlist.id;
  const menu = $('#trackMenu'); const bounds = trigger.getBoundingClientRect(); menu.hidden = false;
  document.querySelectorAll('.menu-library-action').forEach((item) => { item.hidden = true; });
  document.querySelectorAll('.menu-playlist-action').forEach((item) => { item.hidden = false; });
  menu.style.top = `${Math.min(window.innerHeight - 270, bounds.bottom + 8)}px`;
  menu.style.left = `${Math.max(12, Math.min(window.innerWidth - 210, bounds.right - 198))}px`;
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
  const activePlaylist = localPlaylists.find((playlist) => playlist.id === activeLibraryPlaylistId);
  $('#libraryPlaylists').hidden = Boolean(activePlaylist);
  $('#libraryDetail').hidden = !activePlaylist;
  if (activePlaylist) {
    const tracks = activePlaylist.tracks || [];
    $('#libraryPlayPlaylist').disabled = !tracks.length;
    $('#libraryDetailTitle').textContent = activePlaylist.title;
    $('#libraryDetailMeta').textContent = `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`;
    $('#libraryTrackList').innerHTML = tracks.length ? tracks.map((track, index) => `<article class="library-track-row" data-library-track-index="${index}"><div class="library-track-thumb">${thumbnailMarkup(track)}</div><div class="library-track-copy"><strong>${escapeHtml(track.title)}</strong><small>${escapeHtml(track.artist || 'YouTube')}</small></div><button class="library-track-more" data-library-track-menu="${index}" aria-label="More options for ${escapeHtml(track.title)}">•••</button><button class="library-track-remove" data-remove-library-track="${index}" aria-label="Remove ${escapeHtml(track.title)} from ${escapeHtml(activePlaylist.title)}">×</button></article>`).join('') : '<div class="library-track-empty"><strong>This playlist is empty.</strong><p>Use Browse and the ••• menu to add songs here.</p></div>';
  } else {
  $('#libraryPlaylists').innerHTML = localPlaylists.length ? localPlaylists.map((playlist) => `<button class="library-playlist-card" data-library-playlist="${escapeHtml(playlist.id)}" data-playlist-title="${escapeHtml(playlist.title)}"><span class="library-playlist-art"><img src="fuecoco-playlist-cover.png" alt="" /></span><span class="library-playlist-copy"><strong>${escapeHtml(playlist.title)}</strong><small>${(playlist.tracks || []).length} ${(playlist.tracks || []).length === 1 ? 'song' : 'songs'}</small></span><span class="library-playlist-arrow">›</span></button>`).join('') : '<div class="library-empty"><span>＋</span><strong>Your library is empty.</strong><p>Create a playlist and start collecting songs.</p><button class="primary-button" id="createFirstPlaylist">Create playlist</button></div>';
  }
  $('#createFirstPlaylist')?.addEventListener('click', createPlaylistFromPrompt);
}

function setConnectionState() {
  $('#syncTitle').textContent = 'Local mode';
  $('#syncSubtitle').textContent = 'Saved on this device';
  renderSyncConnection();
}

function updateCurrentUI() {
  const controls = ['#playPause', '#noteCurrent', '#favoriteCurrent'];
  controls.forEach((selector) => { $(selector).disabled = !currentTrack?.videoId; });
  $('#nowTitle').textContent = currentTrack?.title || 'Nothing selected';
  $('#nowArtist').textContent = currentTrack?.artist || 'Search YouTube to begin';
  $('#nowThumb').innerHTML = currentTrack ? thumbnailMarkup(currentTrack) : '<span>♪</span>';
  const mobileControls = ['#mobilePlayPause', '#mobileLyricsToggle'];
  mobileControls.forEach((selector) => { const element = $(selector); if (element) element.disabled = !currentTrack?.videoId; });
  const mobileTitle = $('#mobileNowTitle'); const mobileArtist = $('#mobileNowArtist'); const mobileArt = $('#mobilePlayerArt');
  const mobileBackdrop = $('#mobilePlayerBackdrop');
  if (mobileTitle) mobileTitle.textContent = currentTrack?.title || 'Nothing selected';
  if (mobileArtist) mobileArtist.textContent = currentTrack?.artist || 'Search YouTube to begin';
  if (mobileArt) mobileArt.innerHTML = currentTrack ? thumbnailMarkup(currentTrack) : '<span>♪</span>';
  if (mobileBackdrop) mobileBackdrop.style.backgroundImage = currentTrack?.thumbnail ? `url(${JSON.stringify(currentTrack.thumbnail)})` : '';
  const liked = currentTrack && state.favorites.includes(trackKey(currentTrack));
  $('#favoriteCurrent').textContent = liked ? '♥' : '♡';
  $('#favoriteCurrent').classList.toggle('liked', Boolean(liked));
}

function setCurrent(track, announce = true) {
  if (!track) return;
  const previousKey = trackKey(state.lastPlayedTrack); currentTrack = track; state.lastPlayedTrack = track; if (trackKey(track) !== previousKey) state.lastPosition = 0;
  if (trackKey(track) !== previousKey) {
    currentLyrics = null;
    lyricsStatus = mobileLyricsEnabled ? 'loading' : 'idle';
    lyricsLoadingVideoId = null;
    window.clearTimeout(lyricsScrollTimer);
    lyricsScrollTimer = null;
    lyricsRequestSerial += 1;
    currentLyricLineIndex = -1;
    if (mobileLyricsEnabled) renderLyricsMessage('Lyrics will load when the song starts.');
  }
  updateCurrentUI();
  resolveHighestThumbnail(track);
  if (!state.history.some((entry) => trackKey(entry.track) === trackKey(track))) state.history.unshift({ track, playedAt: new Date().toISOString() });
  state.history = state.history.slice(0, 50); saveState(); renderLibrary();
  if (announce) showToast(`Playing “${track.title}”`);
}

function loadScript(src, id) {
  return new Promise((resolve, reject) => { if (document.getElementById(id)) return resolve(); const script = document.createElement('script'); script.id = id; script.src = src; script.onload = resolve; script.onerror = reject; document.head.appendChild(script); });
}

function startProgressTimer() {
  window.clearInterval(progressTimer);
  progressTimer = window.setInterval(() => {
    if (!playerReady || !player) return;
    const current = player.getCurrentTime();
    const duration = player.getDuration();
    syncActiveLyricLine(current);
    const percent = duration ? (current / duration) * 100 : 0;
    const fill = $('.player-progress .progress-fill');
    const seek = $('#progressSeek');
    const mobileSeek = $('#mobileProgressSeek');
    state.lastPlayedTrack = currentTrack;
    state.lastPosition = current;
    if (Math.floor(current) % 5 === 0) saveState();
    if (fill && duration) fill.style.width = `${percent}%`;
    if (seek && !seek.matches(':active')) {
      seek.value = String(percent);
      seek.disabled = !duration;
    }
    if (mobileSeek && !mobileSeek.matches(':active')) {
      mobileSeek.value = String(percent);
      mobileSeek.style.setProperty('--mobile-seek-progress', `${percent}%`);
      mobileSeek.disabled = !duration;
    }
    const labels = document.querySelectorAll('.player-progress span');
    if (labels.length === 2) {
      labels[0].textContent = formatSeconds(current);
      labels[1].textContent = formatSeconds(duration);
    }
    const mobileCurrent = $('#mobileCurrentTime');
    const mobileDuration = $('#mobileDuration');
    if (mobileCurrent) mobileCurrent.textContent = formatSeconds(current);
    if (mobileDuration) mobileDuration.textContent = formatSeconds(duration);
  }, 250);
}

function previewSeek() {
  const seek = $('#progressSeek');
  const fill = $('.player-progress .progress-fill');
  if (seek && fill) fill.style.width = `${seek.value}%`;
}

function previewMobileSeek() {
  const seek = $('#mobileProgressSeek');
  if (seek) seek.style.setProperty('--mobile-seek-progress', `${seek.value}%`);
}

function seekFromMobile() {
  const seek = $('#mobileProgressSeek');
  if (!seek || !playerReady || !player) return;
  const duration = player.getDuration();
  if (duration) player.seekTo((Number(seek.value) / 100) * duration, true);
}

function openMobilePlayer() {
  if (!currentTrack?.videoId) return;
  const overlay = $('#mobilePlayer');
  if (!overlay) return;
  overlay.hidden = false;
  mirrorMobilePlayerState();
  document.body.classList.add('mobile-player-open');
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}

function closeMobilePlayer() {
  const overlay = $('#mobilePlayer');
  if (!overlay) return;
  overlay.classList.remove('is-open');
  document.body.classList.remove('mobile-player-open');
  window.setTimeout(() => { if (!overlay.classList.contains('is-open')) overlay.hidden = true; }, 380);
}

function mirrorMobilePlayerState() {
  const play = $('#mobilePlayPause');
  if (play) { play.textContent = isPlaying ? '❚❚' : '▶'; play.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play'); }
  ['#mobileShuffle', '#mobileRepeat'].forEach((selector, index) => { const element = $(selector); const source = index === 0 ? $('#shuffle') : $('#repeat'); if (!element || !source) return; const active = source.classList.contains('toggled'); element.classList.toggle('toggled', active); element.setAttribute('aria-pressed', String(active)); if (index === 1) element.setAttribute('aria-label', repeatMode === 'off' ? 'Repeat off' : repeatMode === 'all' ? 'Repeat playlist' : 'Repeat song'); });
}

function swipeMobilePlaylist(direction) {
  if (mobileSwipeAnimating) return;
  if (!activePlaybackTracks.length || !currentTrack) return showToast('Swipe is available while a playlist is playing.');
  let nextTrack = null;
  if (direction > 0 && shuffleEnabled && state.queue.length) {
    nextTrack = state.queue.shift();
    renderQueue();
  } else {
    const currentIndex = activePlaybackTracks.findIndex((track) => trackKey(track) === trackKey(currentTrack));
    const nextIndex = currentIndex + direction;
    nextTrack = direction < 0 && shuffleEnabled ? state.history[1]?.track : activePlaybackTracks[nextIndex];
    if (!shuffleEnabled && nextTrack) {
      state.queue = activePlaybackTracks.slice(nextIndex + 1);
      if (direction < 0) state.queue.unshift(currentTrack);
      renderQueue();
    } else if (direction < 0 && nextTrack) state.queue.unshift(currentTrack);
  }
  if (!nextTrack) return showToast(direction > 0 ? 'You are at the end of this playlist.' : 'You are at the start of this playlist.');
  const content = $('#mobilePlayerTrackContent');
  const backdrop = $('#mobilePlayerBackdrop');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || !content) { playTrack(nextTrack, true); return; }
  mobileSwipeAnimating = true;
  const side = direction > 0 ? 'left' : 'right';
  content.classList.remove('mobile-track-swipe-left', 'mobile-track-swipe-right');
  backdrop?.classList.remove('mobile-track-swipe-left', 'mobile-track-swipe-right');
  void content.offsetWidth;
  content.classList.add(`mobile-track-swipe-${side}`);
  backdrop?.classList.add(`mobile-track-swipe-${side}`);
  window.setTimeout(() => { playTrack(nextTrack, true); }, 140);
  window.setTimeout(() => {
    content.classList.remove(`mobile-track-swipe-${side}`);
    backdrop?.classList.remove(`mobile-track-swipe-${side}`);
    mobileSwipeAnimating = false;
  }, 370);
}

function handleMobilePlayerTouchStart(event) {
  if (event.target.closest('button, input')) { mobileSwipeTracking = false; return; }
  const touch = event.changedTouches[0];
  mobileSwipeStartX = touch.clientX; mobileSwipeStartY = touch.clientY; mobileSwipeTracking = true;
}

function handleMobilePlayerTouchEnd(event) {
  if (!mobileSwipeTracking) return;
  mobileSwipeTracking = false;
  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - mobileSwipeStartX;
  const deltaY = touch.clientY - mobileSwipeStartY;
  if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
  swipeMobilePlaylist(deltaX < 0 ? 1 : -1);
}

function seekToPosition() {
  const seek = $('#progressSeek');
  if (!seek || !playerReady || !player) return;
  const duration = player.getDuration();
  if (duration) player.seekTo((Number(seek.value) / 100) * duration, true);
}

let playerInitializationPromise = null;
let youtubeApiPromise = null;

function loadYouTubeIframeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    let script = null;
    const timeout = window.setTimeout(() => {
      if (!window.YT?.Player) script?.remove();
      youtubeApiPromise = null;
      reject(new Error('YouTube player API timed out. Check the car display internet connection or content restrictions.'));
    }, 15000);
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { previousReady?.(); } catch (error) { console.warn('Previous YouTube API callback failed:', error); }
      window.clearTimeout(timeout);
      if (window.YT?.Player) resolve(window.YT);
      else {
        youtubeApiPromise = null;
        reject(new Error('YouTube loaded without exposing its player API.'));
      }
    };

    script = document.getElementById('youtube-iframe-api');
    if (!script) {
      script = document.createElement('script');
      script.id = 'youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        script.remove();
        youtubeApiPromise = null;
        reject(new Error('Could not download the official YouTube player API.'));
      };
      document.head.appendChild(script);
    } else {
      script.addEventListener('error', () => {
        window.clearTimeout(timeout);
        script.remove();
        youtubeApiPromise = null;
        reject(new Error('Could not download the official YouTube player API.'));
      }, { once: true });
    }
  });
  return youtubeApiPromise;
}

function youtubePlayerErrorMessage(code) {
  const messages = {
    2: 'YouTube rejected this video ID.',
    5: 'This video cannot play in the current browser or car display.',
    100: 'This video is unavailable, private, or has been removed.',
    101: 'The video owner does not allow playback in embedded players.',
    150: 'The video owner does not allow playback in embedded players.',
    153: 'YouTube did not receive the required referrer or app identification.'
  };
  return messages[code] || `The official YouTube player returned error ${code}.`;
}

function ensurePlayer() {
  if (playerReady && player) return Promise.resolve(player);
  if (playerInitializationPromise) return playerInitializationPromise;

  playerInitializationPromise = loadYouTubeIframeAPI().then((YT) => new Promise((resolve, reject) => {
    const embed = $('#youtubePlayer');
    embed?.setAttribute('aria-hidden', 'true');
    const readyTimeout = window.setTimeout(() => reject(new Error('The YouTube player did not become ready. Check the car display connection, then tap play again.')), 15000);
    try {
      player = new YT.Player('youtubePlayer', {
        height: '1',
        width: '1',
        videoId: '',
        playerVars: {
          controls: 0,
          playsinline: 1,
          rel: 0,
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady: () => {
            window.clearTimeout(readyTimeout);
            playerReady = true;
            resolve(player);
          },
          onError: (event) => {
            const error = new Error(youtubePlayerErrorMessage(event.data));
            showToast(error.message);
            if (!playerReady) {
              window.clearTimeout(readyTimeout);
              reject(error);
            }
          },
          onStateChange: (event) => {
            if (event.data === YT.PlayerState.PLAYING) {
              isPlaying = true;
              $('#playPause').textContent = '❚❚';
              mirrorMobilePlayerState();
              startProgressTimer();
              if (mobileLyricsEnabled && currentTrack && player.getVideoData?.().video_id === currentTrack.videoId) loadMobileLyrics(currentTrack);
            }
            if (event.data === YT.PlayerState.PAUSED) {
              isPlaying = false;
              $('#playPause').textContent = '▶';
              mirrorMobilePlayerState();
            }
            if (event.data === YT.PlayerState.ENDED) {
              if (repeatMode === 'one' && currentTrack) playTrack(currentTrack, true);
              else nextTrack();
            }
          }
        }
      });
    } catch (error) {
      reject(error);
    }
  })).catch((error) => {
    playerInitializationPromise = null;
    playerReady = false;
    player = null;
    throw error;
  });

  return playerInitializationPromise;
}

async function playTrack(track, preservePlaylistPlayback = false) {
  if (!track?.videoId) return showToast('That result cannot be played here.');
  if (!preservePlaylistPlayback && currentView === 'library' && activeLibraryPlaylistId) {
    const playlist = getLocalPlaylist(activeLibraryPlaylistId);
    const index = playlist?.tracks?.findIndex((item) => trackKey(item) === trackKey(track)) ?? -1;
    if (index >= 0) {
      activePlaybackTracks = playlist.tracks.slice();
      const remaining = playlist.tracks.filter((_, trackIndex) => trackIndex !== index);
      state.queue = shuffleEnabled ? shuffleTracks(remaining) : remaining;
      renderQueue();
    }
  }
  const resumeAt = trackKey(track) === trackKey(state.lastPlayedTrack) ? state.lastPosition : 0;
  if (!preservePlaylistPlayback) activePlaybackTracks = [];
  setCurrent(track, false);
  loadRecommendations(track);
  const startPlayback = () => {
    if (!playerReady || !player) return false;
    player.loadVideoById({ videoId: track.videoId, startSeconds: resumeAt > 5 ? resumeAt : 0 });
    player.playVideo();
    showToast(resumeAt > 5 ? `Resuming “${track.title}”` : `Playing “${track.title}”`);
    return true;
  };

  // Keep playVideo() in the original tap/click gesture whenever possible.
  // Awaiting the IFrame API first can consume the browser's autoplay permission.
  if (playerReady && player) {
    startPlayback();
  } else {
    showToast('YouTube player is starting. Tap the track again in a moment.');
    ensurePlayer().catch((error) => showToast(error.message || 'The official YouTube player could not load.'));
  }
}

function nextTrack() {
  if (state.queue.length) { const next = state.queue.shift(); renderQueue(); playTrack(next, true); return; }
  if (repeatMode === 'all' && activePlaybackTracks.length) { state.queue = shuffleEnabled ? shuffleTracks(activePlaybackTracks.slice()) : activePlaybackTracks.slice(); const next = state.queue.shift(); renderQueue(); playTrack(next, true); return; }
  showToast('Your queue is empty. Add a result to keep listening.');
}
function toggleShuffle() { shuffleEnabled = !shuffleEnabled; $('#shuffle').classList.toggle('toggled', shuffleEnabled); if (shuffleEnabled && state.queue.length > 1) { state.queue = shuffleTracks(state.queue); renderQueue(); } mirrorMobilePlayerState(); showToast(shuffleEnabled ? 'Shuffle on.' : 'Shuffle off.'); }
function toggleRepeat() { repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off'; $('#repeat').classList.toggle('toggled', repeatMode !== 'off'); $('#repeat').setAttribute('aria-label', `Repeat ${repeatMode}`); mirrorMobilePlayerState(); showToast(repeatMode === 'off' ? 'Repeat off.' : repeatMode === 'all' ? 'Repeating playlist.' : 'Repeating current song.'); }
function previousTrack() { if (playerReady && player.getCurrentTime() > 5) return player.seekTo(0); const previous = state.history[1]?.track; if (previous) playTrack(previous); else showToast('No previous track yet.'); }

async function apiGet(endpoint, authenticated = false) {
  const upstream = new URL(endpoint);
  const action = upstream.pathname.endsWith('/search') ? 'search' : upstream.searchParams.get('chart') ? 'trending' : upstream.pathname.endsWith('/playlistItems') ? 'playlist' : upstream.pathname.endsWith('/playlists') ? 'playlists' : upstream.pathname.endsWith('/channels') ? 'channel' : upstream.pathname.endsWith('/videos') ? 'video' : 'search';
  const params = new URLSearchParams(upstream.search);
  params.set('action', action);
  const headers = authenticated ? { Authorization: `Bearer ${state.accessToken}` } : {};
  const response = await fetch(`/api/youtube?${params.toString()}`, { headers });
  if (response.status === 401) { state.accessToken = ''; saveState(); setConnectionState(); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.error || 'YouTube request failed');
    error.status = response.status;
    error.reason = payload?.error?.errors?.[0]?.reason || '';
    throw error;
  }
  return payload;
}

function mapSearchResult(item) {
  if (item.id?.videoId) return { kind: 'video', videoId: item.id.videoId, title: item.snippet.title, artist: item.snippet.channelTitle, thumbnail: bestThumbnail(item.snippet.thumbnails), tone: 'blue' };
  if (item.id?.playlistId) return { kind: 'playlist', playlistId: item.id.playlistId, title: item.snippet.title, artist: item.snippet.channelTitle, thumbnail: bestThumbnail(item.snippet.thumbnails), tone: 'coral' };
  return { kind: 'channel', channelId: item.id?.channelId, title: item.snippet.title, artist: 'Channel', description: item.snippet.description, thumbnail: bestThumbnail(item.snippet.thumbnails), tone: 'yellow' };
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
    const data = await apiGet(endpoint); if (requestId !== requestSerial || currentView !== 'browse') return; const results = (data.items || []).map(mapSearchResult); nextPageToken = data.nextPageToken || ''; lastQuery = query; if (reset) recordSearch(query); $('#resultsHeading').textContent = `Results for “${query}”`; $('#resultsEyebrow').textContent = 'Search results'; $('#resultsMeta').textContent = `${results.length} loaded`; renderResults(reset ? results : [...currentResults, ...results]); if (reset) loadRecommendations(results.find((item) => item.kind === 'video'));
  } catch { if (requestId !== requestSerial || currentView !== 'browse') return; resultsList.innerHTML = '<div class="browse-empty"><span class="empty-glyph">!</span><h3>Search is unavailable.</h3><p>Search could not load right now. Try again in a moment.</p><button class="secondary-button" id="retrySearch">Try again</button></div>'; $('#retrySearch').addEventListener('click', () => searchYouTube(true)); $('#loadMore').hidden = true; }
}

async function loadTrending() {
  if (!hasApiKey()) return renderSetupState();
  const requestId = ++requestSerial;
  resultsList.innerHTML = '<div class="browse-empty"><span class="loading-mark">◌</span><h3>Loading music…</h3><p>Fetching what is moving right now.</p></div>';
  try { const data = await apiGet('https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&maxResults=12&videoCategoryId=10&regionCode=SG'); if (requestId !== requestSerial || currentView !== 'home') return; const results = (data.items || []).map((item) => ({ kind: 'video', videoId: item.id, title: item.snippet?.title, artist: item.snippet?.channelTitle, thumbnail: bestThumbnail(item.snippet?.thumbnails), tone: 'blue' })); nextPageToken = ''; $('#resultsEyebrow').textContent = 'Discovery · Singapore'; $('#resultsHeading').textContent = 'Trending now'; $('#resultsMeta').textContent = `${results.length} loaded`; renderResults(results); loadRecommendations(results[0]); } catch (error) { if (requestId !== requestSerial || currentView !== 'home') return; const quotaMessage = error?.status === 429 || error?.reason === 'rateLimitExceeded' || /quota/i.test(error?.message || ''); renderSetupState(quotaMessage ? 'YouTube’s daily API quota is exhausted. It will reset automatically, or you can request a higher quota in Google Cloud.' : 'Music discovery could not load right now. Check the YouTube API configuration.', !quotaMessage); }
}

async function openPlaylist(playlistId, title) {
  if (!hasApiKey()) return renderSetupState();
  resultsList.innerHTML = `<div class="browse-empty"><span class="loading-mark">◌</span><h3>Opening ${escapeHtml(title)}…</h3></div>`;
  try { const data = await apiGet(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(playlistId)}&maxResults=50`); const results = (data.items || []).filter((item) => item.snippet?.resourceId?.videoId).map((item) => ({ kind: 'video', videoId: item.snippet.resourceId.videoId, title: item.snippet.title, artist: item.snippet.videoOwnerChannelTitle || 'YouTube', thumbnail: bestThumbnail(item.snippet.thumbnails), tone: 'coral' })); $('#resultsHeading').textContent = title; $('#resultsEyebrow').textContent = 'Playlist'; $('#resultsMeta').textContent = `${results.length} tracks`; nextPageToken = ''; renderResults(results); } catch { showToast('Could not open that playlist.'); }
}

function toggleFavorite() { if (!currentTrack) return showToast('Play a result before saving it.'); const key = trackKey(currentTrack); state.favorites = state.favorites.includes(key) ? state.favorites.filter((item) => item !== key) : [...state.favorites, key]; saveState(); updateCurrentUI(); renderLibrary(); showToast(state.favorites.includes(key) ? 'Saved to favorites.' : 'Removed from favorites.'); }
function addNote() { if (!currentTrack) return; const key = trackKey(currentTrack); const note = window.prompt(`Note for “${currentTrack.title}”`, state.notes[key] || ''); if (note === null) return; if (note.trim()) state.notes[key] = note.trim(); else delete state.notes[key]; saveState(); showToast(note.trim() ? 'Note saved on this device.' : 'Note removed.'); }
function openSettings() { setConnectionState(); $('#settingsModal').hidden = false; }
function closeSettings() { $('#settingsModal').hidden = true; }
function exportLibrary() { const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), playlists: state.playlists, favorites: state.favorites, notes: state.notes, queue: state.queue, recentSearches: state.recentSearches, lastPlayedTrack: state.lastPlayedTrack, lastPosition: state.lastPosition }, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `lowkey-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); showToast('Backup exported.'); }
function importLibraryFile(event) { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const backup = JSON.parse(reader.result); if (!Array.isArray(backup.playlists)) throw new Error('Invalid backup'); state.playlists = backup.playlists; state.favorites = Array.isArray(backup.favorites) ? backup.favorites : []; state.notes = backup.notes || {}; state.queue = Array.isArray(backup.queue) ? backup.queue : []; state.recentSearches = Array.isArray(backup.recentSearches) ? backup.recentSearches : []; state.lastPlayedTrack = backup.lastPlayedTrack || null; state.lastPosition = Number(backup.lastPosition) || 0; currentTrack = state.lastPlayedTrack; saveState(); renderRecentSearches(); renderQueue(); renderPlaylists(); renderLibrary(); updateCurrentUI(); closeSettings(); showToast('Backup restored.'); } catch { showToast('That backup file is not valid.'); } event.target.value = ''; }; reader.readAsText(file); }
function resetLibrary() { const prompt = sharedPlaylistsVersion === null ? 'Reset playlists, queue, favorites, notes, and history on this device?' : 'Reset shared playlists for every device, plus queue, favorites, notes, and history on this device?'; if (!window.confirm(prompt)) return; state.playlists = []; state.queue = []; state.favorites = []; state.history = []; state.notes = {}; state.recentSearches = []; state.lastPlayedTrack = null; state.lastPosition = 0; currentTrack = null; activeLibraryPlaylistId = null; activePlaybackTracks = []; saveState(); renderRecentSearches(); renderQueue(); renderPlaylists(); renderLibrary(); updateCurrentUI(); closeSettings(); showToast('Library data reset.'); }
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

renderQueue(); renderPlaylists(); renderLibrary(); renderRecentSearches(); setConnectionState(); updateCurrentUI(); setActiveView('home');
// Warm up the official player before the first track is tapped. This avoids
// losing the browser's user-activation window while the iframe API downloads.
ensurePlayer().catch((error) => console.warn('YouTube player prewarm failed:', error));
loadSharedPlaylists();
window.setInterval(refreshSharedPlaylists, 15000);
window.addEventListener('online', refreshSharedPlaylists);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSharedPlaylists(); });
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
$('#playPause').addEventListener('click', () => {
  if (!currentTrack) return;
  if (playerReady && player) {
    if (isPlaying) player.pauseVideo();
    else player.playVideo();
    return;
  }
  showToast('YouTube player is still starting. Tap play again shortly.');
  ensurePlayer().catch((error) => showToast(error.message || 'The official player could not load.'));
});
$('#progressSeek').addEventListener('input', previewSeek); $('#progressSeek').addEventListener('change', seekToPosition);
$('.now-playing').addEventListener('click', (event) => { if (!event.target.closest('button')) openMobilePlayer(); });
$('#mobilePlayerClose').addEventListener('click', closeMobilePlayer);
$('#mobileLyricsToggle').addEventListener('click', toggleMobileLyrics);
$('#mobilePlayerLyrics').addEventListener('click', (event) => {
  const line = event.target.closest('[data-lyric-index]');
  if (line) return seekFromLyricLine(line);
  if (event.target.closest('[data-retry-lyrics]')) loadMobileLyrics(currentTrack, true);
});
$('#mobilePlayerLyrics').addEventListener('scroll', handleManualLyricsScroll, { passive: true });
$('#mobilePlayPause').addEventListener('click', () => $('#playPause').click());
$('#mobilePrevious').addEventListener('click', previousTrack); $('#mobileNext').addEventListener('click', nextTrack); $('#mobileShuffle').addEventListener('click', () => { toggleShuffle(); mirrorMobilePlayerState(); }); $('#mobileRepeat').addEventListener('click', () => { toggleRepeat(); mirrorMobilePlayerState(); });
$('#mobileProgressSeek').addEventListener('input', previewMobileSeek); $('#mobileProgressSeek').addEventListener('change', seekFromMobile);
$('#mobilePlayer').addEventListener('touchstart', handleMobilePlayerTouchStart, { passive: true }); $('#mobilePlayer').addEventListener('touchend', handleMobilePlayerTouchEnd, { passive: true });
$('#next').addEventListener('click', nextTrack); $('#previous').addEventListener('click', previousTrack); $('#shuffle').addEventListener('click', toggleShuffle); $('#repeat').addEventListener('click', toggleRepeat);
$('#favoriteCurrent').addEventListener('click', toggleFavorite); $('#noteCurrent').addEventListener('click', addNote); $('#settingsButton').addEventListener('click', openSettings); $('#topProfile').addEventListener('click', openSettings); $('#settingsClose').addEventListener('click', closeSettings); document.querySelector('[data-close-settings]').addEventListener('click', closeSettings); $('#connectPlaylistSync').addEventListener('click', connectSharedLibrary); $('#syncPassphrase').addEventListener('keydown', (event) => { if (event.key === 'Enter') connectSharedLibrary(); }); $('#disconnectPlaylistSync').addEventListener('click', disconnectSharedLibrary);
$('#newPlaylist').addEventListener('click', createPlaylistFromPrompt); $('#newPlaylistLibrary').addEventListener('click', createPlaylistFromPrompt);
$('#importPlaylistToggle').addEventListener('click', () => { const form = $('#playlistImportForm'); form.hidden = !form.hidden; if (!form.hidden) $('#playlistImportUrl').focus(); }); $('#playlistImportForm').addEventListener('submit', importPlaylistFromUrl);
$('#remotePlaylists').addEventListener('click', (event) => { const remote = event.target.closest('[data-remote-playlist]'); const local = event.target.closest('[data-local-playlist]'); if (remote) openPlaylist(remote.dataset.remotePlaylist, remote.dataset.playlistTitle); if (local) openLocalPlaylist(local.dataset.localPlaylist, local.dataset.playlistTitle); });
$('#libraryPlaylists').addEventListener('click', (event) => { const playlist = event.target.closest('[data-library-playlist]'); if (playlist) openLocalPlaylist(playlist.dataset.libraryPlaylist, playlist.dataset.playlistTitle); });
$('#libraryDetailBack').addEventListener('click', () => { activeLibraryPlaylistId = null; renderLibrary(); }); $('#libraryAddSongs').addEventListener('click', () => showView('browse')); $('#libraryManagePlaylist').addEventListener('click', (event) => openPlaylistMenu(event.currentTarget)); $('#libraryTrackList').addEventListener('click', (event) => { const remove = event.target.closest('[data-remove-library-track]'); const menu = event.target.closest('[data-library-track-menu]'); const row = event.target.closest('[data-library-track-index]'); const playlist = getLocalPlaylist(activeLibraryPlaylistId); if (!playlist) return; if (menu) { event.stopPropagation(); return openTrackMenu(playlist.tracks[Number(menu.dataset.libraryTrackMenu)], menu, playlist.id, Number(menu.dataset.libraryTrackMenu)); } if (remove) { playlist.tracks.splice(Number(remove.dataset.removeLibraryTrack), 1); saveState(); renderLibrary(); showToast('Removed from playlist.'); return; } if (row) playTrack(playlist.tracks[Number(row.dataset.libraryTrackIndex)]); });
$('#libraryTrackList').addEventListener('touchstart', (event) => { swipeStartX = event.changedTouches[0].clientX; }, { passive: true }); $('#libraryTrackList').addEventListener('touchend', (event) => { const delta = event.changedTouches[0].clientX - swipeStartX; const row = event.target.closest('[data-library-track-index]'); const playlist = getLocalPlaylist(activeLibraryPlaylistId); if (playlist && row && delta < -70) { playlist.tracks.splice(Number(row.dataset.libraryTrackIndex), 1); saveState(); renderLibrary(); showToast('Removed from playlist.'); } }, { passive: true });
$('#libraryPlayPlaylist').addEventListener('click', playLocalPlaylist);
$('#playlistPickerClose').addEventListener('click', closePlaylistPicker); document.querySelector('[data-close-playlist-picker]').addEventListener('click', closePlaylistPicker); $('#playlistPickerList').addEventListener('click', (event) => { const pick = event.target.closest('[data-pick-playlist]'); if (pick) addToLocalPlaylist(pick.dataset.pickPlaylist); }); $('#createPlaylistFromPicker').addEventListener('click', () => { const title = $('#newPlaylistName').value; if (!title.trim()) return; createLocalPlaylist(title); $('#newPlaylistName').value = ''; renderPlaylistPicker(); });
$('#menuAddPlaylist').addEventListener('click', () => { const track = menuTrack; closeTrackMenu(); openPlaylistPicker(track); }); $('#menuAddQueue').addEventListener('click', () => { if (!menuTrack) return; state.queue.push(menuTrack); renderQueue(); showToast('Added to queue.'); closeTrackMenu(); }); $('#menuRemovePlaylist').addEventListener('click', () => { const playlist = getLocalPlaylist(menuPlaylistId); if (playlist && menuTrackIndex !== null) { playlist.tracks.splice(menuTrackIndex, 1); saveState(); renderLibrary(); showToast('Removed from playlist.'); } closeTrackMenu(); }); $('#menuMoveUp').addEventListener('click', () => { movePlaylistTrack(menuPlaylistId, menuTrackIndex, -1); closeTrackMenu(); }); $('#menuMoveDown').addEventListener('click', () => { movePlaylistTrack(menuPlaylistId, menuTrackIndex, 1); closeTrackMenu(); }); $('#menuRenamePlaylist').addEventListener('click', () => { renamePlaylist(menuPlaylistId); closeTrackMenu(); }); $('#menuDuplicatePlaylist').addEventListener('click', () => { duplicatePlaylist(menuPlaylistId); closeTrackMenu(); }); $('#menuClearPlaylist').addEventListener('click', () => { clearPlaylist(menuPlaylistId); closeTrackMenu(); }); $('#menuDeletePlaylist').addEventListener('click', () => { deletePlaylist(menuPlaylistId); closeTrackMenu(); }); document.addEventListener('click', (event) => { if (!event.target.closest('#trackMenu') && !event.target.closest('[data-menu-index]') && !event.target.closest('[data-library-track-menu]') && !event.target.closest('#libraryManagePlaylist')) closeTrackMenu(); });
$('#recommendationList').addEventListener('click', (event) => { const play = event.target.closest('[data-recommendation-index]'); const add = event.target.closest('[data-recommendation-add-index]'); if (play) playTrack(recommendationItems[Number(play.dataset.recommendationIndex)]); if (add) { state.queue.push(recommendationItems[Number(add.dataset.recommendationAddIndex)]); renderQueue(); showToast('Added to queue.'); } }); $('#refreshRecommendations').addEventListener('click', () => loadRecommendations(recommendationSeed || currentTrack || currentResults.find((item) => item.kind === 'video')));
$('#menuPlayNext').addEventListener('click', () => { if (!menuTrack) return; state.queue.unshift(menuTrack); renderQueue(); showToast('Playing next.'); closeTrackMenu(); });
$('#exportLibrary').addEventListener('click', exportLibrary); $('#importLibrary').addEventListener('click', () => $('#importLibraryFile').click()); $('#importLibraryFile').addEventListener('change', importLibraryFile); $('#resetLibrary').addEventListener('click', resetLibrary);
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { if (button.dataset.view === 'library') activeLibraryPlaylistId = null; showView(button.dataset.view); }));
document.addEventListener('keydown', (event) => { if (event.target.matches('input, textarea, button')) return; if (event.code === 'Space') { event.preventDefault(); $('#playPause').click(); } if (event.code === 'ArrowRight') nextTrack(); if (event.code === 'ArrowLeft') previousTrack(); });



