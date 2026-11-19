// English narration lines that contain German words (umlauts or very common German words).
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "export_lines.js"), "utf8");
const setup = src.slice(0, src.indexOf("const build ="));
const holder = {};
new Function("require", "process", "__dirname", "ctxOut", setup.replace(/const \[appDir, outFile\][^\n]*\n/, "const appDir = process.argv[2];\n") + "\nctxOut.ctx = ctx;")(require, process, __dirname, holder);
const c = holder.ctx, DE = new Set(fs.readFileSync(path.join(process.argv[2], "app.js"), "utf8").split('const DE_W = new Set("')[1].split('"')[0].split(" ")), AMB = new Set("in an so was die man will war bin hat also am um hi oh bitte".split(" "));
const ids = vm.runInContext("PHASES", c).flatMap(p => p.lessons.map(l => l[0])), seen = new Map();
for (const id of ids) for (const s of c.WID_buildLesson(id)) {
  if (s.lang !== "en" || seen.has(s.text)) continue;
  const ws = (s.text.match(/[A-Za-zÄÖÜäöüß]+/g) || []).filter(w => /[äöüßÄÖÜ]/.test(w) || (DE.has(w.toLowerCase()) && !AMB.has(w.toLowerCase())));
  if (ws.length) seen.set(s.text, id + " [" + ws.join(" ") + "]");
}
fs.writeFileSync(process.argv[3], [...seen].map(([t, i]) => i + " :: " + t).join("\n"));
console.log(seen.size);
