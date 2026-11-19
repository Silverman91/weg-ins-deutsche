// List German narration lines that have no English gloss yet (for car mode translations).
const fs = require("fs"), path = require("path"), vm = require("vm");
const appDir = process.argv[2], out = process.argv[3];
const src = fs.readFileSync(path.join(__dirname, "export_lines.js"), "utf8");
const setup = src.slice(0, src.indexOf("const build ="));
const ctx = {};
new Function("require", "process", "__dirname", "ctxOut", setup.replace(/const \[appDir, outFile\][^\n]*\n/, "const appDir = process.argv[2];\n") + "\nctxOut.ctx = ctx;")(require, process, __dirname, ctx);
const c = ctx.ctx, by = {};
const ids = vm.runInContext("PHASES", c).flatMap(p => p.lessons.map(l => l[0])), seen = new Set();
for (const id of ids) for (const s of c.WID_buildLesson(id)) {
  const t = s.text.trim();
  if (s.lang !== "de" || seen.has(t) || c.WID_gloss(t) || /^[a-zäöüß]$/i.test(t) || /^-|-$/.test(t)) continue;
  seen.add(t); (by[id] = by[id] || []).push(t);
}
fs.writeFileSync(out, JSON.stringify(by, null, 1));
console.log(seen.size, "lines without a gloss");
