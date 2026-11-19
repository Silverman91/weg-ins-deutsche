"""Where the audio pipeline keeps its files.

The scripts live in the app repo (german-offline/tools/tts). Bulky working data (the Python venv, downloaded
Lingua Libre recordings, voice samples, caches, temp files, lines.json) stays in a separate work folder that is
not committed: by default the `tts` folder next to the repo, or set WID_WORK / "work" in local.json.

Machine-specific programs go in local.json next to this file (not committed), for example:
  {"llama_server": "C:/path/to/llama-server.exe", "whisper_python": "C:/path/to/python.exe"}
"""
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parents[1]                       # german-offline/
_local = HERE / "local.json"
LOCAL = json.loads(_local.read_text(encoding="utf-8")) if _local.exists() else {}
WORK = Path(os.environ.get("WID_WORK") or LOCAL.get("work") or APP.parent / "tts")
LLAMA_SERVER = Path(os.environ.get("WID_LLAMA_SERVER") or LOCAL.get("llama_server") or "llama-server")
WHISPER_PY = os.environ.get("WID_WHISPER_PY") or LOCAL.get("whisper_python") or "python"
