<p align="center"><img src="build/icon.png" width="140" alt="KLABYTV" /></p>

# KLABYTV

**English** · [العربية](README.ar.md)

How to install and use it: [about.md](about.md) · Downloads: [Releases](https://github.com/Shaf31/KLABYTV/releases/latest)

An IPTV player for Windows, Mac, Android and Android TV, in the spirit of IPTV Smarters Pro. It supports **Xtream Codes** accounts and **M3U** playlists, in English and Arabic.

> [!IMPORTANT]
> **KLABYTV is a player, not a service.** It doesn't include, sell or provide any channels, movies or subscriptions, and it doesn't work as a server by itself. To watch anything you need your own IPTV subscription from a provider: either an **M3U / M3U8 playlist link** (or file), or **Xtream Codes** details (server address, username and password).

**Status:** `v1.0.0-alpha` — the first public version. Expect rough edges, and please report problems in [Issues](https://github.com/Shaf31/KLABYTV/issues).

## Features
- **Netflix-style interface**:
  - A home screen with a large billboard and horizontal rows: continue watching, recently watched channels, My List, newest movies and series, top rated, and one row per category.
  - Detail pages for movies and series, with episodes by season and similar titles.
  - A "Who's watching?" screen for accounts, a global search, and a Netflix-style player.
- **Arabic and English**: the app follows the device language, and you can change it in Settings → Language (Automatic / العربية / English). The layout flips right-to-left or left-to-right with the language. Both languages use the Shoor font.
- **M3U playlists**: on the sign-in screen, choose "M3U playlist" and paste the playlist link, or pick an `.m3u` file from the device.
  - The playlist is split into channels, movies and series automatically. Episodes are grouped by season from names like `S01E02`.
  - The TV guide (EPG) is loaded when the playlist links an XMLTV file (`url-tvg`).
  - The User-Agent and Referer set in the playlist (`#EXTVLCOPT`) are used for those streams.
  - A playlist added by link is downloaded again on every sign-in, or from Settings → "Refresh playlist".
  - A test playlist is included: `KLABYTV-sample.m3u`.
- **Xtream Codes**: sign in with the server, username and password. You can also paste a `get.php` M3U link and the details are filled in. Several accounts can be saved.
- **Live TV, movies and series** by category, with search, favorites, EPG (now and next), and resume from where you stopped.
- **Streaming**: MPEG-TS (via mpegts.js), HLS/m3u8 (via hls.js) and MP4. If one live format fails, the other one is tried automatically, and playback reconnects when a stream drops.
- **Compatibility mode (all inside the app)**:
  - Formats the regular player can't play (MKV, AVI, AC3/E-AC3/DTS audio, HEVC 10-bit, MPEG-2…) are converted on the fly to H.264/AAC by the bundled ffmpeg and play in the same screen.
  - H.264 video is copied as is, with no CPU cost. On the Mac, conversion uses the graphics hardware (VideoToolbox).
  - The app detects this by itself, including movies that play picture without sound, and remembers the channel or movie afterwards. C switches it manually.
  - On Android, these formats open in the native Android player instead, with data usage and the buffer still counted.
- **Keyboard and mouse**: arrow keys move like a remote, Enter selects, Esc / Backspace / Alt+← / the mouse back button go back, and Alt+→ / the mouse forward button go forward.
- **Data saver**:
  - **Quality choice**: when a channel or movie exists in several qualities on the server (FHD / HD / SD / 4K), or an HLS stream has several levels, pick one from the quality button in the player (Q) or on the movie page. Each quality shows its data per hour.
  - **Fixed buffer for movies and episodes** (30 seconds / 1 minute / 2 minutes / 5 minutes): the app only downloads that far ahead. If you skip forward or back, it starts again from the new position, and when you pause, downloading stops.
  - **Still watching?**: if there's no activity for a while (1 / 2 / 3 / 4 hours), playback stops and asks you. You can turn it off in Settings.
  - **Stop playback when the app is minimized** (or hidden with ⌘H). It resumes by itself when you come back, and can be turned off in Settings.
- **Data usage**: every byte goes through a local proxy inside the app, so it is counted exactly. It is counted per device, and the device name is shown on the page and can be changed in Settings.
  - While watching: current speed, data used in the session, duration, and the estimate per hour (I key).
  - When you leave: a message like "You watched X minutes and used Y".
  - The "Data usage" page: today / yesterday / 7 days / 30 days / this month / a custom range, a daily chart, and a table of every viewing session (title, time, duration, data used, average speed).

## Running from source
Requires [Node.js](https://nodejs.org) 20 or newer.
```bash
npm install
npm start
```

## Ready-made builds
- **Mac (Universal: Apple Silicon and Intel)**: `KLABYTV-1.0.0-alpha-mac-universal.zip`. Unzip it, move `KLABYTV.app` to Applications, then run this once in Terminal. The build isn't signed by Apple, so without it macOS says the app is "damaged":
  ```bash
  xattr -cr "/Applications/KLABYTV.app" && codesign --force -s - "/Applications/KLABYTV.app/Contents/Resources/ffmpeg/ffmpeg" && codesign --force --deep -s - "/Applications/KLABYTV.app"
  ```
- **Windows (64-bit)**: `KLABYTV-1.0.0-alpha-win.zip`. Unzip it anywhere and run `KLABYTV.exe`. Windows may show "Windows protected your PC" because the app isn't signed: click More info → Run anyway.
- **Android**: two apps, which can both be installed on the same device:
  - `KLABYTV-1.0.0-alpha-android-phone.apk` (named KLABYTV), for phones. It has a touch layout: a bottom tab bar, swipeable rows, double tap on either side of the video to skip, and the player turns to landscape by itself.
  - `KLABYTV-1.0.0-alpha-android-tv-tablet.apk` (named KLABYTV TV), for TVs and tablets, with the large layout. On Android TV and TV boxes it appears in the TV's app list and everything works with the remote (arrows, OK, Back). On tablets it's the same layout with touch.
  - The layout can be changed in Settings → Display (Automatic / Mobile / TV).
  - To install: copy the file to the device, open it, and allow "Install from unknown sources". On a TV box you can use the Downloader app or a USB stick.

## Building from source
- Mac, on a Mac: `npm install && npm run dist:mac` (Universal + DMG).
- Mac, on Linux: `npm run dist:mac-universal-on-linux` (needs `llvm-lipo`: `apt install llvm`).
- Windows: `npm run dist:win`. It produces a zip; an NSIS installer has to be built on Windows or with Wine.
- ffmpeg (for compatibility mode) is downloaded automatically before the build.
- Android: needs the Android SDK (platform 35) and JDK 17+:
  ```bash
  cd android && gradle assemblePhoneRelease assembleTvRelease
  ```
  The APKs are written to `android/app/build/outputs/apk/{phone,tv}/release/`.
  **Important:** the signing key (`android/keystore/klabytv.jks` + `android/keystore.properties`) is not in the repository, so nobody else can sign a build as you. Keep it safe: Android only installs an update when it is signed with the same key. Without it, the release build is signed with the debug key.

## Shortcuts
| Key | Action |
|---|---|
| Arrow keys | Move around |
| Enter | Select / play |
| Esc · Backspace · Alt+← · ⌘[ · mouse back button | Back |
| Alt+→ · ⌘] · mouse forward button | Forward |
| `/` or ⌘F / Ctrl+F | Search |
| F (on any movie / series / channel) | Add to / remove from My List |
| Space | Play / pause |
| ↑ ↓ · PageUp / PageDown | Previous / next channel |
| ← → · double-click on the right / left of the screen | Skip forward / back (step set in Settings: 5 seconds to 5 minutes, 10 by default) |
| + / - · mouse wheel | Volume |
| M | Mute |
| F · double-click in the middle of the screen | Full screen |
| I | Show / hide the data counter in the player (also in Settings; usage is counted either way) |
| C | Compatibility mode (play any format by converting it) |
| Q | Choose quality |

## Notes
- ffmpeg is bundled in the Mac and Windows builds. When running from source on Linux, compatibility mode needs ffmpeg installed on the system.
- If the server refuses to play a stream, try another User-Agent in Settings, or the other live format (TS / HLS).
- Data (accounts, favorites, usage history) is stored only on your device:
  - Windows: `%APPDATA%\KLABYTV`
  - Mac: `~/Library/Application Support/KLABYTV`
  - Linux: `~/.config/KLABYTV`
- Passwords are encrypted with the system's secure storage (Windows DPAPI / macOS Keychain / Android Keystore).
- KLABYTV is a player only: it doesn't include any channels or content, and it isn't a server. You need an M3U / M3U8 link or Xtream Codes details from your provider.

## License
KLABYTV is released under the [MIT License](LICENSE).

Third-party parts keep their own licenses:
- [hls.js](https://github.com/video-dev/hls.js) and [mpegts.js](https://github.com/xqq/mpegts.js): Apache-2.0.
- [AndroidX Media3](https://github.com/androidx/media): Apache-2.0. [NanoHTTPD](https://github.com/NanoHttpd/nanohttpd): BSD-3-Clause.
- [FFmpeg](https://ffmpeg.org), bundled in the Mac and Windows builds only (not in this repository): LGPL / GPL. Its license file ships next to it in each build.
- The Shoor font (`src/renderer/fonts/Shoor.ttf`) isn't covered by the MIT License and remains under its own license.

## Project structure
```
android/               Android app: the same interface in a WebView + a Java port of the proxy and usage tracking (android/app/src/main/java/tv/klabytv/core)
src/main.js            App window + IPC
src/main/xtream.js     Xtream Codes API client
src/main/m3u.js        M3U playlists (answering in the same shape as Xtream)
src/main/xmltv.js      XMLTV TV guide
src/main/proxy.js      Local proxy that passes streams through and counts data usage
src/main/usage.js      Usage history (daily + per session)
src/main/transcode.js  Compatibility mode (format conversion with ffmpeg)
vendor/ffmpeg/         ffmpeg for Mac (arm64 and Intel) and Windows
src/renderer/          The interface: nav.js (navigation and keyboard), player.js, views.js, i18n.js (English)
```
