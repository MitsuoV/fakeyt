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
- browser-local persistence for queue, favorites, notes, and listening history
- one shared playlist library across devices, protected by a single passphrase

## Connect YouTube

The app now keeps the YouTube API key on the Vercel server. In Vercel, add this environment variable for Production and Preview:

```text
YOUTUBE_API_KEY=your-restricted-key
```

Do not put the API key in the browser, GitHub, or this repository. Redeploy after saving the variable.

Then open the profile button and enter the Google OAuth Web client ID. Choose **Connect Google** to authorize private playlist access.

Enable the YouTube Data API v3 in Google Cloud Console and add the page origin to the OAuth client’s allowed JavaScript origins. Then save the credentials and choose **Connect Google**.

## Enable shared playlists

Playlist sync uses one shared library for your devices; it does not create separate user accounts. In Vercel, add an Upstash Redis database from the Marketplace, then add these Production environment variables (Vercel provides the first two when the integration is connected):

```text
UPSTASH_REDIS_REST_URL=...          # provided by Upstash
UPSTASH_REDIS_REST_TOKEN=...        # provided by Upstash
LOWKEY_SYNC_PASSPHRASE=...          # choose a long, private phrase
LOWKEY_SYNC_SESSION_SECRET=...      # generate a separate random secret
```

Generate the two Lowkey secrets separately, keep them private, and never commit them. Redeploy after adding the variables. On each device, open Settings and enter the same passphrase once. The browser keeps a secure session cookie; the passphrase itself is not saved. Playlists are shared, while the YouTube access token, queue, favorites, notes, and listening history stay on each device.

If the shared store is empty, connecting the first device uploads its existing playlists. On later devices, connecting loads the shared playlists and replaces that device's local playlist list. Keep a backup before setting up sync if those devices have different playlists.

Keyboard shortcuts: `Space` toggles playback, `←` goes to the previous track, and `→` goes to the next track.


