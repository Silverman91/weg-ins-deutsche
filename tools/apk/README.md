# APK builder

Turns a static web app (an offline PWA: `index.html` plus its JS, CSS, images and audio) into an Android APK you can install on a phone. The web files go inside the APK, so the app works fully offline from the first launch and its saved data (localStorage, IndexedDB) belongs to the app, not to the browser.

It is not tied to this project: copy this folder (`build-apk.js` and `template/`) into any project and give it an `apk.json`.

## One-time setup (per computer)

Needs Node 18 or newer. Then:

```
node build-apk.js setup --tools D:\Android
```

This downloads into that folder, about 1.5 GB in total once Gradle has fetched what it needs:

- a portable Java (Eclipse Temurin JDK 21)
- Gradle
- Google's Android SDK tools

Nothing is installed into Windows and no admin rights are needed. Google asks you to accept the Android SDK licences during setup; `--accept-licenses` accepts them without asking. The folder is remembered in `~/.apk-builder.json`, so later builds and other projects find it automatically.

## Build

```
node build-apk.js build path/to/apk.json
```

The first build downloads the Android build plugin, which takes a few minutes; later builds take under a minute. The APK lands in the `out` folder as `<name>-<version>.apk`.

### apk.json

Paths are relative to the `apk.json` file.

| field | meaning | default |
|---|---|---|
| `name` | App name under the icon | required |
| `id` | Unique app id. Never change it after the first install. | required, like `com.example.myapp` |
| `version` | Version shown in Android settings | `1.0` |
| `web` | Folder with the web app | `.` |
| `start` | Start page inside `web` | `index.html` |
| `icon` | PNG icon inside `web`, 512×512 is best | `icon-512.png` |
| `color` | Status bar colour | `#ffffff` |
| `background` | Colour shown while the page loads | `color` |
| `orientation` | `portrait`, `landscape` or `unspecified` | `unspecified` |
| `exclude` | File or folder names (or paths relative to `web`) to leave out | — |
| `out` | Where the APK goes | `dist` |
| `internet` | `true` if the page loads anything from the internet | `false` |
| `debug` | `true` lets Chrome on a PC inspect the app (chrome://inspect) | `false` |

`.git`, `node_modules` and the output folder are always left out.

## Signing key: back it up

Each app id gets its own signing key on its first build. The key lives in `<tools>/keys/<id>.jks`, with its password in `<id>.json` next to it. Never put them in the project.

Android only installs an update over an existing app if it is signed with the same key. Back up the `keys` folder. If the key is lost, the next APK can only be installed after uninstalling the old app, which deletes its saved data.

## Install on the phone

1. Copy the APK to the phone (USB, cloud drive, or email to yourself).
2. Tap it in the Files app.
3. Allow that app to "install unknown apps" when Android asks; this is needed once.

To update, install the new APK over the old one. Saved data is kept.

## What the page gets inside the app

- **Address and features:** it runs at `https://appassets.androidplatform.net/`, a secure origin, so `fetch()`, `localStorage`, IndexedDB, Cache Storage and `<audio>` work as on a website.
- **Detecting the app:** the user agent ends with `apk-builder/<version>`, so the page can test `/apk-builder\//.test(navigator.userAgent)`, for example to skip service-worker registration or hide "download for offline" buttons.
- **Back button:** fires a cancelable `apkback` event on `window`. Call `e.preventDefault()` when the page handled it, for example by closing a dialog. Otherwise the WebView goes back in history, or the app moves to the background.
- **Background audio:** while an `<audio>` or `<video>` plays, a media-playback service keeps the app running with the screen off or another app in front, like a music app. It shows a "Playing" notification and stops 90 seconds after the last sound.
- **Saving files:** `<a download href="blob:…">` and `data:` links are saved to the phone's Downloads folder.
- **Opening files:** `<input type="file">` opens the phone's file picker.
- **Links:** links to other sites open in the phone's browser.
- **Not available or unreliable in a WebView:**
  - service workers (not needed, since the files are local);
  - `speechSynthesis`: the phone's voice is often missing, so ship recorded audio instead;
  - speech recognition;
  - push notifications;
  - install prompts.
