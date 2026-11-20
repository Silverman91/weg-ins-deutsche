// Loads the app's own scripts in Node with a tiny fake browser, so tools can use the real lesson builder.
// Used by tools/check.js and tools/tts/export_lines.js.
const vm = require("vm"), fs = require("fs"), path = require("path");

const FILES = ["course.js", "lessons-1.js", "lessons-2.js", "lessons-3.js", "lessons-4.js", "lessons-5.js", "lessons-6.js",
  "lessons-7.js", "content.js", "glosses.js", "core-words.js", "app.js"];

function loadApp(appDir) {
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
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(appDir, f), "utf8"), ctx, { filename: f });
  ctx.$get = name => vm.runInContext(name, ctx);
  return ctx;
}

// Same FNV-1a hash as clipHash in app.js: one clip per `${lang}|${alt}|${text}`.
const hash = s => { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, "0"); };

// Everything the app can ask the narrator to say, as unique segments {h, lang, alt, text, core?, where}.
function spokenSegments(ctx) {
  const uniq = new Map(), lessons = {};
  const add = (lang, alt, text, where, extra) => {
    const key = `${lang}|${alt ? 1 : 0}|${text}`;
    if (text && !uniq.has(key)) uniq.set(key, { h: hash(key), lang, alt: !!alt, text, where, ...extra });
  };
  const ids = ctx.$get("PHASES").flatMap(p => p.lessons.map(l => l[0]));
  for (const id of ids) {
    const q = ctx.WID_buildLesson(id);
    lessons[id] = q.length;
    for (const s of q) add(s.lang, s.alt, s.text, id);
    for (const it of ctx.WID_listening(id)) add("de", it.alt, it.text, id + " listening");
  }
  add("en", 0, "Next up:", "player");
  // German lines spoken by buttons outside the narrated lessons: chat drills, stories, the voice test.
  add("de", 0, "Hallo! Schön, dass du Deutsch lernst.", "voice test");
  for (const D of ctx.$get("DRILLS")) for (const t of D.turns) { add("de", 0, t[0], "drill " + D.id); add("de", 0, t[3], "drill " + D.id); }
  for (const st of ctx.$get("STORIES")) for (const p of st.p) add("de", 0, p[0], "story " + st.id);
  // Core 2,000 cards: the Listen button plays the word without its plural ending ("der Mann, -¨er" -> "der Mann").
  for (const w of ctx.CORE_WORDS || []) add("de", 0, cleanWord(w[0]), "core card", { core: true });
  return { ids, lessons, items: [...uniq.values()] };
}
const cleanWord = w => String(w).replace(/,\s*-.*$/, "").replace(/\s*\((pl\.|m\/f|f|m)\)/g, "").replace(/ \/ /g, ", ");

module.exports = { loadApp, hash, spokenSegments, cleanWord, FILES };
