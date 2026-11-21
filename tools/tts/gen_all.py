"""Generate all lesson narration clips for the offline German app.

Input:  lines.json (from export_lines.js) - every unique segment the app's narrator speaks.
Usage: gen_all.py [--core]   (--core also makes AI clips for Core 2,000 card words)
Output: german-offline/audio/c/<hash>.ogg + german-offline/audio/index.json (which clips exist).
Voices: English = Emily (neutts-2e); German = Greta (neutts-nano-german); the second dialogue speaker
        (alt) = the German model cloning Emily. Single German words: best of several takes (words.py).
Every clip is loudness-matched. Resumable: existing clips are skipped, so it can be stopped and rerun.
"""
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
from langtts import Engine, trim, encode, SAMPLES  # noqa: E402


def greta_for(text):
    """Greta's reference for this line: a question melody for "?", a lively one for "!" (made by make_refs.py,
    used only once those samples exist), the plain one otherwise."""
    end = text.rstrip(" \"'“”„)…")[-1:]
    ref = {"?": "greta_q", "!": "greta_x"}.get(end)
    return ref if ref and (SAMPLES / f"{ref}.wav").exists() else "greta"
from leveling import level  # noqa: E402
from words import clean_words  # noqa: E402
from carrier import carrier_words  # noqa: E402

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
    tmp = TMP / f"c_{item['h']}.wav"          # one temp file per clip: clips are saved from several threads
    sf.write(tmp, level(wav), SR)
    encode(tmp, out_path(item))
    tmp.unlink(missing_ok=True)


SLOTS = int(os.environ.get("GRETA_SLOTS", "4"))   # requests at once; 4 was fastest on the RX 5700 XT
# single words in a carrier sentence (carrier.py), cut out: off by default; in an A/B test on 40 words it passed
# 17/40 against 25/40 for the word alone (it is twice as fast per take). GRETA_CARRIER=1 turns it on.
CARRIER = os.environ.get("GRETA_CARRIER", "0") == "1"
LONG = 14                                         # lines longer than this (words) are said in parts


def split_long(text):
    """Long lines drift (repeated or skipped words). Split at commas/semicolons into parts of 4+ words."""
    words = text.split()
    if len(words) <= LONG:
        return [text]
    parts, cur = [], ""
    for piece in re.split(r"(?<=[,;:])\s+", text):
        cur = f"{cur} {piece}".strip() if cur else piece
        if len(cur.split()) >= 4 and len(cur.split()) >= len(words) // 3:
            parts.append(cur); cur = ""
    if cur:
        if parts and len(cur.split()) < 4:
            parts[-1] += " " + cur
        else:
            parts.append(cur)
    return parts


def say_line(eng, text, voice):
    """A sentence, in parts if it's long, joined with a short breath (180 ms)."""
    parts = split_long(text)
    if len(parts) == 1:
        return trim(eng.say(text, voice, temperature=0.8))
    gap = np.zeros(int(0.18 * SR), np.float32)
    out = []
    for i, part in enumerate(parts):
        out += ([gap] if i else []) + [trim(eng.say(part, voice, temperature=0.8))]
    return np.concatenate(out)


def write_index():
    have = sorted(p.stem for p in CLIPS.glob("*.ogg"))
    path = APP / "audio" / "index.json"
    old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    # keep everything else in the index (speaker credits, the list of changed clips phones must re-download)
    idx = {**old, "v": 1, "clips": have, "voices": {
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
    wk = ROOT / "wikt_exact.json"   # older Wiktionary recordings (wikt.py)
    real |= set(json.loads(wk.read_text(encoding="utf-8"))) if wk.exists() else set()
    core = "--core" in sys.argv   # Core 2,000 card words: only when asked (they get real recordings first)
    todo = [i for i in items if not out_path(i).exists() and i["h"] not in real and (core or not i.get("core"))]
    print(f"{len(items)} clips, {len(todo)} to make ({len(real)} come from real recordings)", flush=True)
    de = [i for i in todo if i["lang"] == "de"]
    en = [i for i in todo if i["lang"] == "en"]
    t0 = time.time()

    if de:
        eng = Engine("de", slots=SLOTS)
        try:
            words = [i for i in de if single_word(i["text"]) and not i["alt"]]
            rest = [i for i in de if i not in words]
            done = [0]

            def one(it):
                save(it, say_line(eng, it["text"], "emily" if it["alt"] else greta_for(it["text"])))
                done[0] += 1
                if done[0] % 50 == 0:
                    print(f"German sentences {done[0]}/{len(rest)}  ({time.time() - t0:.0f}s)", flush=True)
            with ThreadPoolExecutor(SLOTS) as pool:
                list(pool.map(one, rest))
            for k in range(0, len(words), 120):  # word batches keep each Whisper run a sensible size
                chunk = words[k:k + 120]
                texts = [i["text"] for i in chunk]
                # first inside a carrier sentence ("Das Wort ist: Puls."), cut out; the word alone for the rest
                best, report = carrier_words(eng, texts, "greta", TMP / "words") if CARRIER else ({t: None for t in texts}, [])
                left = [t for t in texts if best.get(t) is None]
                if left:
                    best2, report2 = clean_words(eng, left, "greta", TMP / "words")
                    best.update(best2); report += report2
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
