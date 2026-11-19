"""Download the list of German Lingua Libre recordings (file names only) from Wikimedia Commons.
Polite: one request every 3 s, honours Retry-After on 429, saves after every page so it can resume."""
import json
import time
from pathlib import Path

import requests

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import WORK  # noqa: E402
OUT = WORK / "ll_deu_titles.json"
STATE = WORK / "ll_deu_state.json"
UA = {"User-Agent": "WegInsDeutscheBot/0.1 (https://github.com/Silverman91/weg-ins-deutsche) python-requests/2"}
API = "https://commons.wikimedia.org/w/api.php"

titles = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else []
cont = json.loads(STATE.read_text()) if STATE.exists() else {}
if cont.get("done"):
    print(len(titles), "already complete")
    raise SystemExit
pages = 0
while True:
    p = {"action": "query", "list": "categorymembers", "cmtitle": "Category:Lingua Libre pronunciation-deu",
         "cmtype": "file", "cmlimit": "500", "format": "json", "maxlag": "5"}
    p.update(cont)
    for attempt in range(10):
        r = requests.get(API, params=p, headers=UA, timeout=60)
        if r.status_code == 200 and r.text.startswith("{") and '"error"' not in r.text[:30]:
            break
        wait = int(r.headers.get("Retry-After", "0") or 0) or 15 * (attempt + 1)
        print(f"waiting {wait}s (status {r.status_code})", flush=True)
        time.sleep(wait)
    else:
        raise SystemExit("Gave up after 10 tries; run again later to resume.")
    d = r.json()
    titles += [m["title"] for m in d["query"]["categorymembers"]]
    pages += 1
    cont = d.get("continue", {})
    OUT.write_text(json.dumps(titles, ensure_ascii=False), encoding="utf-8")
    STATE.write_text(json.dumps(cont or {"done": True}))
    print(f"page {pages}: {len(titles)} names", flush=True)
    if not cont:
        break
    time.sleep(3)
print("DONE", len(titles))
