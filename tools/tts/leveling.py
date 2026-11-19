"""Loudness matching shared by all clips."""
import numpy as np

SR = 24000


def level(w, target_db=-20.0):
    """Match loudness: scale to a fixed RMS over the voiced part, add 8 ms fades."""
    voiced = w[np.abs(w) > 0.02]
    rms = np.sqrt(np.mean(voiced ** 2)) if len(voiced) else 1e-4
    w = w * (10 ** (target_db / 20) / max(rms, 1e-4))
    f = int(0.008 * SR)
    if len(w) > 2 * f:
        w[:f] *= np.linspace(0, 1, f)
        w[-f:] *= np.linspace(1, 0, f)
    return np.clip(w, -0.98, 0.98).astype(np.float32)
