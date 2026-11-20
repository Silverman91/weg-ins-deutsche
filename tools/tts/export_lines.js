// Runs the app's own narration builder in Node (with a tiny fake browser) and writes every segment the app can
// speak to lines.json, so the audio generator says exactly what the app will ask for.
// Usage: node export_lines.js <appDir> <out.json>
const fs = require("fs"), path = require("path");
const { loadApp, spokenSegments } = require(path.join(__dirname, "..", "load-app"));
const [appDir, outFile] = process.argv.slice(2);
const { ids, lessons, items: all } = spokenSegments(loadApp(path.resolve(appDir)));
// Core 2,000 card words are marked core: gen_all.py only makes AI clips for them when asked (--core).
const items = all.map(({ where, ...i }) => i);
fs.writeFileSync(outFile, JSON.stringify({ lessons, items }, null, 0));
const by = l => items.filter(i => i.lang === l).length;
console.log(`lessons ${ids.length}, segments ${Object.values(lessons).reduce((a, b) => a + b, 0)}, unique ${items.length} (en ${by("en")}, de ${by("de")})`);
console.log("single German words:", items.filter(i => i.lang === "de" && !/\s/.test(i.text.replace(/[.,:;!?…]+$/, ""))).length);
