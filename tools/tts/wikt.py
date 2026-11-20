"""Older Wiktionary word recordings ("File:De-<word>.ogg" on Wikimedia Commons, made before Lingua Libre existed).

Usage: wikt.py list       all De-... file names -> wikt_titles.json (resumable, one request every 2 s)
       wikt.py match      segments still without a real recording that a De-... file says exactly -> wikt_exact.json
       wikt.py download   licences + files -> wikt_raw/ (one file every 2 s, honours Retry-After; resumable)
Only standard German (no De-at-/De-ch- variants) and only free licences (CC BY, CC BY-SA, CC0, public domain).
apply_ll.py puts the downloads into the app together with the Lingua Libre ones.
"""
import json
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
    done = 0
    for f in ok:
        dest = RAW / f.split(":", 1)[1].replace(" ", "_")
        if dest.exists() and dest.stat().st_size > 1000:
            done += 1
            continue
        for k in range(6):
            r = requests.get(info[f]["url"], headers=UA, timeout=60)
            if r.status_code == 200 and len(r.content) > 1000:
                dest.write_bytes(r.content)
                done += 1
                break
            wait = int(r.headers.get("Retry-After", "0") or 0) or 30 * (k + 1)
            print(f"busy ({r.status_code}), waiting {wait}s", flush=True)
            time.sleep(wait)
        time.sleep(2)
        if done % 50 == 0:
            print(f"{done}/{len(ok)}", flush=True)
    print("DONE", done, "of", len(ok))


if __name__ == "__main__":
    {"list": cmd_list, "match": cmd_match, "download": cmd_download}[sys.argv[1]]()
