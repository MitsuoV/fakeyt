# Mitsuo's Corner iOS build

This project wraps the existing website with Capacitor. The website remains in `outputs/`, so the current YouTube playback, playlists, mobile player, swipe navigation, and branding are reused as-is.

## Build on macOS

```bash
npm install
npm run ios:add
npm run ios:sync
npm run ios:open
```

In Xcode:

1. Select the `App` target and set your Apple Developer Team under Signing & Capabilities.
2. Choose a connected iPhone or an archive destination.
3. Build to a device, or use Product → Archive and export the signed `.ipa`.

If the `ios/` folder already exists, run `npm run ios:sync` instead of `npm run ios:add`.

The app uses the official YouTube embedded player. Background playback and lock-screen behavior remain subject to iOS and YouTube player policies.

