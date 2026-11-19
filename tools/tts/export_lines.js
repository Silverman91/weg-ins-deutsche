// Runs the app's own narration builder in Node (with a tiny fake browser) and writes every spoken
// segment to lines.json, so the audio generator says exactly what the app will ask for.
// Usage: node export_lines.js <appDir> <out.json>
const vm = require("vm"), fs = require("fs"), path = require("path");
const [appDir, outFile] = process.argv.slice(2);
const el = () => new Proxy({ style: {}, classList: { toggle() {} }, dataset: {} }, {
  get: (t, k) => (k in t ? t[k] : k === "addEventListener" ? () => {} : undefined),
  set: (t, k, v) => ((t[k] = v), true),
});
const store = {};
const ctx = {
  window: {}, console, setTimeout, clearTimeout, URL, Blob: function () {},
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: el(), createElement: el, visibilityState: "visible" },
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem: k => delete store[k], clear() {} },
  navigator: {}, location: { protocol: "file:" },
  fetch: () => Promise.reject(new Error("offline")), Audio: function () { return el(); },
};
ctx.window = ctx; vm.createContext(ctx);
for (const f of ["course.js", "lessons-1.js", "lessons-2.js", "lessons-3.js", "lessons-4.js", "lessons-5.js", "lessons-6.js", "lessons-7.js", "content.js", "core-words.js", "app.js"])
  vm.runInContext(fs.readFileSync(path.join(appDir, f), "utf8"), ctx, { filename: f });
const build = ctx.WID_buildLesson, ids = vm.runInContext("PHASES", ctx).flatMap(p => p.lessons.map(l => l[0]));
const hash = s => { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, "0"); };
const uniq = new Map(), lessons = {};
for (const id of ids) {
  const q = build(id);
  lessons[id] = q.length;
  for (const s of q) { const key = `${s.lang}|${s.alt ? 1 : 0}|${s.text}`; if (!uniq.has(key)) uniq.set(key, { h: hash(key), lang: s.lang, alt: !!s.alt, text: s.text }); }
}
for (const extra of ["Next up:"]) { const key = `en|0|${extra}`; if (!uniq.has(key)) uniq.set(key, { h: hash(key), lang: "en", alt: false, text: extra }); }
// German lines spoken by buttons outside the narrated lessons: chat drills, stories, the voice test.
const deExtra = ["Hallo! Schön, dass du Deutsch lernst."];
for (const D of vm.runInContext("DRILLS", ctx)) for (const t of D.turns) deExtra.push(t[0], t[3]);
for (const st of vm.runInContext("STORIES", ctx)) for (const p of st.p) deExtra.push(p[0]);
for (const text of deExtra) { const key = `de|0|${text}`; if (text && !uniq.has(key)) uniq.set(key, { h: hash(key), lang: "de", alt: false, text }); }
// Core 2,000 cards: the Listen button plays the word without its plural ending ("der Mann, -¨er" → "der Mann").
// Marked core: gen_all.py only makes AI clips for these when asked (--core); real recordings come first.
const cleanWord = w => String(w).replace(/,\s*-.*$/, "").replace(/\s*\((pl\.|m\/f|f|m)\)/g, "").replace(/ \/ /g, ", ");
for (const w of ctx.CORE_WORDS || []) { const text = cleanWord(w[0]), key = `de|0|${text}`; if (!uniq.has(key)) uniq.set(key, { h: hash(key), lang: "de", alt: false, text, core: true }); }
const items = [...uniq.values()];
fs.writeFileSync(outFile, JSON.stringify({ lessons, items }, null, 0));
const by = l => items.filter(i => i.lang === l).length;
console.log(`lessons ${ids.length}, segments ${Object.values(lessons).reduce((a, b) => a + b, 0)}, unique ${items.length} (en ${by("en")}, de ${by("de")})`);
console.log("single German words:", items.filter(i => i.lang === "de" && !/\s/.test(i.text.replace(/[.,:;!?…]+$/, ""))).length);
