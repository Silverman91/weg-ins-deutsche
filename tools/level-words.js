// Builds level-words.js (word decks A1 to C1) from the hand-written parts in tools/levels/.
// A1–B1 fill the gaps between the Core deck and the Goethe-Institut word lists; B2 and C1 add the next most
// useful words. Words already in the Core deck, in a lesson's word list or at a lower level are dropped.
// Usage: node tools/level-words.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const APP = path.join(__dirname, ".."), dir = path.join(__dirname, "levels"), LEVELS = ["A1", "A2", "B1", "B2", "C1"];
const ctx = { window: {} }; ctx.window = ctx;
for (const f of fs.readdirSync(dir).filter(f => /^words-.*\.js$/.test(f)).sort())
  vm.runInNewContext(fs.readFileSync(path.join(dir, f), "utf8"), ctx, { filename: f });
for (const f of ["core-words.js", "lessons-1.js", "lessons-2.js", "lessons-3.js", "lessons-4.js", "lessons-5.js", "lessons-6.js", "lessons-7.js"])
  vm.runInNewContext(fs.readFileSync(path.join(APP, f), "utf8"), ctx, { filename: f });
// Same word = same spelling once the article, "sich", plural and notes in brackets are gone (case-insensitive).
const key = de => String(de).replace(/,\s*-.*$/, "").replace(/\s*\(.*?\)/g, "").replace(/^(der\/die|der|die|das|sich)\s+/i, "").trim().toLowerCase();
const seen = new Map();
for (const w of ctx.CORE_WORDS) seen.set(key(w[0]), "core");
for (const L of Object.values(ctx.LESSONS)) for (const v of L.v || []) seen.set(key(v[0]), "lesson");
// Words a themed part lists at a higher level than learners need them (LW.MOVE, in tools/levels/words-zz-moves.js).
const MOVE = ctx.LW.MOVE || {}, moved = new Set();
for (const lv of LEVELS) ctx.LW[lv] = (ctx.LW[lv] || []).filter(e => {
  const to = MOVE[String(e[0]).replace(/,\s*-.*$/, "")];
  if (!to || to === lv) return true;
  (ctx.LW[to] = ctx.LW[to] || []).push(e); moved.add(e[0]); return false;
});
const unknown = Object.keys(MOVE).filter(w => ![...moved].some(m => m.replace(/,\s*-.*$/, "") === w));
if (unknown.length) console.log("MOVE entries not found:", unknown.join(", "));
const out = {}, dropped = [];
for (const lv of LEVELS) {
  out[lv] = [];
  for (const [de, en, note] of ctx.LW[lv] || []) {
    if (!de || !en) throw new Error(`${lv}: incomplete entry ${JSON.stringify([de, en])}`);
    const k = key(de);
    if (seen.has(k)) { dropped.push(`${lv} ${de} (${seen.get(k)})`); continue; }
    seen.set(k, lv); out[lv].push(note ? [de, en, note] : [de, en]);
  }
}
const body = LEVELS.map(lv => `${lv}:[\n` + out[lv].map(e => JSON.stringify(e)).join(",\n") + "\n]").join(",\n");
fs.writeFileSync(path.join(APP, "level-words.js"),
  "// Word decks by level, A1 to C1: words a learner needs at each level beyond the Core deck and the lessons.\n" +
  "// [German (nouns with article and plural), English, grammar note]. Built by tools/level-words.js.\n" +
  "window.LEVEL_WORDS = {\n" + body + "\n};\n");
console.log(LEVELS.map(lv => `${lv} ${out[lv].length}`).join(" · "), `· dropped ${dropped.length}`);
if (process.argv.includes("-v")) console.log(dropped.join("\n"));
