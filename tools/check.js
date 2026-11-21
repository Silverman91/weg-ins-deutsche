// Health check for the whole app. Run after any change to lessons, app code or audio:
//   node tools/check.js            (exit code 1 if something is broken)
//   node tools/check.js --orphans  (also list clip files nothing uses)
// Checks: every lesson is complete and its exercises are well-formed, every line the app can speak has a clip
// (and audio/index.json lists exactly the clips on disk), German lines have an English meaning for car mode,
// and every file the page and the service worker load exists.
const fs = require("fs"), path = require("path");
const { loadApp, spokenSegments } = require("./load-app");
const APP = path.resolve(__dirname, "..");
const errors = [], warnings = [];
const err = m => errors.push(m), warn = m => warnings.push(m);

const ctx = loadApp(APP);
const PHASES = ctx.$get("PHASES"), LESSONS = ctx.$get("LESSONS");
const { ids, items } = spokenSegments(ctx);

// 1. lessons
const need = { x: 3, d: 4, v: 6, e: 5 };
for (const id of ids) {
  const L = LESSONS[id];
  if (!L) { err(`lesson ${id}: in the outline but has no content`); continue; }
  for (const [k, n] of Object.entries(need)) if (!Array.isArray(L[k]) || L[k].length < n) err(`lesson ${id}: needs at least ${n} "${k}" items, has ${(L[k] || []).length}`);
  if (!L.i) err(`lesson ${id}: no introduction`);
  (L.e || []).forEach((e, j) => {
    if (e[0] === "c") { if (!Array.isArray(e[2]) || !(e[3] >= 0 && e[3] < e[2].length) || !e[4]) err(`lesson ${id} exercise ${j + 1}: choice question is malformed`); }
    else if (e[0] === "w") { if (!e[1] || !e[2] || !e[4]) err(`lesson ${id} exercise ${j + 1}: writing question is malformed`); }
    else err(`lesson ${id} exercise ${j + 1}: unknown type ${e[0]}`);
  });
  if (ctx.WID_listening(id).length < 3) warn(`lesson ${id}: only ${ctx.WID_listening(id).length} listening items`);
}
for (const id of Object.keys(LESSONS)) if (!ids.includes(id)) warn(`lesson ${id}: has content but is not in the course outline`);

// 2. audio
const clipDir = path.join(APP, "audio", "c");
const onDisk = new Set(fs.readdirSync(clipDir).filter(f => f.endsWith(".ogg")).map(f => f.slice(0, -4)));
const index = JSON.parse(fs.readFileSync(path.join(APP, "audio", "index.json"), "utf8"));
const listed = new Set(index.clips);
for (const h of listed) if (!onDisk.has(h)) err(`audio/index.json lists ${h} but the file is missing`);
for (const h of onDisk) if (!listed.has(h)) warn(`clip ${h} is on disk but not in audio/index.json (rerun apply_ll.py)`);
const missing = items.filter(i => !listed.has(i.h));
const missCore = missing.filter(i => i.core), missOther = missing.filter(i => !i.core);
for (const i of missOther.slice(0, 20)) err(`no clip for ${i.lang} "${i.text}" (${i.where})`);
if (missOther.length > 20) err(`...and ${missOther.length - 20} more lines without a clip`);
if (missCore.length) warn(`${missCore.length} Core card words have no clip (the phone voice reads them)`);
const used = new Set(items.map(i => i.h)), orphans = [...onDisk].filter(h => !used.has(h));
if (orphans.length) warn(`${orphans.length} clip files are not used by any line (safe to move out)`);
if (process.argv.includes("--orphans")) console.log(orphans.join("\n"));
if (!(index.credits || []).length) err("audio/index.json has no speaker credits");

// 3. car-mode meanings
const de = items.filter(i => i.lang === "de" && !i.core && !/ /.test(i.where)); // car mode plays the lesson narration only
const noGloss = de.filter(i => !ctx.WID_gloss(i.text));
if (noGloss.length > de.length * 0.05) warn(`${noGloss.length} of ${de.length} German lines have no English meaning in car mode`);

// 4. files the page and the service worker load
const html = fs.readFileSync(path.join(APP, "index.html"), "utf8");
for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) if (!fs.existsSync(path.join(APP, m[1]))) err(`index.html loads ${m[1]}, which does not exist`);
const sw = fs.readFileSync(path.join(APP, "sw.js"), "utf8");
const shell = (sw.match(/\[([^\]]*\.js[^\]]*)\]/) || [])[1] || "";
for (const m of shell.matchAll(/"([^"]+)"/g)) { const f = m[1].replace(/^\.\//, ""); if (f && !fs.existsSync(path.join(APP, f || "index.html"))) err(`sw.js caches ${m[1]}, which does not exist`); }
for (const f of fs.readdirSync(APP).filter(f => /\.js$/.test(f) && f !== "sw.js")) if (!html.includes(f)) warn(`${f} is not loaded by index.html`);

// 5. free materials and lesson links (resources.js)
const RES = ctx.RESOURCES || [], KINDS = ctx.RESOURCE_KINDS || {}, LINKS = ctx.LESSON_LINKS || {}, resIds = new Set(RES.map(r => r.id));
for (const r of RES) {
  if (!/^https:\/\//.test(r.url)) err(`resource ${r.id} has a non-https link: ${r.url}`);
  if (!KINDS[r.kind]) err(`resource ${r.id} has an unknown kind: ${r.kind}`);
  if (!r.lv.length || r.lv.some(l => !["A1", "A2", "B1", "B2", "C1"].includes(l))) err(`resource ${r.id} has bad levels: ${r.lv}`);
}
for (const [id, links] of Object.entries(LINKS)) {
  if (!LESSONS[id]) err(`LESSON_LINKS has a link for unknown lesson ${id}`);
  for (const x of links) {
    const ref = x.length === 1 ? x[0] : x[2];
    if (!resIds.has(ref)) err(`lesson ${id} links to unknown resource ${ref}`);
    if (x.length > 1 && !/^https:\/\//.test(x[1])) err(`lesson ${id} has a non-https link: ${x[1]}`);
  }
}

// report
const n = ids.length, segs = items.filter(i => !i.core).length, core = items.filter(i => i.core).length;
console.log(`${n} lessons · ${segs} spoken lines · ${core} Core card words · ${listed.size} clips (${index.credits.length} credited speakers)`);
console.log(`real recordings vs generated: see audio/index.json credits; car-mode meanings: ${de.length - noGloss.length}/${de.length}`);
for (const w of warnings) console.log("warning:", w);
for (const e of errors) console.log("ERROR:", e);
console.log(errors.length ? `${errors.length} problem(s) found` : "All checks passed");
process.exit(errors.length ? 1 : 0);
