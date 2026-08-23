# Lowkey — Fuecoco Brand Guidelines

## Brand idea

Lowkey is a personal music desk with a warm, playful personality: easy to use, slightly quirky, and built around returning to the songs that feel good. Fuecoco becomes the friendly host of the experience rather than a decorative logo pasted onto the interface.

**Brand traits:** warm, playful, curious, cozy, musical, readable.

**Design signature:** soft cream surfaces, ember-orange accents, rounded forms, small moments of surprise, and generous breathing room around music rows.

## Mascot direction

Use Fuecoco as the profile/avatar mascot in the personal account area and as an occasional empty-state companion.

### Recommended placements

- Profile avatar in the sidebar and top bar
- Empty Library state
- First-run or offline-state illustration
- Small celebration moment after creating or importing a playlist

### Avatar treatment

- Crop to the head and upper shoulders so the face remains recognizable at small sizes.
- Use a circular or softly rounded-square frame with a cream background.
- Keep the original character colors intact; do not apply duotone filters.
- Use 32–40px for navigation avatars and 72–96px for empty states.
- Keep a clear 8–12% visual margin around the character so the snout and flame are not clipped.

### Mascot rules

- Fuecoco is a companion, not the primary navigation icon.
- Never place text over the mascot artwork.
- Avoid stretching, rotating, recoloring, or adding artificial shadows directly to the character.
- Keep expressions and proportions friendly and unobstructed.
- For a public commercial launch, review Pokémon/Nintendo usage rights. This guideline assumes personal use.

## Color system

The palette is derived from Fuecoco’s cream body, ember-red body, yellow flame, dark mouth, and slate claws.

| Token | Hex | Use |
| --- | --- | --- |
| Ember | `#D94D32` | Primary action, active states, playback progress |
| Coral | `#EF7255` | Hover accents, notifications, warm highlights |
| Flame | `#F3C94B` | Main play button, focus rings, important emphasis |
| Cream | `#FFF8E8` | Light surfaces, mascot background, readable text areas |
| Charcoal | `#1A1918` | Main dark background and high-contrast text |
| Cocoa | `#48313A` | Secondary dark accent inspired by Fuecoco’s mouth |
| Slate | `#59616A` | Muted controls, metadata, claw-inspired neutral |
| Mist | `#E6E4DC` | Borders, dividers, disabled backgrounds |

### Contrast guidance

- Use Charcoal text on Cream surfaces.
- Use Cream text on Ember or Charcoal surfaces.
- Use Flame for accents and focus indicators, not long paragraphs.
- Do not use Slate for important text on dark backgrounds unless contrast is verified.

## Typography

### Preferred typeface

Use **Circular** or **Circular Std** if the appropriate license is available. Its rounded geometry fits the playful mascot while keeping music metadata highly readable.

### Fallback stack

```css
font-family: "Circular Std", "Circular", "Inter", system-ui, sans-serif;
```

If Circular is not available, use Inter rather than trying to imitate the font with decorative alternatives.

### Type hierarchy

- Page title: 40–64px, bold, tight tracking
- Section title: 22–28px, semibold
- Track title: 14–16px, medium
- Artist and metadata: 12–13px, regular
- Labels and utility text: 10–11px, medium, uppercase only when short

Keep line height comfortable. Readability takes priority over the condensed typography used in the current prototype.

## UI structure

### Navigation

- Keep Home, Browse, and Library as the main destinations.
- Use Fuecoco in the profile area, not as a replacement for the Library icon.
- Active navigation uses a small Ember indicator and a soft Cream/Ember tint.

### Music rows

- Never place text over album art or mascot art.
- Use a clear left thumbnail, a spacious text block, and actions aligned to the right.
- Maintain at least 16px vertical padding between rows on mobile.
- Keep the three-dot action easy to tap with a minimum 44px target.
- Make the whole row play the track, while secondary actions remain independently clickable.

### Buttons

- Primary: Flame fill with Charcoal text.
- Secondary: transparent or Cream-tinted surface with a 1px Mist border.
- Destructive/remove: transparent with Coral hover treatment.
- Use short labels: “Play playlist”, “Import playlist”, “Add songs”.
- Avoid pill-shaped buttons everywhere; reserve them for filters or compact status tags.

### Cards and surfaces

- Use 10–14px corner radii.
- Use thin borders before heavy shadows.
- Keep backgrounds quiet so thumbnails and titles remain the focus.
- Use one strong accent per surface; do not combine Ember, Flame, and Coral at full intensity in the same card.

## Motion

- Playlist creation: a short upward fade with a subtle Flame highlight.
- Playing a song: progress and active states transition smoothly over 180–240ms.
- Mascot appearances: gentle scale from 96% to 100%, never a bounce-heavy animation.
- Respect `prefers-reduced-motion`.

## Voice and copy

Write like a friendly music companion, not a technical dashboard.

Prefer:

- “Your library is ready.”
- “Add a few songs to get started.”
- “Fuecoco found a warm little loop for you.”

Avoid:

- “No data available.”
- “Execute import.”
- Overly loud Pokémon references in every message.

## Revamp priorities

1. Replace the profile avatar with a properly cropped Fuecoco asset.
2. Move the UI toward the Cream/Charcoal/Ember palette with Flame as the playback accent.
3. Replace the current condensed display treatment with Circular or the fallback stack.
4. Increase mobile row spacing and tap target sizes.
5. Simplify cards and remove unnecessary decorative content competing with the music.
6. Add mascot moments only where they improve orientation or delight.

## Implementation note

The current website already has a dark music-desk foundation. The revamp should preserve the working YouTube playback, search, playlist, import, queue, and mobile seek behavior while progressively replacing the visual layer.

