"""Older Wiktionary word recordings ("File:De-<word>.ogg" on Wikimedia Commons, made before Lingua Libre existed).

Usage: wikt.py list       all De-... file names -> wikt_titles.json (resumable, one request every 2 s)
       wikt.py match      segments still without a real recording that a De-... file says exactly -> wikt_exact.json
       wikt.py download   licences + files -> wikt_raw/ (one at a time, slows down when the server is busy; resumable)
       wikt.py check      Whisper listens to new downloads; wrong ones -> wikt_reject.json (then run match again)
Only standard German (no De-at-/De-ch- variants) and only free licences (CC BY, CC BY-SA, CC0, public domain).
apply_ll.py puts the downloads into the app together with the Lingua Libre ones.
"""
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import WORK  # noqa: E402

UA = {"User-Agent": "WegInsDeutscheBot/0.1 (https://github.com/Silverman91/weg-ins-deutsche) python-requests/2"}
API = "https://commons.wikimedia.org/w/api.php"
TITLES = WORK / "wikt_titles.json"
EXACT = WORK / "wikt_exact.json"
RAW = WORK / "wikt_raw"
EXT = re.compile(r"\.(ogg|oga|wav|flac|mp3|opus)$", re.I)
REGION = re.compile(r"^(at|ch|AT|CH|by|bar|nds|gsw|sw|li|lu|ost|nord|süd)[-_ ]", re.I)
# words whose pronunciation changes with capitalisation: never match these case-insensitively
CASE_SENSITIVE = {"weg", "montage", "modern", "umfahren", "übersetzen", "umgehen", "durchbrechen"}


def get(params):
    for attempt in range(10):
        r = requests.get(API, params={**params, "format": "json", "maxlag": "5"}, headers=UA, timeout=60)
        if r.elapsed.total_seconds() > 1:  # Wikimedia robot policy: after a slow API request, wait 5 s
            time.sleep(5)
        if r.status_code == 200 and r.text.startswith("{") and '"error"' not in r.text[:30]:
            return r.json()
        wait = int(r.headers.get("Retry-After", "0") or 0) or 15 * (attempt + 1)
        print(f"waiting {wait}s (status {r.status_code})", flush=True)
        time.sleep(wait)
    raise SystemExit("Gave up after 10 tries; run again later to resume.")


def cmd_list():
    state = json.loads(TITLES.read_text(encoding="utf-8")) if TITLES.exists() else {"titles": [], "cont": {}}
    if state.get("done"):
        return print(len(state["titles"]), "already complete")
    while True:
        d = get({"action": "query", "list": "allpages", "apnamespace": "6", "apprefix": "De-", "aplimit": "500", **state["cont"]})
        state["titles"] += [p["title"] for p in d["query"]["allpages"]]
        state["cont"] = d.get("continue", {})
        state["done"] = not state["cont"]
        TITLES.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        print(len(state["titles"]), flush=True)
        if state["done"]:
            break
        time.sleep(2)


def word_of(title):
    """'File:De-ihn2.ogg' -> ('ihn', variant=True); None for regional or non-audio files."""
    w = EXT.sub("", title.split(":", 1)[1][3:]).replace("_", " ").strip()
    if not EXT.search(title) or REGION.match(w) or not w:
        return None
    m = re.match(r"^(.*?)(?:[ -]?\(?(\d)\)?)$", w)
    return (m.group(1).strip(), True) if m and m.group(1) else (w, False)


def cmd_match():
    titles = json.loads(TITLES.read_text(encoding="utf-8"))["titles"]
    exact, lower = {}, {}
    for t in sorted(titles):
        wv = word_of(t)
        if not wv:
            continue
        w, variant = wv
        exact.setdefault(w, []).append((variant, t))
        lower.setdefault(w.lower(), []).append((variant, t))
    items = json.loads((WORK / "lines.json").read_text(encoding="utf-8"))["items"]
    real = set(json.loads((WORK / "ll_exact.json").read_text(encoding="utf-8")))
    # recordings that failed a listening check (Whisper heard another word, a repeat, a clipped start): skip
    rej = WORK / "wikt_reject.json"
    real |= set(json.loads(rej.read_text(encoding="utf-8"))) if rej.exists() else set()
    key = lambda s: re.sub(r"[.,:;!?…]+$", "", s.strip())  # noqa: E731
    hits = {}
    for it in items:
        if it["lang"] != "de" or it["alt"] or it["h"] in real:
            continue
        k = key(it["text"])
        # skip single letters ("n." in the app is the spoken short form of "ein", the file is the letter's name)
        if len(k) < 2 or len(k.split()) > 4 or (k.isupper() and len(k) > 1):
            continue
        keys = [k] + ([re.sub(r"^(der|die|das) ", "", k)] if it.get("core") and re.match(r"^(der|die|das) ", k) else [])
        for kk in keys:
            c = exact.get(kk)
            if not c and kk.lower() not in CASE_SENSITIVE:
                # other capitalisation: "Am" -> De-am, but never an all-caps abbreviation file (De-IM is "I-M")
                c = [x for x in lower.get(kk.lower(), []) if not (word_of(x[1])[0].isupper() and len(kk) > 1)]
            if c:
                hits[it["h"]] = {"text": it["text"], "file": min(c)[1], "core": bool(it.get("core"))}
                break
    EXACT.write_text(json.dumps(hits, ensure_ascii=False, indent=0), encoding="utf-8")
    print(len(hits), "segments matched;", sum(h["core"] for h in hits.values()), "of them Core cards;",
          len({h["file"] for h in hits.values()}), "files")


def cmd_download():
    RAW.mkdir(exist_ok=True)
    hits = json.loads(EXACT.read_text(encoding="utf-8"))
    files = sorted({h["file"] for h in hits.values()})
    infop = WORK / "wikt_info.json"
    info = json.loads(infop.read_text(encoding="utf-8")) if infop.exists() else {}
    need = [f for f in files if f not in info]
    for k in range(0, len(need), 50):
        d = get({"action": "query", "titles": "|".join(need[k:k + 50]), "prop": "imageinfo",
                 "iiprop": "url|extmetadata", "iiextmetadatafilter": "LicenseShortName|Artist"})
        norm = {n["to"]: n["from"] for n in d["query"].get("normalized", [])}
        for p in d["query"]["pages"].values():
            ii = (p.get("imageinfo") or [{}])[0]
            md = ii.get("extmetadata", {})
            info[norm.get(p["title"], p["title"])] = {
                "url": ii.get("url"), "licence": md.get("LicenseShortName", {}).get("value", "?"),
                "artist": re.sub(r"<[^>]+>", "", md.get("Artist", {}).get("value", "")).strip() or "unknown"}
        infop.write_text(json.dumps(info, ensure_ascii=False, indent=0), encoding="utf-8")
        time.sleep(2)
    free = lambda l: (l.startswith("CC BY") and "NC" not in l and "ND" not in l) or l.startswith("CC0") or l.lower().startswith("public domain")  # noqa: E731
    ok = [f for f in files if info.get(f, {}).get("url") and free(info[f]["licence"])]
    print(f"{len(ok)} of {len(files)} files have a free licence", flush=True)
    # Wikimedia robot policy for upload.wikimedia.org: at most 2 downloads at once and under 25 Mbps. In practice
    # the server answers 429 (too many requests) well before that, so: one file at a time, a 1 s pause, and the
    # pause doubles (up to 8 s) every time the server says it's busy, after waiting as long as it asks.
    todo = [f for f in ok if not ((RAW / f.split(":", 1)[1].replace(" ", "_")).exists()
                                  and (RAW / f.split(":", 1)[1].replace(" ", "_")).stat().st_size > 1000)]
    print(f"{len(ok) - len(todo)} already here, {len(todo)} to download", flush=True)
    pause = float(os.environ.get("WIKT_PAUSE", "1.0"))  # seconds between files; doubles when the server is busy
    for n, f in enumerate(todo, 1):
        dest = RAW / f.split(":", 1)[1].replace(" ", "_")
        for k in range(6):
            try:
                r = requests.get(info[f]["url"], headers=UA, timeout=60)
            except requests.RequestException as e:
                print(f"network error ({e.__class__.__name__}), retrying in 30s", flush=True)
                time.sleep(30)
                continue
            if r.status_code == 200 and len(r.content) > 1000:
                tmp = dest.with_suffix(dest.suffix + ".part")
                tmp.write_bytes(r.content)
                tmp.replace(dest)
                break
            wait = int(r.headers.get("Retry-After", "0") or 0) or 30 * (k + 1)
            pause = min(8.0, pause * 2)
            print(f"busy ({r.status_code}), waiting {wait}s; pause between files now {pause:.0f}s", flush=True)
            time.sleep(wait)
        time.sleep(pause)
        if n % 100 == 0:
            print(f"{n}/{len(todo)}", flush=True)
    done = sum(1 for f in ok if (RAW / f.split(":", 1)[1].replace(" ", "_")).exists())
    print("DONE", done, "of", len(ok))


def cmd_check():
    """Whisper listens to each downloaded file once (wikt_whisper.json). Files it doesn't hear as exactly the
    expected word go to wikt_reject.json; run `match` again afterwards so they get a generated clip instead."""
    import librosa
    import soundfile as sf
    from words import whisper, norm
    hits = json.loads(EXACT.read_text(encoding="utf-8"))
    logp, rejp = WORK / "wikt_whisper.json", WORK / "wikt_reject.json"
    log = json.loads(logp.read_text(encoding="utf-8")) if logp.exists() else {}
    rej = json.loads(rejp.read_text(encoding="utf-8")) if rejp.exists() else {}
    tmp = WORK / "tmp_gen" / "wikt_check"
    tmp.mkdir(parents=True, exist_ok=True)
    todo = [(h, v) for h, v in hits.items() if h not in log
            and (RAW / v["file"].split(":", 1)[1].replace(" ", "_")).exists()]
    print(len(todo), "files to check", flush=True)
    for k in range(0, len(todo), 150):
        batch, paths = todo[k:k + 150], []
        for h, v in batch:
            y, _ = librosa.load(RAW / v["file"].split(":", 1)[1].replace(" ", "_"), sr=16000, mono=True)
            p = tmp / f"{h}.wav"
            sf.write(p, y, 16000)
            paths.append(p)
        heard = whisper(paths)
        for (h, v), p in zip(batch, paths):
            got = " ".join(x[0] for x in heard.get(str(p), []))
            want = re.sub(r"^(der|die|das) ", "", re.sub(r"[.,:;!?…]+$", "", v["text"].strip())) if v.get("core") else v["text"]
            same = lambda a, b: norm(a).replace("ß", "ss") == norm(b).replace("ß", "ss")  # noqa: E731
            ok = same(got, want) or same(got, v["text"])
            log[h] = {"text": v["text"], "file": v["file"], "heard": got, "ok": ok, "dur": round(sf.info(p).duration, 2)}
            if not ok:
                rej[h] = v["text"]
        logp.write_text(json.dumps(log, ensure_ascii=False, indent=0), encoding="utf-8")
        rejp.write_text(json.dumps(rej, ensure_ascii=False, indent=0), encoding="utf-8")
        print(f"{min(k + 150, len(todo))}/{len(todo)}  rejected so far {sum(1 for h, _ in todo[:k + 150] if not log[h]['ok'])}", flush=True)


if __name__ == "__main__":
    {"list": cmd_list, "match": cmd_match, "download": cmd_download, "check": cmd_check}[sys.argv[1]]()
