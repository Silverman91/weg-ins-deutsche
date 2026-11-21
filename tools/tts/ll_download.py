"""Download the exact-match Lingua Libre recordings (ll_exact.json) into ll_raw/, politely:
one file at a time, 2 s apart, identifying User-Agent, honouring Retry-After. Resumable."""
import json
import time
from pathlib import Path

import requests

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import WORK, APP  # noqa: E402
ROOT = WORK
RAW = ROOT / "ll_raw"
UA = {"User-Agent": "WegInsDeutscheBot/0.1 (https://github.com/Silverman91/weg-ins-deutsche) python-requests/2"}
API = "https://commons.wikimedia.org/w/api.php"


def urls(titles):
    out = {}
    for k in range(0, len(titles), 50):
        r = requests.get(API, headers=UA, timeout=60, params={"action": "query", "titles": "|".join(titles[k:k + 50]),
                                                               "prop": "imageinfo", "iiprop": "url|extmetadata", "format": "json",
                                                               "maxlag": "5"})
        r.raise_for_status()
        if r.elapsed.total_seconds() > 1:  # Wikimedia robot policy: after a slow API request, wait 5 s
            time.sleep(5)
        norm = {n["to"]: n["from"] for n in r.json()["query"].get("normalized", [])}
        for p in r.json()["query"]["pages"].values():
            ii = (p.get("imageinfo") or [{}])[0]
            md = ii.get("extmetadata", {})
            out[norm.get(p["title"], p["title"])] = (ii.get("url"), md.get("LicenseShortName", {}).get("value", "?"))
        time.sleep(1)
    return out


def main():
    RAW.mkdir(exist_ok=True)
    hits = json.loads((ROOT / "ll_exact.json").read_text(encoding="utf-8"))
    titles = sorted({v["file"] for v in hits.values()})
    info = urls(titles)
    lic = {}
    done = 0
    for t in titles:
        url, licence = info.get(t, (None, "?"))
        lic[t] = licence
        dest = RAW / t.split(":", 1)[1].replace(" ", "_")
        if dest.exists() and dest.read_bytes()[:4] == b"RIFF":
            done += 1
            continue
        if not url:
            print("no url:", t)
            continue
        for k in range(6):
            r = requests.get(url, headers=UA, timeout=60)
            if r.status_code == 200 and r.content[:4] == b"RIFF":
                dest.write_bytes(r.content)
                done += 1
                break
            wait = int(r.headers.get("Retry-After", "0") or 0) or 30 * (k + 1)
            print(f"busy ({r.status_code}), waiting {wait}s", flush=True)
            time.sleep(wait)
        time.sleep(2)
        if done % 25 == 0:
            print(f"{done}/{len(titles)}", flush=True)
    (ROOT / "ll_licences.json").write_text(json.dumps(lic, ensure_ascii=False, indent=0), encoding="utf-8")
    print("DONE", done, "of", len(titles))


if __name__ == "__main__":
    main()
