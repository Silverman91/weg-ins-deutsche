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
 */
(function () {
  "use strict";
  const games = [];
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a, n) => shuffle(a).slice(0, n);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const W = window.WIDGames = { register: g => games.push(g), list: () => games, shuffle, pick, esc };

  /* ---------- shared content builders (used by several games) ---------- */
  W.nouns = api => {               // [{art, noun, en, say}] from vocabulary with der/die/das
    const out = [], seen = new Set();
    for (const id of api.done()) for (const v of api.lesson(id).v) {
      if (/\(pl\.\)/.test(v[0])) continue;
      const parts = v[0].replace(/,\s*-.*$/, "").split(/\s*\/\s*/), ens = String(v[1]).split(/\s*\/\s*/);
      parts.forEach((p, k) => { const m = p.trim().match(/^(der|die|das)\s+([A-ZÄÖÜ][\wäöüß-]*)$/);
        if (m && !seen.has(m[2])) { seen.add(m[2]); out.push({ art: m[1], noun: m[2], en: ens[k] || ens[0], say: `${m[1]} ${m[2]}` }); } });
    }
    return out;
  };
  W.vocab = api => {                // [{de, en}] all vocabulary from finished lessons
    const out = [], seen = new Set();
    for (const id of api.done()) for (const v of api.lesson(id).v) { const de = api.cleanWord(v[0]); if (!seen.has(de)) { seen.add(de); out.push({ de, en: v[1] }); } }
    return out;
  };
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
    id: "dash", name: "Der-Die-Das Dash", icon: "🎯", skill: "Noun genders", unlock: "a1-02", minItems: 6,
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
    id: "listen", name: "Listen & Tap", icon: "👂", skill: "Listening", unlock: "a0-2", minItems: 6,
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
})();
