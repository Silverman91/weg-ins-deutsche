"""Exact-text matching of narration segments (lines.json) to Lingua Libre recordings -> ll_exact.json.
Speaker preference: Natschoba, Sebastian Wallroth, Lucas Werkmeister, then anyone else (most recordings first)."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from match_ll import load  # noqa: E402

from paths import WORK, APP  # noqa: E402
ROOT = WORK
lines = sys.argv[1] if len(sys.argv) > 1 else "lines.json"
rec = load()
pref = ["Natschoba", "Sebastian Wallroth", "Lucas Werkmeister"]
pref += [s for s in sorted(rec, key=lambda s: -len(rec[s])) if s not in pref]
items = [i for i in json.loads((ROOT / lines).read_text(encoding="utf-8"))["items"] if i["lang"] == "de" and not i["alt"]]
# recordings marked bad in the audio review page (tools/audio-review.js) are skipped; they get a generated clip
rej = ROOT / "ll_reject.json"
rejected = set(json.loads(rej.read_text(encoding="utf-8"))) if rej.exists() else set()
items = [i for i in items if i["h"] not in rejected]
key = lambda s: re.sub(r"[.,:;!?…]+$", "", s.strip())  # noqa: E731
hits, by = {}, {}
for it in items:
    k = key(it["text"])
    if len(k.split()) > 4:
        continue
    # card words (Core 2,000) may also use a recording of the noun without its article: "der Mann" -> "Mann"
    keys = [k] + ([re.sub(r"^(der|die|das) ", "", k)] if it.get("core") and re.match(r"^(der|die|das) ", k) else [])
    for kk in keys:
        sp = next((sp for sp in pref if rec[sp].get(kk)), None)
        if sp:
            hits[it["h"]] = {"text": it["text"], "speaker": sp, "file": rec[sp][kk]}
            by[sp] = by.get(sp, 0) + 1
            break
(ROOT / "ll_exact.json").write_text(json.dumps(hits, ensure_ascii=False, indent=0), encoding="utf-8")
print(len(hits), "segments with a real recording;", dict(sorted(by.items(), key=lambda kv: -kv[1])))
