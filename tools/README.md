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
3. `python tools/tts/apply_ll.py` swaps in the real Lingua Libre word recordings and writes the credits.

Recordings come from Lingua Libre via `fetch_ll_list.py` → `ll_exact.py` → `ll_download.py` (polite, rate-limited).

Helpers:

- `gloss_missing.js`: German lines without an English meaning for car mode
- `en_with_de.js`: English lines that still contain German
