/* Weg ins Deutsche — memory tips for flashcards.
 * WID_memoryTips(de, en) returns up to three short tips for remembering a word, worked out from the word itself:
 * gender clues from the ending, the plural spelled out, how a compound is built from words in the app,
 * how a prefix verb behaves, false friends and English look-alikes.
 * Needs core-words.js, level-words.js and the lessons loaded first (for the compound parts).
 */
(function () {
  "use strict";
  const ART = /^(der|die|das)\s+/;
  let INDEX = null, VERBS = null; // nouns: bare noun (lower case) -> [with article, English]; VERBS: infinitives
  function index() {
    if (INDEX) return INDEX;
    INDEX = new Map(); VERBS = new Set();
    const add = (de, en) => {
      const w = String(de).replace(/,\s*-.*$/, "").replace(/\s*\(.*?\)/g, "").trim();
      const m = w.match(/^(der|die|das)\s+([A-ZÄÖÜ][\wäöüß-]+)$/);
      if (m) { const k = m[2].toLowerCase(); if (k.length >= 3 && !INDEX.has(k)) INDEX.set(k, [w, String(en).split(/[;,(]/)[0].trim()]); }
      else if (/^[a-zäöüß]+(en|ern|eln)$/.test(w)) VERBS.add(w);
    };
    for (const w of window.CORE_WORDS || []) add(w[0], w[1]);
    for (const ws of Object.values(window.LEVEL_WORDS || {})) for (const w of ws) add(w[0], w[1]);
    for (const L of Object.values(window.LESSONS || {})) for (const v of L.v || []) add(v[0], v[1]);
    return INDEX;
  }

  // Endings that give the gender away. strong = almost no exceptions, so a mismatch is worth pointing out.
  const GENDER = [
    [/(ung)$/, "die", "-ung", true], [/(heit|keit)$/, "die", "-heit and -keit", true], [/(schaft)$/, "die", "-schaft", true],
    [/(ion)$/, "die", "-ion", true], [/(tät)$/, "die", "-tät", true], [/(ik)$/, "die", "-ik", false], [/(ie)$/, "die", "-ie", false],
    [/(ei)$/, "die", "-ei", false], [/(ur)$/, "die", "-ur", false], [/(enz|anz)$/, "die", "-enz and -anz", false],
    [/(chen|lein)$/, "das", "-chen and -lein (small things)", true], [/(ment)$/, "das", "-ment", false], [/(um)$/, "das", "-um", false],
    [/(ling)$/, "der", "-ling", true], [/(ismus)$/, "der", "-ismus", true], [/(ist)$/, "der", "-ist", false],
    [/(or)$/, "der", "-or", false], [/(ig|ich)$/, "der", "-ig and -ich", false], [/(eur|är)$/, "der", "-eur and -är", false],
  ];
  const UML = { a: "ä", o: "ö", u: "ü", au: "äu", A: "Ä", O: "Ö", U: "Ü", Au: "Äu" };
  const umlaut = w => w.replace(/(au|Au|a|o|u|A|O|U)(?=[^aeiouäöüAEIOUÄÖÜ]*(e[lnr]?)?$)/, m => UML[m] || m);

  const FALSE_FRIENDS = {
    bekommen: "get, receive (not become: that's werden)", gift: "poison (a gift is ein Geschenk)", chef: "boss (a cook is ein Koch)",
    eventuell: "possibly (not eventually: that's schließlich)", aktuell: "current (not actual: that's tatsächlich)",
    sensibel: "sensitive (sensible is vernünftig)", also: "so, therefore (also is auch)", handy: "mobile phone",
    rat: "advice (a rat is eine Ratte)", art: "kind, type (art is Kunst)", fabrik: "factory (fabric is Stoff)",
    kritik: "criticism; review", mist: "rubbish, dung (mist is Nebel)", konsequent: "consistent (consequently is folglich)",
    sympathisch: "likeable (sympathetic is mitfühlend)", engagiert: "committed (engaged is verlobt)", wer: "who (where is wo)",
    wo: "where (who is wer)", will: "wants (will is werden)", brav: "well-behaved (brave is mutig)", hell: "bright (hell is Hölle)",
    see: "lake or sea (to see is sehen)", meinung: "opinion", bad: "bath, bathroom (bad is schlecht)", oft: "often",
    spenden: "to donate (to spend money is ausgeben)", irritiert: "confused (irritated is genervt)", genial: "brilliant (genial is freundlich)",
    menü: "set meal (the menu is die Speisekarte)", kaution: "deposit, bail (caution is Vorsicht)", rente: "pension (rent is Miete)",
  };
  const SEP = ["zurück", "zusammen", "weiter", "vorbei", "herein", "heraus", "hinaus", "fest", "fern", "fort", "frei", "heim", "los",
    "mit", "nach", "vor", "weg", "zu", "ab", "an", "auf", "aus", "bei", "ein", "her", "hin", "um", "dar", "statt", "teil"];
  const INSEP = { zer: "zer- means 'to pieces': zerbrechen, zerreißen", ent: "ent- often means 'away' or 'un-': entkommen, entfernen",
    miss: "miss- means 'wrongly': missverstehen", emp: "emp- is a form of ent-", er: "er- often means getting a result: erreichen, erfinden",
    ver: "ver- often means 'wrongly' or 'away': verlaufen, verschlafen, verkaufen", be: "be- makes a verb take a direct object: beantworten",
    ge: "ge- is part of the verb here" };

  const dice = (a, b) => { // letter-pair similarity, 0..1
    const pairs = s => { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; };
    const A = pairs(a), B = pairs(b); if (!A.length || !B.length) return 0;
    let hit = 0; const bb = B.slice(); for (const p of A) { const i = bb.indexOf(p); if (i >= 0) { hit++; bb.splice(i, 1); } }
    return 2 * hit / (A.length + B.length);
  };
  const toEnglishLooks = s => s.toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss")
    .replace(/^z/, "c").replace(/k/g, "c").replace(/z/g, "c").replace(/ph/g, "f").replace(/sch/g, "sh");

  // splits that would find real words but the wrong ones (Schrift + Teller "plate", Nähe "nearness" + Maschine)
  const NO_SPLIT = new Set(["schriftsteller", "nähmaschine", "bürgersteig", "abendbrot", "handtuch", "beispiel", "unterricht"]);
  function compound(noun) { // "Gebrauchsanweisung" -> [["der Gebrauch","use"],["die Anweisung","instruction"]]
    const idx = index(), low = noun.toLowerCase();
    if (low.length < 7 || NO_SPLIT.has(low)) return null;
    for (let i = 3; i <= low.length - 3; i++) {
      const right = idx.get(low.slice(i));
      if (!right) continue;
      const left = low.slice(0, i);
      // linking letters: Arbeit-s-platz, Blume-n-topf, Kind-er-garten; or a verb stem: Kühl-schrank (kühlen)
      for (const l of [left, left.replace(/s$/, ""), left.replace(/n$/, ""), left.replace(/en$/, ""), left.replace(/es$/, ""), left.replace(/er$/, ""), left + "e"]) {
        const L = l !== low && l.length >= 3 && idx.get(l);
        if (L) return [L, right];
      }
      for (const v of [left + "en", left + "n", left.replace(/e$/, "") + "en"]) if (VERBS.has(v)) return [[v, "verb"], right];
    }
    return null;
  }

  window.WID_memoryTips = function (de, en) {
    const tips = [], full = String(de).trim();
    const word = full.replace(/,\s*-.*$/, "").replace(/\s*\(.*?\)/g, "").trim();
    const m = word.match(/^(der|die|das)\s+([A-ZÄÖÜ][\wäöüß-]+)$/);
    const ff = FALSE_FRIENDS[word.replace(ART, "").toLowerCase()];
    if (ff) tips.push(`⚠️ False friend: it means ${ff}.`);
    if (m) {
      const [, art, noun] = m, low = noun.toLowerCase();
      // gender clue
      const rule = GENDER.find(r => r[0].test(low));
      const parts = compound(noun);
      if (rule && rule[1] === art) tips.push(`Nouns ending in ${rule[2]} are ${rule[3] ? "always" : "usually"} ${art}.`);
      else if (rule && rule[3]) tips.push(`Careful: nouns ending in ${rule[2]} are normally ${rule[1]}, but this one is ${art}.`);
      else if (/e$/.test(low) && art === "die") tips.push("Most nouns ending in -e are die.");
      else if (/e$/.test(low) && art === "der") tips.push("Most nouns ending in -e are die, but male people and animals are der (der Kunde, der Löwe).");
      else if (/^ge/.test(low) && art === "das" && !parts) tips.push("Many nouns starting with Ge- are das: das Gespräch, das Gebäude.");
      else if (art === "das" && (index(), VERBS.has(low))) tips.push("A verb used as a noun is always das: das Essen, das Leben.");
      // compound
      if (parts) tips.push(`Built from ${parts[0][0]}${parts[0][1] === "verb" ? "" : ` (${parts[0][1]})`} + ${parts[1][0]} (${parts[1][1]}). The last part decides the gender.`);
      // plural spelled out
      const pl = (full.match(/,\s*(-.*)$/) || [])[1];
      if (pl && !/\(pl/.test(full)) {
        const end = pl.replace(/^-/, "").trim();
        const form = end === "" ? noun : /^¨/.test(end) ? umlaut(noun) + end.slice(1) : /^[a-zäöü]+$/.test(end) ? noun + end : null;
        if (form && form !== noun) tips.push(`Plural: die ${form}.`);
        else if (form === noun) tips.push(`The plural looks the same: die ${noun}.`);
      }
    } else if (/^(sich\s+)?[a-zäöüß]+(en|ern|eln)$/.test(word) && !/\s/.test(word.replace(/^sich\s+/, ""))) {
      const verb = word.replace(/^sich\s+/, "");
      const sep = SEP.find(p => verb.startsWith(p) && verb.length - p.length >= 4);
      const insep = Object.keys(INSEP).find(p => verb.startsWith(p) && verb.length - p.length >= 4);
      if (sep) tips.push(`Separable verb (${sep}|${verb.slice(sep.length)}): in a sentence, ${sep}- jumps to the end, and the past participle has ge- in the middle.`);
      else if (insep && insep !== "ge") tips.push(`${INSEP[insep]}. Inseparable: no ge- in the past participle.`);
      if (/^sich /.test(word)) tips.push("Reflexive: say it with sich / mich / dich (ich freue mich).");
    }
    // looks like English
    if (tips.length < 3 && !ff) {
      const bare = word.replace(ART, "").toLowerCase(), g = toEnglishLooks(bare);
      const hit = String(en).toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4).find(w => dice(g, w) >= 0.7);
      if (hit && bare.length >= 4) tips.push(`Looks like English “${hit}”: an easy one to remember.`);
    }
    return tips.slice(0, 3);
  };
})();
