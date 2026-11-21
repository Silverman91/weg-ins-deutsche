"""English and German speech for the German course, on the GPU.

Reuses the approach of an earlier Arabic TTS project: the speech model is a GGUF language model run by
llama.cpp's Vulkan llama-server on the RX 5700 XT, and NeuCodec turns its speech tokens into audio on the CPU.
The models are Neuphonic's NeuTTS family, the same design Audar-TTS is built on:
  en2e   neutts-2e        English, 4 fixed speakers, emotions (BPE text input)
  enair  neutts-air       English, voice cloning from a short clip (phoneme input)
  de     neutts-nano-german  German, voice cloning (phoneme input)
Only one model runs at a time (same rule as the Arabic agent): use one Engine, close it, then the next.
"""
import atexit
import hashlib
import os
import re
import subprocess
import time
import unicodedata
from pathlib import Path

import numpy as np
import requests
import soundfile as sf
import torch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import WORK, LLAMA_SERVER  # noqa: E402
from textnorm import normalize as de_normalize  # noqa: E402
ROOT = WORK
SERVER_EXE = LLAMA_SERVER
SAMPLES = ROOT / "neutts-src" / "samples"
CACHE = ROOT / "cache"
CACHE_VERSION = "2"  # 2: German text cleaned up by textnorm.py before speaking

MODELS = {
    "en2e": ("neuphonic/neutts-2e-q8-gguf", "neutts-2e-Q8_0.gguf", "bpe", None),
    "enair": ("neuphonic/neutts-air-q8-gguf", "neutts-air-Q8_0.gguf", "phonemes", "en-us"),
    "de": ("neuphonic/neutts-nano-german-q8-gguf", "neutts-nano-german-Q8_0.gguf", "phonemes", "de"),
}
# Language each reference clip is spoken in, so its transcript is phonemised correctly even when a
# German model clones an English speaker (e.g. Emily speaking German).
REF_LANG = {"emily": "en", "paul": "en", "sophie": "en", "steven": "en", "dave": "en", "jo": "en", "greta": "de", "greta_q": "de", "greta_x": "de"}
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "„": '"'})


def norm_text(t):
    t = unicodedata.normalize("NFKC", str(t).translate(_QUOTES))
    # Double quotes and dashes are not spoken, and the speech model turns them into stray syllables
    # ("gesagt: Tat Jonas"): drop the quotes, and make a dash between words a short pause.
    t = t.replace('"', "")
    # Emojis are read out by name ("Gesicht mit lachenden Augen"): drop them and their joiners/variants.
    t = "".join(ch for ch in t if unicodedata.category(ch) not in ("So", "Cs")
                and ord(ch) not in (0x200D, 0xFE0F) and not 0x1F3FB <= ord(ch) <= 0x1F3FF)  # joiner, variant, skin tones
    t = re.sub(r"(?<=[.,!?:;])\s+[–—]\s+", " ", t)
    t = re.sub(r"\s+[–—]\s+", ", ", t)
    return re.sub(r"\s{2,}", " ", t).strip()


class Engine:
    def __init__(self, model, port=8767, slots=1):
        from huggingface_hub import hf_hub_download
        from neucodec import NeuCodec

        self.model = model
        self.slots = slots
        repo, fname, self.fmt, lang = MODELS[model]
        self.url = f"http://127.0.0.1:{port}"
        gguf = hf_hub_download(repo, fname)
        if self._alive():
            raise RuntimeError(f"Something is already running on port {port}")
        log = open(ROOT / f"llama-server-{model}.log", "w", encoding="utf-8")
        self.proc = subprocess.Popen(
            # `slots` requests run at once (llama.cpp splits the context between them: 4096 tokens each)
            [str(SERVER_EXE), "-m", gguf, "-ngl", "99", "-c", str(4096 * slots), "--host", "127.0.0.1", "--port", str(port), "-np", str(slots)],
            stdout=log, stderr=subprocess.STDOUT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        atexit.register(self.close)
        t = time.time()
        while not self._alive():
            if self.proc.poll() is not None:
                raise RuntimeError(f"llama-server exited; see llama-server-{model}.log")
            if time.time() - t > 300:
                raise TimeoutError("llama-server did not start in 5 min")
            time.sleep(1)
        ids = self._tokenize("<|speech_0|><|speech_1|><|speech_65535|>")
        if len(ids) != 3 or ids[1] != ids[0] + 1 or ids[2] != ids[0] + 65535:
            raise RuntimeError(f"Unexpected speech token ids: {ids}")
        self.speech0 = ids[0]
        self.codec = NeuCodec.from_pretrained("neuphonic/neucodec").eval()
        self.phon, self._lang, self._extra = None, {"en-us": "en", "de": "de"}.get(lang), {}
        if self.fmt == "phonemes":
            from neutts.phonemizers import BasePhonemizer, CUSTOM_PHONEMIZERS
            self.phon = CUSTOM_PHONEMIZERS[lang]() if lang in CUSTOM_PHONEMIZERS else BasePhonemizer(language_code=lang)
        self._refs = {}

    def _alive(self):
        try:
            return requests.get(self.url + "/health", timeout=2).status_code == 200
        except requests.RequestException:
            return False

    def _tokenize(self, text):
        r = requests.post(self.url + "/tokenize", json={"content": text, "add_special": False, "parse_special": True}, timeout=60)
        r.raise_for_status()
        return [t if isinstance(t, int) else t["id"] for t in r.json()["tokens"]]

    def close(self):
        if getattr(self, "proc", None) and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    # ---- references ----
    def ref(self, name):
        """A reference voice: neutts-src/samples/<name>.pt (pre-encoded) or .wav, plus <name>.txt."""
        if name not in self._refs:
            txt = (SAMPLES / f"{name}.txt").read_text(encoding="utf-8").strip()
            pt = SAMPLES / f"{name}.pt"
            if pt.exists():
                codes = torch.load(pt).flatten().tolist()
            else:
                import librosa
                wav, _ = librosa.load(SAMPLES / f"{name}.wav", sr=16000, mono=True)
                with torch.no_grad():
                    codes = self.codec.encode_code(torch.from_numpy(wav).float()[None, None, :]).flatten().tolist()
            self._refs[name] = ([int(c) for c in codes], txt)
        return self._refs[name]

    def _phones(self, text, lang=None):
        """Phonemes for text. `text` may also be a list of (lang, text) parts, e.g. [("en", "Lesson four."),
        ("de", "haben")], so an English voice can say German words with German pronunciation (phoneme models)."""
        if isinstance(text, (list, tuple)):
            return " ".join(self._phones(t, l) for l, t in text)
        p = self.phon if not lang or lang == self._lang else self._other(lang)
        return " ".join(p.phonemize([text])[0].split())

    def _other(self, lang):
        from neutts.phonemizers import BasePhonemizer, CUSTOM_PHONEMIZERS
        code = {"de": "de", "en": "en-us"}[lang]
        if code not in self._extra:
            self._extra[code] = CUSTOM_PHONEMIZERS[code]() if code in CUSTOM_PHONEMIZERS else BasePhonemizer(language_code=code)
        return self._extra[code]

    def _prompt(self, text, ref_name, emotion):
        codes, ref_text = self.ref(ref_name)
        codes_str = "".join(f"<|speech_{c}|>" for c in codes)
        if self.fmt == "phonemes":
            ref_ph = self._phones(ref_text, REF_LANG.get(ref_name))
            return (f"user: Convert the text to speech:<|TEXT_PROMPT_START|>{ref_ph} {self._phones(text)}"
                    f"<|TEXT_PROMPT_END|>\nassistant:<|SPEECH_GENERATION_START|>{codes_str}")
        mid = "" if not emotion or emotion == "neutral" else f"<|{emotion.upper()}|>"
        sep = " " if not mid else ""
        return f"<|TEXT_PROMPT_START|>{norm_text(ref_text)}{sep}{mid}{norm_text(text)}<|TEXT_PROMPT_END|><|SPEECH_GENERATION_START|>{codes_str}"

    # ---- generation ----
    def say(self, text, ref_name, emotion=None, seed=1, temperature=1.0, top_k=50, tries=3):
        """Returns 24 kHz mono float32 audio. Retries with another seed if the length looks wrong.
        `text` is a string, or for phoneme models a list of (lang, text) parts."""
        text = [(l, norm_text(t)) for l, t in text] if isinstance(text, (list, tuple)) else norm_text(text)
        # German text: numbers, money, times, abbreviations, acronyms, symbols and the lexicon in words (textnorm.py)
        if isinstance(text, list):
            text = [(l, de_normalize(t) if l == "de" else t) for l, t in text]
        elif self._lang == "de":
            text = de_normalize(text)
        plain =" ".join(t for _, t in text) if isinstance(text, list) else text
        expect = max(0.6, len(plain) * 0.065)         # rough seconds for this text
        best = None
        for k in range(tries):
            prompt = self._tokenize(self._prompt(text, ref_name, emotion))
            r = requests.post(self.url + "/completion", timeout=900, json={
                "prompt": prompt, "n_predict": int(min(1500, expect * 50 * 3 + 100)), "temperature": temperature,
                "top_k": top_k, "top_p": 1.0, "seed": seed + 1000 * k, "cache_prompt": True, "return_tokens": True,
                "stop": ["<|SPEECH_GENERATION_END|>"], "samplers": ["top_k", "temperature"]})
            r.raise_for_status()
            codes = [t - self.speech0 for t in r.json().get("tokens", []) if 0 <= t - self.speech0 < 65536]
            if not codes:
                continue
            with torch.no_grad():
                wav = self.codec.decode_code(torch.tensor(codes, dtype=torch.long)[None, None, :]).cpu().numpy()[0, 0]
            dur = len(wav) / 24000
            ok = 0.35 * expect <= dur <= 2.6 * expect + 1.0
            if best is None or ok:
                best = wav
            if ok:
                break
        if best is None:
            raise RuntimeError(f"No speech generated for: {plain}")
        return best.astype(np.float32)

    def save(self, text, ref_name, out, emotion=None, seed=1, fmt="ogg"):
        """Generate (or reuse from cache) and write `out` as .ogg (Opus) or .wav."""
        tkey = repr([(l, norm_text(t)) for l, t in text]) if isinstance(text, (list, tuple)) else norm_text(text)
        key = hashlib.sha1(f"{CACHE_VERSION}|{self.model}|{ref_name}|{emotion}|{seed}|{tkey}".encode()).hexdigest()[:20]
        CACHE.mkdir(exist_ok=True)
        cached = CACHE / f"{key}.wav"
        if not cached.exists():
            wav = trim(self.say(text, ref_name, emotion, seed))
            sf.write(cached, wav, 24000)
        encode(cached, Path(out), fmt)
        return Path(out)


def trim(wav, thresh=0.01, pad=0.08):
    """Cut leading/trailing silence, keep a little padding."""
    idx = np.where(np.abs(wav) > thresh)[0]
    if not len(idx):
        return wav
    a = max(0, idx[0] - int(pad * 24000))
    b = min(len(wav), idx[-1] + int(pad * 24000))
    return wav[a:b]


def encode(src, out, fmt="ogg"):
    out.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "wav":
        out.write_bytes(Path(src).read_bytes())
        return
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    args = [ff, "-y", "-loglevel", "error", "-i", str(src), "-ac", "1"]
    args += ["-c:a", "libopus", "-b:a", "32k", "-application", "voip"] if fmt == "ogg" else ["-c:a", "libmp3lame", "-b:a", "48k"]
    subprocess.run(args + [str(out)], check=True)
