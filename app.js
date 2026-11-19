/* Weg ins Deutsche — offline app. Needs course.js, lessons-*.js and content.js loaded first. */
(function () {
"use strict";
const LESSONS = window.LESSONS || {}, STORIES = window.STORIES || [], DRILLS = window.DRILLS || [];
const ALL = PHASES.flatMap(p => p.lessons.map((l, i) => ({ id: l[0], title: l[1], focus: l[2], lvl: p.lvl === "A0" ? "A1" : p.extra ? "A2" : p.lvl, phase: p.id, n: i + 1 })));
const BYID = Object.fromEntries(ALL.map(l => [l.id, l]));
const INT = [0, 1, 3, 7, 14, 30, 60, 120];

/* ---------------- storage ---------------- */
const K = "wid-";
function get(k, d) { try { const v = localStorage.getItem(K + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function put(k, v) { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch (e) {} }
let S = Object.assign({ done: {}, hours: 0, days: {}, scores: {} }, get("progress", {}));
let decks = get("decks", {});
let ui = Object.assign({ view: "today", lesson: null, story: null, drill: null, dir: "de", lvl: null }, get("ui", {}));
let ex = {}, review = null, storyState = get("storyState", {}), drill = null;
const saveS = () => put("progress", S), saveDecks = () => put("decks", decks), saveUI = () => put("ui", { view: ui.view, lesson: ui.lesson, story: ui.story, drill: ui.drill, dir: ui.dir, lvl: ui.lvl });
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------------- helpers ---------------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const fmt = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const today = () => fmt(new Date());
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return fmt(d); }
const norm = s => String(s || "").toLowerCase().replace(/ß/g, "ss").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[„“"'.,;:!?¿¡()–-]/g, " ").replace(/\s+/g, " ").trim();
function lev(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; }
function similarity(given, answers) { const g = norm(given); let best = 0; for (const a of answers) { const t = norm(a); if (!t) continue; const s = 1 - lev(g, t) / Math.max(g.length, t.length); if (s > best) best = s; } return best; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function level() { let l = "A0"; for (const p of PHASES) { if (p.extra) continue; const d = p.lessons.filter(x => S.done[x[0]]).length; if (d / p.lessons.length >= .8) l = p.lvl; else break; } return l; }
function workLevel() { const i = ["A0", "A1", "A2", "B1", "B2", "C1"].indexOf(level()); return ["A1", "A2", "B1", "B2", "C1"][Math.min(4, Math.max(0, i))]; }
const nextLesson = () => ALL.find(l => !S.done[l.id]);
const allCards = () => Object.entries(decks).flatMap(([id, d]) => (d.cards || []).map((c, i) => ({ deck: id, i, c })));
const dueCards = () => { const t = today(); return allCards().filter(x => (x.c.d || t) <= t); };
const todayLog = () => { const v = S.days[today()]; return v && typeof v === "object" ? v : {}; };
function logAct(k) { const v = Object.assign({}, todayLog()); v[k] = 1; S.days[today()] = v; const ks = Object.keys(S.days).sort(); while (ks.length > 400) delete S.days[ks.shift()]; saveS(); }
function streak() { let n = 0; const d = new Date(); if (!S.days[fmt(d)]) d.setDate(d.getDate() - 1); while (S.days[fmt(d)]) { n++; d.setDate(d.getDate() - 1); } return n; }
const lvlIdx = l => ["A1", "A2", "B1", "B2", "C1"].indexOf(l);

/* ---------------- speech (device voice, works offline) ---------------- */
const synth = window.speechSynthesis || null;
let deVoice = null, enVoice = null;
function pickVoice() { if (!synth) return; const vs = synth.getVoices();
  deVoice = vs.find(v => /^de(-|_)DE/i.test(v.lang) && v.localService) || vs.find(v => /^de/i.test(v.lang)) || null;
  enVoice = vs.find(v => /^en(-|_)(GB|US)/i.test(v.lang) && v.localService) || vs.find(v => /^en/i.test(v.lang)) || null; }
if (synth) { pickVoice(); synth.onvoiceschanged = () => { pickVoice(); if (ui.view === "progress") render(); }; }
/* ---------------- recorded clips: natural voices generated on a PC and shipped in audio/ ---------------- */
// A clip's file name is a hash of language, speaker and exact text, so the app and the generator agree.
const clipHash = (lang, alt, text) => { let h = 2166136261; for (const ch of `${lang}|${alt ? 1 : 0}|${text}`) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, "0"); };
let CLIPS = null, AUDINFO = null;
fetch("audio/index.json").then(r => (r.ok ? r.json() : null)).then(d => { if (d && d.clips) { CLIPS = new Set(d.clips); AUDINFO = d; render(); } }).catch(() => {});
const clipUrl = (lang, alt, text) => { if (!CLIPS) return null; const h = clipHash(lang, alt, String(text)); return CLIPS.has(h) ? "audio/c/" + h + ".ogg" : null; };
const audioEl = new Audio(); audioEl.preload = "auto"; try { audioEl.preservesPitch = true; } catch (e) {}
const audioRate = () => (ui.rate || 0.9) / 0.9;
let seqGen = 0;
function playUrls(urls) {
  const g = ++seqGen; if (synth) synth.cancel(); let i = 0;
  const next = () => { if (g !== seqGen || i >= urls.length) return; audioEl.src = urls[i++]; audioEl.playbackRate = audioRate();
    audioEl.onended = () => setTimeout(next, 600); audioEl.onerror = () => setTimeout(next, 100); audioEl.play().catch(() => {}); };
  next();
}
// lines: German strings, or {text, alt} for the second dialogue speaker
function speak(lines, rate) {
  if (P.on) playerPause();
  const arr = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).map(x => (typeof x === "string" ? { text: x, alt: false } : x));
  const urls = arr.map(x => clipUrl("de", x.alt, x.text));
  if (urls.length && urls.every(Boolean)) return playUrls(urls);
  if (!synth) return; seqGen++; audioEl.pause(); synth.cancel();
  arr.forEach(x => { const u = new SpeechSynthesisUtterance(String(x.text)); u.lang = "de-DE"; if (deVoice) u.voice = deVoice; u.rate = rate || ui.rate || 0.9; synth.speak(u); });
}
const stopSpeak = () => { if (P.on) return; seqGen++; audioEl.pause(); if (synth) synth.cancel(); };
const canSpeak = () => !!synth || !!CLIPS;

/* ---------------- lesson narration: podcast / car mode ---------------- */
const DE_W = new Set("ich du er sie es wir ihr der die das den dem des ein eine einen einem einer eines ist bin bist sind und oder aber nicht kein keine keinen mit von zu zum zur im ins auf für wer wo wie wann warum woher wohin ja nein bitte danke hallo gut sehr auch noch schon heute morgen hier habe hab hast hat haben mein meine dein deine sein ihr kann kannst muss möchte gern gerne deutsch mich dich sich uns euch mir dir wird wurde würde wäre hätte dort jetzt immer man doch mal halt sagt bei nach aus seit".split(" "));
const EN_W = new Set("the a is are were you your what which how why when where does do did means mean write say says of to with this that it it's i'm don't not her his him and or for from on at be by as if then than they them their he she we us our my me can will would should could translate sentence word words answer question correct like english german same both only very more most other people thing time day way good bad after before first last yes into about one two three use used usually lower upper case verb verbs noun nouns subject object past present future tense plural singular masculine feminine neuter nominative accusative dative genitive position end always never react ask back reply late politely voice messages vowels consonants irony understatement wordplay sarcasm markers greeting openings requests closing spoken written north contractions everyday slang questions polite casual formal location movement purpose regular irregular participle clause prefix stem ending endings change changes only everything else".split(" "));
// Pieces of a "German" line that are really English (table labels, quiz options, notes in brackets) go to the
// English voice. Words that exist in both languages never count as English on their own.
const EN_X = new Set([...EN_W, ..."hello hi bye example second song lyrics nonsense cheers hurry sausage surprised let's go eat who who'd thought obviously ironic oh great love best wishes idea maybe right now ticket bavaria northern germany switzerland agree disagree weigh up conclude give opinion regret request thanks sign-off sign off introduce yourself offer help encouraging come surprise shared knowledge resignation reassurance actually changing topic female male doctor wants looking forward article resigned person nom acc dat gen active modal passive adj version replace sounds style nominal verbal they're you're that's couldn't have no had must may might shall want need know think get make take see look find tell ask work feel try leave call keep let begin show hear play run move live believe bring happen lose pay meet learn understand watch follow stop speak read allow add spend grow open walk win offer remember like would sounds nothing something literally superlative comparative phrase official masc fem neut austria haha".split(" ")]);
const EN_AMBIG = new Set("in an so was die man will war bin hat also a i am um her bad position hi oh person version modal nominal verbal ticket".split(" "));
function splitDe(text) {
  // isEn: could be English (incl. words both languages share); strong: only English
  const strong = w => !EN_AMBIG.has(w) && EN_X.has(w), isEn = w => EN_AMBIG.has(w) || strong(w);
  const out = [], push = (lang, t) => { if (!/[A-Za-zÄÖÜäöüß0-9]/.test(t)) { if (out.length) out[out.length - 1].text += t; return; }
    const l = out[out.length - 1]; if (l && l.lang === lang) l.text += t; else out.push({ lang, text: t }); };
  const pieces = String(text).replace(/\s+(means…|means\.\.\.|in (?:nominal|verbal) style)/g, " ⟂$1").split(/(?<=[,;])\s+|\s+(?=\()|(?<=\))\s*|\s⟂/);
  pieces.forEach((pc, i) => {
    const sep = i < pieces.length - 1 ? " " : "";
    const words = [...pc.matchAll(/[A-Za-zÄÖÜäöüß]+(?:'[A-Za-z]+)?/g)];
    const lw = words.map(m => m[0].toLowerCase());
    if (!lw.length) return push(out.length ? out[out.length - 1].lang : "de", pc + sep);
    const nS = lw.filter(strong).length, nDe = lw.filter(w => !isEn(w)).length;
    if (!/[äöüßÄÖÜ]/.test(pc) && nS && nS >= nDe && (strong(lw[0]) || strong(lw[lw.length - 1]))) return push("en", pc + sep);
    // a leading or trailing run of English words: "After der, die, das", "… in nominal style:"
    let a = 0; while (a < lw.length && isEn(lw[a])) a++;
    while (a > 0 && EN_AMBIG.has(lw[a - 1])) a--;
    let b = lw.length; while (b > a && isEn(lw[b - 1])) b--;
    while (b < lw.length && EN_AMBIG.has(lw[b])) b++;
    const lead = a > 0 && lw.slice(0, a).some(strong) && a < lw.length, trail = b < lw.length && lw.slice(b).some(strong) && b > 0;
    const cut1 = lead ? words[a].index : 0, cut2 = trail ? words[b].index : pc.length;
    if (lead) push("en", pc.slice(0, cut1));
    push("de", pc.slice(cut1, cut2) + (trail ? " " : sep));
    if (trail) push("en", pc.slice(cut2) + sep);
  });
  return out.map(p => ({ lang: p.lang, text: p.lang === "en" ? p.text.replace(/[()]/g, "").replace(/^[,;\s]+|[,;\s]+$/g, "").trim() : p.text.replace(/[,;\s]+$/, "").trim() })).filter(p => p.text);
}
function detect(t, fb) {
  const s = String(t); let de = /[äöüßÄÖÜ]/.test(s) ? 2 : 0, en = 0;
  for (const w of s.toLowerCase().match(/[a-zäöüß']+/g) || []) { if (DE_W.has(w)) de++; if (EN_W.has(w)) en++; }
  return de > en ? "de" : en > de ? "en" : fb;
}
// English words the course itself uses (all translations and glosses): such a word is never treated as German.
let ENGV = null;
function engVocab() {
  if (ENGV) return ENGV;
  ENGV = new Set(EN_X); const add = t => (String(t || "").toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []).forEach(w => ENGV.add(w));
  for (const L of Object.values(LESSONS)) { L.x.forEach(x => add(x[1])); L.d.forEach(d => add(d[2])); L.v.forEach(v => add(v[1])); }
  (window.STORIES || []).forEach(st => { st.p.forEach(p => add(p[1])); st.g.forEach(g => add(g[1])); });
  (window.DRILLS || []).forEach(d => d.turns.forEach(t => { add(t[1]); add(t[2]); }));
  for (const w of DE_W) if (!EN_X.has(w)) ENGV.delete(w); // ich, das, mit, und… quoted in translations are still German
  return ENGV;
}
// Unmarked German inside English text ("Guten Morgen is used in the morning", "Learn eins, zwei, drei"): runs of German
// words, joined only by spaces, commas or dashes, go to the German voice. Endings (-zehn) and single letters stay English.
function deRuns(text) {
  const t = String(text), toks = [...t.matchAll(/[A-Za-zÄÖÜäöüß]+(?:'[A-Za-z]+)?|\d+/g)], lex = germanLexicon(), eng = engVocab();
  const kind = m => { const w = m[0], l = w.toLowerCase(), i = m.index;
    if (t[i - 1] === "-" || t[i + w.length] === "-" || /^\d+$/.test(w) || w.length === 1) return "A";
    if (EN_AMBIG.has(l) || eng.has(l)) return eng.has(l) && !EN_AMBIG.has(l) ? "E" : "A";
    return /[äöüß]/.test(l) || lex.has(l) || DE_W.has(l) ? "G" : "E"; };
  const k = toks.map(kind), out = [], push = (lang, s) => { if (s) out.push({ lang, s }); };
  let pos = 0, i = 0;
  while (i < toks.length) {
    if (k[i] === "E") { i++; continue; }
    let j = i; while (j + 1 < toks.length && k[j + 1] !== "E" && /^[\s,–-]*$/.test(t.slice(toks[j].index + toks[j][0].length, toks[j + 1].index))) j++;
    let a = i, b = j; while (a <= b && k[a] === "A") a++; while (b >= a && k[b] === "A") b--;
    if (a <= b) { const st = toks[a].index; let en = toks[b].index + toks[b][0].length; const pm = /^[.!?]/.exec(t.slice(en)); if (pm && b === j) en += 1;
      push("en", t.slice(pos, st)); push("de", t.slice(st, en)); pos = en; }
    i = j + 1;
  }
  push("en", t.slice(pos));
  return out;
}
function mixed(text, base) {
  // bold inside a word (du f**ä**hrst) marks the whole word
  text = String(text).replace(/([A-Za-zÄÖÜäöüß]*)\*\*([^*\n]+?)\*\*([A-Za-zÄÖÜäöüß]*)/g, (m, a, b, c) => (a || c) ? "**" + a + b + c + "**" : m);
  const out = [], push0 = (s, lang) => { s = String(s).replace(/_{2,}/g, "…").replace(/[*]/g, "").trim();
    if (!/[A-Za-zÄÖÜäöüß0-9]/.test(s)) { const l = out[out.length - 1]; if (l && /^[,;.!?…]+$/.test(s) && !/[,;.!?…]$/.test(l.text)) l.text += s; return; } // keep list commas
    const last = out[out.length - 1]; if (last && last.lang === lang && !(lang === "de" && /[.!?]$/.test(last.text))) last.text += " " + s; else out.push({ lang, text: s }); };
  const push = (s, lang) => { if (lang !== "en") return push0(s, lang); deRuns(s).forEach(p => push0(p.s, p.lang)); };
  const re = /\*\*(.+?)\*\*|(^|[\s(„“])'([^'\n]{1,60})'(?=[\s.,;:!?)]|$)/g; let last = 0, m;
  while ((m = re.exec(String(text)))) { const start = m.index + (m[1] ? 0 : (m[2] || "").length); push(text.slice(last, start), base);
    const c = m[1] || m[3];
    // **bold** is usually German; a 'quoted' word in English text stays English unless it's German vocabulary
    let lang = m[1] ? detect(c, "de") : (quotedIsGerman(c) ? "de" : detect(c, "en"));
    const cw = c.toLowerCase().match(/[a-zäöüß]+(?:'[a-z]+)?/g) || [];
    if (m[1] && cw.length && cw.every(w => EN_X.has(w) && !EN_AMBIG.has(w))) lang = "en"; // **must**, **can**: bold English
    if (lang === "de" && /^[a-z]{5,}$/i.test(c.trim()) && !germanLexicon().has(c.trim().toLowerCase())) lang = "en"; // e.g. **silent**
    push(c, lang);
    last = re.lastIndex; }
  push(String(text).slice(last), base);
  return out;
}
const cleanWord = w => String(w).replace(/,\s*-.*$/, "").replace(/\s*\((pl\.|m\/f|f|m)\)/g, "").replace(/ \/ /g, ", ");
function quotedIsGerman(c) {
  const ws = String(c).toLowerCase().match(/[a-zäöüß]+/g) || [];
  return /[äöüß]/i.test(c) || (ws.length > 0 && ws.every(w => germanLexicon().has(w)));
}
// Make a segment something a voice can actually say well:
//  - word endings and bare letters ("-st", "ie", "ts") are spelled out by the English narrator
//  - clock times ("3:30") are read by the English narrator
//  - "er/sie/es" becomes "er, sie, es"
function speakable(lang, text) {
  let t = String(text).trim();
  if (lang !== "de") return [lang, t];
  if (/^\d{1,2}:\d{2}$/.test(t)) return ["en", t];
  t = t.replace(/\s*\/\s*/g, ", ");
  const bare = t.replace(/[.,:;!?]+$/, "");
  if (/^-[a-zäöüß]+-?$/i.test(bare)) return ["en", "the ending " + bare.replace(/-/g, "").toUpperCase().split("").join(" ")];
  if (/^[a-zäöüß]+-$/.test(bare)) return ["de", bare.slice(0, -1)];                       // a stem like "lern-"
  if (/^[a-zäöüß]{1,4}$/.test(bare) && !germanLexicon().has(bare)) return ["en", bare.toUpperCase().split("").join(" ")];
  // an English word, e.g. quiz option "silent" (German spellings like sch/ei/ie/z/tz/pf keep it German: "siebzig")
  if (/^[a-z]{5,}$/.test(bare) && !germanLexicon().has(bare) && !/(sch|ei|ie|eu|z|pf)/.test(bare)) return ["en", t];
  return ["de", t];
}
function buildLesson(id) {
  const M = BYID[id], L = LESSONS[id], q = [];
  const say = (lang0, text0, pause, alt) => {
    if (lang0 === "de" && !alt) { const parts = splitDe(text0);
      if (parts.length > 1) return parts.forEach((p, i) => say(p.lang, p.text, i === parts.length - 1 ? pause : 250));
      if (parts.length === 1) { lang0 = parts[0].lang; text0 = parts[0].text; } }
    const [lang, t] = speakable(lang0, text0);
    // German word lists ("Name. Vater.") become separate words with a pause each: TTS mangles dotted lists,
    // and single words can use real human recordings.
    if (lang === "de" && /^(?:[A-Za-zÄÖÜäöüß-]+\.\s*){2,}$/.test(t.trim())) {
      const ws = t.trim().split(/\.\s*/).filter(Boolean);
      ws.forEach((w, k) => q.push({ lang, text: w, pause: k === ws.length - 1 ? (pause || 350) : 900, alt }));
      return;
    }
    for (const part of (t.length < 160 ? [t] : t.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„"'])/))) if (part.trim()) q.push({ lang, text: part.trim(), pause: 250, alt }); if (q.length) q[q.length - 1].pause = pause || 350; };
  const sayMixed = (text, base, pause) => { const segs = mixed(text, base); segs.forEach((s, i) => say(s.lang, s.text, i === segs.length - 1 ? pause : 200)); };
  say("en", "Lesson " + numWord(M.n) + ".", 200); sayTitle(M.title, say);
  if (L.ai) L.ai.forEach(([lang, text, p]) => say(lang, text, p));
  else {
    L.i.split(/\n\n+/).forEach(p => sayMixed(p, "en", 600));
    if (L.t) { sayMixed("Here's a summary: " + L.t.c + ".", "en", 400);
      L.t.r.forEach(r => { const segs = []; r.forEach(c => { const lang = detect(c, "de"), l = segs[segs.length - 1]; if (l && l.lang === lang) l.text += ", " + c; else segs.push({ lang, text: c }); });
        segs.forEach((s, i) => say(s.lang, s.text.replace(/ \/ /g, ", "), i === segs.length - 1 ? 700 : 250)); }); }
  }
  say("en", "Now some examples. Listen, then repeat.", 500);
  L.x.forEach(x => { say("de", x[0], 1800); say("en", x[1], 400); say("de", x[0], 2200); });
  say("en", "Now a short dialogue.", 500);
  const who = [...new Set(L.d.map(d => d[0]))];
  L.d.forEach(d => say("de", d[1], 500, who.indexOf(d[0]) % 2 === 1));
  say("en", "Once more, with the English.", 500);
  L.d.forEach(d => { say("de", d[1], 300, who.indexOf(d[0]) % 2 === 1); say("en", d[2], 600); });
  say("en", "New words. Repeat each one.", 500);
  L.v.forEach(v => { say("de", cleanWord(v[0]), 1400); say("en", v[1], 300); say("de", v[2], 1200); });
  if (L.tip) { say("en", "A tip.", 200); sayMixed(L.tip, "en", 800); }
  say("en", "Quick quiz. Answer out loud before you hear the answer.", 600);
  L.e.forEach((e, i) => {
    say("en", "Question " + numWord(i + 1) + ".", 200);
    if (e[0] === "c") { sayMixed(e[1], detect(e[1], "en"), 400); say("en", "Is it", 150);
      e[2].forEach((o, j) => { if (j === e[2].length - 1 && j) say("en", "or", 150); say(detect(o, "de"), o, 350); });
      q[q.length - 1].pause = 3500; say("en", "The answer is", 150); say(detect(e[2][e[3]], "de"), e[2][e[3]], 400); sayMixed(e[4], "en", 900); }
    else { sayMixed(e[1], "en", 4500); say("en", "Answer:", 150); say("de", e[2], 1500); }
  });
  say("en", "That's the end of lesson " + numWord(M.n) + ".", 300); say("de", "Gut gemacht!", 800);
  // Extra-long pauses where the voice switches between English (Emily) and German (Greta)
  for (let i = 0; i < q.length - 1; i++) if (q[i].lang !== q[i + 1].lang) {
    const toSentence = q[i + 1].lang === "de" && /\s/.test(q[i + 1].text.trim());
    q[i].pause = Math.max(q[i].pause, toSentence ? 900 : 600);
  }
  return q;
}
// English meaning of a German line, for car mode and the lines list: from vocab, examples, dialogues, story
// glossaries and chat drills, plus lesson glosses (L.gl) for words that only appear in narration.
let GLOSS = null;
const glossKey = t => String(t).trim().replace(/[.!?,:;…]+$/, "").toLowerCase();
function gloss(text) {
  if (!GLOSS) {
    GLOSS = new Map(); const add = (de, en) => { const k = glossKey(de); if (k && en && !GLOSS.has(k)) GLOSS.set(k, en); };
    Object.entries(window.GLOSS_EXTRA || {}).forEach(([de, en]) => add(de, en));
    for (const L of Object.values(LESSONS)) {
      Object.entries(L.gl || {}).forEach(([de, en]) => add(de, en));
      L.v.forEach(v => { add(cleanWord(v[0]), v[1]); add(v[0], v[1]); });
      L.x.forEach(x => add(x[0], x[1])); L.d.forEach(d => add(d[1], d[2]));
      L.e.forEach(e => { if (e[0] === "w") add(e[2], e[1].replace(/^(Translate|Say|Write)[^:]*:\s*/i, "")); });
    }
    (window.STORIES || []).forEach(st => { st.g.forEach(g => add(g[0], g[1])); st.p.forEach(p => add(p[0], p[1])); });
    (window.DRILLS || []).forEach(d => d.turns.forEach(t => add(t[0], t[1])));
    for (const [k, en] of [...GLOSS]) { const bare = k.replace(/^(der|die|das) /, ""); if (bare !== k && !GLOSS.has(bare)) GLOSS.set(bare, en); }
  }
  return GLOSS.get(glossKey(text)) || "";
}
window.WID_gloss = gloss;
const NUMS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen".split(" ");
const numWord = n => NUMS[n] || String(n);
let LEX = null;
function germanLexicon() {
  if (LEX) return LEX;
  LEX = new Set(DE_W);
  const add = s => (String(s).toLowerCase().match(/[a-zäöüß]+/g) || []).forEach(w => LEX.add(w));
  const noEnglish = s => !(String(s).toLowerCase().match(/[a-z']+/g) || []).some(w => EN_W.has(w));
  for (const L of Object.values(LESSONS)) {
    L.x.forEach(x => add(x[0])); L.d.forEach(d => add(d[1])); L.v.forEach(v => { add(cleanWord(v[0])); add(v[2]); });
    if (L.t && L !== LESSONS["a0-1"]) L.t.r.forEach(r => r.slice(1).forEach(c => { if (noEnglish(c) && !/\(/.test(c)) add(c); })); // table cells, not row labels
    if (L.t && L !== LESSONS["a0-1"]) L.t.h.slice(1).forEach(c => { if (noEnglish(c) && !/\(/.test(c)) add(c); });
    L.e.forEach(e => { if (e[0] === "w") { add(e[2]); (e[3] || []).forEach(add); }
      else if (/___/.test(e[1]) && noEnglish(e[1])) { add(e[1]); e[2].forEach(add); } });              // answers, gap options
  }
  (window.STORIES || []).forEach(s => { s.p.forEach(p => add(p[0])); s.g.forEach(g => add(g[0])); });
  (window.DRILLS || []).forEach(d => d.turns.forEach(t => { add(t[0]); add(t[3]); (t[4] || []).forEach(add); }));
  for (const w of EN_W) LEX.delete(w);
  ["in", "an", "so", "was", "will", "also", "war", "bin", "man", "die", "hat", "art", "rate", "gift", "kind", "ge", "en", "et", "st"].forEach(w => LEX.delete(w));
  return LEX;
}
window.WID_lexicon = () => germanLexicon(); // used by the audio export to check language decisions
// Titles mix languages ("Haben and the accusative"): give each run of German words to the German voice.
function sayTitle(title, say) {
  const lex = germanLexicon(), runs = [], AMBIG = new Set(["die", "war", "an", "in", "so", "was", "café"]);
  const toks = String(title).split(/\s+/), key = t => t.toLowerCase().replace(/[^a-zäöüßé]/g, "");
  const firm = toks.map(t => { const w = key(t); return AMBIG.has(w) ? null : (w && (lex.has(w) || /[äöüß]/.test(w)) ? "de" : "en"); });
  toks.forEach((tok, i) => {
    // an ambiguous word (die, war, an…) takes the language of its nearest clear neighbour
    let lang = firm[i];
    for (let d = 1; !lang && d < toks.length; d++) lang = firm[i - d] || firm[i + d];
    lang = lang || "en";
    const last = runs[runs.length - 1];
    if (last && last.lang === lang) last.text += " " + tok; else runs.push({ lang, text: tok });
  });
  runs.forEach((r, i) => say(r.lang, r.text, i === runs.length - 1 ? 700 : 200));
}
window.WID_splitDe = splitDe; window.WID_buildLesson = buildLesson; // used to check narration scripts
const P = { q: [], i: 0, on: false, gen: 0, id: null, auto: false, car: false, lock: null, t: null };
async function wake() { try { if ("wakeLock" in navigator && !P.lock) { P.lock = await navigator.wakeLock.request("screen"); P.lock.addEventListener("release", () => { P.lock = null; }); } } catch (e) {} }
function unwake() { if (P.lock) P.lock.release().catch(() => {}); P.lock = null; }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && P.on) wake(); });
function playerLoad(id, autostart) { P.q = buildLesson(id); P.i = 0; P.id = id; if (autostart) playerPlay(); else renderPlayer(); }
function playerPlay() { if (!P.id || (!synth && !CLIPS)) return; P.on = true; wake(); playerStep(); }
function playerPause() { P.on = false; P.gen++; clearTimeout(P.t); audioEl.pause(); if (synth) synth.cancel(); unwake(); renderPlayer(); }
function playerStep() {
  const g = ++P.gen; clearTimeout(P.t); seqGen++;
  if (synth && (synth.speaking || synth.pending)) synth.cancel();
  if (P.i >= P.q.length) return playerDone();
  const s = P.q[P.i], url = clipUrl(s.lang, s.alt, s.text);
  const twice = P.rep && s.lang === "de" && s.text.trim().split(/\s+/).length <= 3; let said = 0;
  const again = (fn) => { said++; if (!twice || said > 1) return false; P.t = setTimeout(() => { if (g === P.gen && P.on) fn(); }, 1600 / (url ? audioRate() : 1)); return true; };
  const after = () => { if (g !== P.gen || !P.on) return; P.t = setTimeout(() => { if (g !== P.gen || !P.on) return; P.i++; playerStep(); }, (s.pause || 350) / (url ? audioRate() : 1)); };
  renderPlayer();
  if (url) { // natural recorded voice
    audioEl.src = url; audioEl.playbackRate = audioRate(); audioEl.onerror = after;
    const playIt = () => audioEl.play().catch(after);
    audioEl.onended = () => { if (!again(() => { audioEl.currentTime = 0; playIt(); })) after(); };
    playIt(); return;
  }
  if (!synth) return after(); // no clip and no phone voice: skip this line
  const u = new SpeechSynthesisUtterance(s.text);
  u.lang = s.lang === "de" ? "de-DE" : "en-GB"; const v = s.lang === "de" ? deVoice : enVoice; if (v) u.voice = v;
  u.rate = (ui.rate || 0.9) * (s.lang === "de" ? 0.95 : 1.05); if (s.alt) u.pitch = 1.25;
  u.onerror = after; u.onend = () => { if (!again(() => synth.speak(u))) after(); };
  synth.speak(u);
}
if ("mediaSession" in navigator) { // headphone / car / lock-screen buttons
  const ms = navigator.mediaSession;
  try { ms.setActionHandler("play", () => playerPlay()); ms.setActionHandler("pause", () => playerPause());
    ms.setActionHandler("nexttrack", () => playerJump(1)); ms.setActionHandler("previoustrack", () => playerJump(-1)); } catch (e) {}
}
function playerDone() {
  logAct("a");
  const idx = ALL.findIndex(l => l.id === P.id), nxt = ALL[idx + 1];
  if (P.auto && nxt) { P.q = [{ lang: "en", text: "Next up:", pause: 300 }].concat(buildLesson(nxt.id)); P.i = 0; P.id = nxt.id; return playerStep(); }
  P.on = false; unwake(); P.i = P.q.length - 1; renderPlayer();
}
function playerJump(d) { P.i = Math.max(0, Math.min(P.q.length - 1, P.i + d)); if (P.on) playerStep(); else renderPlayer(); }
function playerClose() { playerPause(); P.id = null; P.car = false; P.list = false; renderPlayer(); }
function renderPlayer() {
  const bar = $("player"), car = $("car"); if (!bar) return;
  document.body.classList.toggle("has-player", !!P.id);
  if (!P.id) { bar.hidden = true; car.hidden = true; return; }
  const M = BYID[P.id], s = P.q[P.i] || { lang: "en", text: "" }, pct = Math.round(100 * P.i / Math.max(1, P.q.length - 1));
  if ("mediaSession" in navigator && window.MediaMetadata) {
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: `Lesson ${M.n}: ${M.title}`, artist: "Weg ins Deutsche", artwork: [{ src: "icon-512.png", sizes: "512x512", type: "image/png" }] });
      navigator.mediaSession.playbackState = P.on ? "playing" : "paused"; } catch (e) {}
  }
  const ctrls = `<button class="pbtn" data-p="back" aria-label="Back">⏮</button><button class="pbtn main" data-p="toggle" aria-label="${P.on ? "Pause" : "Play"}">${P.on ? "⏸" : "▶"}</button><button class="pbtn" data-p="fwd" aria-label="Forward">⏭</button>`;
  if (P.list) { bar.hidden = true; car.hidden = false; return renderPlayerList(); }
  car.dataset.list = "";
  bar.hidden = P.car; car.hidden = !P.car;
  bar.innerHTML = `<div class="wrap pwrap"><div class="pinfo"><b>🎧 Lesson ${M.n}: ${esc(M.title)}</b><span><i class="lang">${s.lang.toUpperCase()}</i> ${esc(s.text)}</span><div class="pbar"><i style="width:${pct}%"></i></div></div>
    <div class="pctrl">${ctrls}<button class="pbtn" data-p="list" aria-label="All lines">☰</button><button class="pbtn" data-p="car" aria-label="Car mode">🚗</button><button class="pbtn" data-p="close" aria-label="Close">✕</button></div></div>`;
  car.innerHTML = `<div class="carin"><div class="eyebrow">Lesson ${M.n} · ${pct}%</div><h2>${esc(M.title)}</h2>
    <div class="cartext"><p><i class="lang">${s.lang.toUpperCase()}</i> ${esc(s.text)}</p>${s.lang === "de" && gloss(s.text) ? `<p class="gloss">${esc(gloss(s.text))}</p>` : ""}</div>
    <div class="carctrl">${ctrls}</div>
    <button class="btn" data-p="list">☰ All lines: jump to any part</button>
    ${repBtn()}
    <label class="note carauto"><input type="checkbox" id="pAuto" ${P.auto ? "checked" : ""}> Keep going to the next lesson</label>
    <button class="btn" data-p="exitcar">Exit car mode</button></div>`;
}
// Every line of the lesson in one scrollable list: tap one to play from there.
const repBtn = () => `<button class="btn ${P.rep ? "primary" : ""}" data-p="rep" aria-pressed="${!!P.rep}">🔁 Say German words twice: ${P.rep ? "on" : "off"}</button>`;
function renderPlayerList() {
  const car = $("car"), M = BYID[P.id];
  if (car.dataset.list !== P.id + "|" + P.q.length) {
    car.dataset.list = P.id + "|" + P.q.length;
    car.innerHTML = `<div class="plist"><div class="plhead"><b>Lesson ${M.n}: ${esc(M.title)}</b><button class="btn small" data-p="closelist">Done</button></div>
      <ol class="pllines">${P.q.map((s, i) => `<li data-p="goto" data-i="${i}" class="${s.lang}"><i class="lang">${s.lang.toUpperCase()}</i> ${esc(s.text)}${s.lang === "de" && gloss(s.text) ? `<span class="gloss">${esc(gloss(s.text))}</span>` : ""}</li>`).join("")}</ol>
      <div class="plrep"></div><div class="carctrl plctrl"></div></div>`;
  }
  car.querySelector(".plrep").innerHTML = repBtn();
  car.querySelector(".plctrl").innerHTML = `<button class="pbtn" data-p="back" aria-label="Back">⏮</button><button class="pbtn main" data-p="toggle" aria-label="${P.on ? "Pause" : "Play"}">${P.on ? "⏸" : "▶"}</button><button class="pbtn" data-p="fwd" aria-label="Forward">⏭</button>`;
  const old = car.querySelector("li.cur"), cur = car.querySelector(`li[data-i="${P.i}"]`);
  if (old !== cur) { if (old) old.classList.remove("cur"); if (cur) { cur.classList.add("cur"); if (!P.listTouched) cur.scrollIntoView({ block: "center" }); } }
}
function playerClick(e) {
  const b = e.target.closest("[data-p]"); if (!b) return; const a = b.dataset.p;
  if (a === "toggle") P.on ? playerPause() : playerPlay();
  else if (a === "back") playerJump(-1);
  else if (a === "fwd") playerJump(1);
  else if (a === "car") { P.car = true; renderPlayer(); }
  else if (a === "exitcar") { P.car = false; renderPlayer(); }
  else if (a === "rep") { P.rep = !P.rep; put("rep", P.rep); renderPlayer(); }
  else if (a === "list") { P.list = true; P.listTouched = false; renderPlayer(); }
  else if (a === "closelist") { P.list = false; renderPlayer(); }
  else if (a === "goto") { P.i = +b.dataset.i; P.listTouched = false; P.on ? playerStep() : playerPlay(); }
  else if (a === "close") playerClose();
}

/* ---------------- views ---------------- */
const NAV = [["today", "Today", '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'],
 ["lessons", "Lessons", '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/>'],
 ["cards", "Cards", '<rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>'],
 ["speak", "Speak", '<path d="M4 5h16v11H9l-5 4z"/>'],
 ["read", "Read", '<path d="M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2zM22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z"/>'],
 ["games", "Play", '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><rect x="2" y="6" width="20" height="12" rx="4"/>'],
 ["progress", "Progress", '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>']];
const listenBtn = (attr, label) => canSpeak() ? `<button class="btn small" ${attr}>▶ ${label || "Listen"}</button>` : "";

function header() {
  const d = ALL.filter(l => S.done[l.id]).length;
  $("overallBar").style.width = (100 * d / ALL.length) + "%";
  $("overallPct").textContent = d + "/" + ALL.length;
  $("curLevel").textContent = level();
  const due = dueCards().length;
  $("nav").innerHTML = NAV.map(([k, l, p]) => `<button data-nav="${k}" ${ui.view === k ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24">${p}</svg>${l}${k === "cards" && due ? `<span class="dot">${due > 99 ? "99+" : due}</span>` : ""}</button>`).join("");
}

function vToday() {
  const nl = nextLesson(), due = dueCards().length, log = todayLog(), lv = workLevel();
  const dr = DRILLS.filter(x => lvlIdx(x.lvl) <= lvlIdx(lv)).find(x => !S.done[x.id]) || DRILLS.filter(x => x.lvl === lv)[0] || DRILLS[0];
  const st = STORIES.filter(x => lvlIdx(x.lvl) <= lvlIdx(lv)).find(x => !S.done[x.id]) || STORIES.filter(x => x.lvl === lv)[0] || STORIES[0];
  const tier = SERIES[Math.min(4, Math.max(0, lvlIdx(lv)))];
  const total = allCards().length, known = allCards().filter(x => (x.c.b || 0) >= 3).length;
  const step = (on, t, sub, btn) => `<div class="step"><span class="tick ${on ? "on" : ""}">${on ? "✓" : ""}</span><div><b>${t}</b><small>${sub}</small></div>${btn}</div>`;
  return `<div class="hello"><div><div class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div><h2>Hallo! Wie geht's?</h2></div>
    <div class="streak"><b>${streak()}</b>day streak</div></div>
  <section class="card"><h2>Today's hour</h2>
   ${step(log.c || (!due && total), "Review cards · 15 min", due ? `${due} card${due > 1 ? "s" : ""} due` : (total ? "All caught up" : "Cards appear after your first lesson"), due ? `<button class="btn small primary" data-start-review>Review</button>` : "")}
   ${step(log.l, "Lesson · 20 min", nl ? esc(nl.title) + " · " + nl.lvl : "Course complete", nl ? `<button class="btn small primary" data-open-lesson="${nl.id}">Start</button>` : "")}
   ${step(log.t, "Speak · 10 min", esc(dr.title) + " · " + dr.lvl, `<button class="btn small" data-open-drill="${dr.id}">Speak</button>`)}
   ${step(log.r, "Read & listen · 10 min", esc(st.title) + " · " + st.lvl, `<button class="btn small" data-open-story="${st.id}">Read</button>`)}
   ${step(log.w, "Watch German · any time", esc(tier.shows[0][0]) + " · " + tier.subs, `<button class="btn small" data-watch>+30 min</button>`)}
   ${(() => { const open = GW.list().filter(g => gameInfo(g).ready); if (!open.length) return "";
      const g = open.slice().sort((a, b) => (((S.games || {})[a.id] || {}).plays || 0) - (((S.games || {})[b.id] || {}).plays || 0))[0];
      return step(log.g, "Play · 5 min", g.icon + " " + esc(g.name) + " · " + esc(g.skill), `<button class="btn small" data-game-start="${g.id}">Play</button>`); })()}
   ${canSpeak() ? step(log.a, "Listen · commute or car", nl ? "Lesson " + nl.n + " narrated, hands-free" : "Replay any lesson", `<button class="btn small" data-car-start>🚗 Play</button>`) : ""}
  </section>
  <div class="stats">
   <div class="stat"><b>${ALL.filter(l => S.done[l.id]).length}</b><span>lessons</span></div>
   <div class="stat"><b>${known}</b><span>words known</span></div>
   <div class="stat"><b>${Math.round(S.hours)}</b><span>hours heard</span></div>
   <div class="stat"><b>${level()}</b><span>level</span></div>
  </div>
  <p class="note">Everything works offline. Your progress is saved on this phone; make a backup now and then from the Progress tab.</p>`;
}

function vLessons() {
  if (ui.lesson && LESSONS[ui.lesson]) return vLesson(ui.lesson);
  const nl = nextLesson();
  return `<p class="intro">${ALL.length} lessons from your first word to C1. Each has an explanation, examples, a dialogue, new words for your cards and 7 exercises.</p>
  ${canSpeak() ? `<div class="listen-cta"><button class="btn" data-car-start>🚗 Car mode: listen from ${nl ? "lesson " + nl.n + " (" + esc(nl.title) + ")" : "the start"}</button></div>` : ""}` +
    PHASES.map(p => { const d = p.lessons.filter(l => S.done[l[0]]).length;
      return `<section class="card"><div class="phase-head"><span class="badge ${d === p.lessons.length ? "done" : ""}">${p.lvl}</span><div class="t"><h2>${p.name}</h2><div class="when">${p.when} · ${d}/${p.lessons.length} done</div></div></div>
      <div>${p.lessons.map((l, i) => { const done = S.done[l[0]], isNext = nl && nl.id === l[0];
        return `<button class="lrow ${done ? "done" : ""} ${isNext ? "next" : ""}" data-open-lesson="${l[0]}"><span class="num">${String(i + 1).padStart(2, "0")}</span><span>${esc(l[1])}</span><span class="st">${done ? "✓ " + (S.scores[l[0]] ?? "") + "%" : isNext ? "NEXT" : "›"}</span></button>`; }).join("")}</div></section>`; }).join("");
}

// Lesson 1's narration walks through every sound with example words; show the same walk-through on the page,
// with each example word tappable (most are real human recordings).
function soundBySound(ai) {
  const rows = ai.map(([lang, text]) => lang === "de"
    ? `<div class="chips sbs">${text.split(/\.\s*/).filter(Boolean).map(w => `<button class="chip" data-say-word="${esc(w)}">▶ ${esc(w)}</button>`).join("")}</div>`
    : `<p>${esc(text)}</p>`).join("");
  return `<section class="card"><h3>Sound by sound</h3><p class="note">The full walk-through from the audio lesson. Tap a word to hear it, then say it yourself.</p><div class="prose">${rows}</div></section>`;
}
function vLesson(id) {
  const M = BYID[id], L = LESSONS[id], st = ex[id] || {};
  const n = L.e.length, answered = Object.keys(st).length, ok = Object.values(st).filter(x => x.ok).length;
  const t = L.t ? `<div class="tablewrap"><table><caption>${esc(L.t.c)}</caption><thead><tr>${L.t.h.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${L.t.r.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
  const exs = L.e.map((e, i) => { const s = st[i];
    if (e[0] === "c") { const [, q, opts, ans, why] = e;
      return `<div class="q"><div class="qt">${i + 1}. ${esc(q)}</div><div class="opts">${opts.map((o, j) => { let c = ""; if (s) { if (j === ans) c = "right"; else if (s.given === j) c = "wrong"; } return `<button class="opt ${c}" data-choice="${i}:${j}" ${s ? "disabled" : ""}>${esc(o)}</button>`; }).join("")}</div>${s ? `<div class="fb ${s.ok ? "ok" : "no"}">${s.ok ? "Richtig! " : "Not quite. "}${esc(why)}</div>` : ""}</div>`; }
    const [, q, ans, , why] = e;
    return `<div class="q"><div class="qt">${i + 1}. ${esc(q)}</div>${s ? `<div class="fb ${s.ok ? "ok" : "no"}"><b>${esc(s.given)}</b><br>${s.ok ? (s.close ? "Almost! Check the spelling. " : "Richtig! ") : "Not quite. "}${esc(why)}${s.ok && !s.close ? "" : "<br>Model answer: " + esc(ans)}${!s.ok ? `<br><button class="btn small ghost" data-override="${i}">I was right</button>` : ""}</div>` :
      `<div class="btnrow"><input class="field" style="flex:1;min-width:0" id="w-${i}" placeholder="Schreib auf Deutsch" autocomplete="off" autocapitalize="sentences" spellcheck="false"><button class="btn small primary" data-write="${i}">Check</button></div>`}</div>`; }).join("");
  return `<button class="btn ghost back" data-back>‹ All lessons</button>
  <div class="lesson-title"><span class="badge ${S.done[id] ? "done" : ""}">${PHASES.find(p => p.id === M.phase).lvl}</span><div><div class="eyebrow">Lesson ${M.n} · ${PHASES.find(p => p.id === M.phase).name}</div><h2>${esc(M.title)}</h2></div></div>
  ${canSpeak() ? `<div class="listen-cta"><button class="btn primary" data-listen-lesson="${id}">🎧 Listen to this lesson</button><span class="note">Narrated in English with German examples, pauses to repeat and a spoken quiz. Works in the car.</span></div>` : ""}
  <section class="card"><div class="prose">${L.i.split(/\n\n+/).map(p => `<p>${md(p)}</p>`).join("")}</div>${t}</section>
  ${L.ai ? soundBySound(L.ai) : ""}
  <section class="card"><h3>Examples</h3><div>${L.x.map(e => `<div class="ex"><span class="es">${esc(e[0])}</span><span class="en">${esc(e[1])}</span></div>`).join("")}</div><div class="btnrow">${listenBtn("data-speak-ex")}</div></section>
  <section class="card"><h3>Dialogue</h3><p class="note">Tap a line to see the English.</p><div>${L.d.map(d => `<div class="line" data-reveal><span class="who">${esc(d[0])}</span><span>${esc(d[1])}</span><span class="en" hidden>${esc(d[2])}</span></div>`).join("")}</div><div class="btnrow">${listenBtn("data-speak-dlg", "Listen to the dialogue")}</div></section>
  <section class="card"><h3>New words</h3><p class="note">These go into your cards when you finish the lesson.</p><div class="vocab">${L.v.map(v => `<div><b>${esc(v[0])}</b><span>${esc(v[1])}</span></div>`).join("")}</div></section>
  ${L.tip ? `<div class="tip"><b>Tip · </b>${esc(L.tip)}</div>` : ""}
  <section class="card"><h3>Practice · ${ok}/${n}</h3><div>${exs}</div>
   <div class="btnrow"><button class="btn primary" data-finish="${id}" ${answered < n ? "disabled" : ""}>${S.done[id] ? "Finish again" : "Finish lesson"}</button>${answered < n ? `<span class="note">Answer all ${n} to finish.</span>` : ""}</div></section>`;
}

function vCards() {
  const all = allCards(), due = dueCards();
  if (review) {
    const cur = review.queue[0];
    if (!cur) { const c = review.count; review = null; logAct("c"); return `<section class="card"><h2>Fertig!</h2><p>You reviewed ${c} card${c === 1 ? "" : "s"}. Come back tomorrow for the next ones.</p><button class="btn primary" data-nav-go="today">Back to today</button></section>`; }
    const c = decks[cur.deck].cards[cur.i], front = ui.dir === "de" ? c.de : c.en, back = ui.dir === "de" ? c.en : c.de, b = c.b || 0;
    const lab = x => { const d = INT[Math.min(7, x)]; return d === 0 ? "today" : d === 1 ? "1 day" : d < 30 ? d + " days" : Math.round(d / 30) + " mo"; };
    return `<div class="btnrow" style="justify-content:space-between"><span class="eyebrow">${review.queue.length} left</span><button class="btn ghost" data-end-review>End</button></div>
    <section class="card flash"><div class="front">${esc(front)}</div>${review.shown ? `<div class="back">${esc(back)}</div>${c.ex ? `<div class="exs">${esc(c.ex)}</div>` : ""}` : ""}${listenBtn("data-speak-card")}</section>
    ${review.shown ? `<div class="grade"><button class="btn" data-grade="0">Again<small>today</small></button><button class="btn primary" data-grade="1">Good<small>${lab(b + 1)}</small></button><button class="btn" data-grade="2">Easy<small>${lab(b + 2)}</small></button></div>` : `<button class="btn primary" data-show>Show answer</button>`}`;
  }
  const known = all.filter(x => (x.c.b || 0) >= 3).length;
  return `<section class="card"><h2>Flashcards</h2>
    <div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><b>${due.length}</b><span>due now</span></div><div class="stat"><b>${known}</b><span>known</span></div><div class="stat"><b>${all.length}</b><span>total</span></div></div>
    <div class="btnrow"><button class="btn primary" data-start-review ${due.length ? "" : "disabled"}>${due.length ? "Review " + Math.min(due.length, 60) + (due.length === 1 ? " card" : " cards") : "Nothing due"}</button>
    <span class="seg" role="group" aria-label="Direction"><button data-dir="de" aria-pressed="${ui.dir === "de"}">DE → EN</button><button data-dir="en" aria-pressed="${ui.dir === "en"}">EN → DE</button></span></div>
    <p class="note">Cards you know come back less often: tomorrow, then in 3 days, a week, two weeks, a month. Say the answer out loud before you tap Show answer.</p></section>
  ${CORE.length ? (() => { const pos = get("corePos", 0), auto = get("coreAuto", false), n = corePerDay();
    return `<section class="card"><h3>Core 2,000 words</h3>
    <p class="note">The ${CORE.length.toLocaleString()} most common words of everyday German, most frequent first, with articles, plurals and irregular forms. Words you already have from lessons are skipped. ${pos ? `You're at word ${pos.toLocaleString()} of ${CORE.length.toLocaleString()}.` : ""}</p>
    <div class="pbar"><i style="width:${Math.round(100 * pos / CORE.length)}%"></i></div>
    <div class="btnrow"><span class="seg" role="group" aria-label="New words per day">${[5, 10, 20].map(k => `<button data-core-n="${k}" aria-pressed="${n === k}">${k} a day</button>`).join("")}</span>
    <button class="btn" data-core-add ${pos >= CORE.length ? "disabled" : ""}>Add ${n} now</button></div>
    ${coreMsg ? `<p class="note"><b>${esc(coreMsg)}</b></p>` : ""}
    <label class="note carauto"><input type="checkbox" id="coreAuto" ${auto ? "checked" : ""}> Add ${n} new words automatically each day</label></section>`; })() : ""}
  <section class="card"><h3>Add your own card</h3>
    <div class="btnrow"><input class="field" style="flex:1 1 140px;min-width:0" id="newDe" placeholder="Deutsch" autocomplete="off"><input class="field" style="flex:1 1 140px;min-width:0" id="newEn" placeholder="English" autocomplete="off"><button class="btn" data-add-card>Add</button></div></section>
  ${all.length ? `<section class="card"><h3>Your decks</h3><div>${Object.entries(decks).map(([k, d]) => `<div class="show"><span class="n">${esc(d.title || k)}</span><span class="w">${(d.cards || []).length} cards</span></div>`).join("")}</div></section>` : `<p class="note">Finish a lesson and its new words appear here.</p>`}`;
}

function vSpeak() {
  if (ui.drill) { const D = DRILLS.find(x => x.id === ui.drill); if (D) return vDrill(D); }
  const lv = workLevel();
  return `<section class="card"><h2>Speak</h2><p class="note">Short role-plays. Read or listen to what the person says, then answer out loud and type it (tip: use your keyboard's microphone to dictate). The app checks your answer against natural replies.</p></section>` +
    ["A1", "A2", "B1", "B2"].map(l => { const ds = DRILLS.filter(x => x.lvl === l); if (!ds.length) return "";
      return `<section class="card"><div class="phase-head"><span class="badge ${lvlIdx(l) < lvlIdx(lv) ? "done" : ""}">${l}</span><div class="t"><h3>${l === lv ? "Your level" : l}</h3></div></div><div>${ds.map(d => `<button class="lrow ${S.done[d.id] ? "done" : ""}" data-open-drill="${d.id}"><span class="num">${d.turns.length}×</span><span>${esc(d.title)}<br><small class="note">${esc(d.who)}</small></span><span class="st">${S.done[d.id] ? "✓" : "›"}</span></button>`).join("")}</div></section>`; }).join("");
}
function vDrill(D) {
  if (!drill || drill.id !== D.id) drill = { id: D.id, step: 0, results: [] };
  const done = drill.step >= D.turns.length;
  const past = D.turns.slice(0, drill.step).map((t, i) => { const r = drill.results[i] || {};
    return `<div class="msg ai"><span>${esc(t[0])}</span></div><div class="msg me">${esc(r.given || "…")}</div><div class="fb ${r.grade === "good" ? "ok" : "no"}" style="justify-self:end;max-width:88%">${r.grade === "good" ? "Richtig!" : r.grade === "close" ? "Close!" : "Try this:"} ${r.grade === "good" ? "" : esc(t[3])}</div>`; }).join("");
  let cur = "";
  if (!done) { const t = D.turns[drill.step], r = drill.pending;
    cur = `<div class="msg ai"><span>${esc(t[0])}</span><span class="tr" id="drillTr" hidden>${esc(t[1])}</span><span class="acts"><button class="btn small ghost" data-drill-tr>English</button>${canSpeak() ? `<button class="btn small ghost" data-say-line>▶ Listen</button>` : ""}</span></div>
    <div class="tip"><b>Your turn · </b>${esc(t[2])}</div>
    ${r ? `<div class="msg me">${esc(r.given)}</div><div class="fb ${r.grade === "good" ? "ok" : "no"}">${r.grade === "good" ? "Richtig! " : r.grade === "close" ? "Close! A natural answer: " : "A natural answer: "}<b>${esc(t[3])}</b>${canSpeak() ? ` <button class="btn small ghost" data-say-model>▶</button>` : ""}</div><div class="btnrow"><button class="btn primary" data-drill-next>${drill.step + 1 < D.turns.length ? "Next" : "Finish"}</button>${r.grade !== "good" ? `<button class="btn small ghost" data-drill-right>I was right</button>` : ""}</div>` :
      `<div class="composer" style="grid-template-columns:1fr auto"><textarea class="field" id="drillBox" rows="2" placeholder="Antworte auf Deutsch…" autocapitalize="sentences" spellcheck="false"></textarea><button class="btn primary" data-drill-check>Check</button></div><button class="btn small ghost" data-drill-skip style="justify-self:start">Show me the answer</button>`}`; }
  const good = drill.results.filter(r => r && r.grade === "good").length;
  return `<button class="btn ghost back" data-drill-back>‹ All role-plays</button>
  <section class="card"><div class="eyebrow">${D.lvl} · ${esc(D.who)}</div><h2>${esc(D.title)}</h2></section>
  <div class="chat">${past}${cur}</div>
  ${done ? `<section class="card"><h3>Gut gemacht!</h3><p>${good} of ${D.turns.length} answers matched a natural reply. Try it again tomorrow without looking.</p><div class="btnrow"><button class="btn primary" data-drill-restart>Do it again</button><button class="btn" data-drill-back>Other role-plays</button></div></section>` : ""}`;
}

function vRead() {
  if (ui.story) { const s = STORIES.find(x => x.id === ui.story); if (s) return vStory(s); }
  const lv = workLevel();
  return `<section class="card"><h2>Read & listen</h2><p class="note">Short stories set in Germany, from A1 to C1. ${canSpeak() ? "Try listening first with the text blurred, then read." : "Tap a paragraph for the English."}</p></section>` +
    ["A1", "A2", "B1", "B2", "C1"].map(l => { const ss = STORIES.filter(x => x.lvl === l);
      return `<section class="card"><div class="phase-head"><span class="badge ${lvlIdx(l) < lvlIdx(lv) ? "done" : ""}">${l}</span><div class="t"><h3>${l === lv ? "Your level" : l}</h3></div></div><div>${ss.map(s => `<button class="lrow ${S.done[s.id] ? "done" : ""}" data-open-story="${s.id}"><span class="num">${s.p.length}¶</span><span>${esc(s.title)}</span><span class="st">${S.done[s.id] ? "✓" : "›"}</span></button>`).join("")}</div></section>`; }).join("");
}
function vStory(s) {
  const stt = storyState[s.id] || (storyState[s.id] = { answers: {}, blur: false, added: false });
  const qs = s.q.map((q, i) => { const a = stt.answers[i]; return `<div class="q"><div class="qt">${esc(q[0])}</div><div class="opts">${q[1].map((o, j) => { let c = ""; if (a !== undefined) { if (j === q[2]) c = "right"; else if (a === j) c = "wrong"; } return `<button class="opt ${c}" data-sq="${i}:${j}" ${a !== undefined ? "disabled" : ""}>${esc(o)}</button>`; }).join("")}</div></div>`; }).join("");
  return `<button class="btn ghost back" data-story-back>‹ All stories</button>
  <section class="card ${stt.blur ? "blur" : ""}"><div class="eyebrow">${s.lvl} story</div><h2>${esc(s.title)}</h2>
   ${canSpeak() ? `<div class="btnrow"><button class="btn small primary" data-story-listen>▶ Listen</button><button class="btn small" data-stop>Stop</button><button class="btn small" data-blur>${stt.blur ? "Show text" : "Blur text"}</button></div>` : ""}
   <div>${s.p.map(p => `<div class="para" data-reveal><span class="es">${esc(p[0])}</span><span class="en" hidden>${esc(p[1])}</span></div>`).join("")}</div></section>
  <section class="card"><h3>Words</h3><div class="vocab">${s.g.map(g => `<div><b>${esc(g[0])}</b><span>${esc(g[1])}</span></div>`).join("")}</div>
   <button class="btn small" data-story-cards ${stt.added ? "disabled" : ""}>${stt.added ? "Added to your cards" : "Add these words to my cards"}</button></section>
  <section class="card"><h3>Did you understand?</h3><div>${qs}</div></section>`;
}

function vProgress() {
  const h = S.hours, max = 1600, next = HOUR_MARKS.find(m => h < m[0]);
  return `<section class="card"><h2>Your roadmap</h2><p class="note">A phase counts as reached when 80% of its lessons are done. Lessons tick themselves; tick milestones yourself.</p></section>` +
  PHASES.map(p => { const d = p.lessons.filter(l => S.done[l[0]]).length;
    return `<section class="card"><div class="phase-head"><span class="badge ${d === p.lessons.length ? "done" : ""}">${p.lvl}</span><div class="t"><h3>${p.name}</h3><div class="note">${p.when} · ${d}/${p.lessons.length} lessons</div></div></div><p>${esc(p.goal)}</p>
    <div>${p.milestones.map(([id, t, sub]) => { const ms = t.startsWith("★"); return `<label class="check" for="m-${id}"><input type="checkbox" id="m-${id}" data-ms="${id}" ${S.done[id] ? "checked" : ""}><span><span class="${ms ? "ms" : ""}">${esc(ms ? t.slice(1) : t)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</span></label>`; }).join("")}</div></section>`; }).join("") +
  `<section class="card"><h2>Listening hours</h2>
    <div class="hours-big">${(Math.round(h * 4) / 4).toLocaleString()}<small>hours of German heard</small></div>
    <div class="ladder" aria-hidden="true"><div class="track"></div><div class="fill" style="width:${Math.min(100, h / max * 100)}%"></div>${HOUR_MARKS.map(([v, l]) => `<div class="mk ${h >= v ? "hit" : ""}" style="left:${v / max * 100}%">${v}<br>${l}</div>`).join("")}</div>
    <p class="note">${next ? `${(next[0] - h).toLocaleString(undefined, { maximumFractionDigits: 2 })} h to the ${next[1]} mark.` : "Past 1,600 hours."} Count time spent following series, videos and podcasts.</p>
    <div class="btnrow"><button class="btn primary small" data-add="0.25">+15 min</button><button class="btn primary small" data-add="0.5">+30 min</button><button class="btn primary small" data-add="1">+1 h</button><button class="btn small" data-add="-0.25">−15 min</button></div></section>
  <section class="card"><h2>Series ladder</h2><p class="note">Move up a tier when you follow 70–80% without pausing. Watching needs internet; everything else in this app works offline.</p>
   ${SERIES.map(t => `<details><summary>${t.tier} · ${t.lvl} <span class="subs">${t.subs}</span></summary><div>${t.shows.map(s => `<div class="show"><span class="n">${esc(s[0])}</span><span class="w">${esc(s[1])}</span><p>${esc(s[2])}</p></div>`).join("")}</div></details>`).join("")}</section>
  <section class="card"><h2>Voice</h2>
   <p class="note">${!synth ? "This browser can't read text aloud." : deVoice ? "Using the German voice: " + esc(deVoice.name) + "." : "No German voice found. On Android, open Settings → System → Languages → Text-to-speech, and download German (Deutsch) for offline use."}</p>
   ${synth ? `<div class="btnrow"><span class="note">Speed</span><span class="seg" role="group" aria-label="Speech speed">${[[0.7, "Slow"], [0.9, "Normal"], [1.05, "Fast"]].map(([r, l]) => `<button data-rate="${r}" aria-pressed="${(ui.rate || 0.9) === r}">${l}</button>`).join("")}</span>${listenBtn("data-test-voice", "Test")}</div>` : ""}</section>
  <section class="card"><h2>Lesson audio</h2>
   ${CLIPS ? `<p class="note">${CLIPS.size.toLocaleString()} natural voice clips for the narrated lessons. They play from the internet and are kept on the phone once heard. To listen offline (car, plane), download them all once on Wi-Fi.</p>
   <div class="btnrow"><button class="btn primary" data-dl-audio ${dl.on ? "disabled" : ""}>${dl.on ? "Downloading…" : "Download all lesson audio (about " + Math.max(1, Math.round(CLIPS.size * 0.012)) + " MB)"}</button></div>
   <p class="note" id="audMsg">${esc(dl.msg)}</p>` : `<p class="note">Natural voices aren't available yet (or can't be reached offline). Lessons use your phone's voice instead.</p>`}</section>
  <section class="card"><h2>Credits</h2><p class="note">Narration voices made with Neuphonic's open models: ${AUDINFO && AUDINFO.voices ? esc(Object.values(AUDINFO.voices).join("; ")) : "NeuTTS (Neuphonic)"}. Audio decoding: NeuCodec (Neuphonic). Speech generated on a home PC; no internet service is used while you learn.</p>
   ${AUDINFO && AUDINFO.credits ? `<div>${AUDINFO.credits.map(c => `<div class="show"><span class="n">${esc(c.who)}</span><span class="w">${esc(c.license)}</span><p>${esc(c.what)}</p></div>`).join("")}</div>` : ""}</section>
  <section class="card"><h2>Backup</h2><p class="note">Your progress lives only on this phone. Save a backup file now and then, especially before clearing browser data or changing phones.</p>
   <div class="btnrow"><button class="btn" data-export>Save backup file</button><label class="btn" for="importFile">Restore from file</label><input type="file" id="importFile" accept="application/json,.json" hidden></div><p class="note" id="backupMsg"></p></section>
  <button class="reset" id="resetBtn">Reset all progress</button><div id="resetConfirm" hidden class="btnrow"><span class="note">Clear lessons, cards, ticks and hours?</span><button class="btn small" id="resetYes">Yes, reset</button><button class="btn small" id="resetNo">Cancel</button></div>`;
}

function render() {
  header();
  if (ui.view === "games" && G.running) return; // never wipe a game that's being played
  const v = { today: vToday, lessons: vLessons, cards: vCards, speak: vSpeak, read: vRead, games: vGames, progress: vProgress }[ui.view] || vToday;
  $("view").innerHTML = v();
}

/* ---------------- games (framework in games.js) ---------------- */
const GW = window.WIDGames || { list: () => [] };
const G = { running: false, game: null, items: [], i: 0, score: 0, streak: 0, missed: [], pool: [], result: null };
const gameApi = {
  done: () => ALL.filter(l => S.done[l.id] && LESSONS[l.id]).map(l => l.id),
  lesson: id => LESSONS[id], meta: id => BYID[id],
  level: () => Math.max(0, ["A0", "A1", "A2", "B1", "B2", "C1"].indexOf(level()) - 1),
  say: t => speak(t), canSay: () => canSpeak(), cleanWord: w => cleanWord(w),
};
function gameInfo(g) {
  const pool = g.pool(gameApi), unlocked = !!S.done[g.unlock], ready = unlocked && pool.length >= g.minItems;
  const sc = (S.games || {})[g.id] || {};
  return { pool, unlocked, ready, sc };
}
function markMissed(word) { // a missed word becomes due again in the flashcards
  if (!word) return; let hit = false;
  for (const d of Object.values(decks)) for (const c of d.cards || []) if (cleanWord(c.de) === word || c.de === word) { c.b = 0; c.d = today(); hit = true; }
  if (hit) saveDecks();
}
function vGames() {
  if (G.result) { const r = G.result, g = G.game;
    return `<section class="card g-result"><div class="eyebrow">${g.icon} ${esc(g.name)}</div><h2>${r.score} / ${r.total}</h2>
      <p>${r.best ? "🏆 New best score!" : "Best: " + ((S.games || {})[g.id] || {}).best + " / " + r.total}</p>
      ${r.missed.length ? `<p class="note">These go back into your flashcards for review:</p><div class="vocab">${r.missed.map(m => `<div><b>${esc(m)}</b></div>`).join("")}</div>` : `<p class="note">No mistakes. Perfekt!</p>`}
      <div class="btnrow"><button class="btn primary" data-game-start="${g.id}">Play again</button><button class="btn" data-game-back>All games</button></div></section>`; }
  const done = gameApi.done().length;
  return `<section class="card"><h2>Play</h2><p class="note">Games use only what you've learned: each finished lesson adds its words, sentences and grammar. Words you miss go back into your flashcards.</p></section>` +
    GW.list().map(g => { const i = gameInfo(g), unl = BYID[g.unlock];
      return `<section class="card g-card ${i.ready ? "" : "locked"}"><div class="phase-head"><span class="g-icon">${g.icon}</span><div class="t"><h3>${esc(g.name)}</h3><div class="note">${esc(g.skill)}${i.sc.best != null ? " · best " + i.sc.best : ""}</div></div>
        ${i.ready ? `<button class="btn primary small" data-game-start="${g.id}">Play</button>` : ""}</div>
        <p>${esc(g.blurb)}</p>
        <p class="note">${!i.unlocked ? `🔒 Unlocks after lesson ${unl ? unl.n + ": " + esc(unl.title) : g.unlock}` : i.ready ? `${i.pool.length} puzzles from your ${done} finished lessons` : `Needs a few more finished lessons (${i.pool.length}/${g.minItems})`}</p></section>`; }).join("");
}
function gameStart(id) {
  const g = GW.list().find(x => x.id === id); if (!g) return;
  const pool = g.pool(gameApi); if (pool.length < g.minItems) return;
  Object.assign(G, { running: true, game: g, pool, items: GW.pick(pool, Math.min(pool.length, g.round(gameApi))), i: 0, score: 0, streak: 0, missed: [], result: null });
  ui.view = "games"; header();
  $("view").innerHTML = `<div class="g-top"><button class="btn ghost" data-game-quit>✕ Quit</button><b>${G.game.icon} ${esc(G.game.name)}</b><span class="g-score" id="gScore"></span></div><div class="g-prog"><i id="gProg"></i></div><div class="g-stage" id="gStage"></div>`;
  gameNext();
}
function gameNext() {
  if (!G.running) return;
  $("gScore").textContent = `${G.score} / ${G.items.length}`; $("gProg").style.width = (100 * G.i / G.items.length) + "%";
  if (G.i >= G.items.length) return gameEnd();
  const it = G.items[G.i];
  G.game.play($("gStage"), it, gameApi, (ok, missedWord) => {
    if (!G.running) return;
    if (ok) { G.score++; G.streak++; } else { G.streak = 0; if (missedWord) { G.missed.push(missedWord); markMissed(missedWord); } }
    G.i++; gameNext();
  }, { streak: G.streak, pool: G.pool, index: G.i });
}
function gameEnd() {
  S.games = S.games || {}; const prev = S.games[G.game.id] || { best: null, plays: 0 }, best = prev.best == null || G.score > prev.best;
  S.games[G.game.id] = { best: best ? G.score : prev.best, plays: (prev.plays || 0) + 1, last: today() };
  logAct("g"); saveS();
  G.running = false; G.result = { score: G.score, total: G.items.length, best: best && G.score > 0, missed: [...new Set(G.missed)] };
  render(); window.scrollTo(0, 0);
}
function go(v) { coreMsg = ""; G.running = false; G.result = null; ui.view = v; if (v !== "lessons") ui.lesson = null; if (v !== "read") ui.story = null; if (v !== "speak") { ui.drill = null; drill = null; } stopSpeak(); saveUI(); render(); window.scrollTo(0, 0); }

/* ---------------- actions ---------------- */
function startReview() { const due = shuffle(dueCards()).slice(0, 60); if (!due.length) return; review = { queue: due.map(x => ({ deck: x.deck, i: x.i })), shown: false, count: 0, again: new Set() }; ui.view = "cards"; saveUI(); render(); window.scrollTo(0, 0); }
// Core 2,000 frequency deck: new words are fed in a few at a time, skipping ones already in another deck.
const CORE = window.CORE_WORDS || [];
const corePerDay = () => get("corePerDay", 10);
let coreMsg = "";
function addCoreWords(n) {
  const have = new Set(allCards().map(x => norm(cleanWord(x.c.de)))), items = [];
  let pos = get("corePos", 0);
  while (pos < CORE.length && items.length < n) { const w = CORE[pos++]; if (!have.has(norm(cleanWord(w[0])))) items.push([w[0], w[1], w[2] || ""]); }
  put("corePos", pos); if (items.length) addCards("core", "Core 2,000 words", items);
  return items.length;
}
function addCards(deckId, title, items) {
  const t = today(), d = decks[deckId] || { title, cards: [] }, have = new Set(d.cards.map(c => norm(c.de)));
  for (const [de, en, exs] of items) if (de && !have.has(norm(de))) { d.cards.push({ de, en: en || "", ex: exs || "", b: 0, d: t }); have.add(norm(de)); }
  decks[deckId] = d; saveDecks();
}
function finishLesson(id) {
  const L = LESSONS[id], st = ex[id] || {}, ok = Object.values(st).filter(x => x.ok).length;
  S.done[id] = true; S.scores[id] = Math.round(100 * ok / L.e.length);
  addCards(id, BYID[id].title, L.v); logAct("l");
  ui.lesson = null; ui.view = "today"; saveUI(); render(); window.scrollTo(0, 0);
}
function checkWrite(i) {
  const id = ui.lesson, e = LESSONS[id].e[i], box = $("w-" + i); const given = (box && box.value || "").trim(); if (!given) return;
  const sim = similarity(given, [e[2], ...(e[3] || [])]);
  (ex[id] || (ex[id] = {}))[i] = { given, ok: sim >= 0.9, close: sim >= 0.9 && sim < 1 };
  render();
}
function drillCheck(skip) {
  const D = DRILLS.find(x => x.id === ui.drill), t = D.turns[drill.step];
  const given = skip ? "—" : (($("drillBox") || {}).value || "").trim(); if (!given) return;
  const sim = skip ? 0 : similarity(given, [t[3], ...(t[4] || [])]);
  drill.pending = { given, grade: sim >= 0.85 ? "good" : sim >= 0.6 ? "close" : "miss" };
  render();
  if (canSpeak() && drill.pending.grade !== "good") { /* let them hear the model */ }
}
const dl = { on: false, msg: "" };
async function downloadAudio() {
  if (!CLIPS || dl.on || !("caches" in window)) return;
  dl.on = true; dl.msg = "Checking what's already on the phone…"; render();
  const cache = await caches.open("wid-audio"), have = new Set((await cache.keys()).map(r => new URL(r.url).pathname.split("/").pop()));
  const todo = [...CLIPS].filter(h => !have.has(h + ".ogg")), total = todo.length; let done = 0, failed = 0;
  const setMsg = () => { dl.msg = total ? `Downloaded ${done} of ${total}${failed ? ` (${failed} failed, try again later)` : ""}` : "All lesson audio is already on this phone."; const m = $("audMsg"); if (m) m.textContent = dl.msg; };
  setMsg();
  const worker = async () => { while (todo.length) { const h = todo.shift(), url = "audio/c/" + h + ".ogg";
    try { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw 0; await cache.put(url, r); } catch (e) { failed++; }
    done++; if (done % 25 === 0 || !todo.length) setMsg(); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  dl.on = false; dl.msg = failed ? `Done, but ${failed} clips failed. Tap again on Wi-Fi to finish.` : `All ${CLIPS.size.toLocaleString()} clips are on this phone. Lessons now play offline.`;
  render();
}
function exportBackup() {
  const data = { app: "weg-ins-deutsche", version: 1, saved: new Date().toISOString(), progress: S, decks, storyState };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "deutsch-backup-" + today() + ".json";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  const m = $("backupMsg"); if (m) m.textContent = "Backup saved to your Downloads folder.";
}
function importBackup(file) {
  const r = new FileReader();
  r.onload = () => { const m = $("backupMsg");
    try { const d = JSON.parse(r.result); if (d.app !== "weg-ins-deutsche" || !d.progress) throw 0;
      S = Object.assign({ done: {}, hours: 0, days: {}, scores: {} }, d.progress); decks = d.decks || {}; storyState = d.storyState || {};
      saveS(); saveDecks(); put("storyState", storyState); render(); const m2 = $("backupMsg"); if (m2) m2.textContent = "Backup restored.";
    } catch (e) { if (m) m.textContent = "That file isn't a backup from this app."; } };
  r.readAsText(file);
}

/* ---------------- events ---------------- */
$("nav").addEventListener("click", e => { const b = e.target.closest("[data-nav]"); if (!b) return; if (b.dataset.nav === ui.view) { ui.lesson = null; ui.story = null; ui.drill = null; drill = null; } go(b.dataset.nav); });
$("view").addEventListener("click", e => {
  const t = e.target.closest("button,[data-reveal]") || e.target, d = t.dataset || {};
  if (d.navGo) return go(d.navGo);
  if (d.gameStart) return gameStart(d.gameStart);
  if (d.gameQuit !== undefined) { G.running = false; G.result = null; stopSpeak(); return render(); }
  if (d.gameBack !== undefined) { G.result = null; return render(); }
  if (d.startReview !== undefined) return startReview();
  if (d.coreN) { put("corePerDay", +d.coreN); return render(); }
  if (d.coreAdd !== undefined) { const k = addCoreWords(corePerDay()); put("coreDay", today()); coreMsg = k ? `${k} new word${k === 1 ? "" : "s"} added. They're due now.` : "No new words left."; return render(); }
  if (d.openLesson) { ui.view = "lessons"; ui.lesson = d.openLesson; saveUI(); render(); return window.scrollTo(0, 0); }
  if (d.back !== undefined) { ui.lesson = null; saveUI(); return render(); }
  if (d.reveal !== undefined) { const en = t.querySelector(".en"); if (en) en.hidden = !en.hidden; return; }
  if (d.choice) { const [i, j] = d.choice.split(":").map(Number), e2 = LESSONS[ui.lesson].e[i]; (ex[ui.lesson] || (ex[ui.lesson] = {}))[i] = { given: j, ok: j === e2[3] }; return render(); }
  if (d.write !== undefined) return checkWrite(+d.write);
  if (d.override !== undefined) { const s = ex[ui.lesson][+d.override]; s.ok = true; s.close = false; return render(); }
  if (d.finish) return finishLesson(d.finish);
  if (d.listenLesson) { P.auto = false; P.car = false; return playerLoad(d.listenLesson, true); }
  if (d.carStart !== undefined) { const nl = nextLesson() || ALL[0]; P.auto = true; P.car = true; return playerLoad(nl.id, true); }
  if (d.sayWord !== undefined) return speak(d.sayWord);
  if (d.speakEx !== undefined) return speak(LESSONS[ui.lesson].x.map(x => x[0]));
  if (d.speakDlg !== undefined) { const D = LESSONS[ui.lesson].d, who = [...new Set(D.map(x => x[0]))]; return speak(D.map(x => ({ text: x[1], alt: who.indexOf(x[0]) % 2 === 1 }))); }
  if (d.stop !== undefined) return stopSpeak();
  /* cards */
  if (d.show !== undefined) { review.shown = true; return render(); }
  if (d.speakCard !== undefined) { const c = review.queue[0], w = decks[c.deck].cards[c.i].de; return speak(clipUrl("de", false, cleanWord(w)) ? cleanWord(w) : w); }
  if (d.grade !== undefined) { const g = +d.grade, cur = review.queue.shift(), c = decks[cur.deck].cards[cur.i];
    if (g === 0) { c.b = 0; c.d = today(); const k = cur.deck + "|" + cur.i; if (!review.again.has(k)) { review.again.add(k); review.queue.push(cur); } }
    else { c.b = Math.min(7, (c.b || 0) + g); c.d = addDays(INT[c.b]); }
    review.count++; review.shown = false; saveDecks(); return render(); }
  if (d.endReview !== undefined) { if (review.count) logAct("c"); review = null; return render(); }
  if (d.dir) { ui.dir = d.dir; saveUI(); return render(); }
  if (d.addCard !== undefined) { const de = $("newDe").value.trim(), en = $("newEn").value.trim(); if (!de || !en) return; addCards("mine", "My own cards", [[de, en, ""]]); return render(); }
  /* speak */
  if (d.openDrill) { ui.view = "speak"; ui.drill = d.openDrill; drill = null; saveUI(); render(); return window.scrollTo(0, 0); }
  if (d.drillBack !== undefined) { ui.drill = null; drill = null; saveUI(); return render(); }
  if (d.drillTr !== undefined) { const el = $("drillTr"); if (el) el.hidden = !el.hidden; return; }
  if (d.sayLine !== undefined) { const D = DRILLS.find(x => x.id === ui.drill); return speak(D.turns[drill.step][0]); }
  if (d.sayModel !== undefined) { const D = DRILLS.find(x => x.id === ui.drill); return speak(D.turns[drill.step][3]); }
  if (d.drillCheck !== undefined) return drillCheck(false);
  if (d.drillSkip !== undefined) return drillCheck(true);
  if (d.drillRight !== undefined) { drill.pending.grade = "good"; return render(); }
  if (d.drillNext !== undefined) { const D = DRILLS.find(x => x.id === ui.drill); drill.results[drill.step] = drill.pending; drill.pending = null; drill.step++;
    if (drill.step >= D.turns.length) { S.done[D.id] = true; logAct("t"); }
    render(); const b = $("drillBox"); if (b) b.focus(); return; }
  if (d.drillRestart !== undefined) { drill = null; return render(); }
  /* read */
  if (d.openStory) { ui.view = "read"; ui.story = d.openStory; saveUI(); render(); return window.scrollTo(0, 0); }
  if (d.storyBack !== undefined) { stopSpeak(); ui.story = null; saveUI(); return render(); }
  if (d.storyListen !== undefined) { const s = STORIES.find(x => x.id === ui.story); speak(s.p.map(p => p[0])); return logAct("r"); }
  if (d.blur !== undefined) { const st = storyState[ui.story]; st.blur = !st.blur; put("storyState", storyState); return render(); }
  if (d.sq) { const [i, j] = d.sq.split(":").map(Number), s = STORIES.find(x => x.id === ui.story), st = storyState[s.id]; st.answers[i] = j; put("storyState", storyState);
    if (Object.keys(st.answers).length >= s.q.length) { S.done[s.id] = true; logAct("r"); } return render(); }
  if (d.storyCards !== undefined) { const s = STORIES.find(x => x.id === ui.story); addCards(s.id, "Story: " + s.title, s.g.map(g => [g[0], g[1], ""])); storyState[s.id].added = true; put("storyState", storyState); return render(); }
  /* today / progress */
  if (d.watch !== undefined) { S.hours = Math.round((S.hours + 0.5) * 4) / 4; logAct("w"); return render(); }
  if (d.add) { S.hours = Math.max(0, Math.round((S.hours + parseFloat(d.add)) * 4) / 4); saveS(); return render(); }
  if (d.rate) { ui.rate = parseFloat(d.rate); put("rate", ui.rate); return render(); }
  if (d.testVoice !== undefined) return speak("Hallo! Schön, dass du Deutsch lernst.");
  if (d.export !== undefined) return exportBackup();
  if (d.dlAudio !== undefined) return downloadAudio();
  if (t.id === "resetBtn") { $("resetConfirm").hidden = false; return; }
  if (t.id === "resetNo") { $("resetConfirm").hidden = true; return; }
  if (t.id === "resetYes") { S = { done: {}, hours: 0, days: {}, scores: {} }; decks = {}; storyState = {}; review = null; saveS(); saveDecks(); put("storyState", storyState); return render(); }
});
$("view").addEventListener("change", e => {
  if (e.target.id === "coreAuto") { put("coreAuto", e.target.checked); if (e.target.checked && get("coreDay", "") !== today()) { addCoreWords(corePerDay()); put("coreDay", today()); } return render(); }
  const id = e.target.dataset && e.target.dataset.ms;
  if (id) { if (e.target.checked) S.done[id] = true; else delete S.done[id]; saveS(); return header(); }
  if (e.target.id === "importFile" && e.target.files[0]) importBackup(e.target.files[0]);
});
$("view").addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.shiftKey) return;
  if (e.target.id && e.target.id.startsWith("w-")) { e.preventDefault(); checkWrite(+e.target.id.slice(2)); }
  if (e.target.id === "drillBox") { e.preventDefault(); drillCheck(false); }
});

ui.rate = get("rate", 0.9);
if (get("coreAuto", false) && get("coreDay", "") !== today()) { addCoreWords(corePerDay()); put("coreDay", today()); }
P.rep = !!get("rep", false);
$("player").addEventListener("click", playerClick);
$("car").addEventListener("click", playerClick);
{ let t; const touched = () => { if (!P.list) return; P.listTouched = true; clearTimeout(t); t = setTimeout(() => { P.listTouched = false; }, 5000); };
  ["touchstart", "wheel"].forEach(ev => $("car").addEventListener(ev, touched, { passive: true })); }
$("car").addEventListener("change", e => { if (e.target.id === "pAuto") P.auto = e.target.checked; });
render();
if ("serviceWorker" in navigator && location.protocol === "https:") {
  // When an app update arrives, reload once so the new version runs now instead of on the next open.
  const hadSW = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadSW && !reloaded && !P.on && !G.running) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register("sw.js").then(r => r.update()).catch(() => {});
}
})();
