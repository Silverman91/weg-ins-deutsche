// Audio review: listen to the app's clips and the downloaded recordings, and mark the bad ones.
//
//   node tools/audio-review.js          serves the review page on http://localhost:5175 (Ctrl+C to stop)
//   node tools/audio-review.js apply    carries out your decisions (then run the commands it prints)
//
// What you can review (groups in the page):
//   - Wiktionary recordings Whisper rejected: often fine, since Whisper mishears single words. "Use it" puts
//     them back.
//   - Greta clips Whisper scored low (sentence_audit.json, words_report.txt).
//   - Card words, story lines, lessons: everything the app plays, with its source (Greta, Lingua Libre, Wiktionary).
// Decisions are saved as you go in <work>/audio_review.json:
//   ok      the clip is fine
//   remake  Greta clip: delete it so gen_all.py makes it again; real recording: stop using it (Greta reads it)
//   use     a recording Whisper rejected is fine after all: use it
// Work folder: tools/tts/local.json "work", or WID_WORK, or ../tts next to the repo (same as the Python tools).
const http = require("http"), fs = require("fs"), path = require("path");
const { loadApp, spokenSegments } = require("./load-app.js");
const APP = path.join(__dirname, ".."), PORT = +process.env.PORT || 5175;
const local = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "tts", "local.json"), "utf8")); } catch (e) { return {}; } })();
const WORK = process.env.WID_WORK || local.work || path.join(APP, "..", "tts");
const CLIPS = path.join(APP, "audio", "c"), DECISIONS = path.join(WORK, "audio_review.json");
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(WORK, f), "utf8")); } catch (e) { return d; } };
const rawName = file => file.split(":").slice(1).join(":").replace(/ /g, "_");

function buildItems() {
  const ctx = loadApp(APP), { items } = spokenSegments(ctx);
  const ll = readJson("ll_exact.json", {}), wk = readJson("wikt_exact.json", {}), wlog = readJson("wikt_whisper.json", {});
  const wrej = readJson("wikt_reject.json", {}), llrej = new Set(readJson("ll_reject.json", [])), audit = readJson("sentence_audit.json", {});
  // single words Greta had no clean take for (words.py writes "<word> -> no fully clean take …")
  const flagged = new Set();
  try { for (const l of fs.readFileSync(path.join(WORK, "words_report.txt"), "utf8").split(/\r?\n/)) { const m = l.match(/^(.+?)\s+-> no fully clean take/); if (m) flagged.add(m[1].trim()); } } catch (e) { /* none */ }
  const out = [];
  for (const it of items) {
    if (it.lang !== "de") continue;
    const group = it.core ? "cards" : /^story /.test(it.where) ? "stories" : /^drill /.test(it.where) ? "drills" : "lessons";
    const clip = fs.existsSync(path.join(CLIPS, it.h + ".ogg")) ? `/clip/${it.h}.ogg` : null;
    let src = "greta", url = clip, heard = null, score = null, note = "";
    if (ll[it.h] && !llrej.has(it.h)) { src = "Lingua Libre · " + ll[it.h].speaker; url = "/ll/" + encodeURIComponent(rawName(ll[it.h].file)); }
    else if (wk[it.h]) { src = "Wiktionary"; url = "/wikt/" + encodeURIComponent(rawName(wk[it.h].file)); const w = wlog[it.h]; if (w) { heard = w.heard; score = w.ok ? 1 : 0; } }
    else if (audit[it.h]) { heard = audit[it.h].heard; score = audit[it.h].score; }
    if (src === "greta" && flagged.has(it.text)) note = "no clean take";
    out.push({ h: it.h, text: it.text, where: it.where, group, src, url, greta: clip, heard, score, note });
  }
  // recordings Whisper rejected: the app uses Greta for these now; listen to the recording that was turned down
  for (const [h, text] of Object.entries(wrej)) {
    const w = wlog[h]; if (!w) continue;
    const it = out.find(x => x.h === h);
    out.push({ h, text, where: it ? it.where : "", group: "rejected", src: "Wiktionary (rejected)", url: "/wikt/" + encodeURIComponent(rawName(w.file)),
      greta: it && it.greta, heard: w.heard, score: 0, note: "" });
  }
  return out;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac", ".mp3": "audio/mpeg" };
function serveFile(res, f) {
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(data);
  });
}
function inside(dir, name) { const f = path.join(dir, name); return f.startsWith(path.resolve(dir) + path.sep) ? f : null; }

function serve() {
  let ITEMS = buildItems();
  http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    if (u === "/" || u === "/index.html") return serveFile(res, path.join(__dirname, "audio-review.html"));
    if (u === "/items.json") { if (req.url.includes("reload")) ITEMS = buildItems(); res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(ITEMS)); }
    if (u === "/decisions.json" && req.method === "GET") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(readJson("audio_review.json", {}))); }
    if (u === "/decide" && req.method === "POST") {
      let body = ""; req.on("data", c => { body += c; if (body.length > 1e5) req.destroy(); });
      return req.on("end", () => {
        try { const { h, d, text } = JSON.parse(body), all = readJson("audio_review.json", {});
          if (!/^[0-9a-f]{8}$/.test(h)) throw new Error("bad id");
          if (d) all[h] = { d, text, at: new Date().toISOString() }; else delete all[h];
          fs.writeFileSync(DECISIONS, JSON.stringify(all, null, 0)); res.writeHead(200); res.end("ok");
        } catch (e) { res.writeHead(400); res.end(String(e.message)); }
      });
    }
    const m = u.match(/^\/(clip|ll|wikt)\/(.+)$/);
    if (m) { const dir = { clip: CLIPS, ll: path.join(WORK, "ll_raw"), wikt: path.join(WORK, "wikt_raw") }[m[1]], f = inside(dir, m[2]); if (f) return serveFile(res, f); }
    res.writeHead(404); res.end("not found");
  }).listen(PORT, "127.0.0.1", () => console.log(`Audio review: http://localhost:${PORT}  (${ITEMS.length} clips; decisions go to ${DECISIONS})`));
}

function apply() {
  const all = readJson("audio_review.json", {}), items = buildItems(), byH = new Map();
  for (const it of items) if (!byH.has(it.h) || it.group === "rejected") byH.set(it.h, it);
  const wrej = readJson("wikt_reject.json", {}), llrej = new Set(readJson("ll_reject.json", []));
  const ll = readJson("ll_exact.json", {}), wk = readJson("wikt_exact.json", {});
  let deleted = 0, unrejected = 0, rejected = 0;
  for (const [h, v] of Object.entries(all)) {
    if (v.done) continue;
    if (v.d === "use" && wrej[h]) { delete wrej[h]; unrejected++; v.done = true; }
    else if (v.d === "remake") {
      if (ll[h] && !llrej.has(h)) { llrej.add(h); rejected++; }
      else if (wk[h] && !wrej[h]) { wrej[h] = v.text; rejected++; }
      const f = path.join(CLIPS, h + ".ogg"); if (fs.existsSync(f)) { fs.unlinkSync(f); deleted++; }
      v.done = true;
    }
  }
  fs.writeFileSync(path.join(WORK, "wikt_reject.json"), JSON.stringify(wrej, null, 0));
  fs.writeFileSync(path.join(WORK, "ll_reject.json"), JSON.stringify([...llrej]));
  fs.writeFileSync(DECISIONS, JSON.stringify(all, null, 0));
  console.log(`Recordings put back: ${unrejected} · recordings no longer used: ${rejected} · clips deleted to be made again: ${deleted}`);
  console.log(`Now run (from the work folder's venv):
  python tools/tts/ll_exact.py
  python tools/tts/wikt.py match
  python tools/tts/gen_all.py --core
  python tools/tts/apply_ll.py`);
}

if (process.argv[2] === "apply") apply(); else serve();
