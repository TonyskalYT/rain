# Working on this fork

Charles's fork of the ra1ncord Discord Android mod. His phone (Samsung Galaxy S24, Android 16, Discord 344.x) loads
`https://github.com/TonyskalYT/rain/releases/latest/download/rain.js`. Every push to `main` runs
`.github/workflows/release.yml`, which rebuilds and republishes the `latest` release.

All custom features live in the **Cheeseburger** plugin (`src/cheeseburger/`), which hot reloads on the phone without restarting Discord.

## Rules

- Push only to `origin` (TonyskalYT/rain), branch `main`.
- Commit as Charles, with no co-author or session trailers:
  `git -c user.name="Charles" -c user.email="tonyskalyt@gmail.com" commit -m "short lowercase message"`
- No comments in fork code.
- Never bump versions. The plugin stays name "Cheeseburger", version "-69", description "Fuck discord", author TonyskalYT.
- Text shown in the app stays short, lowercase and casual. No toasts on the split button.
- Never delete GitHub Actions runs. Never force a Discord reload from code.
- Keep the core (everything outside `src/cheeseburger/`) unchanged, so the core revision printed by the build stays the same (currently `970e34e`). Any core change means Charles has to fully restart Discord instead of getting a live update.
- Cheeseburger may only import the modules listed in `src/api/hot/registry.ts` (plus relative imports inside `src/cheeseburger/`).

## Build and check

```
node scripts/build.mjs          # builds cheeseburger first, then rain.js; prints both revisions
npx eslint src/cheeseburger     # use --fix for import order
npx tsc --noEmit -p .           # filter output for src/cheeseburger
```

After pushing, check `https://github.com/TonyskalYT/rain/releases/latest/download/cheeseburger.json`.
Its `revision` should match what the build printed. Poll a few times, then stop: don't loop for minutes.
If the release comes back 404, the `latest` release was left as a draft. Push an empty commit to republish it.

## How hot reload works

- `dist/cheeseburger.js` and `cheeseburger.json` are published next to `rain.js`. The phone polls about every 10 seconds.
- When a new revision appears, the old copy's `stop()` runs, then the new copy's `start()`, with
  `globalThis.__cheeseburgerSwapping = true` during the swap.
- Anything that must survive a swap is handed off through `globalThis.__cheeseburger*`. Existing examples are split state, PiP state and the crash log.

## Safety rules (these have caused crashes before)

- Patcher hooks (before, after, instead) aren't wrapped in try/catch. A throwing hook breaks the Discord function it patches.
  Wrap every hook, timer and listener with `safe()` or `safeInstead()` from `crash.ts`.
- Errors thrown inside timers, listeners or native callbacks close the app.
- Never let an `instead` patch skip calling `orig` for a React component. Its hook count changes when the patch toggles, and React throws.
- Any component we inject gets wrapped in a small class error boundary (`Guard`).
- Android PiP throws for aspect ratios outside 0.418 to 2.39, so they're clamped in `split/pip.ts`.
- Reanimated animated style handles look like `{viewDescriptors, initial: {value}}`.

## Feature map (`src/cheeseburger/`)

| File | Feature |
|---|---|
| `index.ts`, `features.ts`, `storage.ts` | Plugin entry, feature toggles |
| `settings.tsx` | Settings page |
| `crash.ts` | Crash log in `documents/rain/cheeseburger-crash.json`, plus `safe` and `safeInstead` |
| `debug/` | One report of everything, anonymized, uploaded to Charles's private debug repo |
| `volume/` | Volume boost past 200% |
| `deafen/` | Deafen button on the call toolbar |
| `toolbar.tsx` | Clones Discord's soundboard toolbar button so the added buttons match Discord's look and colors |
| `split/` | Split view |
| `split/pip.ts` | PiP shape, smart PiP (never shows you, sticks to streams), PiP pins |
| `split/PipPin.tsx` | Old tile pin buttons, now switched off |
| `rotate/` | Rotate button |
| `share/` | Moves "share screen" from the toolbar into the swipe-up menu |
| `voice/` | "voice effects" row in the swipe-up menu that opens a sheet: presets, mic volume past 100%, distortion, lo-fi, reset |
| `style/` | GX-style bevels: top-left and bottom-right corners cut. `shapes.tsx` draws the cut shape |
| `updates/` | Hot updates and the "Update now" button |

Details for `split/`:
- `tiles.tsx` does the layout by writing each tile's `sharedCoords`.
- `layout.ts` handles focus, full screen and rotation.
- `probe.tsx` does the measuring.

## Discord internals learned from debug reports

**Theme updates**
- "Update now" compares the fetched theme with the stored one. The core runs colors through chroma, which rounds alpha (`#0a0607b2` is stored as `#0a0607b3`), so colors are compared as rgb plus alpha rounded to 2 decimals (`hexColor` in `updates/index.tsx`). Comparing raw strings made it report "1 theme updated" every time.

**Call toolbar**
- Toolbar buttons: `modules/.../VoicePanelSoundboardButton.tsx` and `VoicePanelScreenshareButton.tsx`, both default exports, built on `AnimatedButtonWrapper`.
- Swipe-up menu rows: `VoicePanelVoiceControlsButtons.tsx` (ChatButton, ScreenshareButton, and others).
- Whether the call controls are showing: `modules/video_calls/native/ChannelCallStore.tsx` exports a zustand store, `useChannelCallStore`, with a `focus` flag.
  - Which value means "shown" is learned at runtime and saved as `splitViewSettings.focusWhenShown`.

**PiP**
- The PiP video comes from `external_pip/useExternalPipParticipant.android.tsx` (default export).
  - It returns `{channelId, selectedParticipantStreamId, selectedParticipantUserId, selectedParticipantSpeaking, focusedParticipantType}`. We swap those values.
  - `ExternalPipView` and `ExternalPipViewVideo` are wrapped so they re-render when a pin changes.
- The native `ExternalPip` module only has: `isSupported`, `setEnabled`, `setPipAspectRatio`, `refreshPipUi`, `setActive`. There's no support for buttons inside the PiP window.

**Participants and tiles**
- Participants come from `ChannelRTCStore.getParticipants(channelId)`.
  - `type` is 0 for a screen share (id starts with `call:`) and 2 for a user.
  - `streamId` identifies the video.
- Tile overlay buttons are `Pressable > ButtonPill > Icon` with labels like "Stop Watching" and "Focus <name>".
  - The background is `#00000085`, radius 8, and it's animated. For a real cut, the color-only animation is stripped (`stillStyle` in `style/index.tsx`).
- The X, maximize and name pill live in `VoicePanelCardFloatingControls.tsx` (default export, named `FloatingControls`). It follows the visible card in split view too.
  - Maximize is an anonymous component with props `{icon, onPress, style: {position: absolute, top: 8, right: 8}, layout, accessibilityLabel}`, wrapping an IconButton, then a PressableScale, then `Pressable > ButtonPill > Icon`.
  - X and maximize hide by sliding out past the card's top edge, and the card clips them. So a copy at the bottom must slide the other way, or it shows in the middle of the tile while hidden.
  - Discord's RN is 0.84 (Fabric only) with Reanimated 4, matching `package.json`.

**Voice effects (`voice/`)**
- The swipe-up menu gets one "voice effects" row at the top of Discord's "Voice Settings" group (found by its title, only in the same render as the swipe-up rows). If that group never shows up, the row goes in its own group after the first one. Tapping it opens `VoiceSheet` (`voice/Sheet.tsx`): presets, mic volume, distortion, lo-fi and reset.
- Mounted rows go through a `Shell` that renders `globalThis.__cheeseburgerVoiceImpl`, so hot swaps take over open menus.
- Slider rows are `TableRow`s with a node as `label`. Discord's `Text` no longer knows `text-normal` (it renders dark), so labels take their color from the theme (`TEXT_DEFAULT`).
- Mic gain hooks `setInputVolume` on the lowest layer that sees Discord's calls: native module, then `VoiceEngine`, then the `MediaEngine` instance. A layer is skipped when it's blocked or when a replay (`getMediaEngine().setInputVolume(MediaEngineStore.getInputVolume())`) doesn't reach it. The native module gets 1 for Discord's 100%.
- Whatever Discord sends is multiplied by mic% x distortion gain (6 to 32 dB, total capped at x200). Stopping sends Discord's own value back.
- While distortion is on, `Connection.setAutomaticGainControl` is forced to false on the default connection and restored after.
- Lo-fi caps `Connection.setVoiceBitRate` / `setBitRate` (24 kbps down to 8 kbps) and restores Discord's last bitrate after.
- Real pitch, robot or echo effects aren't possible: Discord's Android engine has no audio processing the mod can reach.

**Picking the PiP**
- Charles gave up on pin buttons drawn on tiles. The PiP is picked in the Arrange sheet (hold the split button): the Screen and Them rows have a pin button next to the up/down arrows. Tapping it locks the PiP to that kind (`pipChoices` in `pip.ts`, then `pinPip`); with several people of that kind it steps through them, then back to auto. Me has no pin. No sub label (Charles didn't want the text).
- `split/PipPin.tsx` is still loaded but draws nothing: `startPins` maps `TilePin`, `InlinePin` and `Marker` to an empty component so pins already mounted from older copies go away, and the jsx hooks for tile pins and maximize markers are no longer installed.
- Learned along the way: Discord's maximize hides through a Reanimated style (`controlsHidden` is a shared value), so its JS props never change on toggle, and the JS thread lags 200-650ms behind Discord's controls during taps.

**Tile layout (`split/tiles.tsx`, `split/probe.tsx`)**
- Tiles are placed in screen space, converted with the origin of Discord's tile container.
- The origin is measured, not guessed: `sampleContainer` measures each tile's own view and the views above its probe, and only trusts a sample when one of those views sits exactly at tile position minus coords. Views without a public instance are measured through `nativeFabricUIManager.measureInWindow(stateNode.node)`.
- Discord moves the container about 24dp when the controls show or hide. Tiles move with it on purpose (that's Discord's own motion). Rest positions are kept per channel, screen size and mode, separately for controls shown and hidden. The origin is the hidden rest; before that's known it's the shown rest plus the learned shift. Samples within 0.9s of a controls or call-state change are skipped.
- Safe area insets come from every probe (`onInsets`), so rotation updates them. Landscape needs them for the nav bar side.
- Polling and measuring pause while Discord is in the background.
- What the fight recorder showed (Oct 4): controls show/hide causes no fights. Every fight is Discord putting all tiles back to its own grid from the UI thread (never through JS, so it can't be blocked) when the call screen comes back from PiP/background or finishes its open/morph animation. So the poll speeds up to 33ms for 3s when the app comes back to the front (`AppState` listener), when split turns on, and for 1.5s after any reset. The debug lists Discord's grid/layout files to look for the layout code itself.
- Tile fights are recorded in `split/fight.ts` (kept on `globalThis.__cheeseburgerTileLog`, so updates don't wipe it): every write of ours, every Discord write we catch (`value` setter, `set()`, `modify`) with a short Discord stack, every reset the poll notices with "written through js" or "never saw the write" (a UI-thread write), plus controls, call state, container, origin, target and screen changes. The report shows the last 80 events and up to 3 fights with the 30 events before each.

## Debugging workflow

Charles taps **Send debug** in Cheeseburger settings. A crash also sends one automatically about 20 seconds after Discord reopens.

The report goes to his private debug repo as `latest.txt`, plus a timestamped copy in `debug/`. It's anonymized: people show up as "me" and "person N", and IDs are replaced.
Pin lab reports land in the same repo as `lab-latest.txt` and `lab/`, on their own during calls.
He usually sends reports from the settings page, after the call screen is closed, so anything you need from the call screen has to be remembered until then.

Read `latest.txt` before guessing. It includes versions, settings, the call, crashes, split, PiP, style, share, volume, voice and rotate.
The split section has `container:` (how the last origin sample went), `origin:` and `rests here:` lines, and `controls:` shows what the toolbar was doing.
Unexpected closes are logged with what Sentry said about the last run, the JS heap at the last heartbeat, the mic and boost levels and the uptime. When something is unclear, add a line to the relevant `*Debug()` function and ask him to send again.

## Open items

- The in-app floating PiP (not Android PiP) may ignore pins. Its source isn't identified yet; the debug report logs the PiP components' inputs.
- The Messages button in the guild rail is scoped for a bevel through its "Messages" label. It's unconfirmed on the phone.
- Volume boost beyond 200% is unverified.
- Mic volume past 100%, distortion and lo-fi are unverified by ear. The debug report's `voice` section shows which layer is hooked and what was sent.
