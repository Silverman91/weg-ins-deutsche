// Tiny static file server for testing. Usage: node serve.js <dir> <port>
const http = require("http"), fs = require("fs"), path = require("path");
const [dir, port] = [process.argv[2], +process.argv[3] || 5173];
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".ogg": "audio/ogg", ".mp3": "audio/mpeg" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = path.join(dir, path.normalize(p).replace(/^([/\\])+/, ""));
  if (!f.startsWith(path.resolve(dir))) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => { if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(data); });
}).listen(port, "127.0.0.1", () => console.log("serving", dir, "on", port));
