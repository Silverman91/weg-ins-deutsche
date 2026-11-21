"""Single words said inside a sentence, then cut out ("carrier phrase").

Speech models are trained on sentences: a word said alone often runs on ("den… umm"), starts clipped or gets
odd stress. So Greta says "Das Wort ist: Puls." and we keep only "Puls":
  1. make a few takes of the carrier sentence,
  2. Whisper (word timestamps) finds where the last word starts and ends,
  3. the cut is widened to the nearest quiet point, so no consonant is clipped, with short fades,
  4. Whisper checks the cut-out word on its own; the best passing take wins.
Words that never cut cleanly fall back to the old way (the word alone, words.clean_words).
"""
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf

from words import whisper, norm, max_len, second_burst

SR = 24000
CARRIER = "Das Wort ist: {}."


def _quiet_edge(wav, i, step, limit, thresh=0.02):
    """From sample i, move in direction `step` (±1) until the audio is quiet for 20 ms, at most `limit` samples."""
    win = int(0.02 * SR)
    j, moved = i, 0
    while 0 < j < len(wav) - win and moved < limit:
        if np.abs(wav[j:j + win]).max() < thresh:
            return j
        j += step * win // 2
        moved += win // 2
    return j


def _valley(wav, lo, hi):
    """The quietest 10 ms point between samples lo and hi (where one word hands over to the next)."""
    win = int(0.01 * SR)
    lo, hi = max(0, lo), min(len(wav) - win, hi)
    if hi <= lo:
        return lo
    energy = [float(np.sqrt(np.mean(wav[i:i + win] ** 2))) for i in range(lo, hi, win // 2)]
    return lo + int(np.argmin(energy)) * (win // 2)


def cut_word(wav, start, end):
    """Cut [start, end] seconds out of `wav`, with 10 ms fades and 60 ms of silence after.
    The start goes to the quietest point near Whisper's word start: "ist" runs straight into the next word with no
    silence, so looking for silence would take the end of "ist" along."""
    s = _valley(wav, int((start - 0.12) * SR), int((start + 0.06) * SR))
    e = _quiet_edge(wav, int(min(len(wav) / SR, end + 0.04) * SR), +1, int(0.15 * SR))
    out = wav[max(0, s):min(len(wav), e)].astype(np.float32).copy()
    f = min(len(out) // 4, int(0.01 * SR))
    if f:
        out[:f] *= np.linspace(0, 1, f)
        out[-f:] *= np.linspace(1, 0, f)
    return np.concatenate([out, np.zeros(int(0.06 * SR), np.float32)])


def carrier_words(eng, words, voice, tmp, takes=3, temperature=0.8):
    """Returns ({word: wav or None}, report lines). None means no take cut cleanly: use the old way for it."""
    tmp = Path(tmp)
    tmp.mkdir(parents=True, exist_ok=True)
    takes_by = {}
    for w in words:
        spoken = re.sub(r"[^\wÄÖÜäöüß-]", "", w)
        with ThreadPoolExecutor(getattr(eng, "slots", 1)) as pool:
            wavs = list(pool.map(lambda k: eng.say(CARRIER.format(spoken), voice, seed=31 + 97 * k, temperature=temperature, tries=1), range(takes)))
        for k, wav in enumerate(wavs):
            p = tmp / f"carrier_{norm(w)}_{k}.wav"
            sf.write(p, wav, SR)
            takes_by.setdefault(w, []).append((p, wav))
    heard = whisper([p for v in takes_by.values() for p, _ in v])
    cuts = {}
    for w, lst in takes_by.items():
        for p, wav in lst:
            ws = heard.get(str(p), [])
            hit = next((x for x in reversed(ws) if norm(x[0]) == norm(w)), None)
            if hit:
                c = cut_word(wav, hit[1], hit[2])
                cp = p.with_name(p.stem + "_cut.wav")
                sf.write(cp, c, SR)
                cuts.setdefault(w, []).append((cp, c))
    check = whisper([p for v in cuts.values() for p, _ in v]) if cuts else {}
    best, report = {}, []
    for w in words:
        ok = []
        for p, c in cuts.get(w, []):
            got = " ".join(x[0] for x in check.get(str(p), []))
            dur = len(c) / SR
            passed = norm(got) == norm(w) and dur <= max_len(w) + 0.1 and not second_burst(c)
            report.append(f"{w:12s} carrier {p.stem}: {dur:.2f}s heard '{got}' {'OK' if passed else 'no'}")
            if passed:
                ok.append((dur, c))
        best[w] = min(ok, key=lambda x: x[0])[1] if ok else None
        if not ok:
            report.append(f"{w:12s} -> no clean carrier cut; falling back to the word alone")
    return best, report
