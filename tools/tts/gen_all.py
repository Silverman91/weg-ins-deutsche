"""Generate all lesson narration clips for the offline German app.

Input:  lines.json (from export_lines.js) - every unique segment the app's narrator speaks.
Usage: gen_all.py [--core]   (--core also makes AI clips for Core 2,000 card words)
Output: german-offline/audio/c/<hash>.ogg + german-offline/audio/index.json (which clips exist).
Voices: English = Emily (neutts-2e); German = Greta (neutts-nano-german); the second dialogue speaker
        (alt) = the German model cloning Emily. Single German words: best of several takes (words.py).
Every clip is loudness-matched. Resumable: existing clips are skipped, so it can be stopped and rerun.
"""
import json
import re
import sys
import time
from pathlib import Path

import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
from langtts import Engine, trim, encode  # noqa: E402
from leveling import level  # noqa: E402
from words import clean_words  # noqa: E402

from paths import WORK, APP  # noqa: E402
ROOT = WORK
CLIPS = APP / "audio" / "c"
TMP = ROOT / "tmp_gen"
SR = 24000


def single_word(text):
    return not re.search(r"\s", re.sub(r"[.,:;!?…]+$", "", text.strip()))


def out_path(item):
    return CLIPS / f"{item['h']}.ogg"


def save(item, wav):
    sf.write(TMP / "c.wav", level(wav), SR)
    encode(TMP / "c.wav", out_path(item))


def write_index():
    have = sorted(p.stem for p in CLIPS.glob("*.ogg"))
    idx = {"v": 1, "clips": have, "voices": {
        "en": "Emily (NeuTTS-2E by Neuphonic, Apache-2.0)",
        "de": "Greta (NeuTTS Nano German by Neuphonic, NeuTTS Open License v1.0)"}}
    (APP / "audio" / "index.json").write_text(json.dumps(idx, separators=(",", ":")), encoding="utf-8")
    return len(have)


def main():
    CLIPS.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(exist_ok=True)
    items = json.loads((ROOT / "lines.json").read_text(encoding="utf-8"))["items"]
    real = ROOT / "ll_exact.json"   # segments that get a real human recording (apply_ll.py) need no TTS
    real = set(json.loads(real.read_text(encoding="utf-8"))) if real.exists() else set()
    core = "--core" in sys.argv   # Core 2,000 card words: only when asked (they get real recordings first)
    todo = [i for i in items if not out_path(i).exists() and i["h"] not in real and (core or not i.get("core"))]
    print(f"{len(items)} clips, {len(todo)} to make ({len(real)} come from real recordings)", flush=True)
    de = [i for i in todo if i["lang"] == "de"]
    en = [i for i in todo if i["lang"] == "en"]
    t0 = time.time()

    if de:
        eng = Engine("de")
        try:
            words = [i for i in de if single_word(i["text"]) and not i["alt"]]
            rest = [i for i in de if i not in words]
            for n, it in enumerate(rest, 1):
                save(it, trim(eng.say(it["text"], "emily" if it["alt"] else "greta", temperature=0.8)))
                if n % 50 == 0:
                    print(f"German sentences {n}/{len(rest)}  ({time.time() - t0:.0f}s)", flush=True)
            for k in range(0, len(words), 120):  # word batches keep each Whisper run a sensible size
                chunk = words[k:k + 120]
                best, report = clean_words(eng, [i["text"] for i in chunk], "greta", TMP / "words")
                for it in chunk:
                    save(it, best[it["text"]])
                flagged = [r for r in report if "best guess" in r]
                print(f"German words {min(k + 120, len(words))}/{len(words)}  flagged {len(flagged)}  ({time.time() - t0:.0f}s)", flush=True)
                with open(ROOT / "words_report.txt", "a", encoding="utf-8") as f:
                    f.write("\n".join(report) + "\n")
        finally:
            eng.close()
        print("index:", write_index(), flush=True)

    if en:
        eng = Engine("en2e")
        try:
            for n, it in enumerate(en, 1):
                save(it, trim(eng.say(it["text"], "emily", temperature=0.8)))
                if n % 50 == 0:
                    print(f"English {n}/{len(en)}  ({time.time() - t0:.0f}s)", flush=True)
        finally:
            eng.close()
    print("DONE, clips:", write_index(), f"in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
