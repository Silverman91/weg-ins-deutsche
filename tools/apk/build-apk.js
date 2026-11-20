#!/usr/bin/env node
// APK builder: turns a static web app (an offline PWA: index.html + JS + assets) into an installable Android APK.
// Works for any project: copy this folder (build-apk.js + template/) and give it an apk.json.
//
//   node build-apk.js setup [--tools D:\Android] [--accept-licenses]   one-time: portable JDK, Android SDK and Gradle
//   node build-apk.js build [path/to/apk.json]                          builds a signed APK (default: ./apk.json)
//
// The web files are bundled inside the APK and served from https://appassets.androidplatform.net/, so fetch(),
// localStorage, IndexedDB and audio all work offline. See README.md for the apk.json fields.
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const { spawnSync } = require("child_process");
const { Readable } = require("stream"), { pipeline } = require("stream/promises");

const WIN = process.platform === "win32", MAC = process.platform === "darwin";
const PREFS = path.join(os.homedir(), ".apk-builder.json");
// Known-good versions. Newer ones can be tried by editing these; the SDK packages are installed by `setup`.
const V = {
  jdk: 21, gradle: "8.11.1", agp: "8.7.3", sdk: 35, buildTools: "35.0.0",
  cmdline: `commandlinetools-${WIN ? "win" : MAC ? "mac" : "linux"}-13114758_latest.zip`,
};
const args = process.argv.slice(2), cmd = args[0];
const opt = name => { const i = args.indexOf("--" + name); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true); };
const prefs = () => { try { return JSON.parse(fs.readFileSync(PREFS, "utf8")); } catch (e) { return {}; } };
const toolsDir = () => path.resolve(opt("tools") || process.env.APK_TOOLS || prefs().tools || path.join(os.homedir(), "apk-builder-tools"));
const die = m => { console.error("\n" + m); process.exit(1); };

function paths(T) {
  const jdk = path.join(T, "jdk"), macHome = path.join(jdk, "Contents", "Home");
  return {
    T, jdk: fs.existsSync(macHome) ? macHome : jdk, sdk: path.join(T, "sdk"),
    gradle: path.join(T, `gradle-${V.gradle}`, "bin", "gradle" + (WIN ? ".bat" : "")),
    sdkmanager: path.join(T, "sdk", "cmdline-tools", "latest", "bin", "sdkmanager" + (WIN ? ".bat" : "")),
    keytool: path.join(fs.existsSync(macHome) ? macHome : jdk, "bin", "keytool" + (WIN ? ".exe" : "")),
    keys: path.join(T, "keys"), builds: path.join(T, "builds"), downloads: path.join(T, "downloads"),
  };
}
function env(P) {
  return { ...process.env, JAVA_HOME: P.jdk, ANDROID_HOME: P.sdk, ANDROID_SDK_ROOT: P.sdk,
    GRADLE_USER_HOME: path.join(P.T, "gradle-home"), PATH: path.join(P.jdk, "bin") + path.delimiter + process.env.PATH };
}
// .bat files need a shell on Windows; quote every argument so paths with spaces survive
function run(exe, argv, o = {}) {
  const q = s => (WIN ? `"${String(s).replace(/"/g, '""')}"` : s);
  const so = { stdio: o.input ? ["pipe", "inherit", "inherit"] : "inherit", ...o };
  const r = WIN ? spawnSync([exe, ...argv].map(q).join(" "), { ...so, shell: true }) : spawnSync(exe, argv, so);
  if (r.status !== 0) die(`Failed (exit ${r.status}): ${path.basename(exe)} ${argv.join(" ")}`);
  return r;
}

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1e6) return console.log("  already downloaded:", path.basename(dest));
  console.log("  downloading", url);
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "apk-builder" } });
  if (!r.ok) die(`Download failed (${r.status}): ${url}`);
  const total = +r.headers.get("content-length") || 0; let got = 0, shown = 0;
  const body = Readable.fromWeb(r.body);
  body.on("data", c => { got += c.length; const p = total ? Math.floor(got / total * 10) : 0; if (p > shown) { shown = p; process.stdout.write(`  ${p * 10}% `); } });
  await pipeline(body, fs.createWriteStream(dest + ".part"));
  fs.renameSync(dest + ".part", dest); console.log("\n  saved", path.basename(dest), Math.round(got / 1048576), "MB");
}
// extract an archive and move its single top folder to `to`
function extract(archive, to, inner) {
  if (fs.existsSync(to)) return;
  const tmp = to + ".tmp"; fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  run("tar", ["-xf", archive, "-C", tmp]);
  const top = inner ? path.join(tmp, inner) : path.join(tmp, fs.readdirSync(tmp)[0]);
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(top, to); fs.rmSync(tmp, { recursive: true, force: true });
}

async function setup() {
  const T = toolsDir(), P = paths(T);
  console.log("Build tools go to", T, "(change with --tools <folder>)");
  fs.mkdirSync(P.downloads, { recursive: true });
  const osName = WIN ? "windows" : MAC ? "mac" : "linux", arch = process.arch === "arm64" ? "aarch64" : "x64";
  const jdkZip = path.join(P.downloads, `jdk${V.jdk}.${WIN ? "zip" : "tar.gz"}`);
  console.log("1/4 Java (Eclipse Temurin JDK", V.jdk + ")");
  await download(`https://api.adoptium.net/v3/binary/latest/${V.jdk}/ga/${osName}/${arch}/jdk/hotspot/normal/eclipse`, jdkZip);
  extract(jdkZip, path.join(T, "jdk"));
  console.log("2/4 Gradle", V.gradle);
  const gz = path.join(P.downloads, `gradle-${V.gradle}-bin.zip`);
  await download(`https://services.gradle.org/distributions/gradle-${V.gradle}-bin.zip`, gz);
  extract(gz, path.join(T, `gradle-${V.gradle}`));
  console.log("3/4 Android SDK command-line tools");
  const cz = path.join(P.downloads, V.cmdline);
  await download(`https://dl.google.com/android/repository/${V.cmdline}`, cz);
  extract(cz, path.join(P.sdk, "cmdline-tools", "latest"), "cmdline-tools");
  if (!WIN) for (const f of [P.gradle, P.sdkmanager]) fs.chmodSync(f, 0o755);
  console.log("4/4 Android platform", V.sdk, "and build tools", V.buildTools);
  if (opt("accept-licenses")) {
    console.log("  accepting the Android SDK licences (--accept-licenses)");
    run(P.sdkmanager, ["--sdk_root=" + P.sdk, "--licenses"], { env: env(P), input: "y\n".repeat(30) });
  } else {
    console.log("  Google requires you to accept the Android SDK licences: read each one and type y.");
    run(P.sdkmanager, ["--sdk_root=" + P.sdk, "--licenses"], { env: env(P), stdio: "inherit" });
  }
  run(P.sdkmanager, ["--sdk_root=" + P.sdk, `platforms;android-${V.sdk}`, `build-tools;${V.buildTools}`], { env: env(P) });
  fs.writeFileSync(PREFS, JSON.stringify({ ...prefs(), tools: T }, null, 1));
  console.log(`\nSetup done. Tools: ${T} (remembered in ${PREFS}). The downloads folder can be deleted.`);
}

function copyDir(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name), dst = path.join(to, e.name);
    if (skip(src, e)) continue;
    if (e.isDirectory()) copyDir(src, dst, skip); else fs.copyFileSync(src, dst);
  }
}

function build() {
  const cfgPath = path.resolve(args[1] && !args[1].startsWith("--") ? args[1] : "apk.json");
  if (!fs.existsSync(cfgPath)) die(`No config at ${cfgPath}. See README.md for apk.json.`);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")), base = path.dirname(cfgPath);
  for (const k of ["name", "id"]) if (!cfg[k]) die(`apk.json needs "${k}".`);
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(cfg.id)) die(`"id" must look like com.example.myapp (lowercase, dots), got ${cfg.id}`);
  const P = paths(toolsDir());
  if (!fs.existsSync(P.gradle) || !fs.existsSync(path.join(P.sdk, "platforms", `android-${V.sdk}`))) die(`Build tools not found in ${P.T}. Run: node build-apk.js setup`);
  const web = path.resolve(base, cfg.web || "."), out = path.resolve(base, cfg.out || "dist");
  const start = cfg.start || "index.html", color = cfg.color || "#ffffff", bg = cfg.background || color;
  if (!fs.existsSync(path.join(web, start))) die(`Start page not found: ${path.join(web, start)}`);
  const version = String(cfg.version || "1.0");
  const code = Math.floor((Date.now() - Date.UTC(2024, 0, 1)) / 60000); // minutes since 2024: always increases
  const lum = h => { const n = parseInt(h.replace("#", "").slice(0, 6), 16); return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; };
  const vars = {
    ID: cfg.id, NAME: cfg.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"), VERSION: version, CODE: code,
    START: start, COLOR: color, BG: bg, LIGHT_BARS: lum(color) > 0.6, AGP: V.agp, SDK: V.sdk, BUILD_TOOLS: V.buildTools,
    ORIENTATION: cfg.orientation || "unspecified", DEBUG: !!cfg.debug, INTERNET: cfg.internet ? '<uses-permission android:name="android.permission.INTERNET"/>' : "",
  };
  const fill = s => s.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

  // 1. Android project from the template
  const dir = path.join(P.builds, cfg.id), main = path.join(dir, "app", "src", "main");
  console.log(`Building ${cfg.name} ${version} (${cfg.id}) in ${dir}`);
  fs.rmSync(main, { recursive: true, force: true });
  const tpl = path.join(__dirname, "template");
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(tpl, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) { walk(r); continue; }
      let dest = path.join(dir, r.replace(/\.tpl$/, ""));
      if (e.name.endsWith(".java")) dest = path.join(main, "java", ...cfg.id.split("."), e.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, fill(fs.readFileSync(path.join(tpl, r), "utf8")));
    }
  })("");
  // 2. web files -> assets/www
  const skipNames = new Set([".git", ".gitignore", ".github", "node_modules", ".DS_Store", "Thumbs.db", ...(cfg.exclude || [])]);
  const skipAbs = new Set([out, cfgPath].map(p => path.resolve(p)));
  let files = 0, bytes = 0;
  copyDir(web, path.join(main, "assets", "www"), (src, e) => {
    const rel = path.relative(web, src).split(path.sep).join("/");
    if (skipNames.has(e.name) || skipNames.has(rel) || skipAbs.has(src) || (WIN && e.name.toLowerCase() === "nul")) return true;
    if (e.isFile()) { files++; bytes += fs.statSync(src).size; }
    return false;
  });
  console.log(`  bundled ${files} web files (${Math.round(bytes / 1048576)} MB)`);
  // 3. icon
  const icon = path.resolve(web, cfg.icon || "icon-512.png");
  if (!fs.existsSync(icon) || !/\.png$/i.test(icon)) die(`"icon" must be a PNG (512x512 is best): ${icon}`);
  fs.mkdirSync(path.join(main, "res", "drawable-nodpi"), { recursive: true });
  fs.copyFileSync(icon, path.join(main, "res", "drawable-nodpi", "app_icon.png"));
  // 4. signing key: one per app id, kept with the tools (NOT in the project). Losing it means phones can't update the app.
  fs.mkdirSync(P.keys, { recursive: true });
  const ks = path.join(P.keys, cfg.id + ".jks"), ksInfo = path.join(P.keys, cfg.id + ".json");
  if (!fs.existsSync(ks)) {
    const pw = crypto.randomBytes(18).toString("base64url");
    run(P.keytool, ["-genkeypair", "-keystore", ks, "-storepass", pw, "-keypass", pw, "-alias", "app", "-keyalg", "RSA",
      "-keysize", "3072", "-validity", "18250", "-dname", `CN=${cfg.name.replace(/[,=+<>#;"\\]/g, " ")}`], { env: env(P), stdio: "ignore" });
    fs.writeFileSync(ksInfo, JSON.stringify({ password: pw, alias: "app", created: new Date().toISOString() }, null, 1));
    console.log(`\n  NEW signing key: ${ks}\n  Back up ${P.keys} somewhere safe. Updates must be signed with the same key,\n  or the phone refuses to install them over the old app (and its saved data).\n`);
  }
  const pw = JSON.parse(fs.readFileSync(ksInfo, "utf8")).password;
  fs.writeFileSync(path.join(dir, "signing.properties"), `file=${ks.split(path.sep).join("/")}\npassword=${pw}\n`);
  fs.writeFileSync(path.join(dir, "local.properties"), `sdk.dir=${P.sdk.split(path.sep).join("/")}\n`);
  // 5. gradle
  run(P.gradle, ["-p", dir, "assembleRelease", "--console=plain", "-q", "--warning-mode=none"], { env: env(P), cwd: dir });
  const apk = path.join(dir, "app", "build", "outputs", "apk", "release", "app-release.apk");
  if (!fs.existsSync(apk)) die("Gradle finished but no APK was produced.");
  fs.mkdirSync(out, { recursive: true });
  const slug = cfg.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const dest = path.join(out, `${slug}-${version}.apk`);
  fs.copyFileSync(apk, dest);
  console.log(`\nAPK ready: ${dest} (${Math.round(fs.statSync(dest).size / 1048576)} MB, version ${version}, code ${code})`);
}

(async () => {
  if (cmd === "setup") await setup();
  else if (cmd === "build") build();
  else console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 9).map(l => l.replace(/^\/\/ ?/, "")).join("\n"));
})().catch(e => die(e.stack || String(e)));
