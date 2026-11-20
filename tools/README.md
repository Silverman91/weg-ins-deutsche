# Tools

Everything needed to rebuild the app lives here. Nothing in this folder is loaded by the app itself.

## Build the app shell

```
node tools/build.js
```

Regenerates `course.js`, `index.html`, `sw.js`, `manifest.webmanifest` and the icons from:

- `course-data.js`: the course outline (phases, lessons, series ladder, milestones)
- `base.css`: the page styles

Lesson content (`lessons-*.js`, `content.js`, `glosses.js`) and the app logic (`app.js`, `games.js`) are edited directly in the repo root. Run the build after changing any app file so the service worker gets a new cache version.

## Check everything

```
node tools/check.js
```

Checks that every lesson is complete and its exercises are well-formed, that every line the app can speak has a clip (and `audio/index.json` matches the clips on disk), that German lines have an English meaning for car mode, and that every file the page and the service worker load exists. Exits with an error if something is broken. Run it before every push.

## Android app (APK)

```
node tools/apk/build-apk.js build tools/apk.json
```

Builds `dist/weg-ins-deutsche-<version>.apk` with all lessons and audio inside it. Raise `version` in `tools/apk.json` for each release. Run `setup` once per computer first. The builder works for other projects too; see `tools/apk/README.md`.

## Preview locally

```
node tools/serve.js . 5173
```

Then open http://localhost:5173.

## Narration audio (`tts/`)

The scripts are here; bulky working data (Python venv, downloaded recordings, voice samples, caches, `lines.json`) lives in a separate work folder, by default `../tts` next to this repo. Machine-specific programs go in `tts/local.json` (not committed); see `tts/paths.py`.

After changing lesson text, regenerate the audio in this order (run Python from the work folder's venv):

1. `node tools/tts/export_lines.js . <work>/lines.json` lists every line the narrator speaks.
2. `python tools/tts/gen_all.py` generates missing clips (Emily for English, Greta for German; single words get several takes checked by Whisper).
3. `python tools/tts/apply_ll.py` swaps in the real word recordings (Lingua Libre, then older Wiktionary ones) and writes the credits.
4. `python tools/tts/audit_sentences.py check` (then `fix`) has Whisper listen to Greta's sentences and re-makes the ones with skipped, repeated or garbled words. After changing how sentences are scored, `rescore` reuses the saved transcripts instead of listening again.

5. `node tools/audio-updates.js` (just before committing) lists clips whose sound changed but whose file name did not, so phones that already downloaded them fetch the new version. `apply_ll.py` re-encodes every real recording with a new stream ID but the same sound; restore those with `git checkout` first so only real changes are listed and pushed.

Recordings come from Lingua Libre via `fetch_ll_list.py` → `ll_exact.py` → `ll_download.py`, and from Wiktionary's older `De-<word>` files via `wikt.py list` → `match` → `download` (all polite and rate-limited). Wiktionary clips that Whisper hears as a different word are listed in `<work>/wikt_reject.json` and skipped.

Helpers:

- `gloss_missing.js`: German lines without an English meaning for car mode
- `en_with_de.js`: English lines that still contain German
