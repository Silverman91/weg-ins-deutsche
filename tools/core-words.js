// Builds core-words.js (the Core 2,000 deck) from the four hand-written parts in tools/core/.
// Cleans up: "freuen (sich)" → "sich freuen"; drops duplicates and entries only there to disambiguate.
// Usage: node tools/core-words.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const dir = path.join(__dirname, "core"), ctx = { window: {} };
for (const f of fs.readdirSync(dir).filter(f => /^core-words-\d\.js$/.test(f)).sort())
  vm.runInNewContext(fs.readFileSync(path.join(dir, f), "utf8"), ctx);
const DROP = new Set(["Zeit", "Herr", "los sein", "kommen Sie", "vielleicht nicht", "wieder da", "eins, zwei, drei", "ganz gut",
  "krank sein", "ruhig bleiben", "allein sein", "sicher sein", "frei sein", "gefährlich sein", "brauchen nicht", "erzählen von",
  "bekommen von", "finden zu", "der Weg nach", "damals schon", "das Wochenende über", "die Zeit vergeht", "die Zahl steigt",
  "die Hälfte davon", "etwa die Hälfte", "leer machen", "schreiben an", "die Liebe auf den ersten Blick", "die Erfahrung haben",
  "der Termin beim Arzt", "Recht bekommen", "Sorgen machen (sich)", "wohl fühlen (sich)", "die Geduld haben"]);
const key = de => de.replace(/,\s*-.*$/, "").trim(); // same spelling, article and capitals = duplicate
const seen = new Set(), out = [], dropped = [];
for (let [de, en, note] of ctx.window.CORE_WORDS) {
  const m = /^(.+) \(sich\)$/.exec(de); if (m) de = "sich " + m[1];
  if (DROP.has(de) || /\(/.test(de)) { dropped.push(de); continue; }
  const k = key(de); if (seen.has(k)) { dropped.push(de + " (dup)"); continue; }
  seen.add(k); out.push(note ? [de, en, note] : [de, en]);
}
const body = out.map(e => JSON.stringify(e)).join(",\n");
fs.writeFileSync(path.join(__dirname, "..", "core-words.js"),
  "// Core words: the most common words of everyday spoken German, roughly in frequency order.\n" +
  "// [German (nouns with article and plural), English, grammar note]. Built by tools/core-words.js.\n" +
  "window.CORE_WORDS = [\n" + body + "\n];\n");
console.log("kept", out.length, "dropped", dropped.length);
console.log(dropped.join(" | "));
