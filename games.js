/* Weg ins Deutsche — game framework.
 *
 * A game is one object passed to WIDGames.register(). The framework handles the menu, unlocking,
 * round flow, scores, streak and sending missed words back to the flashcards. A game only says:
 *   id, name, icon, skill, blurb          what it is
 *   unlock: "a1-02"                       the lesson that must be finished first
 *   minItems: 6                           puzzles needed before it can be played
 *   pool(api)                             builds its puzzles from the lessons you've FINISHED,
 *                                         so it grows automatically as you progress
 *   round(api)                            how many puzzles per round (can depend on your level)
 *   play(el, item, api, answer)           shows one puzzle in `el`; calls answer(correct, missedWord)
 *
 * `api` (from app.js) gives read access to the course and your progress:
 *   api.done()            finished lesson ids, in course order
 *   api.lesson(id)        lesson content (x examples, d dialogue, v vocab, e exercises)
 *   api.meta(id)          {title, lvl, n}
 *   api.level()           0..4 for A1..C1 (difficulty)
 *   api.say(text)         plays a German word/sentence (natural recording if available)
 *   api.cleanWord(v)      "der Tisch, -e" -> "der Tisch"
 *   api.cards()           your flashcards [{de, en, b}] (b = box 0–7: low means you find it hard)
 *
 * unlock: null means no lesson is needed (games that play your flashcards). W.vocab and W.nouns mix lesson
 * words with your cards and mark hard ones weak; the app picks rounds with W.smartPick, about half weak words.
 */
(function () {
  "use strict";
  const games = [];
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a, n) => shuffle(a).slice(0, n);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const W = window.WIDGames = { register: g => games.push(g), list: () => games, shuffle, pick, esc };

  /* ---------- shared content builders (used by several games) ---------- */
  // Words come from finished lessons AND your flashcards (Core deck, level lists, your own cards), so the games
  // grow with the words you're learning. Cards you find hard (box 0–1) are marked weak: smartPick shows them more.
  const words = api => {            // [[German as written, English, weak]]
    const out = [];
    for (const id of api.done()) for (const v of api.lesson(id).v) out.push([v[0], v[1], false]);
    for (const c of api.cards ? api.cards() : []) out.push([c.de, c.en, (c.b || 0) < 2]);
    return out;
  };
  W.nouns = api => {               // [{art, noun, en, say, weak}] from vocabulary with der/die/das
    const out = [], seen = new Map();
    for (const [de, en, weak] of words(api)) {
      if (/\(pl\.\)/.test(de)) continue;
      const parts = de.replace(/,\s*-.*$/, "").split(/\s*\/\s*/), ens = String(en).split(/\s*\/\s*/);
      parts.forEach((p, k) => { const m = p.trim().match(/^(der|die|das)\s+([A-ZÄÖÜ][\wäöüß-]*)$/);
        if (!m) return;
        if (seen.has(m[2])) { if (weak) seen.get(m[2]).weak = true; return; }
        const it = { art: m[1], noun: m[2], en: ens[k] || ens[0], say: `${m[1]} ${m[2]}`, weak };
        seen.set(m[2], it); out.push(it); });
    }
    return out;
  };
  W.vocab = api => {                // [{de, en, full, weak}] all vocabulary from finished lessons and cards
    const out = [], seen = new Map();
    for (const [full, en, weak] of words(api)) { const de = api.cleanWord(full);
      if (seen.has(de)) { if (weak) seen.get(de).weak = true; continue; }
      const it = { de, en, full, weak }; seen.set(de, it); out.push(it); }
    return out;
  };
  // A round: about half hard words when there are any, the rest at random.
  W.smartPick = (pool, n) => {
    const weak = shuffle(pool.filter(x => x.weak)).slice(0, Math.ceil(n / 2)), rest = shuffle(pool.filter(x => !weak.includes(x)));
    return shuffle(weak.concat(rest.slice(0, n - weak.length)));
  };
  const fold = s => String(s).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  W.fold = fold;
  W.sentences = api => {            // [{de, en}] example + dialogue sentences, 3–10 words
    const out = [];
    for (const id of api.done()) { const L = api.lesson(id);
      for (const [de, en] of L.x.concat(L.d.map(d => [d[1], d[2]]))) { const n = de.split(/\s+/).length; if (n >= 3 && n <= 10 && !/[„“"–]/.test(de)) out.push({ de, en }); } }
    return out;
  };
  W.gaps = api => {                 // German gap-fill exercises: [{q, opts, ans, why}]
    const out = [];
    for (const id of api.done()) for (const e of api.lesson(id).e)
      if (e[0] === "c" && /___/.test(e[1]) && !/\b(the|you|is|what|which)\b/i.test(e[1])) out.push({ q: e[1], opts: e[2], ans: e[3], why: e[4] });
    return out;
  };

  /* ---------- 1. Der-Die-Das Dash ---------- */
  W.register({
    id: "dash", name: "Der-Die-Das Dash", icon: "🎯", skill: "Noun genders", unlock: null, minItems: 6,
    blurb: "A noun falls. Tap its article before it lands. Gets faster as you go.",
    pool: W.nouns, round: api => 12 + 2 * api.level(),
    play(el, it, api, answer, ctx) {
      const secs = Math.max(2.2, 6 - 0.6 * api.level() - 0.15 * ctx.streak);
      el.innerHTML = `<div class="g-arena"><div class="g-fall" style="animation-duration:${secs}s"><b>${esc(it.noun)}</b><small>${esc(it.en)}</small></div></div>
        <div class="g-arts">${["der", "die", "das"].map(a => `<button class="g-art g-${a}" data-a="${a}">${a}</button>`).join("")}</div>`;
      const fall = el.querySelector(".g-fall"); let over = false;
      const finish = (a) => { if (over) return; over = true; fall.style.animationPlayState = "paused";
        const ok = a === it.art; el.querySelectorAll(".g-art").forEach(b => { if (b.dataset.a === it.art) b.classList.add("right"); else if (b.dataset.a === a) b.classList.add("wrong"); });
        fall.querySelector("b").textContent = it.say; api.say(it.say); setTimeout(() => answer(ok, ok ? null : it.say), ok ? 900 : 1600); };
      fall.addEventListener("animationend", () => finish(null));
      el.querySelectorAll(".g-art").forEach(b => b.addEventListener("click", () => finish(b.dataset.a)));
    },
  });

  /* ---------- 2. Sentence Builder ---------- */
  W.register({
    id: "builder", name: "Sentence Builder", icon: "🧩", skill: "Word order", unlock: "a1-03", minItems: 5,
    blurb: "Put the words in the right order. Trains verb-second and verb-at-the-end.",
    pool: api => W.sentences(api).filter(s => s.de.split(/\s+/).length <= 5 + 2 * api.level()), round: () => 8,
    play(el, it, api, answer) {
      const end = (it.de.match(/[.!?]$/) || [""])[0], words = it.de.replace(/[.!?]$/, "").split(/\s+/);
      let tiles = shuffle(words.map((w, i) => ({ w, i }))); if (tiles.every((t, k) => t.i === k) && tiles.length > 1) tiles.reverse();
      const built = [];
      const draw = () => {
        el.innerHTML = `<p class="g-hint">${esc(it.en)}</p>
          <div class="g-line">${built.map((t, k) => `<button class="g-tile in" data-k="${k}">${esc(t.w)}</button>`).join("") || `<span class="note">Tap the words in order</span>`}<span class="g-end">${esc(end)}</span></div>
          <div class="g-bank">${tiles.map((t, k) => `<button class="g-tile" data-b="${k}">${esc(t.w)}</button>`).join("")}</div>
          <div class="btnrow"><button class="btn primary" data-check ${tiles.length ? "disabled" : ""}>Check</button></div>`;
        el.querySelectorAll("[data-b]").forEach(b => b.addEventListener("click", () => { built.push(tiles.splice(+b.dataset.b, 1)[0]); draw(); }));
        el.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => { tiles.push(built.splice(+b.dataset.k, 1)[0]); draw(); }));
        const c = el.querySelector("[data-check]"); if (c) c.addEventListener("click", () => {
          const norm = s => s.toLowerCase().replace(/[,]/g, "");
          const ok = norm(built.map(t => t.w).join(" ")) === norm(words.join(" "));
          el.querySelector(".g-line").classList.add(ok ? "right" : "wrong");
          if (!ok) el.querySelector(".g-bank").innerHTML = `<div class="fb no">Correct order: <b>${esc(it.de)}</b></div>`;
          c.disabled = true; api.say(it.de); setTimeout(() => answer(ok, null), ok ? 1400 : 3000);
        });
      };
      draw();
    },
  });

  /* ---------- 3. Listen & Tap ---------- */
  W.register({
    id: "listen", name: "Listen & Tap", icon: "👂", skill: "Listening", unlock: null, minItems: 6,
    blurb: "Hear a German word and pick what it means.",
    pool: W.vocab, round: () => 12,
    play(el, it, api, answer, ctx) {
      const n = api.level() >= 2 ? 5 : 4, opts = shuffle([it].concat(pick(ctx.pool.filter(x => x.en !== it.en), n - 1)));
      const audio = api.canSay();
      el.innerHTML = `<div class="g-listen">${audio ? `<button class="g-play" data-play aria-label="Play again">▶</button>` : `<b class="g-word">${esc(it.de)}</b>`}<small class="note">${audio ? "Tap ▶ to hear it again" : "Your phone has no German voice; reading instead"}</small></div>
        <div class="opts">${opts.map((o, k) => `<button class="opt" data-o="${k}">${esc(o.en)}</button>`).join("")}</div>`;
      if (audio) { api.say(it.de); el.querySelector("[data-play]").addEventListener("click", () => api.say(it.de)); }
      el.querySelectorAll("[data-o]").forEach(b => b.addEventListener("click", () => {
        const o = opts[+b.dataset.o], ok = o === it; el.querySelectorAll("[data-o]").forEach(x => { x.disabled = true; if (opts[+x.dataset.o] === it) x.classList.add("right"); });
        if (!ok) b.classList.add("wrong");
        el.querySelector(".g-listen").insertAdjacentHTML("beforeend", `<b class="g-word">${esc(it.de)}</b>`);
        setTimeout(() => answer(ok, ok ? null : it.de), ok ? 800 : 1800);
      }));
    },
  });

  /* ---------- 4. Grammar Gaps ---------- */
  W.register({
    id: "gaps", name: "Grammar Gaps", icon: "⚡", skill: "Grammar", unlock: "a1-04", minItems: 5,
    blurb: "Fill the gap fast. Every finished lesson adds its grammar.",
    pool: W.gaps, round: () => 10,
    play(el, it, api, answer) {
      const opts = shuffle(it.opts.map((o, k) => ({ o, k })));
      el.innerHTML = `<p class="g-q">${esc(it.q).replace("___", "<span class='g-blank'>___</span>")}</p>
        <div class="opts">${opts.map(x => `<button class="opt" data-k="${x.k}">${esc(x.o)}</button>`).join("")}</div>`;
      el.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => {
        const ok = +b.dataset.k === it.ans; el.querySelectorAll("[data-k]").forEach(x => { x.disabled = true; if (+x.dataset.k === it.ans) x.classList.add("right"); });
        if (!ok) b.classList.add("wrong");
        const filled = it.q.replace("___", it.opts[it.ans]);
        el.insertAdjacentHTML("beforeend", `<div class="fb ${ok ? "ok" : "no"}">${ok ? "Richtig! " : ""}${esc(it.why)}</div>`);
        if (/^[A-ZÄÖÜ]/.test(filled) && !/\?$/.test(it.q.trim()) || /[.!]$/.test(filled)) api.say(filled.replace(/\s*\(.*?\)\s*$/, ""));
        setTimeout(() => answer(ok, null), ok ? 1100 : 2400);
      }));
    },
  });

  /* ---------- 5. Match Pairs ---------- */
  const short = en => String(en).split(/[;(]/)[0].trim();
  W.register({
    id: "pairs", name: "Match Pairs", icon: "🔗", skill: "Vocabulary", unlock: null, minItems: 2,
    blurb: "Tap a German word, then its meaning. Uses your flashcards, with the words you find hard more often.",
    pool: api => {  // one puzzle = one board of 4–6 pairs with different meanings
      const k = Math.min(6, 4 + api.level()), boards = [];
      let words = W.smartPick(W.vocab(api).filter(w => w.de.length <= 22 && short(w.en).length <= 26 && !/…/.test(w.de)), 60);
      while (words.length >= k) {
        const board = [], used = new Set();
        words = words.filter(w => { const e = short(w.en).toLowerCase(); if (board.length < k && !used.has(e)) { used.add(e); board.push(w); return false; } return true; });
        if (board.length < k) break;
        boards.push({ board, weak: board.some(w => w.weak) });
      }
      return boards;
    },
    round: () => 3,
    play(el, it, api, answer) {
      const de = shuffle(it.board.map((w, i) => ({ i, t: w.de }))), en = shuffle(it.board.map((w, i) => ({ i, t: short(w.en) })));
      el.innerHTML = `<p class="g-hint">Match each German word with its meaning.</p>
        <div class="g-pairs"><div>${de.map(x => `<button class="opt" data-de="${x.i}">${esc(x.t)}</button>`).join("")}</div>
        <div>${en.map(x => `<button class="opt" data-en="${x.i}">${esc(x.t)}</button>`).join("")}</div></div>`;
      let sel = null, left = it.board.length, misses = 0, missed = null;
      const mark = (b, cls) => { b.classList.add(cls); setTimeout(() => b.classList.remove(cls), 600); };
      el.querySelectorAll("[data-de]").forEach(b => b.addEventListener("click", () => {
        el.querySelectorAll("[data-de]").forEach(x => x.classList.remove("sel")); sel = b; b.classList.add("sel"); api.say(it.board[+b.dataset.de].de); }));
      el.querySelectorAll("[data-en]").forEach(b => b.addEventListener("click", () => {
        if (!sel) return;
        const i = +sel.dataset.de;
        if (+b.dataset.en === i) {
          [sel, b].forEach(x => { x.classList.remove("sel"); x.classList.add("right"); x.disabled = true; }); sel = null;
          if (--left === 0) setTimeout(() => answer(misses <= 1, missed), 700);
        } else { misses++; missed = missed || it.board[i].de; mark(b, "wrong"); mark(sel, "wrong"); }
      }));
    },
  });

  /* ---------- 6. Pick the German ---------- */
  // Wrong answers look like the right one: nouns with nouns (and their article), verbs with verbs, the rest together.
  const kind = de => /^(der|die|das) /.test(de) ? "noun" : /^(sich )?[a-zäöüß]+(en|ern|eln)$/.test(de) ? "verb" : /\s/.test(de) ? "phrase" : "other";
  W.register({
    id: "choose", name: "Pick the German", icon: "🔤", skill: "Vocabulary", unlock: null, minItems: 8,
    blurb: "An English word and four German ones. Tap the right one. The wrong ones are the same kind of word, so look closely.",
    pool: api => W.vocab(api).filter(w => w.de.length <= 30 && short(w.en).length <= 40 && !/[…]/.test(w.de)),
    round: api => 10 + 2 * api.level(),
    play(el, it, api, answer, ctx) {
      const k = kind(it.de), mine = short(it.en).toLowerCase();
      const fits = w => w !== it && w.de !== it.de && short(w.en).toLowerCase() !== mine;
      let wrong = pick(ctx.pool.filter(w => fits(w) && kind(w.de) === k), 3);
      if (wrong.length < 3) wrong = wrong.concat(pick(ctx.pool.filter(w => fits(w) && !wrong.includes(w)), 3 - wrong.length));
      const opts = shuffle([it].concat(wrong));
      el.innerHTML = `<p class="g-hint">Which German word means…</p><p class="g-q">${esc(short(it.en))}</p>
        <div class="opts">${opts.map((o, i) => `<button class="opt" data-o="${i}">${esc(o.de)}</button>`).join("")}</div>`;
      el.querySelectorAll("[data-o]").forEach(b => b.addEventListener("click", () => {
        const o = opts[+b.dataset.o], ok = o === it;
        el.querySelectorAll("[data-o]").forEach(x => { x.disabled = true; if (opts[+x.dataset.o] === it) x.classList.add("right"); });
        if (!ok) { b.classList.add("wrong"); el.insertAdjacentHTML("beforeend", `<div class="fb no">${esc(o.de)} means “${esc(short(o.en))}”.</div>`); }
        api.say(it.de);
        setTimeout(() => answer(ok, ok ? null : it.de), ok ? 900 : 2200);
      }));
    },
  });

  /* ---------- 7. Missing Word ---------- */
  // Sentences from finished lessons and from lessons at your level or below. The gap prefers a word you're
  // learning in your flashcards (hard ones first); the wrong choices share its ending and capital letter,
  // so you need the meaning and the grammar, not just the shape.
  const tokens = s => s.match(/[A-Za-zÄÖÜäöüß]+/g) || [];
  W.clozes = api => {
    const lv = api.level(), ids = new Set(api.done());
    for (const l of api.all ? api.all() : []) if (l.lvl <= lv) ids.add(l.id);
    const sents = [], seen = new Set();
    for (const id of ids) { const L = api.lesson(id);
      for (const [de, en] of L.x.concat(L.d.map(d => [d[1], d[2]]))) {
        const n = de.split(/\s+/).length;
        if (n >= 4 && n <= 14 && !/[„“"–()]/.test(de) && en && !seen.has(de)) { seen.add(de); sents.push({ de, en }); } } }
    const mine = new Map(); // your card words (bare, lower case) -> {weak, de}
    for (const w of W.vocab(api)) { const b = w.de.replace(/^(der|die|das|sich) /, "").toLowerCase();
      if (!/\s/.test(b)) { const o = mine.get(b); mine.set(b, { weak: (o && o.weak) || w.weak, de: (o && o.de) || w.de }); } }
    // wrong choices only from words in mid-sentence (a capital there means a noun) with 4+ letters
    const bank = new Set();
    for (const s of sents) for (const part of s.de.split(/[.!?:]\s+/)) tokens(part).slice(1).forEach(t => { if (t.length >= 4) bank.add(t); });
    const bankList = [...bank];
    const out = [];
    for (const s of sents) {
      const ts = tokens(s.de).filter((t, i) => t.length >= 4 && !(i === 0 && /^[A-ZÄÖÜ]/.test(t) && !mine.has(t.toLowerCase())));
      if (!ts.length) continue;
      const card = ts.filter(t => mine.has(t.toLowerCase()));
      const gap = (card.find(t => mine.get(t.toLowerCase()).weak) || card[0] || ts.sort((a, b) => b.length - a.length)[0]);
      const cap = /^[A-ZÄÖÜ]/.test(gap), end = gap.slice(-2);
      const like = bankList.filter(t => t !== gap && t.toLowerCase() !== gap.toLowerCase() && /^[A-ZÄÖÜ]/.test(t) === cap && !s.de.includes(t));
      let wrong = pick(like.filter(t => t.endsWith(end)), 3);
      if (wrong.length < 3) wrong = wrong.concat(pick(like.filter(t => !wrong.includes(t) && Math.abs(t.length - gap.length) <= 3), 3 - wrong.length));
      if (wrong.length < 3) continue;
      const m = mine.get(gap.toLowerCase());
      out.push({ de: s.de, en: s.en, gap, wrong, weak: !!(m && m.weak), card: m && m.de });
    }
    return out;
  };
  W.register({
    id: "cloze", name: "Missing Word", icon: "🕳️", skill: "Words in context", unlock: null, minItems: 6,
    blurb: "A German sentence with a gap and four words to choose from. Stuck? Tap 💡 to see the English.",
    pool: W.clozes,
    round: api => 8 + 2 * api.level(),
    play(el, it, api, answer) {
      const opts = shuffle([it.gap].concat(it.wrong));
      const i = it.de.search(new RegExp(`(^|[^A-Za-zÄÖÜäöüß])${it.gap}(?![A-Za-zÄÖÜäöüß])`));
      const at = i < 0 ? it.de.indexOf(it.gap) : i + (i === 0 && it.de.startsWith(it.gap) ? 0 : 1);
      const before = it.de.slice(0, at), after = it.de.slice(at + it.gap.length);
      el.innerHTML = `<p class="g-q">${esc(before)}<span class="g-blank">_____</span>${esc(after)}</p>
        <p class="g-hint" id="czTr" hidden>💡 ${esc(it.en)}</p>
        <div class="opts">${opts.map((o, k) => `<button class="opt" data-o="${k}">${esc(o)}</button>`).join("")}</div>
        <div class="btnrow"><button class="btn small ghost" data-hint>💡 Show the English</button></div>`;
      el.querySelector("[data-hint]").addEventListener("click", e => { el.querySelector("#czTr").hidden = false; e.target.disabled = true; });
      el.querySelectorAll("[data-o]").forEach(b => b.addEventListener("click", () => {
        const ok = opts[+b.dataset.o] === it.gap;
        el.querySelectorAll("[data-o]").forEach(x => { x.disabled = true; if (opts[+x.dataset.o] === it.gap) x.classList.add("right"); });
        if (!ok) b.classList.add("wrong");
        el.querySelector(".g-blank").textContent = it.gap; el.querySelector(".g-blank").classList.add(ok ? "ok" : "no");
        el.querySelector("#czTr").hidden = false; el.querySelector("[data-hint]").remove();
        api.say(it.de);
        setTimeout(() => answer(ok, ok ? null : it.card || it.gap), ok ? 1300 : 2800);
      }));
    },
  });

  /* ---------- 8. Recall ---------- */
  W.register({
    id: "recall", name: "Recall", icon: "✍️", skill: "Remembering words", unlock: null, minItems: 6,
    blurb: "See the meaning, type the German, with der/die/das for nouns. The hardest way to practise, and the one that makes words stick.",
    pool: api => W.vocab(api).filter(w => w.de.split(/\s+/).length <= 3 && !/[…/]/.test(w.de) && short(w.en).length <= 40),
    round: api => 8 + 2 * api.level(),
    play(el, it, api, answer, ctx) {
      const target = it.de.replace(/^der\/die /, "der "), bare = target.replace(/^(der|die|das|sich) /, "");
      // other words in your set with the same meaning count too (employee: der Arbeitnehmer, der Mitarbeiter)
      const same = W.vocab(api).filter(w => w.de !== it.de && short(w.en).toLowerCase() === short(it.en).toLowerCase()).map(w => w.de.replace(/^der\/die /, "der "));
      const isNoun = /^(der|die|das) /.test(target);
      let hints = api.level() >= 2 ? 0 : 1;
      const hintText = () => hints === 0 ? "" : bare.split("").map((ch, i) => i < hints || ch === " " ? ch : "·").join("");
      el.innerHTML = `<p class="g-q">${esc(short(it.en))}</p><p class="g-hint" id="rcHint">${isNoun ? "der / die / das + noun" : ""}${hints ? " · " + esc(hintText()) : ""}</p>
        <div class="btnrow"><input class="field" id="rcIn" autocomplete="off" autocapitalize="off" spellcheck="false" style="flex:1 1 200px" placeholder="German"><button class="btn primary" data-go>Check</button></div>
        <div class="btnrow"><button class="btn small ghost" data-more>Show a letter</button></div><div id="rcFb"></div>`;
      const inp = el.querySelector("#rcIn"); inp.focus();
      el.querySelector("[data-more]").addEventListener("click", () => { hints = Math.min(bare.length, hints + 1);
        el.querySelector("#rcHint").textContent = (isNoun ? "der / die / das + noun · " : "") + hintText(); inp.focus(); });
      let done = false;
      const check = () => {
        if (done || !inp.value.trim()) return; done = true;
        const got = fold(inp.value), want = fold(target);
        const alt = same.find(w => fold(w) === got || (!/^(der|die|das) /.test(w) && fold(w.replace(/^sich /, "")) === got));
        const ok = !!alt || got === want || (!isNoun && got === fold(bare)) || (/^der\/die /.test(it.de) && got === fold("die " + bare));
        const noArticle = isNoun && got === fold(bare);
        el.querySelector("#rcFb").innerHTML = `<div class="fb ${ok ? "ok" : "no"}">${ok ? "Richtig! " : noArticle ? "Almost: don't forget the article. " : ""}${alt ? `${esc(alt)} is right too. This card was ` : ""}<b>${esc(it.full.replace(/\s*\(.*?\)/g, ""))}</b></div>`;
        inp.disabled = true; api.say(target);
        setTimeout(() => answer(ok, ok ? null : it.de), ok ? 1100 : 2600);
      };
      el.querySelector("[data-go]").addEventListener("click", check);
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); check(); } });
    },
  });
})();
