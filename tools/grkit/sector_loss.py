# SPDX-License-Identifier: GPL-2.0-only
"""Measure what dropping GRKit's hue sectors costs: GRKit's own render model (crates/grkit-core
src/fit/model.rs + hue.rs, ported) with and without each effect's `hue_sectors`, CIEDE2000 on
ColorChecker 24 + natural colours (GRKit's holdout recipe). Base gamma: GR Mod's IIIx Standard
reference curve (same firmware table family). Usage: python3 -I tools/grkit/sector_loss.py third_party/grkit/effects ."""
import glob, json, math, random, re, sys

effects_dir, grmod = sys.argv[1], sys.argv[2]
src = open(f"{grmod}/core/src/color/gr3x-camera.ts").read()
BASE = [float(v) for v in re.search(r"Uint16Array\(\[(.*?)\]\)", src, re.S).group(1).replace("\n", "").split(",") if v.strip()]
assert len(BASE) == 256
K = 7.8 / 0.18
STAGE = [[77, 150, 29], [-43, -85, 128], [128, -107, -21]]
QUADRANT_AT = [0, 3, 2, 1]
BOUNDS = [1490, 745, 0, 0, 1304, 559, 0, 0, 1862, 1118, 373, 0, 1676, 931, 187, 0]
SELECTORS = [3, 2, 1, 0, 0, 11, 10, 9, 0, 0, 9, 8, 7, 6, 0, 6, 5, 4, 3, 0]
BORDERS = [164, 655, 4095]
LEVEL_CURVE = [(0.040, 0.0), (0.055, 0.08), (0.072, 0.20), (0.093, 0.37), (0.121, 0.62), (0.158, 1.08),
               (0.205, 1.30), (0.266, 1.41), (0.346, 1.79), (0.450, 2.29), (0.585, 2.90), (0.660, 3.0)]
CSY_OFFSET, CSY_SLOPE, CSY_BORDER = [0, 512, 512, 432], [73, 0, -7, -14], [0, 56, 768, 856]
BT = [[v / 256 for v in r] for r in STAGE]

def mul(m, v): return [m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2] for r in range(3)]
def rows(f): return [f[0:3], f[3:6], f[6:9]]
def inv3(m):
    a, b, c = m[0]; d, e, f = m[1]; g, h, i = m[2]
    A, B, C = e*i - f*h, -(d*i - f*g), d*h - e*g; det = a*A + b*B + c*C
    return [[A/det, -(b*i - c*h)/det, (b*f - c*e)/det], [B/det, (a*i - c*g)/det, -(a*f - c*d)/det], [C/det, -(a*h - b*g)/det, (a*e - b*d)/det]]
BTI = inv3(BT)

def lookup(t, x):
    x = min(max(x, 0.0), 255.0); lo = min(int(x), 254); f = x - lo
    return t[lo] * (1 - f) + t[lo + 1] * f

def coordinate(v):
    cb = sum(STAGE[1][k] * v[k] for k in range(3)) / 256; cr = sum(STAGE[2][k] * v[k] for k in range(3)) / 256
    if cr >= 0: q, a, b = (0, cr, cb) if cb >= 0 else (3, -cb, cr)
    else: q, a, b = (1, cb, -cr) if cb >= 0 else (2, -cr, -cb)
    return q * 2048 + 2048 * b / (a + b) if a + b > 1e-12 else None

def bank_at(c):
    q4 = min(int(c / 2048), 3); q = QUADRANT_AT[q4]; x = math.floor(c - 2048 * q4)
    n = next((i for i, b in enumerate(BOUNDS[q*4:q*4+4]) if x >= b), 4)
    return SELECTORS[5 * q + n]

def level_position(y):
    if y <= LEVEL_CURVE[0][0]: return LEVEL_CURVE[0][1]
    if y >= LEVEL_CURVE[-1][0]: return LEVEL_CURVE[-1][1]
    for (x0, p0), (x1, p1) in zip(LEVEL_CURVE, LEVEL_CURVE[1:]):
        if y < x1: return p0 + (y - x0) / (x1 - x0) * (p1 - p0)

def offsets_matrix(o):
    m = [0.0] * 9
    for r in range(3):
        m[r*3 + (r+1) % 3] = o[r*2]; m[r*3 + (r+2) % 3] = o[r*2+1]; m[r*4] = 1 - o[r*2] - o[r*2+1]
    return m

def stage_of(hs):
    unit = lambda lvl: [offsets_matrix([v / 128 for v in s]) for s in lvl]
    levels = [unit(hs["matrices"])] + [unit(l) for l in hs.get("levels", [])]
    w = hs["weight"]; starts = [round(x * 1024 / 255) for x in w]
    br = [0] + BORDERS
    slopes = [round((starts[k+1] - starts[k]) * 32 / (br[k+1] - br[k])) if k < 3 else 0 for k in range(4)]
    return levels, starts, slopes

def stage_apply(st, v):
    levels, starts, slopes = st
    c = coordinate(v)
    if c is None: return v
    bank = bank_at(c)
    if bank == 0: return v
    k = bank - 1
    y = sum(STAGE[0][j] * v[j] for j in range(3)) / 256
    x = min(max(3000 * y, 0), 4095); br = [0] + BORDERS
    s = max(i for i in range(4) if x >= br[i])
    w = min(max((starts[s] + slopes[s] * (x - br[s]) / 32) / 1024, 0), 1)
    if len(levels) == 1: m = levels[0][k]
    else:
        p = level_position(y); a = min(int(math.floor(p)), 3); b = min(a + 1, 3); f = p - a
        m = [levels[a][k][n] + f * (levels[b][k][n] - levels[a][k][n]) for n in range(9)]
    mixed = mul(rows(m), v)
    return [max(v[i] + w * (mixed[i] - v[i]), 0.0) for i in range(3)]

def chroma_gain(l):
    y = min(max(l * 1023, 0), 1023); a = max(i for i in range(4) if y >= CSY_BORDER[i])
    return min(max(CSY_OFFSET[a] + CSY_SLOPE[a] * (y - CSY_BORDER[a]) / 8, 0), 1023) / 512

def render(e, lin, sectors=True):
    m = mul(rows([v / 8192 for v in e["matrix"]]), lin)
    if sectors and e.get("_stage"): m = stage_apply(e["_stage"], m)
    codes = [lookup(e["curves"][c], lookup(BASE, K * m[c]) / 64) / 16384 for c in range(3)]
    p = e.get("post_matrix")
    if p: codes = mul(rows([v / 8192 for v in p]), codes)
    ycc = mul(BT, codes); g = chroma_gain(ycc[0])
    out = codes if g == 1 else mul(BTI, [ycc[0], ycc[1] * g, ycc[2] * g])
    return [min(max(v, 0), 1) for v in out]

# --- colour science
def srgb_to_lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
M_XYZ = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]]
WP = [0.95047, 1.0, 1.08883]
def lab_from_display(rgb):
    xyz = mul(M_XYZ, [srgb_to_lin(c) for c in rgb])
    f = lambda t: t ** (1/3) if t > 216/24389 else (24389/27 * t + 16) / 116
    fx, fy, fz = (f(xyz[i] / WP[i]) for i in range(3))
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
def lab_to_lin_srgb(lab):  # D65 Lab -> linear sRGB (holdout sampler; D50 vs D65 irrelevant here)
    L, a, b = lab; fy = (L + 16) / 116; fx = fy + a / 500; fz = fy - b / 200
    finv = lambda t: t ** 3 if t ** 3 > 216/24389 else (116 * t - 16) / (24389/27)
    xyz = [finv(fx) * WP[0], finv(fy) * WP[1], finv(fz) * WP[2]]
    return mul(inv3(M_XYZ), xyz)
def de2000(l1, l2):
    L1, a1, b1 = l1; L2, a2, b2 = l2
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2); Cb = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cb**7 / (Cb**7 + 25**7)))
    a1p, a2p = a1 * (1 + G), a2 * (1 + G); C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1 = math.degrees(math.atan2(b1, a1p)) % 360; h2 = math.degrees(math.atan2(b2, a2p)) % 360
    dL, dC = L2 - L1, C2p - C1p
    dh = 0 if C1p * C2p == 0 else (h2 - h1 if abs(h2 - h1) <= 180 else h2 - h1 - 360 if h2 > h1 else h2 - h1 + 360)
    dH = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dh / 2))
    Lb, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    hb = h1 + h2 if C1p * C2p == 0 else ((h1 + h2) / 2 if abs(h1 - h2) <= 180 else (h1 + h2 + 360) / 2 if h1 + h2 < 360 else (h1 + h2 - 360) / 2)
    T = 1 - 0.17*math.cos(math.radians(hb-30)) + 0.24*math.cos(math.radians(2*hb)) + 0.32*math.cos(math.radians(3*hb+6)) - 0.20*math.cos(math.radians(4*hb-63))
    SL = 1 + 0.015 * (Lb - 50)**2 / math.sqrt(20 + (Lb - 50)**2); SC = 1 + 0.045 * Cbp; SH = 1 + 0.015 * Cbp * T
    RT = -2 * math.sqrt(Cbp**7 / (Cbp**7 + 25**7)) * math.sin(math.radians(60 * math.exp(-((hb - 275) / 25)**2)))
    return math.sqrt((dL/SL)**2 + (dC/SC)**2 + (dH/SH)**2 + RT * (dC/SC) * (dH/SH))

CC = [[37.54,14.37,14.92],[64.66,19.27,17.50],[49.32,-3.82,-22.54],[43.46,-12.74,22.72],[54.94,9.61,-24.79],[70.48,-32.26,-0.37],
      [62.73,35.83,56.50],[39.43,10.75,-45.17],[50.57,48.64,16.67],[30.10,22.54,-20.87],[71.77,-24.13,58.19],[71.51,18.24,67.37],
      [28.37,15.42,-49.80],[54.38,-39.72,32.27],[42.43,51.05,28.62],[81.80,2.67,80.41],[50.63,51.28,-14.12],[49.57,-29.71,-28.32],
      [95.19,-1.03,2.93],[81.29,-0.57,0.44],[66.89,-0.75,-0.06],[50.76,-0.13,0.14],[35.63,-0.46,-0.48],[20.64,0.07,-0.46]]
chart = [[max(v, 0) for v in lab_to_lin_srgb(l)] for l in CC]
rng = random.Random(2); natural = []
while len(natural) < 3000:
    L = 10 + 90 * rng.random(); ch = 70 * rng.random() ** 2; h = 2 * math.pi * rng.random(); ev = 2 ** (2 * rng.random() - 1)
    lin = lab_to_lin_srgb([L, ch * math.cos(h), ch * math.sin(h)])
    if all(0 <= v <= 1 for v in lin): natural.append([v * ev for v in lin])

print(f"{'effect':24s} {'chart mean':>10s} {'chart max':>9s} {'natural mean':>12s} {'p95':>6s}  (dE2000, with vs without its hue sectors)")
for f in sorted(glob.glob(f"{effects_dir}/*/effect.json")):
    e = json.load(open(f))
    if "hue_sectors" not in e: print(f"{e['effect_id']:24s}  no hue sectors (monochrome): exact"); continue
    e["_stage"] = stage_of(e["hue_sectors"])
    def errs(cols): return [de2000(lab_from_display(render(e, c)), lab_from_display(render(e, c, False))) for c in cols]
    ce, ne = errs(chart), sorted(errs(natural))
    print(f"{e['effect_id']:24s} {sum(ce)/len(ce):10.2f} {max(ce):9.2f} {sum(ne)/len(ne):12.2f} {ne[int(.95*len(ne))]:6.2f}")
