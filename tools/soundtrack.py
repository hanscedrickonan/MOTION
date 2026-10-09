"""Bande-son originale, synthétisée et déterministe.

120 BPM, la mineur. Les repères (cues) des effets sonores sont lus dans
src/timeline.json : l'image et le son partagent la même grille.

    python3 tools/soundtrack.py out/soundtrack.wav
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
TL = json.loads((ROOT / "src/timeline.json").read_text())
SR = 48000
DUR = TL["duration"]
BEAT = 60.0 / TL["bpm"]
N = int(SR * DUR)
rng = np.random.default_rng(2026)

L = np.zeros(N)
R = np.zeros(N)
send = np.zeros(N)  # envoi vers la réverbération


def t_axis(d):
    return np.arange(int(d * SR)) / SR


def place(sig, t, gain=1.0, pan=0.0, rev=0.0):
    i = int(round(t * SR))
    if i >= N:
        return
    s = sig[: N - i] * gain
    gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[i : i + len(s)] += s * gl * 1.414
    R[i : i + len(s)] += s * gr * 1.414
    send[i : i + len(s)] += s * rev


def lowpass(x, fc):
    """Passe-bas un pôle (fc scalaire ou tableau), appliqué par boucle."""
    fc = np.broadcast_to(np.asarray(fc, float), x.shape)
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def highpass(x, fc):
    return x - lowpass(x, fc)


def noise(d):
    return rng.standard_normal(int(d * SR))


# ------------------------------------------------------------- instruments

def kick(d=0.45):
    t = t_axis(d)
    f = 48 + 110 * np.exp(-t * 32)
    ph = 2 * np.pi * np.cumsum(f) / SR
    click = np.exp(-t * 400) * 0.5
    return (np.sin(ph) * np.exp(-t * 7.5) + click) * 0.95


def hat(d=0.06, open_=False):
    d = 0.22 if open_ else d
    t = t_axis(d)
    return highpass(noise(d), 7000) * np.exp(-t * (14 if open_ else 70)) * 0.35


def clap():
    d = 0.25
    t = t_axis(d)
    n = highpass(lowpass(noise(d), 3500), 900)
    env = np.exp(-t * 22)
    for k in (0.0, 0.011, 0.022):
        env += np.where(t >= k, np.exp(-(t - k) * 180), 0) * 0.6
    return n * env * 0.45


def perc(f0=320, f1=170, d=0.35):
    """Percussion type djembé : corps accordé + claque de peau."""
    t = t_axis(d)
    f = f1 + (f0 - f1) * np.exp(-t * 30)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 11)
    slap = highpass(noise(d), 1800) * np.exp(-t * 60) * 0.5
    return (body + slap) * 0.7


def bass_note(freq, d):
    t = t_axis(d)
    env = np.minimum(1, t / 0.005) * np.exp(-t * 5)
    x = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(4 * np.pi * freq * t) + 0.1 * np.tanh(3 * np.sin(2 * np.pi * freq * t))
    return x * env * 0.5


def pad(freqs, d):
    t = t_axis(d)
    x = np.zeros_like(t)
    for k, f in enumerate(freqs):
        det = 1 + 0.003 * (k % 2 * 2 - 1)
        for h, a in ((1, 1), (2, 0.35), (3, 0.15)):
            x += a * np.sin(2 * np.pi * f * det * h * t + k)
    env = np.minimum(1, t / 0.6) * np.minimum(1, (d - t) / 0.4)
    return x * env * 0.035


# ------------------------------------------------------------- effets sonores

def sfx(kind):
    if kind == "brush":
        d = 0.65
        t = t_axis(d)
        n = lowpass(highpass(noise(d), 600), 2500 + 5000 * np.exp(-t * 4))
        return n * np.sin(np.pi * np.minimum(1, t / d)) ** 0.6 * np.exp(-t * 2.5) * 0.55
    if kind == "drop":
        d = 0.5
        t = t_axis(d)
        f = 70 + 160 * np.exp(-t * 25)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * 0.9
    if kind == "riser":
        d = 0.55
        t = t_axis(d)
        n = highpass(noise(d), 400 + 6000 * (t / d) ** 2)
        sweep = np.sin(2 * np.pi * np.cumsum(200 + 1400 * (t / d) ** 2) / SR) * 0.15
        return (n * 0.35 + sweep) * (t / d) ** 2.2
    if kind in ("impact", "final"):
        d = 1.6 if kind == "final" else 0.9
        t = t_axis(d)
        f = 38 + 90 * np.exp(-t * 14)
        sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (2.2 if kind == "final" else 4.5))
        burst = lowpass(noise(d), 3000) * np.exp(-t * 18) * 0.6
        return (sub + burst) * 0.9
    if kind == "cut":
        d = 0.08
        t = t_axis(d)
        return highpass(noise(d), 2500) * np.exp(-t * 90) * 0.4
    if kind == "tick":
        d = 0.05
        t = t_axis(d)
        return np.sin(2 * np.pi * 2900 * t) * np.exp(-t * 160) * 0.35
    if kind == "swipe":
        d = 0.3
        t = t_axis(d)
        n = lowpass(highpass(noise(d), 300 + 3000 * t / d), 1500 + 8000 * t / d)
        return n * np.sin(np.pi * t / d) * 0.5
    if kind == "pop":
        d = 0.12
        t = t_axis(d)
        f = 520 + 600 * np.minimum(1, t / 0.05)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 38) * 0.45
    if kind == "leaves":
        d = 0.9
        t = t_axis(d)
        grains = np.repeat(rng.random(int(d * 90) + 1), SR // 90)[: len(t)]
        n = lowpass(highpass(noise(d), 1200), 6000) * (0.4 + grains)
        return n * np.sin(np.pi * t / d) ** 1.5 * 0.45
    if kind == "perc":
        return perc(340, 190) * 1.1
    if kind == "perc_low":
        return perc(230, 120, 0.5) * 1.2
    if kind == "stack":
        out = np.zeros(int(0.4 * SR))
        for k in range(4):
            p = perc(300 - k * 30, 160 - k * 10, 0.3)
            i = int(k * 0.05 * SR)
            out[i : i + len(p)] += p[: len(out) - i] * 0.6
        return out
    if kind == "tear":
        d = 0.35
        t = t_axis(d)
        grains = (rng.random(len(t)) > 0.985).astype(float) * rng.standard_normal(len(t))
        n = highpass(grains * 3 + noise(d) * 0.25, 1500)
        return n * np.minimum(1, t / 0.02) * np.exp(-t * 9) * 0.45
    raise ValueError(kind)


# ------------------------------------------------------------- arrangement

A1, C2, D2, E2, G1 = 55.0, 65.41, 73.42, 82.41, 49.0
prog = [A1, A1, C2, G1]  # une note par mesure, cycle de 4 mesures
chords = [[220, 261.6, 329.6, 493.9], [220, 261.6, 329.6, 493.9], [261.6, 329.6, 392.0, 493.9], [196.0, 293.7, 392.0, 440.0]]

CTA = next(sc["start"] for sc in TL["scenes"] if sc["id"] == "cta")
END = CTA + 2.0  # la musique s'arrête net sur l'impact final
bars = int(DUR / (4 * BEAT))
for b in range(bars):
    t0 = b * 4 * BEAT
    sec = t0  # début de la mesure en secondes
    root = prog[b % 4]
    for beat in range(4):
        tb = t0 + beat * BEAT
        groove = 2.0 <= tb < CTA or CTA + 1.0 <= tb < END
        full = 10.0 <= tb < CTA or CTA + 1.0 <= tb < END
        light = 4.0 <= tb < 7.0
        if tb >= END or (CTA <= tb < CTA + 1.0):
            continue
        if groove:
            place(kick(), tb, 0.75 if light else 1.0)
            place(hat(), tb + BEAT / 2, 0.8, pan=0.25)
            if full or light:
                place(hat(0.04), tb + BEAT * 0.75, 0.45, pan=-0.3)
            if full and beat in (1, 3):
                place(clap(), tb, 0.85, rev=0.25)
            if not (7.0 <= tb < 10.0):
                for e in (0.5, 0.75) if full else (0.5,):
                    place(bass_note(root, BEAT * 0.24), tb + BEAT * e, 0.9)
    if 2.0 <= sec and sec + 4 * BEAT <= CTA:
        place(pad(chords[b % 4], 4 * BEAT), t0, 1.0, rev=0.5)
    elif sec < CTA < sec + 4 * BEAT:
        place(pad(chords[b % 4], CTA - sec), t0, 1.0, rev=0.5)
place(pad(chords[0], 1.0), CTA + 1.0, 1.0, rev=0.5)

# nappe d'ouverture (mesure 1) et de conclusion
place(pad([220, 329.6, 440], 2.0), 0.0, 0.9, rev=0.6)
place(pad([220, 261.6, 329.6, 493.9, 659.3], 2.0), END, 1.1, rev=0.8)

for c in TL["cues"]:
    k = c["sfx"]
    gain = {"brush": 0.9, "final": 1.2, "impact": 1.0}.get(k, 0.8)
    place(sfx(k), c["t"], gain, pan={"swipe": -0.2, "tick": 0.3}.get(k, 0.0), rev=0.35 if k in ("final", "drop", "perc_low") else 0.12)

# ------------------------------------------------------------- réverbération + master

ir_t = t_axis(1.6)
ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 4.2)
ir = lowpass(ir, 5000)
ir /= np.sqrt(np.sum(ir ** 2))
nfft = 1 << int(np.ceil(np.log2(N + len(ir))))
wet = np.fft.irfft(np.fft.rfft(send, nfft) * np.fft.rfft(ir, nfft), nfft)[:N] * 0.6
L += wet
R += np.roll(wet, int(0.011 * SR))

mix = np.stack([L, R], axis=1)
mix = np.tanh(mix * 0.9) / np.tanh(0.9)
fade = np.minimum(1, (DUR - np.arange(N) / SR) / 0.15)[:, None]
mix *= fade
mix *= 10 ** (-2 / 20) / np.max(np.abs(mix))  # -2 dBFS : marge pour l'encodage AAC

out = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "out/soundtrack.wav")
out.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(out), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print(f"bande-son → {out}")
