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
| `logger/` | Message logger: keeps deleted messages, shows old versions of edited ones. Replaces the core MessageLogger plugin |
| `spotify/` | Stops Discord from pausing Spotify (its auto-pause after 30s of mic in a call) |
| `search/` | Smarter search: `has: image` only finds uploads, plus extra filters typed in the search bar (`is:photo`, `not:gif`, `ext:`, `site:`, `sort:old`...) |

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
- In portrait, container rests left of x 4 or above the status bar are ignored: the call screen's open animation parks the container at 0,0 for a second or two, and learning that put every tile 12dp off for several seconds.
- Discord moves the container about 24dp when the controls show or hide. Tiles move with it on purpose (that's Discord's own motion). Rest positions are kept per channel, screen size and mode, separately for controls shown and hidden. The origin is the hidden rest; before that's known it's the shown rest plus the learned shift. Samples within 0.9s of a controls or call-state change are skipped.
- Safe area insets come from every probe (`onInsets`), so rotation updates them. Landscape needs them for the nav bar side.
- Polling and measuring pause while Discord is in the background.
- What the fight recorder showed (Oct 4): controls show/hide causes no fights. Every fight is Discord putting all tiles back to its own grid from the UI thread (never through JS, so it can't be blocked) when the call screen comes back from PiP/background or finishes its open/morph animation. So the poll speeds up to 16ms for 3s when the app comes back to the front (`AppState` listener), when split turns on, and for 1.5s after any reset. The debug lists Discord's grid/layout files to look for the layout code itself.
- The tile keeper (`split/keeper.ts`) stops those fights for real: it runs on Discord's animation (UI) thread, so Discord's move is undone in the same frame and never drawn. It's a hand-made worklet: a function with `__workletHash`, `__closure` and `__initData.code` (our source as a string; release builds `eval` it on the UI runtime, and Discord's own worklets like `withTiming` are checked first to confirm `__initData.code` exists and reads `this.__closure`). It adds a listener (`addListener`, UI side only) to each tile's `sharedCoords`; when Discord writes anything else, it writes our rect back and remembers Discord's wanted rect (from `_animation.toValue` for animations) so split off can restore it. Targets live in our own `makeMutable` value, always pushed before our coords writes (same `runOnUI` queue, so order holds).
  - Safety: the code is wrapped in try/catch and a busy flag; a throw on the UI runtime in release is a native crash. Each session first saves `uiKeeper: "trying"`, waits 1.5s, installs, and checks a counter 1.5s later. If Discord closes during that window it's saved as `failed` and never tried again. If the UI thread doesn't answer, it's off for that session and the 16ms burst polling stays as the fallback.
- Tile fights are recorded in `split/fight.ts` (kept on `globalThis.__cheeseburgerTileLog`, so updates don't wipe it): every write of ours, every Discord write we catch (`value` setter, `set()`, `modify`) with a short Discord stack, every reset the poll notices with "written through js" or "never saw the write" (a UI-thread write), plus controls, call state, container, origin, target and screen changes. The report shows the last 80 events and up to 3 fights with the 30 events before each.

**Message logger (`logger/`)**
- Charles found the core MessageLogger plugin (`src/plugins/messagelogger`, core, so not edited) cheap and broken (Oct 6): edits were shown as old text plus a `` `[ EDITED ]` `` code tag, and deleting your own message showed the deleted note for one frame and then removed it. The cause: Discord sends MESSAGE_DELETE twice for your own deletes (local and gateway); the core plugin turns the first into the deleted note and deliberately lets a second delete through.
- Cheeseburger's logger turns the core plugin off with `stopPlugin("messagelogger")` (tried at start, +5s and +20s, because core plugins start in batches) and remembers it in `cheeseburgerlogger.tookOver`; turning Cheeseburger's logger off (not a hot swap) starts the core plugin again. If the core plugin is on anyway, every Cheeseburger hook steps aside.
- Deletes use the same trick as the core plugin (MESSAGE_DELETE becomes MESSAGE_EDIT_FAILED_AUTOMOD with "deleted at 1:28 pm", then a MESSAGE_UPDATE redraw, plus a red row style in `RowManager.generate`). Repeat deletes for the same id within 15s are swallowed (`CHEESEBURGER_LOGGER_SKIP`); later ones go through so a deliberate delete can still remove it. MESSAGE_DELETE_BULK is handled too. Deleted and edited ids live on `globalThis` so hot swaps keep them.
- Edits put old versions above the current text as small gray subtext lines (`-# \u200bold`, last 5; the zero width space marks them as ours). Charles didn't like the struck-through look (Oct 6), so there's no strikethrough anymore; the old `-# ~~old~~` format is still read back. Your own edits only get history while the edit box fix is installed: `startEditMessage`, `editMessage` and MESSAGE_START_EDIT are cleaned back to the current text so history never gets sent.
- Settings page (gear next to the switch in Cheeseburger settings; opened with `navigation.push("RAIN_CUSTOM_PAGE", {title, render})` like the core plugin cards, `logger/Page.tsx`): in chat (keep deleted, edit history, old versions shown 1-10, servers too or only DMs + mentions, ignore bots, own messages) and save on this phone (DMs, group DMs, server messages that mention him, @everyone counts, every server message, put deleted ones back in chat after a restart, keep up to N). Settings live in `cheeseburgerlogger` (`logger/storage.ts`).
- Saved messages (`logger/saved.ts`) go to `documents/rain/cheeseburger-messagelog.json` (debounced 4s, flushed on stop, oldest dropped past the limit, default 3000). Each entry has who, where, when, kind, current text, old versions, file links, and for deleted ones a minimal API-shaped `raw` message. On every message load (LOAD_MESSAGES_SUCCESS, the cached and local loads too), saved deleted messages inside the loaded id range are inserted back (sorted newest first) and get their "deleted at" note, and saved edit history is reapplied. Restored messages are inserted on every load that covers them: after a restart Discord loads the chat more than once, and the first version only inserted on the first load, so the next load dropped it again (Oct 6: debug said "put back in chat 1" but Charles saw nothing). The debug's `loads seen:` line shows which load types came through. The Saved messages page lists them with search and all/deleted/edited filters; hold one to copy it, "Copy all" exports everything as text.

**Spotify auto-pause (`spotify/`)**
- Charles's music paused at random on every device for months; unlinking Spotify from Discord stopped it (Oct 6). That's Discord's documented Spotify Auto Pause: after 30s of mic transmission in voice while Spotify plays, the client calls Spotify's Web API `PUT /v1/me/player/pause`, which pauses whatever device is playing. His mic at 1000% with voice activity at -57 dB makes it trigger constantly. Discord has no setting for it.
- The blocker patches `XMLHttpRequest.prototype.open/send` (RN's fetch and Discord's HTTP both go through it) and turns that PUT into a harmless `GET /v1/me/player` with no body, so Discord sees a success. Blocks are logged (kept on `globalThis.__cheeseburgerSpotifyLog`) and shown in the debug's `spotify` section. Listen-along pauses from Discord are blocked too. On his PC (BetterDiscord) the NoSpotifyPause plugin does the same.

**Search (`search/`)**
- Discord's `has: image` matches image embeds too (gifs, link previews, website images), which clogged Charles's `from: me has: image` searches (Oct 6). With "has: image and has: video mean uploads" on (gear next to "Smarter search"), `has=image/video/sound` is swapped for an `attachment_extension` list (`IMAGE_EXT`, `VIDEO_EXT`, `AUDIO_EXT` in `search/query.ts`), so only uploaded files match.
- Extra filters are typed into the search bar as plain words; Discord sends them as `content` (or tokenized `contents`, `slop|term`) and `search/query.ts` turns them into real API params: `is:photo/video/audio/gif/file/link/sticker/poll/pinned/bot`, `not:gif/link/embed/file/image/video/bot/pinned`, `ext:png,jpg`, `name:`, `site:`, `via:`, `replyto:me`, `sort:old/new/relevant`. Quoted words are left alone. The settings page lists them (`CHEATSHEET`).
- Search goes over two routes: `GET /guilds|channels/{id}/messages/search?...` (query string) and the tab search `POST /guilds|channels/{id}/messages/search/tabs` or `/users/@me/messages/search/tabs` (JSON `{tabs: {messages, media, links, files, pins}}`, each tab has the same filter fields as arrays, `pinned` as a boolean). `search/index.ts` hooks `XMLHttpRequest.prototype.open` for GET and `send` for the tab bodies. Which one the phone uses is unconfirmed: the debug's `search` section counts tabs / get / other requests and lists the last rewrites (only our keywords, never the search text).
- Charles's PC runs BetterDiscord; the same rewriter was handed to him as a standalone `CheeseburgerSearch.plugin.js` (not in this repo).

## Debugging workflow

Charles taps **Send debug** in Cheeseburger settings. A crash also sends one automatically about 20 seconds after Discord reopens.

The report goes to his private debug repo as `latest.txt`, plus a timestamped copy in `debug/`. It's anonymized: people show up as "me" and "person N", and IDs are replaced.
Pin lab reports land in the same repo as `lab-latest.txt` and `lab/`, on their own during calls.
He usually sends reports from the settings page, after the call screen is closed, so anything you need from the call screen has to be remembered until then.

Read `latest.txt` before guessing. It includes versions, settings, the call, crashes, split, PiP, style, share, volume, voice and rotate.
The split section has `container:` (how the last origin sample went), `origin:` and `rests here:` lines, and `controls:` shows what the toolbar was doing.
Deaths while in the background (not in a call) are logged as `gone` with how long until Discord was reopened; they don't trigger a crash report. Unexpected closes are logged with what Sentry said about the last run, the JS heap at the last heartbeat, the mic and boost levels and the uptime. When something is unclear, add a line to the relevant `*Debug()` function and ask him to send again.

## Open items

- In-app floating PiP size: `useControllerPIPState` (`voice_panel/native/pip/`) returns `{id, mode, width, height, containerHeight, showSecondaryPIP}`; Discord's IN_APP sizes are 120x120 for a camera (Smart PiP reshapes it to 16:9) and 200x112.5 for a screen. Charles found it too small (Oct 5), so `bigger()` in `split/pip.ts` scales width and height to `splitViewSettings.pipWidth`% of the window width (default 60, 20 to 95, 0 = Discord's size; height capped at 45% of the window). `containerHeight` is left alone; the debug's controller line now shows it as `box=`.
- The in-app floating PiP (not Android PiP) may ignore pins. Its source isn't identified yet; the debug report logs the PiP components' inputs.
- The Messages button in the guild rail is scoped for a bevel through its "Messages" label. It's unconfirmed on the phone.
- Charles's goal (Oct 5): louder voices of other people (`default` context) and a louder mic. Stream audio isn't a goal.
- Volume past 200% works in Discord's Android engine: the Oct 4 listen test flipped a stream between x2 and x8 on the native call and Charles heard it get louder and quieter. Earlier "it does nothing" was probably the old linear scale (300% was only x3) and streams: stream volume sliders (context `stream`) were never boosted, only people's voice (`default`). Both contexts are boostable now (`BOOSTABLE` in `volume/index.ts`); the debug's `sliders raised:` line counts raised sliders per context. Boosts use Discord's perceptual curve like BetterDiscord's BetterVolume (which Charles says works on Windows): every +100% past 200% is +6 dB, so 300% is x4, 400% x8, 1000% x501 (`toAmplitude`). The mic stays linear and is unverified. The engine trail also logs direct native per-user calls (`direct native...`) and what `connectionInstanceMergeUsers` carries (`merge users:`), in case Discord ever resets a boost outside `Connection.setLocalVolume`.
- The connection's `mediaEngineConnectionId` is a string (`"Native-0"`) but the native module wants the number (0). `volume/test.ts` and `volume/engine.ts` parse the trailing number.
- "Test boost" can't be measured: Discord's per-user `audioLevel` in `conn.getStats()` (`rtp.inbound.<user>[0]`) is read before the per-user volume is applied (Oct 4 run: x1/x2/x4 gave the same levels). So "Test boost" is now a listen test: it samples every connection's inbound `audioLevel` for about 1.5s, picks the loudest person's voice (a music bot counts; streams are never used, Charles doesn't care about them), then steps their native volume x0.5 (about 90%), x2 (200%), x8 (400% on the curve), 2s each, 3 rounds. Each step is +12 dB, so the first jump proves the test works and the second shows whether voices go past 200%. Only streams were ever tested (Oct 4/5, they worked); voices are unproven and Charles doubts they work. Per-user volume only touches incoming audio, so with nothing playing it says so.
- "Test mic boost" (`volume/test.ts`) still measures: three rounds of x1, x2, x4 on the mic while Charles talks (about 15s), reading our outbound `audioLevel` from `conn.getStats()` (falls back to the native `connectionInstanceGetStats(id, cb)`). The level is peak based and saturates, so each round votes "works", "capped", "too loud" (x2 already near full scale) or "flat" (x1 to x2 didn't change, so the stats can't show it); the majority wins, else "mixed results". If it's capped, Discord's AGC (currently off) is the next thing to try.
- Android audio route (`volume/route.ts`): Discord's `NativeAudioManagerModule` has `setCommunicationModeOn`, `setActiveAudioDevice`, `getActiveAudioDevice`, `getAudioDevices`. Calls to the two setters are logged (kept on `globalThis.__cheeseburgerAudioRoute`), the device is read at start and on call connect, and the debug shows them with the call's spatial audio state and `MobileAudioOutputExperiment`'s config. Communication mode is the one Android-level lever the mod can reach; nothing toggles it yet.
- Discord's own settings for Charles (Oct 4): output volume 199.5 (already Discord's max), input 100, AGC off, noise suppression on, echo cancellation off, "bypass system input processing" on, sidechain compression on (50), spatial audio mixer on (blend 1). If the engine applies the boost but he still hears no difference, the phone's call-audio path is the limit. The mod only reaches it through Discord's own native modules (see the audio route item); the loader bridge has no audio functions.
- Broken Discord sound (Oct 5): when a stream started, a red error screen showed `res/raw/stream_started.mp3 ... can not be opened as a file descriptor; it is probably compressed` from Discord's native sound player (`prepare` -> `createMediaPlayer` -> `openRawResourceFd`). The file is stored compressed in the installed APK (rainManager's repack or Discord's bundle), so it can never play; the red screen is React Native's dev error screen. `volume/sounds.ts` wraps the native sound player's methods (codegen `Native*Sound*` modules plus guessed TurboModule names like `DCDSoundManager`), skips any call naming a sound in `BROKEN` (and later calls on its key), and logs which players, methods and sound names it saw. The player is `DCDSoundManager` (`prepare, play, pause, stop, release, setVolume, setPan, setNumberOfLoops, setCurrentTime`, confirmed Oct 6); only modules with `prepare` get wrapped (Android's `SoundManager.playTouchSound` is left alone). Add more names to `BROKEN` if other sounds show the same error.
- Mic distortion and lo-fi are unverified by ear. The debug report's `voice` section shows which layer is hooked and what was sent.
