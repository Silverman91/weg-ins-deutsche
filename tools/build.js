// Builds the static shell of the offline German app (course.js, index.html, sw.js, manifest, icons).
// Usage: node tools/build.js   (everything it needs is in this tools/ folder)
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const out = path.resolve(__dirname, ".."), dataFile = path.join(__dirname, "course-data.js");

// 1) course.js from the German syllabus data, with Talk references made offline-friendly
let data = fs.readFileSync(dataFile, "utf8");
const swaps = [
  ["Introduce yourself for 60 seconds in Talk", "Introduce yourself out loud for 60 seconds"],
  ["Name, origin, job, family, hobbies. Use the 'Meet someone new' chat.", "Name, origin, job, family, hobbies. Record it on your phone and keep it."],
  ["Order breakfast in the bakery chat", "Do the bakery role-play in Speak without help"],
  ["Tell your weekend in Talk for 2 minutes", "Talk about your weekend out loud for 2 minutes"],
  ["Use the 'Tell a friend about your weekend' chat, no English.", "Do the 'Your weekend' role-play first, then record yourself."],
  ["Keep a 15-minute chat going on a new topic", "Have a 15-minute conversation with a real person"],
  ["Hold a 30-minute Talk session with no English", "Hold a 30-minute conversation with no English"],
  ["Watch a full episode with German subtitles and retell it in Talk", "Watch a full episode with German subtitles and retell it out loud"],
];
for (const [a, b] of swaps) { if (!data.includes(a)) throw new Error("missing: " + a); data = data.split(a).join(b); }
fs.writeFileSync(path.join(out, "course.js"), "// Course outline: phases, lessons, series and listening milestones.\n" + data);

// 2) index.html using the artifact's styles, with system fonts
let css = fs.readFileSync(path.join(__dirname, "base.css"), "utf8"); // the styles of the original course page
css = css.replace('--f-display:"Bricolage Grotesque", "Segoe UI", system-ui, sans-serif;', '--f-display:system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;')
         .replace('--f-body:"Inter", system-ui, -apple-system, "Segoe UI", sans-serif;', '--f-body:system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;')
         .replace('--f-mono:"JetBrains Mono", ui-monospace, Consolas, monospace;', '--f-mono:ui-monospace, "Roboto Mono", Consolas, monospace;');
css += `
:root{padding-top:env(safe-area-inset-top,0px)}
html{-webkit-text-size-adjust:100%}
body{margin:0}
[hidden]{display:none!important}
.chat .fb{max-width:100%}
label.btn{display:inline-grid;place-items:center}
.listen-cta{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.player{position:fixed;left:0;right:0;bottom:calc(60px + env(safe-area-inset-bottom,0px));z-index:7;background:var(--surface);border-top:1px solid var(--line);box-shadow:0 -6px 18px rgba(0,0,0,.12)}
.pwrap{padding-block:8px;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}
.pinfo{min-width:0;display:grid;gap:3px}
.pinfo b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pinfo span{font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pbar{height:3px;background:var(--tile-soft);border-radius:3px;overflow:hidden}
.pbar i{display:block;height:100%;background:var(--tile)}
.pctrl{display:flex;gap:2px}
.pbtn{width:40px;height:40px;border:0;background:none;border-radius:10px;font-size:18px;cursor:pointer;color:var(--ink)}
.pbtn.main{background:var(--tile);color:var(--surface)}
.lang{font-style:normal;font-family:var(--f-mono);font-size:10px;padding:1px 5px;border-radius:4px;background:var(--saffron-soft);color:var(--ink);margin-right:4px;vertical-align:1px}
body.has-player main .wrap{padding-bottom:calc(170px + env(safe-area-inset-bottom,0px))}
.car{position:fixed;inset:0;z-index:20;background:var(--bg);display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) max(24px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}
.carin{width:100%;max-width:560px;display:grid;gap:18px;justify-items:center;text-align:center}
.carin h2{font-size:26px}
.cartext{font-size:24px;line-height:1.35;min-height:5.5em;display:grid;place-items:center;overflow-wrap:anywhere}
.carctrl{display:flex;gap:18px;align-items:center}
.carctrl .pbtn{width:84px;height:84px;font-size:34px;border-radius:50%;background:var(--tile-soft)}
.carctrl .pbtn.main{width:112px;height:112px;font-size:44px;background:var(--tile);color:var(--surface)}
.carauto{display:flex;gap:8px;align-items:center}
.chips.sbs{margin:2px 0 16px}.chips.sbs .chip{font-size:15px;padding:8px 14px}
.car:has(.plist){place-items:stretch}
.plist{width:100%;max-width:640px;margin:0 auto;height:100%;display:grid;grid-template-rows:auto 1fr auto;gap:12px;min-height:0}
.plhead{display:flex;justify-content:space-between;align-items:center;gap:12px}
.pllines{margin:0;padding:0;list-style:none;overflow-y:auto;min-height:0;display:grid;gap:4px;align-content:start}
.pllines li{padding:10px 12px;border-radius:10px;cursor:pointer;line-height:1.4;font-size:17px;border:1px solid transparent}
.pllines li.de{font-weight:600}
.pllines li:hover{background:var(--tile-soft)}
.pllines li.cur{background:var(--tile-soft);border-color:var(--tile)}
.plctrl{justify-content:center}.plrep{display:flex;justify-content:center}
.cartext{display:grid;gap:10px;align-content:center}.cartext p{margin:0}.cartext .gloss{font-size:18px;color:var(--ink-soft,var(--muted));font-style:italic}
.pllines .gloss{display:block;font-weight:400;font-style:italic;font-size:14px;opacity:.75;margin-top:2px}
.plctrl .pbtn{width:64px;height:64px;font-size:26px}.plctrl .pbtn.main{width:80px;height:80px;font-size:32px}
nav.bottom .wrap{grid-template-columns:repeat(7,1fr)}
nav.bottom button{font-size:10px}
/* games */
.g-icon{font-size:28px;width:44px;height:44px;display:grid;place-items:center;flex:none}
.g-card.locked{opacity:.65}
.g-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.g-score{font-family:var(--f-mono);font-size:14px}
.g-prog{height:6px;border-radius:6px;background:var(--tile-soft);overflow:hidden}
.g-prog i{display:block;height:100%;background:var(--saffron);transition:width .3s}
.g-stage{display:grid;gap:14px;min-height:340px;align-content:start}
.g-arena{position:relative;height:300px;border-radius:14px;background:var(--surface);border:1px solid var(--line);overflow:hidden}
.g-fall{position:absolute;left:50%;top:0;transform:translateX(-50%);text-align:center;display:grid;gap:2px;animation-name:gfall;animation-timing-function:linear;animation-fill-mode:forwards}
.g-fall b{font-size:30px;font-family:var(--f-display)}
.g-fall small{color:var(--muted)}
@keyframes gfall{from{top:0}to{top:calc(100% - 64px)}}
.g-arts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.g-art{min-height:64px;border-radius:14px;border:2px solid var(--line);background:var(--surface);font-size:22px;font-weight:700;cursor:pointer}
.g-der{color:#2d6cdf}.g-die{color:#d6336c}.g-das{color:#2f9e44}
.g-art.right{background:var(--ok-soft);border-color:var(--ok)}.g-art.wrong{background:var(--bad-soft);border-color:var(--bad)}
.g-hint{color:var(--muted);font-style:italic}
.g-line{min-height:64px;border:2px dashed var(--line);border-radius:12px;padding:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.g-line.right{border-color:var(--ok);background:var(--ok-soft)}.g-line.wrong{border-color:var(--bad);background:var(--bad-soft)}
.g-bank{display:flex;flex-wrap:wrap;gap:8px}
.g-tile{border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:10px 12px;font-size:17px;cursor:pointer;min-height:44px}
.g-tile.in{background:var(--tile-soft);border-color:var(--tile)}
.g-end{font-size:20px;font-weight:700}
.g-listen{display:grid;justify-items:center;gap:8px;padding:12px}
.g-play{width:96px;height:96px;border-radius:50%;border:0;background:var(--tile);color:var(--surface);font-size:40px;cursor:pointer}
.g-word{font-size:26px;font-family:var(--f-display)}
.g-q{font-size:20px;line-height:1.4}
.g-blank{background:var(--saffron-soft);padding:0 6px;border-radius:6px}
.g-result h2{font-size:40px}
@media (prefers-reduced-motion: reduce){.g-fall{animation-timing-function:steps(4)}}
`;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Weg ins Deutsche</title>
<meta name="description" content="Learn German offline, from zero to C1: lessons, flashcards, speaking role-plays and stories.">
<meta name="theme-color" content="#9B2C2C">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="icon-192.png">
<style>${css}</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <div class="brand">
      <h1>Weg ins <span>Deutsche</span></h1>
      <div class="lvl">NIVEAU <b id="curLevel">A0</b> · <span id="overallPct">0</span> LESSONS</div>
    </div>
    <div class="bar" aria-hidden="true"><i id="overallBar" style="width:0%"></i></div>
  </div>
</header>
<main><div class="wrap" id="view"></div></main>
<div id="player" class="player" hidden></div>
<div id="car" class="car" hidden></div>
<nav class="bottom" aria-label="Sections"><div class="wrap" id="nav"></div></nav>
<script src="course.js"></script>
<script src="lessons-1.js"></script>
<script src="lessons-2.js"></script>
<script src="lessons-3.js"></script>
<script src="lessons-4.js"></script>
<script src="lessons-5.js"></script>
<script src="lessons-6.js"></script>
<script src="content.js"></script>
<script src="games.js"></script>
<script src="glosses.js"></script>
<script src="core-words.js"></script>
<script src="app.js"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(out, "index.html"), html);

// 3) manifest and service worker
const files = ["./", "index.html", "course.js", "lessons-1.js", "lessons-2.js", "lessons-3.js", "lessons-4.js", "lessons-5.js", "lessons-6.js", "content.js", "games.js", "glosses.js", "core-words.js", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
fs.writeFileSync(path.join(out, "manifest.webmanifest"), JSON.stringify({
  name: "Weg ins Deutsche", short_name: "Deutsch", description: "Learn German offline, from zero to C1.",
  start_url: "./", scope: "./", display: "standalone", orientation: "portrait",
  background_color: "#F8F6F4", theme_color: "#9B2C2C",
  icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }]
}, null, 2));
const hash = require("crypto").createHash("sha1");
for (const f of files.slice(1)) if (f !== "icon-192.png" && f !== "icon-512.png" && f !== "manifest.webmanifest") hash.update(fs.readFileSync(path.join(out, f)));
const ver = hash.digest("hex").slice(0, 10);
fs.writeFileSync(path.join(out, "sw.js"), `// Offline cache for Weg ins Deutsche. The version changes whenever the app files change.
const CACHE = "wid-${ver}";
const FILES = ${JSON.stringify(files)};
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
// Lesson audio lives in its own cache ("wid-audio") so app updates don't delete downloaded clips.
const AUDIO = "wid-audio";
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== AUDIO).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url), isClip = url.pathname.includes("/audio/c/");
  if (url.pathname.endsWith("/audio/index.json")) { // newest list when online, cached copy offline
    e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(AUDIO).then(c => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(isClip ? AUDIO : CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => (isClip ? Response.error() : caches.match("index.html")))));
});
`);

// 4) icons: oxblood square, cream "D", gold underline (drawn pixel by pixel)
function png(size) {
  const s = size / 512, raw = Buffer.alloc((size * 4 + 1) * size);
  const bg = [155, 44, 44], fg = [248, 240, 230], gold = [242, 190, 58];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const X = x / s, Y = y / s; let c = bg;
      const inBar = X >= 170 && X <= 214 && Y >= 136 && Y <= 356;
      const dx = (X - 214) / 150, dy = (Y - 246) / 110, dxi = (X - 214) / 106, dyi = (Y - 246) / 66;
      const inRing = X >= 214 && dx * dx + dy * dy <= 1 && dxi * dxi + dyi * dyi > 1;
      const inTop = X >= 170 && X <= 214 && ((Y >= 136 && Y <= 180) || (Y >= 312 && Y <= 356));
      if (inBar || inRing || inTop) c = fg;
      if (X >= 170 && X <= 364 && Y >= 384 && Y <= 404) c = gold;
      const o = y * (size * 4 + 1) + 1 + x * 4; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
    }
  }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(type), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
fs.writeFileSync(path.join(out, "icon-192.png"), png(192));
fs.writeFileSync(path.join(out, "icon-512.png"), png(512));
console.log("built", out, "cache", ver);
