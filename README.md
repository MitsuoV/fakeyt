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

The app now keeps the YouTube API key on the Vercel server. In Vercel, add this environment variable for Production and Preview:

```text
YOUTUBE_API_KEY=your-restricted-key
```

Do not put the API key in the browser, GitHub, or this repository. Redeploy after saving the variable.

Then open the profile button and enter the Google OAuth Web client ID. Choose **Connect Google** to authorize private playlist access.

Enable the YouTube Data API v3 in Google Cloud Console and add the page origin to the OAuth client’s allowed JavaScript origins. Then save the credentials and choose **Connect Google**.

The OAuth access token and personal library are still browser-local in this stage. A database-backed session layer is the next step for syncing favorites, notes, queue, and history across devices.

Keyboard shortcuts: `Space` toggles playback, `←` goes to the previous track, and `→` goes to the next track.

