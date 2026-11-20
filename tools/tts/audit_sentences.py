"""Listening check for Greta's German sentences (single words are already checked when they are made).

Usage: audit_sentences.py check   Whisper transcribes every generated German clip of 2+ words -> sentence_audit.json
       audit_sentences.py fix     re-makes clips that scored low (up to 3 new takes each, keeps the best) and rechecks
Score = how many words Whisper heard in the right order (0..1). Real human recordings are not checked.
Below 0.75 usually means a skipped, repeated or garbled word; numbers and spelling variants cause a few false alarms.
"""
import difflib
import json
import re
import sys
from pathlib import Path

import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import WORK, APP  # noqa: E402
from words import whisper  # noqa: E402

CLIPS = APP / "audio" / "c"
OUT = WORK / "sentence_audit.json"
LIMIT = 0.75


def words(s):
    return re.findall(r"[a-zäöüß0-9]+", s.lower().replace("ß", "ss"))


def score(want, got):
    return difflib.SequenceMatcher(None, words(want), words(got)).ratio()


def generated():
    items = json.loads((WORK / "lines.json").read_text(encoding="utf-8"))["items"]
    real = set()
    for f in ("ll_exact.json", "wikt_exact.json"):
        p = WORK / f
        real |= set(json.loads(p.read_text(encoding="utf-8"))) if p.exists() else set()
    return [i for i in items if i["lang"] == "de" and len(words(i["text"])) >= 2 and i["h"] not in real
            and (CLIPS / f"{i['h']}.ogg").exists()]


def check(items):
    out = {}
    for k in range(0, len(items), 150):
        chunk = items[k:k + 150]
        heard = whisper([CLIPS / f"{i['h']}.ogg" for i in chunk])
        for i in chunk:
            got = " ".join(w[0] for w in heard.get(str(CLIPS / f"{i['h']}.ogg"), []))
            out[i["h"]] = {"text": i["text"], "alt": i["alt"], "heard": got, "score": round(score(i["text"], got), 3)}
        print(f"checked {min(k + 150, len(items))}/{len(items)}", flush=True)
    return out


def cmd_check():
    res = check(generated())
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=0), encoding="utf-8")
    low = sorted((v for v in res.values() if v["score"] < LIMIT), key=lambda v: v["score"])
    print(f"{len(res)} sentences checked, {len(low)} below {LIMIT}")
    for v in low[:60]:
        print(f"  {v['score']:.2f}  {v['text']}  | heard: {v['heard']}")


def cmd_fix():
    from langtts import Engine, trim, encode
    from leveling import level
    res = json.loads(OUT.read_text(encoding="utf-8"))
    low = {h: v for h, v in res.items() if v["score"] < LIMIT}
    tmp = WORK / "tmp_gen" / "audit"
    tmp.mkdir(parents=True, exist_ok=True)
    eng = Engine("de")
    better = 0
    try:
        for n, (h, v) in enumerate(low.items(), 1):
            takes = []
            for t in range(3):
                wav = level(trim(eng.say(v["text"], "emily" if v["alt"] else "greta", seed=500 + 31 * t, temperature=0.7, tries=1)))
                p = tmp / f"{h}_{t}.wav"
                sf.write(p, wav, 24000)
                takes.append(p)
            heard = whisper(takes)
            best = max(takes, key=lambda p: score(v["text"], " ".join(w[0] for w in heard.get(str(p), []))))
            s = score(v["text"], " ".join(w[0] for w in heard.get(str(best), [])))
            if s > v["score"]:
                encode(best, CLIPS / f"{h}.ogg")
                res[h].update(score=round(s, 3), heard=" ".join(w[0] for w in heard.get(str(best), [])), remade=True)
                better += 1
            print(f"{n}/{len(low)}  {v['score']:.2f} -> {max(s, v['score']):.2f}  {v['text']}", flush=True)
    finally:
        eng.close()
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"remade {better} of {len(low)}; still below {LIMIT}: {sum(v['score'] < LIMIT for v in res.values())}")


if __name__ == "__main__":
    {"check": cmd_check, "fix": cmd_fix}[sys.argv[1]]()
