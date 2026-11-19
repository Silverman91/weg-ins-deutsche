"""Match the course's German words against Lingua Libre recordings and rank speakers by coverage."""
import json
import re
from collections import defaultdict
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import WORK, APP  # noqa: E402
ROOT = WORK
PREFIX = "File:LL-Q188 (deu)-"
NOT_GERMAN = set("""accusative Adverbs always Austria Bavaria before Berlin case change changes dative genitive nominative
movement location polite casual formal everyday slang Contractions Consonants Vowels React Reply politely voice messages
Irony Understatement Wordplay Sarcasm markers Greeting Openings Requests Closing Spoken Written North Switzerland
past participle present lower upper end position only else everything plural neuter masculine feminine the and of""".split())


def load():
    titles = json.loads((ROOT / "ll_deu_titles.json").read_text(encoding="utf-8"))
    rec = defaultdict(dict)        # speaker -> {label: title}
    for t in titles:
        if not t.startswith(PREFIX):
            continue
        rest = re.sub(r"\.(wav|ogg|flac|mp3)$", "", t[len(PREFIX):], flags=re.I)
        if "-" not in rest:
            continue
        speaker, label = rest.split("-", 1)
        rec[speaker][label.strip()] = t
    return rec


def candidates(word):
    """Labels that would count as a recording of `word` (exact first, then with an article)."""
    out = [word]
    if word[:1].isupper():
        out += [f"der {word}", f"die {word}", f"das {word}"]
    return out


def main():
    words = [w for w in json.loads((ROOT / "vocab_words.json").read_text(encoding="utf-8"))
             if w not in NOT_GERMAN and not w.startswith("'") and len(w) > 1 or w in ("ä",)]
    rec = load()
    cover = {}
    for sp, labels in rec.items():
        lower = {k.lower(): v for k, v in labels.items()}
        hit = {}
        for w in words:
            for c in candidates(w):
                if c in labels:
                    hit[w] = labels[c]
                    break
                if c.lower() in lower and c[:1].islower() == w[:1].islower():
                    hit[w] = lower[c.lower()]
                    break
        if hit:
            cover[sp] = hit
    ranked = sorted(cover.items(), key=lambda kv: -len(kv[1]))
    print(f"{len(words)} German words to cover, {len(rec)} speakers, {sum(len(v) for v in rec.values())} recordings")
    print("Top speakers by coverage:")
    for sp, hit in ranked[:12]:
        print(f"  {sp:28s} {len(hit):4d} words ({100 * len(hit) / len(words):.0f}%)   of {len(rec[sp])} recordings")
    union, chosen = {}, []
    for sp, hit in ranked[:5]:
        new = {w: t for w, t in hit.items() if w not in union}
        union.update(new)
        chosen.append((sp, len(new)))
    print("Combined coverage if we add speakers in order:")
    run = 0
    for sp, n in chosen:
        run += n
        print(f"  + {sp:26s} +{n:4d}  -> {run} words ({100 * run / len(words):.0f}%)")
    (ROOT / "ll_matches.json").write_text(json.dumps({sp: hit for sp, hit in ranked[:8]}, ensure_ascii=False, indent=0), encoding="utf-8")
    missing = [w for w in words if w not in union]
    (ROOT / "ll_missing.txt").write_text("\n".join(missing), encoding="utf-8")
    print("Not covered by top 5 speakers:", len(missing), "e.g.", ", ".join(missing[:25]))


if __name__ == "__main__":
    main()
