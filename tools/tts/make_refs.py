"""Make Greta's question and exclamation references (greta_q, greta_x) from her own voice.

Greta copies the melody of her reference clip, and her reference is a statement, so her questions come out flat.
There is no human recording of the same voice asking a question, so we let Greta make one:
  1. 10 takes of a question (and an exclamation) with the normal reference,
  2. Whisper must hear the sentence right,
  3. pitch (librosa.pyin): the question take whose pitch rises most at the end wins; for the exclamation, the
     liveliest one (widest pitch range),
  4. it's saved as neutts-src/samples/greta_q.wav / greta_x.wav with its text, and becomes a reference.
gen_all.py then uses greta_q for lines ending in "?" and greta_x for lines ending in "!". Listen to the results
(<work>/compare/refs/) before using them: delete the samples to go back to the plain reference.
Usage: make_refs.py [takes]
"""
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from langtts import Engine, trim, SAMPLES  # noqa: E402
from words import whisper, norm  # noqa: E402
from paths import WORK  # noqa: E402
from concurrent.futures import ThreadPoolExecutor  # noqa: E402

SR = 24000
TARGETS = {
    "greta_q": ("Hast du morgen Abend vielleicht Zeit für einen Kaffee?", "rise"),
    "greta_x": ("Das ist ja eine wunderbare Nachricht, herzlichen Glückwunsch!", "lively"),
}


def pitch(wav):
    f0, voiced, _ = librosa.pyin(wav.astype(np.float32), fmin=120, fmax=450, sr=SR, frame_length=1024)
    return f0[voiced & ~np.isnan(f0)] if voiced is not None else np.array([])


def rise(wav):
    f = pitch(wav)
    if len(f) < 20:
        return -1
    tail, mid = f[int(len(f) * 0.85):], f[int(len(f) * 0.3):int(len(f) * 0.7)]
    return float(np.median(tail) / np.median(mid))        # >1 means the end goes up


def lively(wav):
    f = pitch(wav)
    return float(np.std(np.log(f))) if len(f) > 20 else -1  # spread of the melody


def main():
    takes = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    out = WORK / "compare" / "refs"
    out.mkdir(parents=True, exist_ok=True)
    eng = Engine("de", slots=4)
    try:
        for name, (text, kind) in TARGETS.items():
            with ThreadPoolExecutor(4) as pool:
                wavs = list(pool.map(lambda k: trim(eng.say(text, "greta", seed=101 + 37 * k, temperature=0.9, tries=1)), range(takes)))
            paths = []
            for k, w in enumerate(wavs):
                p = out / f"{name}_{k}.wav"
                sf.write(p, w, SR)
                paths.append(p)
            heard = whisper(paths)
            scored = []
            for p, w in zip(paths, wavs):
                got = " ".join(x[0] for x in heard.get(str(p), []))
                ok = norm(got) == norm(text)
                s = rise(w) if kind == "rise" else lively(w)
                scored.append((ok, s, p, w))
                print(f"{p.name}: heard ok={ok}  {kind}={s:.3f}  {len(w) / SR:.1f}s")
            good = [x for x in scored if x[0] and 1.5 <= len(x[3]) / SR <= 6]
            if not good:
                print(f"{name}: no take passed; nothing saved")
                continue
            best = max(good, key=lambda x: x[1])
            sf.write(SAMPLES / f"{name}.wav", best[3], SR)
            (SAMPLES / f"{name}.txt").write_text(text, encoding="utf-8")
            print(f"{name}: saved {best[2].name} ({kind}={best[1]:.3f}) as the {name} reference")
    finally:
        eng.close()


if __name__ == "__main__":
    main()
