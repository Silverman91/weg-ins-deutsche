"""A/B test the respellings in lexicon_candidates.json: is "Tiem" said better than "Team"?

For each word, Greta says a short sentence with it, 3 takes with the original spelling and 3 with the respelling
(textnorm's lexicon is switched off for the "original" takes). Whisper must hear the real word ("Team"); the
version with more passing takes wins, a tie keeps the original. Winners are written to lexicon.json (textnorm.py
uses it), and every take goes to <work>/compare/lexicon/ for listening.
Usage: ab_lexicon.py [--write]   (without --write it only reports)
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
import textnorm  # noqa: E402
from langtts import Engine, trim  # noqa: E402
from words import whisper, norm  # noqa: E402
from paths import WORK  # noqa: E402

HERE = Path(__file__).resolve().parent
SENT = "Ich sage jetzt das Wort {} noch einmal."


def main():
    cands = {k: v for k, v in json.loads((HERE / "lexicon_candidates.json").read_text(encoding="utf-8")).items() if not k.startswith("_")}
    out = WORK / "compare" / "lexicon"
    out.mkdir(parents=True, exist_ok=True)
    textnorm._LEX = {}                     # say both versions exactly as written
    eng = Engine("de", slots=4)
    jobs = [(w, ver, spelled, k) for w, rs in cands.items() for ver, spelled in (("orig", w), ("resp", rs)) for k in range(3)]
    try:
        with ThreadPoolExecutor(4) as pool:
            wavs = list(pool.map(lambda j: trim(eng.say(SENT.format(j[2]), "greta", seed=7 + 41 * j[3], temperature=0.8, tries=1)), jobs))
    finally:
        eng.close()
    paths = []
    for (w, ver, _, k), wav in zip(jobs, wavs):
        p = out / f"{norm(w)}_{ver}_{k}.wav"
        sf.write(p, wav, 24000)
        paths.append(p)
    heard = whisper(paths)
    score = {}
    for (w, ver, _, _), p in zip(jobs, paths):
        got = norm(" ".join(x[0] for x in heard.get(str(p), [])))
        score.setdefault(w, {"orig": 0, "resp": 0})[ver] += norm(w) in got
    winners = {w: cands[w] for w, s in score.items() if s["resp"] > s["orig"]}
    for w, s in score.items():
        print(f"{w:12s} original {s['orig']}/3   respelled '{cands[w]}' {s['resp']}/3   -> {'RESPELL' if w in winners else 'keep'}")
    print(f"\n{len(winners)} of {len(cands)} respellings help.")
    if "--write" in sys.argv:
        (HERE / "lexicon.json").write_text(json.dumps(winners, ensure_ascii=False, indent=1), encoding="utf-8")
        print("written to lexicon.json")


if __name__ == "__main__":
    main()
