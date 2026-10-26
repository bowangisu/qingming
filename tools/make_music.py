#!/usr/bin/env python3
"""Compose and render the page's music: 河上春晴 (Clear Spring Day on the River), an original piece in the manner of
classical Chinese chamber music, for a plucked zither like the guzheng and an end-blown flute like the xiao, in the
pentatonic gong mode on D (D E F# A B). Nothing is sampled or recorded: every note is synthesized here.

- The zither: each pluck is a sum of the string's partials (slightly stretched, as a real string's are), the higher
  ones dying away faster, plus the click of a fingernail pick; the left hand bends notes up from the string below
  (按音), shakes long notes (揉弦), lets them fall away at the end (下滑音), and the right hand sweeps across the
  strings (刮奏) and touches harmonics (泛音).
- The flute: a few soft harmonics over its fundamental, breath noise, a slow swell on long notes, a delayed vibrato,
  small glides between notes and grace notes.
- A hall's reverberation, synthesized as decaying noise in three bands, then a gentle limiter.

The form: a free opening; the theme on the flute over broken chords; a second theme on the zither with the flute
answering; the theme again on the zither alone, ornamented (加花); the theme back on the flute, and a slow close. About
two and a half minutes; it ends in silence so it can loop.
Writes assets/music/along-the-river.mp3 and a spectrogram in tools/music-preview.png.
Usage: python3 tools/make_music.py
"""
import subprocess
from pathlib import Path
import numpy as np
from PIL import Image

SR = 44100
BEAT = 60 / 63                                   # crotchet = 63
OFF = {1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11}  # scale degrees (jianpu) in semitones above D
TONIC = 293.66                                    # D4
rng = np.random.default_rng(1127)


def hz(deg, octv=0):
    return TONIC * 2 ** ((OFF[deg] + 12 * octv) / 12)


STRINGS = [(d, o) for o in range(-2, 3) for d in (1, 2, 3, 5, 6)] + [(1, 3)]   # a 21-string zither, D2 to D6


def step(note, k):
    """the string k strings above (below, if k < 0) a given one"""
    i = STRINGS.index(note) + k
    return STRINGS[max(0, min(len(STRINGS) - 1, i))]


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


# ----------------------------------------------------------------------------------------------- instruments
def zheng(f0, vel=.6, cents=None, harmonic=False, ring=None):
    """one plucked string. cents(t): the left hand's bend or vibrato, in cents, over time"""
    T1 = float(np.clip(3.6 * (220 / f0) ** .5, .9, 7.5))           # low strings ring longer
    L = ring or min(T1 * 3.0, 7.0)
    n = int(L * SR); t = np.arange(n) / SR
    c = cents(t) if cents else np.zeros(n)
    ph = 2 * np.pi * np.cumsum(f0 * 2 ** (c / 1200)) / SR
    out = np.zeros(n)
    if harmonic:                                                     # touched at its middle: the octave, glassy
        for k, a, d in ((2, 1., .5), (4, .14, .22), (6, .04, .12)):
            out += a * np.sin(k * ph) * np.exp(-t / (T1 * d))
        out *= .8
    else:
        p = .11 + .04 * rng.random()                                 # where the pick strikes the string
        K = int(min(24, 9500 / f0))
        bright = .85 + .5 * vel
        for k in range(1, K + 1):
            a = abs(np.sin(k * np.pi * p)) / k ** (1.55 - .5 * bright)
            Tk = T1 / (1 + .55 * (k - 1) ** 1.2)
            out += a * np.sin(k * np.sqrt(1 + .00009 * k * k) * ph + rng.random() * 6.283) * np.exp(-t / Tk)
        m = min(n, int(.03 * SR))                                    # the nail pick's click
        nz = np.diff(np.r_[0., rng.standard_normal(m)]) * np.exp(-np.arange(m) / (.0022 * SR))
        out[:m] += nz * .1 * vel
    env = np.minimum(1, t / .0012) * smooth((L - t) / .3)            # damped by the hand at the end
    return out * env * vel


def bell(f, vel=.25, L=4.5):
    """a small bowl bell (碰铃), struck once"""
    n = int(L * SR); t = np.arange(n) / SR; out = np.zeros(n)
    for k, a, d in ((1, 1., 2.6), (2.76, .4, 1.1), (5.4, .16, .5), (8.93, .06, .25)):
        out += a * np.sin(2 * np.pi * f * k * t + rng.random() * 6.283) * np.exp(-t / d)
    return out * np.minimum(1, t / .002) * np.minimum(1, (L - t) / .2) * vel


def band(x, lo, hi):
    """x filtered to lo..hi Hz (FFT, soft edges)"""
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    w = smooth((f - lo * .7) / (lo * .3 + 1)) * (1 - smooth((f - hi) / (hi * .4)))
    return np.fft.irfft(X * w, len(x))


def xiao(notes, vel=.55):
    """one breath of the flute: notes [(f, seconds, tongued)] played legato. Returns mono samples"""
    total = sum(d for _, d, _ in notes); tail = .35
    n = int((total + tail) * SR); t = np.arange(n) / SR
    logf = np.zeros(n); amp = np.zeros(n); cents = np.zeros(n)
    pos = 0.
    for i, (f, d, tongued) in enumerate(notes):
        a, b = int(pos * SR), int((pos + d) * SR)
        logf[a:] = np.log2(f)
        u = (t[a:b] - pos) / d
        swell = .78 + .22 * np.sin(np.pi * np.clip(u * 1.1, 0, 1)) if d > .6 else 1.
        amp[a:b] = swell
        if tongued and i:                                            # a light tongue between separate notes
            k = int(.05 * SR); amp[a:a + k] *= .35 + .65 * smooth(np.arange(k) / k)
        if d > .7:                                                   # a vibrato that comes in late on long notes
            s = np.clip((t[a:b] - pos - .35) / .5, 0, 1)
            cents[a:b] += 16 * s * np.sin(2 * np.pi * 4.9 * (t[a:b] - pos))
        pos += d
    k = int(.045 * SR)                                               # glides between notes
    logf = np.convolve(np.r_[np.full(k, logf[0]), logf, np.full(k, logf[-1])], np.ones(k) / k, 'same')[k:-k]
    amp[int(total * SR):] = 0
    att = smooth(t / .14); rel = 1 - smooth((t - total + .05) / (tail + .05))
    amp = np.convolve(amp, np.ones(400) / 400, 'same') * att * rel
    f = 2 ** logf * 2 ** (cents / 1200)
    ph = 2 * np.pi * np.cumsum(f) / SR
    breath = 1 + .05 * np.sin(2 * np.pi * 4.9 * t + 1)
    out = np.zeros(n)
    for k, a in ((1, 1.), (2, .2 + .12 * vel), (3, .08), (4, .035), (5, .015)):
        out += a * np.sin(k * ph)
    out *= amp * breath
    out += band(rng.standard_normal(n), 500, 3400) * amp ** 1.4 * .036    # the breath across the mouthpiece
    return out * vel


# -------------------------------------------------------------------------------------------------- notation
def parse(s):
    """jianpu: '5:1.5 6:.5 1\\':1 0:1 | …' -> [(deg, oct, beats, ornaments)]. ' raises an octave, , lowers it; 0 is a
    rest; ornaments after the degree: ~ vibrato, ^ bent up from the string below, v falls away at the end, * a grace
    note from above, > a sweep of strings into it"""
    out = []
    for tok in s.replace('|', ' ').split():
        head, beats = tok.split(':')
        deg = int(head[0]); octv = head.count("'") - head.count(',')
        orn = ''.join(c for c in head[1:] if c in '~^v*>')
        out.append((deg, octv, float(beats), orn))
    return out


A1 = "5:1.5 6:.5 1':1 6:1 | 5:1 3:.5 5:.5 6~:2 | 1':1.5 2':.5 3':1 2':.5 1':.5 | 6~:3 0:1"
A2 = "3'*:1.5 5':.5 3':1 2':1 | 1':1 2':.5 1':.5 6~:2 | 5:1.5 6:.5 3:1 2:1 | 1~:3 0:1"
B1 = "2'>:1 3':.5 2':.5 1':1 6:1 | 1':1.5 2':.5 6^:2 | 5:.5 6:.5 1':.5 2':.5 3':1 5':1 | 3'~v:3 0:1"
B2 = "5':1 3':.5 2':.5 1':1 2':1 | 3':1.5 2':.5 1':1 6:1 | 5:1 6:.5 1':.5 2':1 3':.5 2':.5 | 1'~:4"
B2X = "0:4 | 3':4 | 2':2 1':2 | 6~:4"                                 # the flute answering under the second theme
D2 = "3'*:1.5 5':.5 3':1 2':1 | 1':1 2':.5 1':.5 6~:2 | 5:1.5 6:.5 3:1 2:1 | 5:2 6:2 | 1'~:6"


class Score:
    def __init__(self, seconds):
        self.n = int(seconds * SR)
        self.dry = np.zeros((2, self.n)); self.send = np.zeros(self.n)

    def add(self, x, at, pan=0., rev=.3):
        a = int(at * SR); b = min(self.n, a + len(x)); x = x[:b - a]
        g = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)])
        self.dry[:, a:b] += g[:, None] * x; self.send[a:b] += x * rev

    def pluck(self, note, at, vel=.55, orn='', dur=1.5, harmonic=False, ring=None):
        """a zither string, its ornaments played by the left hand"""
        deg, octv = note
        f = hz(deg, octv); cents = []
        if '^' in orn:                                               # pluck the string below and press it up
            lower = step(note, -1); f = hz(*lower); up = 1200 * np.log2(hz(deg, octv) / f)
            cents.append(lambda t, up=up: up * smooth((t - .06) / .2))
        if '~' in orn:
            cents.append(lambda t: 22 * np.clip((t - .25) / .4, 0, 1) * np.sin(2 * np.pi * 5.6 * np.maximum(t - .25, 0)))
        if 'v' in orn:                                               # let it fall away a tone at the end
            cents.append(lambda t, d=dur: -180 * smooth((t - d * .78) / .35))
        if '>' in orn:                                               # sweep up the strings into it
            for k in range(6, 0, -1): self.pluck(step(note, -k), at - k * .032, vel * (.28 + .04 * (6 - k)))
        if '*' in orn:
            self.pluck(step(note, 1), at - .09, vel * .6)
        c = (lambda t, cs=tuple(cents): sum(fn(t) for fn in cs)) if cents else None
        i = STRINGS.index(note) if note in STRINGS else 10
        self.add(zheng(f, vel, c, harmonic, ring), at, pan=-.38 + .6 * i / len(STRINGS), rev=.32)

    def flute(self, phrase, at, vel=.55):
        """the flute plays a parsed phrase legato, breathing at the rests"""
        groups, cur, t = [], [], at
        for deg, octv, beats, orn in phrase:
            d = beats * BEAT
            if deg == 0:
                if cur: groups.append(cur); cur = []
                t += d; continue
            if not cur: cur = [t]
            if '*' in orn: cur.append((hz(*step((deg, octv), 1)), .075, True)); d -= .075
            cur.append((hz(deg, octv), d, len(cur) > 1 and rng.random() < .55))
            t += beats * BEAT
        if cur: groups.append(cur)
        for g in groups:
            self.add(xiao(g[1:], vel), g[0], pan=.22, rev=.42)

    def melody(self, phrase, at, octv=0, vel=.62):
        """the zither plays a parsed phrase"""
        t = at
        for deg, o, beats, orn in phrase:
            if deg: self.pluck((deg, o + octv), t, vel * (1 if beats >= 1 else .85), orn, beats * BEAT)
            t += beats * BEAT
        return t

    def chords(self, phrase, at, vel=.3):
        """the zither's left hand under the flute: a bass string at each bar, broken chords on the beats after"""
        t, bar = at, 0.
        for deg, o, beats, orn in phrase:
            if bar == 0:
                root = (deg, -2) if deg else (1, -2)
                self.pluck(root, t, vel * 1.5, '~' if rng.random() < .5 else '')
                pat = [root and step(root, k) for k in (5, 7, 8, 7)]
                for j, nt in enumerate(pat):                          # damped before the next bar comes in
                    self.pluck(nt, t + (1 + j * .75) * BEAT, vel * (.9 if j % 2 == 0 else .7), ring=(3.4 - j * .75) * BEAT)
            bar += beats
            if bar >= 4 - 1e-6: bar = 0.
            t += beats * BEAT

    def flowers(self, phrase, at, vel=.6):
        """the theme ornamented on the zither alone (加花): each long note filled in with a turn or a run to the next"""
        t = at; ph = [p for p in phrase]
        for i, (deg, o, beats, orn) in enumerate(ph):
            nxt = next(((d, oo) for d, oo, _, _ in ph[i + 1:] if d), None)
            if not deg: t += beats * BEAT; continue
            note = (deg, o); b = beats
            if b <= .5:
                self.pluck(note, t, vel * .85)
            elif b <= 1.5:
                self.pluck(note, t, vel, '')
                self.pluck(step(note, 1), t + (b - .5) * BEAT, vel * .55); self.pluck(note, t + (b - .25) * BEAT, vel * .6)
            else:                                                     # held: shaken, then a run toward the next note
                self.pluck(note, t, vel, '~')
                if nxt:
                    d = 1 if STRINGS.index(nxt) >= STRINGS.index(note) else -1
                    run = [step(nxt, -d * k) for k in (3, 2, 1)]
                    for j, nt in enumerate(run): self.pluck(nt, t + (b - .75 + j * .25) * BEAT, vel * (.5 + .08 * j))
            if i % 4 == 0:                                            # the left hand keeps a bass going
                self.pluck((deg, -2) if (deg, -2) in STRINGS else (1, -2), t, vel * .55)
            t += b * BEAT
        return t


def reverb(x, seconds=3.2, seed=0):
    """a hall: decaying noise in three bands (the highs dying first), a few early reflections, a little pre-delay"""
    r = np.random.default_rng(seed); n = int(seconds * SR); t = np.arange(n) / SR
    ir = np.zeros(n)
    for lo, hi, t60 in ((40, 700, 3.0), (700, 3000, 2.2), (3000, 12000, 1.1)):
        ir += band(r.standard_normal(n), lo, hi) * np.exp(-6.9 * t / t60)
    ir *= smooth(t / .03)
    for d, g in ((.011, .5), (.019, .35), (.027, .3), (.041, .22)): ir[int(d * SR)] += g * (1 if r.random() < .5 else -1) * 3
    ir = np.r_[np.zeros(int(.018 * SR)), ir]
    N = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    y = np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[:len(x)]
    return y / np.sqrt(np.sum(ir ** 2))


def compose():
    bars = lambda s: sum(b for _, _, b, _ in parse(s)) * BEAT
    t_A = 13.0
    t_B = t_A + bars(A1) + bars(A2)
    t_C = t_B + bars(B1) + bars(B2) + .6
    t_D = t_C + bars(A1) + bars(A2) + .8
    end = t_D + bars(A1) + bars(D2)
    S = Score(end + 9)

    # the opening, in free time: a sweep up the strings, harmonics, a low string bent, the flute coming in
    for k, nt in enumerate(STRINGS[5:16]): S.pluck(nt, .4 + k * .034, .22 + .03 * k)
    S.pluck((5, 0), .4 + 11 * .034 + .05, .55, '~')
    for at, nt in ((2.6, (1, 1)), (3.5, (5, 1)), (4.3, (6, 0)), (5.6, (1, 1))): S.pluck(nt, at, .5, harmonic=True)
    S.pluck((1, -2), 4.9, .75, '~'); S.pluck((5, -2), 5.5, .45)
    S.add(bell(hz(5, 1)), 2.6, pan=.1, rev=.5)
    S.flute(parse("5:2.6 6:1.4 5:1 3:1 5:3"), 6.4, .5)
    S.pluck((1, -2), 12.2, .6); S.pluck((5, -1), 12.5, .4); S.pluck((1, 0), 12.8, .4)

    # the theme on the flute, the zither under it
    S.flute(parse(A1), t_A); S.chords(parse(A1), t_A)
    S.flute(parse(A2), t_A + bars(A1)); S.chords(parse(A2), t_A + bars(A1))
    for k in range(5): S.pluck(step((1, -1), k * 2), t_B - BEAT * .9 + k * .05, .35)   # a rolled chord into the next

    # the second theme on the zither, the flute answering in its second half
    S.melody(parse(B1), t_B); S.melody(parse(B2), t_B + bars(B1))
    for b, root in enumerate([(2, -2), (1, -2), (5, -2), (3, -2), (5, -2), (3, -2), (5, -2), (1, -2)]):
        S.pluck(root, t_B + b * 4 * BEAT, .45, '~' if b % 2 else '')
        S.pluck(step(root, 3), t_B + (b * 4 + 2) * BEAT, .3)
    S.flute(parse(B2X), t_B + bars(B1), .42)
    S.add(bell(hz(1, 1)), t_C - .6, pan=-.1, rev=.5)

    # the theme on the zither alone, ornamented
    t = S.flowers(parse(A1), t_C, .58)
    S.flowers(parse(A2), t, .58)
    for k, nt in enumerate(STRINGS[16:4:-1]): S.pluck(nt, t_D - .55 + k * .03, .3 - .012 * k)   # a sweep down into the return

    # the theme back on the flute, and the close: a long last note, harmonics, the low string shaken
    S.flute(parse(A1), t_D); S.chords(parse(A1), t_D)
    S.flute(parse(D2), t_D + bars(A1)); S.chords(parse(D2)[:-1], t_D + bars(A1))
    for k, nt in enumerate([(1, -2), (5, -2), (1, -1), (5, -1), (1, 0)]): S.pluck(nt, end - 6 * BEAT + k * .07, .45, '~' if k == 0 else '')
    for at, nt in ((end - 2.2, (1, 1)), (end - 1.2, (5, 1)), (end + .2, (1, 2))): S.pluck(nt, at, .45, harmonic=True)
    S.add(bell(hz(1, 1), .2), end + .2, pan=0, rev=.6)
    return S


def master(S):
    wetL, wetR = reverb(S.send, seed=1), reverb(S.send, seed=2)
    mix = S.dry + np.stack([wetL, wetR]) * .55
    mix -= mix.mean(1, keepdims=True)
    rms = np.sqrt(np.mean(mix[:, mix.shape[1] // 10:] ** 2))
    mix *= 10 ** (-17 / 20) / rms                                    # about -17 dBFS on average
    mix = np.tanh(mix * 1.15) / 1.15                                 # a soft limiter for the peaks
    fade = int(.4 * SR); mix[:, -fade:] *= np.linspace(1, 0, fade); mix[:, :400] *= np.linspace(0, 1, 400)
    return mix


def preview(mix, path):
    """a spectrogram, for checking by eye: time across, 0..8 kHz up"""
    x = mix.mean(0); hop = 1024; win = np.hanning(2048)
    frames = np.stack([np.abs(np.fft.rfft(x[i:i + 2048] * win))[:372] for i in range(0, len(x) - 2048, hop)], 1)
    db = 20 * np.log10(frames + 1e-6); db = np.clip((db - db.max() + 80) / 80, 0, 1)
    Image.fromarray((db[::-1] * 255).astype(np.uint8)).resize((1600, 372)).save(path)


def main():
    root = Path(__file__).resolve().parent.parent
    S = compose(); mix = master(S)
    out = root / 'assets' / 'music'; out.mkdir(parents=True, exist_ok=True)
    wav = out / 'along-the-river.wav'
    pcm = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
    import wave
    with wave.open(str(wav), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-codec:a', 'libmp3lame', '-b:a', '128k',
                    '-metadata', 'title=河上春晴 · Clear Spring Day on the River', '-metadata', 'artist=Bo Wang',
                    str(out / 'along-the-river.mp3')], check=True)
    wav.unlink()
    preview(mix, root / 'tools' / 'music-preview.png')
    print(f'{mix.shape[1] / SR:.1f} s, peak {np.abs(mix).max():.3f}, rms {20 * np.log10(np.sqrt(np.mean(mix ** 2))):.1f} dBFS')


if __name__ == '__main__':
    main()
