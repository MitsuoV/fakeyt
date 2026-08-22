# Lowkey — personal music desk

Open `index.html` in a browser to use the personal music desk.

This version is a UI prototype with demo data. It includes:

- live YouTube search across music videos, videos, playlists, and channels
- music region filters and trending music
- paginated search with load-more results
- playlist and channel browsing
- official YouTube IFrame playback with progress and next/previous controls
- queue management, favorites, notes, and listening history
- Google OAuth playlist import
- browser-local persistence for personal data

## Connect YouTube

Open the profile button in the lower-left corner and enter:

1. A YouTube Data API v3 API key.
2. A Google OAuth Web client ID.

Enable the YouTube Data API v3 in Google Cloud Console and add the page origin to the OAuth client’s allowed JavaScript origins. Then save the credentials and choose **Connect Google**.

Credentials and personal state are kept in this browser. Use a local web server rather than opening the file directly if your OAuth client rejects the `file://` origin.

Keyboard shortcuts: `Space` toggles playback, `←` goes to the previous track, and `→` goes to the next track.

