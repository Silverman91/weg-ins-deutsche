"""Put the real Lingua Libre recordings into the app: for every segment in ll_exact.json, replace the generated
clip audio/c/<hash>.ogg with the human recording (resampled to 24 kHz mono, trimmed, loudness-matched), and add
speaker credits to audio/index.json. Run AFTER gen_all.py, which would otherwise overwrite these clips."""
import json
import sys
from pathlib import Path

import librosa
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
from langtts import trim, encode  # noqa: E402
from leveling import level  # noqa: E402

from paths import WORK, APP  # noqa: E402
ROOT = WORK
CLIPS = APP / "audio" / "c"
RAW = ROOT / "ll_raw"
TMP = ROOT / "tmp_gen"


def main():
    TMP.mkdir(exist_ok=True)
    hits = json.loads((ROOT / "ll_exact.json").read_text(encoding="utf-8"))
    lic = json.loads((ROOT / "ll_licences.json").read_text(encoding="utf-8")) if (ROOT / "ll_licences.json").exists() else {}
    used, missing = {}, 0
    for h, v in hits.items():
        raw = RAW / v["file"].split(":", 1)[1].replace(" ", "_")
        if not raw.exists() or raw.read_bytes()[:4] != b"RIFF":
            missing += 1
            continue
        wav, _ = librosa.load(raw, sr=24000, mono=True)
        sf.write(TMP / "ll.wav", level(trim(wav, thresh=0.02, pad=0.06)), 24000)
        encode(TMP / "ll.wav", CLIPS / f"{h}.ogg")
        sp = v["speaker"]
        u = used.setdefault(sp, {"n": 0, "licences": set()})
        u["n"] += 1
        u["licences"].add(lic.get(v["file"], "see Wikimedia Commons"))
    credits = [{"who": sp, "license": ", ".join(sorted(u["licences"])),
                "what": f"{u['n']} German word recording{'s' if u['n'] != 1 else ''} via Lingua Libre (Wikimedia Commons); converted and volume-adjusted"}
               for sp, u in sorted(used.items(), key=lambda kv: -kv[1]["n"])]
    # older Wiktionary recordings (wikt.py) for segments Lingua Libre doesn't have
    wk = ROOT / "wikt_exact.json"
    wk = json.loads(wk.read_text(encoding="utf-8")) if wk.exists() else {}
    info = ROOT / "wikt_info.json"
    info = json.loads(info.read_text(encoding="utf-8")) if info.exists() else {}
    wused = {}
    for h, v in wk.items():
        raw = ROOT / "wikt_raw" / v["file"].split(":", 1)[1].replace(" ", "_")
        if h in hits or not raw.exists():
            continue
        try:
            wav, _ = librosa.load(raw, sr=24000, mono=True)
        except Exception as e:  # a broken upload: keep the generated clip
            print("skip", raw.name, e)
            continue
        sf.write(TMP / "ll.wav", level(trim(wav, thresh=0.02, pad=0.06)), 24000)
        encode(TMP / "ll.wav", CLIPS / f"{h}.ogg")
        meta = info.get(v["file"], {})
        u = wused.setdefault(meta.get("artist", "unknown"), {"n": 0, "licences": set()})
        u["n"] += 1
        u["licences"].add(meta.get("licence", "see Wikimedia Commons"))
    credits += [{"who": sp, "license": ", ".join(sorted(u["licences"])),
                 "what": f"{u['n']} German word recording{'s' if u['n'] != 1 else ''} via Wiktionary (Wikimedia Commons); converted and volume-adjusted"}
                for sp, u in sorted(wused.items(), key=lambda kv: -kv[1]["n"])]
    print(f"Wiktionary recordings applied: {sum(u['n'] for u in wused.values())} from {len(wused)} speakers")
    idx_path = APP / "audio" / "index.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    idx["clips"] = sorted(p.stem for p in CLIPS.glob("*.ogg"))
    idx["credits"] = credits
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"real recordings applied: {sum(u['n'] for u in used.values())}, not downloaded yet: {missing}")
    for c in credits:
        print(" ", c["who"], "|", c["license"], "|", c["what"])


if __name__ == "__main__":
    main()
