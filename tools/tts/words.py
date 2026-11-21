"""Clean single German words for Greta.

Short words said alone are out-of-distribution for these speech models (same lesson as the Arabic agent):
they can run on past the word ("den... umm"). Fix: make several takes per word, then keep a take only if
  1. Whisper (German forced) hears exactly that word, and
  2. it isn't too long for the word (catches run-on noises Whisper may ignore), and
  3. there is no second burst of sound after the word.
The shortest passing take wins. If none pass, the take closest to the expected length is used and flagged.
"""
import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf

from langtts import trim

from paths import WHISPER_PY  # noqa: E402  (a Python with faster-whisper installed)
SR = 24000
ALIGN = r"""
import json, sys
from faster_whisper import WhisperModel
m = WhisperModel("small", device="cpu", compute_type="int8")
out = {}
for p in sys.argv[1:]:
    segs, _ = m.transcribe(p, word_timestamps=True, beam_size=5, language="de")
    out[p] = [(w.word.strip(), w.start, w.end) for s in segs for w in s.words]
print(json.dumps(out))
"""


def whisper(paths):
    r = subprocess.run([WHISPER_PY, "-c", ALIGN, *map(str, paths)], capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise RuntimeError(r.stderr[-2000:])
    return json.loads(r.stdout.strip().splitlines()[-1])


def norm(s):
    return re.sub(r"[^\wäöüß]", "", s.lower())


def max_len(word):
    """Generous upper bound in seconds for one German word said clearly."""
    return 0.45 + 0.085 * len(norm(word))


def second_burst(w, thresh=0.03, gap=0.18):
    """True if the audio goes quiet for `gap` s and then makes sound again (a run-on after the word)."""
    hop = int(0.01 * SR)
    env = np.array([np.abs(w[i:i + hop]).max() for i in range(0, len(w) - hop, hop)])
    loud = env > thresh
    if not loud.any():
        return False
    first, last = np.argmax(loud), len(loud) - 1 - np.argmax(loud[::-1])
    quiet_run, saw_gap = 0, False
    for v in loud[first:last + 1]:
        if not v:
            quiet_run += 1
            saw_gap = saw_gap or quiet_run * 0.01 >= gap
        else:
            if saw_gap:
                return True
            quiet_run = 0
    return False


def clean_words(eng, words, voice, tmp, takes=4, rounds=3, temperature=0.8):
    """Returns ({word: wav}, report lines). `eng` must be a German Engine (model 'de').
    Words with no clean take get another round of `takes` (up to `rounds` rounds)."""
    tmp = Path(tmp)
    tmp.mkdir(parents=True, exist_ok=True)
    best, report, todo, scored = {}, [], list(words), {}
    for rnd in range(rounds):
        if not todo:
            break
        cands = {}
        for w in todo:
            spoken = norm(w)
            text = re.sub(r"[^\wÄÖÜäöüß-]", "", w) + "."   # one word, a plain full stop: no comma/colon run-ons
            ks = list(range(rnd * takes, (rnd + 1) * takes))
            with ThreadPoolExecutor(getattr(eng, "slots", 1)) as pool:   # takes in parallel, one per server slot
                wavs = list(pool.map(lambda k: trim(eng.say(text, voice, seed=11 + 97 * k, temperature=temperature, tries=1)), ks))
            for k, wav in zip(ks, wavs):
                p = tmp / f"{voice}_{spoken}_{k}.wav"
                sf.write(p, wav, SR)
                cands.setdefault(w, []).append((p, wav))
        heard = whisper([p for v in cands.values() for p, _ in v])
        next_todo = []
        for w, lst in cands.items():
            for p, wav in lst:
                got = " ".join(x[0] for x in heard.get(str(p), []))
                dur = len(wav) / SR
                match = norm(got) == norm(w)
                passed = match and dur <= max_len(w) and not second_burst(wav)
                report.append(f"{w:10s} take {p.stem.rsplit('_', 1)[1]}: {dur:.2f}s heard '{got}' {'OK' if passed else 'no'}")
                scored.setdefault(w, []).append((passed, match, dur, wav))
            ok = [s for s in scored[w] if s[0]]
            if ok:
                best[w] = min(ok, key=lambda s: s[2])[3]
            else:
                next_todo.append(w)
        todo = next_todo
    for w in todo:  # still nothing clean: prefer a take Whisper heard as the word, then the most typical length
        target = max_len(w) * 0.6
        pick = min(scored[w], key=lambda s: (not s[1], abs(s[2] - target)))
        best[w] = pick[3]
        report.append(f"{w:10s} -> no fully clean take after {rounds} rounds; using the best guess (listen to this one)")
    return best, report
