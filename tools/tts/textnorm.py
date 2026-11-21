"""Make German text easy for Greta to read: what the speech model gets instead of the text on screen.

The clip is still filed under the original text (the app looks clips up by what it shows); only the words sent to
the speech model change:
  numbers        "120 Euro" -> "hundertzwanzig Euro", "1990" -> "neunzehnhundertneunzig"
  money, times   "3,50 €" -> "drei Euro fünfzig", "10:12" -> "zehn Uhr zwölf"
  abbreviations  "z. B." -> "zum Beispiel", "ca." -> "circa", "usw." -> "und so weiter"
  acronyms       "ICE" -> "I-Ze-E" (spelled with German letter names), unless they're said as a word (NATO)
  symbols        "a → ä" -> "a wird zu ä", "+" -> "plus", "=" -> "gleich", "%" -> "Prozent"
  gaps, notes    "Ich … Tom." -> "Ich, Tom.", "grad (gerade)" -> "grad, gerade"
  lexicon        words the model mispronounces, respelled (lexicon.json next to this file: {"Workshop": "Wörkschopp"})
Run this file to see the test cases.
"""
import json
import re
from pathlib import Path

ONES = "null eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf dreizehn vierzehn fünfzehn sechzehn siebzehn achtzehn neunzehn".split()
TENS = "_ _ zwanzig dreißig vierzig fünfzig sechzig siebzig achtzig neunzig".split()


def num_de(n):
    """Cardinal number in German words, 0 to 999,999,999."""
    if n < 20:
        return ONES[n]
    if n < 100:
        t, o = divmod(n, 10)
        return TENS[t] if not o else ("ein" if o == 1 else ONES[o]) + "und" + TENS[t]
    if n < 1000:
        h, r = divmod(n, 100)
        return ("" if h == 1 else ONES[h]) + "hundert" + (num_de(r) if r else "")   # said "hundertzwanzig"
    if n < 1_000_000:
        k, r = divmod(n, 1000)
        return ("" if k == 1 else num_de(k)) + "tausend" + (num_de(r) if r else "")  # said "tausendfünfhundert"
    m, r = divmod(n, 1_000_000)
    return ("eine Million" if m == 1 else num_de(m) + " Millionen") + (" " + num_de(r) if r else "")


def year_de(n):
    """1100-1999 are said as hundreds: 1990 -> neunzehnhundertneunzig."""
    h, r = divmod(n, 100)
    return num_de(h) + "hundert" + (num_de(r) if r else "")


ABBR = [(r"\bz\.\s?B\.", "zum Beispiel"), (r"\bd\.\s?h\.", "das heißt"), (r"\bu\.\s?a\.", "unter anderem"),
        (r"\bca\.", "circa"), (r"\busw\.", "und so weiter"), (r"\bbzw\.", "beziehungsweise"), (r"\bvgl\.", "vergleiche"),
        (r"\bggf\.", "gegebenenfalls"), (r"\betc\.", "et cetera"), (r"\bNr\.", "Nummer"), (r"\bDr\.", "Doktor"),
        (r"\bbspw\.", "beispielsweise"), (r"\binkl\.", "inklusive"), (r"\bzzgl\.", "zuzüglich"), (r"\bMio\.", "Millionen")]
LETTERS = dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ", "A Be Ze De E Eff Ge Ha I Jott Ka Ell Emm Enn O Pe Ku Err Ess Te U Vau We Iks Üpsilon Zett Ä Ö Ü".split()))
SAID_AS_WORD = {"NATO", "UNO", "TÜV", "AIDS", "UNESCO", "UEFA", "FIFA", "DAX", "ADAC", "BAföG", "OK", "ZDF"}  # ZDF is letters but common; spelled anyway below
SAID_AS_WORD.discard("ZDF")
_LEX = None


def lexicon():
    global _LEX
    if _LEX is None:
        p = Path(__file__).with_name("lexicon.json")
        _LEX = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    return _LEX


def normalize(t):
    t = str(t)
    for pat, rep in ABBR:
        t = re.sub(pat, rep, t)
    # money: 3,50 € / 3,50 Euro -> drei Euro fünfzig; 8 € -> acht Euro
    t = re.sub(r"(\d+),(\d{2})\s?(€|Euro)", lambda m: f"{num_de(int(m[1]))} Euro" + (f" {num_de(int(m[2]))}" if int(m[2]) else ""), t)
    t = re.sub(r"(\d+)\s?€", lambda m: f"{num_de(int(m[1]))} Euro", t)
    # clock times: 10:12 -> zehn Uhr zwölf; 9:00 -> neun Uhr
    t = re.sub(r"\b(\d{1,2}):(\d{2})\b(?:\s?Uhr\b)?", lambda m: f"{num_de(int(m[1]))} Uhr" + (f" {num_de(int(m[2]))}" if int(m[2]) else ""), t)
    # decimals: 2,5 -> zwei Komma fünf
    t = re.sub(r"\b(\d+),(\d+)\b", lambda m: f"{num_de(int(m[1]))} Komma " + " ".join(ONES[int(d)] for d in m[2]), t)
    # years and plain numbers (thousands separators 1.000 are read as one number)
    t = re.sub(r"\b(1[1-9]\d\d)\b(?!\s?(Euro|Meter|Kilo|Leute|Menschen))", lambda m: year_de(int(m[1])), t)
    t = re.sub(r"\b\d{1,3}(?:\.\d{3})+\b|\b\d+\b", lambda m: num_de(int(m[0].replace(".", ""))), t)
    t = t.replace("%", " Prozent")
    # symbols in grammar notes
    t = re.sub(r"\s*→\s*", " wird zu ", t)
    t = re.sub(r"\s\+\s", " plus ", t)
    t = re.sub(r"\s=\s?", " gleich ", t)
    t = t.replace(" & ", " und ")
    # acronyms: spell with German letter names (ICE -> I-Ze-E)
    t = re.sub(r"\b[A-ZÄÖÜ]{2,5}\b", lambda m: m[0] if m[0] in SAID_AS_WORD else "-".join(LETTERS.get(c, c) for c in m[0]), t)
    # notes in brackets become a short aside; gaps become a pause
    t = re.sub(r"\s*\(([^()]*)\)", lambda m: ", " + m[1] if m[1].strip() else "", t)
    t = re.sub(r"\s*(…|\.\.\.)\s*", ", ", t)
    # lexicon: whole words only
    for w, rep in lexicon().items():
        t = re.sub(rf"(?<![\wäöüß]){re.escape(w)}(?![\wäöüß])", rep, t)
    t = re.sub(r"\s*,\s*(,\s*)+", ", ", t)            # ", , " -> ", "
    t = re.sub(r"^\s*,\s*|\s*,\s*(?=[.!?]|$)", "", t)  # no comma at the start or before the end
    t = re.sub(r",\s*\.", ".", t)
    return re.sub(r"\s{2,}", " ", t).strip()


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    for s in ["Die Lampe kostet 30 Euro.", "Der Tisch ist neu. Er kostet 120 Euro.", "3,50 €", "Das macht 8,40 €., Neun Euro, bitte.",
              "Abfahrt um 10:12 von Gleis 4.", "Ich bin 1990 geboren.", "Das sind 1.500 Leute.", "z. B. ein Apfel, usw.",
              "Der ICE ist der Zug, der … fährt.", "LG liebe Grüße", "a → ä fahren", "zu + dem =", "Ich … Tom.",
              "grad (gerade)", "Wir wollen … (kaufen) ein Auto", "Die NATO tagt.", "Es sind 25 % mehr.", "Um 9:00 Uhr? Nein, 21:30."]:
        print(f"{s!r:45} -> {normalize(s)!r}")
