<p align="center">
  <img src="build/icon.png" width="180" alt="KLABYTV" />
</p>

<h1 align="center">KLABYTV</h1>

<p align="center">
  An IPTV player with a Netflix-style interface — for Mac, Windows, Android and Android TV<br/>
  <b>v1.0.0-alpha</b>
</p>

<p align="center">
  <a href="https://github.com/Shaf31/KLABYTV/releases/latest"><b>⬇ Download</b></a> · <a href="about.ar.md">العربية</a>
</p>

---

> [!IMPORTANT]
> **KLABYTV is a player, not a service.**
> It doesn't include, sell or provide any channels, movies or subscriptions, and it doesn't work as a server by itself.
> To watch anything you need your own IPTV subscription from a provider, in one of these forms:
> - an **M3U / M3U8 playlist link**, or an `.m3u` file;
> - **Xtream Codes** details: server address, username and password.

## What is KLABYTV?

KLABYTV plays your IPTV subscription (live channels, movies and series) in an easy, Netflix-style interface, and shows exactly how much internet data everything you watched used.

- Works with **Xtream Codes** accounts and **M3U / M3U8** playlists (a link or a file from your device).
- **English and Arabic**: it follows your device language, and you can change it in the settings.
- **Built-in player for every format**: no VLC or any other app needed. Hard formats (MKV, AC3/DTS audio, HEVC) are converted on the fly inside the app.
- **Data usage counter** for each device on its own, and a **data saver** mode.
- Control it with the **keyboard and mouse** on a computer, **touch** on a phone, and the **remote** on a TV.

## Download

From the [Releases](https://github.com/Shaf31/KLABYTV/releases/latest) page:

| Device | File |
|---|---|
| Mac (Apple Silicon and Intel) | `KLABYTV-1.0.0-alpha-mac-universal.zip` |
| Windows (64-bit) | `KLABYTV-1.0.0-alpha-win.zip` |
| Android phone | `KLABYTV-1.0.0-alpha-android-phone.apk` |
| Android TV / TV box / tablet | `KLABYTV-1.0.0-alpha-android-tv-tablet.apk` |
| Sample M3U playlist for testing | `KLABYTV-sample.m3u` |

> This is an **alpha**: the first public version. Some things may not work as expected yet. Please report problems in [Issues](https://github.com/Shaf31/KLABYTV/issues).

## Installation

### Mac
1. Unzip the file and move `KLABYTV.app` to your **Applications** folder.
2. The app isn't signed by Apple, so run this once in **Terminal** (without it, macOS says the app is "damaged"):
   ```bash
   xattr -cr "/Applications/KLABYTV.app" && codesign --force -s - "/Applications/KLABYTV.app/Contents/Resources/ffmpeg/ffmpeg" && codesign --force --deep -s - "/Applications/KLABYTV.app"
   ```
3. Open the app as usual.

### Windows
1. Unzip the file anywhere and run `KLABYTV.exe`.
2. If **Windows protected your PC** appears, click **More info**, then **Run anyway** (the app isn't signed).

### Android
- **Phone**: `android-phone.apk` (named KLABYTV), with a touch layout.
- **TV and tablet**: `android-tv-tablet.apk` (named KLABYTV TV). On a TV it appears in the app list and works with the remote. On a tablet it's the same large layout, with touch.
- Both can be installed on the same device.
- Copy the file to the device, open it, and allow **Install from unknown sources**. On a TV box, use the **Downloader** app or a USB stick.

## How to use it

### 1. Add your subscription
The first time you open the app you'll see the **Sign in** screen, with two options:

- **Xtream Codes**: enter the server address with its port (for example `http://example.com:8080`), your username and password. If you have a `get.php` link instead, paste it and the details are filled in for you.
- **M3U playlist**: paste the playlist link (M3U / M3U8), or tap **"Choose a file from this device"** and pick an `.m3u` file.
  - The app splits the playlist into channels, movies and series by itself. Episodes are grouped by season from names like `S01E02`.
  - If the playlist includes a TV guide link (XMLTV), you'll see what's on now and next on each channel.
  - No playlist yet? Try the app with `KLABYTV-sample.m3u` from the download page. It contains public test streams only.

You can add several accounts and switch between them on the **"Who's watching?"** screen.

### 2. Browsing
- **Home**: continue watching, recently watched channels, My List, newest movies and series, and a row for each category.
- **Live TV / Movies / Series**: by category.
- **My List**: press **F** (or the **+** button) on any movie, series or channel to add it.
- **Search**: press **/** or the search icon.

### 3. The player
| Action | Keyboard and mouse | Touch |
|---|---|---|
| Play / pause | Space or click | The big button in the middle |
| Skip forward / back | ← → or double-click on the right / left of the screen | Double tap on the right / left of the screen |
| Next / previous channel | ↑ ↓ | — |
| Full screen | F or double-click in the middle | — |
| Volume | + / − or the mouse wheel | — |
| Choose quality | Q | Quality button |
| Data counter | I | Counter button |
| Compatibility mode | C | Compatibility button |
| Back | Esc / Backspace / mouse back button | Back button |

- Movies and episodes resume from where you stopped.
- The skip step can be changed in the settings (5 seconds up to 5 minutes).
- If a format isn't supported, the app converts it by itself (**compatibility mode**) or opens it in the native Android player.
- Live channels can't be skipped forward or back: the server sends them as they air.

### 4. Data usage
- While watching: speed, data used and time watched, shown over the video. You can hide it in the settings or with **I**.
- The **"Data usage"** page: today, yesterday, last 7 days, last 30 days, this month, or a range you choose. It has a daily chart and a table of every viewing session: duration, data used and average speed.
- Usage is counted **per device**, and the device name can be changed in the settings.

### 5. Data saver (in the settings)
- **Quality choice**: when a channel or movie exists in several qualities, pick a lower one. Each quality shows its data per hour.
- **Buffer length**: the app only downloads that far ahead (30 seconds up to 5 minutes), not the whole movie.
- **Still watching?**: after an hour or more with no activity, playback stops and asks you.
- **Stop playback when the app is minimized**: it resumes by itself when you come back.

### 6. Language
In **Settings → Language**: Automatic (same as the device), English, or العربية. The change applies right away.

## FAQ

**Does KLABYTV give me channels?**
No. KLABYTV is only a player. It doesn't come with any content and it can't work as a server. You need an M3U / M3U8 link or Xtream Codes details from your IPTV provider.

**A channel doesn't play?**
Try the other stream format with the **TS/HLS** button in the player or in the settings, or change the User-Agent in **Settings → Advanced**. Also make sure your subscription is active and that you aren't connected on more devices than it allows.

**Where is my data stored?**
Only on your device. Accounts, favorites and usage history aren't sent anywhere, and passwords are encrypted with the system's secure storage (Keychain / DPAPI / Android Keystore).

---

To build from source, see [README.md](README.md).
