// Record which clips changed sound but kept their file name, so phones that downloaded them get the new version.
//   node tools/audio-updates.js          clips modified since the last commit (run before committing new audio)
//   node tools/audio-updates.js --all    every clip modified anywhere in the git history (one-off backfill)
// Adds a revision to "updates" in audio/index.json: [[rev, [hash, ...]], ...]. The app deletes the listed clips
// from its offline audio cache once per revision, and "Download all" fetches them again.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const APP = path.resolve(__dirname, "..");
const git = args => execFileSync("git", args, { cwd: APP, encoding: "utf8", maxBuffer: 1 << 26 });
const names = process.argv.includes("--all")
  ? git(["log", "--diff-filter=M", "--name-only", "--format=", "--", "audio/c"])
  : git(["diff", "--name-only", "--diff-filter=M", "HEAD", "--", "audio/c"]);
const idxPath = path.join(APP, "audio", "index.json"), idx = JSON.parse(fs.readFileSync(idxPath, "utf8"));
const live = new Set(idx.clips);
const changed = [...new Set(names.split("\n").map(s => s.trim()).filter(Boolean).map(s => path.basename(s, ".ogg")))].filter(h => live.has(h)).sort();
if (!changed.length) { console.log("no changed clips"); process.exit(0); }
idx.updates = idx.updates || [];
const rev = (idx.updates.length ? Math.max(...idx.updates.map(u => u[0])) : 0) + 1;
idx.updates.push([rev, changed]);
fs.writeFileSync(idxPath, JSON.stringify(idx));
console.log(`revision ${rev}: ${changed.length} changed clips`);
